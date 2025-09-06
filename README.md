# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

- [pg](https://www.npmjs.com/package/pg)
- [pg-native](https://www.npmjs.com/package/pg-native)
- [postgres](https://www.npmjs.com/package/postgres)

### Run benchmark

```shell
docker-compose build
docker-compose up
```

### Output

```shell
Running benchmarks... --iterations=50000
GC is exposed
{
  "pg": "^8.16.3",
  "pg-native": "^3.5.2",
  "postgres": "^3.4.7"
}
Database connectivity verified
clk: ~3.23 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                       avg (min … max) p75 / p99    (min … top 1%)
----------------------------------------------- -------------------------------
brianc/node-postgres (pg-native) 177.55 µs/iter 187.29 µs  █
                          (115.42 µs … 2.16 ms) 499.22 µs  █
                        (  5.93 kb …   2.35 mb)  12.06 kb ▁█▇▄▃▃▃▃▂▂▂▁▁▁▁▁▁▁▁▁▁

brianc/node-postgres (pg)        200.38 µs/iter 224.83 µs   █
                          (117.27 µs … 1.98 ms) 492.05 µs  ▅█
                        (  2.37 kb …   1.82 mb)  15.24 kb ▁███▇▇▆▅▄▂▂▂▂▂▁▁▁▁▁▁▁

porsager/postgres (postgres)     196.89 µs/iter 203.13 µs   █
                          (120.43 µs … 1.87 ms) 533.71 µs   █
                        (  7.00 kb …   1.18 mb)  12.01 kb ▁▇██▅▄▃▂▂▂▁▁▁▁▁▁▁▁▁▁▁

summary
  brianc/node-postgres (pg-native)
   1.11x faster than porsager/postgres (postgres)
   1.13x faster than brianc/node-postgres (pg)
```
