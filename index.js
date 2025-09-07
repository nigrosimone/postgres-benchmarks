import { run, bench, summary } from "mitata";
import pg from "pg";
import postgres from "postgres";
import { readFileSync } from "node:fs";

console.log("Running benchmarks...", process.argv.slice(2).join(" "));
console.log(
  typeof global.gc === "function" ? "GC is exposed" : "GC is NOT exposed"
);
console.log(`Poll size: ${process.env.PGMAX}`);
const { dependencies } = JSON.parse(readFileSync("package.json"));
delete dependencies["mitata"];
console.log(`Dependencies versions:`);
console.log(JSON.stringify(dependencies, null, 2));

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

const pgQuery = {
  text: `select
      $1::int as int,
      $2 as string,
      $3::timestamp with time zone as timestamp,
      $4 as null,
      $5::bool as boolean`,
  name: "pg",
  values: [1337, "wat", dateNow.toISOString(), null, false],
};

summary(() => {

  bench("brianc/node-postgres (pg-native)", () => pgNative.query(pgQuery), {
    gc: "inner",
  });

  bench("brianc/node-postgres (pg)", () => pgVanilla.query(pgQuery), {
    gc: "inner",
  });

  bench(
    "porsager/postgres (postgres)",
    () =>
      sqlPrepared`select ${1337} as int, ${"wat"} as string, ${dateNow} as timestamp, ${null} as null, ${false} as boolean`,
    { gc: "inner" }
  );

});

await run({
  format: "mitata",
  colors: true,
  throw: true,
});

await Promise.all([pgNative.end(), pgVanilla.end(), sqlPrepared.end()]);
