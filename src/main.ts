import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ArenaBarrier } from "./arenaBarrier";
import {
  PlayerRig,
  PLAYER_SPEED_LIMITS,
  SURFACE_GRIP_LIMITS,
  type PlayerJumpEvent,
  getMinimumSprintSpeedMetersPerSecond,
  normalizePlayerSpeedSettings
} from "./controls";
import { debugEvent, debugMeasure, roundMetric, vectorPayload, type RippleDebugPayload } from "./debugLog";
import { EchoZoneField, type TriggeredEchoZone } from "./echoZones";
import { applyFieldInstanceBudget, type FieldScaleChangedControl } from "./fieldScaleGuardrails";
import {
  createGlobalFrameHitchEvent,
  formatCompactCount,
  formatVoxelSize
} from "./frameTelemetry";
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
import { RippleField } from "./rippleField";
import { RippleSourceStore, type RippleSourceOptions } from "./rippleSources";
import { SKYBOX_OPTIONS, SkyboxManager, isSkyboxId } from "./skybox";
import "./styles.css";
import { sampleFieldHeight } from "./terrain";
import { WakeField } from "./wakeField";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";
import changelogMarkdown from "../CHANGELOG.md?raw";
import packageMetadata from "../package.json";

const app = requireElement<HTMLElement>("#app");
const statsLine = requireElement<HTMLElement>("#stats-line");
const mediumLine = requireElement<HTMLElement>("#medium-line");
const qualityBadge = requireElement<HTMLElement>("#quality-badge");
const qualitySelect = requireElement<HTMLSelectElement>("#quality-select");
const skyboxSelect = requireElement<HTMLSelectElement>("#skybox-select");
const voxelSizeSlider = requireElement<HTMLInputElement>("#voxel-size-slider");
const voxelSizeValue = requireElement<HTMLOutputElement>("#voxel-size-value");
const arenaRadiusSlider = requireElement<HTMLInputElement>("#arena-radius-slider");
const arenaRadiusValue = requireElement<HTMLOutputElement>("#arena-radius-value");
const walkSpeedSlider = requireElement<HTMLInputElement>("#walk-speed-slider");
const walkSpeedValue = requireElement<HTMLOutputElement>("#walk-speed-value");
const sprintSpeedSlider = requireElement<HTMLInputElement>("#sprint-speed-slider");
const sprintSpeedValue = requireElement<HTMLOutputElement>("#sprint-speed-value");
const surfaceGripSlider = requireElement<HTMLInputElement>("#surface-grip-slider");
const surfaceGripValue = requireElement<HTMLOutputElement>("#surface-grip-value");
const heightSlider = requireElement<HTMLInputElement>("#height-slider");
const radiusSlider = requireElement<HTMLInputElement>("#radius-slider");
const depthSlider = requireElement<HTMLInputElement>("#depth-slider");
const depthSpeedValue = requireElement<HTMLOutputElement>("#depth-speed-value");
const particleSlider = requireElement<HTMLInputElement>("#particle-slider");
const particleToggle = requireElement<HTMLButtonElement>("#particle-toggle");
const bloomSlider = requireElement<HTMLInputElement>("#bloom-slider");
const bloomToggle = requireElement<HTMLButtonElement>("#bloom-toggle");
const perfOverlayToggle = requireElement<HTMLButtonElement>("#perf-overlay-toggle");
const menuToggle = requireElement<HTMLButtonElement>("#menu-toggle");
const sceneMenuBackdrop = requireElement<HTMLDivElement>("#scene-menu-backdrop");
const sceneMenu = requireElement<HTMLElement>("#scene-menu");
const resumeButton = requireElement<HTMLButtonElement>("#resume-button");
const versionLink = requireElement<HTMLButtonElement>("#version-link");
const changelogBackdrop = requireElement<HTMLDivElement>("#changelog-backdrop");
const changelogDialog = requireElement<HTMLElement>("#changelog-dialog");
const changelogClose = requireElement<HTMLButtonElement>("#changelog-close");
const changelogContent = requireElement<HTMLPreElement>("#changelog-content");
const mobileControls = requireElement<HTMLDivElement>("#mobile-controls");
const pulseButton = requireElement<HTMLButtonElement>("#pulse-button");
const perfOverlay = requireElement<HTMLElement>("#perf-overlay");
const perfOverlayQuality = requireElement<HTMLElement>("#perf-overlay-quality");
const perfFrame = requireElement<HTMLElement>("#perf-frame");
const perfUpdate = requireElement<HTMLElement>("#perf-update");
const perfRender = requireElement<HTMLElement>("#perf-render");
const perfFps = requireElement<HTMLElement>("#perf-fps");
const perfHexes = requireElement<HTMLElement>("#perf-hexes");
const perfParticles = requireElement<HTMLElement>("#perf-particles");
const perfWaves = requireElement<HTMLElement>("#perf-waves");
const perfWake = requireElement<HTMLElement>("#perf-wake");
const perfRenderer = requireElement<HTMLElement>("#perf-renderer");
const APP_VERSION = `v${packageMetadata.version}`;
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
const ECHO_DISC_BURST_PARTICLE_CAP_RATIO = 0.16;
const ECHO_DISC_BURST_MIN_PARTICLE_CAP = 5000;
const ECHO_DETONATION_FRAME_LOG_SECONDS = 2;
const ECHO_DEBUG_FRAME_SAMPLE_SECONDS = 0.22;
const ECHO_DEBUG_SLOW_FRAME_MS = 24;
const GLOBAL_FRAME_HITCH_MS = 45;
const GLOBAL_FRAME_HITCH_LOG_INTERVAL_SECONDS = 0.75;
const GLOBAL_FRAME_HITCH_WARMUP_SECONDS = 1;
const FIELD_REBUILD_DEBOUNCE_MS = 180;
const MANUAL_PULSE_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 1,
  widthMultiplier: 1,
  dampingMultiplier: 0.92
};
const JUMP_TAKEOFF_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 0.92,
  widthMultiplier: 0.72,
  dampingMultiplier: 0.78,
  lifetimeSeconds: 4.2
};
const JUMP_LANDING_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 1.02,
  widthMultiplier: 1.25,
  dampingMultiplier: 0.68,
  lifetimeSeconds: 6.2
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
const AVATAR_FORWARD_AXIS = new THREE.Vector3(0, 0, 1);
// A low visual floor remains while the playable surface is still planar. The
// upcoming sphere pass can delete or replace this without touching RippleField.
const STAGE_FLOOR_Y = -3.2;
const KEY_LIGHT_SOURCE_COLOR = 0xbcecff;
const RIM_LIGHT_SOURCE_COLOR = 0xff7de7;

type AvatarStyle = "hoverPod" | "legacyGlowOrb";

type PlayerAvatar = {
  readonly object: THREE.Group;
  update(delta: number, position: THREE.Vector3, movementSpeed: number, facingYaw: number): void;
};

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

