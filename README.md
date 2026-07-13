# Ripple Field Lab

A standalone GPU-heavy Vite prototype for a field of luminous hex cells that
ripple, glow, and throw particles when the player moves through them. Three.js/
WebGL remains the default renderer, with a raw-WebGPU runtime available for
explicit integration testing.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

Current version: `v0.5.3-2-ALPHA`.

## Quick Start

Windows:

```powershell
.\start.ps1
```

Linux/Ubuntu:

```bash
chmod +x ./start.sh
./start.sh
```

Open `http://127.0.0.1:5183`. The app starts on a main menu where you choose
`Training Run`, `Track`, or `Arena`. For development smoke tests,
`?mode=training`, `?mode=track`, and `?mode=arena` skip the menu and enter that
mode directly.

## Controls

- `W` / `S` move forward and backward.
- `A` / `D` turn left and right by default.
- `Q` / `E` strafe left and right.
- Hold left mouse button to orbit the camera without changing avatar facing.
- Hold right mouse button to orbit the camera and steer avatar facing together;
  while held, `A` / `D` strafe instead of turning.
- Hold both mouse buttons to move forward in the camera-facing direction.
- Mouse look supports a full 180-degree vertical orbit range from straight below
  the avatar to straight overhead.
- Releasing one mouse button downgrades to the remaining drag mode; releasing
  the last held scene mouse button restores the cursor.
- `Mouse wheel` zooms the follow camera in and out.
- `+` / `-` zoom in and out; `0` resets the camera distance.
- `Space` jumps high, with small takeoff and stronger landing ripples. Airborne
  movement preserves takeoff momentum instead of letting input redirect the
  trajectory mid-jump.
- `Shift` boosts from base pace with momentum.
- `F2` shows or hides the live performance overlay and top-left debug readout.
- `Esc` opens/closes the pause menu after a mode has started.
- The pause menu's version pill opens the in-app changelog.
- `Exit To Main Menu` returns to the mode-select splash and starts the next mode
  from a clean runtime state.
- The on-screen pulse button drops manual pulses on touch layouts.

## Startup Modes

The lab has three startup modes: `Training Run`, `Track`, and `Arena`.

`Training Run` is a short guided course warmup that teaches left-drag camera
orbit, right-drag steering, keyboard movement, boosting, both-button
camera-forward movement, momentum/braking, jumping, Echo collection, and track
wall sliding with a compact HUD and one scripted Echo.

Training uses the same course walls, track-only hex culling, and hidden circular
Arena shell as Track mode, but disables random Echo spawning so the lesson is
deterministic.

`Track` is the first racing prototype. The avatar drives on a wide ribbon inside
the arena, bright glowing translucent energy walls clamp the avatar back onto
the course, wall-contact preserves tangent speed while shaving outward momentum,
and Echoes spawn on the course.

Track mode also clips generated hexes to the course ribbon plus a safety skirt,
so off-track cells are skipped instead of animated every frame. It hides the
circular arena floor and outer arena barrier so the course reads as the active
play space instead of a path painted over the sandbox.

`Arena` is the full circular sandbox. The avatar uses the circular arena edge as
its boundary, Echoes spawn across the disc, and the entire circular hex field is
generated.

## Field And Visuals

The arena edge is rendered as a smooth glowing gradient barrier so the playable
boundary is visible in-world without looking like a tiled wall texture.

The hex field is drawn as a single shader-animated cap surface. The render path
keeps the field focused on lit hex caps for the upcoming spherical arena pass.

Meltdown uses a calibrated honeycomb footprint for visually interlocked tiny
hexes, while lighter quality modes keep more breathing room.

Raised wave crests carry an extra bounded glow signal, so ripple fronts bloom
brighter without washing out the whole field. Manual touch pulses have a short
shared cooldown so the on-screen pulse button does not flood the field.

The avatar is a strong-facing hover pod with a bright nose, side glow
fins, rear thrusters, and rear-biased energy motes, so player facing is readable
before movement starts.

Sparkling Echo columns spawn on the race track as real local light sources with
a bright inner orb, a vertically stretched diamond-shaped glow cloud, faster
core-local orbiting motes, and segmented fading trails.

Echo columns wait until the avatar runs through them, then detonate into a wider
pulse, a flat disc burst of sparks, and a short local orb-shatter effect without
geometric ring markers.

## Movement Model

Movement uses acceleration, braking, and carried momentum.

