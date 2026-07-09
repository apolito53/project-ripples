# Ripple Field Lab

A standalone GPU-heavy Three.js/Vite prototype for a field of luminous hex cells
that ripple, glow, and throw particles when the player moves through them.

This is intentionally separate from `voxel-sandbox-engine`. The goal is to make
a polished visual lab first, then borrow patterns or ideas later if they deserve
to graduate into the main voxel engine.

Current version: `v0.5.3-2-ALPHA`.

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

Open `http://127.0.0.1:5183`. The app starts on a main menu where you choose
`Training Run`, `Track`, or `Arena`. For development smoke tests,
`?mode=training`, `?mode=track`, and `?mode=arena` skip the menu and enter that
mode directly.

## Controls

- `W` / `S` move forward and backward.
- `A` / `D` turn left and right by default.
- `Q` / `E` strafe left and right.
- Hold left mouse button to orbit the camera without changing avatar facing.
- Hold right mouse button to orbit the camera and steer avatar facing together;
  while held, `A` / `D` strafe instead of turning.
- Hold both mouse buttons to move forward in the camera-facing direction.
- Mouse look supports a full 180-degree vertical orbit range from straight below
  the avatar to straight overhead.
- Releasing one mouse button downgrades to the remaining drag mode; releasing
  the last held scene mouse button restores the cursor.
- `Mouse wheel` zooms the follow camera in and out.
- `+` / `-` zoom in and out; `0` resets the camera distance.
- `Space` jumps high, with small takeoff and stronger landing ripples. Airborne
  movement preserves takeoff momentum instead of letting input redirect the
  trajectory mid-jump.
- `Shift` boosts from base pace with momentum.
- `F2` shows or hides the live performance overlay and top-left debug readout.
- `Esc` opens/closes the pause menu after a mode has started.
- The pause menu's version pill opens the in-app changelog.
- `Exit To Main Menu` returns to the mode-select splash and starts the next mode
  from a clean runtime state.
- The on-screen pulse button drops manual pulses on touch layouts.

## Startup Modes

The lab has three startup modes: `Training Run`, `Track`, and `Arena`.

`Training Run` is a short guided course warmup that teaches left-drag camera
orbit, right-drag steering, keyboard movement, boosting, both-button
camera-forward movement, momentum/braking, jumping, Echo collection, and track
wall sliding with a compact HUD and one scripted Echo.

Training uses the same course walls, track-only hex culling, and hidden circular
Arena shell as Track mode, but disables random Echo spawning so the lesson is
deterministic.

`Track` is the first racing prototype. The avatar drives on a wide ribbon inside
the arena, bright glowing translucent energy walls clamp the avatar back onto
the course, wall-contact preserves tangent speed while shaving outward momentum,
and Echoes spawn on the course.

Track mode also clips generated hexes to the course ribbon plus a safety skirt,
so off-track cells are skipped instead of animated every frame. It hides the
circular arena floor and outer arena barrier so the course reads as the active
play space instead of a path painted over the sandbox.

`Arena` is the full circular sandbox. The avatar uses the circular arena edge as
its boundary, Echoes spawn across the disc, and the entire circular hex field is
generated.

## Field And Visuals

The arena edge is rendered as a smooth glowing gradient barrier so the playable
boundary is visible in-world without looking like a tiled wall texture.

The hex field is drawn as a single shader-animated cap surface. The render path
keeps the field focused on lit hex caps for the upcoming spherical arena pass.

Meltdown uses a calibrated honeycomb footprint for visually interlocked tiny
hexes, while lighter quality modes keep more breathing room.

Raised wave crests carry an extra bounded glow signal, so ripple fronts bloom
brighter without washing out the whole field. Manual touch pulses have a short
shared cooldown so the on-screen pulse button does not flood the field.

The avatar is a strong-facing hover pod with a bright nose, side glow
fins, rear thrusters, and rear-biased energy motes, so player facing is readable
before movement starts.

Sparkling Echo columns spawn on the race track as real local light sources with
a bright inner orb, a vertically stretched diamond-shaped glow cloud, faster
core-local orbiting motes, and segmented fading trails.

Echo columns wait until the avatar runs through them, then detonate into a wider
pulse, a flat disc burst of sparks, and a short local orb-shatter effect without
geometric ring markers.

## Movement Model

Movement uses acceleration, braking, and carried momentum.

Base pace defaults to `10 m/s` and boost defaults to `37 m/s`, with grounded
acceleration, counter-steering, and release braking tuned for a more slide-y
feel. The pause menu's `Surface Grip` slider scales that grounded response from
slicker low-grip handling to tighter high-grip handling without changing base or
boost top speed.

