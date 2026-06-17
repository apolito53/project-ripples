import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ArenaBarrier } from "./arenaBarrier";
import { PlayerRig } from "./controls";
import { debugEvent, debugMeasure, roundMetric, vectorPayload } from "./debugLog";
import { EchoZoneField, type TriggeredEchoZone } from "./echoZones";
import { cloneDefaultSettings, getQualityPreset } from "./labSettings";
import { ParticleVeil } from "./particleVeil";
import { PulseLightRig } from "./pulseLights";
import {
  ARENA_RADIUS_MAX_METERS,
  ARENA_RADIUS_MIN_METERS,
  VOXEL_SIZE_MAX_METERS,
  VOXEL_SIZE_MIN_METERS,
  isQualityId,
  type QualityPreset
} from "./qualityPresets";
import { FIELD_COLUMN_BASE_Y, RippleField } from "./rippleField";
import { RippleSourceStore, type RippleSourceOptions } from "./rippleSources";
import "./styles.css";
import { sampleFieldHeight } from "./terrain";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";

const app = requireElement<HTMLElement>("#app");
const statsLine = requireElement<HTMLElement>("#stats-line");
const mediumLine = requireElement<HTMLElement>("#medium-line");
const qualityBadge = requireElement<HTMLElement>("#quality-badge");
const qualitySelect = requireElement<HTMLSelectElement>("#quality-select");
const voxelSizeSlider = requireElement<HTMLInputElement>("#voxel-size-slider");
const voxelSizeValue = requireElement<HTMLOutputElement>("#voxel-size-value");
const arenaRadiusSlider = requireElement<HTMLInputElement>("#arena-radius-slider");
const arenaRadiusValue = requireElement<HTMLOutputElement>("#arena-radius-value");
const heightSlider = requireElement<HTMLInputElement>("#height-slider");
const radiusSlider = requireElement<HTMLInputElement>("#radius-slider");
const depthSlider = requireElement<HTMLInputElement>("#depth-slider");
const depthSpeedValue = requireElement<HTMLOutputElement>("#depth-speed-value");
const particleSlider = requireElement<HTMLInputElement>("#particle-slider");
const bloomSlider = requireElement<HTMLInputElement>("#bloom-slider");
const menuToggle = requireElement<HTMLButtonElement>("#menu-toggle");
const mobileControls = requireElement<HTMLDivElement>("#mobile-controls");
const pulseButton = requireElement<HTMLButtonElement>("#pulse-button");
const PLAYER_BOUNDARY_PADDING = 1.1;
const ECHO_ZONE_MAX_ACTIVE = 5;
const ECHO_ZONE_INITIAL_COUNT = 3;
const ECHO_ZONE_SPAWN_ATTEMPTS = 24;
const ECHO_ZONE_SPAWN_INTERVAL_SECONDS = 4.2;
const ECHO_ZONE_RADIUS = 3.05;
const ECHO_ZONE_TRIGGER_RADIUS = 2.45;
const ECHO_ZONE_MIN_PLAYER_DISTANCE = 11;
const ECHO_ZONE_MIN_ZONE_DISTANCE = 12;
const ECHO_ZONE_BURST_STRENGTH = 0.76;
const ECHO_ZONE_DISC_BURST_RADIUS = 8.6;
const ECHO_DETONATION_FRAME_LOG_SECONDS = 2;
const ECHO_DEBUG_FRAME_SAMPLE_SECONDS = 0.22;
const ECHO_DEBUG_SLOW_FRAME_MS = 24;
const GLOBAL_FRAME_HITCH_MS = 45;
const GLOBAL_FRAME_HITCH_LOG_INTERVAL_SECONDS = 0.75;
const GLOBAL_FRAME_HITCH_WARMUP_SECONDS = 1;
const FIELD_REBUILD_DEBOUNCE_MS = 180;
const MOVEMENT_RIPPLE_MIN_SPEED = 2.2;
const MOVEMENT_RIPPLE_MIN_DISTANCE = 0.9;
const MOVEMENT_RIPPLE_INTERVAL_SECONDS = 0.22;
const MOVEMENT_RIPPLE_MIN_STRENGTH = 0.05;
const MOVEMENT_RIPPLE_MAX_STRENGTH = 0.12;
// Movement wakes are emitted frequently, so they fade sooner than manual
// pulses. That keeps normal motion below the fixed shader upload budget and
// prevents old rings from swapping in and out as newer wake stamps appear.
const MOVEMENT_RIPPLE_LIFETIME_SECONDS = 2.8;
const MOVEMENT_RIPPLE_STERN_OFFSET = 0.9;
const MOVEMENT_RIPPLE_SHOULDER_OFFSET = 1.15;
const MOVEMENT_RIPPLE_SHOULDER_BACKSET = 1.95;
const MANUAL_PULSE_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 1,
  widthMultiplier: 1,
  dampingMultiplier: 0.92
};
const ECHO_BURST_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 1.08,
  widthMultiplier: 2.2,
  dampingMultiplier: 0.58,
  lifetimeSeconds: 8.6
};
const AVATAR_ORBIT_MOTE_COUNT = 36;
const AVATAR_ORBIT_TRAIL_SEGMENTS = 6;
const AVATAR_ORBIT_TRAIL_SECONDS = 0.54;

