# Codebase Index

Last reviewed: 2026-06-27

Purpose: compact map for the standalone ripple-field visual lab.

## Stack

- Vite + strict TypeScript browser app.
- Three.js renderer wrapped by a staged runtime boundary, postprocessing
  composer, Unreal bloom pass, shader-customized `InstancedMesh`, additive
  `Points`, dynamic lights, neutral render snapshots, and WebGPU boot/probe
  scaffolding.
- Current alpha baseline: `v0.4.0-ALPHA`; keep release tags in alpha prerelease
  territory until the lab graduates from prototype status.
- Dedicated dev port `5183`; preview port `4183`.

## Commands

- Install: `npm.cmd install`
- Windows start: `.\start.ps1`
- Linux/Ubuntu start: `chmod +x ./start.sh && ./start.sh`
- Paired dev server + debug receiver: `npm.cmd run dev`
- Vite-only dev server: `npm.cmd run dev:vite`
- Debug log receiver: `npm.cmd run debug:logs` on `127.0.0.1:5184`
- Latest JSONL diagnostics summary: `npm.cmd run diagnostics`
- Broad alpha perf gate over the newest JSONL: `npm.cmd run verify:perf`
- App/log retention smoke: `npm.cmd run smoke`
- Browser WebGL render smoke: `npm.cmd run verify:render:webgl`
- Browser WebGPU capability smoke: `npm.cmd run verify:webgpu:capabilities`
- Browser forced-WebGPU render smoke: `npm.cmd run verify:render:webgpu`
- Browser forced-WebGPU soak smoke: `npm.cmd run verify:render:webgpu:soak`
- Browser forced-WebGPU readiness smoke:
  `npm.cmd run verify:render:webgpu:readiness`
- Browser forced-WebGPU default-readiness soak:
  `npm.cmd run verify:render:webgpu:default-soak`
- Browser forced-WebGPU failure smoke:
  `npm.cmd run verify:render:webgpu:unavailable`
- Type check: `npm.cmd run typecheck`
- Production build: `npm.cmd run build`
- Standard validation: `npm.cmd run validate`

## Fast Lookup

- HTML shell, pause menu, changelog dialog, performance overlay, and tuning
  controls: `index.html`
- Visual styling and overlay layout: `src/styles.css`
- App bootstrap, Three.js scene, render loop, quality wiring, and gameplay:
  `src/main.ts`
- Renderer mode policy, current WebGL runtime wrapper, forced-WebGPU diagnostic
  runtime, forced-WebGPU wake compute/field/presentation/particle proof
  ownership, readiness/default-eligibility diagnostics, and WebGPU boot probing:
  `src/render/rendererMode.ts`, `src/render/threeRenderRuntime.ts`,
  `src/render/webGpuRenderRuntime.ts`, `src/render/webgpu.ts`, and
  `src/render/webGpuProbe.ts`
- Selectable camera-following sky dome, 8K/4K generated skybox texture loading,
  horizon framing, and per-theme fog tuning: `src/skybox.ts` plus
  `public/skyboxes/`
- HUD formatting and cause-specific frame-hitch payload assembly:
  `src/frameTelemetry.ts`
- Field scale instance-budget clamp decisions:
  `src/fieldScaleGuardrails.ts`
- Momentum-based avatar movement with visible surface-grip tuning, higher
  carried ground momentum, jump/landing state, hidden speed-tuning defaults,
  circular arena clamp, scene-input gating, split left/right
  hold-to-look pointer lock, camera/player yaw separation, both-button
  camera-forward movement, WoW-style turn/strafe key semantics, ballistic
  airborne horizontal momentum, full 180-degree vertical camera orbit, quiet
  mouse-release unlocks, and camera follow behavior:
  `src/controls.ts`
- Renderer-neutral RippleField layout math and the WebGL circular
  shader-displaced instanced hex field, including sampled GPU movement wake
  displacement, Meltdown-calibrated honeycomb orientation, lit hex caps,
  animated-height cell tinting, bounded crest-specific glow, and neutral Track
  mask sampling:
  `src/rippleFieldLayout.ts` and `src/rippleField.ts`
- CPU RaceTrack state owner for Track mode containment, wall/mask generation,
  track-scoped Echo placement, WebGL mask texture access, and renderer-neutral
  `Uint8Array` mask snapshots consumed by forced WebGPU:
  `src/raceTrack.ts`
