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
┌─────────┬─────┬─────────────────────────────────────────────┬───────────┬─────────┬──────────┐
│ (index) │ Run │ CPU                                         │ pg-native │ pg      │ postgres │
├─────────┼─────┼─────────────────────────────────────────────┼───────────┼─────────┼──────────┤
│ 0       │ 1   │ 'Intel(R) Xeon(R) 6975P-C (4 cores)'        │ '1.604'   │ '1.532' │ '1.007'  │
│ 1       │ 2   │ 'AMD EPYC 7763 64-Core Processor (4 cores)' │ '1.500'   │ '1.420' │ '1.000'  │
│ 2       │ 3   │ 'AMD EPYC 9V74 80-Core Processor (4 cores)' │ '1.549'   │ '1.434' │ '1.000'  │
└─────────┴─────┴─────────────────────────────────────────────┴───────────┴─────────┴──────────┘

=== Final ranking over all runs ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '9/9'          │ '8/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.590'          │ '+59.0%'         │ '0/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.628'          │ '+62.8%'         │ '0/9'          │ '0/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.005'          │ '-'              │ '7/9'          │ '7/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.343'          │ '+33.7%'         │ '2/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.477'          │ '+47.0%'         │ '0/9'          │ '0/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (18 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.002'          │ '-'              │ '16/18'        │ '15/18'       │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.461'          │ '+45.8%'         │ '2/18'         │ '0/18'        │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.551'          │ '+54.7%'         │ '0/18'         │ '0/18'        │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

