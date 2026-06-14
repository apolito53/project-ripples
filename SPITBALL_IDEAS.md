# Spitball Ideas

Loose ideas for the ripple-field lab. These are not commitments; they are the
fun shelf where shiny concepts can sit until one of them starts looking useful.

## Visual / GPU Candy

- Procedural low-opacity nebula haze behind the visible glitter motes, so the
  aura has body without relying on millions of visible particles.
- Edge-rim shimmer around the circular arena boundary when waves touch it.
- Pulse colors that shift with movement speed, pulse charge, or field energy.
- Cube pressure waves where blocks lean or shear away from the player before
  snapping back into their grid.
- Far-field pulse storms that roll across the arena without player input.
- Occasional high-energy "showoff" events for strong GPUs: chained rings,
  secondary spark curtains, and brief bloom spikes that remain readable.

## Interaction Toys

- Hold `Space` to charge a larger pulse, then release to fire it.
- Draw pulses with mouse gestures while pointer lock is active.
- Boundary bounce feedback when the avatar pushes against the arena edge.
- A mode where the avatar conducts waves, turning movement into continuous
  ripple ribbons.
- Click-and-drag pulse painting for choreographing wave patterns.

## Engine Experiments

- GPU-driven particle state using textures or another browser-friendly compute
  approximation.
- Interleaved particle buffers with tighter update ranges.
- Worker-assisted generation for large instance fields or future arena presets.
- Shared visual-effect modules that could eventually inspire
  `voxel-sandbox-engine` without making this lab depend on that engine.
- A replayable pulse timeline for comparing performance and visuals across
  quality modes.

## Maybe Later / Probably Silly

- Music-reactive ripple mode.
- Arena presets or visual biomes.
- Weather-like field states: calm, storm, aurora, static charge.
- Saveable pulse choreography.
- A benchmark mode with intentionally dramatic warnings before Meltdown-grade
  settings.