type SceneLightSource = {
  readonly object: THREE.Group;
  readonly light: THREE.SpotLight;
  readonly fillLight: THREE.PointLight;
  readonly target: THREE.Object3D;
  readonly plasmaVisual: THREE.Group;
  readonly billboardMaterials: readonly THREE.ShaderMaterial[];
  readonly horizontalDirection: THREE.Vector3;
  readonly heightScale: number;
  readonly intensity: number;
  readonly distanceScale: number;
  readonly phaseOffset: number;
};

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.setClearColor(0x020409, 1);
// Postprocessing uses multiple internal renders. Manual info resets let the
// perf overlay report the whole frame instead of only the final composer pass.
renderer.info.autoReset = false;
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020409);
const skybox = new SkyboxManager(scene, renderer);
const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
const clock = new THREE.Clock();
const settings = cloneDefaultSettings();
const fieldStressModeEnabled = isFieldStressModeEnabled();
let preset = getQualityPreset(settings);
let frameCount = 0;
let fpsAccumulatorSeconds = 0;
let measuredFps = 60;
let nextEchoZoneAt = 0.8;
let echoDebugFrameWatchUntil = -Infinity;
let echoDebugLastFrameLogAt = -Infinity;
let lastGlobalFrameHitchLogAt = -Infinity;
let lastFrameUpdateMs = 0;
let lastFrameRenderMs = 0;
let lastRawDeltaMs = 0;
let fieldRebuildTimeoutId = 0;
const previousWakePlayerPosition = new THREE.Vector3();
const sceneLightSources: SceneLightSource[] = [];
const mobileQuery = window.matchMedia("(pointer: coarse), (hover: none)");
const activeTouchSticks = new Map<number, TouchStickState>();
let menuVisible = false;
let changelogVisible = false;
let perfOverlayVisible = true;
let pointerLockWasActive = false;
// Mouse-button release is now normal camera behavior, while Esc/unexpected
// unlocks still mean "pause." This one-shot flag separates those two paths.
let suppressNextPointerUnlockMenu = false;

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
const wakeField = new WakeField(renderer, preset);
const rippleField = new RippleField(scene, preset, wakeField.supportsVertexTextureSampling());
let particles = new ParticleVeil(scene, preset.particleBudget, getPixelRatio());
let pulseLights = new PulseLightRig(scene, preset.pulseLightCount);

const avatar = createAvatar();
scene.add(avatar.object);

const player = new PlayerRig({
  canvas: renderer.domElement,
  camera,
  sampleHeight: sampleFieldHeight,
  getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
  onPulse: (position) => spawnPulse(position, 0.45),
  onQuietPointerUnlock: () => {
    suppressNextPointerUnlockMenu = true;
  },
  onJump: (event) => triggerJumpRipple(event),
  onLand: (event) => triggerLandingRipple(event),
  speedSettings: settings.playerSpeed,
  surfaceGrip: settings.surfaceGrip,
  isInputEnabled: areSceneInputsEnabled
});
previousWakePlayerPosition.copy(player.position);

createLighting();
const stageFloor = createStageFloor();
const arenaBarrier = new ArenaBarrier(scene);
skybox.setSkybox(settings.skyboxId);
syncControlValues();
wireControls();
updateTuningReadouts();
applyQualityPreset(preset, true);
resize();
prewarmRenderPipelines();
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
  lastRawDeltaMs = rawDelta * 1000;
  const frameStartedAt = performance.now();
  player.update(delta);
  const playerSpeed = player.getSpeed();
  const playerGroundContact = player.getGroundContactStrength();
  avatar.update(delta, player.position, playerSpeed, player.getFacingYaw());
  if (settings.particlesEnabled) {
    particles.spawnAura(player.position, delta, playerSpeed / 18);
    particles.spawnWake(player.position, (playerSpeed / 18) * playerGroundContact, player.velocity);
  }
  arenaBarrier.update(time);
  updateSceneLightSourceVisuals(time);
  echoZones.update(time);
  collectEchoZones(time);
  maybeSpawnEchoZone(time);
  if (settings.particlesEnabled) {
    particles.update(delta);
  }
  const effectiveBloomStrength = getEffectiveBloomStrength();
  pulseLights.update(
    rippleSources.getActiveLightSources(time),
    time,
    0.28 + effectiveBloomStrength * 0.42,
    getBasePropagationSpeedMetersPerSecond(settings.waveMedium)
  );
  bloomPass.strength = effectiveBloomStrength;
  const renderStartedAt = performance.now();
  lastFrameUpdateMs = renderStartedAt - frameStartedAt;
  renderer.info.reset();
  wakeField.render({
    time,
    delta,
    fieldRadius: preset.fieldRadius,
    playerPosition: player.position,
    previousPlayerPosition: previousWakePlayerPosition,
    playerVelocity: player.velocity,
    playerSpeed,
    playerGroundContact,
    waveMedium: settings.waveMedium,
    activeRippleSourceCount: rippleSources.getActiveSources(time).length,
    renderedRippleSourceCount: rippleField.getRenderedRippleSourceCount(),
    hexCount: rippleField.getInstanceCount(),
    qualityId: preset.id
  });
  const wakeMetrics = wakeField.getMetrics();
  rippleField.update(
    time,
    getEffectiveRenderSettings(),
    preset,
    rippleSources,
    player.position,
    player.velocity,
    playerSpeed,
    playerGroundContact,
    wakeField.getTexture(),
    wakeMetrics
  );
  if (effectiveBloomStrength > 0.02) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  lastFrameRenderMs = performance.now() - renderStartedAt;
  previousWakePlayerPosition.copy(player.position);
  updateStats(delta, time);
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
  if (settings.particlesEnabled) {
    particles.spawnPulseBurst(position, count, strength);
  }
}

function triggerJumpRipple(event: PlayerJumpEvent): void {
  // Takeoff is a smaller pressure release: visible enough to sell the jump,
  // but intentionally quieter than the landing impact.
  spawnPulse(event.position, event.strength, JUMP_TAKEOFF_OPTIONS);
  debugEvent("player.jump", "Player jumped from field surface", {
    time: roundMetric(clock.elapsedTime),
    strength: roundMetric(event.strength),
    position: vectorPayload(event.position)
  }, "info");
}

function triggerLandingRipple(event: PlayerJumpEvent): void {
  spawnPulse(event.position, event.strength, JUMP_LANDING_OPTIONS);
  debugEvent("player.jump", "Player landed on field surface", {
    time: roundMetric(clock.elapsedTime),
    strength: roundMetric(event.strength),
    airtimeSeconds: roundMetric(event.airtimeSeconds),
    impactSpeed: roundMetric(event.impactSpeed),
    position: vectorPayload(event.position)
  }, "info");
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
  const effectPosition = echo.effectPosition.clone();

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

  const rawParticleCount = Math.max(0, Math.floor(
    preset.burstParticleCount * settings.particleDensity * (0.58 + echo.burstStrength * 0.45)
  ));
  const particleCap = Math.max(
    ECHO_DISC_BURST_MIN_PARTICLE_CAP,
    Math.floor(preset.particleBudget * ECHO_DISC_BURST_PARTICLE_CAP_RATIO)
  );
  const particleCount = Math.min(rawParticleCount, particleCap);
  const activeBeforeParticles = particles.getActiveCount();
  let emittedParticleCount = 0;
  if (settings.particlesEnabled) {
    const particleLogPayload: RippleDebugPayload = {
      rawParticleBudget: rawParticleCount,
      cappedParticleBudget: particleCount,
      particleCap,
      emittedParticleCount,
      activeParticlesBefore: activeBeforeParticles,
      particleBudget: preset.particleBudget,
      quality: preset.id,
      particleDensity: roundMetric(settings.particleDensity),
      discBurstRadius: echo.discBurstRadius,
      effectPosition: vectorPayload(effectPosition)
    };
    debugMeasure(
      "echo.collect",
      "Spawned elevated Echo poof-disc particles",
      () => {
        emittedParticleCount = particles.spawnDiscBurst(
          effectPosition,
          particleCount,
          echo.burstStrength,
          echo.discBurstRadius
        );
        particleLogPayload.emittedParticleCount = emittedParticleCount;
      },
      particleLogPayload,
      10
    );
  }
  debugEvent("echo.collect", "Finished Echo detonation gameplay burst", {
    totalMs: roundMetric(performance.now() - detonationStartedAt),
    rawParticleBudget: rawParticleCount,
    cappedParticleBudget: particleCount,
    emittedParticleCount,
    effectPosition: vectorPayload(effectPosition),
    activeParticlesAfter: particles.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeRippleSources: rippleSources.getActiveSources(time).length
  });
}

