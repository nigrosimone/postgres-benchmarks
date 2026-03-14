import { Bench, type BenchOptions } from "tinybench";
import pg, { type QueryConfig, type PoolConfig } from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import os from "node:os";

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

const pgVanilla = new pg.Pool(pgConfig);

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
    pgNative.query("SELECT 1"),
    pgVanilla.query("SELECT 1"),
    sqlPrepared`SELECT 1`,
  ]);
  console.log("Database connectivity verified through: " + (socketPath ? `socket at ${socketPath}` : `host ${process.env.PGHOST}:${process.env.PGPORT}`));
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

const consume = (rows: any) => {
  const len = rows.length;
  const results = new Array(len);
  for (let i = 0; i < len; i++) {
    results[i] = rows[i].int;
  }
  (globalThis as any).__do_not_optimize = results;
  return (globalThis as any).__do_not_optimize;
}

const benchOption: BenchOptions = {
  iterations: 5_000,
  warmupTime: 1000,
  time: 5000,
  setup: (_task, mode) => {
    // Run the garbage collector before warmup at each cycle
    if (mode === 'warmup' && typeof globalThis.gc === 'function') {
      globalThis.gc()
    }
  },
}

const benchmarks: Array<() => Bench> = [
  () => {
    const bench = new Bench({
      ...benchOption,
      name: 'select 1'
    });

    const pgQuery: QueryConfig = {
      text: `select 1`,
      name: "simple", // Creation of prepared statements
    };

    bench
      .add(
        "pg-native (brianc/node-postgres)",
        async () => {
          const results = await pgNative.query(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "pg (brianc/node-postgres)",
        async () => {
          const results = await pgVanilla.query(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "postgres (porsager/postgres)",
        async () => {
          const results = await sqlPrepared`select 1`;
          return consume(results);
        }
      );
    return bench;
  },
  () => {
    const bench = new Bench({
      ...benchOption,
      name: 'generate_series(500)'
    });

    const dateNow = new Date();

    const pgQuery: QueryConfig = {
      text: `select
      $1::int as int,
      $2 as string,
      $3::timestamp with time zone as timestamp,
      $4 as null,
      $5::bool as boolean
      FROM generate_series(1,500)`,
      name: "generate_series", // Creation of prepared statements
      values: [1337, "wat", dateNow, null, false],
    };

    bench
      .add(
        "pg-native (brianc/node-postgres)",
        async () => {
          const results = await pgNative.query(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "pg (brianc/node-postgres)",
        async () => {
          const results = await pgVanilla.query(pgQuery);
          return consume(results.rows);
        }
      )
      .add(
        "postgres (porsager/postgres)",
        async () => {
          const results = await sqlPrepared`select 
            ${1337}::int as int, 
            ${"wat"} as string, 
            ${dateNow}::timestamp with time zone as timestamp, 
            ${null} as null, 
            ${false}::bool as boolean
            FROM generate_series(1,500)`;
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
    console.log('\n\n');
    if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
    const bench = benchmark();
    await bench.run();
    console.log(bench.name);
    console.table(bench.table());
  }
} catch (err) {
  console.error('Benchmark run failed:', err);
  process.exit(1);
} finally {
  await Promise.all([pgNative.end(), pgVanilla.end(), sqlPrepared.end()]);
}