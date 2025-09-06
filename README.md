# Postgres benchmark pg VS pg-native VS postgres

Run benchmark
```
docker-compose build
docker-compose up
```

output
```
clk: ~3.41 GHz
cpu: Intel(R) Core(TM) i7-1065G7 CPU @ 1.30GHz
runtime: node 24.7.0 (x64-linux)

benchmark                   avg (min … max) p75 / p99    (min … top 1%)
------------------------------------------- -------------------------------
pg-native                    630.65 ns/iter 400.00 ns    █                 
                      (96.00 ns … 24.85 ms)   1.43 µs    █▂                
                    (  1.19 kb …   4.42 mb)   1.24 kb ▂▂▂██▇▃▂▂▂▁▁▁▁▁▁▁▁▁▁▁

postgres                       1.19 µs/iter 801.11 ns █                    
                     (580.21 ns … 12.19 µs)   9.09 µs █                    
                    (242.51  b … 886.45  b) 674.89  b █▇▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁

pg                           745.94 ns/iter 393.00 ns     █                
                     (106.00 ns … 19.19 ms)   1.27 µs     ██               
                    (856.00  b …   4.42 mb) 941.59  b ▃▂▂▂██▅▂▂▁▁▁▁▁▁▁▁▁▁▁▁
```