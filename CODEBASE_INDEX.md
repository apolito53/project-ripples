# Codebase Index

Last reviewed: 2026-07-18

Purpose: compact map for the standalone ripple-field visual lab.

## Stack

- Vite + strict TypeScript browser app.
- Three.js/WebGL default renderer plus a forced raw-WebGPU runtime, neutral
  render snapshots, WebGPU compute/render passes, postprocessing bloom,
  shader-customized `InstancedMesh`, additive `Points`, and dynamic lights.
- Current alpha baseline: `v0.5.5-ALPHA`; keep release tags in alpha prerelease
  territory until the lab graduates from prototype status.
- Dedicated dev port `5183`; benchmark preview port `4183`; strict renderer
  presentation-audit preview port `4184`.

## Commands

- Install: `npm.cmd install`
- Windows start: `.\start.ps1`
- Linux/Ubuntu start: `chmod +x ./start.sh && ./start.sh`
- Dev server: `npm.cmd run dev`
- Debug log receiver: `npm.cmd run debug:logs` on `127.0.0.1:5184`
- Latest JSONL diagnostics summary: `npm.cmd run diagnostics`
- Broad alpha perf gate over the newest JSONL: `npm.cmd run verify:perf`
- Type check: `npm.cmd run typecheck`
- Production build: `npm.cmd run build`
- Standard validation: `npm.cmd run validate`
- Browser WebGL lifecycle smoke: `npm.cmd run verify:render:webgl`
- Deterministic WebGL/WebGPU controller contract: `npm.cmd run verify:gamepad`
- Browser WebGPU capability smoke: `npm.cmd run verify:webgpu:capabilities`
- Browser forced-WebGPU lifecycle smoke: `npm.cmd run verify:render:webgpu`
- Browser preserved WebGPU Core profile and live Classic switch smoke:
  `npm.cmd run verify:render:webgpu:core`
- Browser stock-Chrome WebGPU smoke without unsafe/blocklist flags:
  `npm.cmd run verify:render:webgpu:stock`
- Browser forced-WebGPU unavailable smoke:
  `npm.cmd run verify:render:webgpu:unavailable`
- Browser forced-WebGPU movement soak:
  `npm.cmd run verify:render:webgpu:soak`
- Browser forced-WebGPU readiness run:
  `npm.cmd run verify:render:webgpu:readiness`
- Browser forced-WebGPU two-minute default soak:
  `npm.cmd run verify:render:webgpu:default-soak`
- Browser forced-WebGPU terminal device-loss path:
  `npm.cmd run verify:render:webgpu:device-lost`
- Dormant auto-rollout policy verifier:
  `npm.cmd run verify:renderer:auto-rollout`
- WebGPU presentation policy verifier:
  `npm.cmd run verify:renderer:presentation-profile`
- Browser-harness checkout provenance verifier:
  `npm.cmd run verify:smoke-harness`
- Flat-top honeycomb geometry invariant: `npm.cmd run verify:hex-lattice`
- Benchmark statistics/parity regression verifier:
  `npm.cmd run verify:benchmark:reporting`
- Fixed-tick WebGL/WebGPU presentation audit with paired captures and diffs:
  `npm.cmd run audit:render:parity`
- Fixed-tick WebGL/preserved-Core presentation audit:
  `npm.cmd run audit:render:parity:core`
- Full deterministic Classic parity-closure matrix:
  `npm.cmd run audit:render:parity:closure`
- Production WebGL/WebGPU comparative benchmark:
  `npm.cmd run benchmark:renderers`
- Clean-tree cross-hardware acceptance package with stock Chrome checks,
  120-second soak, instrumented benchmark, captures, and checksums:
  `npm.cmd run benchmark:renderers:package`

## Fast Lookup

- HTML shell, startup mode menu, Training HUD, pause menu, changelog dialog,
  performance overlay, and tuning controls: `index.html`
- Visual styling and overlay layout: `src/styles.css`
- Renderer-neutral field-palette policy and accessible pause-menu tab wiring:
  `src/fieldPalette.ts` and `src/pauseMenuTabs.ts`
- App bootstrap, startup `Training`/`Arena`/`Track` mode selection, session
  reset flow, Three.js scene, render loop, quality wiring, and postprocessing:
  `src/main.ts`
