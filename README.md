# Ripple Field Lab

A standalone GPU-heavy Three.js/Vite prototype for a field of luminous hex cells
that ripple, glow, and throw particles when the player moves through them.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

Current version: `v0.4.0-ALPHA`.

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

Open `http://127.0.0.1:5183`.

## Controls

- `W` / `S` move forward and backward.
- `A` / `D` turn left and right by default.
- `Q` / `E` strafe left and right.
- Hold left mouse button to orbit the camera without changing avatar facing.
- Hold right mouse button to orbit the camera and steer avatar facing together;
  while held, `A` / `D` strafe instead of turning.
- Hold both mouse buttons to move forward in the camera-facing direction.
- Mouse look now has a full 180-degree vertical orbit range from straight below
  the avatar to straight overhead.
- Releasing one mouse button downgrades to the remaining drag mode; releasing
  the last held scene mouse button restores the cursor.
- `Mouse wheel` zooms the follow camera in and out.
- `+` / `-` zoom in and out; `0` resets the camera distance.
- `Space` jumps high, with small takeoff and stronger landing ripples. Airborne
  movement preserves takeoff momentum instead of letting input redirect the
  trajectory mid-jump.
- `Shift` sprints with momentum.
- `F2` shows or hides the live performance overlay.
- `Esc` opens/closes the pause menu.
- The pause menu's version pill opens the in-app changelog.
- The on-screen pulse button drops manual pulses on touch layouts.

The avatar is clamped inside the circular arena edge.
The arena edge is rendered as a smooth glowing gradient barrier so the playable
boundary is visible in-world without looking like a tiled wall texture.
The hex field is drawn as a single shader-animated cap surface, without the old
per-cell vertical shafts, so the renderer is cleaner for the upcoming spherical
arena pass. Meltdown uses a calibrated honeycomb footprint so tiny hexes
visually interlock without raising the old stress-test instance count, while
lighter quality modes keep more breathing room.
Raised wave crests carry an extra bounded glow signal, so ripple fronts bloom
brighter without washing out the whole field.
Manual touch pulses have a short shared cooldown so the on-screen pulse button
does not flood the field.
The avatar itself uses brighter fast orbiting energy motes with long additive
trails instead of flat rings, so it reads as a moving glow cloud rather than a
UI target.
Sparkling Echo columns spawn around the arena as real local light sources with
a bright inner orb, a vertically stretched diamond-shaped glow cloud, faster
core-local orbiting motes, and segmented fading trails. They wait until the
avatar runs through them, then detonate into a wider pulse, a flat disc burst of
sparks, and a short local orb-shatter effect without geometric ring markers.
Movement has acceleration, braking, and stronger carried momentum instead of
snapping instantly to full speed. Walk defaults to `10 m/s` and sprint defaults
to `37 m/s`, with grounded acceleration, counter-steering, and release braking
tuned for a more slide-y feel. The pause menu's `Surface Grip` slider scales
that grounded response from slicker low-grip handling to tighter high-grip
handling without changing walk or sprint top speed. It behaves like a small body
pushing through water: the shader forms a pressed fabric depression, local
bow/wake displacement, and small raised rim around the avatar, while a dedicated
GPU wake texture stores the lingering height/velocity field left behind by
movement. The visible movement particle trail is now a tighter
velocity-following tail instead of a broad glitter shed.
Jumping fades that surface contact while the avatar is airborne, then landing
stamps a brighter impact ripple back into the field. Touch-button pulses and
collected Echoes still use analytic ring sources, but ordinary movement no
longer adds little circular wave sources while the avatar runs.

The Esc/hamburger pause menu changes quality, skybox theme, hex size, arena
radius, surface grip, ripple height/radius, Depth / Speed, particle density,
bloom strength, and the live performance overlay while the scene is running.
Hex size treats
the current cell scale as `1m`, ranges from `25cm` to `2m`, and measures the regular
hexagon's widest point-to-point diameter. Changing it rebuilds the instanced
field after a short debounce so slider drags do not spam geometry work. Arena
radius is expressed in lab meters: `200m` preserves the original scene radius,
while `400m` doubles it. Depth / Speed changes the medium's effective depth,
then shows the derived propagation speed from the shallow-water-inspired
`sqrt(g * depth)` model.
The lab now clamps extreme hex-size/arena-radius combinations before rebuilding
the field, using per-quality instance budgets so a casual slider drag cannot
spawn millions of hexes. If you intentionally want stress-test behavior, open
the app with `?stress=1` or set `localStorage.rippleStressMode = "1"`.
The HUD shows that derived speed, hex diameter, arena radius, active pulse count,
and the newest pulse's approximate radius, plus the number of live Echo zones, so
propagation and scale tuning have a quick visual sanity check.
The performance overlay adds a denser tuning cockpit with frame/update/render
timing, active particles versus resident budget, rendered pulse-source pressure,
GPU wake texture mode/pass cost, draw calls, triangles, pixel ratio, bloom state,
and quality mode.
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

