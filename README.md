# Ripple Field Lab

A standalone GPU-heavy Three.js/Vite prototype for a field of luminous hex cells
that ripple, glow, and throw particles when the player moves through them.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

Current version: `v0.2.0-ALPHA`.

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

- `WASD` moves the glow avatar across the field.
- `Mouse click` captures camera look and drops a pulse.
- `Mouse movement` orbits the follow camera while captured.
- `Mouse wheel` zooms the follow camera in and out.
- `+` / `-` zoom in and out; `0` resets the camera distance.
- `Space` drops a pulse in front of the avatar.
- `Shift` increases movement speed.
- `F2` shows or hides the live performance overlay.
- `Esc` releases pointer lock and opens/closes the pause menu.
- The pause menu's version pill opens the in-app changelog.

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
Manual pulses have a short shared cooldown so held keys or rapid clicks do not
flood the field.
The avatar itself uses fast orbiting energy motes with long additive trails
instead of flat rings, so it reads as a moving glow cloud rather than a UI target.
Sparkling Echo columns spawn around the arena as real local light sources with
a bright inner orb, a vertically stretched diamond-shaped glow cloud, faster
core-local orbiting motes, and segmented fading trails. They wait until the
avatar runs through them, then detonate into a wider pulse, a flat disc burst of
sparks, and a short local orb-shatter effect without geometric ring markers.
Movement behaves like a small body pushing through water: the shader forms a
pressed fabric depression, local bow/wake displacement, and small raised rim
around the avatar, while stamped wake ripples remain in the field and propagate
outward after the avatar moves on. Dense movement wake stamps use a shorter
per-source lifetime than manual pulses so they can trail smoothly without
forcing older rings to flicker through the shader's fixed upload budget.

The Esc/hamburger pause menu changes quality, hex size, arena radius, ripple
height/radius, Depth / Speed, particle density, bloom strength, and the live
performance overlay while the scene is running. Hex size treats the current
cell scale as `1m`, ranges from `25cm` to `2m`, and measures the regular
hexagon's widest point-to-point diameter. Changing it rebuilds the instanced
field after a short debounce so slider drags do not spam geometry work. Arena
radius is expressed in lab meters: `200m` preserves the original scene radius,
while `400m` doubles it. Depth / Speed changes the medium's effective depth,
then shows the derived propagation speed from the shallow-water-inspired
`sqrt(g * depth)` model.
The HUD shows that derived speed, hex diameter, arena radius, active source count,
and the newest ring's approximate radius, plus the number of live Echo zones, so
propagation and scale tuning have a quick visual sanity check.
The performance overlay adds a denser tuning cockpit with frame/update/render
timing, active particles versus resident budget, rendered wave-source pressure,
draw calls, triangles, pixel ratio, bloom state, and quality mode.

## Quality Modes

- `Clean`: lower hex density, no bloom, small particle budget.
- `Pretty`: default polished mode with bloom, shadows, pulse lights, and sparks.
- `Showoff`: denser field, more particles, stronger bloom and shadows.
- `Meltdown`: visually interlocked honeycomb hex density and intentionally
  excessive effects for GPU stress.

## Development

```powershell
npm.cmd install
npm.cmd run debug:logs
npm.cmd run typecheck
npm.cmd run build
npm.cmd run validate
```

Local runs emit debug logs for Echo detonations, including particle burst counts
and frame timings around collection. They also report broader `frame.hitch`
warnings when a frame stalls outside the Echo watch window, with both raw clock
delta and capped simulation delta so render pauses do not hide behind physics
smoothing. Console lines include inline JSON so Chrome automation can read the
numbers instead of collapsed `Object` payloads. In DevTools, call
`window.__rippleDebugDump()` to inspect the retained in-page log.

For file-backed local logging, run `npm.cmd run debug:logs` in a second terminal.
The browser batches debug events to
`http://127.0.0.1:5184/__ripple_debug_log`; the receiver appends JSONL under
`logs/` and exposes `http://127.0.0.1:5184/tail?limit=80` for quick inspection.
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
  labels. The current baseline is `v0.2.0-ALPHA`.

## Design Notes

- `src/rippleField.ts` owns the circular shader-displaced instanced hex field,
  including the directional bow/wake deformation around the moving avatar and
  shader-side hex footprint/height scaling. It now renders only the lit cap
  surface, calibrates Meltdown into an interlocked honeycomb without increasing
  its old instance density, then tints cells by animated height so raised caps
  push toward white while troughs stay darker. Wave crests have their own glow
  varying so peak brightness can be tuned separately from generic
  player-proximity glow.
- `src/arenaBarrier.ts` owns the visual-only glowing arena-edge gradient that
  follows the live arena radius without changing collision behavior.
- `src/rippleSources.ts` keeps the lifetime-pruned pulse and movement-wake list
  sent to the GPU, including per-source speed, width, damping, lifetime, and
  optional direction metadata.
- `src/debugLog.ts` owns the local diagnostic log buffer, inline JSON console
  logging, and optional batching to the `5184` debug receiver used to profile
  Echo detonations and frame spikes.
- `src/echoZones.ts` owns persistent collectible Echo-column lights, bright orb
  lights, vertical diamond-style orb mist, avatar-style segmented crystal orbit
  trails, and their run-through trigger/despawn burst detection.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/labSettings.ts` maps UI meters onto the original scene-unit art scale,
  including hex point-to-point diameter scaling and the 200m-to-400m arena
  radius range.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, layered Echo poof-disc bursts, and wake trails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, scene-input
  gating while menus are open, and camera pointer-lock behavior. The avatar
  visuals in `src/main.ts` use orbiting motes and segmented additive trails
  instead of torus rings.

The CPU decides where the player, manual pulses, persistent Echo zones, and
movement wakes are. Manual pulse input is cooldown-gated, Echo zones only become
wave sources after collection, sources age out by per-source lifetime, and
propagation speed comes from the current wave medium. The GPU handles hex lift,
stretch, tint, emissive glow, and cell footprint/height from the newest rendered
source uniforms, with dense fields allowed to render fewer sources than the
full gameplay source list contains.
