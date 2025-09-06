import { run, bench, summary } from "mitata";
import pg from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);
const pkDeps = JSON.parse(readFileSync("package.json")).dependencies;
delete pkDeps["mitata"];
console.log(pkDeps);

const { native } = pg;

const pgNative = new native.Pool({
  max: process.env.PGMAX,
  hostname: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const pgVanilla = new pg.Pool({
  max: process.env.PGMAX,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const sqlPrepared = postgres({
  max: process.env.PGMAX,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  prepare: true,
});

try {
  await pgNative.query("SELECT 1");
  await pgVanilla.query("SELECT 1");
  await sqlPrepared`SELECT 1`;

  console.log("Database connectivity verified");
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

summary(() => {

  if (global.gc) global.gc();

  bench("brianc/node-postgres (pg-native)", () =>
    pgNative.query({ text: `select 1 as x`, name: "pg-native" })
  );

  if (global.gc) global.gc();

  bench("brianc/node-postgres (pg)", () =>
    pgVanilla.query({ text: `select 1 as x`, name: "pg" })
  );

  if (global.gc) global.gc();

  bench("porsager/postgres (postgres)", () => sqlPrepared`select 1 as x`);

  if (global.gc) global.gc();

});

await run({
  format: "mitata",
  colors: true,
  throw: true,
});

await Promise.all([
  pgNative.end(), 
  pgVanilla.end(), 
  sqlPrepared.end()
]);
