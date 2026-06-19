# Codebase Index

Last reviewed: 2026-06-18

Purpose: compact map for the standalone ripple-field visual lab.

## Stack

- Vite + strict TypeScript browser app.
- Three.js renderer, postprocessing composer, Unreal bloom pass, shader-customized
  `InstancedMesh`, additive `Points`, and dynamic lights.
- Current alpha baseline: `v0.2.0-ALPHA`; keep release tags in alpha prerelease
  territory until the lab graduates from prototype status.
- Dedicated dev port `5183`; preview port `4183`.

## Commands

- Install: `npm.cmd install`
- Windows start: `.\start.ps1`
- Linux/Ubuntu start: `chmod +x ./start.sh && ./start.sh`
- Dev server: `npm.cmd run dev`
- Debug log receiver: `npm.cmd run debug:logs` on `127.0.0.1:5184`
- Type check: `npm.cmd run typecheck`
- Production build: `npm.cmd run build`
- Standard validation: `npm.cmd run validate`

## Fast Lookup

- HTML shell, pause menu, changelog dialog, performance overlay, and tuning
  controls: `index.html`
- Visual styling and overlay layout: `src/styles.css`
- App bootstrap, Three.js scene, render loop, quality wiring, and postprocessing:
  `src/main.ts`
- Avatar movement, circular arena clamp, scene-input gating, pointer lock, and
  camera follow behavior: `src/controls.ts`
- Circular shader-displaced instanced hex field and directional movement
  wake-front deformation, including Meltdown-calibrated honeycomb orientation,
  lit hex caps, animated-height cell tinting, and bounded crest-specific glow:
  `src/rippleField.ts`
- Visual-only smooth glowing arena-edge gradient barrier: `src/arenaBarrier.ts`
- Visible cyan/magenta spotlight fixtures, stage floor, core scene lighting,
  and player avatar visuals: `src/main.ts`
- Lifetime-pruned pulse/wake-front source list and shader uniform writer:
  `src/rippleSources.ts`
- Persistent collectible Echo-column lights, bright orb lights, vertical
  diamond-style orb mist, avatar-style segmented crystal orbit trails, and
  run-through collection bursts:
  `src/echoZones.ts`
- Player sparkle aura, additive particle bursts, and wake trails:
  `src/particleVeil.ts`
- Recent-pulse point light pool: `src/pulseLights.ts`
- Quality preset budgets and labels: `src/qualityPresets.ts`
- Runtime settings shape/defaults and lab-meter-to-scene-unit scale mapping:
  `src/labSettings.ts`
- Wave-medium settings and derived propagation speed: `src/waveMedium.ts`
- Local diagnostic log buffer and console profiler hooks: `src/debugLog.ts`
- Tiny local debug receiver and JSONL writer: `scripts/debug-log-server.mjs`
- Procedural field height sampler: `src/terrain.ts`
- Prioritized concrete follow-up work: `TODO.md`
- Loose visual, interaction, and engine ideas: `SPITBALL_IDEAS.md`
- Research notes and plan for physically inspired propagation:
  `PROPAGATION_NOTES.md`

## Runtime Flow

1. `index.html` loads `src/main.ts`.
2. `main.ts` creates the renderer, scene, camera, bloom composer, field, particles,
   pulse lights, and glow avatar.
3. `PlayerRig` updates planar movement and camera follow every frame.
4. Cooldown-gated clicks and `Space` add pulse sources, while movement adds
   sparse directional wake-front packets; Echo-zone timers add persistent
   collectible markers instead of immediate ambient waves.
5. `RippleField` builds hex instances inside the circular arena using the
   active quality, hex-size, and arena-radius settings. Hex geometry is rotated
   to match the staggered lattice, and Meltdown's visible footprint is calibrated
   to read as an interlocked honeycomb while preserving its previous density.
   The field then sends active source/metadata/lifetime uniforms plus
   wave-medium and cell-scale values to the shaders; cell matrices stay static
   while the GPU animates lit cap height, lift/stretch/glow, crest bloom, and
   height-based tinting. The old per-cell shaft mesh has been removed to keep
   the geometry path simpler before the sphere work.
6. `ArenaBarrier` draws a visual-only smooth glowing gradient curtain at the
   arena radius so the map edge is visible without changing collision logic.
7. `EchoZoneField` animates live Echo markers and reports run-through triggers.
8. `ParticleVeil` animates the player sparkle aura, burst clouds, flat Echo
   disc bursts, and wake motes.
9. `PulseLightRig` assigns recent pulses and collected Echo detonations to
   point lights.
