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
- The garbage collector is exposed and triggered before the warmup of each task (see [tinybench](https://www.npmjs.com/package/tinybench))
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
nodejs v24.17.0, CPU: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz Cores: 8, RAM: 7.57 GB


query_1
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '170025 ± 0.33%' │ '151966 ± 13269' │ '6190 ± 0.21%'         │ '6580 ± 565'           │ 29409   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '175322 ± 0.68%' │ '154998 ± 14917' │ '6054 ± 0.22%'         │ '6452 ± 659'           │ 28519   │
│ 2       │ 'postgres (porsager/postgres)'     │ '182294 ± 0.39%' │ '165044 ± 13104' │ '5759 ± 0.21%'         │ '6059 ± 502'           │ 27429   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (170025 ns)


query_100
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'pg-native (brianc/node-postgres)' │ '297440 ± 0.41%' │ '276694 ± 49001' │ '3556 ± 0.32%'         │ '3614 ± 619'           │ 16811   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '319378 ± 0.45%' │ '294503 ± 41614' │ '3318 ± 0.33%'         │ '3396 ± 507'           │ 15656   │
│ 2       │ 'postgres (porsager/postgres)'     │ '331280 ± 1.51%' │ '298656 ± 40856' │ '3244 ± 0.31%'         │ '3348 ± 471'           │ 15094   │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘          
🏆 Winner: pg-native (brianc/node-postgres) (297440 ns)
                                                                                                                                                            
                                                                                                                                                            
query_500                                                                                                                                                   
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │          
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤          
│ 0       │ 'pg-native (brianc/node-postgres)' │ '751811 ± 0.44%' │ '716823 ± 57885' │ '1362 ± 0.33%'         │ '1395 ± 115'           │ 6651    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '781252 ± 0.94%' │ '699956 ± 51644' │ '1353 ± 0.44%'         │ '1429 ± 110'           │ 6400    │          
│ 2       │ 'postgres (porsager/postgres)'     │ '832508 ± 2.72%' │ '698038 ± 65930' │ '1362 ± 0.50%'         │ '1433 ± 141'           │ 6006    │          
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘
🏆 Winner: pg-native (brianc/node-postgres) (751811 ns)
```