The avatar behaves like a small body pushing through water: the shader forms a
pressed fabric depression, local bow/wake displacement, and small raised rim
around the avatar, while a dedicated GPU wake texture stores the lingering
height/velocity field left behind by movement.

The visible movement particle trail is a tight velocity-following tail.

Jumping fades that surface contact while the avatar is airborne, then landing
stamps a brighter impact ripple back into the field. Touch-button pulses and
collected Echoes use analytic ring sources; ordinary movement uses the GPU wake
texture for continuous surface response.

## Runtime Tuning

The Esc/hamburger pause menu changes quality, skybox theme, hex size, arena
radius, surface grip, ripple height/radius, Depth / Speed, particle density,
bloom strength, and the diagnostics readouts while the scene is running.

Hex size treats the current cell scale as `1m`, ranges from `25cm` to `2m`, and
measures the regular hexagon's widest point-to-point diameter. Changing it
rebuilds the instanced field after a short debounce so slider drags do not spam
geometry work.

Arena radius is expressed in lab meters: `200m` preserves the original scene
radius, while `400m` doubles it. Depth / Speed changes the medium's effective
depth, then shows the derived propagation speed from the shallow-water-inspired
`sqrt(g * depth)` model.

Arena mode clamps extreme hex-size/arena-radius combinations before rebuilding
the full circular field, using per-quality instance budgets so a casual slider
drag cannot spawn millions of visible hexes.

Track mode skips that full-disc coupling because it rebuilds only the course
ribbon plus safety skirt; switching back to Arena reapplies the guardrail before
the full disc is rebuilt. To intentionally run stress-test behavior, open the
app with `?stress=1` or set `localStorage.rippleStressMode = "1"`.

## HUD, Perf Overlay, And Skyboxes

The HUD keeps the title and active quality/mode badge visible during play. The
derived speed, hex diameter, arena radius, active pulse count, newest pulse
radius, and Echo count are hidden by default, then return with `F2` or the pause
menu Diagnostics toggle when propagation and scale tuning need a quick visual
sanity check.

The performance overlay is also hidden by default. When diagnostics are enabled,
it adds a
denser tuning cockpit with frame/update/render timing, active particles versus
resident budget, rendered pulse-source pressure, GPU wake texture mode/pass
cost, draw calls, triangles, pixel ratio, bloom state, quality mode, play mode,
and clipped-versus-full hex counts.

Skybox themes use the generated Cyberpunk Skyline, Aurora Observatory, Orbital
Megastructure, and Neon Arena Skyline panoramas on a camera-following dome.

Modern GPUs get 8K sky textures; lower texture-cap hardware falls back to 4K,
and the aurora/orbital themes have custom vertical framing so their horizons sit
closer to the arena instead of sinking below the play surface.

## Quality Modes

- `Clean`: lower hex density, no bloom, small particle budget.
- `Pretty`: default polished mode with bloom, shadows, pulse lights, and sparks.
- `Showoff`: denser field, more particles, stronger bloom and shadows.
- `Meltdown`: visually interlocked honeycomb hex density and intentionally
  excessive effects for GPU stress.

## Development

```powershell
npm.cmd install
npm.cmd run debug:logs
npm.cmd run diagnostics
npm.cmd run typecheck
npm.cmd run build
npm.cmd run validate
```

Local runs emit debug logs for Echo detonations, including particle burst counts
and frame timings around collection. Broader frame warnings cover stalls outside
the Echo watch window and use
`frame.renderHitch`, `frame.updateHitch`, `frame.mixedHitch`, and
`frame.clockGap` channels so true render pressure is not blended with
sleep/reload/browser clock gaps. Console lines include inline JSON so Chrome
automation can read numeric payloads directly. In DevTools, call
`window.__rippleDebugDump()` to inspect the retained in-page log.

For file-backed local logging, run `npm.cmd run debug:logs` in a second terminal.
The browser batches debug events to
`http://127.0.0.1:5184/__ripple_debug_log`; the receiver appends JSONL under
`logs/` and exposes `http://127.0.0.1:5184/tail?limit=80` for quick inspection.
Use `http://127.0.0.1:5184/summary?format=text` for an immediate diagnostics
summary, or add filters such as `?source=latest&channel=frame.renderHitch`.
`npm.cmd run diagnostics` prints the same kind of summary for the newest JSONL
file, while `npm.cmd run verify:perf` applies broad alpha-era thresholds for
obvious runaway frame/rebuild costs.
Set `localStorage.rippleDebug = "0"` or open `?debug=0` to silence browser
debug logging. Set `localStorage.rippleLogServer = "0"` or open `?logServer=0`
to keep console logging on while disabling the local receiver writes.

