# Crystallized Memory

Reconstructed from surviving repository source and tracked evidence on
2026-11-07; no earlier memory-file contents were recovered.

- This is a standalone ripple-field visual lab with a developing racing
  prototype. Training teaches the movement kit, Track supplies a constrained
  course, and Arena retains the sandbox. Checkpoints/laps remain backlog.
  Keep the lab standalone; possible reuse in `voxel-sandbox-engine` means
  harvesting patterns rather than merging it wholesale. See [TODO](TODO.md).
- `src/main.ts` and `src/render/webGpuApp.ts` have separate app orchestration
  and frame loops. They reuse `PlayerRig`, `TrainingRun`, state owners, and
  neutral render snapshots; there is no single shared gameplay loop. Preserve
  momentum-heavy handling, Track containment, named deterministic streams,
  and the shared contracts. The [code map](CODEBASE_INDEX.md) routes to owners.
- WebGL is the default; Stage-0 automatic rollout remains a zero-percent
  cohort with `defaultEligible=false`. WebGPU is explicit and fails visibly
  when unavailable. Classic 3D is its default presentation/parity candidate;
  Core preserves the minimalist flat-cap style. Both now share WebGL-matched
  source/wake dynamics and pulse lifetimes. Reduce visual differences through
  Classic without flattening its geometry or erasing Core's supported style.
- Semantic parity and presentation parity are separate claims. The tracked
  [presentation matrix](devlog/renderer-parity/README.md) records historical
  deterministic state coverage and residual Classic visual decisions. Image
  differences require review; current-machine browser coverage must be rerun.
- The accepted historical Classic benchmark is clean commit
  `efda975f5a1f0a9a7c95898fb537e719fb50623b` on an RTX 4070 Ti, protocol
  `renderer-benchmark-v3-classic-3d-tiles`: 56 samples, 28 semantic pairs, stock
  mode checks, and a 120-second soak passed. Tier 4 averaged about 58 FPS on
  WebGPU versus 23 on WebGL, but the strict Meltdown stability classifier
  reached only tier 1. This is historical evidence, not a current measurement.
  The [baseline registry](devlog/benchmark-baselines/README.md) owns the full
  protocol and comparison rules; v2 flat-Core evidence is intentionally
  incompatible with v3 Classic, and the July 11 dirty run is superseded.
- Accepted projections, summaries, acceptance records, and checksum manifests
  are tracked; generated portable bundles and parity captures are ignored
  local artifacts. A surviving manifest is a record of an accepted bundle,
  not proof that its payload is currently present. New benchmark acceptance
  requires a clean committed source revision and the complete package gates.

Use [WORKING_MEMORY](WORKING_MEMORY.md) for the current handoff, [TODO](TODO.md)
for concrete work, and the [idea collection](SPITBALL_IDEAS.md) for possibilities.
