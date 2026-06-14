# Changelog

## Unreleased

### Added

- Added TODO and spitball-ideas docs to separate concrete near-term work from
  loose visual, interaction, and engine experiments.

### Changed

- Replaced the 8-ripple gameplay cap with lifetime-based ripple retention and a
  short manual pulse cooldown, so older rings age out naturally instead of
  disappearing as soon as new pulses are spammed.
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

## 0.1.0 - 2026-06-14

### Added

- Created the standalone Ripple Field Lab Vite/TypeScript/Three.js project.
- Added shader-displaced instanced cube field with player proximity waves and
  expanding pulse sources.
- Added additive spark particles, wake bursts, pulse point lights, bloom
  postprocessing, a glow avatar, and live tuning controls.
- Added dedicated startup scripts, README, and codebase index.