- Conservative renderer policy, WebGL runtime wrapper, forced-WebGPU lifecycle,
  neutral contracts, and raw-WebGPU pass orchestration: `src/render/rendererMode.ts`,
  `src/render/presentationProfile.ts`, `src/render/threeRenderRuntime.ts`, `src/render/webGpuApp.ts`,
  `src/render/types.ts`, and `src/render/webGpuRenderRuntime.ts`
- Browser harness provenance and server-pair ownership:
  `scripts/ripple-smoke-harness.mjs`; explicit runs provide all four
  `RIPPLE_APP_URL`/`RIPPLE_LOG_*_URL` values together.
- Deterministic browser gamepad injection and shared-backend controller
  acceptance plus reusable fixed-tick fixture input:
  `scripts/verify-gamepad.mjs` and `scripts/gamepad-fixture-harness.mjs`
- Stage-0 cohort/cooldown policy, benchmark recorder, and nonblocking GPU timers:
  `src/render/rendererRollout.ts`, `src/render/renderBenchmark.ts`, and
  `src/render/gpuFrameTimer.ts`
- Capture-only deterministic simulation control and renderer state descriptions:
  `src/render/renderVisualCapture.ts`, `src/main.ts`, and
  `src/render/webGpuApp.ts`
- Named renderer-neutral random streams for capture, benchmark, and normal
  sessions: `src/randomStream.ts` and `src/render/renderRandom.ts`
- WebGPU course-wall and Training marker passes with explicit layouts and shared
  field depth: `src/render/webGpuTrackWallPass.ts` and
  `src/render/webGpuTrainingMarkerPass.ts` plus their WGSL shaders
- Renderer-neutral Echo, particle, ripple-source, field-layout, wake, Track
  mask/wall, and Training presentation state: `src/echoState.ts`,
  `src/particleState.ts`, `src/rippleFieldLayout.ts`, `src/rippleSources.ts`,
  `src/raceTrack.ts`, and `src/trainingRun.ts`
- Renderer-neutral flat-top honeycomb spacing and stagger math:
  `src/hexLattice.ts`
- Selectable camera-following sky dome, 8K/4K generated skybox texture loading,
  horizon framing, and per-theme fog tuning: `src/skybox.ts` plus
  `public/skyboxes/`
- HUD formatting and cause-specific frame-hitch payload assembly:
  `src/frameTelemetry.ts`
- Field scale instance-budget clamp decisions:
  `src/fieldScaleGuardrails.ts`
- Momentum-based avatar movement with visible surface-grip tuning, higher
  carried ground momentum, jump/landing state, hidden speed-tuning defaults,
  optional track/play-area constraint, circular arena fallback clamp,
  scene-input gating, split left/right hold-to-look pointer lock,
  camera/player yaw separation, mouse-only both-button camera-forward movement,
  controller-only camera-relative analog movement, gently returning follow
  camera, per-stick sensitivity, and B-button braking, WoW-style turn/strafe key semantics, ballistic
  airborne horizontal momentum, full 180-degree
  vertical camera orbit, quiet mouse-release unlocks, and camera follow behavior:
  `src/controls.ts`
- Reconnect-safe standard-mapped controller polling, radial stick dead zones,
  consumable button edges, held menu-navigation repeat, controller selection,
  sparse diagnostics, and guarded dual-rumble haptics: `src/gamepadInput.ts`
- Circular shader-displaced instanced hex field, including optional track-mode
  placement clipping, sampled GPU movement wake displacement,
  Meltdown-calibrated honeycomb orientation, lit hex caps, generated race-track
  mask tinting, animated-height cell tinting, and bounded crest-specific glow:
  `src/rippleField.ts`
- Ping-pong GPU movement wake heightfield, absorbing edge band, residual-wave
  damping, fallback texture, quality-sized render targets, and `wake.*`
  diagnostics: `src/wakeField.ts`
- Arena-only smooth glowing arena-edge gradient barrier: `src/arenaBarrier.ts`
- Wide prototype race-track loop, non-crossing ribbon and wall-edge sampling,
  ribbon collision, bright glowing edge walls, generated track mask texture,
  course Echo placement helpers, field-cell containment queries, and `track.*`
  diagnostics: `src/raceTrack.ts`
