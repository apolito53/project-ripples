# WebGPU Main Integration Path Ledger

Temporary review artifact for `codex/webgpu-core-integration`. Leave this file
in the worktree for main-agent review.

Source baselines:

- Current-main authority: `c432636` in this worktree.
- Archived renderer reference: `788cfdb` in the read-only `664d` worktree.
- Version remains `v0.5.3-2-ALPHA`.

## Rules Applied

- Current `main.ts`, `controls.ts`, docs, lockfile, and styles were not copied
  wholesale from the archive.
- Current main remains authoritative for lifecycle, timing, controls, Training,
  hover-pod behavior, resets, diagnostics visibility, clipping, and reseeding.
- `RaceTrack` remains the CPU gameplay owner; renderer modules receive neutral
  mask and packed wall snapshots only.
- Omitted/auto stays WebGL. Forced WebGPU fails visibly without fallback.

## Path Ledger

| Target path | Source/action | Status |
| --- | --- | --- |
| `scripts/ripple-smoke-harness.mjs`, `scripts/smoke.mjs`, `scripts/start-dev.mjs` | Archive tooling imported, then reviewed against current ports/policy | Complete |
| `scripts/verify-render.mjs` | Archive verifier base adapted for current Arena/Track/Training lifecycle, base/boost controls, policy, and long gates | Complete |
| `scripts/debug-log-analysis.mjs` | Selectively imported finite-number parsing guard used by verifier diagnostics | Complete |
| `src/render/*` | Archive renderer baseline integrated behind current policy; contracts/runtime extended for course and Training passes | Complete |
| `src/ripple/*`, `src/particle/*`, `src/wake/*` | Archived raw-WebGPU modules imported behind neutral contracts | Complete |
| `src/echoState.ts`, `src/particleState.ts`, `src/rippleFieldLayout.ts` | Archived neutral state/layout bases imported and parity-reviewed | Complete |
| `src/echoZones.ts` | Added neutral Echo snapshots and clear adapter while preserving current visuals/gameplay | Complete |
| `src/particleVeil.ts` | Added neutral state adapter and delta-based wake emission while preserving current effects/budgets | Complete |
| `src/rippleField.ts` | Added neutral render-input adapter while preserving current WebGL shader and course clipping | Complete |
| `src/rippleSources.ts` | Added renderer-neutral snapshot while preserving WebGL uniform upload | Complete |
| `src/wakeField.ts` | Added WebGL backend adapter while preserving current wake behavior/diagnostics | Complete |
| `src/raceTrack.ts` | Added optional Three scene plus neutral versioned RGBA mask and packed wall snapshots | Complete |
| `src/trainingRun.ts` | Added optional Three scene, independent marker transform, and neutral presentation snapshot | Complete |
| `src/main.ts` | Hand-integrated renderer policy and WebGL runtime wrapper into current lifecycle | Complete |
| `src/debugLog.ts` | Added configurable local receiver endpoint and fixed shared-payload serialization | Complete |
| `src/controls.ts` | Current main retained without edits | Complete, no change required |
| `src/styles.css`, `index.html` | Current main retained without edits | Complete, no change required |
| `package.json` | Selectively merged scripts and WebGPU/Playwright tooling; version preserved | Complete |
| `package-lock.json` | Regenerated with npm from the merged manifest; archive lockfile not copied | Complete |
| `tsconfig.json` | Added WebGPU ambient types | Complete |
| `README.md`, `CODEBASE_INDEX.md`, `TODO.md`, `CHANGELOG.md` | Reconciled from current main under Unreleased; version preserved | Complete |

## Training Parity Paths

| Target path | Purpose | Status |
| --- | --- | --- |
| `src/render/webGpuTrackWallPass.ts` and `.wgsl` | Packed left/right course walls, one additive draw, explicit layout, shared field depth | Complete |
| `src/render/webGpuTrainingMarkerPass.ts` and `.wgsl` | Two cyan posts, magenta beam, center glow, one additive draw, explicit layout, shared field depth | Complete |

## Validation Ledger

All browser checks used the isolated worktree servers on app/log ports
`25183`/`25184`; pre-existing shared servers on `5183`/`5184` and
`15183`/`15184` were left untouched.

| Check | Status |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run build` | Passed; Vite large-chunk warning only |
| `npm.cmd run verify:render:webgl` | Passed: default/auto, Arena/Track/Training, step 1 to 2 drag, menu transitions |
| `npm.cmd run verify:webgpu:capabilities` | Passed |
| `npm.cmd run verify:render:webgpu` | Passed: Arena/Track/Training, walls/marker, step 1 to 2 drag, menu transitions |
| `npm.cmd run verify:render:webgpu:unavailable` | Passed; visible failure and no fallback |
| `npm.cmd run verify:render:webgpu:soak` | Passed, 22-second movement window |
| `npm.cmd run verify:render:webgpu:readiness` | Passed, 60-second readiness window |
| `npm.cmd run verify:render:webgpu:default-soak` | Passed, two-minute default-readiness window with empty gaps |
| `npm.cmd run validate` (`typecheck`, `build`, `smoke`) | Passed; Vite large-chunk warning only |
| Final WebGL/WebGPU fast browser replay after boundary cleanup | Passed |
| `git diff --check` | Passed |

## Post-Implementation Review

- Two independent read-only review agents were started as planned, but both
  exhausted their service quota before returning findings.
- Main-agent review removed gameplay-to-render type coupling, prevented the
  headless WebGPU course and Training state from allocating unused Three visual
  resources, and restored the approved `training.webgpu.*` diagnostic names.
- The complete validation ledger above was replayed after those corrections on
  isolated `25183`/`25184`; all checks remained green.
