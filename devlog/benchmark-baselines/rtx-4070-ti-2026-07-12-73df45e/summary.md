# Ripple Renderer Benchmark

- Status: **PASSED**
- Run: `2026-07-12T06-54-07-571Z-package`
- Protocol: `renderer-benchmark-v2-flat-top-column-stagger`
- Workload: `renderer-benchmark-v2-flat-top-column-stagger`
- Started: 2026-07-12T06:56:21.510Z
- Duration: 1239.985 s
- App URL: `http://127.0.0.1:4183/`
- Viewport: 1280x720 at DPR 1
- Warmup/sample: 5 s / 15 s
- Repetitions: 4
- Samples: 56/56

## Environment

| Item | Value |
| --- | --- |
| OS | win32 10.0.26200 x64 |
| CPU | 13th Gen Intel(R) Core(TM) i9-13900KF (32 logical) |
| Memory | 31.840103 GiB |
| Browser | Chromium 150.0.7871.101 |
| Channel | chrome |
| User agent | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36 |
| WebGL GPU | ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11) |
| WebGPU adapter | nvidia / lovelace |
| Git | codex/webgpu-core-integration@73df45e5c61e |

## Run Order

| Repetition | Renderer order | Case order |
| ---: | --- | --- |
| 1 | webgl, webgpu | pretty-arena, showoff-track-motion, meltdown-ramp-tier-0, meltdown-ramp-tier-1, meltdown-ramp-tier-2, meltdown-ramp-tier-3, meltdown-ramp-tier-4 |
| 2 | webgpu, webgl | meltdown-ramp-tier-4, meltdown-ramp-tier-3, meltdown-ramp-tier-2, meltdown-ramp-tier-1, meltdown-ramp-tier-0, showoff-track-motion, pretty-arena |
| 3 | webgl, webgpu | showoff-track-motion, meltdown-ramp-tier-0, meltdown-ramp-tier-1, meltdown-ramp-tier-2, meltdown-ramp-tier-3, meltdown-ramp-tier-4, pretty-arena |
| 4 | webgpu, webgl | pretty-arena, meltdown-ramp-tier-4, meltdown-ramp-tier-3, meltdown-ramp-tier-2, meltdown-ramp-tier-1, meltdown-ramp-tier-0, showoff-track-motion |

## Semantic Parity

Result: **PASS** (28/28 paired checks)

## Stable Stress Tier

- WebGL: none
- WebGPU: 4
- Paired: none

## Packaged Acceptance

Result: **PASSED**

| Gate | Result | Detail |
| --- | --- | --- |
| decisionGradeProtocol | PASS | Decision-grade protocol contains seven fixed cases, four repetitions, 28 pairs, and 56 samples. |
| cleanTree | PASS | Git tree remained clean at codex/webgpu-core-integration@73df45e5c61e for the entire run. |
| packageLifecycle | PASS | Strict preview and detached source worktree shut down cleanly before acceptance. |
| benchmarkCompleted | PASS | Instrumented benchmark completed. |
| semanticParity | PASS | 28/28 paired checks passed. |
| stockModes | PASS | Passed stock modes: arena, track, training. |
| stockSoak | PASS | Observed 120055 ms of the required 120000 ms stock soak. |
| adapterConsistency | PASS | Stock and instrumented runs selected nvidia / lovelace. |
| runtimeHealth | PASS | Stock problems=0; benchmark problems=0. |
| webGpuPrettyShowoffStable | PASS | WebGPU Pretty Arena and Showoff Track must have every repetition marked stable. |
| timerCoverage | PASS | Minimum fresh GPU timer coverage was +64.1529%; required &gt;=25%. |
| timerErrors | PASS | Maximum reported GPU timer error count was 0. |
| visualBounds | PASS | 5/5 stock canvas checks stayed within bounds. |
| baselineRegression | PASS | No prior baseline was supplied; this accepted run may become the v2 baseline. |