## Development

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run debug:logs
npm.cmd run diagnostics
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke
npm.cmd run verify:render:webgl
npm.cmd run verify:webgpu:capabilities
npm.cmd run verify:render:webgpu
npm.cmd run verify:render:webgpu:default-soak
npm.cmd run verify:render:webgpu:unavailable
npm.cmd run validate
```

`npm.cmd run dev` starts both the Vite app and the local debug log receiver.
Use `npm.cmd run dev:vite` when you intentionally want only the Vite server.

Local runs emit debug logs for Echo detonations, including particle burst counts
and frame timings around collection. They also report broader frame warnings
when a frame stalls outside the Echo watch window. New logs split those warnings
into `frame.renderHitch`, `frame.updateHitch`, `frame.mixedHitch`, and
`frame.clockGap` so true render pressure is not blended with sleep/reload/browser
clock gaps. Console lines include inline JSON so Chrome automation can read the
numbers instead of collapsed `Object` payloads. In DevTools, call
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
`npm.cmd run smoke` checks app/log-server health and retained diagnostics.
The `verify:render:*` scripts launch Playwright Chromium for browser-level
checks: WebGL must boot the playable scene, forced WebGPU must render the
interactive playable-state `diagnostic-core` canvas plus a visible 3D
RippleField wake-sampling preview with large layered WebGPU Echo orb visuals,
instanced diagnostic particles, skybox/background, arena barrier, avatar
marker, pulse glows, contact shadows, directional shadow maps, local lights,
and bloom. The fast
forced-WebGPU check also toggles particles, particle density, bloom, skybox,
quality, field scale, movement feel, and ripple/depth tuning controls and asserts
`webgpu.readiness.*`, `webgpu.integrationReadiness.*`, and
`webgpu.settings.change` diagnostics. The WebGL and forced-WebGPU render checks
also exercise Track startup through `mode=track`: WebGL keeps the current
`RaceTrack` wall/mask path, and forced WebGPU consumes the neutral track mask
snapshot for body dimming, edge glow, and center highlight without initializing
WebGL-only scene systems. `verify:render:webgpu:soak` runs the
longer on-demand forced-WebGPU movement/pulse/Echo/quality stability check and
asserts bounded wake energy plus readiness/default-eligibility and bounded
bloom/local-light/shadow-map diagnostics. `verify:render:webgpu:readiness`
runs an explicit roughly 60-second integration-readiness pass with movement,
pulse, Echo collection, skybox/quality changes, particle/bloom toggles, field
scale/depth churn, and PNG bounds for glare/cyan-blue wash coverage,
`verify:render:webgpu:default-soak` runs the explicit two-minute-plus
default-readiness proof with resize/focus churn and `webgpu.defaultReadiness.*`
summary assertions,
`verify:webgpu:capabilities` checks the browser's WebGPU adapter/device limits,
and `verify:render:webgpu:unavailable` masks `navigator.gpu` to confirm forced
WebGPU fails loudly instead of falling back.
On Windows the verifier defaults to the installed Chrome channel so local runs
use the same GPU path as manual checks; set `RIPPLE_CHROME_CHANNEL` to override
that, or run `npx playwright install chromium` if you want bundled Chromium.
Set `localStorage.rippleDebug = "0"` or open `?debug=0` to silence browser
debug logging. Set `localStorage.rippleLogServer = "0"` or open `?logServer=0`
to keep console logging on while disabling the local receiver writes. For
parallel runs, pass a port such as `?logServer=15184` to post browser diagnostics
to that receiver instead of the default `5184`.

To run the browser checks against a parallel app/log pair on `15183/15184`:

```powershell
$env:RIPPLE_APP_URL = "http://127.0.0.1:15183/"
$env:RIPPLE_LOG_HEALTH_URL = "http://127.0.0.1:15184/health"
$env:RIPPLE_LOG_EVENTS_URL = "http://127.0.0.1:15184/events"
$env:RIPPLE_LOG_POST_URL = "http://127.0.0.1:15184/__ripple_debug_log"
npm.cmd run verify:render:webgl
npm.cmd run verify:render:webgpu
npm.cmd run verify:render:webgpu:soak
npm.cmd run verify:render:webgpu:readiness
npm.cmd run verify:render:webgpu:default-soak
```

Renderer backend selection is scaffolded for the WebGPU migration. The current
default visual backend remains WebGL/Three. `?renderer=webgpu` forces a visible
diagnostic WebGPU runtime that owns the canvas, configures a DPR-clamped WebGPU
context, runs a WGSL wake compute proof, and renders a depth-backed perspective
diagnostic field preview from shared RippleField layout data while sampling
that wake texture. It now also renders a WebGPU skybox/background, arena
barrier, hover-pod avatar proxy layered over the saved `mote-core-orbit`
avatar asset, pulse glow proxies, additive CPU-state particles, large layered
WebGPU Echo orb visuals, renderer-neutral contact
shadows/local lights, a directional WebGPU shadow map with kind-aware
orb/column/disc proxy casters sampled by the field receiver, and a bounded
blur-bloom composite. Forced WebGPU reports
`readinessTier="diagnostic-core"` and `defaultEligible=false`. `mode=track`
now creates the CPU `RaceTrack` state owner, emits a renderer-neutral mask
snapshot, scopes Echo placement/collection to the track ribbon, disables the
circular arena curtain, and lets the WebGPU RippleField pass upload/sample the
track mask for visible Track-vs-Arena presentation. No race laps, timers,
checkpoints, track-wall WebGPU geometry, or default rollout are enabled here.
The neutral avatar presentation snapshot now feeds the WebGPU avatar pass, which
keeps future main-branch racing/avatar data on a clean render-snapshot seam
without passing gameplay objects through the render contract.
The WebGPU avatar, particle, pulse glow, and arena passes read the field depth
buffer without writing it so scene-space effects no longer float through the hex field. By default, forced WebGPU
uses the real player/camera state, real pulse-source snapshots, shared Echo
spawning/collection state, and depth-read Echo orb visuals with collection
flash/mist proxies; add `?webgpuDemo=1` to restore the synthetic orbit/source
harness for component checks.
It logs adapter/device plus `wake.webgpu.*`, `ripple.webgpu.*`, and
`particle.webgpu.*` status plus `skybox.webgpu.*`, `arena.webgpu.*`,
`avatar.webgpu.*`, `pulseLight.webgpu.*`, `echo.webgpu.*`,
`shadow.webgpu.*`, `lighting.webgpu.*`, and
`bloom.webgpu.*` presentation events, `webgpu.readiness.*`,
`webgpu.integrationReadiness.*`, and `webgpu.defaultReadiness.*` readiness
samples, `webgpu.settings.change` setting-change records, and sparse wake-energy fields on
WebGPU wake/scene/frame samples. Quality, skybox, bloom toggle/strength,
particle toggle, particle density, hex size, arena radius, hidden
walk/sprint speed controls, surface grip, ripple height/radius, and
Depth / Speed are wired in forced WebGPU; field-scale changes reuse the same
instance-budget guardrails as WebGL and rebuild/reset the WebGPU field/wake
path after the existing debounce. It is still diagnostic-only and
`defaultEligible=false` until an explicit rollout decision and longer
default-readiness soak are accepted. Use `?renderer=webgl` for the explicit
current backend or omit the parameter for conservative `auto` WebGL mode.

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
  labels. The current baseline is `v0.4.0-ALPHA`.

## Design Notes

- `src/rippleFieldLayout.ts` owns renderer-neutral hex placement, terrain tint,
  phase, and rendered-source limit math shared by WebGL and the diagnostic
  WebGPU field preview.
- `src/rippleField.ts` owns the circular shader-displaced instanced hex field,
  including the local bow deformation around the moving avatar, sampled GPU
  wake texture displacement, and shader-side hex footprint/height scaling. It
  now renders only the lit cap
  surface, calibrates Meltdown into an interlocked honeycomb without increasing
  its old instance density, then tints cells by animated height so raised caps
  push toward white while troughs stay darker. Wave crests have their own glow
  varying so peak brightness can be tuned separately from generic
  player-proximity glow.
- `src/arenaBarrier.ts` owns the visual-only glowing arena-edge gradient that
  follows the live arena radius without changing collision behavior.
- `src/skybox.ts` owns the selectable camera-following sky dome, high-res versus
  fallback texture selection, per-theme vertical framing, and fog tuning. The
  current generated skybox assets live in `public/skyboxes/`.
- `src/wakeField.ts` owns the ping-pong GPU wake heightfield for movement,
  including capability fallback, quality-sized render targets, and sampled
  `wake.*` diagnostics.
- `src/wake/webGpuWakeFieldProbe.ts` and its WGSL shader own the forced-WebGPU
  diagnostic wake compute proof. `src/ripple/webGpuRippleFieldPreview.ts` and
  its WGSL shader render depth-tested perspective hex caps from the shared
  layout, upload vec4-packed pulse sources, sample the wake texture, and log
  `ripple.webgpu.*` events from either real playable-state snapshots or the
  optional `webgpuDemo=1` synthetic harness. The older raw wake preview module
  remains a useful small texture-preview harness.
- `src/render/webGpuSkyboxPass.ts`, `src/render/webGpuArenaBarrierPass.ts`,
  `src/render/webGpuAvatarPreview.ts`, `src/render/webGpuPulseGlowPass.ts`,
  `src/render/webGpuEchoVisualPass.ts`, `src/render/webGpuSceneShadowBuffer.ts`,
  `src/render/webGpuShadowMapPass.ts`, `src/render/webGpuSceneLightBuffer.ts`,
  and `src/render/webGpuBloomPass.ts`
  own the forced-WebGPU core scene
  presentation layer: skybox texture selection/loading, arena curtain, neutral
  avatar marker, pulse glow proxies, Echo orb visuals/collection flashes,
  renderer-neutral contact shadows, directional field shadows, local lights, and
  bounded blur bloom.
- `src/rippleSources.ts` keeps the lifetime-pruned manual/Echo pulse list and
  exposes renderer-neutral pulse-source snapshots, including per-source speed,
  width, damping, and lifetime.
- `src/echoState.ts` owns renderer-neutral Echo gameplay state, spawn and
  collection checks, active Echo snapshots, and `echo.state.*` diagnostics.
- `src/particleState.ts` owns renderer-neutral CPU particle state, packed active
  slots, spawn/update math, dirty ranges, and snapshots shared by the WebGL
  facade and forced-WebGPU diagnostic particle pass.
- `src/debugLog.ts` owns the local diagnostic log buffer, inline JSON console
  logging, and optional batching to the `5184` debug receiver used to profile
  Echo detonations and frame spikes.
- `scripts/ripple-smoke-harness.mjs` shares server startup, URL, and diagnostics
  helpers between `scripts/smoke.mjs` and the Playwright browser render smoke
  checks in `scripts/verify-render.mjs`.
- `src/render/threeRenderRuntime.ts` owns the current WebGL renderer,
  postprocessing composer, bloom/direct-render switch, resize, prewarm, and
  backend stats. `src/render/types.ts` defines the per-frame render snapshot.
  `src/render/webGpuRenderRuntime.ts` owns the visible forced-WebGPU diagnostic
  runtime plus wake compute, field preview, core presentation passes,
  particle-preview proof, contact shadows, directional field shadows, lighting,
  and bloom composite, while `src/render/webgpu.ts` and
  `src/render/webGpuProbe.ts` provide the shared WebGPU lifecycle/probe
  scaffolding for the staged port.
- `src/echoZones.ts` mirrors shared Echo state into persistent collectible
  Echo-column lights, bright orb lights, vertical diamond-style orb mist,
  avatar-style segmented crystal orbit trails, and run-through collection
  bursts.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/labSettings.ts` maps UI meters onto the original scene-unit art scale,
  including surface grip defaults, hex point-to-point diameter scaling, and the
  200m-to-400m arena radius range.
