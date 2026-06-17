# Ripple Field Lab

A standalone GPU-heavy Three.js/Vite prototype for a field of luminous cubes
that ripple, glow, and throw particles when the player moves through them.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

Current version: `v0.1.2-ALPHA`.

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
- `Esc` releases pointer lock.

The avatar is clamped inside the circular arena edge.
The arena edge is rendered as a glowing volumetric barrier so the playable
boundary is visible in-world instead of only being implied by movement clamping.
The voxel field is drawn as lit animated caps with same-width column shafts
sinking into the stage below them, so the field reads as depth instead of
floating platform tiles.
Manual pulses have a short shared cooldown so held keys or rapid clicks do not
flood the field.
Sparkling Echo columns spawn around the arena as real local light sources with
a bright inner orb, a vertically stretched diamond-shaped glow cloud, orbiting
motes, and subtle trails. They wait until the avatar runs through them, then
detonate into a wider pulse, a flat disc burst of sparks, and a short local
orb-shatter effect.
Movement behaves like a small body pushing through water: the shader forms a
pressed fabric depression, local bow/wake displacement, and small raised rim
around the avatar, while stamped wake ripples remain in the field and propagate
outward after the avatar moves on. Dense movement wake stamps use a shorter
per-source lifetime than manual pulses so they can trail smoothly without
forcing older rings to flicker through the shader's fixed upload budget.

The tuning panel changes quality, voxel size, arena radius, ripple
height/radius, Depth / Speed, particle density, and bloom strength while the
scene is running. Voxel size treats the current block scale as `1m`, ranges from
`25cm` to `2m`, and rebuilds the instanced field after a short debounce so slider
drags do not spam geometry work. Arena radius is expressed in lab meters:
`200m` preserves the original scene radius, while `400m` doubles it. Depth /
Speed changes the medium's effective depth, then shows the derived propagation
speed from the shallow-water-inspired `sqrt(g * depth)` model.
The HUD shows that derived speed, voxel size, arena radius, active source count,
and the newest ring's approximate radius, plus the number of live Echo zones, so
propagation and scale tuning have a quick visual sanity check.

## Quality Modes

- `Clean`: lower cube density, no bloom, small particle budget.
- `Pretty`: default polished mode with bloom, shadows, pulse lights, and sparks.
- `Showoff`: denser field, more particles, stronger bloom and shadows.
- `Meltdown`: intentionally excessive density and effects for GPU stress.

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
  labels. The current baseline is `v0.1.2-ALPHA`.

## Design Notes

- `src/rippleField.ts` owns the circular shader-displaced instanced cube field,
  including the directional bow/wake deformation around the moving avatar and
  shader-side voxel footprint/height scaling. It draws lit caps plus cheaper
  Lambert-lit same-width column shafts, then tints voxels by animated height so
  raised cubes push toward white while lower shaft bases keep the cap hue and
  fade darker.
- `src/arenaBarrier.ts` owns the visual-only glowing arena-edge barrier that
  follows the live arena radius without changing collision behavior.
- `src/rippleSources.ts` keeps the lifetime-pruned pulse and movement-wake list
  sent to the GPU, including per-source speed, width, damping, lifetime, and
  optional direction metadata.
- `src/debugLog.ts` owns the local diagnostic log buffer, inline JSON console
  logging, and optional batching to the `5184` debug receiver used to profile
  Echo detonations and frame spikes.
- `src/echoZones.ts` owns persistent collectible Echo-column lights, bright orb
  lights, vertical diamond-style orb mist, orbiting sparkle trails, and their
  run-through trigger/despawn burst detection.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/labSettings.ts` maps UI meters onto the original scene-unit art scale,
  including voxel-size density scaling and the 200m-to-400m arena radius range.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, flat Echo disc bursts, and wake trails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, and camera
  pointer-lock behavior.

The CPU decides where the player, manual pulses, persistent Echo zones, and
movement wakes are. Manual pulse input is cooldown-gated, Echo zones only become
wave sources after collection, sources age out by per-source lifetime, and
propagation speed comes from the current wave medium. The GPU handles cube lift,
stretch, tint, emissive glow, and voxel footprint/height from the current source
and scale uniforms.
