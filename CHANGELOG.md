# Changelog

## Unreleased

### Added

- Added a shared JSONL diagnostics analyzer with `npm.cmd run diagnostics`,
  `npm.cmd run logs:summary`, and a broad `npm.cmd run verify:perf` perf gate
  for obvious frame/rebuild runaway costs.
- Added debug receiver summaries and filtered tails through
  `/summary?format=text`, `/tail?source=latest&channel=...`, and timing filters
  such as `minFrameMs`, `minRawClockDeltaMs`, and `minDurationMs`.
- Added per-quality field instance budgets that clamp extreme hex-size and
  arena-radius combinations before rebuilding, plus an explicit `?stress=1` /
  `localStorage.rippleStressMode = "1"` escape hatch for intentional GPU stress
  tests.

### Changed

- Split broad browser frame warnings into cause-specific channels:
  `frame.renderHitch`, `frame.updateHitch`, `frame.mixedHitch`, and
  `frame.clockGap`, while the diagnostics analyzer still classifies legacy
  `frame.hitch` JSONL entries.
- Changed debug receiver stdout from a narrow slow-frame count to a richer
  warning/hitch summary so raw clock gaps and rebuild warnings are visible.
- Reduced continuous player aura/wake particle pressure by scaling emission as
  the resident particle buffer fills, and narrowed static particle attribute
  uploads to dirty slot ranges instead of the full active buffer.
- Split HUD formatting, frame-hitch payload assembly, and field-scale guardrail
  decisions out of `src/main.ts` into focused modules so the render bootstrap is
  less crowded.
- Pooled Echo collection burst meshes, materials, and shard buffers so Echo
  pickups reset resident resources instead of allocating and disposing burst
  geometry during gameplay.

## 0.3.0-ALPHA - 2026-06-19

### Changed

- Moved scene tuning controls into a centered Esc/hamburger pause menu with a
  Resume action and an in-app changelog dialog opened from the version button.
- Rotated the hex prism geometry to match the staggered lattice and calibrated
  Meltdown's visible hex footprint into an interlocked honeycomb without raising
  the previous stress-test instance count.
- Removed the field's per-hex vertical shaft mesh and duplicate shaft shader,
  leaving a single animated cap surface as cleaner groundwork for the upcoming
  spherical arena change.
- Reworked Echo detonation particles from a raw glitter disc into a soft
  low-alpha poof disc with a smaller large-glitter accent layer, cutting live
  particle pressure while keeping the burst bright and readable.
- Added a density-aware shader-source throttle so extreme 25cm hex fields render
  fewer newest wave sources instead of evaluating all 32 possible sources across
  hundreds of thousands of hexes.
- Expanded Echo hitch diagnostics with update/render frame timing, rendered
  ripple-source limits, and raw/capped/emitted Echo burst particle counts.
- Pooled Echo column and collection-flash point lights so collecting or spawning
  Echoes moves existing lights instead of changing Three.js light counts and
  forcing large render-side shader recompiles.
- Moved Echo poof-disc particles up to the crystal core height and upgraded the
  collection burst into a taller diamond flash with arcing mote trails, so the
  run-through effect reads as one polished elevated burst instead of a surface
  poof plus an older prototype flash.
- Softened the player pressure depression so nearby hexes still dip under the
  avatar without burying it as deeply in the field.
- Halved the player pressure depth again for a lighter footprint around the
  avatar while preserving the visible field dent.
- Replaced the movement wake's reused burst emitter with a cheaper, flatter
  particle trail centered on the avatar core instead of hovering above it.
- Split manual click/Space pulse particles into a faster, flatter burst that
  diffuses outward instead of lingering as a vertical sparkle cylinder.
- Converted the cyan key and magenta rim lighting into visible spotlight
  fixtures so the source models actually cast the arena light and shadows.
- Reworked those visible spotlight fixtures into animated plasma balls with
  shader filaments, rim-glow halo shells, and attached real spotlights so they
  read as actual light sources instead of strange floating geometry.
- Replaced the visible light-source plasma spheres with layered camera-facing
  billboard fog plus a small local point glow, making the fixtures read more
  like glowy plasma emitters than opaque 3D props.
- Added a small live performance overlay with frame/update/render timing,
  active versus resident particle counts, rendered wave-source pressure,
  renderer draw stats, pixel ratio, quality state, an `F2` shortcut, and a
  pause-menu toggle.
- Replaced movement wake source stamping with a dedicated ping-pong GPU wake
  field, so avatar movement leaves continuous world-fixed height/velocity memory
  without increasing the analytic pulse source count.