function wireControls(): void {
  versionLink.textContent = APP_VERSION;
  changelogContent.textContent = changelogMarkdown.trim();
  setMenuVisible(false, false);

  menuToggle.addEventListener("click", () => {
    setMenuVisible(!menuVisible);
  });
  resumeButton.addEventListener("click", () => {
    setMenuVisible(false);
  });
  sceneMenuBackdrop.addEventListener("pointerdown", (event) => {
    if (event.target === sceneMenuBackdrop) setMenuVisible(false);
  });
  versionLink.addEventListener("click", () => {
    setChangelogVisible(true);
  });
  changelogClose.addEventListener("click", () => {
    setChangelogVisible(false);
  });
  changelogBackdrop.addEventListener("pointerdown", (event) => {
    if (event.target === changelogBackdrop) setChangelogVisible(false);
  });
  window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
  document.addEventListener("pointerlockchange", handlePointerLockChange);

  mobileQuery.addEventListener("change", updateMobileControlsVisibility);
  updateMobileControlsVisibility();
  wireMobileControls();

  pulseButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (!areSceneInputsEnabled()) return;
    player.triggerPulse();
  });

  qualitySelect.addEventListener("change", () => {
    if (!isQualityId(qualitySelect.value)) return;
    cancelScheduledFieldRebuild();
    settings.qualityId = qualitySelect.value;
    enforceFieldInstanceBudget("quality");
    syncFieldScaleControls();
    preset = getQualityPreset(settings);
    settings.bloomStrength = preset.bloomStrength;
    settings.bloomEnabled = settings.bloomStrength > 0;
    bloomSlider.value = String(settings.bloomStrength);
    updateEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);
    applyQualityPreset(preset, false);
  });
  skyboxSelect.addEventListener("change", () => {
    if (!isSkyboxId(skyboxSelect.value)) return;
    settings.skyboxId = skyboxSelect.value;
    skybox.setSkybox(settings.skyboxId);
    updateSceneFog(preset);
  });

  voxelSizeSlider.addEventListener("input", () => {
    settings.voxelSizeMeters = Number(voxelSizeSlider.value);
    enforceFieldInstanceBudget("voxel-size");
    preset = getQualityPreset(settings);
    syncFieldScaleControls();
    scheduleFieldRebuild();
  });
  arenaRadiusSlider.addEventListener("input", () => {
    settings.arenaRadiusMeters = Number(arenaRadiusSlider.value);
    enforceFieldInstanceBudget("arena-radius");
    preset = getQualityPreset(settings);
    syncFieldScaleControls();
    scheduleFieldRebuild();
  });
  walkSpeedSlider.addEventListener("input", () => {
    updatePlayerSpeedSettingsFromControls("walk");
  });
  sprintSpeedSlider.addEventListener("input", () => {
    updatePlayerSpeedSettingsFromControls("sprint");
  });
  surfaceGripSlider.addEventListener("input", () => {
    settings.surfaceGrip = THREE.MathUtils.clamp(
      Number(surfaceGripSlider.value),
      SURFACE_GRIP_LIMITS.min,
      SURFACE_GRIP_LIMITS.max
    );
    player.setSurfaceGrip(settings.surfaceGrip);
    updateSurfaceGripValue();
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
  particleToggle.addEventListener("click", () => {
    settings.particlesEnabled = !settings.particlesEnabled;
    particles.setEnabled(settings.particlesEnabled);
    updateEffectToggle(particleToggle, settings.particlesEnabled, particleSlider);
  });
  bloomSlider.addEventListener("input", () => {
    settings.bloomStrength = THREE.MathUtils.clamp(Number(bloomSlider.value), 0, 0.38);
  });
  bloomToggle.addEventListener("click", () => {
    settings.bloomEnabled = !settings.bloomEnabled;
    updateEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);
  });
  perfOverlayToggle.addEventListener("click", () => {
    setPerfOverlayVisible(!perfOverlayVisible);
  });
}

function syncControlValues(): void {
  syncSkyboxOptions();
  qualitySelect.value = settings.qualityId;
  skyboxSelect.value = settings.skyboxId;
  voxelSizeSlider.min = String(VOXEL_SIZE_MIN_METERS);
  voxelSizeSlider.max = String(VOXEL_SIZE_MAX_METERS);
  voxelSizeSlider.step = "0.05";
  voxelSizeSlider.value = String(settings.voxelSizeMeters);
  arenaRadiusSlider.min = String(ARENA_RADIUS_MIN_METERS);
  arenaRadiusSlider.max = String(ARENA_RADIUS_MAX_METERS);
  arenaRadiusSlider.step = "5";
  arenaRadiusSlider.value = String(settings.arenaRadiusMeters);
  syncFieldScaleControls();
  walkSpeedSlider.min = String(PLAYER_SPEED_LIMITS.walk.min);
  walkSpeedSlider.max = String(PLAYER_SPEED_LIMITS.walk.max);
  walkSpeedSlider.step = String(PLAYER_SPEED_LIMITS.walk.step);
  sprintSpeedSlider.max = String(PLAYER_SPEED_LIMITS.sprint.max);
  sprintSpeedSlider.step = String(PLAYER_SPEED_LIMITS.sprint.step);
  syncPlayerSpeedControls();
  surfaceGripSlider.min = String(SURFACE_GRIP_LIMITS.min);
  surfaceGripSlider.max = String(SURFACE_GRIP_LIMITS.max);
  surfaceGripSlider.step = String(SURFACE_GRIP_LIMITS.step);
  surfaceGripSlider.value = String(settings.surfaceGrip);
  heightSlider.value = String(settings.rippleHeight);
  radiusSlider.value = String(settings.rippleRadius);
  depthSlider.value = String(settings.waveMedium.effectiveDepth);
  particleSlider.value = String(settings.particleDensity);
  updateEffectToggle(particleToggle, settings.particlesEnabled, particleSlider);
  particles.setEnabled(settings.particlesEnabled);
  bloomSlider.value = String(settings.bloomStrength);
  updateEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);
  setPerfOverlayVisible(perfOverlayVisible);
}

function syncSkyboxOptions(): void {
  if (skyboxSelect.options.length > 0) return;

  for (const option of SKYBOX_OPTIONS) {
    const optionElement = document.createElement("option");
    optionElement.value = option.id;
    optionElement.textContent = option.label;
    skyboxSelect.append(optionElement);
  }
}

