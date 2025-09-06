# Postgres benchmark

## brianc/node-postgres VS porsager/postgres

### Run benchmark

```
docker-compose build
docker-compose up
```

### Output

```
Running benchmarks... --iterations=50000
GC is exposed
clk: ~3.37 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                       avg (min … max) p75 / p99    (min … top 1%)
----------------------------------------------- -------------------------------
brianc/node-postgres (pg-native) 162.75 µs/iter 154.46 µs  █
                          (113.08 µs … 1.12 ms) 429.87 µs  █▆
                        (  7.07 kb …   2.87 mb)  11.79 kb ▁██▄▂▂▂▂▂▂▁▁▁▁▁▁▂▁▁▁▁

brianc/node-postgres (pg)        172.63 µs/iter 180.84 µs  █
                          (126.98 µs … 1.15 ms) 432.69 µs ▃█
                        (376.00  b …   3.11 mb)  14.99 kb ██▆▅▃▃▃▂▃▂▂▁▁▁▁▁▁▁▁▁▁

porsager/postgres (postgres)     182.95 µs/iter 205.09 µs  █
                          (126.69 µs … 1.16 ms) 449.84 µs  █▇
                        (  2.26 kb … 980.01 kb)  11.69 kb ▁██▄▃▄▅▃▃▂▂▁▁▁▁▁▁▁▁▁▁

porsager/postgres (unsafe)       193.00 µs/iter 193.41 µs  █
                          (143.72 µs … 1.14 ms) 547.31 µs  █
                        (  6.77 kb … 517.28 kb)   9.30 kb ███▅▃▃▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁

summary
  brianc/node-postgres(pg-native)
   1.06x faster than brianc/node-postgres (pg)
   1.12x faster than porsager/postgres (postgres)
   1.19x faster than porsager/postgres (unsafe)
```
