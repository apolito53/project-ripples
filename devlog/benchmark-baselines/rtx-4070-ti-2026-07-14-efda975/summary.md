# Ripple Renderer Benchmark

- Status: **PASSED**
- Run: `2026-07-14T07-49-35-502Z-package`
- Protocol: `renderer-benchmark-v3-classic-3d-tiles`
- Workload: `renderer-benchmark-v3-classic-3d-tiles`
- Started: 2026-07-14T07:51:50.779Z
- Duration: 1227.231 s
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
| Browser | Chromium 150.0.7871.115 |
| Channel | chrome |
| User agent | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36 |
| WebGL GPU | ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11) |
| WebGPU adapter | nvidia / lovelace |
| Git | codex/webgpu-core-integration@efda975f5a1f |

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
- WebGPU: 1
- Paired: none

## Packaged Acceptance

Result: **PASSED**

| Gate | Result | Detail |
| --- | --- | --- |
| decisionGradeProtocol | PASS | Decision-grade protocol contains seven fixed cases, four repetitions, 28 pairs, and 56 samples. |
| cleanTree | PASS | Git tree remained clean at codex/webgpu-core-integration@efda975f5a1f for the entire run. |
| packageLifecycle | PASS | Strict preview and detached source worktree shut down cleanly before acceptance. |
| benchmarkCompleted | PASS | Instrumented benchmark completed. |
| semanticParity | PASS | 28/28 paired checks passed. |
| stockModes | PASS | Passed stock modes: arena, track, training. |
| stockSoak | PASS | Observed 120056 ms of the required 120000 ms stock soak. |
| adapterConsistency | PASS | Stock and instrumented runs selected nvidia / lovelace. |
| runtimeHealth | PASS | Stock problems=0; benchmark problems=0. |
| webGpuPrettyShowoffStable | PASS | WebGPU Pretty Arena and Showoff Track must have every repetition marked stable. |
| timerCoverage | PASS | Minimum fresh GPU timer coverage was +52.0426%; required &gt;=25%. |
| timerErrors | PASS | Maximum reported GPU timer error count was 0. |
| visualBounds | PASS | 5/5 stock canvas checks stayed within bounds. |
| baselineRegression | PASS | No prior baseline was supplied; this accepted run may become the current-protocol baseline. |