- Guided Training Run director, tutorial objective gate, compact HUD state,
  scripted Echo request, completion pulse trigger, and `training.*`
  diagnostics: `src/trainingRun.ts`
- Visible cyan/magenta spotlight fixtures, stage floor, core scene lighting,
  active hover-pod avatar visuals, and shelved legacy glow-orb avatar:
  `src/main.ts`
- Lifetime-pruned manual/Echo pulse source list and shader uniform writer:
  `src/rippleSources.ts`
- Persistent collectible Echo-column lights, bright orb lights, vertical
  diamond-style orb mist, avatar-style segmented crystal orbit trails, and
  pooled run-through collection bursts:
  `src/echoZones.ts`
- Player sparkle aura, adaptive continuous emission, additive particle bursts,
  shader brightness/energy, tight velocity-following wake tails, and narrowed
  static attribute uploads:
  `src/particleVeil.ts`
- Recent-pulse point light pool: `src/pulseLights.ts`
- Quality preset budgets and labels: `src/qualityPresets.ts`
- Runtime settings shape/defaults, surface-grip defaults, and
  lab-meter-to-scene-unit scale mapping:
  `src/labSettings.ts`
- Wave-medium settings and derived propagation speed: `src/waveMedium.ts`
- Local diagnostic log buffer and console profiler hooks: `src/debugLog.ts`
- Tiny local debug receiver and JSONL writer: `scripts/debug-log-server.mjs`
- JSONL diagnostics parser shared by the receiver and CLI:
  `scripts/debug-log-analysis.mjs`
- Newest-log diagnostics CLI: `scripts/analyze-debug-log.mjs`
- Comparative benchmark runner, v3 Classic-3D reporting/baseline protocol, stock acceptance,
  portable package support/orchestration, and focused verifier:
  `scripts/benchmark-renderers.mjs`, `scripts/benchmark-reporting.mjs`,
  `scripts/benchmark-stock-acceptance.mjs`, `scripts/benchmark-package.mjs`,
  `scripts/package-renderer-benchmark.mjs`, and
  `scripts/verify-benchmark-reporting.mjs`
- Fixed-tick presentation capture/reporting, compact pulse-lifecycle evidence,
  expanded parity-closure fixtures, and non-gating image comparison:
  `scripts/audit-renderer-parity.mjs`, `scripts/renderer-parity-fixtures.mjs`,
  `scripts/render-parity-analysis.mjs`, and `devlog/renderer-parity/README.md`
- Classic 3D/Core field pipelines, procedural prism geometry, profile-specific
  wave transfer, and profile diagnostics: `src/ripple/webGpuRippleFieldPreview.ts` and
  `src/ripple/webGpuRippleFieldPreview.wgsl`
- Rollout policy checks: `scripts/verify-renderer-rollout.mjs`
- Benchmark baseline registry, accepted RTX 4070 Ti v3 Classic evidence,
  historical v2 Core evidence, and superseded pre-column-stagger evidence:
  `devlog/benchmark-baselines/README.md`,
  `devlog/benchmark-baselines/rtx-4070-ti-2026-07-14-efda975/`,
  `devlog/benchmark-baselines/rtx-4070-ti-2026-07-12-73df45e/`, and
  `devlog/WEBGPU_BENCHMARK_BASELINE_2026-07-11.md`
- Procedural field height sampler: `src/terrain.ts`
- Prioritized concrete follow-up work: `TODO.md`
- Loose visual, interaction, and engine ideas: `SPITBALL_IDEAS.md`
- Research notes and plan for physically inspired propagation:
  `devlog/PROPAGATION_NOTES.md`
- Before/after notes for the frame-rate-independent simulation loop:
  `devlog/FRAME_RATE_TIMING_NOTES.md`

## Runtime Flow

1. `index.html` loads `src/main.ts`.
2. `main.ts` resolves renderer policy first. Omitted/auto/explicit WebGL creates
   the current Three scene; explicit WebGPU starts `webGpuApp`. Both paths hold
   gameplay on the same startup menu and preserve the current Training, Arena,
   Track, fixed-step, pause, controls, and reset semantics.
3. `SkyboxManager` applies the selected generated panorama to a camera-following
   UV sky dome, chooses 8K textures or 4K fallbacks from GPU texture caps, and
   applies matching fog/clear color so the arena sits inside a distant sci-fi
   horizon instead of a pure void.
