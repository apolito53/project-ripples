# Renderer Presentation Parity

This registry separates renderer **state parity** from renderer **presentation
style**. The WebGPU port shares current gameplay and mode behavior with WebGL,
but independent rendering does not imply identical art direction.

## Presentation Profiles

- `core`: the preserved WebGPU-native minimalist presentation. Preserve its cap-
  focused field, graphic lighting, dense orb Echoes, hover-pod treatment, and
  bounded custom bloom as a supported style.
- `classic`: the default forced-WebGPU parity candidate. Its field uses true
  procedural hex prisms with top caps, six visible side faces, animated tile
  height, a closed underside, and WebGL-inspired pressure/material response.
- `webgl-reference`: the current Three/WebGL scene used as the audit reference;
  it is a report label, not a WebGPU profile.

Closer-to-WebGL shader or pass work stays behind `classic`. Changing `core`
merely to reduce a diff is not parity closure. Both profiles are selectable by
the pause-menu **Field Style** control or `?presentation=classic|core`.

## Current Finding

Functional and fixed-tick semantic parity is established for the audited Arena,
Track, and Training fixtures for both profiles. Strict Classic presentation
parity is **review-required**. The deterministic audit matched player/camera/mode/field state, pulse
sources, Echo identity, Track mask/walls, and Training marker state at every
fixture while showing substantial, expected visual differences between
`webgl-reference` and each selected WebGPU profile.

Run the current audit with:

```powershell
npm.cmd run audit:render:parity
npm.cmd run audit:render:parity:core
```

The first command audits Classic; the second preserves Core evidence. They write
ignored evidence under `parity-results/<profile>-<timestamp>/`: raw captures,
WebGL/WebGPU/amplified-diff strips, `report.json`, and `summary.md`. Each page
uses the benchmark seed plus a capture-only fixed-step controller. Arena and
Track freeze at tick 180; Training freezes at tick 60. Arena and Track then
follow one pulse at 36, 225, 390, and 480 ticks (0.6s, 3.75s, 6.5s, and 8.0s),
including a source-presence/expiry check. Frozen same-backend captures must repeat within 0.1% changed
pixels and 0.5 mean RGB. By default the command builds current sources and owns
strict preview port `4184`; use `RIPPLE_PARITY_APP_URL` only for an intentional
external-server audit.

Cross-backend image metrics are evidence, not a pixel-equality gate. Browser
errors, diagnostic errors, blank/unsafe images, state mismatch, fallback, and
device loss are fatal.

Particle counts remain an observation rather than a semantic gate. Both paths
are repeatable, but renderer-specific initialization currently advances the
global random stream before shared particle spawning. A named renderer-neutral
particle RNG stream is required before particle placement can join the exact
cross-backend snapshot.

## System Matrix

| System | Current classification | Core policy | Classic audit target |
| --- | --- | --- | --- |
| Gameplay, camera, mode, field placement, Track mask, Training state | Shared/exact | Keep shared neutral ownership | No change unless a fixed-tick state mismatch appears |
| Ripple field geometry/material | Classic 3D geometry restored; material remains review-required | Preserve cap-focused graphic treatment | Tune prism thickness, side-face material response, and field horizon without flattening geometry |
| Immediate player trough/rim/body wake | Classic transfer aligned | Keep the cleaner Core response | Review residual raster/material differences without retuning shared coefficients |
| Persistent wake solver | Shared coefficients aligned | Keep Core's stylized display response | Continue Track boost/coast/stop soak coverage without adding backend-only settling |
| Avatar | Intentional Core difference | Preserve WebGPU hover-pod/mote treatment and saved mote asset | Compare dimensional silhouette, fins, thrusters, trails, and fixtures |
| Active Echoes and collection | WebGPU-native equivalent | Preserve dense tiny-sun orbs as the Core read | Compare Three shells/columns, event mist, and field-response duplication |
| Particles | Shared state, suspect presentation | Keep soft-quad path | Audit WebGL depth-test-off against WebGPU field-depth reads |
| Skybox/fog/color | Suspect | Preserve current framing if desired | Audit lower hemisphere, fog, sRGB/mips, and output transform across every skybox |
| Track walls and Training marker | WebGPU-native equivalents | Preserve current graphic passes | Compare side phase, beam geometry, center glow, and bloom response |
| Arena curtain | Suspect | Preserve only deliberate motion | Remove or profile-gate angular drift absent from the WebGL curtain |
| Stage floor and visible key/rim fixtures | Missing | Core may intentionally omit them | Decide whether Classic needs the reflective receiver and visible plasma fixtures |
| Local lights and shadows | Approximate/suspect | Preserve bounded light/shadow budgets | Match quality light-count semantics, Clean shadow disable, and receiver behavior |
| Pulse glow proxy | Intentional Core difference | Preserve as a Core effect with per-source lifetime | Disabled in Classic; real source-faded local lights carry the WebGL-like emphasis |
| Bloom/output transform | Intentional Core difference | Preserve bounded custom bloom and anti-wash limits | Compare ACES exposure, threshold, blur footprint, vignette, tint, and gamma |

## Audit Fixtures

Implemented:

- Pretty Arena settled plus early/middle/late/post-expiry manual-pulse states.
- Showoff Track motion settled plus early/middle/late/post-expiry manual-pulse states.
- Pretty Training at the first visible objective marker.

Still required before claiming strict presentation closure:

- Clean Arena with bloom off, jump/land, and a nearby Echo.
- Training advancement and completion/hide states.
- Meltdown tiers 0 and 4 from a grazing camera.
- All skyboxes through full yaw and below-horizon pitch.
- Track boost/coast/stop wake persistence.
