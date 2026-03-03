import { Bench } from "tinybench";
import pg, { type QueryConfig, type PoolConfig } from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);
console.log(`Poll size: ${process.env.PGMAX}`);
const { packages } = JSON.parse(readFileSync("package-lock.json", "utf-8"));

console.log(`Dependencies versions:`);
console.log(JSON.stringify({
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

const pgConfig: PoolConfig = {
  max: +process.env.PGMAX,
  host: socketPath ?? process.env.PGHOST,
  port: +(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

const pgNative = new native.Pool(pgConfig);

const pgVanilla = new pg.Pool(pgConfig);

const sqlPrepared = postgres({
  max: +process.env.PGMAX,
  host: socketPath ?? process.env.PGHOST,
  port: +(process.env.PGPORT ?? 5432),
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
  console.log("Database connectivity verified");
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

const dateNow = new Date();

const pgQuery: QueryConfig = {
  text: `select
      $1::int as int,
      $2 as string,
      $3::timestamp with time zone as timestamp,
      $4 as null,
      $5::bool as boolean
      FROM generate_series(1,1000)`,
  name: "pg", // Creation of prepared statements
  values: [1337, "wat", dateNow, null, false],
};

const consume = (rows: any) => {
  const len = rows.length;
  const results = new Array(len);
  for (let i = 0; i < len; i++) {
    results[i] = rows[i].int;
  }
  (globalThis as any).__do_not_optimize = results;
  return (globalThis as any).__do_not_optimize;
}

const bench = new Bench({
  name: 'postgres-benchmarks',
  setup: (_task, mode) => {
    // Run the garbage collector before warmup at each cycle
    if (mode === 'warmup' && typeof globalThis.gc === 'function') {
      globalThis.gc()
    }
  },
});

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
      ${1337} as int, 
      ${"wat"} as string, 
      ${dateNow} as timestamp, 
      ${null} as null, 
      ${false} as boolean
      FROM generate_series(1,1000)`;
      return consume(results);
    }
  );

// Run the benchmark and print results
try {
  if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
  await bench.run();
  console.log(bench.name);
  console.table(bench.table());
} catch (err) {
  console.error('Benchmark run failed:', err);
  process.exit(1);
} finally {
  await Promise.all([pgNative.end(), pgVanilla.end(), sqlPrepared.end()]);
}