- Added wake diagnostics and overlay readouts for wake texture mode, size, pass
  cost, and fallback state.
- Rebalanced GPU wake injection toward raised shoulder/bow crests with a softer
  center trough, so movement trails read as visible wave fronts instead of dark
  pressure grooves.
- Set avatar walk/sprint top speeds to `10 m/s` and `37 m/s`, with a 30%
  lower brake response so released movement takes longer to coast down while
  keeping menu-open braking responsive.
- Hid the pause-menu walk/sprint speed sliders after settling on defaults while
  keeping the controls wired for future tuning.

## 0.2.0-ALPHA - 2026-06-18

### Changed

- Replaced the square voxel field with regular hexagonal prism cells on a
  staggered lattice, keeping the size slider as the hex's widest point-to-point
  diameter so `25cm` still means the smallest visible cell diameter.
- Renamed visible field readouts from cubes/voxels to hexes/hex diameter and
  updated diagnostics to report `hexCount`, `hexDiameterMeters`, and `tileSpacing`.

## 0.1.5-ALPHA - 2026-06-17

### Changed

- Reworked Echo crystal sparkles from a sparse full-height line spray into
  avatar-style segmented orbit trails clustered around the bright core, so the
  crystal reads as intentionally energized instead of hairy.

## 0.1.4-ALPHA - 2026-06-17

### Changed

- Replaced the player's flat torus rings with fast orbiting energy motes and
  long additive trails, keeping the avatar readable without UI-like circles.
- Removed torus rings from Echo collection bursts and strengthened Echo orbit
  mote speed/trail length so motion trails carry the circular energy effect.
- Simplified the arena-edge wall into a smooth glowing color gradient, removing
  the scan-line/wisp texture that created visible bands and seams.

## 0.1.3-ALPHA - 2026-06-17

### Changed

- Brightened wave crests with a dedicated shader crest-glow signal, letting
  raised ripple fronts bloom and tint toward cyan-white without lifting the
  brightness of the entire voxel field.

## 0.1.2-ALPHA - 2026-06-17

### Changed

- Changed the voxel field from floating tiles into same-width capped columns,
  keeping lit animated caps on top while cheaper Lambert-lit shafts inherit the
  cap color and fade darker as they sink into the stage.

## 0.1.1-ALPHA - 2026-06-17

### Added

- Added a glowing volumetric arena-edge barrier that follows the live arena
  radius slider and gives the circular map boundary a visible in-world edge.

### Changed

- Changed voxel tinting to respond to animated cube height, with raised cubes
  shifting toward white and lower cubes staying darker and colder.

## 0.1.0-ALPHA - 2026-06-17

### Added

- Declared the first alpha baseline as `v0.1.0-ALPHA`, including package
  metadata and release documentation.
- Created the standalone Ripple Field Lab Vite/TypeScript/Three.js project.
- Added shader-displaced instanced cube field with player proximity waves and
  expanding pulse sources.
- Added additive spark particles, wake bursts, pulse point lights, bloom
  postprocessing, a glow avatar, and live tuning controls.
- Added dedicated startup scripts, README, and codebase index.
- Added a tiny local Ripple debug-log receiver on `127.0.0.1:5184` with JSONL
  writes under `logs/`, plus readable `/tail`, `/events`, and `/health` views.
- Added local Echo detonation debug logging with a retained
  `window.__rippleDebugDump()` buffer, particle burst timings, visual burst
  timings, and short post-collection frame timing samples.
- Added broader `frame.hitch` logging so freezes outside Echo detonation
  windows still record raw clock gaps, capped simulation delta, quality,
  particle pressure, and active ripple-source counts.
- Added live Voxel Size and Arena Radius controls, with `1m`/`200m` preserving
  the old scale, `25cm` to `2m` voxel sizing, and a `200m` to `400m` arena range.
- Added `field.rebuild` debug events so risky scale changes report rebuild time,
  cube count, effective spacing, voxel size, and arena radius.
- Added TODO and spitball-ideas docs to separate concrete near-term work from
  loose visual, interaction, and engine experiments.
- Added persistent collectible Echo zones that spawn around the arena, stay
  alive until the player runs through them, then detonate into a wider ripple
  and flat disc-shaped sparkle burst.

### Changed

- Removed the circular live Echo halo rings and stretched the orb glow/mist
  into a taller faceted diamond silhouette around the core.
- Packed live particles into a contiguous draw/update range so Three.js stops
  pushing the entire particle budget through the renderer when fewer motes are
  alive during Echo detonation fallout.