type AvatarOrbitTrails = {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly trails: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly positions: Float32Array;
  readonly alphas: Float32Array;
  readonly sizes: Float32Array;
  readonly trailPositions: Float32Array;
  readonly trailColors: Float32Array;
  readonly baseColors: Float32Array;
  readonly baseAngles: Float32Array;
  readonly radii: Float32Array;
  readonly heights: Float32Array;
  readonly speeds: Float32Array;
  readonly phases: Float32Array;
  readonly tilts: Float32Array;
};

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.setClearColor(0x020409, 1);
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020409);
const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
const clock = new THREE.Clock();
const settings = cloneDefaultSettings();
let preset = getQualityPreset(settings);
let frameCount = 0;
let fpsAccumulatorSeconds = 0;
let measuredFps = 60;
let nextEchoZoneAt = 0.8;
let lastMovementRippleAt = -Infinity;
let movementWakeSide = 1;
let echoDebugFrameWatchUntil = -Infinity;
let echoDebugLastFrameLogAt = -Infinity;
let lastGlobalFrameHitchLogAt = -Infinity;
let fieldRebuildTimeoutId = 0;
const lastMovementRipplePosition = new THREE.Vector3(Infinity, 0, Infinity);
const movementDirection = new THREE.Vector3();
const movementShoulder = new THREE.Vector3();
const movementPerpendicular = new THREE.Vector3();
const mobileQuery = window.matchMedia("(pointer: coarse), (hover: none)");
const activeTouchSticks = new Map<number, TouchStickState>();
let menuVisible = true;

type TouchStickKind = "move" | "look";

type TouchStickState = {
  readonly element: HTMLElement;
  readonly knob: HTMLElement;
  readonly kind: TouchStickKind;
  readonly originX: number;
  readonly originY: number;
  lastX: number;
  lastY: number;
};

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.bloomStrength, 0.3, 0.95);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const rippleSources = new RippleSourceStore();
const echoZones = new EchoZoneField(scene);
const rippleField = new RippleField(scene, preset);
let particles = new ParticleVeil(scene, preset.particleBudget, getPixelRatio());
let pulseLights = new PulseLightRig(scene, preset.pulseLightCount);

const avatar = createAvatar();
scene.add(avatar.object);

const player = new PlayerRig({
  canvas: renderer.domElement,
  camera,
  sampleHeight: sampleFieldHeight,
  getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
  onPulse: (position) => spawnPulse(position, 0.45)
});

createLighting();
const stageFloor = createStageFloor();
const arenaBarrier = new ArenaBarrier(scene);
syncControlValues();
wireControls();
updateTuningReadouts();
applyQualityPreset(preset, true);
resize();
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.visualViewport?.addEventListener("scroll", resize);

// Seed a few pulses so the first rendered second already has motion and bloom.
spawnPulse(new THREE.Vector3(0, sampleFieldHeight(0, 0) + 0.45, 0), 0.28);
spawnPulse(new THREE.Vector3(9, sampleFieldHeight(9, -7) + 0.45, -7), 0.18);
seedEchoZones(clock.elapsedTime);

renderer.setAnimationLoop(animate);

function animate(): void {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 24);
  const time = clock.elapsedTime;
  const frameStartedAt = performance.now();
  player.update(delta);
  const playerSpeed = player.getSpeed();
  avatar.update(delta, player.position, playerSpeed);
  particles.spawnAura(player.position, delta, playerSpeed / 18);
  particles.spawnWake(player.position, playerSpeed / 18);
  maybeSpawnMovementRipple(time, playerSpeed);
  arenaBarrier.update(time);
  echoZones.update(time);
  collectEchoZones(time);
  maybeSpawnEchoZone(time);
  particles.update(delta);
  rippleField.update(time, settings, preset, rippleSources, player.position, player.velocity, playerSpeed);
  pulseLights.update(
    rippleSources.getActiveLightSources(time),
    time,
    0.28 + settings.bloomStrength * 0.42,
    getBasePropagationSpeedMetersPerSecond(settings.waveMedium)
  );
  updateStats(delta, time);

  bloomPass.strength = settings.bloomStrength;
  if (settings.bloomStrength > 0.02) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  logGlobalFrameHitch(time, delta, rawDelta, frameStartedAt);
  logEchoDetonationFrame(time, delta, frameStartedAt);
}

function spawnPulse(
  position: THREE.Vector3,
  strength: number,
  options = MANUAL_PULSE_OPTIONS,
  startTime = clock.elapsedTime
): void {
  rippleSources.add(position, startTime, strength, options);

  // Particle density is intentionally decoupled from pulse brightness. A pulse
  // should read as a little cloud of tiny glitter motes, not as one bright blob.
  spawnPulseParticles(position, strength);
}

function spawnPulseParticles(position: THREE.Vector3, strength: number): void {
  const count = Math.max(0, Math.floor(
    preset.burstParticleCount * settings.particleDensity * (0.42 + strength * 1.7)
  ));
  particles.spawnBurst(position, count, strength);
}

function maybeSpawnMovementRipple(time: number, playerSpeed: number): void {
  if (playerSpeed < MOVEMENT_RIPPLE_MIN_SPEED) return;
  if (time - lastMovementRippleAt < MOVEMENT_RIPPLE_INTERVAL_SECONDS) return;

  const distanceFromLastWake = Math.hypot(
    player.position.x - lastMovementRipplePosition.x,
    player.position.z - lastMovementRipplePosition.z
  );
  if (distanceFromLastWake < MOVEMENT_RIPPLE_MIN_DISTANCE) return;

  const movementRatio = THREE.MathUtils.clamp(playerSpeed / 18, 0, 1);
  const strength = THREE.MathUtils.lerp(
    MOVEMENT_RIPPLE_MIN_STRENGTH,
    MOVEMENT_RIPPLE_MAX_STRENGTH,
    movementRatio
  );

  movementDirection.copy(player.velocity).setY(0).normalize();
  movementPerpendicular.set(-movementDirection.z, 0, movementDirection.x);

  // A moving body in water leaves more than one perfect circle. We drop a stern
  // source directly behind the avatar, plus an alternating shoulder source that
  // builds a soft V wake without doubling both sides every frame.
  const stern = player.position.clone().addScaledVector(
    movementDirection,
    -MOVEMENT_RIPPLE_STERN_OFFSET
  );
  addMovementWakeSource(stern, time, strength);

  movementShoulder.copy(player.position)
    .addScaledVector(movementDirection, -MOVEMENT_RIPPLE_SHOULDER_BACKSET)
    .addScaledVector(movementPerpendicular, MOVEMENT_RIPPLE_SHOULDER_OFFSET * movementWakeSide);
  addMovementWakeSource(movementShoulder, time, strength * 0.72);
  movementWakeSide *= -1;

  lastMovementRippleAt = time;
  lastMovementRipplePosition.copy(player.position);
}

