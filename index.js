import { run, bench, summary } from "mitata";
import pg from "pg";
import postgres from "postgres";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);

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

const sql = postgres({
  max: process.env.PGMAX,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

try {
  await pgNative.query("SELECT 1");
  await pgVanilla.query("SELECT 1");
  await sql`SELECT 1`;
  console.log("Database connectivity verified");
} catch (error) {
  console.error("Database connectivity test failed:", error);
  process.exit(1);
}

summary(() => {
  bench("brianc/node-postgres (pg-native)", () =>
    pgNative.query({ text: `select 1 as x`, name: "foo" })
  );

  if (global.gc) global.gc();

  bench("brianc/node-postgres (pg)", () =>
    pgVanilla.query({ text: `select 1 as x`, name: "foo" })
  );

  if (global.gc) global.gc();

  bench("porsager/postgres (postgres)", () => sql`select 1 as x`); // has auto prepared statements!

  if (global.gc) global.gc();

  bench("porsager/postgres (unsafe)", () =>
    sql.unsafe(`select 1 as x`, { prepare: true })
  );
});

await run({
  format: "mitata",
  colors: true,
  throw: true,
});

await pgNative.end();
await pgVanilla.end();
await sql.end();