- Scaled voxel spacing, footprint, height, floor radius, player boundary, Echo
  spawn area, and directional shadow bounds from the active scale controls.
- Changed Ripple debug console output to include inline JSON payloads so Chrome
  automation sees timing numbers instead of collapsed `Object` arguments.
- Replaced the old global wave-speed slider with a medium-depth control that
  derives base propagation speed from `sqrt(g * depth)`, and added per-source
  speed, width, damping, and direction metadata for manual, Echo-triggered, and
  wake ripples, with a HUD readout for source count and newest ring radius.
- Replaced the Echo floor-circle marker with a hovering sparkle column so the
  collectible reads as part of the luminous field instead of a UI target, and no
  longer clips through displaced cubes.
- Reworked Echo columns again to use real stacked point lights plus orbiting
  pulse-style sparkles with subtle additive trails instead of a fake glowing
  column surface.
- Brightened the Echo core into a readable inner orb and strengthened its point
  light so collected zones cast warmer light onto nearby cubes.
- Added a soft volumetric-style mist shell around Echo orbs so their light reads
  like a glowing cloud instead of only a solid lantern.
- Added a short Echo collection burst with a core flash, expanding rings,
  mist shock, light pop, and shard motes so collected zones detonate instead of
  simply disappearing.
- Renamed the medium-depth control to `Depth / Speed` and added a live derived
  `m/s` readout beside the slider so its effect is visible while tuning.
- Increased sparkle alpha and shader color energy so particle clouds read
  brighter without increasing mote size or count.
- Cranked sparkle brightness again with a much higher alpha range and hotter
  shader core while still leaving particle size and density unchanged.
- Reworked the player avatar into a stronger local light source with a bright
  core light and lower cyan fill light that illuminate nearby cubes.
- Raised the avatar's hover height and changed the player-proximity shader
  response from a lifting hill into a depressed fabric trough with a small rim.
- Added follow-camera zoom with mouse wheel and keyboard controls, plus a lower
  minimum camera pitch for flatter field-level views.
- Fixed movement wake sources so lingering wake ripples stay stamped into the
  field instead of rotating behind the player like a live velocity cone.
- Smoothed propagating movement wakes by giving dense wake stamps shorter
  per-source lifetimes and uploading shader sources newest-first, so old rings
  do not flicker in and out of the fixed WebGL uniform budget.
- Replaced the 8-ripple gameplay cap with lifetime-based ripple retention and a
  short manual pulse cooldown, so older rings age out naturally instead of
  disappearing as soon as new pulses are spammed.
- Added subtle movement wake ripples that propagate after the avatar slows down
  instead of leaving all movement deformation pinned to player proximity.
- Reworked movement response toward a water-like body wake, with a directional
  bow/shoulder deformation in the shader and denser alternating trailing wake
  sources behind the avatar.
- Smoothed movement/camera feel by switching pitch to a real orbit arc, tightening
  acceleration/braking, and ignoring movement hotkeys while tuning inputs are focused.
- Corrected inverted keyboard strafing and inverted vertical mouse look.
- Reworked the player avatar from an overexposed white core into a dimmer glassy
  cyan marker with layered rings and restrained local light.
- Reduced default bloom, particle brightness, pulse-light intensity, and
  shader-emissive gain so player-local ripples stay luminous without washing out
  the field.
- Capped the live Bloom and Particles sliders so maxed Pretty settings remain
  readable instead of blooming into a white screen.
- Changed burst particles from soft additive discs into small star-like
  sparkles, then decoupled sparkle count from pulse brightness so pulses can be
  dense without becoming a volumetric glow blob.
- Retuned those sparkles again into lower-opacity particle clouds, trading the
  fat star/snowflake silhouette for many smaller glitter motes.
- Added a persistent player-local sparkle aura so the avatar reads as a cloud
  of dense particles instead of relying on a soft glowing shell.
- Slightly increased sparkle mote size and count after visual tuning, keeping
  the cloud particulate instead of returning to a glowing blob.
- Multiplied particle budgets, burst counts, aura emission, and wake emission
  by 10 for an intentionally heavier visual stress test.
- Multiplied the same particle counts by 10 again, while moving particle
  lifecycle state into typed arrays so the 100x pass avoids per-particle object
  overhead.
- Capped the particle stress target back to the x10 Meltdown scale after the
  x100 experiment proved too brute-force for the intended look.
- Changed cube placement from a square grid patch into a circular arena fill,
  and clamped the player avatar inside that same circular boundary.
