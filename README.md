# Ripple Field Lab

A standalone GPU-heavy Three.js/Vite prototype for a field of luminous cubes
that ripple, glow, and throw particles when the player moves through them.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

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
Manual pulses have a short shared cooldown so held keys or rapid clicks do not
flood the field.
Sparkling Echo columns spawn around the arena as real local light sources with
a bright inner orb, a soft volumetric-style glow cloud, orbiting motes, and
subtle trails. They wait until the avatar runs through them, then detonate into
a wider pulse and flat disc burst of sparks.
Movement behaves like a small body pushing through water: the shader forms a
pressed fabric depression, local bow/wake displacement, and small raised rim
around the avatar, while stamped wake ripples remain in the field and propagate
outward after the avatar moves on. Dense movement wake stamps use a shorter
per-source lifetime than manual pulses so they can trail smoothly without
forcing older rings to flicker through the shader's fixed upload budget.

The tuning panel changes quality, ripple height/radius, Depth / Speed, particle
density, and bloom strength while the scene is running. Depth / Speed changes
the medium's effective depth, then shows the derived propagation speed from the
shallow-water-inspired `sqrt(g * depth)` model.
The HUD shows that derived speed, active source count, and the newest ring's
approximate radius, plus the number of live Echo zones, so propagation tuning
has a quick visual sanity check.

## Quality Modes

- `Clean`: lower cube density, no bloom, small particle budget.
- `Pretty`: default polished mode with bloom, shadows, pulse lights, and sparks.
- `Showoff`: denser field, more particles, stronger bloom and shadows.
- `Meltdown`: intentionally excessive density and effects for GPU stress.

## Development

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd run validate
```

Dedicated ports:

- Dev server: `5183`
- Preview server: `4183`

Project planning:

- `TODO.md` tracks concrete high-priority and medium-priority follow-up work.
- `SPITBALL_IDEAS.md` keeps loose visual, interaction, and engine ideas separate
  from the committed roadmap.

## Design Notes

- `src/rippleField.ts` owns the circular shader-displaced instanced cube field,
  including the directional bow/wake deformation around the moving avatar.
- `src/rippleSources.ts` keeps the lifetime-pruned pulse and movement-wake list
  sent to the GPU, including per-source speed, width, damping, lifetime, and
  optional direction metadata.
- `src/echoZones.ts` owns persistent collectible Echo-column lights, bright orb
  lights, volumetric-style orb mist, orbiting sparkle trails, and their
  run-through trigger detection.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, flat Echo disc bursts, and wake trails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, and camera
  pointer-lock behavior.

The CPU decides where the player, manual pulses, persistent Echo zones, and
movement wakes are. Manual pulse input is cooldown-gated, Echo zones only become
wave sources after collection, sources age out by per-source lifetime, and
propagation speed comes from the current wave medium. The GPU handles cube lift,
stretch, tint, and emissive glow from the current source uniforms.