- Wake-field facade/types plus the current WebGL ping-pong GPU movement wake
  backend, absorbing edge band, residual-wave damping, fallback texture,
  quality-sized render targets, forced-WebGPU diagnostic compute proof, and
  `wake.*`/`wake.webgpu.*` diagnostics:
  `src/wakeField.ts`, `src/wake/types.ts`, and
  `src/wake/webGlWakeFieldBackend.ts`, `src/wake/webGpuWakeFieldProbe.ts`, and
  `src/wake/webGpuWakeFieldProbe.wgsl`
- Forced-WebGPU diagnostic RippleField preview that uploads shared field layout
  cells, owns the shared `depth24plus` target for later scene-space passes,
  uploads vec4-packed pulse sources and diagnostic Echo marker buffers, samples
  the wake compute texture, uploads neutral Track mask snapshots in Track mode,
  and logs `ripple.webgpu.*` events:
  `src/ripple/webGpuRippleFieldPreview.ts` and
  `src/ripple/webGpuRippleFieldPreview.wgsl`
- Renderer-neutral packed CPU particle state plus the forced-WebGPU diagnostic
  additive soft-quad particle preview:
  `src/particleState.ts`, `src/particle/webGpuParticleVeilPreview.ts`, and
  `src/particle/webGpuParticleVeilPreview.wgsl`
- Forced-WebGPU core scene presentation passes for skybox texture loading,
  shared-depth arena curtain/avatar/particle/pulse/Echo effects, renderer-neutral
  contact shadows, a directional field-receiver shadow map, scene lighting, and
  bounded blur bloom:
  `src/render/webGpuSkyboxPass.ts`, `src/render/webGpuArenaBarrierPass.ts`,
  `src/render/webGpuAvatarPreview.ts`, `src/render/webGpuPulseGlowPass.ts`,
  `src/render/webGpuEchoVisualPass.ts`, `src/render/webGpuSceneShadowBuffer.ts`,
  `src/render/webGpuShadowMapPass.ts`, `src/render/webGpuSceneLightBuffer.ts`,
  and `src/render/webGpuBloomPass.ts`
- Saved forced-WebGPU mote-core avatar asset metadata used by the hover-pod
  avatar preview:
  `src/render/webGpuMoteAvatarAsset.ts`
- Forced-WebGPU diagnostic-core readiness/settings parity lives in
  `src/main.ts`: quality, skybox, bloom toggle/strength, particle toggle,
  particle density, field scale, movement feel, and ripple/depth tuning are
  wired for both playable WebGPU and `?webgpuDemo=1`. The browser verifier
  exercises those controls through
  `webgpu.settings.change`, `webgpu.readiness.*`, and
  `webgpu.integrationReadiness.*`; the longer default-readiness verifier also
  checks `webgpu.defaultReadiness.*` through resize/focus churn.
- Visual-only smooth glowing arena-edge gradient barrier: `src/arenaBarrier.ts`
- Visible cyan/magenta spotlight fixtures, stage floor, core scene lighting,
  and player avatar visuals: `src/main.ts`
- Lifetime-pruned manual/Echo pulse source list and renderer-neutral pulse
  source snapshots:
  `src/rippleSources.ts`
- Renderer-neutral Echo gameplay state, deterministic startup spawning,
  collection checks, short-lived collection event snapshots, and
  `echo.state.*` diagnostics: `src/echoState.ts`
- WebGL Echo visual facade that mirrors shared Echo state into collectible
  Echo-column lights, bright orb lights, vertical diamond-style orb mist,
  avatar-style segmented crystal orbit trails, and pooled run-through
  collection bursts: `src/echoZones.ts`
- WebGL particle facade that mirrors shared particle state into Three `Points`
  for the player sparkle aura, adaptive continuous emission, additive particle
  bursts, shader brightness/energy, tight velocity-following wake tails, and
  narrowed static attribute uploads:
  `src/particleVeil.ts`
- Recent-pulse point light pool: `src/pulseLights.ts`
- Quality preset budgets and labels: `src/qualityPresets.ts`
- Runtime settings shape/defaults, surface-grip defaults, and
  lab-meter-to-scene-unit scale mapping:
  `src/labSettings.ts`
- Wave-medium settings and derived propagation speed: `src/waveMedium.ts`
- Local diagnostic log buffer and console profiler hooks: `src/debugLog.ts`
- Tiny local debug receiver and JSONL writer: `scripts/debug-log-server.mjs`
- Paired dev launcher, shared smoke helpers, app/log smoke harness, and
  Playwright browser render verifier:
  `scripts/start-dev.mjs`, `scripts/ripple-smoke-harness.mjs`,
  `scripts/smoke.mjs`, and `scripts/verify-render.mjs`