## pretty-arena

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 121.2256 | 120.858 | 0.997 | -0.3033% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,906 | 1,909.5 | 1.0018 | +0.1836% | unclassified |
| framesPerSecond | 127.0133 | 127.2129 | 1.0016 | +0.1571% | tie |
| gpuFrameAvailabilityRatio | 0.9831 | 0.9987 | 1.0158 | +1.5842% | tie |
| gpuFrameMs.count | 1,873.75 | 1,907 | 1.0177 | +1.7745% | unclassified |
| gpuFrameMs.max | 6.1036 | 3.9011 | 0.6392 | -36.0842% | webgpu-faster |
| gpuFrameMs.mean | 4.0221 | 0.9824 | 0.2443 | -75.5745% | webgpu-faster |
| gpuFrameMs.median | 3.9319 | 1.1461 | 0.2915 | -70.8504% | webgpu-faster |
| gpuFrameMs.min | 1.9638 | 0.2842 | 0.1447 | -85.5254% | webgpu-faster |
| gpuFrameMs.p95 | 5.1274 | 2.2018 | 0.4294 | -57.0585% | webgpu-faster |
| gpuFrameMs.p99 | 5.6246 | 3.163 | 0.5624 | -43.7641% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.628 | 0.6445 | 1.0262 | +2.6194% | tie |
| gpuHeadroomRatio | 0.3591 | 0.7248 | 2.0185 | +101.847% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,906 | 1,909.5 | 1.0018 | +0.1836% | unclassified |
| renderCpuMs.max | 1.525 | 0.95 | 0.623 | -37.7049% | webgpu-faster |
| renderCpuMs.mean | 0.6385 | 0.2792 | 0.4373 | -56.2698% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.3 | 0.5 | -50% | webgpu-faster |
| renderCpuMs.min | 0.4 | 0.1 | 0.25 | -75% | webgpu-faster |
| renderCpuMs.p95 | 0.875 | 0.4 | 0.4571 | -54.2857% | webgpu-faster |
| renderCpuMs.p99 | 1.1 | 0.525 | 0.4773 | -52.2727% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1333 | 0.0898 | 0.6737 | -32.6334% | webgpu-faster |
| snapshotCpuMs.count | 1,906 | 1,909.5 | 1.0018 | +0.1836% | unclassified |
| snapshotCpuMs.max | 1.3 | 0.2 | 0.1538 | -84.6154% | webgpu-faster |
| snapshotCpuMs.mean | 0.5436 | 0.036 | 0.0662 | -93.3827% | webgpu-faster |
| snapshotCpuMs.median | 0.5 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.3 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 0.675 | 0.1 | 0.1481 | -85.1852% | webgpu-faster |
| snapshotCpuMs.p99 | 0.9 | 0.175 | 0.1944 | -80.5556% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.0964 | 0.0502 | 0.5211 | -47.8944% | webgpu-faster |
| totalCpuMs.count | 1,906 | 1,909.5 | 1.0018 | +0.1836% | unclassified |
| totalCpuMs.max | 3.225 | 1.825 | 0.5659 | -43.4109% | webgpu-faster |
| totalCpuMs.mean | 1.2002 | 0.6591 | 0.5491 | -45.0879% | webgpu-faster |
| totalCpuMs.median | 1.175 | 0.6 | 0.5106 | -48.9362% | webgpu-faster |
| totalCpuMs.min | 0.825 | 0.4 | 0.4848 | -51.5152% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## showoff-track-motion

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 123.0804 | 121.6017 | 0.988 | -1.2014% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,902 | 1,907.25 | 1.0028 | +0.276% | unclassified |
| framesPerSecond | 126.6995 | 127.0461 | 1.0027 | +0.2736% | tie |
| gpuFrameAvailabilityRatio | 0.9884 | 0.9963 | 1.008 | +0.7978% | tie |
| gpuFrameMs.count | 1,880 | 1,900.25 | 1.0108 | +1.0771% | unclassified |
| gpuFrameMs.max | 5.7434 | 4.738 | 0.8249 | -17.5056% | webgpu-faster |
| gpuFrameMs.mean | 3.787 | 1.243 | 0.3282 | -67.1779% | webgpu-faster |
| gpuFrameMs.median | 3.766 | 1.2346 | 0.3278 | -67.2182% | webgpu-faster |
| gpuFrameMs.min | 2.286 | 0.4605 | 0.2014 | -79.8569% | webgpu-faster |
| gpuFrameMs.p95 | 4.8911 | 1.7732 | 0.3625 | -63.7475% | webgpu-faster |
| gpuFrameMs.p99 | 5.3066 | 3.7402 | 0.7048 | -29.5174% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.5848 | 0.5118 | 0.8752 | -12.4826% | webgpu-faster |
| gpuHeadroomRatio | 0.3886 | 0.7784 | 2.0029 | +100.2931% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,902 | 1,907.25 | 1.0028 | +0.276% | unclassified |
| renderCpuMs.max | 1.675 | 0.8 | 0.4776 | -52.2388% | webgpu-faster |
| renderCpuMs.mean | 0.6408 | 0.2857 | 0.4459 | -55.4147% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.3 | 0.5 | -50% | webgpu-faster |
| renderCpuMs.min | 0.3 | 0.1 | 0.3333 | -66.6667% | webgpu-faster |
| renderCpuMs.p95 | 0.9 | 0.4 | 0.4444 | -55.5556% | webgpu-faster |
| renderCpuMs.p99 | 1.1 | 0.525 | 0.4773 | -52.2727% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1407 | 0.0853 | 0.6065 | -39.348% | webgpu-faster |
| snapshotCpuMs.count | 1,902 | 1,907.25 | 1.0028 | +0.276% | unclassified |
| snapshotCpuMs.max | 1.575 | 0.2 | 0.127 | -87.3016% | webgpu-faster |
| snapshotCpuMs.mean | 0.6922 | 0.0284 | 0.0411 | -95.8938% | webgpu-faster |
| snapshotCpuMs.median | 0.7 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.5 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 0.875 | 0.1 | 0.1143 | -88.5714% | webgpu-faster |
| snapshotCpuMs.p99 | 1.25 | 0.1 | 0.08 | -92% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1164 | 0.0464 | 0.3985 | -60.1546% | webgpu-faster |
| totalCpuMs.count | 1,902 | 1,907.25 | 1.0028 | +0.276% | unclassified |
| totalCpuMs.max | 2.7 | 1.725 | 0.6389 | -36.1111% | webgpu-faster |
| totalCpuMs.mean | 1.3476 | 0.7877 | 0.5845 | -41.5483% | webgpu-faster |
| totalCpuMs.median | 1.3 | 0.775 | 0.5962 | -40.3846% | webgpu-faster |
| totalCpuMs.min | 1 | 0.5 | 0.5 | -50% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 0)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 121.6017 | 122.7131 | 1.0091 | +0.9139% | tie |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over16_67MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,900.25 | 1,901.75 | 1.0008 | +0.0789% | unclassified |
| framesPerSecond | 126.6087 | 126.7151 | 1.0008 | +0.084% | tie |
| gpuFrameAvailabilityRatio | 0.7436 | 0.9954 | 1.3387 | +33.866% | webgpu-faster |
| gpuFrameMs.count | 1,413.25 | 1,893 | 1.3395 | +33.9466% | unclassified |
| gpuFrameMs.max | 9.4595 | 3.3757 | 0.3569 | -64.3142% | webgpu-faster |
| gpuFrameMs.mean | 7.3646 | 2.2396 | 0.3041 | -69.5895% | webgpu-faster |
| gpuFrameMs.median | 7.4486 | 2.1609 | 0.2901 | -70.989% | webgpu-faster |
| gpuFrameMs.min | 5.9986 | 1.7704 | 0.2951 | -70.4859% | webgpu-faster |
| gpuFrameMs.p95 | 8.2522 | 2.8474 | 0.3451 | -65.4946% | webgpu-faster |
| gpuFrameMs.p99 | 8.8082 | 3.1119 | 0.3533 | -64.6703% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.6386 | 0.3494 | 0.5471 | -45.2868% | webgpu-faster |
| gpuHeadroomRatio | -0.0315 | 0.6441 | -20.4337 | +2,143.3693% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,900.25 | 1,901.75 | 1.0008 | +0.0789% | unclassified |
| renderCpuMs.max | 1.625 | 1.1 | 0.6769 | -32.3077% | webgpu-faster |
| renderCpuMs.mean | 0.6542 | 0.3744 | 0.5724 | -42.7604% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.4 | 0.6667 | -33.3333% | webgpu-faster |
| renderCpuMs.min | 0.4 | 0.2 | 0.5 | -50% | webgpu-faster |
| renderCpuMs.p95 | 0.875 | 0.5 | 0.5714 | -42.8571% | webgpu-faster |
| renderCpuMs.p99 | 1.15 | 0.675 | 0.587 | -41.3043% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1326 | 0.0951 | 0.7174 | -28.2647% | webgpu-faster |
| snapshotCpuMs.count | 1,900.25 | 1,901.75 | 1.0008 | +0.0789% | unclassified |
| snapshotCpuMs.max | 2.125 | 0.3 | 0.1412 | -85.8824% | webgpu-faster |
| snapshotCpuMs.mean | 1.0582 | 0.0342 | 0.0324 | -96.7646% | webgpu-faster |
| snapshotCpuMs.median | 1.025 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.8 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 1.275 | 0.1 | 0.0784 | -92.1569% | webgpu-faster |
| snapshotCpuMs.p99 | 1.675 | 0.175 | 0.1045 | -89.5522% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1401 | 0.0501 | 0.3578 | -64.2242% | webgpu-faster |
| totalCpuMs.count | 1,900.25 | 1,901.75 | 1.0008 | +0.0789% | unclassified |
| totalCpuMs.max | 5 | 3.3 | 0.66 | -34% | webgpu-faster |
| totalCpuMs.mean | 1.7305 | 1.3276 | 0.7672 | -23.2843% | webgpu-faster |
| totalCpuMs.median | 1.675 | 1.3 | 0.7761 | -22.3881% | webgpu-faster |
| totalCpuMs.min | 1.375 | 1 | 0.7273 | -27.2727% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 1)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 41.4109 | 121.9781 | 2.9456 | +194.5558% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.3509 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.0806 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 1,327.25 | 1,900 | 1.4315 | +43.1531% | unclassified |
| framesPerSecond | 88.415 | 126.5452 | 1.4313 | +43.1264% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.9015 | 0.9385 | 1.041 | +4.1005% | tie |
| gpuFrameMs.count | 1,198 | 1,783.25 | 1.4885 | +48.8523% | unclassified |
| gpuFrameMs.max | 12.8947 | 4.9805 | 0.3862 | -61.3755% | webgpu-faster |
| gpuFrameMs.mean | 11.2154 | 3.6674 | 0.327 | -67.3004% | webgpu-faster |
| gpuFrameMs.median | 11.1298 | 3.4775 | 0.3124 | -68.7553% | webgpu-faster |
| gpuFrameMs.min | 10.3063 | 3.0504 | 0.296 | -70.403% | webgpu-faster |
| gpuFrameMs.p95 | 12.1347 | 4.3032 | 0.3546 | -64.5377% | webgpu-faster |
| gpuFrameMs.p99 | 12.309 | 4.7764 | 0.388 | -61.1954% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.5691 | 0.421 | 0.7397 | -26.0326% | webgpu-faster |
| gpuHeadroomRatio | -0.5168 | 0.4621 | -0.8941 | +189.4093% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 1,327.25 | 1,900 | 1.4315 | +43.1531% | unclassified |
| renderCpuMs.max | 1.55 | 0.975 | 0.629 | -37.0968% | webgpu-faster |
| renderCpuMs.mean | 0.6401 | 0.3749 | 0.5856 | -41.4356% | webgpu-faster |
| renderCpuMs.median | 0.6 | 0.4 | 0.6667 | -33.3333% | webgpu-faster |
| renderCpuMs.min | 0.4 | 0.175 | 0.4375 | -56.25% | webgpu-faster |
| renderCpuMs.p95 | 0.825 | 0.525 | 0.6364 | -36.3636% | webgpu-faster |
| renderCpuMs.p99 | 1.025 | 0.675 | 0.6585 | -34.1463% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1183 | 0.0934 | 0.7902 | -20.9834% | webgpu-faster |
| snapshotCpuMs.count | 1,327.25 | 1,900 | 1.4315 | +43.1531% | unclassified |
| snapshotCpuMs.max | 2.2 | 0.275 | 0.125 | -87.5% | webgpu-faster |
| snapshotCpuMs.mean | 1.0717 | 0.0352 | 0.0329 | -96.7133% | webgpu-faster |
| snapshotCpuMs.median | 1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.8 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 1.325 | 0.1 | 0.0755 | -92.4528% | webgpu-faster |
| snapshotCpuMs.p99 | 1.725 | 0.2 | 0.1159 | -88.4058% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1478 | 0.0508 | 0.3436 | -65.6406% | webgpu-faster |
| totalCpuMs.count | 1,327.25 | 1,900 | 1.4315 | +43.1531% | unclassified |
| totalCpuMs.max | 4.85 | 3.325 | 0.6856 | -31.4433% | webgpu-faster |
| totalCpuMs.mean | 1.7342 | 1.3349 | 0.7698 | -23.0218% | webgpu-faster |
| totalCpuMs.median | 1.7 | 1.3 | 0.7647 | -23.5294% | webgpu-faster |
| totalCpuMs.min | 1.375 | 1 | 0.7273 | -27.2727% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 2)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 36.4862 | 62.403 | 1.7103 | +71.0318% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.9996 | 0.1034 | 0.1034 | -89.658% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.8685 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0.0004 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0 | 0 | n/a | n/a | unclassified |
| frameCount | 655.75 | 1,723 | 2.6275 | +162.7526% | unclassified |
| framesPerSecond | 43.6831 | 114.806 | 2.6282 | +162.8153% | webgpu-faster |
| gpuFrameAvailabilityRatio | 1 | 0.5569 | 0.5569 | -44.3134% | webgpu-slower |
| gpuFrameMs.count | 655.75 | 959.5 | 1.4632 | +46.321% | unclassified |
| gpuFrameMs.max | 24.4168 | 11.5017 | 0.4711 | -52.8943% | webgpu-faster |
| gpuFrameMs.mean | 22.8179 | 8.5869 | 0.3763 | -62.3677% | webgpu-faster |
| gpuFrameMs.median | 22.8457 | 8.3222 | 0.3643 | -63.5721% | webgpu-faster |
| gpuFrameMs.min | 21.4874 | 7.4522 | 0.3468 | -65.318% | webgpu-faster |
| gpuFrameMs.p95 | 23.5295 | 10.1178 | 0.43 | -56.9995% | webgpu-faster |
| gpuFrameMs.p99 | 23.8049 | 11.0329 | 0.4635 | -53.653% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.4791 | 0.6533 | 1.3635 | +36.3541% | webgpu-slower |
| gpuHeadroomRatio | -1.9412 | -0.2647 | 0.1364 | +86.3627% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 655.75 | 1,723 | 2.6275 | +162.7526% | unclassified |
| renderCpuMs.max | 1.325 | 1.475 | 1.1132 | +11.3208% | webgpu-slower |
| renderCpuMs.mean | 0.6811 | 0.3635 | 0.5337 | -46.6347% | webgpu-faster |
| renderCpuMs.median | 0.7 | 0.4 | 0.5714 | -42.8571% | webgpu-faster |
| renderCpuMs.min | 0.5 | 0.2 | 0.4 | -60% | webgpu-faster |
| renderCpuMs.p95 | 0.9 | 0.5 | 0.5556 | -44.4444% | webgpu-faster |
| renderCpuMs.p99 | 1.05 | 0.65 | 0.619 | -38.0952% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1106 | 0.0931 | 0.842 | -15.7967% | webgpu-faster |
| snapshotCpuMs.count | 655.75 | 1,723 | 2.6275 | +162.7526% | unclassified |
| snapshotCpuMs.max | 2.025 | 0.2 | 0.0988 | -90.1235% | webgpu-faster |
| snapshotCpuMs.mean | 1.0858 | 0.0328 | 0.0302 | -96.9813% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.9 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 1.325 | 0.1 | 0.0755 | -92.4528% | webgpu-faster |
| snapshotCpuMs.p99 | 1.625 | 0.15 | 0.0923 | -90.7692% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1328 | 0.0492 | 0.3704 | -62.9581% | webgpu-faster |
| totalCpuMs.count | 655.75 | 1,723 | 2.6275 | +162.7526% | unclassified |
| totalCpuMs.max | 4.625 | 3.25 | 0.7027 | -29.7297% | webgpu-faster |
| totalCpuMs.mean | 1.7979 | 1.3168 | 0.7324 | -26.7593% | webgpu-faster |
| totalCpuMs.median | 1.8 | 1.3 | 0.7222 | -27.7778% | webgpu-faster |
| totalCpuMs.min | 1.5 | 1.025 | 0.6833 | -31.6667% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 3)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 22.5957 | 60.6061 | 2.6822 | +168.2197% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 0.9972 | 0.6843 | 0.6862 | -31.3825% | webgpu-faster |
| frameBudget.over16_67MsRatio | 0.9972 | 0.0058 | 0.0058 | -99.4214% | webgpu-faster |
| frameBudget.over33_33MsRatio | 0.3126 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0.0028 | 0 | 0 | -100% | webgpu-faster |
| frameCount | 440.75 | 1,127.75 | 2.5587 | +155.8707% | unclassified |
| framesPerSecond | 29.3515 | 75.1033 | 2.5588 | +155.8757% | webgpu-faster |
| gpuFrameAvailabilityRatio | 0.9972 | 0.5387 | 0.5402 | -45.9836% | webgpu-slower |
| gpuFrameMs.count | 439.5 | 607.5 | 1.3823 | +38.2253% | unclassified |
| gpuFrameMs.max | 35.8331 | 16.8423 | 0.47 | -52.998% | webgpu-faster |
| gpuFrameMs.mean | 33.9728 | 13.411 | 0.3948 | -60.5242% | webgpu-faster |
| gpuFrameMs.median | 33.8755 | 13.224 | 0.3904 | -60.9628% | webgpu-faster |
| gpuFrameMs.min | 32.9841 | 11.7868 | 0.3573 | -64.2652% | webgpu-faster |
| gpuFrameMs.p95 | 35.0717 | 15.9318 | 0.4543 | -54.5738% | webgpu-faster |
| gpuFrameMs.p99 | 35.3802 | 16.3069 | 0.4609 | -53.9096% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.594 | 1.0948 | 1.8432 | +84.3156% | webgpu-slower |
| gpuHeadroomRatio | -3.384 | -0.9915 | 0.293 | +70.7009% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 440.75 | 1,127.75 | 2.5587 | +155.8707% | unclassified |
| renderCpuMs.max | 1.375 | 1.4 | 1.0182 | +1.8182% | tie |
| renderCpuMs.mean | 0.6996 | 0.3749 | 0.5359 | -46.413% | webgpu-faster |
| renderCpuMs.median | 0.7 | 0.4 | 0.5714 | -42.8571% | webgpu-faster |
| renderCpuMs.min | 0.5 | 0.2 | 0.4 | -60% | webgpu-faster |
| renderCpuMs.p95 | 0.9 | 0.5 | 0.5556 | -44.4444% | webgpu-faster |
| renderCpuMs.p99 | 1.075 | 0.675 | 0.6279 | -37.2093% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1152 | 0.0937 | 0.8132 | -18.6758% | webgpu-faster |
| snapshotCpuMs.count | 440.75 | 1,127.75 | 2.5587 | +155.8707% | unclassified |
| snapshotCpuMs.max | 2.1 | 0.2 | 0.0952 | -90.4762% | webgpu-faster |
| snapshotCpuMs.mean | 1.1102 | 0.0408 | 0.0367 | -96.3261% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.9 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 1.325 | 0.1 | 0.0755 | -92.4528% | webgpu-faster |
| snapshotCpuMs.p99 | 1.7 | 0.175 | 0.1029 | -89.7059% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1349 | 0.0522 | 0.3872 | -61.2812% | webgpu-faster |
| totalCpuMs.count | 440.75 | 1,127.75 | 2.5587 | +155.8707% | unclassified |
| totalCpuMs.max | 4.575 | 3.175 | 0.694 | -30.6011% | webgpu-faster |
| totalCpuMs.mean | 1.8393 | 1.3409 | 0.729 | -27.1% | webgpu-faster |
| totalCpuMs.median | 1.8 | 1.3 | 0.7222 | -27.7778% | webgpu-faster |
| totalCpuMs.min | 1.5 | 1.075 | 0.7167 | -28.3333% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## meltdown-ramp (tier 4)

