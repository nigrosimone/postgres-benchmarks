import { Bench, type BenchOptions } from "tinybench";
import pg, { type QueryConfig, type PoolConfig } from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import os from "node:os";
import assert from "node:assert";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);
console.log(`Pool size: ${process.env.PGMAX}`);
const { packages } = JSON.parse(readFileSync("package-lock.json", "utf-8"));

console.log(`Dependencies versions:`);
console.log(JSON.stringify({
  tinybench: packages["node_modules/tinybench"]?.version,
  pg: packages["node_modules/pg"]?.version,
  "pg-native": packages["node_modules/pg-native"]?.version,
  libpq: packages["node_modules/libpq"]?.version,
  postgres: packages["node_modules/postgres"]?.version,
}, null, 2));

const { native } = pg;

if (!native) {
  console.error(
    "pg-native is not available. Please install pg-native."
  );
  process.exit(1);
}

// Support connecting over Unix domain socket to reduce TCP overhead.
// You can set `PGSOCKET` to the socket directory (e.g. `/var/run/postgresql`),
// or set `PGHOST` to the socket directory (starts with `/`).
const socketPath = process.env.PGSOCKET ?? (process.env.PGHOST && process.env.PGHOST.startsWith('/') ? process.env.PGHOST : undefined);

if (!socketPath && !process.env.PGHOST) {
  console.error("PGHOST environment variable is not set (or PGSOCKET).");
  process.exit(1);
}

// When using a socket path, PGPORT is optional (defaults to 5432).
if (!socketPath && !process.env.PGPORT) {
  console.error("PGPORT environment variable is not set.");
  process.exit(1);
}