- JSONL diagnostics parser shared by the receiver and CLI:
  `scripts/debug-log-analysis.mjs`
- Newest-log diagnostics CLI: `scripts/analyze-debug-log.mjs`
- Procedural field height sampler: `src/terrain.ts`
- Prioritized concrete follow-up work: `TODO.md`
- Loose visual, interaction, and engine ideas: `SPITBALL_IDEAS.md`
- Research notes and plan for physically inspired propagation:
  `PROPAGATION_NOTES.md`

## Runtime Flow

1. `index.html` loads `src/main.ts`.
2. `main.ts` creates the scene, camera, gameplay systems, and the current
   `ThreeRenderRuntime`, which owns the WebGL renderer, bloom composer, resize,
   prewarm, frame render, and backend stats.
3. `SkyboxManager` applies the selected generated panorama to a camera-following
   UV sky dome, chooses 8K textures or 4K fallbacks from GPU texture caps, and
   applies matching fog/clear color so the arena sits inside a distant sci-fi
   horizon instead of a pure void.
4. `PlayerRig` updates momentum-based planar movement, jump height, surface
   ground-contact strength, and camera follow every frame.
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
6. `main.ts` selects Arena or Track startup from `mode=arena|track`. Track mode
   creates `RaceTrack` as the CPU gameplay owner for containment, mask bytes,
   and Echo placement; renderers receive only neutral play-mode and mask
   snapshots.
7. `main.ts` builds a per-frame `RenderInput` and asks `RippleSourceStore` for
   a renderer-neutral pulse-source snapshot. WebGL adapts that snapshot to its
   fixed uniform arrays; WebGPU uploads the same values into
   vec4-packed buffers without reaching back into gameplay state.
8. `RippleField` builds hex instances inside the circular arena using the
   active quality, hex-size, and arena-radius settings. Hex geometry is rotated
   to match the staggered lattice, and Meltdown's visible footprint is calibrated
   to read as an interlocked honeycomb while preserving its previous density.
   The field then sends active pulse source/metadata/lifetime uniforms plus the
   wake texture, player ground-contact strength, wave-medium, and cell-scale
   values to the shaders; cell matrices stay static while the GPU animates lit
   cap height, lift/stretch/glow, crest bloom, movement wake memory, and
   height-based tinting. The old per-cell shaft mesh has been removed to keep
   the geometry path simpler before the sphere work.
9. `ArenaBarrier` draws a visual-only smooth glowing gradient curtain at the
   arena radius so the map edge is visible without changing collision logic.
10. `EchoZoneStateStore` owns Echo spawn/collection gameplay state, while
   `EchoZoneField` mirrors that state into the current WebGL crystal visuals
   and reports run-through triggers.
11. `ParticleVeilState` owns packed CPU particle simulation for the player
    sparkle aura, burst clouds, flat Echo disc bursts, and velocity-shaped
    wake-tail motes. WebGL mirrors it into Three `Points`; forced WebGPU uploads
    its snapshots into an instanced soft-quad diagnostic pass.
12. `PulseLightRig` assigns recent pulses and collected Echo detonations to
   point lights.
13. The HUD reports FPS, instance counts, base propagation speed, voxel size,
    arena radius, live Echo count, active pulse count, and newest pulse radius.
    A denser `F2`/pause-menu performance overlay reports frame/update/render
    timing, active particles versus resident budget, rendered pulse-source
    pressure, wake texture mode/pass cost, renderer draw stats, pixel ratio,
    bloom state, and quality.
14. Esc or the hamburger button opens the centered pause menu, which owns
    tuning controls, a Resume action, and a version changelog button.
    Hidden walk/sprint speed rows remain wired for future tuning, but are not
    currently exposed in the visible menu.
15. The scene renders through bloom when bloom strength is above zero.
16. Both render loops emit sparse `renderer.frameSample` diagnostics with
    backend, frame timing, viewport, pixel ratio, draw count, submit cost, and
    device-lost state for browser smoke and later perf checks.
