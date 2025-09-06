# Postgres benchmark 
## brianc/node-postgres VS porsager/postgres

### Run benchmark
```
docker-compose build
docker-compose up
```

### Output

```
clk: ~3.59 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                       avg (min … max) p75 / p99    (min … top 1%)
----------------------------------------------- -------------------------------
brianc/node-postgres (pg-native) 157.33 µs/iter 153.26 µs   █                  
                        (108.31 µs … 878.51 µs) 414.78 µs  ▆█                  
                        (  1.54 kb …   2.81 mb)  12.04 kb ▁███▄▃▂▂▂▂▁▁▁▁▁▁▁▁▁▁▁

brianc/node-postgres (pg)        174.14 µs/iter 172.44 µs  █                   
                          (118.84 µs … 1.07 ms) 470.30 µs  █▄                  
                        (376.00  b …   3.06 mb)  15.47 kb ▁██▃▂▃▃▃▂▂▂▂▁▁▁▁▁▁▁▁▁

porsager/postgres (postgres)     173.65 µs/iter 173.19 µs  █                   
                        (133.01 µs … 791.63 µs) 427.09 µs  █                   
                        (  6.84 kb …   1.12 mb)  11.37 kb ███▄▃▂▃▂▂▂▂▁▁▁▁▁▁▁▁▁▁

porsager/postgres (unsafe)       175.56 µs/iter 175.75 µs █▃                   
                        (141.87 µs … 844.39 µs) 435.06 µs ██                   
                        (  6.60 kb … 331.75 kb)   8.98 kb ██▇▅▃▃▂▂▂▂▂▁▁▁▁▁▁▁▁▁▁
```