- `src/particleVeil.ts` mirrors shared particle state into WebGL `Points` for
  the player sparkle aura, additive glitter-cloud bursts, layered Echo
  poof-disc bursts, bright shader energy, and tight velocity-following wake
  tails. `src/particle/webGpuParticleVeilPreview.ts` and its WGSL shader render
  the same CPU particle snapshots as additive instanced soft quads in forced
  WebGPU.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, scene-input
  gating while menus are open, split left/right hold-to-look pointer-lock
  behavior, camera-only orbit yaw, right-drag steering yaw, WoW-style keyboard
  turning/strafe semantics, surface-grip handling response, ballistic airborne
  horizontal momentum, both-button camera-forward movement, full 180-degree
  vertical camera orbit, and quiet mouse-release unlocks. The avatar visuals in
  `src/main.ts` use orbiting motes and segmented additive trails instead of
  torus rings.

The CPU decides where the player, touch-button pulses, and persistent Echo zones
are. Manual pulse input is cooldown-gated, Echo zones only become pulse sources
after collection, and pulse sources age out by per-source lifetime. Movement wake
is fed into a small GPU height/velocity texture instead of the pulse source list.
The GPU handles wake propagation, hex lift, stretch, tint, emissive glow, and
cell footprint/height from the wake texture plus the newest rendered pulse
source snapshot, with dense fields allowed to render fewer pulse sources than
the full gameplay source list contains.
