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
│ 0       │ 1   │ 'AMD EPYC 9V45 96-Core Processor (4 cores)' │ '1.031'   │ '1.024' │ '1.019'  │
│ 1       │ 2   │ 'AMD EPYC 9V74 80-Core Processor (4 cores)' │ '1.124'   │ '1.016' │ '1.024'  │
│ 2       │ 3   │ 'AMD EPYC 7763 64-Core Processor (4 cores)' │ '1.079'   │ '1.012' │ '1.026'  │
└─────────┴─────┴─────────────────────────────────────────────┴───────────┴─────────┴──────────┘

=== Final ranking over all runs ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.004'          │ '-'              │ '6/9'          │ '3/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.027'          │ '+2.3%'          │ '3/9'          │ '1/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.063'          │ '+5.9%'          │ '0/9'          │ '0/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.007'          │ '-'              │ '8/9'          │ '6/9'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.043'          │ '+3.5%'          │ '0/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.092'          │ '+8.4%'          │ '1/9'          │ '1/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (18 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.017'          │ '-'              │ '11/18'        │ '7/18'        │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.023'          │ '+0.6%'          │ '6/18'         │ '3/18'        │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.077'          │ '+5.9%'          │ '1/18'         │ '1/18'        │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

<details>
<summary>Run 1: AMD EPYC 9V45 96-Core Processor</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.2",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "3.4.9"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.12.0, CPU: AMD EPYC 9V45 96-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '48399 ± 0.32%'  │ '44716'          │ 20662                  │ 20662     │ 185958  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '49535 ± 0.32%'  │ '46149'          │ 20188                  │ 20188     │ 181693  │
│ 2       │ 'postgres (porsager/postgres)'     │ '47866 ± 0.39%'  │ '44496'          │ 20892                  │ 20892     │ 188029  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (44496 ns); lowest mean: postgres (porsager/postgres) (47866 ns)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '98834 ± 0.22%'  │ '93509'          │ 10118                  │ 10118     │ 91064   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '100196 ± 0.21%' │ '96224'          │ 9980                   │ 9980      │ 89828   │
│ 2       │ 'postgres (porsager/postgres)'     │ '113850 ± 1.96%' │ '92437'          │ 8783                   │ 8783      │ 79067   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (92437 ns); lowest mean: pg-native (brianc/node-postgres) (98834 ns)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '278276 ± 0.19%' │ '271414'         │ 3594                   │ 3594      │ 32345   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '270072 ± 0.27%' │ '259705'         │ 3703                   │ 3703      │ 33328   │
│ 2       │ 'postgres (porsager/postgres)'     │ '353008 ± 2.37%' │ '261568'         │ 2833                   │ 2833      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (259705 ns); lowest mean: pg (brianc/node-postgres) (270072 ns)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '260418 ± 0.42%' │ '253387'         │ 3840                   │ 38400     │ 34563   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '240213 ± 0.65%' │ '229891'         │ 4163                   │ 41630     │ 37470   │
│ 2       │ 'postgres (porsager/postgres)'     │ '259114 ± 0.85%' │ '241068'         │ 3859                   │ 38593     │ 34738   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (229891 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '504493 ± 0.36%' │ '480874'         │ 1982                   │ 19822     │ 17842   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '491464 ± 0.32%' │ '468026'         │ 2035                   │ 20347     │ 18315   │
│ 2       │ 'postgres (porsager/postgres)'     │ '669177 ± 2.49%' │ '472823'         │ 1494                   │ 14944     │ 13452   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (468026 ns); lowest mean: pg (brianc/node-postgres) (491464 ns)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1904284 ± 0.36%' │ '1859393'        │ 525                    │ 5251      │ 4730    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '2061883 ± 0.63%' │ '1985732'        │ 485                    │ 4850      │ 4367    │
│ 2       │ 'postgres (porsager/postgres)'     │ '2709988 ± 2.66%' │ '1952792'        │ 369                    │ 3690      │ 3329    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (1859393 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.002'          │ '-'              │ '2/3'          │ '0/3'         │
│ 1       │ '🥈' │ 'pg-native (brianc/node-postgres)' │ '1.020'          │ '+1.8%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.026'          │ '+2.3%'          │ '1/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.022'          │ '-'              │ '2/3'          │ '1/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.036'          │ '+1.4%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.042'          │ '+2.0%'          │ '1/3'          │ '1/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.019'          │ '-'              │ '2/6'          │ '0/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.024'          │ '+0.5%'          │ '3/6'          │ '1/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.031'          │ '+1.2%'          │ '1/6'          │ '1/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>

<details>
<summary>Run 2: AMD EPYC 9V74 80-Core Processor</summary>

```shell
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.2.2",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "3.4.9"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.12.0, CPU: AMD EPYC 9V74 80-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '91189 ± 0.18%'  │ '87492'          │ 10966                  │ 10966     │ 98699   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '90514 ± 0.25%'  │ '85929'          │ 11048                  │ 11048     │ 99435   │
│ 2       │ 'postgres (porsager/postgres)'     │ '87366 ± 0.58%'  │ '81213'          │ 11446                  │ 11446     │ 103017  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (81213 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '204475 ± 0.17%' │ '197428'         │ 4891                   │ 4891      │ 44018   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '194704 ± 0.23%' │ '187212'         │ 5136                   │ 5136      │ 46226   │
│ 2       │ 'postgres (porsager/postgres)'     │ '211847 ± 1.97%' │ '179882'         │ 4720                   │ 4720      │ 42486   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (179882 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '572034 ± 0.12%' │ '565884'         │ 1748                   │ 1748      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '494051 ± 0.17%' │ '484721'         │ 2024                   │ 2024      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '598942 ± 1.77%' │ '485442'         │ 1670                   │ 1670      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (484721 ns); lowest mean: pg (brianc/node-postgres) (494051 ns)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '455970 ± 0.61%' │ '438612'         │ 2193                   │ 21931     │ 19741   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '403271 ± 1.13%' │ '380865'         │ 2480                   │ 24797     │ 22321   │
│ 2       │ 'postgres (porsager/postgres)'     │ '421583 ± 0.74%' │ '399753'         │ 2372                   │ 23720     │ 21352   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (380865 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '999201 ± 0.31%'  │ '973368'         │ 1001                   │ 10008     │ 9011    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1075287 ± 2.40%' │ '847678'         │ 930                    │ 9300      │ 8374    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1144685 ± 2.42%' │ '886838'         │ 874                    │ 8736      │ 7875    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (847678 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3927823 ± 0.23%' │ '3863437'        │ 255                    │ 2546      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '4453332 ± 2.16%' │ '3492668'        │ 225                    │ 2246      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '4753162 ± 2.37%' │ '3653601'        │ 210                    │ 2104      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (3492668 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.033'          │ '+3.2%'          │ '1/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.113'          │ '+11.3%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.047'          │ '+4.7%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.135'          │ '+13.5%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.016'          │ '-'              │ '4/6'          │ '3/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.024'          │ '+0.7%'          │ '2/6'          │ '2/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.124'          │ '+10.6%'         │ '0/6'          │ '0/6'         │
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
  "tinybench": "6.2.2",
  "pg": "8.23.1",
  "pg-native": "3.9.1",
  "libpq": "1.11.0",
  "pg-types": "4.1.0",
  "postgres": "3.4.9"
}
Database connectivity verified through: socket at /var/run/postgresql
Pipeline mode: enabled for all clients
PostgreSQL server: 18.6
nodejs v26.12.0, CPU: AMD EPYC 7763 64-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '129438 ± 0.14%' │ '125354'         │ 7726                   │ 7726      │ 69534   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '132571 ± 0.21%' │ '128069'         │ 7543                   │ 7543      │ 67890   │
│ 2       │ 'postgres (porsager/postgres)'     │ '127800 ± 0.48%' │ '120916'         │ 7825                   │ 7825      │ 70425   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (120916 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '263250 ± 0.16%' │ '256159'         │ 3799                   │ 3799      │ 34191   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '262273 ± 0.15%' │ '254965'         │ 3813                   │ 3813      │ 34318   │
│ 2       │ 'postgres (porsager/postgres)'     │ '279869 ± 1.53%' │ '251860'         │ 3573                   │ 3573      │ 32160   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (251860 ns); lowest mean: pg (brianc/node-postgres) (262273 ns)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '658700 ± 0.08%' │ '651608'         │ 1518                   │ 1518      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '590764 ± 0.13%' │ '581397'         │ 1693                   │ 1693      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '698324 ± 1.38%' │ '596254'         │ 1432                   │ 1432      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (581397 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '583709 ± 0.60%' │ '565829'         │ 1713                   │ 17132     │ 15422   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '502701 ± 0.71%' │ '477786'         │ 1989                   │ 19893     │ 17906   │
│ 2       │ 'postgres (porsager/postgres)'     │ '513646 ± 0.71%' │ '491814'         │ 1947                   │ 19469     │ 17526   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (477786 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1125103 ± 0.37%' │ '1083279'        │ 889                    │ 8888      │ 8003    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1035731 ± 0.39%' │ '1000072'        │ 966                    │ 9655      │ 8693    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1282075 ± 2.19%' │ '1039647'        │ 780                    │ 7800      │ 7025    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (1000072 ns); lowest mean: pg (brianc/node-postgres) (1035731 ns)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '4199001 ± 0.24%' │ '4144297'        │ 238                    │ 2382      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '4086664 ± 0.49%' │ '3984230'        │ 245                    │ 2447      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '5230193 ± 2.05%' │ '4237665'        │ 191                    │ 1912      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (3984230 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.008'          │ '-'              │ '2/3'          │ '1/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.024'          │ '+1.5%'          │ '1/3'          │ '1/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.057'          │ '+4.8%'          │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.000'          │ '-'              │ '3/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.044'          │ '+4.4%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.101'          │ '+10.1%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.012'          │ '-'              │ '4/6'          │ '3/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.026'          │ '+1.4%'          │ '2/6'          │ '1/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.079'          │ '+6.6%'          │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>
<!-- benchmark:end -->