function enforceFieldInstanceBudget(changedControl: FieldScaleChangedControl): void {
  const result = applyFieldInstanceBudget(settings, changedControl, fieldStressModeEnabled);
  if (!result.applied) return;

  debugEvent("field.guardrail", "Clamped field scale to instance budget", {
    changedControl: result.changedControl,
    clampedField: result.clampedField,
    quality: result.quality,
    maxInstances: result.maxInstances,
    estimatedInstancesBefore: result.estimatedInstancesBefore,
    estimatedInstancesAfter: result.estimatedInstancesAfter,
    voxelSizeMetersBefore: roundMetric(result.voxelSizeMetersBefore),
    voxelSizeMetersAfter: roundMetric(result.voxelSizeMetersAfter),
    arenaRadiusMetersBefore: roundMetric(result.arenaRadiusMetersBefore),
    arenaRadiusMetersAfter: roundMetric(result.arenaRadiusMetersAfter)
  }, "warn");
}

function syncFieldScaleControls(): void {
  voxelSizeSlider.value = String(settings.voxelSizeMeters);
  arenaRadiusSlider.value = String(settings.arenaRadiusMeters);
  updateVoxelSizeValue();
  updateArenaRadiusValue();
}

function isFieldStressModeEnabled(): boolean {
  const queryValue = new URLSearchParams(window.location.search).get("stress");
  const storedValue = readLocalStorageValue("rippleStressMode");
  return queryValue === "1" || storedValue === "1";
}

function readLocalStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function areSceneInputsEnabled(): boolean {
  return !menuVisible && !changelogVisible;
}

function getEffectiveBloomStrength(): number {
  return settings.bloomEnabled ? settings.bloomStrength : 0;
}

function getEffectiveRenderSettings(): typeof settings {
  return settings.bloomEnabled ? settings : { ...settings, bloomStrength: 0 };
}

function updateEffectToggle(button: HTMLButtonElement, enabled: boolean, slider: HTMLInputElement): void {
  updateBinaryToggle(button, enabled);
  slider.disabled = !enabled;
}

function updateBinaryToggle(button: HTMLButtonElement, enabled: boolean): void {
  button.textContent = enabled ? "On" : "Off";
  button.setAttribute("aria-pressed", String(enabled));
}

function setPerfOverlayVisible(visible: boolean): void {
  perfOverlayVisible = visible;
  perfOverlay.hidden = !visible;
  updateBinaryToggle(perfOverlayToggle, visible);
}

function handleGlobalKeyDown(event: KeyboardEvent): void {
  if (event.code === "F2") {
    event.preventDefault();
    event.stopImmediatePropagation();
    setPerfOverlayVisible(!perfOverlayVisible);
    return;
  }

  if (event.code !== "Escape") return;

  // Esc is the one global UI key for the lab. Capture it before the movement
  // rig sees the event so opening the menu cannot leave a phantom input behind.
  event.preventDefault();
  event.stopImmediatePropagation();

  if (changelogVisible) {
    setChangelogVisible(false);
    return;
  }

  setMenuVisible(!menuVisible);
}

function handlePointerLockChange(): void {
  const pointerIsLockedToScene = document.pointerLockElement === renderer.domElement;
  if (!pointerIsLockedToScene && pointerLockWasActive && suppressNextPointerUnlockMenu) {
    suppressNextPointerUnlockMenu = false;
  } else if (!pointerIsLockedToScene && pointerLockWasActive && areSceneInputsEnabled()) {
    setMenuVisible(true);
  }
  pointerLockWasActive = pointerIsLockedToScene;
}

function setMenuVisible(visible: boolean, shouldFocus = true): void {
  if (!visible && changelogVisible) {
    setChangelogVisible(false, false);
  }

  menuVisible = visible;
  sceneMenuBackdrop.hidden = !visible;
  document.body.classList.toggle("menu-open", visible);
  menuToggle.setAttribute("aria-expanded", String(visible));
  menuToggle.setAttribute("aria-label", visible ? "Close pause menu" : "Open pause menu");

  if (visible) {
    releaseTouchControls();
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
    // A pause menu should put the safest action under focus first. Resume is
    // also the best keyboard target for users who opened the menu accidentally.
    if (shouldFocus) resumeButton.focus({ preventScroll: true });
  }

  updateMobileControlsVisibility();
}

function setChangelogVisible(visible: boolean, shouldFocus = true): void {
  if (visible && !menuVisible) {
    setMenuVisible(true, false);
  }

  changelogVisible = visible;
  changelogBackdrop.hidden = !visible;
  if (visible) {
    releaseTouchControls();
    if (shouldFocus) changelogDialog.focus({ preventScroll: true });
  } else if (shouldFocus && menuVisible) {
    sceneMenu.focus({ preventScroll: true });
  }

  updateMobileControlsVisibility();
}

