# TODO

Prioritized work for the standalone ripple-field visual lab. Keep this file for
concrete follow-ups that we actually intend to revisit.

## High Priority

- Continue the staged WebGPU migration.
  The first slice added runtime boundaries, backend mode selection, WebGPU boot
  probing, app/log smoke coverage, renderer-neutral pulse-source snapshots, and
  a visible forced-WebGPU diagnostic runtime with DPR-clamped canvas clears plus
  a visible WGSL wake compute/preview proof.
  The active validation slice is the explicit Playwright browser smoke layer for
  WebGL, WebGPU capabilities, forced-WebGPU diagnostic rendering, and forced
  WebGPU failure behavior. The wake-field backend boundary now exists with the
  current WebGL ping-pong implementation behind a facade, while forced WebGPU
  now proves reset/simulation pipelines, quality-sized wake textures, and a
  visible diagnostic RippleField preview that shares field layout data, uploads
  vec4-packed pulse sources, samples the wake compute texture, and renders a
  depth-backed perspective hex-cap pass. Forced WebGPU now uses real playable
  camera/player/pulse state by default while preserving `?webgpuDemo=1` for the
  synthetic harness. Echo gameplay state is now shared with forced WebGPU and
  rendered as diagnostic field markers/rings. CPU particle state is now shared
  with forced WebGPU and rendered as additive diagnostic soft quads for aura,
  wake, pulse, jump/landing, and Echo collection bursts. Forced WebGPU now also
  has the core scene presentation layer: skybox/background, arena curtain,
  hover-pod avatar proxy layered over the saved `mote-core-orbit` asset, pulse
  glow proxies, shared contact shadows/local lights, bounded blur-bloom,
  shared-depth scene-space effect passes, sparse wake-energy
  diagnostics, and an on-demand forced-WebGPU soak verifier. Active Echoes now
  render as large layered WebGPU orb visuals with collection flash/mist
  proxies. Contact-shadow occlusion plus a directional WebGPU field shadow map
  now ground those WebGPU effects, and the shadow map now uses kind-aware
  orb/column/disc proxy casters for the visible avatar, Echo, Echo-burst, and
  pulse presentations. Full object-on-object shadow receiving remains out of
  scope. Forced WebGPU now advertises
  `readinessTier="diagnostic-core"` with `defaultEligible=false` and
  wires low-risk settings parity for quality,
  skybox, bloom toggle/strength, particle toggle, particle density, field
  scale, movement feel, and ripple/depth tuning in both playable WebGPU and
  `?webgpuDemo=1`. Forced WebGPU also now has a neutral
  `avatarPresentation` snapshot seam, `webgpu.integrationReadiness.*`
  diagnostics, `webgpu.defaultReadiness.*` summaries, and on-demand
  `verify:render:webgpu:readiness` / `verify:render:webgpu:default-soak` runs
  with visual glare/wash bounds. Arena/Track startup is now snapshot-driven:
  `RaceTrack` remains the CPU owner for containment, masks, and Echo placement,
  while forced WebGPU consumes neutral track mask bytes for visible body dim,
  edge glow, and center highlight in `mode=track`. Next, keep default rollout
  explicit and boring: longer soaks, main-branch avatar/racing data adaptation,
  and no automatic WebGPU default until those checks are accepted.
- Continue replacing brute-force particle density with more deliberate effects.
  Echo detonations now have a first layered poof-disc/glitter pass, but the
  broader particle system still needs a real split between sparkle mass, haze,
  and shader/procedural density.
- Make particle buffer uploads less blunt.
  First pass: continuous aura/wake emission now throttles as the resident buffer
  fills, and static color/twinkle/cloudiness attributes upload only dirty slot
  ranges. Forced WebGPU uploads active packed particle slots into a storage
  buffer for its diagnostic instanced-quad pass. Remaining work: dynamic
  position/alpha/size attributes still update broadly every frame, so
  investigate packed/interleaved buffers or a more GPU-driven particle state
  path before raising budgets again.
- Add a proper arena edge treatment.
  The cube field now fills the circular arena and the player is clamped inside
  it, but the boundary could use a visible rim, edge fade, collision feedback,
  or pulse shimmer so it feels intentional instead of invisible.
- Decide how this lab plugs into `voxel-sandbox-engine`.
  Keep this project standalone for now. Later, harvest visual patterns, shader
  tricks, or control ideas instead of merging the lab directly into the engine.

## Medium Priority

- Add a mobile browser presentation pass.
  Include a user-triggered fullscreen button for Android/compatible browsers,
  PWA manifest support for installed-app mode, iOS home-screen metadata, and
  `100dvh`/safe-area CSS so normal browser tabs use as much screen as the
  platform allows.
- Make mobile fullscreen state visible and honest.
  If `requestFullscreen()` is available, expose a clear tap target. If the
  browser cannot enter fullscreen, show a small non-intrusive hint that
  installing/adding to the home screen is the better path.
- Add browser-test hooks for pointer lock, camera orbit, and arena boundary
  behavior.
- Clean up quality presets after the fixed-radius arena change so each mode has
  a clear performance story.
- Polish WebGPU bloom/haze versus visible glitter now that forced WebGPU has a
  bounded blur-bloom pass; keep atmosphere local and avoid global glare.
- Improve pulse interaction design: charged pulses, pulse cooldown feel,
  movement-speed influence, and clearer impact timing.