17. `?renderer=webgpu` skips the WebGL-only scene systems and runs a visible
    WebGPU diagnostic runtime that configures a DPR-clamped canvas, runs a WGSL
    wake compute proof, renders depth-backed perspective RippleField hex caps
    from the shared layout, samples the wake texture in that field pass, uploads
    vec4-packed real pulse-source and Echo-state snapshots, highlights active
    Echo markers/collection rings diagnostically, renders a WebGPU skybox,
    arena curtain, hover-pod avatar proxy layered over the saved mote-core
    asset, pulse glow proxies, Echo orb
    visuals/collection flashes, CPU-state particles, shared contact shadows,
    directional field-receiver shadow maps with kind-aware orb/column/disc
    proxy casters, local lights, and a bounded blur-bloom composite. The
    scene-space additive passes read the field depth target without writing it.
    A renderer-neutral `avatarPresentation` snapshot feeds the WebGPU avatar
    preview, and `mode=track` feeds neutral RaceTrack mask snapshots so future
    main-branch data can plug into the core renderer without passing gameplay
    objects through the render contract. The runtime then logs
    adapter/device plus `webgpu.sceneState.*`/`wake.webgpu.*`/`ripple.webgpu.*`/
    `particle.webgpu.*`/`echo.webgpu.*`/presentation-pass state plus
    `webgpu.integrationReadiness.*` summaries. It is interactive and can consume
    Track snapshots, but it remains diagnostic-only until an explicit rollout
    decision is made.
    `?webgpuDemo=1` restores the
    synthetic orbit/source harness. `?renderer=webgl`
    explicitly selects the current path; omitted or `auto` keeps the same
    current visuals.

## Common Change Targets

- Tune visual density, hex-size ranges, arena-radius ranges, per-quality field
  instance budgets, or GPU pressure:
  `src/qualityPresets.ts`, `src/labSettings.ts`, `src/fieldScaleGuardrails.ts`,
  and `src/main.ts`
- Change the visible map-edge barrier color, height, or shimmer:
  `src/arenaBarrier.ts`
- Change generated skybox choices, labels, texture paths, horizon framing, or
  matching fog color: `src/skybox.ts` and `public/skyboxes/`
- Change ripple math, hex shape, directional water-like movement response,
  animated-height tint, crest glow, or generic proximity glow:
  `src/rippleFieldLayout.ts`, `src/rippleField.ts`, and
  `src/ripple/webGpuRippleFieldPreview.ts`
- Change continuous GPU movement wake propagation, wake texture size, fallback,
  or wake diagnostics: `src/wake/webGlWakeFieldBackend.ts`,
  `src/wake/webGpuWakeFieldProbe.ts`, `src/wake/webGpuWakeFieldPreview.ts`,
  `src/wake/types.ts`, `src/wakeField.ts`, and `src/qualityPresets.ts`
- Reuse the WebGPU diagnostic setup for future spinoffs/components:
  `src/render/webGpuRenderRuntime.ts`, `src/render/webgpu.ts`,
  `src/wake/webGpuWakeFieldProbe.ts`,
  `src/ripple/webGpuRippleFieldPreview.ts`,
  `src/particle/webGpuParticleVeilPreview.ts`,
  `src/render/webGpuSkyboxPass.ts`, `src/render/webGpuArenaBarrierPass.ts`,
  `src/render/webGpuAvatarPreview.ts`, `src/render/webGpuPulseGlowPass.ts`,
  `src/render/webGpuEchoVisualPass.ts`, `src/render/webGpuSceneShadowBuffer.ts`,
  `src/render/webGpuShadowMapPass.ts`, `src/render/webGpuSceneLightBuffer.ts`,
  `src/render/webGpuBloomPass.ts`, and
  `scripts/verify-render.mjs`
- Change forced-WebGPU skybox/background, arena curtain, avatar marker, pulse
  glow proxies, Echo orb visuals, shared-depth effect behavior, contact shadows,
  directional field shadows, local lighting, or bloom:
  `src/render/webGpuSkyboxPass.ts`, `src/render/webGpuArenaBarrierPass.ts`,
  `src/render/webGpuAvatarPreview.ts`, `src/render/webGpuPulseGlowPass.ts`,
  `src/render/webGpuEchoVisualPass.ts`, `src/render/webGpuSceneShadowBuffer.ts`,
  `src/render/webGpuShadowMapPass.ts`, `src/render/webGpuSceneLightBuffer.ts`,
  `src/render/webGpuBloomPass.ts`,
  `src/render/webGpuRenderRuntime.ts`, and `src/main.ts`
- Change Echo-zone spawn count, trigger radius, state snapshots, column visuals,
  or collection behavior: `src/echoState.ts`, `src/echoZones.ts`,
  `src/render/webGpuEchoVisualPass.ts`, and `src/main.ts`
- Change avatar marker motes, long orbit trails, lights, or shell visuals:
  `src/main.ts`
- Change particles, wake-tail shape, burst count, packed particle state, or
  WebGPU particle preview behavior: `src/particleState.ts`,
  `src/particleVeil.ts`, `src/particle/webGpuParticleVeilPreview.ts`, and
  `src/main.ts`