4. `PlayerRig` updates momentum-based planar movement, jump height, surface
   ground-contact strength, optional track-ribbon containment, circular arena
   fallback clamping, and camera follow every frame.
5. Touch-button pulses add cooldown-gated analytic pulse sources, while `Space`
   jumps and emits smaller takeoff plus stronger landing ripples. Desktop mouse
   input uses hold-to-look pointer lock: left-drag orbits only the camera, while
   right-drag orbits the camera and steers avatar facing. Holding both mouse
   buttons moves forward in the camera-facing direction. Mouse look covers the
   full 180-degree vertical orbit from straight below the avatar to straight
   overhead.
   `A/D` turn by default, `Q/E` strafe, and right mouse changes `A/D` into strafe
   keys. Grounded input can accelerate, brake, and redirect planar velocity with
   deliberately slide-y response rates scaled by the pause-menu `Surface Grip`
   slider; airborne movement preserves the horizontal takeoff trajectory until
   landing.
   Mouse clicks no longer emit pulse sources. Avatar movement writes a
   continuous wake influence into a GPU height/velocity texture instead of
   adding little circular source stamps, and airborne jumps fade that contact
   before touchdown. Echo-zone timers add persistent collectible markers instead
   of immediate ambient waves.
   Standard-mapped gamepads use a third-person analog variant kept separate from
   mouse/keyboard rules: the full left-stick vector moves relative to the camera,
   pulling back travels toward camera-back, B actively brakes, right stick
   free-looks with camera
   priority, R3 snaps pod facing to the camera, pause-menu sensitivity sliders
   tune left-stick response and right-stick look speed, bumpers
   strafe independently, RT provides analog boost, A jumps, X pulses, and
   Menu/View own pause and diagnostics. Held menu directions repeat for usable
   slider adjustment without synthesizing keyboard events.
6. `TrainingRun` optionally guides the player through the current control set
   inside the course mode: camera orbit, steering, movement, boosting, active
   controller braking or mouse-button movement, momentum coasting, jumping,
   scripted Echo pickup, and wall sliding. It observes read-only `PlayerRig`
   telemetry and requests
   existing Echo/pulse effects instead of changing movement rules.
7. `RaceTrack` keeps the first racing-course prototype alive: a wide closed
   sweeping non-crossing loop scaled to the active arena radius,
   slide-and-speed-bleed wall containment, bright glowing energy-wall meshes,
   a generated mask texture that the field shader samples for surface highlight
   and heavy outside-track dimming, and a field-cell containment query used by
   course modes. Track and Training hide the circular arena floor and outer
   barrier, so the course walls become the only visible movement boundary.
8. `RippleField` builds hex instances using the active quality, hex-size, and
   arena-radius settings. In Track mode it clips placement to the course ribbon
   plus a safety skirt; Training mode uses that same clipped course path and
   skips the full-disc radius/hex coupling guardrail. In Arena mode it keeps the
   full circular sandbox field and still applies the instance-budget guardrail.
   Hex geometry uses the same flat-top orientation in both renderers and the
   shared layout vertically staggers columns, so Meltdown reads as an exact
   interlocked honeycomb while preserving its previous density.
   The field then sends active pulse source/metadata/lifetime uniforms plus the
   wake texture, track mask texture, player ground-contact strength,
   wave-medium, and cell-scale values to the shaders; cell matrices stay static
   while the GPU animates lit cap height, lift/stretch/glow, crest bloom,
   movement wake memory, track highlight, and height-based tinting. The old
   per-cell shaft mesh has been removed to keep the geometry path simpler before
   the sphere work.
9. `ArenaBarrier` draws an Arena-only visual smooth glowing gradient curtain at
   the arena radius so the sandbox edge is visible without changing collision
   logic.
10. `EchoZoneField` animates live Echo markers placed on the race track and
   reports run-through triggers.
11. `ParticleVeil` animates the player sparkle aura, burst clouds, flat Echo
   disc bursts, and velocity-shaped wake-tail motes.
12. `PulseLightRig` assigns recent pulses and collected Echo detonations to
   point lights.