Base pace defaults to `10 m/s` and boost defaults to `37 m/s`, with grounded
acceleration, counter-steering, and release braking tuned for a more slide-y
feel. The pause menu's `Surface Grip` slider scales that grounded response from
slicker low-grip handling to tighter high-grip handling without changing base or
boost top speed.

The avatar behaves like a small body pushing through water: the shader forms a
pressed fabric depression, local bow/wake displacement, and small raised rim
around the avatar, while a dedicated GPU wake texture stores the lingering
height/velocity field left behind by movement.

The visible movement particle trail is a tight velocity-following tail.

Jumping fades that surface contact while the avatar is airborne, then landing
stamps a brighter impact ripple back into the field. Touch-button pulses and
collected Echoes use analytic ring sources; ordinary movement uses the GPU wake
texture for continuous surface response.

## Runtime Tuning

The Esc/hamburger pause menu changes quality, skybox theme, hex size, arena
radius, surface grip, ripple height/radius, Depth / Speed, particle density,
bloom strength, and the diagnostics readouts while the scene is running.

Hex size treats the current cell scale as `1m`, ranges from `25cm` to `2m`, and
measures the regular hexagon's widest point-to-point diameter. Changing it
rebuilds the instanced field after a short debounce so slider drags do not spam
geometry work.

Arena radius is expressed in lab meters: `200m` preserves the original scene
radius, while `400m` doubles it. Depth / Speed changes the medium's effective
depth, then shows the derived propagation speed from the shallow-water-inspired
`sqrt(g * depth)` model.

Arena mode clamps extreme hex-size/arena-radius combinations before rebuilding
the full circular field, using per-quality instance budgets so a casual slider
drag cannot spawn millions of visible hexes.

Track mode skips that full-disc coupling because it rebuilds only the course
ribbon plus safety skirt; switching back to Arena reapplies the guardrail before
the full disc is rebuilt. To intentionally run stress-test behavior, open the
app with `?stress=1` or set `localStorage.rippleStressMode = "1"`.

## HUD, Perf Overlay, And Skyboxes

The HUD keeps the title and active quality/mode badge visible during play. The
derived speed, hex diameter, arena radius, active pulse count, newest pulse
radius, and Echo count are hidden by default, then return with `F2` or the pause
menu Diagnostics toggle when propagation and scale tuning need a quick visual
sanity check.

The performance overlay is also hidden by default. When diagnostics are enabled,
it adds a
denser tuning cockpit with frame/update/render timing, active particles versus
resident budget, rendered pulse-source pressure, GPU wake texture mode/pass
cost, draw calls, triangles, pixel ratio, bloom state, quality mode, play mode,
and clipped-versus-full hex counts.

Skybox themes use the generated Cyberpunk Skyline, Aurora Observatory, Orbital
Megastructure, and Neon Arena Skyline panoramas on a camera-following dome.

Modern GPUs get 8K sky textures; lower texture-cap hardware falls back to 4K,
and the aurora/orbital themes have custom vertical framing so their horizons sit
closer to the arena instead of sinking below the play surface.

## Quality Modes

- `Clean`: lower hex density, no bloom, small particle budget.
- `Pretty`: default polished mode with bloom, shadows, pulse lights, and sparks.
- `Showoff`: denser field, more particles, stronger bloom and shadows.
- `Meltdown`: visually interlocked honeycomb hex density and intentionally
  excessive effects for GPU stress.

## Renderer Backends

Omitted renderer selection and `?renderer=auto` remain on Three/WebGL. Use
`?renderer=webgl` to request it explicitly. `?renderer=webgpu` forces the raw
WebGPU runtime; if the browser cannot initialize WebGPU, the app shows a visible
failure state and does not silently fall back.

Both backends use the current menu, playing, and paused lifecycle; bounded
fixed-step simulation; current base/boost controls; hover-pod behavior; mode
resets; hidden diagnostics; Track clipping; Echo reseeding; and Training HUD/
telemetry. Track and Training are course modes on both backends. In WebGPU they
upload the neutral course mask, render the packed additive course walls, and
disable the circular Arena curtain. Training also renders its neutral objective
marker and keeps random Echo spawning disabled.

The WebGPU readiness surface remains `diagnostic-core` and deliberately reports
`defaultEligible=false`. Its automated integration/readiness gaps are empty,
but automatic selection is held at rollout Stage 0 with a hard-zero cohort.
`renderer.rollout.decision` records the dormant policy decision while broader
hardware acceptance is gathered; explicit `webgl` and `webgpu` requests remain
immune to the cohort policy.