function addMovementWakeSource(position: THREE.Vector3, time: number, strength: number): void {
  position.y = sampleFieldHeight(position.x, position.z) + 0.4;

  // Movement wakes feed the terrain shader only. No burst particles, no point
  // lights: just lingering displacement, like water remembering the body that
  // passed through it. These sources intentionally do not carry direction now:
  // once a wake is stamped into the field, it should stay put instead of aiming
  // around like a flashlight beam as the player changes direction.
  rippleSources.add(position, time, strength, {
    kind: "wake",
    speedMultiplier: settings.waveMedium.wakeSpeedMultiplier,
    widthMultiplier: 1.45,
    dampingMultiplier: 0.72,
    lifetimeSeconds: MOVEMENT_RIPPLE_LIFETIME_SECONDS
  });
}

function seedEchoZones(time: number): void {
  const startingAngles = [Math.PI * 0.23, Math.PI * 0.92, -Math.PI * 0.46];
  const startingRadii = [15, 27, 38];

  for (let index = 0; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
    const angle = startingAngles[index] ?? Math.random() * Math.PI * 2;
    const radius = startingRadii[index] ?? ECHO_ZONE_MIN_PLAYER_DISTANCE + index * ECHO_ZONE_MIN_ZONE_DISTANCE;
    if (!spawnEchoZoneAtPolar(time, angle, radius)) {
      spawnEchoZone(time);
    }
  }
  nextEchoZoneAt = time + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
}

function maybeSpawnEchoZone(time: number): void {
  if (time < nextEchoZoneAt) return;
  if (echoZones.getActiveCount() >= ECHO_ZONE_MAX_ACTIVE) {
    nextEchoZoneAt = time + 1;
    return;
  }

  const spawned = spawnEchoZone(time);
  nextEchoZoneAt = time + (spawned ? ECHO_ZONE_SPAWN_INTERVAL_SECONDS : 1.2);
}

function spawnEchoZone(time: number): boolean {
  const position = createEchoZonePosition();
  if (!position) return false;
  addEchoZoneAtPosition(position, time);
  return true;
}

function spawnEchoZoneAtPolar(time: number, angle: number, radius: number): boolean {
  const maxRadius = Math.max(
    ECHO_ZONE_MIN_PLAYER_DISTANCE + 1,
    preset.fieldRadius - PLAYER_BOUNDARY_PADDING - ECHO_ZONE_RADIUS
  );
  const clampedRadius = THREE.MathUtils.clamp(radius, ECHO_ZONE_MIN_PLAYER_DISTANCE, maxRadius);
  const position = new THREE.Vector3(
    Math.cos(angle) * clampedRadius,
    0,
    Math.sin(angle) * clampedRadius
  );
  if (!echoZones.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) return false;

  position.y = sampleFieldHeight(position.x, position.z) + 0.16;
  addEchoZoneAtPosition(position, time);
  return true;
}

function addEchoZoneAtPosition(position: THREE.Vector3, time: number): void {
  echoZones.add(position, time, {
    radius: ECHO_ZONE_RADIUS,
    triggerRadius: ECHO_ZONE_TRIGGER_RADIUS,
    burstStrength: ECHO_ZONE_BURST_STRENGTH,
    discBurstRadius: ECHO_ZONE_DISC_BURST_RADIUS
  });
}