10. The HUD reports FPS, instance counts, base propagation speed, voxel size,
    arena radius, live Echo count, active pulse/wake counts, and newest source
    front radius.
    A denser `F2`/pause-menu performance overlay reports frame/update/render
    timing, active particles versus resident budget, rendered wave-source
    pressure, renderer draw stats, pixel ratio, bloom state, and quality.
11. Esc or the hamburger button opens the centered pause menu, which owns
    tuning controls, a Resume action, and a version changelog button.
12. The scene renders through bloom when bloom strength is above zero.

## Common Change Targets

- Tune visual density, hex-size ranges, arena-radius ranges, or GPU pressure:
  `src/qualityPresets.ts`, `src/labSettings.ts`, and `src/main.ts`
- Change the visible map-edge barrier color, height, or shimmer:
  `src/arenaBarrier.ts`
- Change ripple math, hex shape, directional water-like movement response,
  animated-height tint, crest glow, or generic proximity glow:
  `src/rippleField.ts`
- Change Echo-zone spawn count, trigger radius, column visuals, or collection
  behavior: `src/echoZones.ts` and `src/main.ts`
- Change avatar marker motes, long orbit trails, lights, or shell visuals:
  `src/main.ts`
- Change particles, wake behavior, or burst count: `src/particleVeil.ts` and
  `src/main.ts`
- Change movement wake cadence, source strength, or pulse/wake HUD counts:
  `src/main.ts`
- Change propagation-speed semantics or medium parameters: `src/waveMedium.ts`,
  `src/labSettings.ts`, and `PROPAGATION_NOTES.md`
- Change movement/camera feel or the circular player boundary: `src/controls.ts`
- Change pause-menu layout, changelog behavior, or tuning labels:
  `index.html`, `src/styles.css`, and `src/main.ts`
- Change the live performance overlay or its `F2` toggle:
  `index.html`, `src/styles.css`, and `src/main.ts`

## Sharp Edges

- The field is a visual lab, not voxel terrain. Do not add save data or chunk
  loading here unless the project deliberately changes shape.
- Keep the CPU/GPU contract small: pulse uniforms, player position, and settings
  go in; shader animation comes out. The shader still has a fixed upload budget,
  but ripple retention should be governed by per-source lifetime and input
  cooldown rather than a tiny gameplay cap. Movement wake-front packets
  intentionally fade faster than manual pulses so the newest-first upload order
  does not churn through old packets during normal movement.
- Echo zones are CPU-side gameplay markers with stacked point lights, bright
  orb lights, vertical diamond-style orb mist, segmented crystal-local orbiting
  sparkle trails, and
  short collection bursts. They should not become shader sources until
  collected, otherwise they turn back into ambient pulses with extra jewelry.
  Collected Echo payloads carry both a surface wave position and an elevated
  core-height effect position; keep that split so gameplay waves stay grounded
  while collection particles align with the crystal burst.
  Their point lights are pooled and parked at zero intensity; do not add/remove
  point lights during Echo spawn or collection, because changing Three.js light
  counts can recompile the lit field shader during gameplay.
- Echo detonation and global frame-hitch logging defaults on for local hosts
  and writes a retained ring buffer to `window.__rippleDebugLog`; use
  `window.__rippleDebugDump()` in DevTools after a freeze to inspect the last
  collection, slow frames, raw clock gaps, update/render timing, rendered source
  limits, and Echo burst particle budgets. Console lines include inline JSON
  because Chrome automation collapses object arguments.
  When `npm.cmd run debug:logs` is listening, the browser also batches records
  to `127.0.0.1:5184` and appends JSONL under `logs/`.
- `ParticleVeil` keeps active motes packed into the leading buffer range and
  sets Three.js draw/update ranges from `activeCount`; preserve that shape when
  changing particle lifetimes or replacement behavior, or dead budget slots will
  quietly become render cost again. Echo disc detonations intentionally spend a
  capped intensity budget on broad soft poof motes plus a smaller large-glitter
  layer instead of one enormous glitter-only burst.
- `RippleField` can upload fewer rendered ripple sources than the gameplay
  source list contains when the hex instance count is extreme. This is a
  GPU-side density throttle for shader loop cost, not a gameplay source cap.
- The hex-size and arena-radius sliders rebuild the InstancedMesh after a
  short debounce. Meltdown's honeycomb look preserves its prior density, but
  extreme combinations such as tiny hexes plus a 400m arena can still create
  very large instance counts; check the HUD hex count and `field.rebuild` debug
  events before assuming a visual hitch comes from waves.
- `Meltdown` is intentionally rude to weak GPUs. Keep it available, but do not
  tune the normal experience around it.
- Pointer-lock behavior should be browser-tested in Chrome, not trusted from a
  build alone.
