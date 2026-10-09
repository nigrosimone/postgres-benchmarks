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
│ 0       │ 1   │ 'AMD EPYC 7763 64-Core Processor (4 cores)'               │ '1.082'   │ '1.017' │ '1.031'  │
│ 1       │ 2   │ 'Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores)' │ '1.032'   │ '1.048' │ '1.071'  │
│ 2       │ 3   │ 'AMD EPYC 9V74 80-Core Processor (4 cores)'               │ '1.102'   │ '1.013' │ '1.015'  │
└─────────┴─────┴───────────────────────────────────────────────────────────┴───────────┴─────────┴──────────┘

=== Final ranking over all runs ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.014'          │ '-'              │ '6/9'          │ '4/9'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.035'          │ '+2.0%'          │ '2/9'          │ '2/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.059'          │ '+4.5%'          │ '1/9'          │ '1/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (9 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.017'          │ '-'              │ '7/9'          │ '6/9'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.065'          │ '+4.7%'          │ '0/9'          │ '0/9'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.084'          │ '+6.6%'          │ '2/9'          │ '2/9'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (18 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.026'          │ '-'              │ '9/18'         │ '8/18'        │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.039'          │ '+1.3%'          │ '6/18'         │ '4/18'        │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.072'          │ '+4.5%'          │ '3/18'         │ '3/18'        │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

<details>
<summary>Run 1: AMD EPYC 7763 64-Core Processor</summary>

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
nodejs v26.11.1, CPU: AMD EPYC 7763 64-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '126973 ± 0.14%' │ '123110'         │ 7876                   │ 7876      │ 70883   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '130378 ± 0.20%' │ '125584'         │ 7670                   │ 7670      │ 69033   │
│ 2       │ 'postgres (porsager/postgres)'     │ '123531 ± 0.44%' │ '116958'         │ 8095                   │ 8095      │ 72860   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (116958 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '242711 ± 0.16%' │ '233355'         │ 4120                   │ 4120      │ 37084   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '243455 ± 0.22%' │ '234988'         │ 4108                   │ 4108      │ 36971   │
│ 2       │ 'postgres (porsager/postgres)'     │ '256222 ± 1.53%' │ '227475'         │ 3903                   │ 3903      │ 35128   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (227475 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '632617 ± 0.08%' │ '627741'         │ 1581                   │ 1581      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '573882 ± 0.15%' │ '563512'         │ 1743                   │ 1743      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '675822 ± 1.31%' │ '581215'         │ 1480                   │ 1480      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (563512 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '569164 ± 0.56%' │ '551990'         │ 1757                   │ 17570     │ 15817   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '489073 ± 1.10%' │ '457934'         │ 2045                   │ 20447     │ 18404   │
│ 2       │ 'postgres (porsager/postgres)'     │ '502003 ± 0.67%' │ '480045'         │ 1992                   │ 19920     │ 17931   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (457934 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1090952 ± 0.34%' │ '1061070'        │ 917                    │ 9166      │ 8254    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1018776 ± 0.45%' │ '976862'         │ 982                    │ 9816      │ 8838    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1281025 ± 2.17%' │ '1028849'        │ 781                    │ 7806      │ 7030    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (976862 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '4073387 ± 0.21%' │ '4021262'        │ 245                    │ 2455      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '4065889 ± 0.53%' │ '3954247'        │ 246                    │ 2459      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '5104422 ± 1.93%' │ '4160111'        │ 196                    │ 1959      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (3954247 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.010'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.035'          │ '+2.5%'          │ '1/3'          │ '1/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.064'          │ '+5.3%'          │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.000'          │ '-'              │ '3/3'          │ '3/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.051'          │ '+5.1%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.100'          │ '+10.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.017'          │ '-'              │ '4/6'          │ '4/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.031'          │ '+1.3%'          │ '2/6'          │ '2/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.082'          │ '+6.3%'          │ '0/6'          │ '0/6'         │
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
│ 0       │ 'pg-native (brianc/node-postgres)' │ '80852 ± 0.25%'  │ '75991'          │ 12368                  │ 12368     │ 111318  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '84607 ± 0.34%'  │ '79249'          │ 11819                  │ 11819     │ 106377  │
│ 2       │ 'postgres (porsager/postgres)'     │ '81576 ± 0.69%'  │ '74581'          │ 12258                  │ 12258     │ 110329  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (74581 ns median, faster in all 6 execution orders)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '190966 ± 0.47%' │ '177606'         │ 5237                   │ 5237      │ 47131   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '200567 ± 0.37%' │ '189459'         │ 4986                   │ 4986      │ 44875   │
│ 2       │ 'postgres (porsager/postgres)'     │ '223915 ± 1.92%' │ '187420'         │ 4466                   │ 4466      │ 40196   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (177606 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '553226 ± 0.20%' │ '541231'         │ 1808                   │ 1808      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '532728 ± 0.22%' │ '518833'         │ 1877                   │ 1877      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '663433 ± 1.66%' │ '539118'         │ 1507                   │ 1507      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (518833 ns median, faster in all 6 execution orders)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '398918 ± 0.58%' │ '387363'         │ 2507                   │ 25068     │ 22564   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '359320 ± 1.09%' │ '340748'         │ 2783                   │ 27830     │ 25050   │
│ 2       │ 'postgres (porsager/postgres)'     │ '387216 ± 0.93%' │ '365203'         │ 2583                   │ 25825     │ 23246   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (340748 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '935166 ± 0.48%'  │ '890151'         │ 1069                   │ 10693     │ 9627    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1208377 ± 2.62%' │ '939550'         │ 828                    │ 8276      │ 7462    │
│ 2       │ 'postgres (porsager/postgres)'     │ '1269531 ± 2.45%' │ '995931'         │ 788                    │ 7877      │ 7092    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (890151 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3689376 ± 0.35%' │ '3605150'        │ 271                    │ 2710      │ 3000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '5122739 ± 2.19%' │ '3984822'        │ 195                    │ 1952      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '5335359 ± 2.25%' │ '4149193'        │ 187                    │ 1874      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (3605150 ns median, faster in all 6 execution orders)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.021'          │ '-'              │ '1/3'          │ '1/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.031'          │ '+1.0%'          │ '1/3'          │ '1/3'         │
│ 2       │ '🥉' │ 'pg (brianc/node-postgres)'        │ '1.043'          │ '+2.2%'          │ '1/3'          │ '1/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.044'          │ '-'              │ '2/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.053'          │ '+0.9%'          │ '1/3'          │ '1/3'         │
│ 2       │ '🥉' │ 'postgres (porsager/postgres)'     │ '1.113'          │ '+6.7%'          │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg-native (brianc/node-postgres)' │ '1.032'          │ '-'              │ '3/6'          │ '3/6'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.048'          │ '+1.5%'          │ '2/6'          │ '2/6'         │
│ 2       │ '🥉' │ 'postgres (porsager/postgres)'     │ '1.071'          │ '+3.8%'          │ '1/6'          │ '1/6'         │
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
nodejs v26.11.1, CPU: AMD EPYC 9V74 80-Core Processor Cores: 4, RAM: 15.61 GB
Budget per query size and client: >=9000 ms split across 6 execution orders, >=5000 queries in each order

=== Sequential: one query at a time, pool of 10 connections ===


query_1 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '72228 ± 0.32%'  │ '67711'          │ 13845                  │ 13845     │ 124608  │
│ 1       │ 'pg (brianc/node-postgres)'        │ '71522 ± 0.30%'  │ '67361'          │ 13982                  │ 13982     │ 125839  │
│ 2       │ 'postgres (porsager/postgres)'     │ '70170 ± 0.57%'  │ '64587'          │ 14251                  │ 14251     │ 128262  │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (64587 ns); lowest mean: postgres (porsager/postgres) (70170 ns)


query_100 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '153653 ± 0.15%' │ '148393'         │ 6508                   │ 6508      │ 58576   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '145232 ± 0.24%' │ '139510'         │ 6886                   │ 6886      │ 61973   │
│ 2       │ 'postgres (porsager/postgres)'     │ '163233 ± 1.97%' │ '135884'         │ 6126                   │ 6126      │ 55138   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: postgres (porsager/postgres) (135884 ns median, faster in all 6 execution orders)


query_500 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '428373 ± 0.14%' │ '420874'         │ 2334                   │ 2334      │ 30000   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '379045 ± 0.19%' │ '369997'         │ 2638                   │ 2638      │ 30000   │
│ 2       │ 'postgres (porsager/postgres)'     │ '471640 ± 2.09%' │ '366942'         │ 2120                   │ 2120      │ 30000   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: postgres (porsager/postgres) (366942 ns); lowest mean: pg (brianc/node-postgres) (379045 ns)

=== Pipelined: 10 concurrent queries on a single connection ===


query_1_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '348181 ± 0.51%' │ '337979'         │ 2872                   │ 28721     │ 25853   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '316212 ± 1.02%' │ '297708'         │ 3162                   │ 31624     │ 28465   │
│ 2       │ 'postgres (porsager/postgres)'     │ '329440 ± 0.83%' │ '309637'         │ 3035                   │ 30354     │ 27321   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (297708 ns median, faster in all 6 execution orders)


query_100_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '765328 ± 0.33%' │ '741456'         │ 1307                   │ 13066     │ 11763   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '858031 ± 2.54%' │ '652653'         │ 1165                   │ 11655     │ 10492   │
│ 2       │ 'postgres (porsager/postgres)'     │ '923026 ± 2.64%' │ '683128'         │ 1083                   │ 10834     │ 9763    │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🏆 Winner: pg (brianc/node-postgres) (652653 ns median, faster in all 6 execution orders)


query_500_pipelined_x10 (pooled over 6 execution orders)
┌─────────┬────────────────────────────────────┬───────────────────┬──────────────────┬────────────────────────┬───────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns) │ Throughput avg (ops/s) │ Queries/s │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼──────────────────┼────────────────────────┼───────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '3008004 ± 0.21%' │ '2964241'        │ 332                    │ 3324      │ 3004    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '3628238 ± 2.42%' │ '2796640'        │ 276                    │ 2756      │ 3000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '3845158 ± 2.78%' │ '2816089'        │ 260                    │ 2601      │ 3000    │
└─────────┴────────────────────────────────────┴───────────────────┴──────────────────┴────────────────────────┴───────────┴─────────┘
🤝 No clear winner, not faster in every execution order - lowest median: pg (brianc/node-postgres) (2796640 ns); lowest mean: pg-native (brianc/node-postgres) (3008004 ns)


=== Final ranking ===
Relative latency is the geometric mean of each client's median latency, normalized to the fastest
client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader
on average. "Outright wins" counts only the groups whose winner was statistically clear.

Sequential (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'postgres (porsager/postgres)'     │ '1.000'          │ '-'              │ '3/3'          │ '1/3'         │
│ 1       │ '🥈' │ 'pg (brianc/node-postgres)'        │ '1.026'          │ '+2.6%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.095'          │ '+9.5%'          │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Pipelined x10 (3 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.000'          │ '-'              │ '3/3'          │ '2/3'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.031'          │ '+3.1%'          │ '0/3'          │ '0/3'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.110'          │ '+11.0%'         │ '0/3'          │ '0/3'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘

Overall (6 groups)
┌─────────┬──────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────┬───────────────┐
│ (index) │      │ Task name                          │ Relative latency │ Slower than best │ Fastest median │ Outright wins │
├─────────┼──────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────┼───────────────┤
│ 0       │ '🥇' │ 'pg (brianc/node-postgres)'        │ '1.013'          │ '-'              │ '3/6'          │ '2/6'         │
│ 1       │ '🥈' │ 'postgres (porsager/postgres)'     │ '1.015'          │ '+0.3%'          │ '3/6'          │ '1/6'         │
│ 2       │ '🥉' │ 'pg-native (brianc/node-postgres)' │ '1.102'          │ '+8.8%'          │ '0/6'          │ '0/6'         │
└─────────┴──────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────┴───────────────┘
```

</details>
<!-- benchmark:end -->