function updateMobileControlsVisibility(): void {
  mobileControls.hidden = !mobileQuery.matches || !areSceneInputsEnabled();
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
  if (!areSceneInputsEnabled()) return;
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

function releaseTouchControls(): void {
  for (const state of activeTouchSticks.values()) {
    state.knob.style.transform = "translate3d(-50%, -50%, 0)";
  }
  activeTouchSticks.clear();
  player.setMobileMoveIntent(0, 0);
  player.setMobileLookIntent(0, 0);
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
  updatePlayerSpeedValues();
  updateSurfaceGripValue();
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

function updatePlayerSpeedSettingsFromControls(changedSlider: "walk" | "sprint"): void {
  const requestedWalkSpeed = changedSlider === "walk"
    ? Number(walkSpeedSlider.value)
    : settings.playerSpeed.walkSpeedMetersPerSecond;
  const requestedSprintSpeed = Number(sprintSpeedSlider.value);

  settings.playerSpeed = normalizePlayerSpeedSettings({
    walkSpeedMetersPerSecond: requestedWalkSpeed,
    sprintSpeedMetersPerSecond: requestedSprintSpeed
  });
  player.setSpeedSettings(settings.playerSpeed);
  syncPlayerSpeedControls();
}

function syncPlayerSpeedControls(): void {
  // These rows are hidden for now, but keeping the DOM state valid means we can
  // unhide them later without relearning this exact constraint dance.
  const minimumSprintSpeed = getMinimumSprintSpeedMetersPerSecond(
    settings.playerSpeed.walkSpeedMetersPerSecond
  );
  sprintSpeedSlider.min = String(minimumSprintSpeed);
  walkSpeedSlider.value = String(settings.playerSpeed.walkSpeedMetersPerSecond);
  sprintSpeedSlider.value = String(settings.playerSpeed.sprintSpeedMetersPerSecond);
  updatePlayerSpeedValues();
}

function updatePlayerSpeedValues(): void {
  walkSpeedValue.textContent = `${settings.playerSpeed.walkSpeedMetersPerSecond.toFixed(1)} m/s`;
  sprintSpeedValue.textContent = `${settings.playerSpeed.sprintSpeedMetersPerSecond.toFixed(1)} m/s`;
}

function updateSurfaceGripValue(): void {
  // Grip is shown as a simple baseline multiplier: 100% is the committed
  // default handling, lower is slicker, higher is tighter.
  surfaceGripValue.textContent = `${Math.round(settings.surfaceGrip * 100)}%`;
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
  wakeField.reset("field-rebuild");
  updateStageFloor(nextPreset);
  updateShadowResolution(nextPreset.shadowMapSize, nextPreset.fieldRadius);
  resize();
  prewarmRenderPipelines();

  const durationMs = performance.now() - rebuildStartedAt;
  const wakeMetrics = wakeField.getMetrics();
  debugEvent("field.rebuild", "Rebuilt hex tile field geometry", {
    durationMs: roundMetric(durationMs),
    quality: nextPreset.id,
    hexCount: rippleField.getInstanceCount(),
    hexDiameterMeters: roundMetric(settings.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
    sceneRadius: roundMetric(nextPreset.fieldRadius),
    tileSpacing: roundMetric(nextPreset.tileSpacing),
    wakeMode: wakeMetrics.mode,
    wakeTextureSize: wakeMetrics.textureSize
  }, durationMs > GLOBAL_FRAME_HITCH_MS ? "warn" : "info");
}

function applyQualityPreset(nextPreset: QualityPreset, initial: boolean): void {
  qualityBadge.textContent = nextPreset.label;
  renderer.shadowMap.enabled = nextPreset.shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  updateSceneFog(nextPreset);
  bloomPass.strength = getEffectiveBloomStrength();

  if (!initial) {
    wakeField.resizeForPreset(nextPreset, "quality");
    rebuildFieldGeometry(nextPreset);
    particles = particles.resizeBudget(scene, nextPreset.particleBudget, getPixelRatio());
    pulseLights = pulseLights.resize(scene, nextPreset.pulseLightCount);
    prewarmRenderPipelines();
  }

  updateStageFloor(nextPreset);
  updateShadowResolution(nextPreset.shadowMapSize, nextPreset.fieldRadius);
  resize();
}

function updateSceneFog(nextPreset: QualityPreset): void {
  const activeSkybox = skybox.getActiveOption();
  scene.fog = new THREE.FogExp2(
    activeSkybox.fogColor,
    nextPreset.fogDensity * activeSkybox.fogDensityMultiplier
  );
}

function prewarmRenderPipelines(): void {
  const time = clock.elapsedTime;

  // Keep startup/rebuild hitches out of the first visible gameplay frame by
  // compiling the field material and running a neutral wake pass immediately
  // after target allocation. The player positions match, so no wake is stamped.
  wakeField.prewarm({
    time,
    delta: 0,
    fieldRadius: preset.fieldRadius,
    playerPosition: player.position,
    previousPlayerPosition: player.position,
    playerVelocity: player.velocity,
    playerSpeed: 0,
    playerGroundContact: 1,
    waveMedium: settings.waveMedium,
    activeRippleSourceCount: rippleSources.getActiveSources(time).length,
    renderedRippleSourceCount: rippleField.getRenderedRippleSourceCount(),
    hexCount: rippleField.getInstanceCount(),
    qualityId: preset.id
  });
  renderer.compile(scene, camera);
}

function updateShadowResolution(size: number, fieldRadius: number): void {
  const mapSize = Math.max(1, size);
  const shadowDistance = Math.max(180, fieldRadius * 2.7);

  for (const source of sceneLightSources) {
    source.light.castShadow = size > 0;
    source.light.shadow.mapSize.set(mapSize, mapSize);
    source.light.shadow.camera.near = 1;
    source.light.shadow.camera.far = shadowDistance;
    source.light.shadow.needsUpdate = true;
  }
}

function createLighting(): void {
  const ambient = new THREE.HemisphereLight(0x87ccff, 0x06111a, 0.82);
  scene.add(ambient);

  const keySource = createSceneLightSource(
    "Cyan key source fixture",
    "Cyan key source spotlight",
    new THREE.Vector3(-24, 38, 18),
    KEY_LIGHT_SOURCE_COLOR,
    1.25,
    0.34,
    330,
    2.75
  );
  sceneLightSources.push(keySource);
  scene.add(keySource.object, keySource.target);

  const rimSource = createSceneLightSource(
    "Magenta rim source fixture",
    "Magenta rim source spotlight",
    new THREE.Vector3(30, 18, -24),
    RIM_LIGHT_SOURCE_COLOR,
    0.92,
    0.27,
    150,
    2.25
  );
  sceneLightSources.push(rimSource);
  scene.add(rimSource.object, rimSource.target);
}

function createSceneLightSource(
  name: string,
  lightName: string,
  position: THREE.Vector3,
  colorHex: number,
  scale: number,
  heightScale: number,
  intensity: number,
  distanceScale: number
): SceneLightSource {
  const color = new THREE.Color(colorHex);
  const hotColor = color.clone().lerp(new THREE.Color(0xffffff), 0.72);
  const object = new THREE.Group();
  object.name = name;

  const horizontalDirection = new THREE.Vector3(position.x, 0, position.z);
  if (horizontalDirection.lengthSq() <= 0.0001) horizontalDirection.set(1, 0, 0);
  horizontalDirection.normalize();

  // These fixtures are the actual key/rim sources. The visible part is now a
  // layered billboard impostor: flat shader cards that always face the camera,
  // overlap into a soft glow volume, and sit on top of real light objects.
  const plasmaVisual = new THREE.Group();
  plasmaVisual.name = `${name} billboard plasma volume`;
  object.add(plasmaVisual);

  const billboardMaterials: THREE.ShaderMaterial[] = [];
  const billboardGeometry = new THREE.PlaneGeometry(1, 1);
  const billboardLayers = [
    {
      name: "outer fog bloom",
      size: 8.8,
      opacity: 0.36,
      coreRadius: 0.18,
      fogPower: 1.15,
      filamentStrength: 0.18,
      timeScale: 0.46,
      depthOffset: -0.04,
      renderOrder: 2
    },
    {
      name: "middle plasma haze",
      size: 5.2,
      opacity: 0.58,
      coreRadius: 0.24,
      fogPower: 1.55,
      filamentStrength: 0.36,
      timeScale: 0.78,
      depthOffset: 0,
      renderOrder: 3
    },
    {
      name: "hot inner corona",
      size: 2.25,
      opacity: 0.86,
      coreRadius: 0.42,
      fogPower: 2.25,
      filamentStrength: 0.62,
      timeScale: 1.14,
      depthOffset: 0.04,
      renderOrder: 4
    }
  ] as const;

  for (const layer of billboardLayers) {
    const material = createPlasmaBillboardMaterial(color, hotColor, layer);
    const billboard = new THREE.Mesh(billboardGeometry, material);
    billboard.name = `${name} ${layer.name} billboard`;
    billboard.scale.setScalar(layer.size * scale);
    billboard.position.z = layer.depthOffset * scale;
    billboard.renderOrder = layer.renderOrder;
    billboard.frustumCulled = false;
    plasmaVisual.add(billboard);
    billboardMaterials.push(material);
  }

  const light = new THREE.SpotLight(colorHex, intensity, 1, 1.08, 0.74, 1.18);
  light.name = lightName;
  light.position.set(0, 0, 0);
  light.shadow.bias = -0.00018;
  light.shadow.normalBias = 0.018;
  object.add(light);

  const fillLight = new THREE.PointLight(colorHex, intensity * 0.018, 42 * scale, 1.9);
  fillLight.name = `${name} local plasma glow`;
  fillLight.castShadow = false;
  object.add(fillLight);

  const target = new THREE.Object3D();
  target.name = `${name} aim target`;
  target.position.set(0, 0.35, 0);
  light.target = target;

  return {
    object,
    light,
    fillLight,
    target,
    plasmaVisual,
    billboardMaterials,
    horizontalDirection,
    heightScale,
    intensity,
    distanceScale,
    phaseOffset: position.length() * 0.037
  };
}

function createPlasmaBillboardMaterial(
  color: THREE.Color,
  hotColor: THREE.Color,
  layer: {
    readonly opacity: number;
    readonly coreRadius: number;
    readonly fogPower: number;
    readonly filamentStrength: number;
    readonly timeScale: number;
  }
): THREE.ShaderMaterial {
  // This is the practical "volumetric" cheat: radial fog and animated plasma
  // filaments in screen-facing UV space. Multiple layers stack into a glow
  // cloud while keeping the light count and geometry count tiny.
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color.clone() },
      uHotColor: { value: hotColor.clone() },
      uOpacity: { value: layer.opacity },
      uCoreRadius: { value: layer.coreRadius },
      uFogPower: { value: layer.fogPower },
      uFilamentStrength: { value: layer.filamentStrength },
      uTimeScale: { value: layer.timeScale }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uHotColor;
      uniform float uOpacity;
      uniform float uCoreRadius;
      uniform float uFogPower;
      uniform float uFilamentStrength;
      uniform float uTimeScale;
      varying vec2 vUv;

      void main() {
        vec2 centeredUv = vUv - vec2(0.5);
        float radius = length(centeredUv) * 2.0;
        float angle = atan(centeredUv.y, centeredUv.x);
        float time = uTime * uTimeScale;

        float fog = exp(-pow(radius * 1.42, uFogPower + 1.0));
        float edgeFade = smoothstep(1.0, 0.18, radius);
        float core = smoothstep(uCoreRadius, 0.0, radius);
        float filamentA = sin(angle * 7.0 + radius * 9.0 - time * 1.8);
        float filamentB = sin(centeredUv.x * 18.0 - centeredUv.y * 11.0 + time * 2.4);
        float filamentC = sin((centeredUv.x + centeredUv.y) * 15.0 + time * 3.1);
        float filaments = smoothstep(1.05, 2.25, filamentA + filamentB + filamentC);
        float breath = 0.88 + 0.12 * sin(time * 3.4 + radius * 5.0);
        float alpha = (fog * 0.72 + core * 0.6 + filaments * uFilamentStrength) *
          edgeFade * uOpacity * breath;
        if (alpha < 0.002) discard;

        vec3 color = mix(uColor * 1.45, uHotColor * 4.6, clamp(core + filaments * 0.65, 0.0, 1.0));
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

function updateSceneLightSourceVisuals(time: number): void {
  for (const source of sceneLightSources) {
    const localTime = time + source.phaseOffset;
    for (const material of source.billboardMaterials) {
      material.uniforms.uTime.value = localTime;
    }

    // The impostor planes face the camera every frame. The actual SpotLight and
    // PointLight are siblings, so this visual billboard trick never changes the
    // direction or position of the real illumination.
    source.plasmaVisual.quaternion.copy(camera.quaternion);
    source.plasmaVisual.scale.setScalar(1 + Math.sin(localTime * 2.4) * 0.035);
  }
}

function updateSceneLightSources(nextPreset: QualityPreset): void {
  const horizonRadius = nextPreset.fieldRadius * 0.72;

  for (const source of sceneLightSources) {
    source.object.position.set(
      source.horizontalDirection.x * horizonRadius,
      THREE.MathUtils.clamp(nextPreset.fieldRadius * source.heightScale, 18, 56),
      source.horizontalDirection.z * horizonRadius
    );
    source.target.position.set(0, 0.35, 0);
    source.light.intensity = source.intensity;
    source.light.distance = Math.max(150, nextPreset.fieldRadius * source.distanceScale);
    source.light.shadow.camera.far = Math.max(180, nextPreset.fieldRadius * 2.7);
    source.light.shadow.needsUpdate = true;
    source.fillLight.intensity = source.intensity * 0.018;
    source.fillLight.distance = Math.max(28, nextPreset.fieldRadius * 0.34);
  }
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
  floor.position.y = STAGE_FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);
  return floor;
}

function updateStageFloor(nextPreset: QualityPreset): void {
  // The floor is a unit circle scaled to the active arena. Reusing one mesh is
  // much cheaper than throwing away geometry every time the arena slider moves.
  const floorRadius = nextPreset.fieldRadius + nextPreset.tileSpacing * 0.5;
  stageFloor.scale.set(floorRadius, floorRadius, 1);
  arenaBarrier.setRadius(floorRadius);
  updateSceneLightSources(nextPreset);
}

function createAvatar(activeAvatarStyle: AvatarStyle = "hoverPod"): PlayerAvatar {
  // Keep the old avatar as a real inactive style path. That makes it easy to
  // restore or cannibalize later without leaving dead code for TypeScript to
  // complain about, because apparently the compiler has opinions too.
  switch (activeAvatarStyle) {
    case "legacyGlowOrb":
      return createLegacyGlowAvatar();
    case "hoverPod":
    default:
      return createHoverPodAvatar();
  }
}

function createHoverPodAvatar(): PlayerAvatar {
  const object = new THREE.Group();
  object.name = "Player hover pod avatar";

  const headingGroup = new THREE.Group();
  headingGroup.name = "Player hover pod facing group";
  object.add(headingGroup);

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x64f6df,
    emissive: 0x0b8b8f,
    emissiveIntensity: 0.66,
    metalness: 0.22,
    roughness: 0.2,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    transmission: 0.08
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.44, 2), bodyMaterial);
  body.name = "Player hover pod glass body";
  body.scale.set(0.95, 0.44, 1.5);
  body.castShadow = true;
  headingGroup.add(body);

  const planformMaterial = new THREE.MeshBasicMaterial({
    color: 0x6dffe7,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const planform = new THREE.Mesh(createHoverPodPlanformGeometry(), planformMaterial);
  planform.name = "Player hover pod luminous forward planform";
  planform.position.y = -0.03;
  headingGroup.add(planform);

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0x8ffff0,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), coreMaterial);
  core.name = "Player hover pod internal plasma core";
  core.position.z = 0.18;
  headingGroup.add(core);

  const noseMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8fff2,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.82, 32, 1, true), noseMaterial);
  nose.name = "Player hover pod bright forward nose";
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.78;
  headingGroup.add(nose);

  const spineMaterial = new THREE.MeshBasicMaterial({
    color: 0xeaffff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const forwardSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.32, 12), spineMaterial);
  forwardSpine.name = "Player hover pod forward luminous spine";
  forwardSpine.rotation.x = Math.PI / 2;
  forwardSpine.position.set(0, 0.08, 0.34);
  headingGroup.add(forwardSpine);

  const noseGlint = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 18, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  noseGlint.name = "Player hover pod forward glint";
  noseGlint.position.z = 1.12;
  headingGroup.add(noseGlint);

  const tailMaterial = new THREE.MeshBasicMaterial({
    color: 0x4dfff1,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const tailGlow = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.18, 32, 1, true), tailMaterial);
  tailGlow.name = "Player hover pod rear plasma tail";
  tailGlow.rotation.x = -Math.PI / 2;
  tailGlow.position.z = -0.7;
  headingGroup.add(tailGlow);

  const rearLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 10),
    new THREE.MeshBasicMaterial({
      color: 0x53ffee,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  rearLamp.name = "Player hover pod rear lamp";
  rearLamp.position.z = -0.58;
  headingGroup.add(rearLamp);

  const thrusterMaterial = new THREE.MeshBasicMaterial({
    color: 0x72fff0,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const leftThruster = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), thrusterMaterial);
  leftThruster.name = "Player hover pod left rear thruster";
  leftThruster.position.set(-0.28, -0.02, -0.78);
  const rightThruster = leftThruster.clone();
  rightThruster.name = "Player hover pod right rear thruster";
  rightThruster.position.x = 0.28;
  headingGroup.add(leftThruster, rightThruster);

  const finMaterial = new THREE.MeshBasicMaterial({
    color: 0x8dc8ff,
    transparent: true,
    opacity: 0.46,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  headingGroup.add(createHoverPodFin(-1, finMaterial), createHoverPodFin(1, finMaterial));

  const orbitTrails = createAvatarOrbitTrails();
  headingGroup.add(orbitTrails.trails, orbitTrails.points);

  const coreLight = new THREE.PointLight(0x8fffe0, 4.8, 19, 1.65);
  coreLight.name = "Player hover pod local field light";
  coreLight.position.y = 0.32;
  object.add(coreLight);

  const floorLight = new THREE.PointLight(0x55cfff, 2.15, 14, 1.45);
  floorLight.name = "Player hover pod low cyan field fill";
  floorLight.position.y = -1.05;
  object.add(floorLight);

  const noseLight = new THREE.PointLight(0xb8fff2, 1.65, 8.5, 1.8);
  noseLight.name = "Player hover pod forward readability light";
  noseLight.position.copy(AVATAR_FORWARD_AXIS).multiplyScalar(1.08);
  noseLight.position.y = 0.08;
  headingGroup.add(noseLight);

  return {
    object,
    update(delta, position, movementSpeed, facingYaw) {
      object.position.copy(position);
      headingGroup.rotation.y = facingYaw;

      const time = clock.elapsedTime;
      const breathingGlow = Math.sin(time * 4) * 0.5 + 0.5;
      const movementGlow = THREE.MathUtils.clamp(movementSpeed / 18, 0, 1);

      // The body keeps a directional pod silhouette. The little internal core
      // gets the old magical spin so the avatar still feels alive, not like a
      // flat gameplay marker pretending it is art.
      body.scale.set(0.95 + breathingGlow * 0.025, 0.44 + breathingGlow * 0.015, 1.5 + movementGlow * 0.14);
      planformMaterial.opacity = 0.22 + breathingGlow * 0.05 + movementGlow * 0.09;
      core.rotation.x += delta * 1.7;
      core.rotation.y += delta * 2.4;
      core.rotation.z -= delta * 0.9;
      coreMaterial.opacity = 0.58 + breathingGlow * 0.12;
      bodyMaterial.emissiveIntensity = 0.58 + breathingGlow * 0.22 + movementGlow * 0.18;
      noseMaterial.opacity = 0.55 + breathingGlow * 0.1 + movementGlow * 0.1;
      spineMaterial.opacity = 0.48 + breathingGlow * 0.12 + movementGlow * 0.12;
      tailMaterial.opacity = 0.2 + movementGlow * 0.25 + breathingGlow * 0.07;
      tailGlow.scale.set(0.85 + movementGlow * 0.18, 0.9 + movementGlow * 0.52, 0.85 + movementGlow * 0.18);
      rearLamp.scale.setScalar(0.9 + breathingGlow * 0.18 + movementGlow * 0.2);
      noseGlint.scale.setScalar(0.88 + breathingGlow * 0.22);
      const thrusterScale = 0.9 + breathingGlow * 0.16 + movementGlow * 0.32;
      leftThruster.scale.setScalar(thrusterScale);
      rightThruster.scale.setScalar(thrusterScale);
      thrusterMaterial.opacity = 0.68 + breathingGlow * 0.12 + movementGlow * 0.16;
      finMaterial.opacity = 0.34 + breathingGlow * 0.08 + movementGlow * 0.11;
      updateAvatarHoverTrails(orbitTrails, time, movementGlow);

      // Keep the useful local-light behavior from the old avatar. None of these
      // lights casts shadows; moving point-light shadows would be extremely
      // rude to the dense hex field.
      coreLight.intensity = 4.0 + breathingGlow * 1.0 + movementGlow * 1.55;
      coreLight.distance = 17 + movementGlow * 5;
      floorLight.intensity = 1.7 + breathingGlow * 0.44 + movementGlow * 0.95;
      floorLight.distance = 12 + movementGlow * 4;
      noseLight.intensity = 1.15 + breathingGlow * 0.28 + movementGlow * 0.72;
    }
  };
}

function createHoverPodFin(side: -1 | 1, material: THREE.MeshBasicMaterial): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        side * 0.18, -0.07, 0.08,
        side * 0.9, -0.03, -0.35,
        side * 0.3, 0.16, -0.74
      ]),
      3
    )
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();

  const fin = new THREE.Mesh(geometry, material);
  fin.name = side < 0 ? "Player hover pod left glow fin" : "Player hover pod right glow fin";
  return fin;
}

function createHoverPodPlanformGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 1.16,
        -0.66, 0, -0.1,
        -0.34, 0, -0.72,
        0, 0, -0.5,
        0.34, 0, -0.72,
        0.66, 0, -0.1
      ]),
      3
    )
  );
  geometry.setIndex([
    0, 1, 5,
    1, 2, 3,
    1, 3, 5,
    3, 4, 5
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function createLegacyGlowAvatar(): PlayerAvatar {
  // Shelved in favor of the hover pod on v0.3.20-ALPHA. Keep this intact rather
  // than deleting it; the glass shell, orbit motes, and local-light tuning are
  // still useful reference parts for later avatar styles.
  const object = new THREE.Group();
  object.name = "Player shelved glow orb avatar";

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
  coreLight.name = "Player bright local field light";
  coreLight.position.y = 0.35;
  object.add(coreLight);

  const floorLight = new THREE.PointLight(0x55cfff, 2.1, 14, 1.45);
  floorLight.name = "Player low cyan field fill";
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
      // hex field. Keep shadows off for this moving light pair; point-light
      // shadows would be expensive with tens of thousands of instanced cells.
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

function updateAvatarHoverTrails(orbitTrails: AvatarOrbitTrails, time: number, movementGlow: number): void {
  orbitTrails.points.material.uniforms.uTime.value = time;
  orbitTrails.trails.material.opacity = 0.24 + movementGlow * 0.18;
  const trailStepSeconds = AVATAR_ORBIT_TRAIL_SECONDS / AVATAR_ORBIT_TRAIL_SEGMENTS;

  for (let index = 0; index < AVATAR_ORBIT_MOTE_COUNT; index += 1) {
    const pointOffset = index * 3;
    writeAvatarHoverTrailPosition(orbitTrails.positions, pointOffset, orbitTrails, index, time, movementGlow);
    orbitTrails.alphas[index] = 0.42 + movementGlow * 0.2 + Math.sin(time * 8.2 + orbitTrails.phases[index]) * 0.08;
    orbitTrails.sizes[index] = 0.62 + movementGlow * 0.24 + Math.sin(time * 5.4 + orbitTrails.phases[index]) * 0.06;

    for (let segment = 0; segment < AVATAR_ORBIT_TRAIL_SEGMENTS; segment += 1) {
      const segmentOffset = (index * AVATAR_ORBIT_TRAIL_SEGMENTS + segment) * 6;
      const olderTime = time - (segment + 1) * trailStepSeconds;
      const newerTime = time - segment * trailStepSeconds;
      writeAvatarHoverTrailPosition(
        orbitTrails.trailPositions,
        segmentOffset,
        orbitTrails,
        index,
        olderTime,
        movementGlow
      );
      writeAvatarHoverTrailPosition(
        orbitTrails.trailPositions,
        segmentOffset + 3,
        orbitTrails,
        index,
        newerTime,
        movementGlow
      );
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

function writeAvatarHoverTrailPosition(
  target: Float32Array,
  offset: number,
  orbitTrails: AvatarOrbitTrails,
  index: number,
  time: number,
  movementGlow: number
): void {
  const phase = orbitTrails.phases[index];
  const angle = orbitTrails.baseAngles[index] + time * orbitTrails.speeds[index] * 0.56 +
    Math.sin(time * 1.8 + phase) * 0.14;
  const tailRank = (index % 6) / 5;
  const radius = orbitTrails.radii[index] * (0.28 + movementGlow * 0.12);
  const tailDepth = 0.24 + tailRank * (0.72 + movementGlow * 0.95);

  // The active avatar wants rear wake motes, not a symmetric halo. Keeping the
  // points in local pod space makes the sparkle tail follow actual player
  // facing when the heading group rotates.
  target[offset] = Math.cos(angle) * radius * 0.82;
  target[offset + 1] = 0.03 + Math.sin(angle * 1.6 + phase) * (0.18 + movementGlow * 0.07) +
    Math.sin(time * 3.2 + phase) * 0.045;
  target[offset + 2] = Math.sin(angle) * radius * 0.28 - tailDepth +
    Math.sin(time * 3.6 + phase) * 0.045;
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
  statsLine.textContent = `${Math.round(measuredFps)} fps | ${rippleField.getInstanceCount().toLocaleString()} hexes | ${preset.particleBudget.toLocaleString()} particles`;
  mediumLine.textContent = `${basePropagationSpeed.toFixed(1)} m/s | ${settings.waveMedium.effectiveDepth.toFixed(1)}m depth | ${formatVoxelSize(settings.voxelSizeMeters)} hex dia | ${settings.arenaRadiusMeters.toFixed(0)}m arena | ${echoZones.getActiveCount()} echoes | ${activeSources.length} pulses | newest ${newestRingRadius.toFixed(1)}m`;
  updatePerfOverlay(activeSources.length);
}

function updatePerfOverlay(activeSourceCount: number): void {
  const renderedSourceCount = rippleField.getRenderedRippleSourceCount();
  const renderedSourceLimit = rippleField.getRenderedRippleSourceLimit();
  const activeParticleCount = particles.getActiveCount();
  const drawCalls = renderer.info.render.calls;
  const triangles = renderer.info.render.triangles;
  const wakeMetrics = wakeField.getMetrics();

  // Keep the overlay data cheap and human-readable. These values are sampled on
  // the same cadence as the HUD, not every frame, so it can stay on while tuning.
  perfOverlayQuality.textContent = preset.label;
  perfFrame.textContent = `${(lastFrameUpdateMs + lastFrameRenderMs).toFixed(1)} ms`;
  perfUpdate.textContent = `${lastFrameUpdateMs.toFixed(1)} ms`;
  perfRender.textContent = `${lastFrameRenderMs.toFixed(1)} ms`;
  perfFps.textContent = `${Math.round(measuredFps)} | raw ${lastRawDeltaMs.toFixed(1)} ms`;
  perfHexes.textContent = formatCompactCount(rippleField.getInstanceCount());
  perfParticles.textContent = `${formatCompactCount(activeParticleCount)}/${formatCompactCount(preset.particleBudget)}`;
  perfWaves.textContent = `${activeSourceCount} | GPU ${renderedSourceCount}/${renderedSourceLimit}`;
  perfWake.textContent = `${wakeMetrics.mode} | ${wakeMetrics.textureSize}px | ${wakeMetrics.passMs.toFixed(1)} ms`;
  perfRenderer.textContent = `${drawCalls}c | ${formatCompactCount(triangles)} tri | ${getPixelRatio().toFixed(2)}x`;
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
    updateMs: roundMetric(lastFrameUpdateMs),
    renderMs: roundMetric(lastFrameRenderMs),
    clockDeltaMs: roundMetric(delta * 1000),
    activeEchoes: echoZones.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeParticles: particles.getActiveCount(),
    activeRippleSources: rippleSources.getActiveSources(time).length,
    renderedRippleSources: rippleField.getRenderedRippleSourceCount(),
    renderedRippleSourceLimit: rippleField.getRenderedRippleSourceLimit(),
    quality: preset.id,
    hexDiameterMeters: roundMetric(settings.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
    bloomStrength: roundMetric(getEffectiveBloomStrength())
  }, isSlow ? "warn" : "debug");
}

function logGlobalFrameHitch(time: number, delta: number, rawDelta: number, frameStartedAt: number): void {
  if (time < GLOBAL_FRAME_HITCH_WARMUP_SECONDS) return;
  if (document.visibilityState !== "visible") return;

  const frameMs = performance.now() - frameStartedAt;
  const updateMs = lastFrameUpdateMs;
  const renderMs = lastFrameRenderMs;
  const rawClockDeltaMs = rawDelta * 1000;
  const isSlowFrame = frameMs >= GLOBAL_FRAME_HITCH_MS || rawClockDeltaMs >= GLOBAL_FRAME_HITCH_MS;
  if (!isSlowFrame) return;

  // Echo detonation logging only watches a short post-collection window. This
  // broader breadcrumb catches stalls from render pressure, shader compilation,
  // or any other visible-tab hitch that lands outside that narrow window.
  if (time - lastGlobalFrameHitchLogAt < GLOBAL_FRAME_HITCH_LOG_INTERVAL_SECONDS) return;

  lastGlobalFrameHitchLogAt = time;
  const activeSources = rippleSources.getActiveSources(time);
  const wakeMetrics = wakeField.getMetrics();
  const hitchEvent = createGlobalFrameHitchEvent({
    time,
    frameMs,
    updateMs,
    renderMs,
    rawClockDeltaMs,
    cappedClockDeltaMs: delta * 1000,
    thresholdMs: GLOBAL_FRAME_HITCH_MS,
    echoWatchActive: time <= echoDebugFrameWatchUntil,
    activeEchoes: echoZones.getActiveCount(),
    activeVisualBursts: echoZones.getCollectBurstCount(),
    activeParticles: particles.getActiveCount(),
    particleBudget: preset.particleBudget,
    activeRippleSources: activeSources.length,
    renderedRippleSources: rippleField.getRenderedRippleSourceCount(),
    renderedRippleSourceLimit: rippleField.getRenderedRippleSourceLimit(),
    wakeMetrics,
    quality: preset.id,
    hexDiameterMeters: settings.voxelSizeMeters,
    arenaRadiusMeters: settings.arenaRadiusMeters,
    bloomStrength: getEffectiveBloomStrength(),
    particleDensity: settings.particleDensity,
    particlesEnabled: settings.particlesEnabled,
    bloomEnabled: settings.bloomEnabled,
    rendererPixelRatio: getPixelRatio(),
    visibilityState: document.visibilityState
  });
  debugEvent(hitchEvent.channel, hitchEvent.message, hitchEvent.payload, "warn");
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