- Change pulse source strength or cooldown: `src/main.ts`
- Change propagation-speed semantics or medium parameters: `src/waveMedium.ts`,
  `src/labSettings.ts`, and `PROPAGATION_NOTES.md`
- Change momentum, surface grip, jump feel, hidden speed defaults/limits,
  movement/camera feel, or the circular player boundary: `src/controls.ts`,
  `src/labSettings.ts`, and `src/main.ts`
- Change pause-menu layout, changelog behavior, or tuning labels:
  `index.html`, `src/styles.css`, and `src/main.ts`
- Change the live performance overlay, HUD formatting, frame-hitch payloads, or
  the `F2` toggle:
  `index.html`, `src/styles.css`, `src/frameTelemetry.ts`, and `src/main.ts`

## Sharp Edges

- The field is a visual lab, not voxel terrain. Do not add save data or chunk
  loading here unless the project deliberately changes shape.
- Keep the CPU/GPU contract small: pulse-source snapshots, player position,
  player ground-contact strength, wake texture, and settings go in; shader
  animation comes out. Movement wake must not add entries to
  `RippleSourceStore`; that store is for manual, jump/landing, and Echo pulses
  only.
  The shader still has a fixed pulse upload budget, but pulse retention should
  be governed by per-source lifetime and input cooldown rather than a tiny
  gameplay cap.
- Echo zones are CPU-side gameplay markers owned by `EchoZoneStateStore`.
  WebGL mirrors that state with stacked point lights, bright orb lights,
  vertical diamond-style orb mist, segmented crystal-local orbiting sparkle
  trails, and pooled short collection bursts; forced WebGPU mirrors the same
  state with diagnostic field highlights. Live Echoes should not become pulse
  sources until collected, otherwise they turn back into ambient pulses with
  extra jewelry.
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
  `/tail?minFrameMs=45` for quick local triage. The Playwright render smokes
  append `smokeRun=<nonce>` to their URLs and only trust events from that exact
  run, so stale retained diagnostics do not satisfy a fresh browser check.
- `WakeField` is now a facade over a backend contract; the current implementation
  is `WebGlWakeFieldBackend`. It still allocates render targets only at startup
  and quality changes, not during normal movement. If movement increases
  `activeRippleSources`, the new wake path has regressed back into source
  stamping. The wake texture also has a broad absorbing edge band and low-energy
  damping; preserve those when tuning, or old movement energy can reflect around
  the circular texture and turn into whole-arena shimmer after a few minutes.
  Player jump contact intentionally suppresses fresh wake injection while
  airborne, but the texture still propagates and fades whatever was already
  there.
- The forced-WebGPU wake proof is deliberately diagnostic-only. It proves
  explicit WGSL compute pipelines, ping-pong textures, and texture sampling
  inside `WebGpuRenderRuntime`, then the diagnostic RippleField preview samples
  the computed wake texture from shared field layout data in a depth-backed
  perspective hex-cap pass, the presentation passes add skybox/arena/avatar/
  pulse/shadow/light/bloom dressing, and the particle preview renders CPU-state motes as
  additive instanced quads. The additive scene-space passes share the field
  depth target with read-only depth tests, and the wake proof reports sparse
  sampled energy diagnostics so the browser soak can catch arena-wide wake
  accumulation. Forced WebGPU now feeds real player/camera/pulse/
  Echo/particle/presentation state by default, while `?webgpuDemo=1` keeps the
  reusable synthetic harness.
  It does not return a
  `THREE.Texture`, does not initialize `WakeField`, and does not use the
  playable WebGL scene systems. Keep `auto` conservative until the WebGPU
  field/wake sampling path has real scene and effects parity.
  Preserve this diagnostic runtime/probe/preview shape as the starter harness
  for future raw-WebGPU spinoffs: lifecycle, explicit layouts, visible field
  preview, particle preview, core scene presentation passes, contact shadows,
  directional field shadows, sparse diagnostics,
  and fast plus soak Playwright proof all live together.
- `ParticleVeilState` keeps active motes packed into the leading buffer range
  and exposes dirty ranges for renderers; preserve that shape when changing
  particle lifetimes or replacement behavior, or dead budget slots will quietly
  become render cost again. The WebGL facade sets Three.js draw/update ranges
  from `activeCount`, while the WebGPU preview uploads active slots into a
  storage buffer each frame. Continuous avatar aura/wake emission scales down as
  the resident buffer fills, and the movement wake trail is intentionally
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
