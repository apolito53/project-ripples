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

The tuning panel changes quality, ripple height/radius/speed, particle density,
and bloom strength while the scene is running.

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

- `src/rippleField.ts` owns the circular shader-displaced instanced cube field.
- `src/rippleSources.ts` keeps the tiny CPU-side pulse buffer sent to the GPU.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, and wake trails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, circular arena clamping, and camera
  pointer-lock behavior.

The CPU decides where the player and pulse sources are. The GPU handles cube
lift, stretch, tint, and emissive glow from those few uniforms.