function createEchoZonePosition(): THREE.Vector3 | null {
  const maxRadius = Math.max(
    ECHO_ZONE_MIN_PLAYER_DISTANCE + 1,
    preset.fieldRadius - PLAYER_BOUNDARY_PADDING - ECHO_ZONE_RADIUS
  );

  for (let attempt = 0; attempt < ECHO_ZONE_SPAWN_ATTEMPTS; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = ECHO_ZONE_MIN_PLAYER_DISTANCE + Math.random() * (maxRadius - ECHO_ZONE_MIN_PLAYER_DISTANCE);
    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    );
    const playerDistance = Math.hypot(position.x - player.position.x, position.z - player.position.z);
    if (playerDistance < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
    if (!echoZones.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;

    position.y = sampleFieldHeight(position.x, position.z) + 0.16;
    return position;
  }

  return null;
}

function collectEchoZones(time: number): void {
  const triggeredZones = echoZones.collectAt(player.position, time);
  if (triggeredZones.length > 0) {
    echoDebugFrameWatchUntil = Math.max(echoDebugFrameWatchUntil, time + ECHO_DETONATION_FRAME_LOG_SECONDS);
    debugEvent("echo.collect", "Collected Echo zones this frame", {
      time: roundMetric(time),
      triggeredCount: triggeredZones.length,
      playerPosition: vectorPayload(player.position),
      activeEchoesAfterCollect: echoZones.getActiveCount(),
      activeVisualBursts: echoZones.getCollectBurstCount(),
      particleActiveBeforeGameBurst: particles.getActiveCount(),
      quality: preset.id,
      particleBudget: preset.particleBudget,
      particleDensity: roundMetric(settings.particleDensity)
    });
  }

  for (const echo of triggeredZones) {
    triggerEchoZone(echo, time);
  }
}

function triggerEchoZone(echo: TriggeredEchoZone, time: number): void {
  const detonationStartedAt = performance.now();
  const position = echo.position.clone();
  position.y = sampleFieldHeight(position.x, position.z) + 0.45;

  // Echoes are map pickups, but once collected they become ordinary pulse
  // sources so the shader, lights, and HUD can reuse the existing wave path.
  debugMeasure(
    "echo.collect",
    "Added Echo ripple source",
    () => rippleSources.add(position, time, echo.burstStrength, ECHO_BURST_OPTIONS),
    {
      time: roundMetric(time),
      strength: echo.burstStrength,
      position: vectorPayload(position)
    },
    2
  );

  const particleCount = Math.max(0, Math.floor(
    preset.burstParticleCount * settings.particleDensity * (0.58 + echo.burstStrength * 0.45)
  ));
  const activeBeforeParticles = particles.getActiveCount();
  debugMeasure(
    "echo.collect",
    "Spawned Echo disc burst particles",
    () => particles.spawnDiscBurst(position, particleCount, echo.burstStrength, echo.discBurstRadius),
    {
      requestedParticleCount: particleCount,
      activeParticlesBefore: activeBeforeParticles,
      particleBudget: preset.particleBudget,
      quality: preset.id,
      particleDensity: roundMetric(settings.particleDensity),
      discBurstRadius: echo.discBurstRadius
    },
    10
  );
  debugEvent("echo.collect", "Finished Echo detonation gameplay burst", {
    totalMs: roundMetric(performance.now() - detonationStartedAt),
    activeParticlesAfter: particles.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeRippleSources: rippleSources.getActiveSources(time).length
  });
}

function wireControls(): void {
  menuToggle.addEventListener("click", () => {
    setMenuVisible(!menuVisible);
  });

  mobileQuery.addEventListener("change", updateMobileControlsVisibility);
  updateMobileControlsVisibility();
  wireMobileControls();

  pulseButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    player.triggerPulse();
  });

  qualitySelect.addEventListener("change", () => {
    if (!isQualityId(qualitySelect.value)) return;
    cancelScheduledFieldRebuild();
    settings.qualityId = qualitySelect.value;
    preset = getQualityPreset(settings);
    settings.bloomStrength = preset.bloomStrength;
    bloomSlider.value = String(settings.bloomStrength);
    applyQualityPreset(preset, false);
  });

  voxelSizeSlider.addEventListener("input", () => {
    settings.voxelSizeMeters = Number(voxelSizeSlider.value);
    preset = getQualityPreset(settings);
    updateVoxelSizeValue();
    scheduleFieldRebuild();
  });
  arenaRadiusSlider.addEventListener("input", () => {
    settings.arenaRadiusMeters = Number(arenaRadiusSlider.value);
    preset = getQualityPreset(settings);
    updateArenaRadiusValue();
    scheduleFieldRebuild();
  });
  heightSlider.addEventListener("input", () => {
    settings.rippleHeight = Number(heightSlider.value);
  });
  radiusSlider.addEventListener("input", () => {
    settings.rippleRadius = Number(radiusSlider.value);
  });
  depthSlider.addEventListener("input", () => {
    settings.waveMedium.effectiveDepth = Number(depthSlider.value);
    updateDepthSpeedValue();
  });
  particleSlider.addEventListener("input", () => {
    settings.particleDensity = Number(particleSlider.value);
  });
  bloomSlider.addEventListener("input", () => {
    settings.bloomStrength = THREE.MathUtils.clamp(Number(bloomSlider.value), 0, 0.38);
  });
}

function syncControlValues(): void {
  qualitySelect.value = settings.qualityId;
  voxelSizeSlider.min = String(VOXEL_SIZE_MIN_METERS);
  voxelSizeSlider.max = String(VOXEL_SIZE_MAX_METERS);
  voxelSizeSlider.step = "0.05";
  voxelSizeSlider.value = String(settings.voxelSizeMeters);
  arenaRadiusSlider.min = String(ARENA_RADIUS_MIN_METERS);
  arenaRadiusSlider.max = String(ARENA_RADIUS_MAX_METERS);
  arenaRadiusSlider.step = "5";
  arenaRadiusSlider.value = String(settings.arenaRadiusMeters);
  heightSlider.value = String(settings.rippleHeight);
  radiusSlider.value = String(settings.rippleRadius);
  depthSlider.value = String(settings.waveMedium.effectiveDepth);
  particleSlider.value = String(settings.particleDensity);
  bloomSlider.value = String(settings.bloomStrength);
}

function setMenuVisible(visible: boolean): void {
  menuVisible = visible;
  document.body.classList.toggle("menu-hidden", !visible);
  menuToggle.setAttribute("aria-expanded", String(visible));
  menuToggle.setAttribute("aria-label", visible ? "Hide menu" : "Show menu");
}

function updateMobileControlsVisibility(): void {
  mobileControls.hidden = !mobileQuery.matches;
}

function wireMobileControls(): void {
  for (const stick of mobileControls.querySelectorAll<HTMLElement>(".touch-stick")) {
    const knob = requireChild<HTMLElement>(stick, ".touch-stick__knob");
    const kind = stick.dataset.stick === "look" ? "look" : "move";
    stick.addEventListener("pointerdown", (event) => beginTouchStick(event, stick, knob, kind));
    stick.addEventListener("pointermove", updateTouchStick);
    stick.addEventListener("pointerup", endTouchStick);
    stick.addEventListener("pointercancel", endTouchStick);
  }
}