13. The HUD keeps active mode and quality visible by default. The top-left
    debug readout reports FPS, instance counts, culled track hexes when
    applicable, base propagation speed, voxel size, arena radius, live Echo
    count, active pulse count, and newest pulse radius only after diagnostics
    are enabled. A denser `F2`/pause-menu Diagnostics overlay reports
    frame/update/render timing, active particles versus resident budget,
    rendered pulse-source pressure, wake texture mode/pass cost, renderer draw
    stats, pixel ratio, bloom state, and quality. Both debug surfaces start
    hidden by default.
14. Esc or the hamburger button opens the centered pause menu after a mode has
    started. Its Graphics, Field, Movement, and Effects tabs own the tuning
    controls, while Resume, Exit To Main Menu, and the version changelog remain
    persistent menu actions. The field-palette setting is shared by both
    renderers; Style Default resolves to Reference for WebGL/Classic and Legacy
    Neon for Core without changing wave dynamics.
    Hidden base/boost speed rows remain wired for future tuning, but are not
    currently exposed in the visible menu.
15. The scene renders through bloom when bloom strength is above zero.
16. Forced WebGPU builds `RenderFrameInput` from neutral gameplay snapshots.
    Arena enables the circular curtain; Track and Training upload the course
    mask and packed wall segments, use clipped layout state, and disable it.
    Training adds its one-draw objective marker and deterministic Echo policy.
    The selected presentation profile chooses either the default Classic 3D
    hex-prism pipeline or the preserved flat Core pipeline without rebuilding
    gameplay state. Classic consumes the WebGL source/wake transfer and pulse-
    light lifecycle; Core retains the earlier stylized amplification and pulse
    glow proxy.
    Readiness stays `diagnostic-core` and `defaultEligible=false` even after the
    automated remaining-gap list reaches empty.

## Common Change Targets

- Tune visual density, hex-size ranges, arena-radius ranges, per-quality field
  instance budgets, Track's guardrail bypass, or GPU pressure:
  `src/qualityPresets.ts`, `src/labSettings.ts`, `src/fieldScaleGuardrails.ts`,
  and `src/main.ts`
- Change the visible map-edge barrier color, height, or shimmer:
  `src/arenaBarrier.ts`
- Change the first race-track shape, width, wall visuals, collision response,
  generated mask, off-track dimming, or track-scoped Echo placement:
  `src/raceTrack.ts`, `src/rippleField.ts`, and `src/main.ts`
- Change Training Run objectives, objective marker placement, scripted Echo
  behavior, HUD progress chips, or training diagnostics:
  `src/trainingRun.ts`, `src/main.ts`, and `index.html`
- Change controller mappings, dead zones, sensitivity, menu edge behavior,
  active-pad selection, or haptics: `src/gamepadInput.ts`, `src/controls.ts`, and
  `src/main.ts`
- Change generated skybox choices, labels, texture paths, horizon framing, or
  matching fog color: `src/skybox.ts` and `public/skyboxes/`
- Change ripple math, hex shape, directional water-like movement response,
  track-surface tinting, animated-height tint, crest glow, or generic proximity
  glow:
  `src/rippleField.ts`
- Change continuous GPU movement wake propagation, wake texture size, fallback,
  or wake diagnostics: `src/wakeField.ts` and `src/qualityPresets.ts`
- Change Echo-zone spawn count, trigger radius, track placement, column visuals,
  or collection behavior: `src/raceTrack.ts`, `src/echoZones.ts`, and
  `src/main.ts`
- Change avatar marker motes, long orbit trails, lights, or shell visuals:
  `src/main.ts`
- Change particles, wake-tail shape, burst count, or deterministic spawn
  streams: `src/particleState.ts`, `src/particleVeil.ts`,
  `src/render/renderRandom.ts`, and `src/main.ts`
- Change pulse source strength or cooldown: `src/main.ts`
- Change propagation-speed semantics or medium parameters: `src/waveMedium.ts`,
  `src/labSettings.ts`, and `devlog/PROPAGATION_NOTES.md`
- Change momentum, surface grip, jump feel, hidden speed defaults/limits,
  movement/camera feel, track containment, or the circular player fallback
  boundary: `src/controls.ts`, `src/raceTrack.ts`, `src/labSettings.ts`, and
  `src/main.ts`
- Change pause-menu layout, changelog behavior, or tuning labels:
  `index.html`, `src/styles.css`, `src/pauseMenuTabs.ts`, and `src/main.ts`
