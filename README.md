# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

A benchmark focusing on the performance of Postgres client libraries for Node.js, [brianc/node-postgres](https://github.com/brianc/node-postgres) VS [porsager/postgres](https://github.com/porsager/postgres)

Dependencies:

- [pg (brianc/node-postgres)](https://www.npmjs.com/package/pg)
- [pg-native (brianc/node-postgres)](https://www.npmjs.com/package/pg-native)
- [postgres (porsager/postgres)](https://www.npmjs.com/package/postgres)

TL;DR: pg-native wins

### Fair benchmark

- All libraries execute queries using prepared statements (see [Prepared statement](https://en.wikipedia.org/wiki/Prepared_statement))
- The garbage collector is exposed and triggered after each library benchmark (see [tinybench](https://www.npmjs.com/package/tinybench))

The query:

```sql
SELECT
  $1::int as int,
  $2 as string,
  $3::timestamp with time zone as timestamp,
  $4 as null,
  $5::bool as boolean
FROM generate_series(1,1000)
```

The values:

```js
[1337, "wat", new Date(), null, false]
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
Running benchmarks... --iterations=50000
GC is exposed
Poll size: 10
Dependencies versions:
{
  "pg": "^8.16.3",
  "pg-native": "^3.5.2",
  "postgres": "^3.4.7"
}
Database connectivity verified
postgres-benchmarks
┌─────────┬────────────────────────────────────┬──────────────────┬───────────────────┬────────────────────────┬────────────────────────┬─────────┐       
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns)  │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │       
├─────────┼────────────────────────────────────┼──────────────────┼───────────────────┼────────────────────────┼────────────────────────┼─────────┤       
│ 0       │ 'pg-native (brianc/node-postgres)' │ '163888 ± 1.12%' │ '138761 ± 9641.0' │ '6636 ± 0.54%'         │ '7207 ± 527'           │ 6105    │       
│ 1       │ 'pg (brianc/node-postgres)'        │ '175969 ± 1.12%' │ '150657 ± 15239'  │ '6185 ± 0.57%'         │ '6638 ± 689'           │ 5683    │       
│ 2       │ 'postgres (porsager/postgres)'     │ '177100 ± 2.05%' │ '149178 ± 9532.0' │ '6202 ± 0.53%'         │ '6703 ± 438'           │ 5650    │       
└─────────┴────────────────────────────────────┴──────────────────┴───────────────────┴────────────────────────┴────────────────────────┴─────────┘
```
