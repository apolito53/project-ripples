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
- `Space` drops a pulse in front of the avatar.
- `Shift` increases movement speed.
- `Esc` releases pointer lock.

The avatar is clamped inside the circular arena edge.
Manual pulses have a short shared cooldown so held keys or rapid clicks do not
flood the field.
Movement behaves like a small body pushing through water: the shader forms a
pressed fabric depression, bow/wake displacement, and small raised rim around
the avatar, while trailing wake ripples propagate outward after the avatar slows
down.

The tuning panel changes quality, ripple height/radius, Depth / Speed, particle
density, and bloom strength while the scene is running. Depth / Speed changes
the medium's effective depth, then shows the derived propagation speed from the
shallow-water-inspired `sqrt(g * depth)` model.
The HUD shows that derived speed, active source count, and the newest ring's
approximate radius so propagation tuning has a quick visual sanity check.

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
  sent to the GPU, including per-source speed, width, damping, and direction
  metadata.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, and wake trails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, and camera
  pointer-lock behavior.

The CPU decides where the player, manual pulses, ambient pulses, and movement
wakes are. Manual pulse input is cooldown-gated, sources age out by lifetime,
and propagation speed comes from the current wave medium. The GPU handles cube
lift, stretch, tint, and emissive glow from the current source uniforms.