- Change field-palette choices, profile-aware defaults, or palette diagnostics:
  `src/fieldPalette.ts`, `src/rippleField.ts`,
  `src/ripple/webGpuRippleFieldPreview.ts`, and
  `src/ripple/webGpuRippleFieldPreview.wgsl`
- Change the live performance overlay, HUD formatting, frame-hitch payloads, or
  the `F2` toggle:
  `index.html`, `src/styles.css`, `src/frameTelemetry.ts`, and `src/main.ts`
- Change renderer policy, neutral frame/stats contracts, or forced-WebGPU
  lifecycle/readiness: `src/render/rendererMode.ts`, `src/render/types.ts`,
  `src/render/webGpuApp.ts`, and `src/render/webGpuRenderRuntime.ts`
- Change the WebGPU Classic/Core selector policy or procedural field geometry:
  `src/render/presentationProfile.ts`, `src/ripple/webGpuRippleFieldPreview.ts`,
  and `src/ripple/webGpuRippleFieldPreview.wgsl`
- Change WebGPU course walls or the Training objective marker:
  `src/render/webGpuTrackWallPass.ts`, `src/render/webGpuTrackWallPass.wgsl`,
  `src/render/webGpuTrainingMarkerPass.ts`, and
  `src/render/webGpuTrainingMarkerPass.wgsl`

## Sharp Edges

- The field is a visual lab, not voxel terrain. Do not add save data or chunk
  loading here unless the project deliberately changes shape.
- `RaceTrack` is the first hardcoded racing prototype, not a track editor. Keep
  shape, mask, wall geometry, and containment together until the gameplay loop
  proves it needs authoring tools. The field shader samples a mask texture for
  course highlight; do not rebuild the hex field merely to change track visuals.
  Wall contact should preserve tangential velocity and bleed only outward
  pressure so the slide-heavy handling survives track edges.
- `RaceTrack` remains a CPU gameplay owner. Raw-WebGPU modules must consume its
  neutral mask and packed wall snapshots through `RenderFrameInput`; do not
  import `RaceTrack` into renderer modules.
- Omitted and `auto` renderer policy stays WebGL while the Stage-0 rollout
  percentage is zero. Do not raise that build constant before cross-hardware
  acceptance and fallback lifecycle work pass. Forced WebGPU must fail visibly
  instead of falling back, and its WGSL passes should keep explicit pipeline
  layouts and shared field-depth ordering.
- WebGPU presentation profile `classic` is the default parity candidate and must
  keep real prism side faces, animated thickness, and dedicated browser/parity
  coverage. `core` is the preserved minimalist flat-cap option; do not retune it
  merely to reduce Classic/WebGL diffs.
- Decision-grade benchmark evidence uses protocol/workload
  `renderer-benchmark-v3-classic-3d-tiles`. The package command requires
  a clean tree, installs from the recorded lockfile in a detached worktree at the
  recorded commit, owns strict
  preview port `4183`, requires stable Chrome without fallback, and runs stock
  no-flags Arena/Track/Training plus a 120-second soak before the fixed seven-case,
  four-repetition instrumented benchmark. It rechecks source provenance before
  acceptance, requires complete sample windows and one stock/instrumented GPU
  adapter, and validates bundle checksums plus cross-file protocol coherence.
- Compare only accepted `baseline.json` projections. Same-hardware runs keep the
  10% warning/20% failure thresholds; compatible different hardware is
  informational, and protocol/workload/config mismatches are incompatible. A
  warning is reported distinctly but blocks packaged baseline promotion.
  The accepted v3 RTX 4070 Ti projection at `efda975` is the current Classic
  comparison baseline. The tracked v2 projection measured the older flat Core
  field and is intentionally incompatible with v3 Classic evidence.
  `RIPPLE_BENCHMARK_PACKAGE_TEST=1` is a shortened tooling profile that reports
  `test-only-passed` with an ineligible baseline, not acceptance evidence.
- Keep the CPU/GPU contract small: pulse uniforms, player position, player
  ground-contact strength, wake texture, and settings go in; shader animation
  comes out. Movement wake must not add entries to `RippleSourceStore`; that
  store is for manual, jump/landing, and Echo pulses only.
  The shader still has a fixed pulse upload budget, but pulse retention should
  be governed by per-source lifetime and input cooldown rather than a tiny
  gameplay cap.
