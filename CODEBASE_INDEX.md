# Codebase Index

Last reviewed: 2026-06-14

Purpose: compact map for the standalone ripple-field visual lab.

## Stack

- Vite + strict TypeScript browser app.
- Three.js renderer, postprocessing composer, Unreal bloom pass, shader-customized
  `InstancedMesh`, additive `Points`, and dynamic lights.
- Dedicated dev port `5183`; preview port `4183`.

## Commands

- Install: `npm.cmd install`
- Windows start: `.\start.ps1`
- Linux/Ubuntu start: `chmod +x ./start.sh && ./start.sh`
- Dev server: `npm.cmd run dev`
- Type check: `npm.cmd run typecheck`
- Production build: `npm.cmd run build`
- Standard validation: `npm.cmd run validate`

## Fast Lookup

- HTML shell and tuning panel controls: `index.html`
- Visual styling and overlay layout: `src/styles.css`
- App bootstrap, Three.js scene, render loop, quality wiring, and postprocessing:
  `src/main.ts`
- Avatar movement, circular arena clamp, pointer lock, and camera follow behavior:
  `src/controls.ts`
- Circular shader-displaced instanced cube field: `src/rippleField.ts`
- Lifetime-pruned pulse source list and shader uniform writer:
  `src/rippleSources.ts`
- Player sparkle aura, additive particle bursts, and wake trails:
  `src/particleVeil.ts`
- Recent-pulse point light pool: `src/pulseLights.ts`
- Quality preset budgets and labels: `src/qualityPresets.ts`
- Runtime settings shape/defaults: `src/labSettings.ts`
- Procedural field height sampler: `src/terrain.ts`
- Prioritized concrete follow-up work: `TODO.md`
- Loose visual, interaction, and engine ideas: `SPITBALL_IDEAS.md`

## Runtime Flow

1. `index.html` loads `src/main.ts`.
2. `main.ts` creates the renderer, scene, camera, bloom composer, field, particles,
   pulse lights, and glow avatar.
3. `PlayerRig` updates planar movement and camera follow every frame.
4. Cooldown-gated clicks, `Space`, wake trails, and ambient timers add pulse
   sources.
5. `RippleField` builds cube instances inside the circular arena and sends
   active source uniforms to the shader; cube matrices stay static while the GPU
   animates lift/stretch/glow.
6. `ParticleVeil` animates the player sparkle aura, burst clouds, and wake motes.
7. `PulseLightRig` assigns recent pulses to point lights.
8. The scene renders through bloom when bloom strength is above zero.

## Common Change Targets

- Tune visual density or GPU pressure: `src/qualityPresets.ts`
- Change ripple math, cube shape, tint, or glow: `src/rippleField.ts`
- Change particles, wake behavior, or burst count: `src/particleVeil.ts` and
  `src/main.ts`
- Change movement/camera feel or the circular player boundary: `src/controls.ts`
- Change panel layout or labels: `index.html` and `src/styles.css`

## Sharp Edges

- The field is a visual lab, not voxel terrain. Do not add save data or chunk
  loading here unless the project deliberately changes shape.
- Keep the CPU/GPU contract small: pulse uniforms, player position, and settings
  go in; shader animation comes out. The shader still has a fixed upload budget,
  but ripple retention should be governed by lifetime and input cooldown rather
  than a tiny gameplay cap.
- `Meltdown` is intentionally rude to weak GPUs. Keep it available, but do not
  tune the normal experience around it.
- Pointer-lock behavior should be browser-tested in Chrome, not trusted from a
  build alone.
