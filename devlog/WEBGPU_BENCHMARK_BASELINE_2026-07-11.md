# WebGPU Renderer Baseline - 2026-07-11

> **Superseded historical evidence.** This run came from a dirty worktree before
> commit `8caa734` corrected the flat-top lattice to stagger columns. Its
> workload geometry and provenance do not satisfy
> `renderer-benchmark-v2-flat-top-column-stagger`; do not use it as a regression
> baseline or as permission to change renderer rollout policy.

This was the first comparative RTX 4070 Ti run for the WebGPU integration
candidate. The numbers remain useful only as historical context.

## Environment

- GPU: NVIDIA GeForce RTX 4070 Ti, driver `32.0.15.9186`
- CPU: Intel Core i9-13900KF, 32 logical processors
- Memory: 32 GiB
- Power plan: Balanced
- Browser: headless Chrome 150
- Viewport: 1280x720 at DPR 1
- Blank-page display interval: 7.9 ms
- App version: `v0.5.3-2-ALPHA`

## Protocol

- Production Vite build and preview server
- Four repetitions per workload
- Exactly balanced WebGL/WebGPU first-run order
- Thermally rotated workload order
- 5 second warmup and 15 second sample windows
- Deterministic scripted Arena/Track motion and pulse schedule
- Pairwise field, particle-budget/pressure, source, Echo, speed, viewport,
  bloom, shadow, and device-state checks
- Nonblocking WebGL disjoint timer queries and WebGPU timestamp queries
- Unique-result sequence accounting with timer error and coverage gates

All 28 paired semantic checks passed. GPU timer errors were zero. Minimum fresh
result coverage was 59% for WebGL and 92% for WebGPU.

## Results

| Workload | Cells | WebGL GPU p95 | WebGPU GPU p95 | WebGPU / WebGL | WebGL CPU p95 | WebGPU CPU p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pretty Arena | 26,853 | 5.694 ms | 1.430 ms | 0.251x | 1.300 ms | 0.700 ms |
| Showoff Track motion | 43,876 | 5.558 ms | 1.894 ms | 0.341x | 1.400 ms | 0.800 ms |
| Meltdown tier 0 | 205,901 | 7.658 ms | 2.903 ms | 0.379x | 1.800 ms | 1.400 ms |
| Meltdown tier 1 | 365,785 | 10.014 ms | 3.656 ms | 0.365x | 1.900 ms | 1.400 ms |
| Meltdown tier 2 | 822,167 | 19.964 ms | 3.223 ms | 0.161x | 1.975 ms | 1.475 ms |
| Meltdown tier 3 | 1,284,157 | 30.117 ms | 2.823 ms | 0.094x | 2.000 ms | 1.450 ms |
| Meltdown tier 4 | 1,677,033 | 38.722 ms | 3.650 ms | 0.094x | 2.050 ms | 1.450 ms |

Under the strict stable-tier gate, WebGPU remained stable through tier 4.
WebGL did not keep Meltdown tier 0 below 90% of the measured 7.9 ms display
budget, so its Meltdown stable tier is reported as `none`. Normal Pretty and
Showoff workloads still remained animated and nonblank on both backends.

## Artifacts

The untracked local evidence lives under:

`benchmark-results/2026-07-11T04-43-49-415Z-pid-16668/`

Do not pass this run's `summary.json` to `RIPPLE_BENCHMARK_BASELINE`. The clean
accepted replacement is
`benchmark-baselines/rtx-4070-ti-2026-07-12-73df45e/baseline.json`, produced by
the full packaged protocol from commit `73df45e`.
