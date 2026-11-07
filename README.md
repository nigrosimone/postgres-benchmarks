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
| `Outright wins` | In how many groups it won **statistically** (lower median in all 6 execution orders) |

Two details make the aggregate honest:

- Medians are normalized **per group** before being combined. Without that, the `LIMIT 500` groups
  (~5 ms) would swamp `LIMIT 1` (~0.2 ms) in any average and the ranking would silently degenerate
  into "who is fastest on large result sets"
- The per-group ratios are combined with a **geometric** mean, not an arithmetic one. Averaging
  normalized numbers arithmetically is not meaningful: it yields a different ordering depending on
  which client happened to be the baseline, while the geometric mean is invariant to that choice

`Fastest median` and `Outright wins` are kept separate on purpose. A client can lead the median in
a group while the gap is not consistent across execution orders - a `3/3` versus `0/3` split says exactly
that, instead of hiding it behind a single score.

### Measurement budget

Two floors, overridable as environment variables. A group runs until it has spent the time **and**
executed the queries, so whichever is reached last decides the sample count. `BENCH_TIME_MS` is split
across the 6 execution orders, `BENCH_QUERIES` applies to each order:

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

### Dependency override

`pg` pins `pg-types` to the exact version `2.2.0`, released in **August 2019**. This benchmark
overrides it to `4.x`:

```json
{ "overrides": { "pg-types": "^4.1.0" } }
```

**Why.** `postgres` (porsager/postgres) ships its own type parsers and keeps them current, so it is
not held back by a 2019 dependency. Leaving `pg` on `pg-types@2.2.0` would measure the age of a
pinned transitive dependency rather than the library itself. The concrete case is integer parsing:
`pg-types@2` uses `parseInt(value, 10)`, `pg-types@4` uses `Number` — measured in isolation over 20M
conversions, `parseInt(value, 10)` takes 747 ms against 184 ms, roughly **4x slower**. End to end on
`LIMIT 500` the override is worth about **15%**.

