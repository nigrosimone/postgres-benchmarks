# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

A benchmark focusing on the client-side overhead/performance of Postgres client libraries for Node.js, [brianc/node-postgres](https://github.com/brianc/node-postgres) VS [porsager/postgres](https://github.com/porsager/postgres)

Dependencies:

- [pg (brianc/node-postgres)](https://www.npmjs.com/package/pg)
- [pg-native (brianc/node-postgres)](https://www.npmjs.com/package/pg-native)
- [postgres (porsager/postgres)](https://www.npmjs.com/package/postgres)

The benchmark measures:

- PostgreSQL client overhead
- protocol parsing
- type conversion
- result consumption

### Fair benchmark

- All libraries execute queries using prepared statements (see [Prepared statement](https://en.wikipedia.org/wiki/Prepared_statement))
- All libraries run the exact same query text with the `LIMIT` as a SQL literal (no bound parameters) and consume the results through the same code path
- The garbage collector is exposed and triggered before **both** the warmup **and** the measured run of each task, so every measurement starts from a clean heap and a GC pause during warmup cannot leak into the measured run (see [tinybench](https://www.npmjs.com/package/tinybench))
- Each query size is measured under **all 6 execution orders** (every permutation of the 3 clients) and the raw samples are pooled per client, so the execution order is fully removed as a confounder - no library benefits from systematically running first (cold cache/JIT) or last (warmed shared state). The per-run time budget is divided across the permutations, keeping the total sample count and wall-clock close to a single run
- The winner is ranked by **median** latency (p50) and is only crowned when its confidence interval of the mean does not overlap any rival's; otherwise the run is reported as having no clear winner
- Queries are warmed up before measurements
- PostgreSQL is accessed through a Unix domain socket to reduce TCP overhead
- `postgres` (porsager/postgres) supports [PostgreSQL pipeline mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html) and uses it internally for query execution, `pg` (brianc/node-postgres) does [not currently support PostgreSQL pipeline mode](https://github.com/brianc/node-postgres/pull/3652). This benchmark executes one query at a time (no concurrent query batching), so pipeline mode benefits are expected to be limited.

The database contains a pre-populated table with 500 rows.
Benchmark queries only read existing rows using `LIMIT 1`, `LIMIT 100` and `LIMIT 500`, eg.:

```sql
SELECT * FROM benchmark_rows ORDER BY id LIMIT 1
```

The data preparation of `benchmark_rows`:

```sql
CREATE TABLE IF NOT EXISTS benchmark_rows (
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
  FROM generate_series(1, 500) i;
```

### Run benchmark

On Docker:

```shell
docker-compose build
docker-compose up
```

On Ubuntu/Debian:

```shell
apt-get install libpq-dev g++ python3 make
npm install
npm run bench
```

### Output

```shell
Running benchmarks...
GC is exposed
Pool size: 10                                                                                                                                               
Dependencies versions:                                                                                                                                      
{                                                                                                                                                           
  "tinybench": "6.0.2",                                                                                                                                     
  "pg": "8.22.0",                                                                                                                                           
  "pg-native": "3.8.0",                                                                                                                                     
  "postgres": "3.4.9"
}                                                                                                                                                           
Database connectivity verified through: socket at /var/run/postgresql
nodejs v24.18.0, CPU: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz Cores: 8, RAM: 7.57 GB


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '245014 ± 0.67%' │ '206295'         │ 4081                   │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '329153 ± 1.24%' │ '233539'         │ 3038                   │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '272314 ± 0.76%' │ '225388'         │ 3672                   │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (206295 ns median)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '379889 ± 0.51%' │ '343703'         │ 2632                   │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '424718 ± 0.59%' │ '366348'         │ 2355                   │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '415342 ± 1.09%' │ '357673'         │ 2408                   │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (343703 ns median)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '885226 ± 0.35%' │ '818698'         │ 1130                   │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '914526 ± 0.60%' │ '786653'         │ 1093                   │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '888801 ± 1.11%' │ '767221'         │ 1125                   │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴─────────┘
🤝 No clear winner within margin of error - lowest median: postgres (porsager/postgres) (767221 ns); lowest mean: pg-native (brianc/node-postgres) (885226 ns)
```