function beginTouchStick(event: PointerEvent, element: HTMLElement, knob: HTMLElement, kind: TouchStickKind): void {
  event.preventDefault();
  element.setPointerCapture(event.pointerId);
  const rect = element.getBoundingClientRect();
  const state: TouchStickState = {
    element,
    knob,
    kind,
    originX: rect.left + rect.width / 2,
    originY: rect.top + rect.height / 2,
    lastX: event.clientX,
    lastY: event.clientY
  };
  activeTouchSticks.set(event.pointerId, state);
  applyTouchStick(state, event.clientX, event.clientY);
}

function updateTouchStick(event: PointerEvent): void {
  const state = activeTouchSticks.get(event.pointerId);
  if (!state) return;
  event.preventDefault();
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  applyTouchStick(state, event.clientX, event.clientY);
}

function endTouchStick(event: PointerEvent): void {
  const state = activeTouchSticks.get(event.pointerId);
  if (!state) return;
  activeTouchSticks.delete(event.pointerId);
  state.knob.style.transform = "translate3d(-50%, -50%, 0)";
  if (state.kind === "move") player.setMobileMoveIntent(0, 0);
  if (state.kind === "look") player.setMobileLookIntent(0, 0);
}

function applyTouchStick(state: TouchStickState, clientX: number, clientY: number): void {
  const maxDistance = state.element.clientWidth * 0.32;
  const rawX = clientX - state.originX;
  const rawY = clientY - state.originY;
  const distance = Math.min(maxDistance, Math.hypot(rawX, rawY));
  const angle = Math.atan2(rawY, rawX);
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  state.knob.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0)`;
  if (state.kind === "move") player.setMobileMoveIntent(x / maxDistance, -y / maxDistance);
  if (state.kind === "look") player.setMobileLookIntent(x / maxDistance, y / maxDistance);
}

function requireChild<T extends HTMLElement>(parent: HTMLElement, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required child: ${selector}`);
  return element;
}

function updateDepthSpeedValue(): void {
  // The slider controls effective depth, but the user-facing consequence is
  // propagation speed. Show the derived value right where the tuning happens.
  depthSpeedValue.textContent = `${getBasePropagationSpeedMetersPerSecond(settings.waveMedium).toFixed(1)} m/s`;
}

function updateTuningReadouts(): void {
  updateDepthSpeedValue();
  updateVoxelSizeValue();
  updateArenaRadiusValue();
}

function updateVoxelSizeValue(): void {
  // Below one meter, centimeters are easier to scan than decimals. At or above
  // one meter, keep the decimal form so the baseline still reads as exactly 1m.
  voxelSizeValue.textContent = settings.voxelSizeMeters < 1
    ? `${Math.round(settings.voxelSizeMeters * 100)} cm`
    : `${settings.voxelSizeMeters.toFixed(2)} m`;
}

function updateArenaRadiusValue(): void {
  arenaRadiusValue.textContent = `${Math.round(settings.arenaRadiusMeters)} m`;
}

function scheduleFieldRebuild(): void {
  cancelScheduledFieldRebuild();

  // Rebuilding the InstancedMesh can be expensive at small voxel sizes and
  // large arenas. Debouncing keeps slider drags playable while still making the
  // final setting feel responsive once the user pauses for a breath.
  fieldRebuildTimeoutId = window.setTimeout(() => {
    fieldRebuildTimeoutId = 0;
    rebuildFieldGeometry(preset);
  }, FIELD_REBUILD_DEBOUNCE_MS);
}

function cancelScheduledFieldRebuild(): void {
  if (fieldRebuildTimeoutId === 0) return;
  window.clearTimeout(fieldRebuildTimeoutId);
  fieldRebuildTimeoutId = 0;
}

function rebuildFieldGeometry(nextPreset: QualityPreset): void {
  const rebuildStartedAt = performance.now();
  rippleField.rebuild(nextPreset);
  updateStageFloor(nextPreset);
  updateShadowResolution(nextPreset.shadowMapSize, nextPreset.fieldRadius);
  resize();

  const durationMs = performance.now() - rebuildStartedAt;
  debugEvent("field.rebuild", "Rebuilt voxel field geometry", {
    durationMs: roundMetric(durationMs),
    quality: nextPreset.id,
    cubeCount: rippleField.getInstanceCount(),
    voxelSizeMeters: roundMetric(settings.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
    sceneRadius: roundMetric(nextPreset.fieldRadius),
    cubeSpacing: roundMetric(nextPreset.cubeSpacing)
  }, durationMs > GLOBAL_FRAME_HITCH_MS ? "warn" : "info");
}

function applyQualityPreset(nextPreset: QualityPreset, initial: boolean): void {
  qualityBadge.textContent = nextPreset.label;
  renderer.shadowMap.enabled = nextPreset.shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.FogExp2(0x020815, nextPreset.fogDensity);
  bloomPass.strength = settings.bloomStrength;

  if (!initial) {
    rebuildFieldGeometry(nextPreset);
    particles = particles.resizeBudget(scene, nextPreset.particleBudget, getPixelRatio());
    pulseLights = pulseLights.resize(scene, nextPreset.pulseLightCount);
  }

  updateStageFloor(nextPreset);
  updateShadowResolution(nextPreset.shadowMapSize, nextPreset.fieldRadius);
  resize();
}

function updateShadowResolution(size: number, fieldRadius: number): void {
  const shadowBounds = fieldRadius + 8;
  for (const child of scene.children) {
    if (!(child instanceof THREE.DirectionalLight)) continue;
    child.castShadow = size > 0;
    child.shadow.mapSize.set(Math.max(1, size), Math.max(1, size));
    child.shadow.camera.near = 1;
    child.shadow.camera.far = Math.max(180, fieldRadius * 2.4);
    child.shadow.camera.left = -shadowBounds;
    child.shadow.camera.right = shadowBounds;
    child.shadow.camera.top = shadowBounds;
    child.shadow.camera.bottom = -shadowBounds;
    child.shadow.needsUpdate = true;
  }
}

function createLighting(): void {
  const ambient = new THREE.HemisphereLight(0x87ccff, 0x06111a, 0.82);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xbcecff, 2.2);
  key.name = "Soft cyan key light";
  key.position.set(-24, 38, 18);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xff7de7, 1.1);
  rim.name = "Magenta rim light";
  rim.position.set(30, 18, -24);
  scene.add(rim);
}

