# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

A benchmark focusing on the performance of Postgres client libraries for Node.js, [brianc/node-postgres](https://github.com/brianc/node-postgres) VS [porsager/postgres](https://github.com/porsager/postgres)

Dependencies:
- [pg](https://www.npmjs.com/package/pg)
- [pg-native](https://www.npmjs.com/package/pg-native)
- [postgres](https://www.npmjs.com/package/postgres)

Query:
```sql
select
  $1::int as int,
  $2 as string,
  $3::timestamp with time zone as timestamp,
  $4 as null,
  $5::bool as boolean
```
```js
[1337, "wat", new Date().toISOString(), null, false]
```

### Run benchmark

```shell
docker-compose build
docker-compose up
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
clk: ~3.06 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                       avg (min … max) p75 / p99    (min … top 1%)
----------------------------------------------- -------------------------------
brianc/node-postgres (pg-native) 161.73 µs/iter 159.26 µs   █
                          (113.45 µs … 1.01 ms) 391.13 µs   █
                        (  6.93 kb …   2.07 mb)  11.93 kb ▁▄█▆▃▂▂▂▂▂▁▁▁▁▁▁▁▁▁▁▁

brianc/node-postgres (pg)        183.02 µs/iter 197.19 µs  █
                          (129.61 µs … 1.77 ms) 402.29 µs  █▅▃
                        (  1.80 kb …   1.93 mb)  15.46 kb ▁███▆▅▅▄▃▃▂▂▂▂▁▁▁▁▁▁▁

porsager/postgres (postgres)     202.32 µs/iter 220.90 µs  █
                          (140.51 µs … 1.22 ms) 436.25 µs  █▆▄
                        (  4.90 kb …   1.10 mb)  13.97 kb ▁████▇▆▄▃▃▃▂▂▂▂▁▁▁▁▁▁

summary
  brianc/node-postgres (pg-native)
   1.13x faster than brianc/node-postgres (pg)
   1.25x faster than porsager/postgres (postgres)
```