if (!process.env.PGDATABASE) {
  console.error("PGDATABASE environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGUSER) {
  console.error("PGUSER environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGPASSWORD) {
  console.error("PGPASSWORD environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGMAX) {
  console.error("PGMAX environment variable is not set.");
  process.exit(1);
}

const host = socketPath ?? process.env.PGHOST;
const max = +process.env.PGMAX;
const port = +(process.env.PGPORT ?? 5432);

// `pipeline` landed in pg 8.23.0 / pg-native 3.9.0 but is not in @types/pg 8.21.0 yet.
type PipelinePoolConfig = PoolConfig & { pipeline?: boolean };

// Connection settings shared by every client, in each library's own spelling.
const pgConnection: PipelinePoolConfig = {
  host,
  port,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  // PostgreSQL pipeline mode, so all three clients are compared on equal terms
  // (`postgres` (porsager/postgres) pipelines internally and cannot be turned off).
  // pg-native additionally requires libpq >= 1.11.0 built against PostgreSQL 14+ client libraries.
  pipeline: true,
};

const porsagerConnection = {
  host,
  port,
  database: process.env.PGDATABASE,
  username: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  prepare: true, // Automatic creation of prepared statements
};

// --- Sequential variant: one query at a time, every client backed by a pool of `max` connections.
const pgConfig: PipelinePoolConfig = { ...pgConnection, max };

const pgNative = new native.Pool(pgConfig);
const pgNativeQuery = pgNative.query.bind(pgNative);

const pgVanilla = new pg.Pool(pgConfig);
const pgVanillaQuery = pgVanilla.query.bind(pgVanilla);

const sqlPrepared = postgres({ ...porsagerConnection, max });

// --- Pipelined variant -------------------------------------------------------
// Pipelining only happens when several queries are in flight on the SAME connection.
// A pool would defeat it by spreading a concurrent batch across `max` connections, so here every
// client drives exactly ONE connection and BATCH queries are issued at once.
//
// The three are on equal terms even though the spelling differs: `pg`/`pg-native` expose a
// single-connection `Client` (`max` is a pg-pool option and is not passed here), while
// `postgres` is always pool-backed, so `max: 1` is its way of saying the same thing.
const BATCH = 10;

const pgNativePipe = new native.Client(pgConnection);
const pgVanillaPipe = new pg.Client(pgConnection);
const sqlPipe = postgres({ ...porsagerConnection, max: 1 });

await Promise.all([pgNativePipe.connect(), pgVanillaPipe.connect()]);

const pgNativePipeQuery = pgNativePipe.query.bind(pgNativePipe);
const pgVanillaPipeQuery = pgVanillaPipe.query.bind(pgVanillaPipe);

try {
  await Promise.all([
    pgNativeQuery("SELECT 1"),
    pgVanillaQuery("SELECT 1"),
    sqlPrepared`SELECT 1`,
  ]);
  console.log("Database connectivity verified through: " + (socketPath ? `socket at ${socketPath}` : `host ${process.env.PGHOST}:${process.env.PGPORT}`));
  console.log(`Pipeline mode: enabled for all clients`);
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

// Data preparation.
// Kept as separate statements: pipeline mode always uses the extended query protocol,
// which rejects multi-statement scripts ("cannot insert multiple commands into a prepared statement").
const setupStatements = [
  `CREATE TABLE IF NOT EXISTS benchmark_rows (
  id int PRIMARY KEY,
  int_value int,
  string_value text,
  null_value text,
  bool_value boolean
)`,
  `TRUNCATE benchmark_rows`,
  `INSERT INTO benchmark_rows (id, int_value, string_value, null_value, bool_value)
    SELECT
      i,
      1337,
      'wat',
      NULL,
      false
    FROM generate_series(1, 500) i`,
];

const conn = await pgNative.connect();
try {
  for (const statement of setupStatements) {
    await conn.query(statement);
  }
  const result = await conn.query(
    `SELECT COUNT(*)::int AS count FROM benchmark_rows`
  );
  assert.equal(result.rows[0].count, 500, `Expected 500 rows in benchmark_rows, but got ${result.rows[0].count}`);
} finally {
  await conn.release();
}

const consume = (rows: any[]) => {
  let sum = 0;
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const r = rows[i];
    sum += r.int_value;
    sum += r.string_value.length;
    sum += r.null_value ?? 0;
    sum += r.bool_value ? 1 : 0;
  }
  (globalThis as any).__do_not_optimize = sum;
  if (1340 * len !== sum) throw new Error(`Unexpected sum: ${sum} for ${len} rows`);
  return sum;
}

// All permutations of the three client indices (3! = 6). 
// Every query size is measured under EVERY order and the raw samples are pooled per client, 
// so the execution order is fully removed. Deterministic (no RNG), so runs stay reproducible.
const permute = <T>(arr: T[]): T[][] =>
  arr.length <= 1
    ? [arr]
    : arr.flatMap((x, i) =>
        permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [x, ...rest])
      );
const ORDERS = permute([0, 1, 2]);

// `iterations` is a floor on the sample count. The pipelined suite resolves BATCH queries per
// iteration, so it reaches the same number of queries with proportionally fewer iterations.
const benchOptionFor = (iterations: number): BenchOptions => ({
  iterations,
  warmupTime: 500,
  // Split the measurement budget across the permutations
  time: Math.round(5000 / ORDERS.length),
  retainSamples: true, // required so task.result.latency.samples is populated for pooling
  setup: (_task, _mode) => {
    (globalThis as any).__do_not_optimize = undefined;
    // Run the garbage collector before BOTH the warmup and the measured run of each task
    if (typeof globalThis.gc === 'function') {
      globalThis.gc()
    }
  },
})

// The query sizes under test.
const limits = [1, 100, 500] as const;
type Limit = (typeof limits)[number];

const porsagerQueries: Record<Limit, () => Promise<any>> = {
  1: () => sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 1`,
  100: () => sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 100`,
  500: () => sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 500`,
};

const porsagerPipeQueries: Record<Limit, () => Promise<any>> = {
  1: () => sqlPipe`SELECT * FROM benchmark_rows ORDER BY id LIMIT 1`,
  100: () => sqlPipe`SELECT * FROM benchmark_rows ORDER BY id LIMIT 100`,
  500: () => sqlPipe`SELECT * FROM benchmark_rows ORDER BY id LIMIT 500`,
};

const queryText = (limit: Limit) => `SELECT * FROM benchmark_rows ORDER BY id LIMIT ${limit}`;

// Sequential suite: one query at a time against a pool of `max` connections.
const adders: Array<(bench: Bench, limit: Limit) => void> = [
  (bench, limit) => {
    const pgQuery: QueryConfig = {
      text: `SELECT * FROM benchmark_rows ORDER BY id LIMIT ${limit}`,
      name: `query_${limit}`, // Creation of prepared statements
    };
    bench.add("pg-native (brianc/node-postgres)", async () => {
      const results = await pgNativeQuery(pgQuery);
      return consume(results.rows);
    });
  },
  (bench, limit) => {
    const pgQuery: QueryConfig = {
      text: `SELECT * FROM benchmark_rows ORDER BY id LIMIT ${limit}`,
      name: `query_${limit}`, // Creation of prepared statements
    };
    bench.add("pg (brianc/node-postgres)", async () => {
      const results = await pgVanillaQuery(pgQuery);
      return consume(results.rows);
    });
  },
  (bench, limit) => {
    const query = porsagerQueries[limit];
    bench.add("postgres (porsager/postgres)", async () => {
      const results = await query();
      return consume(results);
    });
  },
];

// Pipelined suite: BATCH queries issued concurrently on a single connection, so the client
// can keep several requests in flight instead of paying one round trip per query.
const pipelinedAdders: Array<(bench: Bench, limit: Limit) => void> = [
  (bench, limit) => {
    const pgQuery: QueryConfig = { text: queryText(limit), name: `query_${limit}` };
    bench.add("pg-native (brianc/node-postgres)", async () => {
      const batch = await Promise.all(
        Array.from({ length: BATCH }, () => pgNativePipeQuery(pgQuery))
      );
      let sum = 0;
      for (const results of batch) sum += consume(results.rows);
      return sum;
    });
  },
  (bench, limit) => {
    const pgQuery: QueryConfig = { text: queryText(limit), name: `query_${limit}` };
    bench.add("pg (brianc/node-postgres)", async () => {
      const batch = await Promise.all(
        Array.from({ length: BATCH }, () => pgVanillaPipeQuery(pgQuery))
      );
      let sum = 0;
      for (const results of batch) sum += consume(results.rows);
      return sum;
    });
  },
  (bench, limit) => {
    const query = porsagerPipeQueries[limit];
    bench.add("postgres (porsager/postgres)", async () => {
      const batch = await Promise.all(Array.from({ length: BATCH }, () => query()));
      let sum = 0;
      for (const results of batch) sum += consume(results);
      return sum;
    });
  },
];

// pg-native does not deduplicate PREPARE within a single pipelined batch: N queries sharing a
// statement name would each send a prepare and the server would reject the duplicates. Running one
// query first registers the name on the connection, so every later batch only binds and executes.
// (`pg` tracks in-flight names itself and `postgres` manages its own prepared statements.)
const primePreparedStatements = async (limit: Limit) => {
  await Promise.all([
    pgNativePipeQuery({ text: queryText(limit), name: `query_${limit}` }),
    pgVanillaPipeQuery({ text: queryText(limit), name: `query_${limit}` }),
    porsagerPipeQueries[limit](),
  ]);
};

// Nearest-rank percentile over an already-sorted sample array.
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? NaN;

const summarize = (samplesMs: number[]) => {
  const n = samplesMs.length;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mean = samplesMs.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? samplesMs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const moe = 1.96 * (Math.sqrt(variance) / Math.sqrt(n)); // 95% CI of the mean (z ≈ 1.96 for large n)
  return {
    samples: n,
    meanNs: mean * 1e6,
    medianNs: percentile(sorted, 0.5) * 1e6,
    lo: (mean - moe) * 1e6, // lower bound of the mean's confidence interval (ns)
    hi: (mean + moe) * 1e6, // upper bound of the mean's confidence interval (ns)
    rmePct: mean > 0 ? (moe / mean) * 100 : 0,
    opsPerSec: mean > 0 ? 1000 / mean : 0, // mean is ms/op
  };
};

// Measure one query size for one suite under every execution order, pooling the raw samples per client.
const runSuite = async (
  label: string,
  suiteAdders: Array<(bench: Bench, limit: Limit) => void>,
  limit: Limit,
  queriesPerIteration: number
) => {
  const options = benchOptionFor(Math.round(5_000 / queriesPerIteration));
  const pooled = new Map<string, number[]>();
  for (const order of ORDERS) {
    if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
    const bench = new Bench({ ...options, name: label });
    for (const idx of order) suiteAdders[idx]?.(bench, limit);
    await bench.run();
    for (const task of bench.tasks) {
      const samples = (task.result as any)?.latency?.samples as number[] | undefined;
      if (!samples) continue;
      const bucket = pooled.get(task.name) ?? [];
      for (const s of samples) bucket.push(s);
      pooled.set(task.name, bucket);
    }
  }

  console.log(`${label} (pooled over ${ORDERS.length} execution orders)`);

  const rows = [...pooled.entries()]
    .map(([name, samples]) => ({ name, ...summarize(samples) }))
    .filter((r) => Number.isFinite(r.medianNs) && Number.isFinite(r.meanNs));

  console.table(
    rows.map((r) => ({
      "Task name": r.name,
      "Latency avg (ns)": `${r.meanNs.toFixed(0)} ± ${r.rmePct.toFixed(2)}%`,
      "Latency med (ns)": r.medianNs.toFixed(0),
      "Throughput avg (ops/s)": Math.round(r.opsPerSec),
      // With a batch, one iteration resolves `queriesPerIteration` queries
      "Queries/s": Math.round(r.opsPerSec * queriesPerIteration),
      Samples: r.samples,
    }))
  );

  // Rank by median latency, but only crown a winner when the leader's mean confidence interval sits entirely
  // below every rival's, i.e. the gap is statistically real, not noise.
  const leader = [...rows].sort((a, b) => a.medianNs - b.medianNs)[0]; // fastest typical (p50) latency
  const meanLeader = [...rows].sort((a, b) => a.meanNs - b.meanNs)[0]; // lowest mean latency
  if (leader && meanLeader) {
    const clearWinner = rows.every((r) => r.name === leader.name || leader.hi < r.lo);
    if (clearWinner) {
      console.log(`🏆 Winner: ${leader.name} (${leader.medianNs.toFixed(0)} ns median)`);
    } else {
      console.log(
        `🤝 No clear winner within margin of error - lowest median: ${leader.name} (${leader.medianNs.toFixed(0)} ns); lowest mean: ${meanLeader.name} (${meanLeader.meanNs.toFixed(0)} ns)`
      );
    }
  }
};

// Run the benchmark and print results
try {
  console.log(
    `nodejs ${process.version}, CPU: ${os.cpus()?.[0]?.model ?? 'unknown'} Cores: ${os.cpus()?.length ?? 'unknown'}, RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`
  );

  console.log(`\n=== Sequential: one query at a time, pool of ${max} connections ===`);
  for (const limit of limits) {
    console.log('\n');
    await runSuite(`query_${limit}`, adders, limit, 1);
  }

  console.log(`\n=== Pipelined: ${BATCH} concurrent queries on a single connection ===`);
  for (const limit of limits) {
    console.log('\n');
    await primePreparedStatements(limit);
    await runSuite(`query_${limit}_pipelined_x${BATCH}`, pipelinedAdders, limit, BATCH);
  }
} catch (err) {
  console.error('Benchmark run failed:', err);
  process.exit(1);
} finally {
  await Promise.all([
    pgNative.end(),
    pgVanilla.end(),
    sqlPrepared.end(),
    pgNativePipe.end(),
    pgVanillaPipe.end(),
    sqlPipe.end(),
  ]);
  process.exit(0);
}
