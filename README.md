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

### Final ranking

Each suite, and the run as a whole, ends with a ranking table:

| Column | Meaning |
| --- | --- |
| `Relative latency` | Geometric mean of the client's median latency, normalized to the fastest client **of each group**. `1.000` = fastest everywhere, `1.100` = 10% slower than the group leader on average |
| `Slower than best` | Distance from the first place |
| `Fastest median` | In how many groups it had the lowest median |
| `Outright wins` | In how many groups it won **statistically** (non-overlapping confidence intervals) |

Two details make the aggregate honest:

- Medians are normalized **per group** before being combined. Without that, the `LIMIT 500` groups
  (~5 ms) would swamp `LIMIT 1` (~0.2 ms) in any average and the ranking would silently degenerate
  into "who is fastest on large result sets"
- The per-group ratios are combined with a **geometric** mean, not an arithmetic one. Averaging
  normalized numbers arithmetically is not meaningful: it yields a different ordering depending on
  which client happened to be the baseline, while the geometric mean is invariant to that choice

`Fastest median` and `Outright wins` are kept separate on purpose. A client can lead the median in
a group while the gap is still inside the margin of error - a `3/3` versus `0/3` split says exactly
that, instead of hiding it behind a single score.

### Measurement budget

Two floors, overridable as environment variables. A group runs until it has spent the time **and**
executed the queries, so whichever is reached last decides the sample count:

| Variable | Default | Binds on |
| --- | --- | --- |
| `BENCH_TIME_MS` | `9000` | The **cheap** groups (small results, pipelined batches). Their samples are short, so buying more costs little wall clock - and these are the groups with the worst margin of error, because per-sample overhead weighs more |
| `BENCH_QUERIES` | `5000` | The **expensive** groups (`LIMIT 500`). Their samples are long and already stable, reaching a low margin of error with far fewer of them |

Letting the two floors bind on different groups is what keeps the run affordable: a single flat
budget would either starve the noisy groups or overpay for the stable ones. With the defaults a full
run takes roughly 5 minutes. The margin of error shrinks with the **square root** of the sample
count, so doubling a budget tightens the confidence interval by only ~29% while doubling the wall
clock. For a quicker iteration loop:

```shell
BENCH_TIME_MS=3000 BENCH_QUERIES=2000 npm run bench
```

### Fair benchmark

- All libraries execute queries using prepared statements (see [Prepared statement](https://en.wikipedia.org/wiki/Prepared_statement))
- All libraries run the exact same query text with the `LIMIT` as a SQL literal (no bound parameters) and consume the results through the same code path
- The garbage collector is exposed and triggered before **both** the warmup **and** the measured run of each task, so every measurement starts from a clean heap and a GC pause during warmup cannot leak into the measured run (see [tinybench](https://www.npmjs.com/package/tinybench))
- Each query size is measured under **all 6 execution orders** (every permutation of the 3 clients) and the raw samples are pooled per client, so the execution order is fully removed as a confounder - no library benefits from systematically running first (cold cache/JIT) or last (warmed shared state). The per-run time budget is divided across the permutations, keeping the total sample count and wall-clock close to a single run
- The winner is ranked by **median** latency (p50) and is only crowned when its confidence interval of the mean does not overlap any rival's; otherwise the run is reported as having no clear winner
- Queries are warmed up before measurements
- PostgreSQL is accessed through a Unix domain socket to reduce TCP overhead
- All libraries run with [PostgreSQL pipeline mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html) enabled. `postgres` (porsager/postgres) has always pipelined internally; since `pg` 8.23.0 and `pg-native` 3.9.0 the same is available through the `pipeline: true` client option, so the previous asymmetry is gone and all three are compared on equal terms
- Both budgets are expressed in **executed queries**, not iterations, so the two suites are constrained homogeneously despite one pipelined iteration resolving 10 queries
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
Budget per query size: >=5000 queries and >=9000 ms per client, split across 6 execution orders

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '238103 ± 0.84%' │ '189768'         │ 4200                   │ 4200      │ 37810   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '261855 ± 0.58%' │ '211794'         │ 3819                   │ 3819      │ 34621   │
│ 2       │ 'postgres (porsager/postgres)'     │ '245731 ± 0.53%' │ '200735'         │ 4069                   │ 4069      │ 36629   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (189768 ns median)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '372289 ± 0.39%' │ '334818'         │ 2686                   │ 2686      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '433308 ± 0.66%' │ '380885'         │ 2308                   │ 2308      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '407465 ± 0.90%' │ '349749'         │ 2454                   │ 2454      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (334818 ns median)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '871606 ± 0.48%' │ '752088'         │ 1147                   │ 1147      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '956741 ± 0.48%' │ '823598'         │ 1045                   │ 1045      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '898594 ± 0.95%' │ '727102'         │ 1113                   │ 1113      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner within margin of error - lowest median: postgres (porsager/postgres) (727102 ns); lowest mean: pg-native (brianc/node-postgres) (871606 ns)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1128847 ± 0.61%' │ '1047394'        │ 886                    │ 8859      │ 7978    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '899156 ± 0.75%'  │ '858457'         │ 1112                   │ 11122     │ 10013   │
│ 2       │ 'postgres (porsager/postgres)'     │ '948114 ± 0.62%'  │ '869955'         │ 1055                   │ 10547     │ 9496    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (858457 ns median)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1528574 ± 0.70%' │ '1373839'        │ 654                    │ 6542      │ 5890    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1885112 ± 1.78%' │ '1558949'        │ 530                    │ 5305      │ 4781    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1807984 ± 1.85%' │ '1489315'        │ 553                    │ 5531      │ 4983    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (1373839 ns median)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '5759368 ± 1.28%' │ '5155121'        │ 174                    │ 1736      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '7493718 ± 1.53%' │ '6550337'        │ 133                    │ 1334      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '7225546 ± 1.71%' │ '6109565'        │ 138                    │ 1384      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (5155121 ns median)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.011'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.034'          │ '+2.2%'          │ '1/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.129'          │ '+11.6%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.069'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.092'          │ '+2.2%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.130'          │ '+5.7%'          │ '1/3'          │ '1/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.040'          │ '-'              │ '4/6'          │ '4/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.062'          │ '+2.2%'          │ '1/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.129'          │ '+8.6%'          │ '1/6'          │ '1/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```