function createStageFloor(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(1, 192);
  const material = new THREE.MeshStandardMaterial({
    color: 0x06101b,
    metalness: 0.38,
    roughness: 0.48,
    emissive: 0x02070d,
    emissiveIntensity: 0.65
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.name = "Dark reflective stage floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FIELD_COLUMN_BASE_Y;
  floor.receiveShadow = true;
  scene.add(floor);
  return floor;
}

function updateStageFloor(nextPreset: QualityPreset): void {
  // The floor is a unit circle scaled to the active arena. Reusing one mesh is
  // much cheaper than throwing away geometry every time the arena slider moves.
  const floorRadius = nextPreset.fieldRadius + nextPreset.cubeSpacing * 0.5;
  stageFloor.scale.set(floorRadius, floorRadius, 1);
  arenaBarrier.setRadius(floorRadius);
}

function createAvatar(): {
  readonly object: THREE.Group;
  update(delta: number, position: THREE.Vector3, movementSpeed: number): void;
} {
  const object = new THREE.Group();
  object.name = "Player glow avatar";

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 2),
    new THREE.MeshStandardMaterial({
      color: 0x39ffd7,
      emissive: 0x0c8f88,
      emissiveIntensity: 1.05,
      metalness: 0.18,
      roughness: 0.28
    })
  );
  core.castShadow = true;
  object.add(core);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.54, 1),
    new THREE.MeshPhysicalMaterial({
      color: 0x7dffd8,
      emissive: 0x0b4c57,
      emissiveIntensity: 0.38,
      metalness: 0.06,
      roughness: 0.16,
      transparent: true,
      opacity: 0.26,
      depthWrite: false
    })
  );
  shell.name = "Player readable glass shell";
  object.add(shell);

  const orbitTrails = createAvatarOrbitTrails();
  object.add(orbitTrails.trails, orbitTrails.points);

  const coreLight = new THREE.PointLight(0x8fffe0, 4.4, 19, 1.65);
  coreLight.name = "Player bright local cube light";
  coreLight.position.y = 0.35;
  object.add(coreLight);

  const floorLight = new THREE.PointLight(0x55cfff, 2.1, 14, 1.45);
  floorLight.name = "Player low cyan block fill";
  floorLight.position.y = -1.05;
  object.add(floorLight);

  return {
    object,
    update(delta, position, movementSpeed) {
      object.position.copy(position);
      core.rotation.x += delta * 1.3;
      core.rotation.y += delta * 1.9;
      shell.rotation.x -= delta * 0.55;
      shell.rotation.y += delta * 0.7;
      const breathingGlow = Math.sin(clock.elapsedTime * 4) * 0.5 + 0.5;
      const movementGlow = THREE.MathUtils.clamp(movementSpeed / 18, 0, 1);
      updateAvatarOrbitTrails(orbitTrails, clock.elapsedTime, movementGlow);

      // The player should now behave like an actual local light source for the
      // cube field. Keep shadows off for this moving light pair; point-light
      // shadows would be expensive with tens of thousands of instanced cubes.
      coreLight.intensity = 3.8 + breathingGlow * 0.9 + movementGlow * 1.4;
      coreLight.distance = 17 + movementGlow * 5;
      floorLight.intensity = 1.65 + breathingGlow * 0.42 + movementGlow * 0.9;
      floorLight.distance = 12 + movementGlow * 4;
    }
  };
}

function createAvatarOrbitTrails(): AvatarOrbitTrails {
  const positions = new Float32Array(AVATAR_ORBIT_MOTE_COUNT * 3);
  const colors = new Float32Array(AVATAR_ORBIT_MOTE_COUNT * 3);
  const alphas = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const sizes = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const twinkles = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const trailVertexCount = AVATAR_ORBIT_MOTE_COUNT * AVATAR_ORBIT_TRAIL_SEGMENTS * 2;
  const trailPositions = new Float32Array(trailVertexCount * 3);
  const trailColors = new Float32Array(trailVertexCount * 3);
  const baseColors = new Float32Array(AVATAR_ORBIT_MOTE_COUNT * 3);
  const baseAngles = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const radii = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const heights = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const speeds = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const phases = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);
  const tilts = new Float32Array(AVATAR_ORBIT_MOTE_COUNT);

  for (let index = 0; index < AVATAR_ORBIT_MOTE_COUNT; index += 1) {
    const offset = index * 3;
    const hueMix = index / Math.max(1, AVATAR_ORBIT_MOTE_COUNT - 1);
    const color = new THREE.Color(0x7dffd8).lerp(new THREE.Color(0x8ea2ff), Math.sin(hueMix * Math.PI) * 0.55);

    // These motes replace the old torus rings. They orbit fast enough to imply
    // a circular path, while the trail geometry provides the visible arc.
    baseAngles[index] = index * 2.399963 + Math.random() * 0.65;
    radii[index] = 0.48 + Math.random() * 0.42;
    heights[index] = -0.12 + Math.random() * 0.82;
    speeds[index] = (index % 2 === 0 ? 1 : -1) * (3.2 + Math.random() * 2.7);
    phases[index] = Math.random() * Math.PI * 2;
    tilts[index] = -0.95 + Math.random() * 1.9;
    alphas[index] = 0.42 + Math.random() * 0.34;
    sizes[index] = 0.58 + Math.random() * 0.54;
    twinkles[index] = Math.random();

    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    baseColors[offset] = color.r;
    baseColors[offset + 1] = color.g;
    baseColors[offset + 2] = color.b;
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", createAvatarDynamicAttribute(positions, 3));
  pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  pointGeometry.setAttribute("aAlpha", createAvatarDynamicAttribute(alphas, 1));
  pointGeometry.setAttribute("aSize", createAvatarDynamicAttribute(sizes, 1));
  pointGeometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", createAvatarDynamicAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", createAvatarDynamicAttribute(trailColors, 3));

  const points = new THREE.Points(pointGeometry, createAvatarMoteMaterial());
  points.name = "Player orbiting energy motes";
  points.frustumCulled = false;
  points.renderOrder = 6;

  const trails = new THREE.LineSegments(
    trailGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.26,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  trails.name = "Player long energy mote trails";
  trails.frustumCulled = false;
  trails.renderOrder = 5;

  return {
    points,
    trails,
    positions,
    alphas,
    sizes,
    trailPositions,
    trailColors,
    baseColors,
    baseAngles,
    radii,
    heights,
    speeds,
    phases,
    tilts
  };
}