The current forced-WebGPU art direction is now named the `core` presentation
profile: the minimalist, WebGPU-native field/effect treatment used throughout
the port. It remains the only active WebGPU presentation and is explicitly
preserved. A future `classic` profile is reserved for closer Three/WebGL art
direction; it will not be exposed until it has a meaningful visual difference
and dedicated coverage.

### Renderer Presentation Audit

`npm.cmd run audit:render:parity` captures fixed-tick WebGL and WebGPU Core
fixtures for Pretty Arena, Showoff Track, and Pretty Training at 1280x720/DPR 1.
The command builds current sources and owns strict preview port `4184`. The
capture-only controller advances both simulations to exact ticks, freezes
animation, flushes GPU work, checks same-backend repeatability, and verifies
matching camera/player/mode/field state plus pulse-source, Echo, Track-mask,
wall-geometry, and Training-marker identity before producing image evidence. Set
`RIPPLE_PARITY_APP_URL` only when deliberately targeting an existing server.
External-server reports are marked `external-unverified` and are not attributed
to the current workspace commit.

Ignored results land under `parity-results/<timestamp>/` as raw PNGs, side-by-
side amplified-diff strips, `report.json`, and `summary.md`. Cross-renderer
histogram, coarse-luma, edge-density, and RGB-delta metrics guide review but do
not assert naive pixel equality. The tracked classification and remaining
fixtures live in `devlog/renderer-parity/README.md`.

### Renderer Benchmark

`npm.cmd run benchmark:renderers` builds production assets, starts the preview
server on `4183` when needed, and compares WebGL with WebGPU at a fixed
1280x720/DPR 1. It runs Pretty Arena, moving Showoff Track, and a five-tier
Meltdown field ramp with balanced backend order and four thermally rotated
repetitions.
Results are written under `benchmark-results/<timestamp>/` as `summary.json`,
`samples.ndjson.gz`, and `summary.md`. Set
`RIPPLE_BENCHMARK_CAPTURE_FIRST_REPETITION=1` when the standalone benchmark
also needs representative canvas captures.

The page-side benchmark API records RAF interval, update CPU, snapshot CPU,
render/submit CPU, and nonblocking GPU timer-query duration. The report also
captures browser, CPU, GPU/driver, adapter limits/features, power plan, measured
refresh interval, semantic workload parity, and the highest stable stress tier.

Useful overrides:

```powershell
$env:RIPPLE_BENCHMARK_CASES='pretty-arena,showoff-track-motion'
$env:RIPPLE_BENCHMARK_REPETITIONS='1'
$env:RIPPLE_BENCHMARK_BASELINE='benchmark-results\previous\baseline.json'
npm.cmd run benchmark:renderers
```

The v2 protocol/workload ID is
`renderer-benchmark-v2-flat-top-column-stagger`. A baseline must match that ID
and the fixed workload configuration before regression math runs. Compatible
same-hardware comparisons warn at a 10% p95 regression and fail at 20% or when
a stable Meltdown tier is lost. Compatible cross-hardware comparisons are
classified as informational; protocol or workload mismatches are incompatible
and include reasons. A same-hardware warning remains a warning in the comparison
report, but it blocks packaged acceptance and baseline promotion until reviewed.

For decision-grade cross-hardware evidence, run:

```powershell
$env:RIPPLE_CHROME_CHANNEL='chrome'
npm.cmd run benchmark:renderers:package
```

The package command refuses a dirty Git tree, checks out the recorded commit in
a temporary detached source worktree, runs `npm ci` from that commit's lockfile,
builds those exact production assets, and owns the strict preview on
`127.0.0.1:4183`; an existing listener is an error.
It launches stable Chrome without fallback, verifies stock no-flags WebGPU in
Arena, Track, and Training, completes a 120-second stock soak, then runs the
fixed seven-case instrumented benchmark for four repetitions with 5-second
warmup and 15-second sample windows. Acceptance requires complete sample-window
coverage, semantic parity, the same WebGPU adapter in stock and instrumented
phases, healthy stock modes/soak, no browser errors, device loss, or fallback,
stable WebGPU Pretty and Showoff samples, at least 25% fresh GPU timer coverage,
zero timer errors, and bounded stock canvas metrics. The branch, HEAD, and clean
state are checked again before the acceptance decision.