## pretty-arena

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 118.3473 | 117.9972 | 0.997 | -0.2959% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,895.75 | 1,896.25 | 1.0003 | +0.0264% | unclassified |
| framesPerSecond | 126.3038 | 126.3943 | 1.0007 | +0.0716% | tie |
| gpuFrameAvailabilityRatio | 0.8746 | 0.9705 | 1.1097 | +10.9651% | webgpu-faster |
| gpuFrameMs.count | 1,658 | 1,840.25 | 1.1099 | +10.9922% | unclassified |
| gpuFrameMs.max | 7.1462 | 3.9691 | 0.5554 | -44.4593% | webgpu-faster |
| gpuFrameMs.mean | 4.3848 | 1.4433 | 0.3292 | -67.0833% | webgpu-faster |
| gpuFrameMs.median | 4.5435 | 1.2039 | 0.265 | -73.5037% | webgpu-faster |
| gpuFrameMs.min | 1.4852 | 1.0333 | 0.6957 | -30.4279% | webgpu-faster |
| gpuFrameMs.p95 | 5.7308 | 2.7097 | 0.4728 | -52.7178% | webgpu-faster |
| gpuFrameMs.p99 | 6.0603 | 2.8355 | 0.4679 | -53.2123% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.9025 | 0.5348 | 0.5926 | -40.7408% | webgpu-faster |
| gpuHeadroomRatio | 0.2836 | 0.6613 | 2.3314 | +133.1386% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,895.75 | 1,896.25 | 1.0003 | +0.0264% | unclassified |
| renderCpuMs.max | 4.05 | 1.575 | 0.3889 | -61.1111% | webgpu-faster |
| renderCpuMs.mean | 0.6381 | 0.2304 | 0.3611 | -63.8895% | webgpu-faster |
| renderCpuMs.median | 0.425 | 0.2 | 0.4706 | -52.9412% | webgpu-faster |
| renderCpuMs.min | 0.225 | 0 | 0 | -100% | webgpu-faster |
| renderCpuMs.p95 | 1.75 | 0.65 | 0.3714 | -62.8571% | webgpu-faster |
| renderCpuMs.p99 | 3.175 | 1.3 | 0.4094 | -59.0551% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.5392 | 0.2201 | 0.4083 | -59.1717% | webgpu-faster |
| snapshotCpuMs.count | 1,895.75 | 1,896.25 | 1.0003 | +0.0264% | unclassified |
| snapshotCpuMs.max | 5.975 | 0.275 | 0.046 | -95.3975% | webgpu-faster |
| snapshotCpuMs.mean | 0.8652 | 0.0204 | 0.0236 | -97.6425% | webgpu-faster |
| snapshotCpuMs.median | 0.525 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.325 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 3.4 | 0.1 | 0.0294 | -97.0588% | webgpu-faster |
| snapshotCpuMs.p99 | 5.675 | 0.1 | 0.0176 | -98.2379% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.0313 | 0.0418 | 0.0406 | -95.9443% | webgpu-faster |
| totalCpuMs.count | 1,895.75 | 1,896.25 | 1.0003 | +0.0264% | unclassified |
| totalCpuMs.max | 9.7 | 5.25 | 0.5412 | -45.8763% | webgpu-faster |
| totalCpuMs.mean | 1.515 | 0.7264 | 0.4794 | -52.0561% | webgpu-faster |
| totalCpuMs.median | 1 | 0.5 | 0.5 | -50% | webgpu-faster |
| totalCpuMs.min | 0.75 | 0.3 | 0.4 | -60% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## showoff-track-motion

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 119.0561 | 120.1493 | 1.0092 | +0.9182% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,903.5 | 1,901.25 | 0.9988 | -0.1182% | unclassified |
| framesPerSecond | 126.8294 | 126.6857 | 0.9989 | -0.1133% | tie |
| gpuFrameAvailabilityRatio | 0.8323 | 0.9561 | 1.1487 | +14.8733% | webgpu-faster |
| gpuFrameMs.count | 1,584 | 1,817.75 | 1.1476 | +14.7569% | unclassified |
| gpuFrameMs.max | 7.0484 | 3.4703 | 0.4923 | -50.7651% | webgpu-faster |
| gpuFrameMs.mean | 4.4682 | 1.8659 | 0.4176 | -58.2408% | webgpu-faster |
| gpuFrameMs.median | 4.503 | 1.7205 | 0.3821 | -61.7924% | webgpu-faster |
| gpuFrameMs.min | 2.3073 | 1.393 | 0.6037 | -39.6251% | webgpu-faster |
| gpuFrameMs.p95 | 5.6207 | 3.1775 | 0.5653 | -43.4683% | webgpu-faster |
| gpuFrameMs.p99 | 5.9039 | 3.2118 | 0.544 | -45.5992% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.7492 | 0.4348 | 0.5804 | -41.961% | webgpu-faster |
| gpuHeadroomRatio | 0.2974 | 0.6028 | 2.0269 | +102.6889% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,903.5 | 1,901.25 | 0.9988 | -0.1182% | unclassified |
| renderCpuMs.max | 4.025 | 1.775 | 0.441 | -55.9006% | webgpu-faster |
| renderCpuMs.mean | 0.6387 | 0.257 | 0.4024 | -59.7618% | webgpu-faster |
| renderCpuMs.median | 0.425 | 0.2 | 0.4706 | -52.9412% | webgpu-faster |
| renderCpuMs.min | 0.225 | 0 | 0 | -100% | webgpu-faster |
| renderCpuMs.p95 | 1.625 | 0.7 | 0.4308 | -56.9231% | webgpu-faster |
| renderCpuMs.p99 | 2.9 | 1.425 | 0.4914 | -50.8621% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.4936 | 0.2328 | 0.4716 | -52.8361% | webgpu-faster |
| snapshotCpuMs.count | 1,903.5 | 1,901.25 | 0.9988 | -0.1182% | unclassified |
| snapshotCpuMs.max | 7.175 | 0.225 | 0.0314 | -96.8641% | webgpu-faster |
| snapshotCpuMs.mean | 1.1056 | 0.0177 | 0.0161 | -98.3947% | webgpu-faster |
| snapshotCpuMs.median | 0.7 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.5 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 3.75 | 0.1 | 0.0267 | -97.3333% | webgpu-faster |
| snapshotCpuMs.p99 | 6.725 | 0.1 | 0.0149 | -98.513% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.1984 | 0.0391 | 0.0327 | -96.735% | webgpu-faster |
| totalCpuMs.count | 1,903.5 | 1,901.25 | 0.9988 | -0.1182% | unclassified |
| totalCpuMs.max | 10.5 | 6.475 | 0.6167 | -38.3333% | webgpu-faster |
| totalCpuMs.mean | 1.753 | 0.9273 | 0.529 | -47.1029% | webgpu-faster |
| totalCpuMs.median | 1.125 | 0.7 | 0.6222 | -37.7778% | webgpu-faster |
| totalCpuMs.min | 0.875 | 0.5 | 0.5714 | -42.8571% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 0)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 117.9972 | 118.7059 | 1.006 | +0.6006% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.0016 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,898 | 1,904.25 | 1.0033 | +0.3293% | unclassified |
| framesPerSecond | 126.4021 | 126.8877 | 1.0038 | +0.3842% | tie |
| gpuFrameAvailabilityRatio | 0.6893 | 0.8557 | 1.2413 | +24.1283% | webgpu-faster |
| gpuFrameMs.count | 1,308.75 | 1,629 | 1.2447 | +24.4699% | unclassified |
| gpuFrameMs.max | 8.7194 | 4.7594 | 0.5458 | -45.4154% | webgpu-faster |
| gpuFrameMs.mean | 6.7554 | 2.6981 | 0.3994 | -60.0601% | webgpu-faster |
| gpuFrameMs.median | 6.75 | 2.7601 | 0.4089 | -59.11% | webgpu-faster |
| gpuFrameMs.min | 5.9172 | 1.7707 | 0.2993 | -70.0748% | webgpu-faster |
| gpuFrameMs.p95 | 7.4924 | 3.392 | 0.4527 | -54.7267% | webgpu-faster |
| gpuFrameMs.p99 | 8.0238 | 3.7576 | 0.4683 | -53.1692% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.423 | 0.4302 | 1.0171 | +1.7063% | tie |
| gpuHeadroomRatio | 0.0635 | 0.576 | 9.0771 | +807.7093% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,898 | 1,904.25 | 1.0033 | +0.3293% | unclassified |
| renderCpuMs.max | 4.075 | 2.325 | 0.5706 | -42.9448% | webgpu-faster |
| renderCpuMs.mean | 0.6774 | 0.3677 | 0.5429 | -45.7145% | webgpu-faster |
| renderCpuMs.median | 0.5 | 0.3 | 0.6 | -40% | webgpu-faster |
| renderCpuMs.min | 0.275 | 0.1 | 0.3636 | -63.6364% | webgpu-faster |
| renderCpuMs.p95 | 1.675 | 0.9 | 0.5373 | -46.2687% | webgpu-faster |
| renderCpuMs.p99 | 3.175 | 1.65 | 0.5197 | -48.0315% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.5085 | 0.2686 | 0.5281 | -47.1885% | webgpu-faster |
| snapshotCpuMs.count | 1,898 | 1,904.25 | 1.0033 | +0.3293% | unclassified |
| snapshotCpuMs.max | 10.8 | 0.25 | 0.0231 | -97.6852% | webgpu-faster |
| snapshotCpuMs.mean | 1.7783 | 0.0227 | 0.0128 | -98.7231% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.8 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 5.975 | 0.1 | 0.0167 | -98.3264% | webgpu-faster |
| snapshotCpuMs.p99 | 8.35 | 0.125 | 0.015 | -98.503% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.6257 | 0.0437 | 0.0269 | -97.3128% | webgpu-faster |
| totalCpuMs.count | 1,898 | 1,904.25 | 1.0033 | +0.3293% | unclassified |
| totalCpuMs.max | 14.15 | 11.325 | 0.8004 | -19.9647% | webgpu-faster |
| totalCpuMs.mean | 2.4681 | 1.7235 | 0.6983 | -30.1705% | webgpu-faster |
| totalCpuMs.median | 1.6 | 1.225 | 0.7656 | -23.4375% | webgpu-faster |
| totalCpuMs.min | 1.2 | 0.975 | 0.8125 | -18.75% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 1)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 47.9715 | 118.7059 | 2.4745 | +147.451% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.158 | 0.0007 | 0.0041 | -99.5879% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.0171 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,621.25 | 1,912.5 | 1.1796 | +17.9645% | unclassified |
| framesPerSecond | 108.0587 | 127.3939 | 1.1789 | +17.8932% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.8519 | 0.8356 | 0.9808 | -1.9171% | tie |
| gpuFrameMs.count | 1,381.25 | 1,598 | 1.1569 | +15.6923% | unclassified |
| gpuFrameMs.max | 10.5055 | 5.8281 | 0.5548 | -44.5234% | webgpu-faster |
| gpuFrameMs.mean | 9.1698 | 3.0684 | 0.3346 | -66.538% | webgpu-faster |
| gpuFrameMs.median | 9.1233 | 2.9941 | 0.3282 | -67.1821% | webgpu-faster |
| gpuFrameMs.min | 8.8466 | 2.3247 | 0.2628 | -73.7226% | webgpu-faster |
| gpuFrameMs.p95 | 9.4971 | 4.012 | 0.4224 | -57.7553% | webgpu-faster |
| gpuFrameMs.p99 | 9.5642 | 4.6741 | 0.4887 | -51.1295% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.228 | 0.5495 | 2.4099 | +140.9903% | webgpu-slower |
| gpuHeadroomRatio | -0.1871 | 0.4985 | -2.6638 | +366.3827% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,621.25 | 1,912.5 | 1.1796 | +17.9645% | unclassified |
| renderCpuMs.max | 4.05 | 2.2 | 0.5432 | -45.679% | webgpu-faster |
| renderCpuMs.mean | 0.6678 | 0.3681 | 0.5512 | -44.8783% | webgpu-faster |
| renderCpuMs.median | 0.5 | 0.3 | 0.6 | -40% | webgpu-faster |
| renderCpuMs.min | 0.3 | 0.1 | 0.3333 | -66.6667% | webgpu-faster |
| renderCpuMs.p95 | 1.625 | 0.875 | 0.5385 | -46.1538% | webgpu-faster |
| renderCpuMs.p99 | 2.825 | 1.675 | 0.5929 | -40.708% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.4782 | 0.2646 | 0.5534 | -44.6613% | webgpu-faster |
| snapshotCpuMs.count | 1,621.25 | 1,912.5 | 1.1796 | +17.9645% | unclassified |
| snapshotCpuMs.max | 10.875 | 0.2 | 0.0184 | -98.1609% | webgpu-faster |
| snapshotCpuMs.mean | 1.8144 | 0.0231 | 0.0127 | -98.7294% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.85 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 5.85 | 0.1 | 0.0171 | -98.2906% | webgpu-faster |
| snapshotCpuMs.p99 | 8.45 | 0.1 | 0.0118 | -98.8166% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.6335 | 0.0435 | 0.0266 | -97.3386% | webgpu-faster |
| totalCpuMs.count | 1,621.25 | 1,912.5 | 1.1796 | +17.9645% | unclassified |
| totalCpuMs.max | 14.175 | 12.475 | 0.8801 | -11.9929% | webgpu-faster |
| totalCpuMs.mean | 2.4971 | 1.7312 | 0.6933 | -30.6708% | webgpu-faster |
| totalCpuMs.median | 1.6 | 1.2 | 0.75 | -25% | webgpu-faster |
| totalCpuMs.min | 1.225 | 0.95 | 0.7755 | -22.449% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 2)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 24.1184 | 120.1499 | 4.9817 | +398.1671% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.8464 | 0.0001 | 0.0002 | -99.9846% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.4174 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0.0605 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0.0006 | 0 | 0 | -100% | webgpu-faster |
| frameCount | 788.75 | 1,908.25 | 2.4193 | +141.9334% | unclassified |
| framesPerSecond | 52.577 | 127.1553 | 2.4185 | +141.8458% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.9123 | 0.9246 | 1.0135 | +1.3475% | tie |
| gpuFrameMs.count | 718.75 | 1,764.25 | 2.4546 | +145.4609% | unclassified |
| gpuFrameMs.max | 19.7975 | 4.0188 | 0.203 | -79.7005% | webgpu-faster |
| gpuFrameMs.mean | 18.9771 | 2.1697 | 0.1143 | -88.5669% | webgpu-faster |
| gpuFrameMs.median | 18.9486 | 2.1159 | 0.1117 | -88.8333% | webgpu-faster |
| gpuFrameMs.min | 18.5664 | 1.5856 | 0.0854 | -91.4597% | webgpu-faster |
| gpuFrameMs.p95 | 19.3502 | 3.2069 | 0.1657 | -83.427% | webgpu-faster |
| gpuFrameMs.p99 | 19.4107 | 3.5566 | 0.1832 | -81.6772% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.2596 | 0.4908 | 1.8907 | +89.0701% | webgpu-slower |
| gpuHeadroomRatio | -1.4188 | 0.5991 | -0.4223 | +142.229% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 788.75 | 1,908.25 | 2.4193 | +141.9334% | unclassified |
| renderCpuMs.max | 4.225 | 2.75 | 0.6509 | -34.9112% | webgpu-faster |
| renderCpuMs.mean | 0.7337 | 0.3831 | 0.5222 | -47.782% | webgpu-faster |
| renderCpuMs.median | 0.55 | 0.3 | 0.5455 | -45.4545% | webgpu-faster |
| renderCpuMs.min | 0.3 | 0.1 | 0.3333 | -66.6667% | webgpu-faster |
| renderCpuMs.p95 | 1.775 | 0.975 | 0.5493 | -45.0704% | webgpu-faster |
| renderCpuMs.p99 | 3.375 | 1.95 | 0.5778 | -42.2222% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.532 | 0.3126 | 0.5876 | -41.2389% | webgpu-faster |
| snapshotCpuMs.count | 788.75 | 1,908.25 | 2.4193 | +141.9334% | unclassified |
| snapshotCpuMs.max | 11.075 | 0.25 | 0.0226 | -97.7427% | webgpu-faster |
| snapshotCpuMs.mean | 1.703 | 0.0243 | 0.0142 | -98.576% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.85 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 5.375 | 0.1 | 0.0186 | -98.1395% | webgpu-faster |
| snapshotCpuMs.p99 | 8.075 | 0.125 | 0.0155 | -98.452% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.5241 | 0.0449 | 0.0294 | -97.0552% | webgpu-faster |
| totalCpuMs.count | 788.75 | 1,908.25 | 2.4193 | +141.9334% | unclassified |
| totalCpuMs.max | 14.225 | 11.75 | 0.826 | -17.3989% | webgpu-faster |
| totalCpuMs.mean | 2.459 | 1.7512 | 0.7122 | -28.7818% | webgpu-faster |
| totalCpuMs.median | 1.675 | 1.25 | 0.7463 | -25.3731% | webgpu-faster |
| totalCpuMs.min | 1.3 | 1.025 | 0.7885 | -21.1538% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 3)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 17.2214 | 118.7231 | 6.8939 | +589.3944% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.9265 | 0.0003 | 0.0003 | -99.9713% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.8839 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0.0891 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0.0667 | 0 | 0 | -100% | webgpu-faster |
| frameCount | 521.75 | 1,889.75 | 3.6219 | +262.1945% | unclassified |
| framesPerSecond | 34.7615 | 125.9245 | 3.6225 | +262.2532% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.9266 | 0.9026 | 0.9741 | -2.5935% | tie |
| gpuFrameMs.count | 483.75 | 1,705.75 | 3.5261 | +252.6098% | unclassified |
| gpuFrameMs.max | 29.7149 | 4.939 | 0.1662 | -83.3786% | webgpu-faster |
| gpuFrameMs.mean | 28.743 | 2.6518 | 0.0923 | -90.774% | webgpu-faster |
| gpuFrameMs.median | 28.6707 | 2.7079 | 0.0944 | -90.5552% | webgpu-faster |
| gpuFrameMs.min | 28.3315 | 2.1569 | 0.0761 | -92.3868% | webgpu-faster |
| gpuFrameMs.p95 | 29.163 | 2.9527 | 0.1012 | -89.8752% | webgpu-faster |
| gpuFrameMs.p99 | 29.2237 | 4.3255 | 0.148 | -85.1986% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.2939 | 0.3379 | 1.1497 | +14.9742% | webgpu-slower |
| gpuHeadroomRatio | -2.6454 | 0.6309 | -0.2385 | +123.8497% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 521.75 | 1,889.75 | 3.6219 | +262.1945% | unclassified |
| renderCpuMs.max | 4.575 | 2.325 | 0.5082 | -49.1803% | webgpu-faster |
| renderCpuMs.mean | 0.7929 | 0.3863 | 0.4872 | -51.2802% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.3 | 0.5 | -50% | webgpu-faster |
| renderCpuMs.min | 0.35 | 0.1 | 0.2857 | -71.4286% | webgpu-faster |
| renderCpuMs.p95 | 2.025 | 0.975 | 0.4815 | -51.8519% | webgpu-faster |
| renderCpuMs.p99 | 3.55 | 1.95 | 0.5493 | -45.0704% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.5841 | 0.31 | 0.5307 | -46.9258% | webgpu-faster |
| snapshotCpuMs.count | 521.75 | 1,889.75 | 3.6219 | +262.1945% | unclassified |
| snapshotCpuMs.max | 11.025 | 0.225 | 0.0204 | -97.9592% | webgpu-faster |
| snapshotCpuMs.mean | 1.8045 | 0.0247 | 0.0137 | -98.6295% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.9 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 6.075 | 0.1 | 0.0165 | -98.3539% | webgpu-faster |
| snapshotCpuMs.p99 | 8.8 | 0.1 | 0.0114 | -98.8636% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.6783 | 0.045 | 0.0268 | -97.3211% | webgpu-faster |
| totalCpuMs.count | 521.75 | 1,889.75 | 3.6219 | +262.1945% | unclassified |
| totalCpuMs.max | 14.1 | 11.85 | 0.8404 | -15.9574% | webgpu-faster |
| totalCpuMs.mean | 2.6286 | 1.7508 | 0.6661 | -33.3948% | webgpu-faster |
| totalCpuMs.median | 1.725 | 1.225 | 0.7101 | -28.9855% | webgpu-faster |
| totalCpuMs.min | 1.35 | 0.975 | 0.7222 | -27.7778% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 4)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 12.9209 | 118.7059 | 9.1871 | +818.7149% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.9432 | 0.0009 | 0.001 | -99.903% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.9358 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0.6892 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0.0644 | 0 | 0 | -100% | webgpu-faster |
| frameCount | 392.75 | 1,911 | 4.8657 | +386.5691% | unclassified |
| framesPerSecond | 26.1634 | 127.3358 | 4.8669 | +386.6949% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.9429 | 0.8764 | 0.9295 | -7.0471% | tie |
| gpuFrameMs.count | 370 | 1,674.75 | 4.5264 | +352.6351% | unclassified |
| gpuFrameMs.max | 38.7904 | 3.9384 | 0.1015 | -89.8471% | webgpu-faster |
| gpuFrameMs.mean | 38.2659 | 2.9608 | 0.0774 | -92.2626% | webgpu-faster |
| gpuFrameMs.median | 38.1978 | 2.8309 | 0.0741 | -92.5887% | webgpu-faster |
| gpuFrameMs.min | 37.8639 | 2.7848 | 0.0735 | -92.6454% | webgpu-faster |
| gpuFrameMs.p95 | 38.6706 | 3.6334 | 0.094 | -90.6042% | webgpu-faster |
| gpuFrameMs.p99 | 38.7456 | 3.7867 | 0.0977 | -90.2268% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.2828 | 0.2838 | 1.0037 | +0.366% | tie |
| gpuHeadroomRatio | -3.8338 | 0.5458 | -0.1424 | +114.2371% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 392.75 | 1,911 | 4.8657 | +386.5691% | unclassified |
| renderCpuMs.max | 4.375 | 2.525 | 0.5771 | -42.2857% | webgpu-faster |
| renderCpuMs.mean | 0.8674 | 0.3702 | 0.4268 | -57.3215% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.3 | 0.5 | -50% | webgpu-faster |
| renderCpuMs.min | 0.375 | 0.1 | 0.2667 | -73.3333% | webgpu-faster |
| renderCpuMs.p95 | 2.225 | 0.95 | 0.427 | -57.3034% | webgpu-faster |
| renderCpuMs.p99 | 3.8 | 2 | 0.5263 | -47.3684% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.6366 | 0.3051 | 0.4793 | -52.0714% | webgpu-faster |
| snapshotCpuMs.count | 392.75 | 1,911 | 4.8657 | +386.5691% | unclassified |
| snapshotCpuMs.max | 11.5 | 0.3 | 0.0261 | -97.3913% | webgpu-faster |
| snapshotCpuMs.mean | 1.9131 | 0.0229 | 0.012 | -98.8005% | webgpu-faster |
| snapshotCpuMs.median | 1.15 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.9 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 6.2 | 0.1 | 0.0161 | -98.3871% | webgpu-faster |
| snapshotCpuMs.p99 | 9.675 | 0.1 | 0.0103 | -98.9664% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 1.7725 | 0.0443 | 0.025 | -97.4979% | webgpu-faster |
| totalCpuMs.count | 392.75 | 1,911 | 4.8657 | +386.5691% | unclassified |
| totalCpuMs.max | 15.725 | 12.675 | 0.806 | -19.3959% | webgpu-faster |
| totalCpuMs.mean | 2.8198 | 1.7167 | 0.6088 | -39.121% | webgpu-faster |
| totalCpuMs.median | 1.8 | 1.225 | 0.6806 | -31.9444% | webgpu-faster |
| totalCpuMs.min | 1.35 | 0.95 | 0.7037 | -29.6296% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## Artifacts

- `summary.json`: configuration, metadata, aggregates, and parity checks
- `samples.ndjson.gz`: gzip-compressed normalized record per completed backend sample
- `summary.md`: this human-readable report
- `acceptance.json`: per-machine stock, stability, timer, visual, and regression gates
- `baseline.json`: accepted v2 baseline projection for later compatible comparisons
- `manifest.json`: relative bundle inventory with SHA-256 checksums