Completed samples: 8

| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| onePercentLowFps | 20.0569 | 41.4938 | 2.0688 | +106.8805% | webgpu-faster |
| frameBudget.measuredRefreshIntervalMs | 8 | 8 | 1 | +0% | tie |
| frameBudget.missedFrameRatio | 1 | 1 | 1 | +0% | tie |
| frameBudget.over16_67MsRatio | 1 | 0.1882 | 0.1882 | -81.1797% | webgpu-faster |
| frameBudget.over33_33MsRatio | 1 | 0 | 0 | -100% | webgpu-faster |
| frameBudget.over50MsRatio | 0.0446 | 0 | 0 | -100% | webgpu-faster |
| frameCount | 341.25 | 869.75 | 2.5487 | +154.8718% | unclassified |
| framesPerSecond | 22.7245 | 57.9631 | 2.5507 | +155.0688% | webgpu-faster |
| gpuFrameAvailabilityRatio | 1 | 0.5556 | 0.5556 | -44.4376% | webgpu-slower |
| gpuFrameMs.count | 341.25 | 483.25 | 1.4161 | +41.6117% | unclassified |
| gpuFrameMs.max | 45.5695 | 21.6171 | 0.4744 | -52.5625% | webgpu-faster |
| gpuFrameMs.mean | 44.0099 | 17.1946 | 0.3907 | -60.9302% | webgpu-faster |
| gpuFrameMs.median | 43.936 | 16.5435 | 0.3765 | -62.3464% | webgpu-faster |
| gpuFrameMs.min | 42.9417 | 15.7261 | 0.3662 | -63.378% | webgpu-faster |
| gpuFrameMs.p95 | 45.1668 | 21.099 | 0.4671 | -53.2865% | webgpu-faster |
| gpuFrameMs.p99 | 45.377 | 21.2774 | 0.4689 | -53.1098% | webgpu-faster |
| gpuFrameMs.standardDeviation | 0.6169 | 1.4563 | 2.3605 | +136.0492% | webgpu-slower |
| gpuHeadroomRatio | -4.6459 | -1.6374 | 0.3524 | +64.7562% | webgpu-faster |
| gpuTimerErrorCount | 0 | 0 | n/a | n/a | unclassified |
| renderCpuMs.count | 341.25 | 869.75 | 2.5487 | +154.8718% | unclassified |
| renderCpuMs.max | 1.375 | 1.375 | 1 | +0% | tie |
| renderCpuMs.mean | 0.7018 | 0.3834 | 0.5463 | -45.3714% | webgpu-faster |
| renderCpuMs.median | 0.7 | 0.4 | 0.5714 | -42.8571% | webgpu-faster |
| renderCpuMs.min | 0.5 | 0.2 | 0.4 | -60% | webgpu-faster |
| renderCpuMs.p95 | 0.9 | 0.5 | 0.5556 | -44.4444% | webgpu-faster |
| renderCpuMs.p99 | 1.075 | 0.675 | 0.6279 | -37.2093% | webgpu-faster |
| renderCpuMs.standardDeviation | 0.1145 | 0.097 | 0.8476 | -15.2357% | webgpu-faster |
| snapshotCpuMs.count | 341.25 | 869.75 | 2.5487 | +154.8718% | unclassified |
| snapshotCpuMs.max | 1.875 | 0.25 | 0.1333 | -86.6667% | webgpu-faster |
| snapshotCpuMs.mean | 1.1179 | 0.0435 | 0.0389 | -96.1072% | webgpu-faster |
| snapshotCpuMs.median | 1.1 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.min | 0.9 | 0 | 0 | -100% | webgpu-faster |
| snapshotCpuMs.p95 | 1.325 | 0.1 | 0.0755 | -92.4528% | webgpu-faster |
| snapshotCpuMs.p99 | 1.65 | 0.2 | 0.1212 | -87.8788% | webgpu-faster |
| snapshotCpuMs.standardDeviation | 0.1317 | 0.0534 | 0.4056 | -59.4444% | webgpu-faster |
| totalCpuMs.count | 341.25 | 869.75 | 2.5487 | +154.8718% | unclassified |
| totalCpuMs.max | 4.525 | 3.225 | 0.7127 | -28.7293% | webgpu-faster |
| totalCpuMs.mean | 1.8532 | 1.3482 | 0.7275 | -27.2512% | webgpu-faster |
| totalCpuMs.median | 1.8 | 1.3 | 0.7222 | -27.7778% | webgpu-faster |
| totalCpuMs.min | 1.5 | 1.1 | 0.7333 | -26.6667% | webgpu-faster |

20 additional metrics are available in `summary.json`.

## Artifacts

- `summary.json`: configuration, metadata, aggregates, and parity checks
- `samples.ndjson.gz`: gzip-compressed normalized record per completed backend sample
- `summary.md`: this human-readable report
- `acceptance.json`: per-machine stock, stability, timer, visual, and regression gates
- `baseline.json`: accepted current-protocol baseline projection for later compatible comparisons
- `manifest.json`: relative bundle inventory with SHA-256 checksums
