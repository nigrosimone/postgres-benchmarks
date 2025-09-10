import { run, bench, summary, do_not_optimize } from "mitata";
import pg, { type QueryConfig, type PoolConfig } from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);
console.log(`Poll size: ${process.env.PGMAX}`);
const { dependencies } = JSON.parse(readFileSync("package.json", "utf-8"));
delete dependencies["mitata"];
console.log(`Dependencies versions:`);
console.log(JSON.stringify(dependencies, null, 2));

const { native } = pg;

if (!native) {
  console.error(
    "pg-native is not available. Please install pg-native."
  );
  process.exit(1);
}

if (!process.env.PGHOST) {
  console.error("PGHOST environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGPORT) {
  console.error("PGPORT environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGDATABASE) {
  console.error("PGDATABASE environment variable is not set.");
  process.exit(1);
} if (!process.env.PGUSER) {
  console.error("PGUSER environment variable is not set.");
  process.exit(1);
} if (!process.env.PGPASSWORD) {
  console.error("PGPASSWORD environment variable is not set.");
  process.exit(1);
}
if (!process.env.PGMAX) {
  console.error("PGMAX environment variable is not set.");
  process.exit(1);
}

const pgConfig: PoolConfig  = {
  max: +process.env.PGMAX,
  host: process.env.PGHOST,
  port: +process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

const pgNative = new native.Pool(pgConfig);

const pgVanilla = new pg.Pool(pgConfig);

const sqlPrepared = postgres({
  max: +process.env.PGMAX,
  host: process.env.PGHOST,
  port: +process.env.PGPORT,
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
      $5::bool as boolean`,
  name: "pg", // Creation of prepared statements
  values: [1337, "wat", dateNow.toISOString(), null, false],
};

summary(() => {
  bench(
    "pg-native (brianc/node-postgres)",
    async () => {
      const results = await pgNative.query(pgQuery);
      return do_not_optimize(results.rows);
    }
  ).gc('inner');

  bench(
    "pg (brianc/node-postgres)",
    async () => {
      const results = await pgVanilla.query(pgQuery);
      return do_not_optimize(results.rows);
    }
  ).gc('inner');

  bench(
    "postgres (porsager/postgres)",
    async () => {
      const results = await sqlPrepared`select 
      ${1337} as int, 
      ${"wat"} as string, 
      ${dateNow} as timestamp, 
      ${null} as null, 
      ${false} as boolean`;
      return do_not_optimize(results);
    }
  ).gc('inner');
});

await run({
  format: "mitata",
  colors: true,
  throw: true,
});

await Promise.all([pgNative.end(), pgVanilla.end(), sqlPrepared.end()]);