Dedicated ports:

- Dev server: `5183`
- Debug log receiver: `5184`
- Preview server: `4183`

Project planning:

- `TODO.md` tracks concrete high-priority and medium-priority follow-up work.
- `SPITBALL_IDEAS.md` keeps loose visual, interaction, and engine ideas separate
  from the committed roadmap.

Versioning:

- While the project is still experimental, release tags use alpha prerelease
  labels. The current baseline is `v0.5.3-2-ALPHA`.

## Design Notes

- `src/main.ts` owns the app-level state split between the startup menu,
  gameplay, and pause, including clean mode starts, `?mode=` shortcuts,
  mode-specific player/Echo/runtime resets, course-mode scale guardrail bypass,
  Training Run lifecycle, and Echo reseeding after play-area rebuilds.
- `src/trainingRun.ts` owns the guided Training Run director: step definitions,
  current objective checks, marker placement, scripted Echo requests, completion
  pulse trigger, tutorial HUD state, and `training.*` diagnostics.
- `src/raceTrack.ts` owns the first racing-game layer: the hardcoded
  non-crossing sweeping loop, wide-ribbon collision, bright glowing course
  walls, generated surface mask, field-placement clip queries, and sparse
  `track.*` diagnostics.
- `src/rippleField.ts` owns the circular shader-displaced instanced hex field,
  including the local bow deformation around the moving avatar, sampled GPU
  wake texture displacement, optional track-mode placement clipping, the
  generated race-track mask highlight, and shader-side hex footprint/height
  scaling. It renders the lit cap surface, calibrates Meltdown into an
  interlocked honeycomb, and tints cells by animated height so raised caps push
  toward white while troughs stay darker. Wave crests have their own glow varying
  so peak brightness can be tuned separately from generic player-proximity glow.
- `src/arenaBarrier.ts` owns the Arena-only visual glowing arena-edge gradient
  that follows the live arena radius without changing collision behavior.
- `src/skybox.ts` owns the selectable camera-following sky dome, high-res versus
  fallback texture selection, per-theme vertical framing, and fog tuning. The
  current generated skybox assets live in `public/skyboxes/`.
- `src/wakeField.ts` owns the ping-pong GPU wake heightfield for movement,
  including capability fallback, quality-sized render targets, and sampled
  `wake.*` diagnostics.
- `src/rippleSources.ts` keeps the lifetime-pruned manual/Echo pulse list sent
  to the GPU, including per-source speed, width, damping, and lifetime.
- `src/debugLog.ts` owns the local diagnostic log buffer, inline JSON console
  logging, and optional batching to the `5184` debug receiver used to profile
  Echo detonations and frame spikes.
- `src/echoZones.ts` owns persistent collectible Echo-column lights, bright orb
  lights, vertical diamond-style orb mist, avatar-style segmented crystal orbit
  trails, and their run-through trigger/despawn burst detection.
- `src/waveMedium.ts` defines the medium settings and derived propagation speed.
- `src/labSettings.ts` maps UI meters onto the original scene-unit art scale,
  including surface grip defaults, hex point-to-point diameter scaling, and the
  200m-to-400m arena radius range.
- `src/particleVeil.ts` owns the player sparkle aura, additive glitter-cloud
  bursts, layered Echo poof-disc bursts, bright shader energy, and tight
  velocity-following wake tails.
- `src/pulseLights.ts` maps recent pulses onto a small pool of point lights.
- `src/controls.ts` owns avatar movement, the optional play-area constraint hook
  used by the track, circular arena fallback clamping, scene-input gating while
  menus are open, split left/right hold-to-look pointer-lock behavior,
  camera-only orbit yaw, right-drag steering yaw, WoW-style keyboard
  turning/strafe semantics, surface-grip handling response, ballistic airborne
  horizontal momentum, both-button camera-forward movement, full 180-degree
  vertical camera orbit, quiet mouse-release unlocks, and read-only tutorial
  telemetry. The avatar visuals in `src/main.ts` use orbiting motes and
  segmented additive trails.

The CPU decides where the player, touch-button pulses, optional race-track
constraint, and persistent Echo zones are. Manual pulse input is cooldown-gated,
Echo zones only become pulse sources after collection, and pulse sources age out
by per-source lifetime. Movement wake is fed into a small GPU height/velocity
texture. The GPU handles wake propagation, hex lift, stretch, tint, emissive
glow, track-surface highlight, and cell footprint/height from the wake texture
plus the newest rendered pulse uniforms, with dense fields allowed to render
fewer pulse sources than the full gameplay source list contains.