<details>
<summary>Run 1: Intel(R) Xeon(R) 6975P-C</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.4",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.1"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.7
nodejs v26.13.1, CPU: Intel(R) Xeon(R) 6975P-C Cores: 4, RAM: 15.33 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '40195 ± 0.36%'  │ '33972'          │ 24879                  │ 24879     │ 223911  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '40833 ± 0.36%'  │ '34766'          │ 24490                  │ 24490     │ 220415  │
│ 2       │ 'postgres (porsager/postgres)'     │ '33696 ± 0.34%'  │ '26622'          │ 29677                  │ 29677     │ 267098  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (26622 ns); lowest mean: postgres (porsager/postgres) (33696 ns)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '110918 ± 0.20%' │ '112609'         │ 9016                   │ 9016      │ 81144   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '111867 ± 0.28%' │ '114018'         │ 8939                   │ 8939      │ 80456   │
│ 2       │ 'postgres (porsager/postgres)'     │ '69055 ± 0.28%'  │ '63539'          │ 14481                  │ 14481     │ 130335  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (63539 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '356925 ± 0.16%' │ '351355'         │ 2802                   │ 2802      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '340007 ± 0.23%' │ '333984'         │ 2941                   │ 2941      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '179276 ± 0.24%' │ '174030'         │ 5578                   │ 5578      │ 50205   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (174030 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '215075 ± 0.39%' │ '209360'         │ 4650                   │ 46495     │ 41849   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '178127 ± 0.42%' │ '163336'         │ 5614                   │ 56140     │ 50529   │
│ 2       │ 'postgres (porsager/postgres)'     │ '175079 ± 0.29%' │ '170180'         │ 5712                   │ 57117     │ 51409   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (163336 ns); lowest mean: postgres (porsager/postgres) (175079 ns)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '663121 ± 0.36%' │ '614343'         │ 1508                   │ 15080     │ 13576   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '594711 ± 0.32%' │ '562148'         │ 1681                   │ 16815     │ 15137   │
│ 2       │ 'postgres (porsager/postgres)'     │ '434581 ± 0.31%' │ '407878'         │ 2301                   │ 23011     │ 20712   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (407878 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '2731470 ± 0.41%' │ '2483993'        │ 366                    │ 3661      │ 3307    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '2861175 ± 0.61%' │ '2678118'        │ 350                    │ 3495      │ 3178    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1325822 ± 0.32%' │ '1284433'        │ 754                    │ 7542      │ 6790    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (1284433 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.651'          │ '+65.1%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.659'          │ '+65.9%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.014'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.422'          │ '+40.2%'         │ '1/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.551'          │ '+53.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.007'          │ '-'              │ '5/6'          │ '4/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.532'          │ '+52.1%'         │ '1/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.604'          │ '+59.3%'         │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>

<details>
<summary>Run 2: AMD EPYC 7763 64-Core Processor</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.4",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.1"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.7
nodejs v26.13.1, CPU: AMD EPYC 7763 64-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '121906 ± 0.16%' │ '117940'         │ 8203                   │ 8203      │ 73830   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '128695 ± 0.30%' │ '124020'         │ 7770                   │ 7770      │ 69936   │
│ 2       │ 'postgres (porsager/postgres)'     │ '106459 ± 0.30%' │ '100917'         │ 9393                   │ 9393      │ 84543   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (100917 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '235255 ± 0.21%' │ '226471'         │ 4251                   │ 4251      │ 38258   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '237100 ± 0.26%' │ '225459'         │ 4218                   │ 4218      │ 37962   │
│ 2       │ 'postgres (porsager/postgres)'     │ '156356 ± 0.21%' │ '149309'         │ 6396                   │ 6396      │ 57563   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (149309 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '617403 ± 0.11%' │ '608832'         │ 1620                   │ 1620      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '559761 ± 0.16%' │ '547869'         │ 1786                   │ 1786      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '284947 ± 0.20%' │ '272367'         │ 3509                   │ 3509      │ 31588   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (272367 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '557516 ± 0.48%' │ '542620'         │ 1794                   │ 17937     │ 16147   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '497646 ± 1.01%' │ '468362'         │ 2009                   │ 20095     │ 18087   │
│ 2       │ 'postgres (porsager/postgres)'     │ '476106 ± 0.31%' │ '463853'         │ 2100                   │ 21004     │ 18907   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (463853 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1076221 ± 0.35%' │ '1040596'        │ 929                    │ 9292      │ 8365    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1183208 ± 2.16%' │ '961018'         │ 845                    │ 8452      │ 7610    │
│ 2       │ 'postgres (porsager/postgres)'     │ '820996 ± 0.28%'  │ '804397'         │ 1218                   │ 12180     │ 10966   │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (804397 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '4085788 ± 0.15%' │ '4041240'        │ 245                    │ 2448      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '4744708 ± 1.96%' │ '3869270'        │ 211                    │ 2108      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '2185809 ± 0.44%' │ '2126949'        │ 457                    │ 4575      │ 4120    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (2126949 ns median, faster in all 6 execution orders)


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
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.582'          │ '+58.2%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.300'          │ '+30.0%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.422'          │ '+42.2%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '6/6'          │ '6/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.420'          │ '+42.0%'         │ '0/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.500'          │ '+50.0%'         │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>

<details>
<summary>Run 3: AMD EPYC 9V74 80-Core Processor</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.4",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "4.1.1"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.7
nodejs v26.13.1, CPU: AMD EPYC 9V74 80-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '66889 ± 0.26%'  │ '63133'          │ 14950                  │ 14950     │ 134554  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '69476 ± 0.29%'  │ '65507'          │ 14393                  │ 14393     │ 129544  │
│ 2       │ 'postgres (porsager/postgres)'     │ '58422 ± 0.35%'  │ '54630'          │ 17117                  │ 17117     │ 154054  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (54630 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '151576 ± 0.25%' │ '146036'         │ 6597                   │ 6597      │ 59380   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '147740 ± 0.31%' │ '141068'         │ 6769                   │ 6769      │ 60922   │
│ 2       │ 'postgres (porsager/postgres)'     │ '94757 ± 0.26%'  │ '89222'          │ 10553                  │ 10553     │ 94984   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (89222 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '438042 ± 0.16%' │ '430345'         │ 2283                   │ 2283      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '386836 ± 0.24%' │ '374573'         │ 2585                   │ 2585      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '191360 ± 0.28%' │ '183551'         │ 5226                   │ 5226      │ 47034   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (183551 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '350150 ± 0.50%' │ '340283'         │ 2856                   │ 28559     │ 25706   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '320113 ± 1.00%' │ '301405'         │ 3124                   │ 31239     │ 28118   │
│ 2       │ 'postgres (porsager/postgres)'     │ '314173 ± 0.36%' │ '301676'         │ 3183                   │ 31830     │ 28651   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (301405 ns); lowest mean: postgres (porsager/postgres) (314173 ns)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '768042 ± 0.34%' │ '741635'         │ 1302                   │ 13020     │ 11721   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '855898 ± 2.40%' │ '652503'         │ 1168                   │ 11684     │ 10531   │
│ 2       │ 'postgres (porsager/postgres)'     │ '553367 ± 0.32%' │ '540588'         │ 1807                   │ 18071     │ 16267   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (540588 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3044581 ± 0.22%' │ '2998566'        │ 328                    │ 3285      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '3581228 ± 2.40%' │ '2777639'        │ 279                    │ 2792      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1514817 ± 0.27%' │ '1489569'        │ 660                    │ 6601      │ 5944    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (1489569 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.570'          │ '+57.0%'         │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.643'          │ '+64.3%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.311'          │ '+31.0%'         │ '1/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.461'          │ '+46.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '5/6'          │ '5/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.434'          │ '+43.4%'         │ '1/6'          │ '0/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.549'          │ '+54.9%'         │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>
<!-- benchmark:end -->
