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

On GitHub Actions: every push and pull request runs the benchmark with Docker Compose, the output is in the job summary.
On `master` the CI also writes the output in the section below.

On Ubuntu/Debian:

```shell
apt-get install libpq-dev g++ python3 make
npm install
npm run bench
```

> `pg-native` needs `libpq` >= 1.11.0 built against PostgreSQL 14+ client libraries, otherwise pipeline mode is unavailable.

### Output

Last run on `master`, written by the CI on a GitHub-hosted runner:

<!-- benchmark:start -->
```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.1",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "3.4.9"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.11.1, CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '98905 ± 0.19%'  │ '87329'          │ 10111                  │ 10111     │ 91000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '104772 ± 0.20%' │ '92192'          │ 9545                   │ 9545      │ 85905   │
│ 2       │ 'postgres (porsager/postgres)'     │ '100399 ± 0.37%' │ '87242'          │ 9960                   │ 9960      │ 89646   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (87242 ns); lowest mean: pg-native (brianc/node-postgres) (98905 ns)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '199564 ± 0.20%' │ '184343'         │ 5011                   │ 5011      │ 45101   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '213900 ± 0.15%' │ '200998'         │ 4675                   │ 4675      │ 42079   │
│ 2       │ 'postgres (porsager/postgres)'     │ '222280 ± 1.02%' │ '195581'         │ 4499                   │ 4499      │ 40492   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg-native (brianc/node-postgres) (184343 ns); lowest mean: pg-native (brianc/node-postgres) (199564 ns)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '575663 ± 0.13%' │ '545121'         │ 1737                   │ 1737      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '553999 ± 0.17%' │ '521957'         │ 1805                   │ 1805      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '629924 ± 0.94%' │ '534405'         │ 1587                   │ 1587      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (521957 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '454022 ± 0.48%' │ '404173'         │ 2203                   │ 22025     │ 19827   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '375858 ± 0.41%' │ '346490'         │ 2661                   │ 26606     │ 23948   │
│ 2       │ 'postgres (porsager/postgres)'     │ '436999 ± 0.56%' │ '376556'         │ 2288                   │ 22883     │ 20599   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (346490 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '999970 ± 0.46%'  │ '918866'         │ 1000                   │ 10000     │ 9003    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1033315 ± 0.51%' │ '954914'         │ 968                    │ 9678      │ 8713    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1310536 ± 1.40%' │ '1017000'        │ 763                    │ 7630      │ 6871    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (918866 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3870645 ± 0.61%' │ '3590343'        │ 258                    │ 2584      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '5073450 ± 0.82%' │ '6039850'        │ 197                    │ 1971      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '5520174 ± 1.40%' │ '4514202'        │ 181                    │ 1812      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (3590343 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.015'          │ '-'              │ '1/3'          │ '0/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.028'          │ '+1.3%'          │ '1/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.048'          │ '+3.3%'          │ '1/3'          │ '1/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.053'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.148'          │ '+9.0%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.205'          │ '+14.4%'         │ '1/3'          │ '1/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.034'          │ '-'              │ '3/6'          │ '2/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.086'          │ '+5.1%'          │ '1/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.124'          │ '+8.7%'          │ '2/6'          │ '2/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```
<!-- benchmark:end -->
