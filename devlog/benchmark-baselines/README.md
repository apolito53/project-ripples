# Renderer Benchmark Baselines

This directory is the registry for accepted cross-hardware renderer benchmark
evidence.

## Accepted Baselines

- `rtx-4070-ti-2026-07-14-efda975/` is the first accepted v3 Classic 3D
  baseline. It was produced from clean commit
  `efda975f5a1f0a9a7c95898fb537e719fb50623b` with stable Chrome on an RTX
  4070 Ti. All 56 samples, 28 semantic pairs, stock Arena/Track/Training checks,
  and the 120-second stock soak passed. Pretty and Showoff remained stable near
  127 FPS; the strict 8 ms Meltdown classifier reached tier 1. At tier 4,
  WebGPU still averaged 58 FPS and 17.19 ms GPU time versus WebGL's 23 FPS and
  44.01 ms, but tier 4 is intentionally not classified as stable.
- `rtx-4070-ti-2026-07-12-73df45e/` is the first accepted v2 baseline. It was
  produced from clean commit `73df45e5c61ef87a69f92c26c1847144b24838ea`
  with stable Chrome on an RTX 4070 Ti. It contains the accepted comparison
  projection, acceptance gates, full-bundle checksum manifest, and human report.
  The ignored local portable bundle additionally retains compressed samples,
  `summary.json`, and representative captures. It measured the older flat Core
  field and is historical evidence only after the Classic 3D profile became the
  forced-WebGPU default.

Use the v3 `baseline.json` for current Classic regression math. Do not use the
v2 projection; its protocol/workload mismatch is intentional and machine-
classified as incompatible.

The required protocol/workload is
`renderer-benchmark-v3-classic-3d-tiles`. Create evidence only with:

```powershell
$env:RIPPLE_CHROME_CHANNEL='chrome'
npm.cmd run benchmark:renderers:package
```

The command must start from a clean committed tree. It installs dependencies
with `npm ci` and builds a detached worktree at that commit, then rechecks branch,
HEAD, status, and source metadata
before deciding acceptance. A candidate is eligible only when
`acceptance.json` is decision-grade and passes every gate and `manifest.json`
verifies every payload checksum plus cross-file protocol/workload/run coherence.
Keep the portable run bundle together; `baseline.json` is the comparison input
for later compatible runs, while `acceptance.json`, `summary.json`, compressed
samples, and captures preserve its provenance.

Compatible same-hardware comparisons apply the 10% warning and 20% failure
thresholds plus stable-tier continuity. Compatible different hardware is
informational. Protocol, workload, full/test profile, or fixed-configuration
mismatches are incompatible and must not reach regression math. A comparison
warning remains visible as a warning but blocks package acceptance and baseline
promotion.

`RIPPLE_BENCHMARK_PACKAGE_TEST=1` exercises the packaging machinery with a
short profile. It must report `test-only-passed`, `decisionGrade=false`, and
`baseline.json` with `eligible=false`; never promote that projection.

`../WEBGPU_BENCHMARK_BASELINE_2026-07-11.md` is superseded historical evidence
from a dirty pre-column-stagger tree. It is deliberately not copied here as a
replacement baseline.