Each accepted package contains only relative artifact paths: `manifest.json`,
`acceptance.json`, `baseline.json`, `summary.json`, `summary.md`,
`samples.ndjson.gz`, stock captures, and first-repetition renderer captures.
The manifest records SHA-256 and byte size for every payload file and verifies
the run, protocol, workload, sample count, and source-commit relationships
across the bundle. An optional comparison baseline is copied into the package
and checksummed. Physical hardware and actual selected adapters are separated
from browser/driver/runtime metadata, raw Windows PNP IDs are excluded, and
portable failures omit local paths and stacks.

`RIPPLE_BENCHMARK_PACKAGE_TEST=1` selects a deterministic shortened profile
with one repetition and a 1.5-second soak for tooling verification. A healthy
test run reports `test-only-passed`, `decisionGrade=false`, and an ineligible
baseline projection. It is intentionally incompatible with a full acceptance
baseline and is not cross-hardware evidence.

The July 11 RTX 4070 Ti note is retained as superseded historical evidence: it
was captured from a dirty pre-column-stagger tree and must not be used as a v2
baseline. The accepted replacement is tracked under
`devlog/benchmark-baselines/rtx-4070-ti-2026-07-12-73df45e/`. Its clean stable-
Chrome package passed all 28 semantic pairs and all acceptance gates; WebGPU
remained stable through Meltdown tier 4 while WebGL reported no stable Meltdown
tier under the strict measured-refresh budget. `auto` nevertheless remains
WebGL at the Stage-0 zero-percent rollout.

## Development

```powershell
npm.cmd install
npm.cmd run debug:logs
npm.cmd run diagnostics
npm.cmd run typecheck
npm.cmd run build
npm.cmd run validate
npm.cmd run verify:render:webgl
npm.cmd run verify:webgpu:capabilities
npm.cmd run verify:render:webgpu
npm.cmd run verify:render:webgpu:stock
npm.cmd run verify:render:webgpu:unavailable
npm.cmd run verify:render:webgpu:soak
npm.cmd run verify:render:webgpu:readiness
npm.cmd run verify:render:webgpu:default-soak
npm.cmd run verify:renderer:auto-rollout
npm.cmd run verify:hex-lattice
npm.cmd run verify:benchmark:reporting
npm.cmd run audit:render:parity
npm.cmd run benchmark:renderers
npm.cmd run benchmark:renderers:package
```

Local runs emit debug logs for Echo detonations, including particle burst counts
and frame timings around collection. Broader frame warnings cover stalls outside
the Echo watch window and use
`frame.renderHitch`, `frame.updateHitch`, `frame.mixedHitch`, and
`frame.clockGap` channels so true render pressure is not blended with
sleep/reload/browser clock gaps. Console lines include inline JSON so Chrome
automation can read numeric payloads directly. In DevTools, call
`window.__rippleDebugDump()` to inspect the retained in-page log.

For file-backed local logging, run `npm.cmd run debug:logs` in a second terminal.
The browser batches debug events to
`http://127.0.0.1:5184/__ripple_debug_log`; the receiver appends JSONL under
`logs/` and exposes `http://127.0.0.1:5184/tail?limit=80` for quick inspection.
Use `http://127.0.0.1:5184/summary?format=text` for an immediate diagnostics
summary, or add filters such as `?source=latest&channel=frame.renderHitch`.
`npm.cmd run diagnostics` prints the same kind of summary for the newest JSONL
file, while `npm.cmd run verify:perf` applies broad alpha-era thresholds for
obvious runaway frame/rebuild costs.
Set `localStorage.rippleDebug = "0"` or open `?debug=0` to silence browser
debug logging. Set `localStorage.rippleLogServer = "0"` or open `?logServer=0`
to keep console logging on while disabling the local receiver writes.

Dedicated ports:

- Dev server: `5183`
- Debug log receiver: `5184`
- Preview server: `4183`

Project planning:

- `TODO.md` tracks concrete high-priority and medium-priority follow-up work.
- `SPITBALL_IDEAS.md` keeps loose visual, interaction, and engine ideas separate
  from the committed roadmap.

Versioning:

- While the project is still experimental, release tags use alpha prerelease
  labels. The current baseline is `v0.5.3-2-ALPHA`.

## Design Notes