- Add a camera preset or screenshot mode for comparing visual changes quickly.
- Preserve the forced-WebGPU diagnostic runtime as a reusable component harness.
  The compute probe, texture-preview harness, depth-backed field renderer,
  particle-preview renderer, skybox/arena/avatar/pulse/shadow/light/bloom presentation
  passes, WebGPU Echo orb pass, shared-depth scene-space effects,
  wake-energy probes,
  `wake.webgpu.*`/`ripple.webgpu.*`/`particle.webgpu.*`/`echo.webgpu.*` presentation
  diagnostics, and fast/soak Playwright verifiers are pretty enough to reuse
  for future raw-WebGPU spinoffs instead of starting from a blank canvas.

## Done / Recent Decisions

- Filled the circular arena with cubes instead of stopping the field at a square
  patch.
- Clamped the player avatar inside the same circular arena used by the cube
  field.
- Capped particle budgets back to the x10 Meltdown scale after the x100 stress
  pass became too brute-force for the intended sparkle-cloud look.
- Published the standalone project to GitHub as `project-ripples`.
- Added a small `F2`/pause-menu performance overlay with frame timing, render
  pressure, active particles, resident budgets, wave-source pressure, pixel
  ratio, bloom state, and quality preset.
- Pooled Echo collection burst meshes/materials/shard buffers so pickup effects
  reset resident resources instead of allocating and disposing burst geometry
  during gameplay.
- Added explicit browser render smoke scripts for WebGL, WebGPU capabilities,
  forced-WebGPU diagnostic rendering, and forced-WebGPU unavailable behavior.
- Split the current WebGL wake implementation behind a `WakeField` facade and
  backend contract so the next slice can add the WebGPU wake backend without
  changing gameplay call sites.
- Added a forced-WebGPU WGSL wake compute proof with explicit bind group
  layouts, GPU-side reset, ping-pong `rgba16float` textures, and
  `wake.webgpu.*` diagnostics.
- Added a forced-WebGPU wake preview pass that visibly samples the computed wake
  texture and logs `wake.webgpu.preview.*` diagnostics.
- Added a forced-WebGPU diagnostic RippleField preview that renders shared field
  layout cells, uploads synthetic vec4-packed pulse sources, samples the WebGPU
  wake texture, and logs `ripple.webgpu.*` diagnostics.
- Upgraded the forced-WebGPU RippleField preview to a depth-backed perspective
  hex-cap pass with a synthetic orbit camera and closer material-style wake,
  crest, source-ring, terrain tint, and lighting behavior.
- Bridged real playable state into forced WebGPU: live camera matrices, player
  movement/contact, manual/jump/landing pulse sources, quality switching, and
  `webgpu.sceneState.*` diagnostics now feed the diagnostic field by default.
- Split Echo gameplay state from WebGL Echo visuals and fed active Echoes plus
  collection events into forced WebGPU diagnostic field markers, shared HUD
  counts, `echo.state.*` diagnostics, and browser smoke collection assertions.
- Split ParticleVeil CPU simulation from WebGL `Points` visuals and fed that
  packed state into forced WebGPU as additive instanced soft quads with
  `particle.state.*`/`particle.webgpu.*` diagnostics and browser smoke coverage
  for movement, pulse, demo, and Echo collection particles.
- Added forced-WebGPU core scene presentation passes for skybox/background,
  arena curtain, avatar presentation, pulse glow proxies, and lightweight post
  glow, with `skybox.webgpu.*`, `arena.webgpu.*`, `avatar.webgpu.*`,
  `pulseLight.webgpu.*`, and `post.webgpu.*` browser smoke coverage.
- Stabilized forced-WebGPU scene-space presentation by sharing the field depth
  target with avatar, particle, pulse glow, and arena passes, clamping
  lightweight post glow, adding sparse wake-energy diagnostics, and adding the
  on-demand `verify:render:webgpu:soak` check.
- Added forced-WebGPU renderer-neutral local-light uploads and bounded
  multi-pass blur bloom with `lighting.webgpu.*`/`bloom.webgpu.*` diagnostics,
  `supportsLocalLights=true`, and `supportsBloom=true` in the diagnostic path.
- Added forced-WebGPU Echo orb visuals with layered dense core/halo/aura
  billboards, orbit motes/trails, collection flash/mist proxies,
  `echo.webgpu.*` diagnostics, and browser smoke/soak assertions.
- Added forced-WebGPU renderer-neutral contact-shadow casters and a WebGPU
  scene shadow buffer consumed by the RippleField material, with
  `shadow.webgpu.*` diagnostics and browser smoke/soak assertions.
- Added a forced-WebGPU directional `depth32float` shadow-map pass that renders
  lightweight avatar/Echo/pulse proxy casters before the field pass, combines
  PCF map visibility with contact occlusion, and logs `shadow.webgpu.map.*`.
- Upgraded the forced-WebGPU directional shadow map to kind-aware
  shape-proxy casters: avatar orbs, Echo columns, and pulse/Echo-burst discs
  now cast onto the RippleField receiver while contact shadows remain a
  separate local grounding layer.
- Wired forced-WebGPU deep settings parity for hex size, arena radius, hidden
  walk/sprint speed controls, surface grip, ripple height/radius, and
  Depth / Speed, including guardrailed field rebuilds and browser smoke
  assertions for readiness/frame diagnostics.
- Added forced-WebGPU integration-readiness prep: precise gap labels, neutral
  `avatarPresentation` snapshots consumed by the WebGPU avatar pass,
  `webgpu.integrationReadiness.*` diagnostics, stronger PNG brightness/wash
  checks, and an on-demand `verify:render:webgpu:readiness` smoke.
