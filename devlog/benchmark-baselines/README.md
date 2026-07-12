# Renderer Benchmark Baselines

This directory is the registry for accepted cross-hardware renderer benchmark
evidence. There is currently no accepted v2 baseline checked in.

The required protocol/workload is
`renderer-benchmark-v2-flat-top-column-stagger`. Create evidence only with:

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