The upstream situation is [brianc/node-postgres#2547](https://github.com/brianc/node-postgres/issues/2547):
the upgrade is wanted but blocked on breaking changes in date handling, unrelated to integers.

**What this means when reading the numbers**, stated plainly:

- This is **not** what `npm install pg` gives you today. Out of the box `pg` resolves
  `pg-types@2.2.0` and is correspondingly slower than the figures reported here
- The override benefits **both** `pg` and `pg-native`: they `require('pg-types')` and share a single
  module instance. It is not a `pg`-only advantage
- The override changes value semantics for two types, **neither of which appears in this benchmark's
  schema**, so it cannot affect the measurements here:

  | Type | `pg-types@2` | `pg-types@4` |
  | --- | --- | --- |
  | `TIMESTAMP WITHOUT TIME ZONE` | parsed in the system timezone | parsed as UTC |
  | `DATE` | `Date` object | `string` |

  If you adopt this override in your own application, check those two first. `TIMESTAMPTZ` is
  identical between the versions.

### Fair benchmark

- All libraries execute queries using prepared statements (see [Prepared statement](https://en.wikipedia.org/wiki/Prepared_statement))
- All libraries run the exact same query text with the `LIMIT` as a SQL literal (no bound parameters) and consume the results through the same code path
- The garbage collector is exposed and triggered before **both** the warmup **and** the measured run of each task, so every measurement starts from a clean heap and a GC pause during warmup cannot leak into the measured run (see [tinybench](https://www.npmjs.com/package/tinybench))
- Each query size is measured under **all 6 execution orders** (every permutation of the 3 clients) and the raw samples are pooled per client, so the execution order is fully removed as a confounder - no library benefits from systematically running first (cold cache/JIT) or last (warmed shared state). The time budget is divided across the permutations, keeping the wall-clock close to a single run
- The winner is ranked by **median** latency (p50) and is only crowned when its median is lower than every rival's in **all 6 execution orders** (a sign test over 6 independent replicates, p = 1/64 per rival); otherwise the run is reported as having no clear winner. A confidence interval over the pooled samples is not used for this: consecutive samples are correlated, so it comes out far too narrow
- Queries are warmed up before measurements
- PostgreSQL is accessed through a Unix domain socket to reduce TCP overhead
- Node.js and PostgreSQL are pinned to separate CPUs (`cpuset` in `docker-compose.yml`, so 4 CPUs are needed). Without it the scheduler sometimes puts both on the same CPU and the latency jumps between two modes, e.g. 4 ms and 6 ms per pipelined `LIMIT 500` batch, so the median changed from run to run
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

On GitHub Actions: every push and pull request runs the benchmark with Docker Compose on 3 runners in parallel,
and `aggregate.ts` combines the runs. The result is in the job summary, on `master` the CI also writes it in the
section below.

On Ubuntu/Debian:

```shell
apt-get install libpq-dev g++ python3 make
npm install
npm run bench
```

> `pg-native` needs `libpq` >= 1.11.0 built against PostgreSQL 14+ client libraries, otherwise pipeline mode is unavailable.

### Output

Last run on `master`, written by the CI. GitHub assigns the CPU of each runner at random and the ranking
between the clients depends on it, so the benchmark runs on 3 runners and the ranking below combines them.
The full output of each run is in the collapsed sections.

<!-- benchmark:start -->
```shell
3 runs, each on its own GitHub-hosted runner

Overall relative latency of each run
┌─────────┬─────┬───────────────────────────────────────────────────────────┬───────────┬─────────┬──────────┐
│ (index) │ Run │ CPU                                                       │ pg-native │ pg      │ postgres │
├─────────┼─────┼───────────────────────────────────────────────────────────┼───────────┼─────────┼──────────┤
│ 0       │ 1   │ 'Intel(R) Xeon(R) 6973P-C (4 cores)'                      │ '1.433'   │ '1.366' │ '1.000'  │
│ 1       │ 2   │ 'Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores)' │ '1.429'   │ '1.457' │ '1.004'  │
│ 2       │ 3   │ 'AMD EPYC 7763 64-Core Processor (4 cores)'               │ '1.510'   │ '1.417' │ '1.000'  │
└─────────┴─────┴───────────────────────────────────────────────────────────┴───────────┴─────────┴──────────┘

=== Final ranking over all runs ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '9/9'          │ '9/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.543'          │ '+54.3%'         │ '0/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.559'          │ '+55.9%'         │ '0/9'          │ '0/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.002'          │ '-'              │ '8/9'          │ '6/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.293'          │ '+29.0%'         │ '1/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.361'          │ '+35.7%'         │ '0/9'          │ '0/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (18 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.001'          │ '-'              │ '17/18'        │ '15/18'       │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.413'          │ '+41.1%'         │ '1/18'         │ '0/18'        │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.457'          │ '+45.5%'         │ '0/18'         │ '0/18'        │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

<details>
<summary>Run 1: Intel(R) Xeon(R) 6973P-C</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.3",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.0"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.13.0, CPU: Intel(R) Xeon(R) 6973P-C Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '75823 ± 0.25%'  │ '74506'          │ 13189                  │ 13189     │ 118702  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '78881 ± 0.32%'  │ '78243'          │ 12677                  │ 12677     │ 114098  │
│ 2       │ 'postgres (porsager/postgres)'     │ '68800 ± 0.30%'  │ '64680'          │ 14535                  │ 14535     │ 130816  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (64680 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '143651 ± 0.26%' │ '141068'         │ 6961                   │ 6961      │ 62655   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '141964 ± 0.28%' │ '136039'         │ 7044                   │ 7044      │ 63399   │
│ 2       │ 'postgres (porsager/postgres)'     │ '98575 ± 0.26%'  │ '94534'          │ 10145                  │ 10145     │ 91304   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (94534 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '376702 ± 0.19%' │ '366792'         │ 2655                   │ 2655      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '353257 ± 0.26%' │ '340044'         │ 2831                   │ 2831      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '184080 ± 0.26%' │ '176019'         │ 5432                   │ 5432      │ 48896   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (176019 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '308024 ± 0.45%' │ '301479'         │ 3247                   │ 32465     │ 29223   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '280458 ± 0.79%' │ '268488'         │ 3566                   │ 35656     │ 32093   │
│ 2       │ 'postgres (porsager/postgres)'     │ '274413 ± 0.34%' │ '264692'         │ 3644                   │ 36441     │ 32801   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (264692 ns); lowest mean: postgres (porsager/postgres) (274413 ns)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '623987 ± 0.34%' │ '591406'         │ 1603                   │ 16026     │ 14427   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '684612 ± 1.87%' │ '545136'         │ 1461                   │ 14607     │ 13148   │
│ 2       │ 'postgres (porsager/postgres)'     │ '509141 ± 0.30%' │ '492631'         │ 1964                   │ 19641     │ 17680   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (492631 ns); lowest mean: postgres (porsager/postgres) (509141 ns)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '2458351 ± 0.23%' │ '2387465'        │ 407                    │ 4068      │ 3665    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '2971041 ± 2.11%' │ '2322070'        │ 337                    │ 3366      │ 3080    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1404191 ± 0.33%' │ '1351907'        │ 712                    │ 7122      │ 6412    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (1351907 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.498'          │ '+49.8%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.530'          │ '+53.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '1/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.245'          │ '+24.5%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.342'          │ '+34.2%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '6/6'          │ '4/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.366'          │ '+36.6%'         │ '0/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.433'          │ '+43.3%'         │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>

<details>
<summary>Run 2: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.3",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.0"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.13.0, CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '81222 ± 0.34%'  │ '76893'          │ 12312                  │ 12312     │ 110812  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '85809 ± 0.31%'  │ '81098'          │ 11654                  │ 11654     │ 104886  │
│ 2       │ 'postgres (porsager/postgres)'     │ '69859 ± 0.35%'  │ '65875'          │ 14314                  │ 14314     │ 128833  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (65875 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '187706 ± 0.31%' │ '179249'         │ 5327                   │ 5327      │ 47949   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '201335 ± 0.32%' │ '191623'         │ 4967                   │ 4967      │ 44704   │
│ 2       │ 'postgres (porsager/postgres)'     │ '123945 ± 0.34%' │ '117136'         │ 8068                   │ 8068      │ 72616   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (117136 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '543395 ± 0.15%' │ '533267'         │ 1840                   │ 1840      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '523897 ± 0.19%' │ '509498'         │ 1909                   │ 1909      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '266486 ± 0.35%' │ '259396'         │ 3753                   │ 3753      │ 33775   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (259396 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '402781 ± 0.57%' │ '389900'         │ 2483                   │ 24827     │ 22348   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '371711 ± 1.12%' │ '351831'         │ 2690                   │ 26903     │ 24216   │
│ 2       │ 'postgres (porsager/postgres)'     │ '370870 ± 0.39%' │ '359678'         │ 2696                   │ 26964     │ 24271   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (351831 ns); lowest mean: postgres (porsager/postgres) (370870 ns)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '932758 ± 0.46%'  │ '898414'         │ 1072                   │ 10721     │ 9652    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1219953 ± 2.68%' │ '945041'         │ 820                    │ 8197      │ 7381    │
│ 2       │ 'postgres (porsager/postgres)'     │ '735280 ± 0.37%'  │ '715047'         │ 1360                   │ 13600     │ 12243   │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (715047 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3699153 ± 0.33%' │ '3615909'        │ 270                    │ 2703      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '5094417 ± 2.27%' │ '3987420'        │ 196                    │ 1963      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '2205088 ± 0.38%' │ '2175352'        │ 453                    │ 4535      │ 4084    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (2175352 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg-native (brianc/node-postgres)' │ '1.543'          │ '+54.3%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.582'          │ '+58.2%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.007'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg-native (brianc/node-postgres)' │ '1.323'          │ '+31.3%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.343'          │ '+33.3%'         │ '1/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.004'          │ '-'              │ '5/6'          │ '5/6'         │
│ 1       │ '🥈' │ 'pg-native (brianc/node-postgres)' │ '1.429'          │ '+42.3%'         │ '0/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.457'          │ '+45.2%'         │ '1/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>

<details>
<summary>Run 3: AMD EPYC 7763 64-Core Processor</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.3",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.0"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.13.0, CPU: AMD EPYC 7763 64-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '125047 ± 0.17%' │ '120065'         │ 7997                   │ 7997      │ 71977   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '128911 ± 0.24%' │ '122931'         │ 7757                   │ 7757      │ 69819   │
│ 2       │ 'postgres (porsager/postgres)'     │ '105931 ± 0.21%' │ '100729'         │ 9440                   │ 9440      │ 84964   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (100729 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '248822 ± 0.18%' │ '239209'         │ 4019                   │ 4019      │ 36173   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '246955 ± 0.24%' │ '236904'         │ 4049                   │ 4049      │ 36446   │
│ 2       │ 'postgres (porsager/postgres)'     │ '163939 ± 0.23%' │ '155271'         │ 6100                   │ 6100      │ 54901   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (155271 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '634068 ± 0.08%' │ '628791'         │ 1577                   │ 1577      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '567834 ± 0.15%' │ '557786'         │ 1761                   │ 1761      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '289576 ± 0.20%' │ '278563'         │ 3453                   │ 3453      │ 31090   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (278563 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '570118 ± 0.53%' │ '553178'         │ 1754                   │ 17540     │ 15792   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '502048 ± 1.05%' │ '475322'         │ 1992                   │ 19918     │ 17929   │
│ 2       │ 'postgres (porsager/postgres)'     │ '487836 ± 0.34%' │ '473228'         │ 2050                   │ 20499     │ 18453   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (473228 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1085209 ± 0.32%' │ '1053948'        │ 921                    │ 9215      │ 8297    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1195132 ± 2.20%' │ '967936'         │ 837                    │ 8367      │ 7537    │
│ 2       │ 'postgres (porsager/postgres)'     │ '830532 ± 0.28%'  │ '815781'         │ 1204                   │ 12040     │ 10840   │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (815781 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '4139795 ± 0.21%' │ '4087476'        │ 242                    │ 2416      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '4827868 ± 1.96%' │ '3927332'        │ 207                    │ 2071      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '2190170 ± 0.33%' │ '2157820'        │ 457                    │ 4566      │ 4113    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (2157820 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.551'          │ '+55.1%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.606'          │ '+60.6%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.294'          │ '+29.4%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.420'          │ '+42.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '6/6'          │ '6/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.417'          │ '+41.7%'         │ '0/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.510'          │ '+51.0%'         │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>
<!-- benchmark:end -->
