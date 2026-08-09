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

### Two suites

Every query size is measured twice, under two different workloads:

| Suite | Workload | Connections | What it isolates |
| --- | --- | --- | --- |
| **Sequential** | one query at a time, `await`ed | pool of `PGMAX` | Per-query client overhead. Nothing is ever in flight concurrently, so pipeline mode cannot batch anything |
| **Pipelined** | 10 queries issued at once with `Promise.all` | exactly 1 | [PostgreSQL pipeline mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html): how well a client keeps several requests in flight on one connection instead of paying a round trip per query |

Pipelining only happens when several queries are in flight on the **same** connection, so the
pipelined suite deliberately drives a single connection - a pool would spread the batch across
`PGMAX` connections and no pipelining would occur. The three clients are on equal terms even though
the spelling differs: `pg`/`pg-native` expose a single-connection `Client` (`max` is a `pg-pool`
option and is not passed there), while `postgres` is always pool-backed, so `max: 1` is its way of
expressing the same thing.

In the pipelined suite one iteration resolves 10 queries, so the latency columns are **per batch**;
the `Queries/s` column is the one to compare against the sequential suite.

### Fair benchmark

- All libraries execute queries using prepared statements (see [Prepared statement](https://en.wikipedia.org/wiki/Prepared_statement))
- All libraries run the exact same query text with the `LIMIT` as a SQL literal (no bound parameters) and consume the results through the same code path
- The garbage collector is exposed and triggered before **both** the warmup **and** the measured run of each task, so every measurement starts from a clean heap and a GC pause during warmup cannot leak into the measured run (see [tinybench](https://www.npmjs.com/package/tinybench))
- Each query size is measured under **all 6 execution orders** (every permutation of the 3 clients) and the raw samples are pooled per client, so the execution order is fully removed as a confounder - no library benefits from systematically running first (cold cache/JIT) or last (warmed shared state). The per-run time budget is divided across the permutations, keeping the total sample count and wall-clock close to a single run
- The winner is ranked by **median** latency (p50) and is only crowned when its confidence interval of the mean does not overlap any rival's; otherwise the run is reported as having no clear winner
- Queries are warmed up before measurements
- PostgreSQL is accessed through a Unix domain socket to reduce TCP overhead
- All libraries run with [PostgreSQL pipeline mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html) enabled. `postgres` (porsager/postgres) has always pipelined internally; since `pg` 8.23.0 and `pg-native` 3.9.0 the same is available through the `pipeline: true` client option, so the previous asymmetry is gone and all three are compared on equal terms
- Both suites use the same time budget per permutation. Since one pipelined iteration resolves 10 queries, the pipelined suite runs proportionally fewer iterations so that both suites converge on a comparable number of executed queries
- Because pipeline mode always uses the extended query protocol, every statement is sent individually (multi-statement scripts are rejected by the server in this mode)
- Prepared statements are primed with a single query before each pipelined group: `pg-native` does not deduplicate `PREPARE` within one batch, so 10 queries sharing a statement name would each send a prepare and the server would reject the duplicates. `pg` tracks in-flight names itself and `postgres` manages its own prepared statements

The database contains a pre-populated table with 500 rows.
Benchmark queries only read existing rows using `LIMIT 1`, `LIMIT 100` and `LIMIT 500`, eg.:

```sql
SELECT * FROM benchmark_rows ORDER BY id LIMIT 1
```

The data preparation of `benchmark_rows` (each statement is executed separately):

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

> `pg-native` needs `libpq` >= 1.11.0 built against PostgreSQL 14+ client libraries, otherwise pipeline mode is unavailable.

### Output

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.1.2",
  "pg": "8.23.0",
  "pg-native": "3.9.0",
  "libpq": "1.11.0",
  "postgres": "3.4.9"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
nodejs v26.7.0, CPU: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz Cores: 8, RAM: 7.57 GB

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '234240 ± 1.26%' │ '188495'         │ 4269                   │ 4269      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '221947 ± 0.56%' │ '176792'         │ 4506                   │ 4506      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '237827 ± 0.64%' │ '191020'         │ 4205                   │ 4205      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (176792 ns median)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '445485 ± 0.65%' │ '369168'         │ 2245                   │ 2245      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '443584 ± 0.79%' │ '364100'         │ 2254                   │ 2254      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '481203 ± 1.08%' │ '375468'         │ 2078                   │ 2078      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner within margin of error - lowest median: pg (brianc/node-postgres) (364100 ns); lowest mean: pg (brianc/node-postgres) (443584 ns)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1059439 ± 0.57%' │ '885552'         │ 944                    │ 944       │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1021520 ± 0.55%' │ '846467'         │ 979                    │ 979       │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '1025036 ± 1.01%' │ '779280'         │ 976                    │ 976       │ 30000   │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner within margin of error - lowest median: postgres (porsager/postgres) (779280 ns); lowest mean: pg (brianc/node-postgres) (1021520 ns)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1081116 ± 0.73%' │ '998028'         │ 925                    │ 9250      │ 4626    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '799790 ± 1.08%'  │ '711268'         │ 1250                   │ 12503     │ 6253    │
│ 2       │ 'postgres (porsager/postgres)'     │ '998599 ± 0.82%'  │ '926196'         │ 1001                   │ 10014     │ 5008    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (711268 ns median)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1547193 ± 1.12%' │ '1344645'        │ 646                    │ 6463      │ 3293    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1890358 ± 2.33%' │ '1509816'        │ 529                    │ 5290      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1790178 ± 2.82%' │ '1375067'        │ 559                    │ 5586      │ 3011    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (1344645 ns median)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '5923205 ± 1.26%' │ '5413999'        │ 169                    │ 1688      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '9375773 ± 2.07%' │ '7360166'        │ 107                    │ 1067      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '6597675 ± 1.71%' │ '5381310'        │ 152                    │ 1516      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner within margin of error - lowest median: postgres (porsager/postgres) (5381310 ns); lowest mean: pg-native (brianc/node-postgres) (5923205 ns)
```