- `src/main.ts` owns the app-level state split between the startup menu,
  gameplay, and pause, including clean mode starts, `?mode=` shortcuts,
  mode-specific player/Echo/runtime resets, course-mode scale guardrail bypass,
  Training Run lifecycle, and Echo reseeding after play-area rebuilds.
- `src/render/rendererMode.ts` owns conservative backend selection;
  `src/render/threeRenderRuntime.ts` wraps the current WebGL renderer, while
  `src/render/webGpuApp.ts` adapts the same gameplay lifecycle and neutral state
  into `src/render/webGpuRenderRuntime.ts`.
- `src/render/types.ts` defines renderer-neutral frame, Track wall/mask,
  Training marker, scene, and stats contracts. Raw-WebGPU modules consume those
  contracts and do not import `RaceTrack`.
- `src/render/webGpuTrackWallPass.ts` and
  `src/render/webGpuTrainingMarkerPass.ts` own the additive course-wall and
  objective-marker passes that read the shared field depth.
- `src/trainingRun.ts` owns the guided Training Run director: step definitions,
  current objective checks, marker placement, scripted Echo requests, completion
  pulse trigger, tutorial HUD state, and `training.*` diagnostics.
- `src/raceTrack.ts` owns the first racing-game layer: the hardcoded
  non-crossing sweeping loop, wide-ribbon collision, bright glowing course
  walls, generated surface mask, field-placement clip queries, and sparse
  `track.*` diagnostics.
- `src/rippleField.ts` owns the circular shader-displaced instanced hex field,
  including the local bow deformation around the moving avatar, sampled GPU
  wake texture displacement, optional track-mode placement clipping, the
  generated race-track mask highlight, and shader-side hex footprint/height
  scaling. It renders the lit cap surface, calibrates Meltdown into an
  interlocked honeycomb, and tints cells by animated height so raised caps push
  toward white while troughs stay darker. Wave crests have their own glow varying
  so peak brightness can be tuned separately from generic player-proximity glow.
- `src/arenaBarrier.ts` owns the Arena-only visual glowing arena-edge gradient
  that follows the live arena radius without changing collision behavior.
- `src/skybox.ts` owns the selectable camera-following sky dome, high-res versus
  fallback texture selection, per-theme vertical framing, and fog tuning. The
  current generated skybox assets live in `public/skyboxes/`.
- `src/wakeField.ts` owns the ping-pong GPU wake heightfield for movement,
  including capability fallback, quality-sized render targets, and sampled
  `wake.*` diagnostics.
- `src/rippleSources.ts` keeps the lifetime-pruned manual/Echo pulse list sent
  to the GPU, including per-source speed, width, damping, and lifetime.
- `src/debugLog.ts` owns the local diagnostic log buffer, inline JSON console
  logging, and optional batching to the `5184` debug receiver used to profile
  Echo detonations and frame spikes.
- `src/echoZones.ts` owns persistent collectible Echo-column lights, bright orb
  lights, vertical diamond-style orb mist, avatar-style segmented crystal orbit
  trails, and their run-through trigger/despawn burst detection.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/labSettings.ts` maps UI meters onto the original scene-unit art scale,
  including surface grip defaults, hex point-to-point diameter scaling, and the
  200m-to-400m arena radius range.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, layered Echo poof-disc bursts, bright shader energy, and tight
  velocity-following wake tails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, the optional play-area constraint hook
  used by the track, circular arena fallback clamping, scene-input gating while
  menus are open, split left/right hold-to-look pointer-lock behavior,
  camera-only orbit yaw, right-drag steering yaw, WoW-style keyboard
  turning/strafe semantics, surface-grip handling response, ballistic airborne
  horizontal momentum, both-button camera-forward movement, full 180-degree
  vertical camera orbit, quiet mouse-release unlocks, and read-only tutorial
  telemetry. The avatar visuals in `src/main.ts` use orbiting motes and
  segmented additive trails.

The CPU decides where the player, touch-button pulses, optional race-track
constraint, and persistent Echo zones are. Manual pulse input is cooldown-gated,
Echo zones only become pulse sources after collection, and pulse sources age out
by per-source lifetime. Movement wake is fed into a small GPU height/velocity
texture. The GPU handles wake propagation, hex lift, stretch, tint, emissive
glow, track-surface highlight, and cell footprint/height from the wake texture
plus the newest rendered pulse uniforms, with dense fields allowed to render
fewer pulse sources than the full gameplay source list contains.