- Echo zones are CPU-side gameplay markers with stacked point lights, bright
  orb lights, vertical diamond-style orb mist, segmented crystal-local orbiting
  sparkle trails, and
  pooled short collection bursts. They should not become shader sources until
  collected, otherwise they turn back into ambient pulses with extra jewelry.
  Collected Echo payloads carry both a surface wave position and an elevated
  core-height effect position; keep that split so gameplay waves stay grounded
  while collection particles align with the crystal burst.
  Their point lights are pooled and parked at zero intensity; do not add/remove
  point lights during Echo spawn or collection, because changing Three.js light
  counts can recompile the lit field shader during gameplay.
  Echo collection bursts also use a resident mesh/material/buffer pool; returning
  a burst should hide and reset it, not dispose geometry or allocate replacement
  shard buffers on the next pickup.
- Echo detonation and global frame-hitch logging defaults on for local hosts
  and writes a retained ring buffer to `window.__rippleDebugLog`; use
  `window.__rippleDebugDump()` in DevTools after a freeze to inspect the last
  collection, cause-specific frame warnings, raw clock gaps, update/render
  timing, rendered source limits, and Echo burst particle budgets. New logs use
  `frame.renderHitch`, `frame.updateHitch`, `frame.mixedHitch`, or
  `frame.clockGap`; older JSONL may still contain `frame.hitch`, and the
  diagnostics parser classifies those legacy entries by payload. Console lines
  include inline JSON because Chrome automation collapses object arguments.
  When `npm.cmd run debug:logs` is listening, the browser also batches records
  to `127.0.0.1:5184` and appends JSONL under `logs/`. The receiver exposes
  `/summary?format=text`, `/tail?source=latest&channel=frame.renderHitch`, and
  `/tail?minFrameMs=45` for quick local triage.
- `WakeField` allocates render targets only at startup and quality changes, not
  during normal movement. If movement increases `activeRippleSources`, the new
  wake path has regressed back into source stamping. The wake texture also has a
  broad absorbing edge band and low-energy damping; preserve those when tuning,
  or old movement energy can reflect around the circular texture and turn into
  whole-arena shimmer after a few minutes. Player jump contact intentionally
  suppresses fresh wake injection while airborne, but the texture still
  propagates and fades whatever was already there.
- `ParticleVeil` keeps active motes packed into the leading buffer range and
  sets Three.js draw/update ranges from `activeCount`; preserve that shape when
  changing particle lifetimes or replacement behavior, or dead budget slots will
  quietly become render cost again. Continuous avatar aura/wake emission scales
  down as the resident buffer fills, and the movement wake trail is intentionally
  directional: spawn motes behind the current velocity vector rather than in a
  circular glitter cloud. Static attributes only upload dirty slot ranges.
  Dynamic position/alpha/size still update broadly because live particles move
  every frame. Echo disc detonations intentionally spend a capped intensity
  budget on broad soft poof motes plus a smaller large-glitter layer instead of
  one enormous glitter-only burst.
- `RippleField` can upload fewer rendered ripple sources than the gameplay
  source list contains when the hex instance count is extreme. This is a
  GPU-side density throttle for shader loop cost, not a gameplay source cap.
- The hex-size and arena-radius sliders rebuild the InstancedMesh after a
  short debounce. Meltdown's honeycomb look preserves its prior density, but
  extreme combinations such as tiny hexes plus a 400m arena are clamped by
  per-quality `maxFieldInstances` budgets before rebuilding. `field.guardrail`
  warns when the lab adjusts hex size or arena radius, and `?stress=1` or
  `localStorage.rippleStressMode = "1"` deliberately disables the guardrail for
  intentional stress testing. Check the HUD hex count and `field.rebuild` debug
  events before assuming a visual hitch comes from waves.
- `Meltdown` is intentionally rude to weak GPUs. Keep it available, but do not
  tune the normal experience around it.
- Pointer-lock behavior should be browser-tested in Chrome, not trusted from a
  build alone.
- Browsers may leave `navigator.getGamepads()` empty until a focused-page button
  gesture. Hardware input and haptics need one real-controller Chrome acceptance
  pass even when typecheck and build are clean.
