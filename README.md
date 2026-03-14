# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

A benchmark focusing on the performance of Postgres client libraries for Node.js, [brianc/node-postgres](https://github.com/brianc/node-postgres) VS [porsager/postgres](https://github.com/porsager/postgres)

Dependencies:

- [pg (brianc/node-postgres)](https://www.npmjs.com/package/pg)
- [pg-native (brianc/node-postgres)](https://www.npmjs.com/package/pg-native)
- [postgres (porsager/postgres)](https://www.npmjs.com/package/postgres)

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
Running benchmarks... 
GC is exposed
Pool size: 10
Dependencies versions:
{
  "tinybench": "6.0.0",
  "pg": "8.16.3",
  "pg-native": "3.5.2",
  "postgres": "3.4.8"
}
Database connectivity verified through: socket at /var/run/postgresql
nodejs v24.14.0, CPU: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz Cores: 8, RAM: 7.57 GB

generate_series(1)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤                       
│ 0       │ 'pg-native (brianc/node-postgres)' │ '178287 ± 1.38%' │ '138244 ± 11894' │ '6541 ± 0.30%'         │ '7234 ± 653'           │ 28045   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '196987 ± 0.98%' │ '146793 ± 19609' │ '6112 ± 0.38%'         │ '6812 ± 971'           │ 25384   │
│ 2       │ 'postgres (porsager/postgres)'     │ '202836 ± 1.26%' │ '151819 ± 18300' │ '5914 ± 0.36%'         │ '6587 ± 839'           │ 24651   │                       
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘                  

generate_series(100)
┌─────────┬────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │                       
├─────────┼────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤                       
│ 0       │ 'pg-native (brianc/node-postgres)' │ '430447 ± 0.89%' │ '366078 ± 52281' │ '2591 ± 0.46%'         │ '2732 ± 423'           │ 11616   │
│ 1       │ 'pg (brianc/node-postgres)'        │ '634141 ± 1.74%' │ '503069 ± 85739' │ '1905 ± 0.71%'         │ '1988 ± 339'           │ 7885    │
│ 2       │ 'postgres (porsager/postgres)'     │ '655778 ± 3.26%' │ '441047 ± 74191' │ '2057 ± 0.76%'         │ '2267 ± 430'           │ 7626    │
└─────────┴────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘                 

generate_series(500)                                                                                                                                                     
┌─────────┬────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                          │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤                    
│ 0       │ 'pg-native (brianc/node-postgres)' │ '1340793 ± 0.60%' │ '1272283 ± 66604'  │ '763 ± 0.33%'          │ '786 ± 41'             │ 5000    │
│ 1       │ 'pg (brianc/node-postgres)'        │ '1856803 ± 2.13%' │ '1383915 ± 237849' │ '667 ± 0.90%'          │ '723 ± 136'            │ 5000    │
│ 2       │ 'postgres (porsager/postgres)'     │ '2181725 ± 2.67%' │ '1628821 ± 487709' │ '599 ± 1.09%'          │ '614 ± 212'            │ 5000    │                    
└─────────┴────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```
