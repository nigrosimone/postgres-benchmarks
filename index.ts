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

const pgConfig: PoolConfig = {
  max,
  host,
  port,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

const pgNative = new native.Pool(pgConfig);
const pgNativeQuery = pgNative.query.bind(pgNative);

const pgVanilla = new pg.Pool(pgConfig);
const pgVanillaQuery = pgVanilla.query.bind(pgVanilla);

const sqlPrepared = postgres({
  max,
  host,
  port,
  database: process.env.PGDATABASE,
  username: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  prepare: true, // Automatic creation of prepared statements
});

try {
  await Promise.all([
    pgNativeQuery("SELECT 1"),
    pgVanillaQuery("SELECT 1"),
    sqlPrepared`SELECT 1`,
  ]);
  console.log("Database connectivity verified through: " + (socketPath ? `socket at ${socketPath}` : `host ${process.env.PGHOST}:${process.env.PGPORT}`));
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

// Data preparation
const conn = await pgNative.connect();
try {
  await conn.query(`CREATE TABLE IF NOT EXISTS benchmark_rows (
  id int PRIMARY KEY,
  int_value int,
  string_value text,
  null_value text,
  bool_value boolean
);

TRUNCATE benchmark_rows;

INSERT INTO benchmark_rows (id, int_value, string_value, null_value, bool_value)
    SELECT
      i,
      1337,
      'wat',
      NULL,
      false
    FROM generate_series(1, 500) i;`);
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

const benchOption: BenchOptions = {
  iterations: 5_000,
  warmupTime: 1000,
  time: 5000,
  setup: (_task, mode) => {
    (globalThis as any).__do_not_optimize = undefined;
    // Run the garbage collector before the warmup of each task
    if (mode === 'warmup' && typeof globalThis.gc === 'function') {
      globalThis.gc()
    }
  },
}

const benchmarks: Array<() => Bench> = [
  () => {
    const bench = new Bench({
      ...benchOption,
      name: 'query_1'
    });

    const pgQuery: QueryConfig = {
      text: `SELECT * FROM benchmark_rows ORDER BY id LIMIT 1`,
      name: "query_1", // Creation of prepared statements
    };

    bench
      .add(
        "pg-native (brianc/node-postgres)",
        async () => {
          const results = await pgNativeQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "pg (brianc/node-postgres)",
        async () => {
          const results = await pgVanillaQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "postgres (porsager/postgres)",
        async () => {
          const results = await sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 1`;
          return consume(results);
        }
      );
    return bench;
  },
  () => {
    const bench = new Bench({
      ...benchOption,
      name: 'query_100'
    });

    const pgQuery: QueryConfig = {
      text: `SELECT * FROM benchmark_rows ORDER BY id LIMIT 100`,
      name: "query_100", // Creation of prepared statements
    };

    bench
      .add(
        "pg-native (brianc/node-postgres)",
        async () => {
          const results = await pgNativeQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "pg (brianc/node-postgres)",
        async () => {
          const results = await pgVanillaQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "postgres (porsager/postgres)",
        async () => {
          const results = await sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 100`;
          return consume(results);
        }
      );
    return bench;
  },
  () => {
    const bench = new Bench({
      ...benchOption,
      name: 'query_500'
    });

    const pgQuery: QueryConfig = {
      text: `SELECT * FROM benchmark_rows ORDER BY id LIMIT 500`,
      name: "query_500", // Creation of prepared statements
    };

    bench
      .add(
        "pg-native (brianc/node-postgres)",
        async () => {
          const results = await pgNativeQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "pg (brianc/node-postgres)",
        async () => {
          const results = await pgVanillaQuery(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "postgres (porsager/postgres)",
        async () => {
          const results = await sqlPrepared`SELECT * FROM benchmark_rows ORDER BY id LIMIT 500`;
          return consume(results);
        }
      );
    return bench;
  }
];

// Run the benchmark and print results
try {
  console.log(
    `nodejs ${process.version}, CPU: ${os.cpus()?.[0]?.model ?? 'unknown'} Cores: ${os.cpus()?.length ?? 'unknown'}, RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`
  );
  for (const benchmark of benchmarks) {
    console.log('\n');
    if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
    const bench = benchmark();
    await bench.run();
    console.log(bench.name);
    const table = bench.table();

    const fastest = table.reduce((best, row) => {
      const avg = Number((row?.["Latency avg (ns)"] as string)?.split(" ")[0]);
      return !best || avg < Number(best.avg)
        ? { name: row?.["Task name"], avg }
        : best;
    }, null as null | { name: string; avg: number });

    console.table(table);

    console.log(`🏆 Winner: ${fastest?.name} (${(fastest?.avg as number)?.toFixed(0)} ns)`);
  }
} catch (err) {
  console.error('Benchmark run failed:', err);
  process.exit(1);
} finally {
  await Promise.all([pgNative.end(), pgVanilla.end(), sqlPrepared.end()]);
  process.exit(0);
}
