# TODO

Prioritized work for the standalone ripple-field visual lab. Keep this file for
concrete follow-ups that we actually intend to revisit.

## High Priority

- Shape the lab into a racing-game prototype.
  First pass now has a wide non-crossing track ribbon inside the arena with
  bright glowing walls, heavy off-track dimming, track-scoped Echo placement,
  slide-and-bleed containment, a startup Track/Arena split, and track-only hex
  culling. Next racing steps: checkpoint/lap structure, speed-readable effects,
  and eventually dedicated track design tooling.
- Continue replacing brute-force particle density with more deliberate effects.
  Echo detonations now have a first layered poof-disc/glitter pass, but the
  broader particle system still needs a real split between sparkle mass, haze,
  and shader/procedural density.
- Make particle buffer uploads less blunt.
  First pass: continuous aura/wake emission now throttles as the resident buffer
  fills, and static color/twinkle/cloudiness attributes upload only dirty slot
  ranges. Remaining work: dynamic position/alpha/size attributes still update
  broadly every frame, so investigate packed/interleaved buffers or a more
  GPU-driven particle state path before raising budgets again.
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
- Split bloom/haze from visible glitter so the player can have atmosphere
  without becoming a glowing blob.
- Improve pulse interaction design: charged pulses, pulse cooldown feel,
  movement-speed influence, and clearer impact timing.
- Add a camera preset or screenshot mode for comparing visual changes quickly.

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
- Added the first wide race-track ribbon inside the arena, with glowing
  containment walls, off-track dimming, and Echo placement moved onto the course.
- Added a traditional startup main menu that starts either the full Arena
  sandbox or the constrained Track prototype instead of loading directly into
  gameplay.
- Added track-only hex placement clipping so Track mode skips off-course hexes,
  while Arena mode still renders the full circular field.