function updateAvatarOrbitTrails(orbitTrails: AvatarOrbitTrails, time: number, movementGlow: number): void {
  orbitTrails.points.material.uniforms.uTime.value = time;
  orbitTrails.trails.material.opacity = 0.22 + movementGlow * 0.11;
  const trailStepSeconds = AVATAR_ORBIT_TRAIL_SECONDS / AVATAR_ORBIT_TRAIL_SEGMENTS;

  for (let index = 0; index < AVATAR_ORBIT_MOTE_COUNT; index += 1) {
    const pointOffset = index * 3;
    writeAvatarOrbitPosition(orbitTrails.positions, pointOffset, orbitTrails, index, time);
    orbitTrails.alphas[index] = 0.38 + movementGlow * 0.16 + Math.sin(time * 8.2 + orbitTrails.phases[index]) * 0.08;
    orbitTrails.sizes[index] = 0.58 + movementGlow * 0.22 + Math.sin(time * 5.4 + orbitTrails.phases[index]) * 0.06;

    for (let segment = 0; segment < AVATAR_ORBIT_TRAIL_SEGMENTS; segment += 1) {
      const segmentOffset = (index * AVATAR_ORBIT_TRAIL_SEGMENTS + segment) * 6;
      const olderTime = time - (segment + 1) * trailStepSeconds;
      const newerTime = time - segment * trailStepSeconds;
      writeAvatarOrbitPosition(orbitTrails.trailPositions, segmentOffset, orbitTrails, index, olderTime);
      writeAvatarOrbitPosition(orbitTrails.trailPositions, segmentOffset + 3, orbitTrails, index, newerTime);
      writeAvatarTrailColor(orbitTrails, index, segmentOffset, segment, false);
      writeAvatarTrailColor(orbitTrails, index, segmentOffset + 3, segment, true);
    }
  }

  orbitTrails.points.geometry.attributes.position.needsUpdate = true;
  orbitTrails.points.geometry.attributes.aAlpha.needsUpdate = true;
  orbitTrails.points.geometry.attributes.aSize.needsUpdate = true;
  orbitTrails.trails.geometry.attributes.position.needsUpdate = true;
  orbitTrails.trails.geometry.attributes.color.needsUpdate = true;
}

function writeAvatarOrbitPosition(
  target: Float32Array,
  offset: number,
  orbitTrails: AvatarOrbitTrails,
  index: number,
  time: number
): void {
  const angle = orbitTrails.baseAngles[index] + time * orbitTrails.speeds[index] +
    Math.sin(time * 1.8 + orbitTrails.phases[index]) * 0.22;
  const radius = orbitTrails.radii[index] * (1 + Math.sin(time * 2.1 + orbitTrails.phases[index]) * 0.08);
  const flatX = Math.cos(angle) * radius;
  const flatZ = Math.sin(angle) * radius * 0.74;
  const localY = orbitTrails.heights[index] +
    Math.sin(angle * 1.7 + orbitTrails.phases[index]) * 0.2 +
    Math.sin(time * 3.1 + orbitTrails.phases[index]) * 0.08;
  const tilt = orbitTrails.tilts[index];
  const tiltedY = localY * Math.cos(tilt) - flatZ * Math.sin(tilt);
  const tiltedZ = localY * Math.sin(tilt) + flatZ * Math.cos(tilt);

  target[offset] = flatX;
  target[offset + 1] = tiltedY;
  target[offset + 2] = tiltedZ;
}

function writeAvatarTrailColor(
  orbitTrails: AvatarOrbitTrails,
  index: number,
  offset: number,
  segment: number,
  isNewerVertex: boolean
): void {
  const colorOffset = index * 3;
  const age01 = (segment + (isNewerVertex ? 0 : 1)) / (AVATAR_ORBIT_TRAIL_SEGMENTS + 1);
  const intensity = Math.pow(1 - age01, 1.45);

  orbitTrails.trailColors[offset] = orbitTrails.baseColors[colorOffset] * intensity;
  orbitTrails.trailColors[offset + 1] = orbitTrails.baseColors[colorOffset + 1] * intensity;
  orbitTrails.trailColors[offset + 2] = orbitTrails.baseColors[colorOffset + 2] * intensity;
}

function createAvatarMoteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2.5) },
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uTime;
      attribute float aAlpha;
      attribute float aSize;
      attribute float aTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        vColor = color;
        vAlpha = aAlpha;
        vTwinkle = 0.62 + 0.38 * sin(uTime * 11.0 + aTwinkle * 6.2831853);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (118.0 / max(8.0, -mvPosition.z));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        float pinCore = smoothstep(0.08, 0.0, dist);
        float mote = smoothstep(0.3, 0.04, dist);
        float alpha = (pinCore * 0.9 + mote * 0.1) * vAlpha * vTwinkle;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vColor * (1.9 + pinCore * 3.8 + vTwinkle * 0.8), alpha);
      }
    `
  });
}

function createAvatarDynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}

function updateStats(delta: number, time: number): void {
  frameCount += 1;
  fpsAccumulatorSeconds += delta;
  if (fpsAccumulatorSeconds < 0.35) return;

  const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
  const activeSources = rippleSources.getActiveSources(time);
  const newestSource = activeSources[0];
  const rawNewestStartTime = newestSource?.startTime;
  const rawNewestSpeedMultiplier = newestSource?.speedMultiplier;
  const newestStartTime = typeof rawNewestStartTime === "number" && Number.isFinite(rawNewestStartTime)
    ? rawNewestStartTime
    : time;
  const newestSpeedMultiplier =
    typeof rawNewestSpeedMultiplier === "number" && Number.isFinite(rawNewestSpeedMultiplier)
      ? rawNewestSpeedMultiplier
      : 1;
  const newestRingRadius = newestSource
    ? Math.max(0, time - newestStartTime) * basePropagationSpeed * newestSpeedMultiplier
    : 0;

  measuredFps = frameCount / fpsAccumulatorSeconds;
  frameCount = 0;
  fpsAccumulatorSeconds = 0;
  statsLine.textContent = `${Math.round(measuredFps)} fps | ${rippleField.getInstanceCount().toLocaleString()} cubes | ${preset.particleBudget.toLocaleString()} particles`;
  mediumLine.textContent = `${basePropagationSpeed.toFixed(1)} m/s | ${settings.waveMedium.effectiveDepth.toFixed(1)}m depth | ${formatVoxelSize(settings.voxelSizeMeters)} voxels | ${settings.arenaRadiusMeters.toFixed(0)}m arena | ${echoZones.getActiveCount()} echoes | ${activeSources.length} waves | newest ${newestRingRadius.toFixed(1)}m`;
}

function logEchoDetonationFrame(time: number, delta: number, frameStartedAt: number): void {
  if (time > echoDebugFrameWatchUntil) return;

  const frameMs = performance.now() - frameStartedAt;
  const shouldSample = time - echoDebugLastFrameLogAt >= ECHO_DEBUG_FRAME_SAMPLE_SECONDS;
  const isSlow = frameMs >= ECHO_DEBUG_SLOW_FRAME_MS;
  if (!shouldSample && !isSlow) return;

  echoDebugLastFrameLogAt = time;
  debugEvent("echo.frame", "Frame timing during Echo detonation window", {
    time: roundMetric(time),
    frameMs: roundMetric(frameMs),
    clockDeltaMs: roundMetric(delta * 1000),
    activeEchoes: echoZones.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeParticles: particles.getActiveCount(),
    activeRippleSources: rippleSources.getActiveSources(time).length,
    quality: preset.id,
    voxelSizeMeters: roundMetric(settings.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
    bloomStrength: roundMetric(settings.bloomStrength)
  }, isSlow ? "warn" : "debug");
}

function logGlobalFrameHitch(time: number, delta: number, rawDelta: number, frameStartedAt: number): void {
  if (time < GLOBAL_FRAME_HITCH_WARMUP_SECONDS) return;
  if (document.visibilityState !== "visible") return;

  const frameMs = performance.now() - frameStartedAt;
  const rawClockDeltaMs = rawDelta * 1000;
  const isSlowFrame = frameMs >= GLOBAL_FRAME_HITCH_MS || rawClockDeltaMs >= GLOBAL_FRAME_HITCH_MS;
  if (!isSlowFrame) return;

  // Echo detonation logging only watches a short post-collection window. This
  // broader breadcrumb catches stalls from render pressure, shader compilation,
  // or any other visible-tab hitch that lands outside that narrow window.
  if (time - lastGlobalFrameHitchLogAt < GLOBAL_FRAME_HITCH_LOG_INTERVAL_SECONDS) return;

  lastGlobalFrameHitchLogAt = time;
  const activeSources = rippleSources.getActiveSources(time);
  debugEvent("frame.hitch", "Global frame hitch", {
    time: roundMetric(time),
    frameMs: roundMetric(frameMs),
    rawClockDeltaMs: roundMetric(rawClockDeltaMs),
    cappedClockDeltaMs: roundMetric(delta * 1000),
    echoWatchActive: time <= echoDebugFrameWatchUntil,
    activeEchoes: echoZones.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeParticles: particles.getActiveCount(),
    particleBudget: preset.particleBudget,
    activeRippleSources: activeSources.length,
    quality: preset.id,
    voxelSizeMeters: roundMetric(settings.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
    bloomStrength: roundMetric(settings.bloomStrength),
    particleDensity: roundMetric(settings.particleDensity),
    rendererPixelRatio: roundMetric(getPixelRatio()),
    visibilityState: document.visibilityState
  }, "warn");
}

function formatVoxelSize(sizeMeters: number): string {
  return sizeMeters < 1
    ? `${Math.round(sizeMeters * 100)}cm`
    : `${sizeMeters.toFixed(2)}m`;
}

function resize(): void {
  const { width, height } = getViewportSize();
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  const pixelRatio = getPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
  particles.setPixelRatio(pixelRatio);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function getViewportSize(): { width: number; height: number } {
  const visualViewport = window.visualViewport;
  return {
    width: Math.round(visualViewport?.width ?? window.innerWidth),
    height: Math.round(visualViewport?.height ?? window.innerHeight)
  };
}

function getPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, settings.qualityId === "meltdown" ? 2.5 : 2);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
