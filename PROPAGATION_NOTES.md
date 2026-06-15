# Propagation Notes

Research and planning notes for making Ripple Field Lab's wave propagation feel
less arbitrary and more like a coherent medium.

## Current Implementation

- Source ripples are analytic rings in `src/rippleField.ts`.
  Each source stores x/z position, start time, and strength. The shader computes
  `age = uTime - startTime`, then moves the ring front with
  `front = age * basePropagationSpeed * sourceSpeedMultiplier`.
- `basePropagationSpeed` is derived in `src/waveMedium.ts` using the
  shallow-water-inspired relationship `sqrt(gravity * effectiveDepth)`.
- `RIPPLE_WIDTH` is still the default ring thickness, but each source can now
  scale width, damping, speed, and optional travel direction.
- The moving avatar has two effects:
  - an immediate velocity-shaped bow/wake deformation in the shader;
  - emitted wake sources behind the avatar that reuse the same analytic ring
    propagation as manual and ambient pulses.
- Particles still have their own fake propagation:
  - burst particles move by their own particle velocities;
- pulse-light radius now follows the same base propagation speed, scaled down so
  the light supports the ring instead of drowning it.

The short version: propagation is now a physically inspired analytic model. It
is still not an emergent fluid/heightfield simulation.

## Research Notes

- In explicit numerical wave solvers, propagation speed is usually part of the
  modeled equation or medium. The timestep and grid spacing must respect a CFL
  stability relationship; MIT's finite-difference notes frame this as a limit on
  how far information can move per timestep.
  Source: https://ocw.mit.edu/courses/18-336-numerical-methods-for-partial-differential-equations-spring-2009/resources/mit18_336s09_lec15/
- For finite-difference wave equations, grid spacing is chosen relative to
  wavelength, and timestep is limited by the maximum wave speed in the domain.
  Source: https://ocw.mit.edu/courses/18-325-topics-in-applied-mathematics-waves-and-imaging-fall-2015/resources/mit18_325f15_appendix_b/
- In shallow water, long gravity-wave celerity is tied to gravity and depth,
  roughly `c = sqrt(g * depth)`. USACE also connects celerity to Froude number,
  which compares flow velocity against wave speed.
  Source: https://www.hec.usace.army.mil/publications/TrainingDocuments/TD-10.pdf
- NOAA uses the same shallow-water tsunami-speed relationship, making depth the
  controlling variable for long-wave travel speed.
  Source: https://www.noaa.gov/jetstream/tsunamis/tsunami-propagation
- Deep-water ocean waves are dispersive: speed depends on wavelength. Tessendorf
  uses the deep-water dispersion relationship `omega^2 = g * k`, connecting
  temporal frequency to spatial wave number.
  Source: https://jtessen.people.clemson.edu/reports/papers_files/coursenotes2004.pdf
- Real-time GPU water often uses physically motivated parameters while remaining
  deliberately approximate. GPU Gems' water chapter uses summed periodic waves
  and emphasizes parameters with physical meaning over pure trial-and-error.
  Source: https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models
- Moving-object wakes are not just repeated circular rings. Ship-wake literature
  uses Froude number and dispersion to reason about wake angle and wave pattern.
  Source: https://arxiv.org/abs/1304.2653

## Plan

1. Define the lab's unit model.
   Treat one grid unit as one meter for now, matching the voxel-engine convention
   we want this lab to eventually inspire. Keep the slider labels artistic, but
   give the internals names like `propagationMetersPerSecond`.

2. Replace the single global `waveSpeed` idea with a medium model. Done.
   Add a small `waveMedium` settings object:
   - `gravity`
   - `effectiveDepth`
   - `damping`
   - `dispersion`
   - `wakeSpeedMultiplier`
   Then derive base propagation speed from the medium, starting with
   `sqrt(gravity * effectiveDepth)` for a shallow-water-inspired mode.

3. Give each source explicit propagation metadata. Done.
   Pack or parallel-upload:
   - position
   - start time
   - amplitude
   - speed multiplier
   - wavelength/ring width
   - damping multiplier
   Manual pulses, ambient pulses, and movement wakes can then share the same
   medium while still feeling different.

4. Make the shader equation read like a wave model. Partially done.
   Replaced the old `front = age * uWaveSpeed` plus linear fade with:
   - phase based on `distance - speed * age`;
   - amplitude falloff from damping and distance;
   - optional dispersion widening/phase offset for longer-lived waves.

5. Treat movement wake as an oriented source family. Done.
   Keep the immediate bow/wake deformation, but make emitted wake sources carry
   direction and object-speed metadata. That lets the shader shape lingering
   wakes around the path rather than pretending every wake is a circular splash.

6. Add a debug propagation overlay. Done.
   Show base propagation speed, source count, effective depth, damping, and the
   expected ring radius for the newest pulse. This makes tuning less mystical and
   gives us a quick sanity check: if speed is `9 m/s`, the ring should be about
   nine meters out after one second.

7. Defer full heightfield simulation.
   A real 2D wave or shallow-water solver would be the next level: ping-pong
   height/velocity textures on the GPU, respect CFL, and sample that texture in
   the cube shader. That is more physically honest, but heavier and more complex.
   For this visual lab, a physically informed analytic model is the right next
   step before we earn that headache.
