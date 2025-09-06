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
Database connectivity verified
clk: ~3.26 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                       avg (min … max) p75 / p99    (min … top 1%)
----------------------------------------------- -------------------------------
• with prepared statement
----------------------------------------------- -------------------------------
brianc/node-postgres (pg-native) 242.33 µs/iter 242.50 µs █▃
                          (131.91 µs … 2.91 ms)   1.27 ms ██
                        (  0.99 kb …   2.04 mb)  14.65 kb ███▅▃▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁

brianc/node-postgres (pg)        247.13 µs/iter 254.27 µs  █
                          (121.98 µs … 2.99 ms)   1.28 ms ▂█▄
                        (  8.05 kb …   1.59 mb)  16.59 kb ███▆▃▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁

porsager/postgres (postgres)     329.33 µs/iter 366.50 µs  █
                          (146.86 µs … 3.54 ms)   1.71 ms ██▅
                        (  4.97 kb …   1.59 mb)  13.38 kb ████▆▄▃▂▂▁▁▁▁▁▁▁▁▁▁▁▁

summary
  brianc/node-postgres (pg-native)
   1.02x faster than brianc/node-postgres (pg)
   1.36x faster than porsager/postgres (postgres)
```
