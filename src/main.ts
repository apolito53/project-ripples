import * as THREE from "three";
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
import {
  EchoZoneStateStore,
  createEmptyEchoVisualState,
  type EchoVisualStateSnapshot,
  type TriggeredEchoZone
} from "./echoState";
import { EchoZoneField } from "./echoZones";
import {
  applyFieldInstanceBudget,
  type FieldScaleChangedControl,
  type FieldScaleGuardrailResult
} from "./fieldScaleGuardrails";
import {
  createGlobalFrameHitchEvent,
  formatCompactCount,
  formatVoxelSize
} from "./frameTelemetry";
import { cloneDefaultSettings, getQualityPreset } from "./labSettings";
import { ParticleVeil } from "./particleVeil";
import {
  ParticleVeilState,
  createEmptyParticleStateSnapshot,
  type ParticleStateSnapshot
} from "./particleState";
import { PulseLightRig } from "./pulseLights";
import {
  ARENA_RADIUS_MAX_METERS,
  ARENA_RADIUS_MIN_METERS,
  VOXEL_SIZE_MAX_METERS,
  VOXEL_SIZE_MIN_METERS,
  estimateFieldInstancesForPreset,
  isQualityId,
  type QualityPreset
} from "./qualityPresets";
import { RippleField } from "./rippleField";
import type { FieldPlacementClipper } from "./rippleFieldLayout";
import { RippleSourceStore, type RippleRenderSourceSnapshot, type RippleSourceOptions } from "./rippleSources";
import { RaceTrack } from "./raceTrack";
import { resolveRendererMode } from "./render/rendererMode";
import { ThreeRenderRuntime } from "./render/threeRenderRuntime";
import {
  RENDER_SCENE_LOCAL_LIGHT_LIMIT,
  RENDER_SCENE_SHADOW_CASTER_LIMIT,
  type RenderAvatarPresentationSnapshot,
  type RenderFrameInput,
  type RenderRaceTrackSnapshot,
  type RenderRuntimeStats,
  type RenderSceneLightingSnapshot,
  type RenderSceneLocalLightSnapshot,
  type RenderSceneShadowCasterSnapshot,
  type RenderSceneShadowSnapshot,
  type RenderVector3Snapshot
} from "./render/types";
import { WebGpuRenderRuntime } from "./render/webGpuRenderRuntime";
import { WEBGPU_MOTE_AVATAR_ASSET_ID } from "./render/webGpuMoteAvatarAsset";
import { probeWebGpuAvailability } from "./render/webGpuProbe";
import { SKYBOX_OPTIONS, SkyboxManager, getSkyboxOption, isSkyboxId } from "./skybox";
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
const PLAYER_START_HEIGHT = 1.75;
const TRACK_FIELD_SAFETY_SKIRT_METERS = 10;
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
const WEBGPU_BLOOM_STRENGTH_CAP = 0.32;
const WEBGPU_CONTACT_SHADOW_STRENGTH = 0.34;
const WEBGPU_CONTACT_SHADOW_SOFTNESS = 1.08;
const WEBGPU_READINESS_TIER = "diagnostic-core";
const WEBGPU_DEFAULT_ELIGIBLE = false;
const WEBGPU_REMAINING_GAPS: string[] = [];
const RACE_TRACK_FIELD_STRENGTH = 1;
const RACE_TRACK_ECHO_SEED_FRACTIONS = [0.02, 0.11, 0.22];
const GLOBAL_FRAME_HITCH_LOG_INTERVAL_SECONDS = 0.75;
const GLOBAL_FRAME_HITCH_WARMUP_SECONDS = 1;
const RENDERER_FRAME_SAMPLE_SECONDS = 0.5;
const FIELD_REBUILD_DEBOUNCE_MS = 180;
const DIAGNOSTIC_WEBGPU_PULSE_PERIOD_SECONDS = 4.4;
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
const DIAGNOSTIC_WEBGPU_CAMERA_FOV_DEGREES = 54;
const DIAGNOSTIC_WEBGPU_CAMERA_NEAR = 0.1;
const DIAGNOSTIC_WEBGPU_CAMERA_FAR = 450;
const WEBGPU_SCENE_STATE_FRAME_LOG_SECONDS = 0.5;
const WEBGPU_DEFAULT_READINESS_FRAME_LOG_SECONDS = 2;
const WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS = 90;
// A low visual floor remains while the playable surface is still planar. The
// upcoming sphere pass can delete or replace this without touching RippleField.
const STAGE_FLOOR_Y = -3.2;
const KEY_LIGHT_SOURCE_COLOR = 0xbcecff;
const RIM_LIGHT_SOURCE_COLOR = 0xff7de7;

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

type PlayModeId = "arena" | "track";
type WebGpuStateMode = "playable" | "diagnostic-demo";

const DISABLED_RACE_TRACK_MASK = new Uint8Array([0, 0, 0, 255]);
const DISABLED_RACE_TRACK_SNAPSHOT: RenderRaceTrackSnapshot = {
  enabled: false,
  strength: 0,
  fieldRadius: 1,
  trackWidthMeters: 0,
  sceneUnitsPerMeter: 1,
  mask: {
    width: 1,
    height: 1,
    version: 0,
    rgba: DISABLED_RACE_TRACK_MASK
  }
};

const rendererModeSelection = resolveRendererMode();

function readRequestedPlayMode(): PlayModeId | null {
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  return requestedMode === "arena" || requestedMode === "track" ? requestedMode : null;
}

function createRaceTrackSnapshot(playMode: PlayModeId | "none", raceTrack: RaceTrack | null): RenderRaceTrackSnapshot {
  if (playMode !== "track" || !raceTrack) return DISABLED_RACE_TRACK_SNAPSHOT;

  return {
    enabled: true,
    strength: RACE_TRACK_FIELD_STRENGTH,
    fieldRadius: raceTrack.getFieldRadius(),
    trackWidthMeters: raceTrack.getTrackWidthMeters(),
    sceneUnitsPerMeter: raceTrack.getSceneUnitsPerMeter(),
    mask: raceTrack.getMaskSnapshot()
  };
}

function createTrackSpawnPoint(track: RaceTrack): { readonly position: THREE.Vector3; readonly facingYaw: number } {
  const point = track.samplePointAt(0);
  return {
    position: new THREE.Vector3(point.x, sampleFieldHeight(point.x, point.z) + PLAYER_START_HEIGHT, point.z),
    facingYaw: track.getFacingYawAt(0)
  };
}

function vectorSnapshot(vector: THREE.Vector3): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z
  };
}

function createViewProjectionSnapshot(camera: THREE.Camera): readonly number[] {
  camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return [...viewProjection.elements];
}

function createRenderSettingsSnapshot(renderSettings: ReturnType<typeof cloneDefaultSettings>): RenderFrameInput["settings"] {
  return {
    rippleHeight: renderSettings.rippleHeight,
    rippleRadius: renderSettings.rippleRadius,
    playerSpeed: { ...renderSettings.playerSpeed },
    surfaceGrip: renderSettings.surfaceGrip,
    voxelSizeMeters: renderSettings.voxelSizeMeters,
    arenaRadiusMeters: renderSettings.arenaRadiusMeters,
    waveMedium: { ...renderSettings.waveMedium },
    particleDensity: renderSettings.particleDensity,
    particlesEnabled: renderSettings.particlesEnabled,
    bloomStrength: getDiagnosticBloomStrength(renderSettings),
    bloomEnabled: renderSettings.bloomEnabled
  };
}

function createScenePresentationSnapshot(
  renderSettings: ReturnType<typeof cloneDefaultSettings>,
  nextPreset: QualityPreset
): RenderFrameInput["scenePresentation"] {
  const skybox = getSkyboxOption(renderSettings.skyboxId);
  const postGlowStrength = getDiagnosticBloomStrength(renderSettings);

  return {
    mode: "webgpu-core-scene",
    arenaRadius: nextPreset.fieldRadius,
    skyboxId: skybox.id,
    skybox,
    postGlowEnabled: postGlowStrength > 0,
    postGlowStrength
  };
}

function createAvatarPresentationSnapshot(playerSnapshot: {
  readonly position: RenderVector3Snapshot;
  readonly facingYawRadians: number;
  readonly speed: number;
  readonly groundContact: number;
}): RenderAvatarPresentationSnapshot {
  const motionGlow = THREE.MathUtils.clamp(playerSnapshot.speed / 18, 0, 1);

  return {
    mode: "hover-pod",
    position: playerSnapshot.position,
    facingYawRadians: playerSnapshot.facingYawRadians,
    speed: playerSnapshot.speed,
    groundContact: playerSnapshot.groundContact,
    coreRadius: 0.72,
    glowRadius: 1.28 + motionGlow * 0.12,
    glowStrength: 0.58 + motionGlow * 0.22,
    assetId: "webgpu-hover-pod",
    moteAssetId: WEBGPU_MOTE_AVATAR_ASSET_ID,
    bodyLength: 1.5 + motionGlow * 0.14,
    bodyWidth: 0.95,
    bodyHeight: 0.44,
    noseLength: 0.82,
    tailLength: 1.18 + motionGlow * 0.34,
    thrusterGlow: 0.68 + motionGlow * 0.32,
    finGlow: 0.34 + motionGlow * 0.11,
    primaryColor: { x: 0.4, y: 0.96, z: 0.87 },
    secondaryColor: { x: 0.16, y: 0.72, z: 0.92 },
    accentColor: { x: 0.72, y: 1, z: 0.95 }
  };
}

function createSceneLightingSnapshot(
  time: number,
  settings: ReturnType<typeof cloneDefaultSettings>,
  playerSnapshot: {
    readonly position: RenderVector3Snapshot;
    readonly speed: number;
    readonly groundContact: number;
  },
  pulseSources: RippleRenderSourceSnapshot,
  echoVisualState: EchoVisualStateSnapshot
): RenderSceneLightingSnapshot {
  const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
  const localLights: RenderSceneLocalLightSnapshot[] = [];
  const bloomScale = settings.bloomEnabled ? 1 + getDiagnosticBloomStrength(settings) * 0.65 : 1;

  localLights.push({
    kind: "avatar",
    position: {
      x: playerSnapshot.position.x,
      y: playerSnapshot.position.y + 1.1,
      z: playerSnapshot.position.z
    },
    color: { x: 0.34, y: 1, z: 0.82 },
    intensity: (0.58 + Math.min(1, playerSnapshot.speed / 24) * 0.32) * bloomScale,
    radius: 8.5 + playerSnapshot.groundContact * 2.5,
    importance: 120
  });

  for (const event of echoVisualState.collectionEvents) {
    const age = Math.max(0, event.age);
    const fade = Math.max(0, 1 - age / 1.06);
    localLights.push({
      kind: "echo-burst",
      position: {
        x: event.positionX,
        y: event.effectPositionY,
        z: event.positionZ
      },
      color: { x: 1, y: 0.72, z: 0.34 },
      intensity: event.burstStrength * fade * 1.15 * bloomScale,
      radius: Math.max(4, event.discBurstRadius * 0.55),
      importance: 105 - age * 8
    });
  }

  for (const echo of echoVisualState.echoes) {
    const shimmer = 0.72 + 0.28 * Math.sin(time * 4.8 + echo.phase);
    localLights.push({
      kind: "echo",
      position: {
        x: echo.positionX,
        y: echo.positionY + 3.2,
        z: echo.positionZ
      },
      color: { x: 0.34, y: 0.95, z: 0.74 },
      intensity: (0.32 + shimmer * 0.28) * bloomScale,
      radius: Math.max(6, echo.triggerRadius * 1.35),
      importance: 70 + shimmer * 8
    });
  }

  for (const source of pulseSources.sources) {
    const age = Math.max(0, time - source.startTime);
    const lifetime = Math.max(0.2, source.lifetimeSeconds);
    const fade = Math.max(0, 1 - age / lifetime);
    if (fade <= 0.001) continue;

    const pulse = Math.sin(age * 9) * 0.5 + 0.5;
    const color = mixRenderColor(
      { x: 0.16, y: 0.95, z: 0.92 },
      { x: 1, y: 0.62, z: 0.24 },
      THREE.MathUtils.clamp(source.hue, 0, 1)
    );
    localLights.push({
      kind: "pulse",
      position: {
        x: source.positionX,
        y: 1.8 + pulse * 0.65,
        z: source.positionZ
      },
      color,
      intensity: source.strength * fade * (0.48 + pulse * 0.7) * bloomScale,
      radius: 5.8 + age * basePropagationSpeed * Math.max(0.05, source.speedMultiplier) * 0.42,
      importance: 88 - age * 7 + source.strength * 12
    });
  }

  localLights.sort((a, b) => b.importance - a.importance);

  return {
    ambientColor: { x: 0.035, y: 0.066, z: 0.075 },
    ambientIntensity: 0.42,
    keyDirection: normalizeRenderVector({ x: -0.26, y: 0.82, z: 0.48 }),
    keyColor: colorSnapshot(KEY_LIGHT_SOURCE_COLOR),
    keyIntensity: 0.58,
    rimDirection: normalizeRenderVector({ x: 0.46, y: 0.52, z: -0.72 }),
    rimColor: colorSnapshot(RIM_LIGHT_SOURCE_COLOR),
    rimIntensity: 0.28,
    activeLocalLights: localLights.length,
    localLightLimit: RENDER_SCENE_LOCAL_LIGHT_LIMIT,
    localLights: localLights.slice(0, RENDER_SCENE_LOCAL_LIGHT_LIMIT)
  };
}

function createSceneShadowSnapshot(
  time: number,
  playerSnapshot: {
    readonly position: RenderVector3Snapshot;
    readonly speed: number;
    readonly groundContact: number;
  },
  avatarPresentation: RenderAvatarPresentationSnapshot,
  pulseSources: RippleRenderSourceSnapshot,
  echoVisualState: EchoVisualStateSnapshot
): RenderSceneShadowSnapshot {
  const casters: RenderSceneShadowCasterSnapshot[] = [];

  casters.push({
    kind: "avatar",
    position: {
      x: playerSnapshot.position.x,
      y: playerSnapshot.position.y + 0.08,
      z: playerSnapshot.position.z
    },
    radius: 3.9 + Math.min(1, playerSnapshot.speed / 22) * 1.25,
    height: 3.6,
    strength: 0.13 + playerSnapshot.groundContact * 0.13,
    softness: 1.02,
    shadowMapProxy: {
      shape: "orb",
      radius: Math.max(0.48, avatarPresentation.coreRadius * 0.78),
      height: Math.max(1.05, avatarPresentation.glowRadius * 1.1),
      strength: 0.34 + avatarPresentation.groundContact * 0.14
    },
    importance: 130
  });

  for (const echo of echoVisualState.echoes) {
    const shimmer = 0.86 + 0.14 * Math.sin(time * 4.2 + echo.phase);
    casters.push({
      kind: "echo",
      position: {
        x: echo.positionX,
        y: echo.positionY + 0.2,
        z: echo.positionZ
      },
      radius: Math.max(5.8, echo.columnRadius * 5.2),
      height: Math.max(7.6, echo.columnRadius * 9.5),
      strength: 0.12 + shimmer * 0.08,
      softness: 1.28,
      shadowMapProxy: {
        shape: "column",
        radius: Math.max(1.05, echo.columnRadius * 1.18),
        height: Math.max(5.8, echo.columnRadius * 6.2),
        strength: 0.22 + shimmer * 0.1
      },
      importance: 94 + shimmer * 6
    });
  }

  for (const event of echoVisualState.collectionEvents) {
    const age = Math.max(0, event.age);
    const fade = Math.max(0, 1 - age / 1.06);
    if (fade <= 0.001) continue;

    casters.push({
      kind: "echo-burst",
      position: {
        x: event.positionX,
        y: event.positionY + 0.15,
        z: event.positionZ
      },
      radius: Math.max(4.8, event.discBurstRadius * 0.72),
      height: Math.max(2.6, event.discBurstRadius * 0.42),
      strength: event.burstStrength * fade * 0.18,
      softness: 1.55,
      shadowMapProxy: {
        shape: "disc",
        radius: Math.max(1.1, event.discBurstRadius * 0.32),
        height: Math.max(0.32, event.discBurstRadius * 0.08),
        strength: event.burstStrength * fade * 0.2
      },
      importance: 108 - age * 12
    });
  }

  for (const source of pulseSources.sources) {
    const age = Math.max(0, time - source.startTime);
    const lifetime = Math.max(0.2, source.lifetimeSeconds);
    const fade = Math.max(0, 1 - age / lifetime);
    if (fade <= 0.001) continue;

    casters.push({
      kind: "pulse",
      position: {
        x: source.positionX,
        y: 0.24,
        z: source.positionZ
      },
      radius: 3.4 + age * Math.max(0.05, source.speedMultiplier) * 2.1,
      height: 1.6 + Math.min(2.4, age * 0.5),
      strength: source.strength * fade * 0.11,
      softness: 1.42,
      shadowMapProxy: {
        shape: "disc",
        radius: Math.max(0.9, 0.52 + age * Math.max(0.05, source.speedMultiplier) * 0.5),
        height: 0.42,
        strength: source.strength * fade * 0.16
      },
      importance: 72 - age * 8 + source.strength * 9
    });
  }

  casters.sort((a, b) => b.importance - a.importance);

  return {
    mode: "shadow-map-contact",
    strength: WEBGPU_CONTACT_SHADOW_STRENGTH,
    softness: WEBGPU_CONTACT_SHADOW_SOFTNESS,
    activeCasters: casters.length,
    casterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
    casters: casters.slice(0, RENDER_SCENE_SHADOW_CASTER_LIMIT)
  };
}

function getDiagnosticBloomStrength(renderSettings: ReturnType<typeof cloneDefaultSettings>): number {
  return renderSettings.bloomEnabled ? Math.min(renderSettings.bloomStrength, WEBGPU_BLOOM_STRENGTH_CAP) : 0;
}

function colorSnapshot(colorHex: number): RenderVector3Snapshot {
  const color = new THREE.Color(colorHex);
  return { x: color.r, y: color.g, z: color.b };
}

function mixRenderColor(
  start: RenderVector3Snapshot,
  end: RenderVector3Snapshot,
  amount: number
): RenderVector3Snapshot {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    z: start.z + (end.z - start.z) * amount
  };
}

function normalizeRenderVector(vector: RenderVector3Snapshot): RenderVector3Snapshot {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function seedStartupPulseSources(addPulse: (position: THREE.Vector3, strength: number) => void): void {
  addPulse(new THREE.Vector3(0, sampleFieldHeight(0, 0) + 0.45, 0), 0.28);
  addPulse(new THREE.Vector3(9, sampleFieldHeight(9, -7) + 0.45, -7), 0.18);
}

function isFieldStressModeEnabledForRuntime(): boolean {
  const queryValue = new URLSearchParams(window.location.search).get("stress");
  let storedValue: string | null = null;
  try {
    storedValue = window.localStorage.getItem("rippleStressMode");
  } catch {
    storedValue = null;
  }
  return queryValue === "1" || storedValue === "1";
}

if (rendererModeSelection.requestedMode === "webgpu") {
  void startWebGpuDiagnosticApp();
} else {
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020409);
const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
const clock = new THREE.Clock();
const settings = cloneDefaultSettings();
const fieldStressModeEnabled = isFieldStressModeEnabled();
let preset = getQualityPreset(settings);
const activePlayMode: PlayModeId = readRequestedPlayMode() ?? "arena";
const renderRuntime = new ThreeRenderRuntime({
  app,
  scene,
  camera,
  initialBloomStrength: settings.bloomStrength,
  fallbackReason: rendererModeSelection.fallbackReason
});
const renderer = renderRuntime.renderer;
const skybox = new SkyboxManager(scene, renderer);
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
let lastRendererFrameSampleAt = -Infinity;
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

const rippleSources = new RippleSourceStore();
const echoZoneState = new EchoZoneStateStore();
const echoZones = new EchoZoneField(scene, echoZoneState);
const wakeField = new WakeField(renderer, preset);
const rippleField = new RippleField(scene, preset, wakeField.supportsVertexTextureSampling());
const raceTrack = new RaceTrack(scene, preset.fieldRadius, settings.arenaRadiusMeters);
let particles = new ParticleVeil(scene, preset.particleBudget, getPixelRatio());
let pulseLights = new PulseLightRig(scene, preset.pulseLightCount);

const avatar = createAvatar();
scene.add(avatar.object);

const player = new PlayerRig({
  canvas: renderRuntime.canvas,
  camera,
  sampleHeight: sampleFieldHeight,
  getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
  playAreaConstraint: activePlayMode === "track" ? raceTrack : null,
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
applyInitialPlayMode(activePlayMode, raceTrack, player);
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
reportRendererMode();
void probeRequestedWebGpu();
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.visualViewport?.addEventListener("scroll", resize);

// Seed a few pulses so the first rendered second already has motion and bloom.
seedStartupPulseSources((position, strength) => spawnPulse(position, strength));
seedEchoZones(clock.elapsedTime);
echoZoneState.logInit(clock.elapsedTime);

renderRuntime.setAnimationLoop(animate);

function animate(): void {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 24);
  const time = clock.elapsedTime;
  lastRawDeltaMs = rawDelta * 1000;
  const frameStartedAt = performance.now();
  player.update(delta);
  const playerSpeed = player.getSpeed();
  const playerGroundContact = player.getGroundContactStrength();
  avatar.update(delta, player.position, playerSpeed);
  if (settings.particlesEnabled) {
    particles.spawnAura(player.position, delta, playerSpeed / 18);
    particles.spawnWake(player.position, (playerSpeed / 18) * playerGroundContact, player.velocity);
  }
  arenaBarrier.update(time);
  updateSceneLightSourceVisuals(time);
  echoZones.update(time);
  collectEchoZones(time);
  maybeSpawnEchoZone(time);
  echoZoneState.maybeLogFrame(time);
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
  const renderStartedAt = performance.now();
  lastFrameUpdateMs = renderStartedAt - frameStartedAt;
  renderRuntime.beginFrame();
  const pulseSourceSnapshot = rippleSources.getRenderSourceSnapshot(
    time,
    rippleField.getRecommendedRenderSourceLimit()
  );
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
    activeRippleSourceCount: pulseSourceSnapshot.activeCount,
    renderedRippleSourceCount: pulseSourceSnapshot.renderedCount,
    hexCount: rippleField.getInstanceCount(),
    qualityId: preset.id
  });
  const wakeMetrics = wakeField.getMetrics();
  rippleField.update(
    time,
    getEffectiveRenderSettings(),
    preset,
    pulseSourceSnapshot,
    player.position,
    player.velocity,
    playerSpeed,
    playerGroundContact,
    wakeField.getTexture(),
    wakeMetrics,
    getActiveTrackTexture(),
    preset.fieldRadius,
    getActiveTrackStrength()
  );
  renderRuntime.renderFrame(createRenderInput(time, delta, effectiveBloomStrength, pulseSourceSnapshot));
  lastFrameRenderMs = performance.now() - renderStartedAt;
  maybeLogRendererFrameSample(time, delta, rawDelta, frameStartedAt);
  previousWakePlayerPosition.copy(player.position);
  updateStats(delta, time);
  logGlobalFrameHitch(time, delta, rawDelta, frameStartedAt);
  logEchoDetonationFrame(time, delta, frameStartedAt);
}

function reportRendererMode(): void {
  const stats = renderRuntime.getStats();
  const trackSnapshot = createRaceTrackSnapshot(activePlayMode, raceTrack);
  debugEvent("renderer.mode", "Renderer mode selected", {
    requestedMode: rendererModeSelection.requestedMode,
    selectionSource: rendererModeSelection.source,
    activeBackend: stats.backendId,
    playMode: activePlayMode,
    raceTrackEnabled: trackSnapshot.enabled,
    raceTrackStrength: roundMetric(trackSnapshot.strength),
    trackFieldRadius: roundMetric(trackSnapshot.fieldRadius),
    trackWidthMeters: roundMetric(trackSnapshot.trackWidthMeters),
    raceTrackMaskWidth: trackSnapshot.mask.width,
    raceTrackMaskHeight: trackSnapshot.mask.height,
    raceTrackMaskVersion: trackSnapshot.mask.version,
    trackMaskUploaded: trackSnapshot.enabled && trackSnapshot.mask.version > 0,
    arenaBarrierEnabled: activePlayMode !== "track",
    fieldLayoutMode: trackSnapshot.enabled ? rippleField.getBuildStats().mode : "arena-full",
    culledHexCount: rippleField.getBuildStats().culledHexCount,
    fallbackReason: rendererModeSelection.fallbackReason,
    maxTextureSize: renderRuntime.capabilities.maxTextureSize,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights
  }, rendererModeSelection.requestedMode === "webgpu" ? "warn" : "info");
}

async function probeRequestedWebGpu(): Promise<void> {
  if (rendererModeSelection.requestedMode !== "webgpu") return;

  try {
    const result = await probeWebGpuAvailability(debugEvent);
    debugEvent("webgpu.fallback", "WebGPU boot probe completed; WebGL remains the visual backend for this slice", {
      ok: result.ok,
      adapter: result.adapterSummary,
      preferredFormat: result.format,
      probePixelRatio: result.pixelRatio,
      probePresentationWidth: result.presentationWidth,
      probePresentationHeight: result.presentationHeight,
      firstFrameSubmitMs: result.firstFrameSubmitMs,
      message: result.message,
      activeBackend: renderRuntime.backendId,
      fallbackReason: rendererModeSelection.fallbackReason
    }, result.ok ? "warn" : "error");
  } catch (error) {
    debugEvent("webgpu.fallback", "WebGPU boot probe failed; WebGL remains the visual backend", {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      activeBackend: renderRuntime.backendId,
      fallbackReason: rendererModeSelection.fallbackReason
    }, "error");
  }
}

function applyInitialPlayMode(mode: PlayModeId, track: RaceTrack, rig: PlayerRig): void {
  track.setVisible(mode === "track");
  rig.setPlayAreaConstraint(mode === "track" ? track : null);
  if (mode !== "track") return;

  const start = createTrackSpawnPoint(track);
  rig.resetForSession(start.position, start.facingYaw);
  debugEvent("mode.select", "Started Ripple Field Lab play mode from URL", {
    mode,
    reason: "url",
    trackWidthMeters: roundMetric(track.getTrackWidthMeters()),
    sceneUnitsPerMeter: roundMetric(track.getSceneUnitsPerMeter()),
    playerPosition: vectorPayload(start.position)
  }, "info");
}

function syncRaceTrackArena(nextPreset: QualityPreset, reason: string): void {
  raceTrack.setArena(nextPreset.fieldRadius, settings.arenaRadiusMeters, reason);
  raceTrack.setVisible(activePlayMode === "track");
  player.setPlayAreaConstraint(activePlayMode === "track" ? raceTrack : null);
}

function getActiveFieldPlacementClipper(nextPreset: QualityPreset): FieldPlacementClipper | null {
  if (activePlayMode !== "track") return null;

  const safetySkirtSceneUnits =
    TRACK_FIELD_SAFETY_SKIRT_METERS * raceTrack.getSceneUnitsPerMeter() + nextPreset.tileSpacing * 2;
  return {
    label: "race-track-ribbon",
    containsPoint: (x, z) => raceTrack.containsPoint(x, z, safetySkirtSceneUnits)
  };
}

function getActiveTrackTexture(): THREE.Texture {
  return activePlayMode === "track" ? raceTrack.getMaskTexture() : rippleField.getNoOpTrackTexture();
}

function getActiveTrackStrength(): number {
  return activePlayMode === "track" ? RACE_TRACK_FIELD_STRENGTH : 0;
}

function createRenderInput(
  time: number,
  delta: number,
  bloomStrength: number,
  pulseSources: RippleRenderSourceSnapshot
): RenderFrameInput {
  const viewport = getViewportSize();
  const renderSettings = getEffectiveRenderSettings();
  const playerSnapshot = {
    previousPosition: vectorSnapshot(previousWakePlayerPosition),
    position: vectorSnapshot(player.position),
    velocity: vectorSnapshot(player.velocity),
    speed: player.velocity.length(),
    groundContact: player.getGroundContactStrength(),
    facingYawRadians: player.getFacingYaw()
  };
  const echoVisualState = echoZoneState.getRenderSnapshot(time);
  const avatarPresentation = createAvatarPresentationSnapshot(playerSnapshot);

  return {
    time,
    delta,
    playMode: activePlayMode,
    raceTrack: createRaceTrackSnapshot(activePlayMode, raceTrack),
    viewport: {
      width: viewport.width,
      height: viewport.height,
      pixelRatio: getPixelRatio()
    },
    camera: {
      position: vectorSnapshot(camera.position),
      quaternion: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w
      },
      viewProjectionMatrix: createViewProjectionSnapshot(camera),
      projection: {
        mode: "perspective",
        cameraMode: "playable",
        near: camera.near,
        far: camera.far,
        fovDegrees: camera.fov,
        aspect: camera.aspect
      }
    },
    player: playerSnapshot,
    scenePresentation: createScenePresentationSnapshot(renderSettings, preset),
    avatarPresentation,
    sceneLighting: createSceneLightingSnapshot(time, renderSettings, playerSnapshot, pulseSources, echoVisualState),
    sceneShadows: createSceneShadowSnapshot(time, playerSnapshot, avatarPresentation, pulseSources, echoVisualState),
    settings: createRenderSettingsSnapshot(renderSettings),
    qualityPreset: { ...preset },
    pulseSources,
    echoVisualState,
    particleState: particles.getSnapshot(),
    bloomStrength
  };
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
  if (activePlayMode === "track") {
    const first = raceTrack.samplePointAt(0.02, -raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.12);
    const second = raceTrack.samplePointAt(0.11, raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.18);
    addEchoZoneAtPosition(first.setY(sampleFieldHeight(first.x, first.z) + 0.16), time);
    addEchoZoneAtPosition(second.setY(sampleFieldHeight(second.x, second.z) + 0.16), time);

    for (let index = 2; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
      const fraction = RACE_TRACK_ECHO_SEED_FRACTIONS[index] ?? 0.22 + index * 0.09;
      const lateralOffsetMeters = (index % 2 === 0 ? 1 : -1) *
        raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.28;
      if (!spawnEchoZoneAtTrackFraction(time, fraction, lateralOffsetMeters)) {
        spawnEchoZone(time);
      }
    }

    nextEchoZoneAt = time + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
    return;
  }

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

function spawnEchoZoneAtTrackFraction(time: number, fraction: number, lateralOffsetMeters: number): boolean {
  const position = raceTrack.samplePointAt(fraction, lateralOffsetMeters);
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
  if (activePlayMode === "track") {
    const maxJitterMeters = raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS);
    for (let attempt = 0; attempt < ECHO_ZONE_SPAWN_ATTEMPTS; attempt += 1) {
      const position = raceTrack.samplePointAt(
        Math.random(),
        (Math.random() * 2 - 1) * maxJitterMeters
      );
      const playerDistance = Math.hypot(position.x - player.position.x, position.z - player.position.z);
      if (playerDistance < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
      if (!echoZones.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;

      position.y = sampleFieldHeight(position.x, position.z) + 0.16;
      return position;
    }

    debugEvent("track.echoPlacement", "Failed to find a clear Echo position on the race track", {
      attempts: ECHO_ZONE_SPAWN_ATTEMPTS,
      activeEchoes: echoZones.getActiveCount(),
      trackWidthMeters: roundMetric(raceTrack.getTrackWidthMeters())
    }, "warn");
    return null;
  }

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
  const pointerIsLockedToScene = document.pointerLockElement === renderRuntime.canvas;
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
    if (document.pointerLockElement === renderRuntime.canvas) {
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
  syncRaceTrackArena(nextPreset, "field-rebuild");
  rippleField.rebuild(nextPreset, getActiveFieldPlacementClipper(nextPreset));
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
  renderRuntime.applyQualityPreset(nextPreset, getEffectiveBloomStrength());
  updateSceneFog(nextPreset);
  syncRaceTrackArena(nextPreset, initial ? "initial" : "quality");

  if (!initial || activePlayMode === "track") {
    wakeField.resizeForPreset(nextPreset, "quality");
    rebuildFieldGeometry(nextPreset);
  }

  if (!initial) {
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
  renderRuntime.prewarm();
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
  statsLine.textContent = `${Math.round(measuredFps)} fps | ${activePlayMode} | ${rippleField.getInstanceCount().toLocaleString()} hexes | ${preset.particleBudget.toLocaleString()} particles`;
  mediumLine.textContent = `${basePropagationSpeed.toFixed(1)} m/s | ${settings.waveMedium.effectiveDepth.toFixed(1)}m depth | ${formatVoxelSize(settings.voxelSizeMeters)} hex dia | ${settings.arenaRadiusMeters.toFixed(0)}m arena | track ${activePlayMode === "track" ? `${raceTrack.getTrackWidthMeters().toFixed(0)}m` : "off"} | ${echoZones.getActiveCount()} echoes | ${activeSources.length} pulses | newest ${newestRingRadius.toFixed(1)}m`;
  updatePerfOverlay(activeSources.length);
}

function updatePerfOverlay(activeSourceCount: number): void {
  const renderedSourceCount = rippleField.getRenderedRippleSourceCount();
  const renderedSourceLimit = rippleField.getRenderedRippleSourceLimit();
  const activeParticleCount = particles.getActiveCount();
  const rendererStats = renderRuntime.getStats();
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
  perfRenderer.textContent =
    `${rendererStats.backendId} | ${rendererStats.drawCalls}c | ${formatCompactCount(rendererStats.triangles)} tri | ${rendererStats.pixelRatio.toFixed(2)}x`;
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
  const rendererStats = renderRuntime.getStats();
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
    backendId: rendererStats.backendId,
    rendererPixelRatio: rendererStats.pixelRatio,
    rendererDrawCalls: rendererStats.drawCalls,
    rendererTriangles: rendererStats.triangles,
    rendererCpuSubmitMs: rendererStats.gpuCpuSubmitMs,
    rendererFallbackReason: rendererStats.fallbackReason,
    rendererDeviceLost: rendererStats.deviceLost,
    visibilityState: document.visibilityState
  });
  debugEvent(hitchEvent.channel, hitchEvent.message, hitchEvent.payload, "warn");
}

function maybeLogRendererFrameSample(time: number, delta: number, rawDelta: number, frameStartedAt: number): void {
  if (time - lastRendererFrameSampleAt < RENDERER_FRAME_SAMPLE_SECONDS) return;

  lastRendererFrameSampleAt = time;
  emitRendererFrameSample(renderRuntime.getStats(), {
    time,
    delta,
    rawDelta,
    frameMs: performance.now() - frameStartedAt,
    updateMs: lastFrameUpdateMs,
    renderMs: lastFrameRenderMs,
    viewport: getViewportSize(),
    playMode: activePlayMode,
    raceTrack: createRaceTrackSnapshot(activePlayMode, raceTrack)
  });
}

function resize(): void {
  const { width, height } = getViewportSize();
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  const pixelRatio = getPixelRatio();
  renderRuntime.resize(width, height, pixelRatio);
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

}

type RendererFrameSampleInput = {
  readonly time: number;
  readonly delta: number;
  readonly rawDelta: number;
  readonly frameMs: number;
  readonly updateMs: number;
  readonly renderMs: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly playMode?: RenderFrameInput["playMode"];
  readonly raceTrack?: RenderFrameInput["raceTrack"];
  readonly cameraMode?: "playable" | "diagnostic-orbit";
  readonly stateMode?: WebGpuStateMode;
  readonly scenePresentation?: RenderFrameInput["scenePresentation"];
  readonly avatarPresentation?: RenderFrameInput["avatarPresentation"];
  readonly settings?: RenderFrameInput["settings"];
  readonly qualityPreset?: QualityPreset;
};

function emitRendererFrameSample(stats: RenderRuntimeStats, input: RendererFrameSampleInput): void {
  const payload: RippleDebugPayload = {
    time: roundMetric(input.time),
    frameMs: roundMetric(input.frameMs),
    updateMs: roundMetric(input.updateMs),
    renderMs: roundMetric(input.renderMs),
    rawClockDeltaMs: roundMetric(input.rawDelta * 1000),
    cappedClockDeltaMs: roundMetric(input.delta * 1000),
    backendId: stats.backendId,
    pixelRatio: roundMetric(stats.pixelRatio),
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    gpuCpuSubmitMs: roundMetric(stats.gpuCpuSubmitMs),
    fallbackReason: stats.fallbackReason,
    deviceLost: stats.deviceLost,
    viewportWidth: input.viewport.width,
    viewportHeight: input.viewport.height
  };

  if (input.cameraMode) payload.cameraMode = input.cameraMode;
  if (input.stateMode) payload.stateMode = input.stateMode;
  if (input.playMode) {
    payload.playMode = input.playMode;
  }
  if (input.raceTrack) {
    payload.raceTrackEnabled = input.raceTrack.enabled;
    payload.raceTrackStrength = roundMetric(input.raceTrack.strength);
    payload.trackFieldRadius = roundMetric(input.raceTrack.fieldRadius);
    payload.trackWidthMeters = roundMetric(input.raceTrack.trackWidthMeters);
    payload.sceneUnitsPerMeter = roundMetric(input.raceTrack.sceneUnitsPerMeter);
    payload.raceTrackMaskWidth = input.raceTrack.mask.width;
    payload.raceTrackMaskHeight = input.raceTrack.mask.height;
    payload.raceTrackMaskVersion = input.raceTrack.mask.version;
    payload.trackMaskUploaded = input.raceTrack.enabled && input.raceTrack.mask.version > 0;
    payload.arenaBarrierEnabled = input.playMode !== "track";
    payload.fieldLayoutMode = input.raceTrack.enabled ? "track-mask-full-field" : "arena-full";
    payload.culledHexCount = 0;
  }
  if (typeof stats.trackMaskBodyCoverage === "number") {
    payload.trackMaskBodyCoverage = roundMetric(stats.trackMaskBodyCoverage);
  }
  if (typeof stats.trackMaskEdgeCoverage === "number") {
    payload.trackMaskEdgeCoverage = roundMetric(stats.trackMaskEdgeCoverage);
  }
  if (typeof stats.trackMaskCenterCoverage === "number") {
    payload.trackMaskCenterCoverage = roundMetric(stats.trackMaskCenterCoverage);
  }
  if (input.scenePresentation) {
    payload.scenePresentationMode = input.scenePresentation.mode;
    payload.skybox = input.scenePresentation.skyboxId;
    payload.arenaRadius = roundMetric(input.scenePresentation.arenaRadius);
    payload.postGlowEnabled = input.scenePresentation.postGlowEnabled;
    payload.postGlowStrength = roundMetric(input.scenePresentation.postGlowStrength);
  }
  if (input.avatarPresentation) {
    payload.avatarPresentationMode = input.avatarPresentation.mode;
    payload.avatarAssetId = input.avatarPresentation.assetId;
    payload.moteAvatarAssetId = input.avatarPresentation.moteAssetId;
    payload.avatarCoreRadius = roundMetric(input.avatarPresentation.coreRadius);
    payload.avatarGlowRadius = roundMetric(input.avatarPresentation.glowRadius);
    payload.avatarGlowStrength = roundMetric(input.avatarPresentation.glowStrength);
  }
  if (input.settings && input.qualityPreset) {
    Object.assign(payload, getWebGpuSettingsDiagnosticFields(input.settings, input.qualityPreset));
  }
  if (typeof stats.wakeMaxAbsHeight === "number") payload.wakeMaxAbsHeight = roundMetric(stats.wakeMaxAbsHeight);
  if (typeof stats.wakeMeanAbsHeight === "number") payload.wakeMeanAbsHeight = roundMetric(stats.wakeMeanAbsHeight);
  if (typeof stats.wakeMaxCrest === "number") payload.wakeMaxCrest = roundMetric(stats.wakeMaxCrest);
  if (typeof stats.wakeEnergyEstimate === "number") payload.wakeEnergyEstimate = roundMetric(stats.wakeEnergyEstimate);
  if (typeof stats.activeLocalLights === "number") payload.activeLocalLights = stats.activeLocalLights;
  if (typeof stats.renderedLocalLights === "number") payload.renderedLocalLights = stats.renderedLocalLights;
  if (typeof stats.echoVisualActiveEchoes === "number") payload.echoVisualActiveEchoes = stats.echoVisualActiveEchoes;
  if (typeof stats.echoVisualRenderedEchoes === "number") payload.echoVisualRenderedEchoes = stats.echoVisualRenderedEchoes;
  if (typeof stats.echoVisualActiveCollectionEvents === "number") {
    payload.echoVisualActiveCollectionEvents = stats.echoVisualActiveCollectionEvents;
  }
  if (typeof stats.echoVisualRenderedCollectionEvents === "number") {
    payload.echoVisualRenderedCollectionEvents = stats.echoVisualRenderedCollectionEvents;
  }
  if (typeof stats.echoVisualPassMs === "number") payload.echoVisualPassMs = roundMetric(stats.echoVisualPassMs);
  if (typeof stats.bloomMode === "string") payload.bloomMode = stats.bloomMode;
  if (typeof stats.bloomPasses === "number") payload.bloomPasses = stats.bloomPasses;
  if (typeof stats.bloomStrength === "number") payload.bloomStrength = roundMetric(stats.bloomStrength);
  if (typeof stats.bloomPassMs === "number") payload.bloomPassMs = roundMetric(stats.bloomPassMs);
  if (typeof stats.shadowMode === "string") payload.shadowMode = stats.shadowMode;
  if (typeof stats.activeShadowCasters === "number") payload.activeShadowCasters = stats.activeShadowCasters;
  if (typeof stats.renderedShadowCasters === "number") payload.renderedShadowCasters = stats.renderedShadowCasters;
  if (typeof stats.shadowCasterLimit === "number") payload.shadowCasterLimit = stats.shadowCasterLimit;
  if (typeof stats.shadowStrength === "number") payload.shadowStrength = roundMetric(stats.shadowStrength);
  if (typeof stats.shadowSoftness === "number") payload.shadowSoftness = roundMetric(stats.shadowSoftness);
  if (typeof stats.shadowUpdateMs === "number") payload.shadowUpdateMs = roundMetric(stats.shadowUpdateMs);
  if (typeof stats.shadowMapSize === "number") payload.shadowMapSize = stats.shadowMapSize;
  if (typeof stats.shadowMapFormat === "string") payload.shadowMapFormat = stats.shadowMapFormat;
  if (typeof stats.shadowMapPassMs === "number") payload.shadowMapPassMs = roundMetric(stats.shadowMapPassMs);
  if (typeof stats.shadowMapPcfTaps === "number") payload.shadowMapPcfTaps = stats.shadowMapPcfTaps;
  if (typeof stats.shadowMapLightBounds === "number") {
    payload.shadowMapLightBounds = roundMetric(stats.shadowMapLightBounds);
  }
  if (typeof stats.shadowGeometryMode === "string") payload.shadowGeometryMode = stats.shadowGeometryMode;
  if (typeof stats.shadowFieldReceiver === "boolean") payload.fieldReceiver = stats.shadowFieldReceiver;
  if (typeof stats.shadowMapRenderedOrbCasters === "number") {
    payload.renderedOrbCasters = stats.shadowMapRenderedOrbCasters;
  }
  if (typeof stats.shadowMapRenderedColumnCasters === "number") {
    payload.renderedColumnCasters = stats.shadowMapRenderedColumnCasters;
  }
  if (typeof stats.shadowMapRenderedDiscCasters === "number") {
    payload.renderedDiscCasters = stats.shadowMapRenderedDiscCasters;
  }
  if (typeof stats.shadowMapProxyTriangles === "number") {
    payload.shadowMapProxyTriangles = stats.shadowMapProxyTriangles;
  }
  if (stats.backendId === "webgpu") {
    payload.readinessTier = WEBGPU_READINESS_TIER;
    payload.defaultEligible = WEBGPU_DEFAULT_ELIGIBLE;
    payload.remainingGaps = [...WEBGPU_REMAINING_GAPS];
    payload.supportsBloom = true;
    payload.supportsLocalLights = true;
  }

  debugEvent("renderer.frameSample", "Renderer frame sample", payload, "debug");
}

async function startWebGpuDiagnosticApp(): Promise<void> {
  const stateMode: WebGpuStateMode = isWebGpuDemoMode() ? "diagnostic-demo" : "playable";
  const activePlayMode: PlayModeId | "none" = stateMode === "playable" ? readRequestedPlayMode() ?? "arena" : "none";
  const settings = cloneDefaultSettings();
  let preset = getQualityPreset(settings);
  const webGpuFieldStressModeEnabled = isFieldStressModeEnabledForRuntime();
  const clock = new THREE.Clock();
  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
  const rippleSources = new RippleSourceStore();
  let particleState = new ParticleVeilState(stateMode === "playable" ? preset.particleBudget : Math.min(4096, preset.particleBudget));
  const echoZoneState = stateMode === "playable" ? new EchoZoneStateStore() : null;
  const raceTrack = stateMode === "playable" ? new RaceTrack(null, preset.fieldRadius, settings.arenaRadiusMeters) : null;
  const previousPlayerPosition = new THREE.Vector3();
  let player: PlayerRig | null = null;
  let nextEchoZoneAt = 0.8;
  let lastRendererFrameSampleAt = -Infinity;
  let lastSceneStateFrameAt = -Infinity;
  let lastDefaultReadinessFrameAt = -Infinity;
  let lastDefaultReadinessSummaryAt = -Infinity;
  let diagnosticFieldRebuildTimeoutId = 0;

  try {
    const renderRuntime = await WebGpuRenderRuntime.create({
      app,
      log: debugEvent,
      fallbackReason: "",
      initialQualityPreset: preset,
      initialSkyboxId: settings.skyboxId
    });

    const collectDiagnosticRuntimeSettingsPayload = (reason?: "quality" | "field-scale"): RippleDebugPayload => ({
      ...(reason ? { runtimeApplyReason: reason } : {}),
      fieldInstanceCount: renderRuntime.getFieldMetrics().instanceCount,
      wakeTextureSize: renderRuntime.getWakeMetrics().textureSize
    });

    const applyDiagnosticFieldScale = (changedControl: FieldScaleChangedControl): RippleDebugPayload => {
      const guardrailResult = applyFieldInstanceBudget(settings, changedControl, webGpuFieldStressModeEnabled);
      preset = getQualityPreset(settings);
      raceTrack?.setArena(preset.fieldRadius, settings.arenaRadiusMeters, "webgpu-field-scale");

      if (diagnosticFieldRebuildTimeoutId !== 0) {
        window.clearTimeout(diagnosticFieldRebuildTimeoutId);
      }

      diagnosticFieldRebuildTimeoutId = window.setTimeout(() => {
        diagnosticFieldRebuildTimeoutId = 0;
        renderRuntime.applyQualityPreset(preset, getDiagnosticBloomStrength(settings), "field-scale");
        resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined);
        applyDiagnosticUiState(renderRuntime, clock.elapsedTime, 0, 0, stateMode, settings);
      }, FIELD_REBUILD_DEBOUNCE_MS);

      return {
        ...getWebGpuFieldScaleGuardrailDiagnostics(guardrailResult),
        ...collectDiagnosticRuntimeSettingsPayload("field-scale")
      };
    };

    if (stateMode === "playable") {
      player = new PlayerRig({
        canvas: renderRuntime.canvas,
        camera,
        sampleHeight: sampleFieldHeight,
        getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
        playAreaConstraint: activePlayMode === "track" ? raceTrack : null,
        onPulse: (position) => spawnWebGpuPulse(rippleSources, particleState, position, clock.elapsedTime, 0.45, settings, preset),
        onJump: (event) => addWebGpuJumpRipple(rippleSources, particleState, event, clock.elapsedTime, JUMP_TAKEOFF_OPTIONS, "Player jumped from field surface", settings, preset),
        onLand: (event) => addWebGpuJumpRipple(rippleSources, particleState, event, clock.elapsedTime, JUMP_LANDING_OPTIONS, "Player landed on field surface", settings, preset),
        speedSettings: settings.playerSpeed,
        surfaceGrip: settings.surfaceGrip,
        isInputEnabled: areDiagnosticInputsEnabled
      });
      if (activePlayMode === "track" && raceTrack) {
        const start = createTrackSpawnPoint(raceTrack);
        player.resetForSession(start.position, start.facingYaw);
      }
      previousPlayerPosition.copy(player.position);
      seedStartupPulseSources((position, strength) => spawnWebGpuPulse(rippleSources, particleState, position, 0, strength, settings, preset));
      if (echoZoneState) {
        nextEchoZoneAt = seedWebGpuEchoZones(echoZoneState, 0, preset, activePlayMode, raceTrack);
        echoZoneState.logInit(0);
      }
    } else {
      seedDiagnosticWebGpuParticles(particleState, preset);
    }

    wireDiagnosticUi({
      stateMode,
      settings,
      player,
      onQualityChange: (qualityId) => {
        if (diagnosticFieldRebuildTimeoutId !== 0) {
          window.clearTimeout(diagnosticFieldRebuildTimeoutId);
          diagnosticFieldRebuildTimeoutId = 0;
        }
        settings.qualityId = qualityId;
        const guardrailResult = applyFieldInstanceBudget(settings, "quality", webGpuFieldStressModeEnabled);
        preset = getQualityPreset(settings);
        raceTrack?.setArena(preset.fieldRadius, settings.arenaRadiusMeters, "webgpu-quality");
        settings.bloomStrength = preset.bloomStrength;
        settings.bloomEnabled = settings.bloomStrength > 0;
        particleState = new ParticleVeilState(stateMode === "playable" ? preset.particleBudget : Math.min(4096, preset.particleBudget));
        if (stateMode !== "playable" && settings.particlesEnabled) seedDiagnosticWebGpuParticles(particleState, preset);
        renderRuntime.applyQualityPreset(preset, getDiagnosticBloomStrength(settings), "quality");
        resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined);
        applyDiagnosticUiState(renderRuntime, clock.elapsedTime, 0, 0, stateMode, settings);
        return {
          ...getWebGpuFieldScaleGuardrailDiagnostics(guardrailResult),
          ...collectDiagnosticRuntimeSettingsPayload("quality")
        };
      },
      onFieldScaleChange: applyDiagnosticFieldScale,
      onPlayerSpeedChange: () => collectDiagnosticRuntimeSettingsPayload(),
      onSurfaceGripChange: () => collectDiagnosticRuntimeSettingsPayload(),
      onRenderTuningChange: () => collectDiagnosticRuntimeSettingsPayload(),
      onParticleDensityChange: () => {
        applyDiagnosticUiState(renderRuntime, clock.elapsedTime, 0, 0, stateMode, settings);
        return collectDiagnosticRuntimeSettingsPayload();
      },
      onParticleToggle: (enabled) => {
        if (!enabled) {
          particleState.setEnabled(false);
        } else if (stateMode !== "playable" && particleState.getActiveCount() === 0) {
          seedDiagnosticWebGpuParticles(particleState, preset);
        }
        applyDiagnosticUiState(renderRuntime, clock.elapsedTime, 0, 0, stateMode, settings);
      }
    });
    applyDiagnosticUiState(renderRuntime, 0, 0, 0, stateMode, settings);
    resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined);
    renderRuntime.prewarm();
    reportDiagnosticRendererMode(renderRuntime, activePlayMode, createRaceTrackSnapshot(activePlayMode, raceTrack));
    const initialInput = stateMode === "playable" && player
      ? createPlayableWebGpuRenderInput(
        0,
        0,
        settings,
        preset,
        activePlayMode,
        createRaceTrackSnapshot(activePlayMode, raceTrack),
        camera,
        player,
        previousPlayerPosition,
        rippleSources.getRenderSourceSnapshot(0, renderRuntime.getFieldMetrics().sourceLimit),
        echoZoneState?.getRenderSnapshot(0) ?? createEmptyEchoVisualState(),
        particleState.getSnapshot()
      )
      : createDiagnosticRenderInput(0, 0, settings, preset, particleState.getSnapshot());
    logWebGpuSceneState("webgpu.sceneState.init", "Initialized forced WebGPU scene state", stateMode, renderRuntime, initialInput);
    logWebGpuReadinessState("webgpu.readiness.init", "Initialized forced WebGPU renderer readiness", stateMode, renderRuntime, initialInput);
    logWebGpuIntegrationReadinessState(
      "webgpu.integrationReadiness.init",
      "Initialized forced WebGPU integration readiness",
      stateMode,
      renderRuntime,
      initialInput
    );
    logWebGpuDefaultReadinessState(
      "webgpu.defaultReadiness.init",
      "Initialized forced WebGPU default-readiness soak surface",
      stateMode,
      renderRuntime,
      initialInput,
      0
    );
    window.addEventListener("resize", () => resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined));
    window.visualViewport?.addEventListener("resize", () => resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined));
    window.visualViewport?.addEventListener("scroll", () => resizeDiagnosticRuntime(renderRuntime, stateMode === "playable" ? camera : undefined));

    renderRuntime.setAnimationLoop(() => {
      const rawDelta = clock.getDelta();
      const delta = Math.min(rawDelta, 1 / 24);
      const time = clock.elapsedTime;
      const startedAt = performance.now();
      let updateMs = 0;
      let input: RenderFrameInput;

      if (stateMode === "playable" && player && echoZoneState) {
        const updateStartedAt = performance.now();
        player.update(delta);
        const playerSpeed = player.getSpeed();
        const playerGroundContact = player.getGroundContactStrength();
        if (settings.particlesEnabled) {
          const particleDensity = Math.max(0, settings.particleDensity);
          particleState.spawnAura(player.position, delta * particleDensity, playerSpeed / 18);
          particleState.spawnWake(player.position, (playerSpeed / 18) * playerGroundContact * particleDensity, player.velocity);
        }
        echoZoneState.update(time);
        const triggeredEchoes = echoZoneState.collectAt(player.position, time);
        if (triggeredEchoes.length > 0) {
          debugEvent("echo.collect", "Collected Echo zones this frame", {
            time: roundMetric(time),
            triggeredCount: triggeredEchoes.length,
            playerPosition: vectorPayload(player.position),
            activeEchoesAfterCollect: echoZoneState.getActiveCount(),
            activeVisualBursts: echoZoneState.getCollectBurstCount(),
            particleActiveBeforeGameBurst: particleState.getActiveCount(),
            quality: preset.id,
            particleBudget: preset.particleBudget,
            particleDensity: roundMetric(settings.particleDensity)
          });
        }
        for (const echo of triggeredEchoes) {
          triggerWebGpuEchoZone(rippleSources, particleState, echo, time, echoZoneState, settings, preset);
        }
        nextEchoZoneAt = maybeSpawnWebGpuEchoZone(
          echoZoneState,
          time,
          preset,
          player.position,
          nextEchoZoneAt,
          activePlayMode,
          raceTrack
        );
        echoZoneState.maybeLogFrame(time);
        if (settings.particlesEnabled) {
          particleState.update(delta);
        }
        const sourceLimit = renderRuntime.getFieldMetrics().sourceLimit;
        const pulseSourceSnapshot = rippleSources.getRenderSourceSnapshot(time, sourceLimit);
        const echoVisualState = echoZoneState.getRenderSnapshot(time);
        const particleSnapshot = particleState.getSnapshot();
        updateMs = performance.now() - updateStartedAt;
        input = createPlayableWebGpuRenderInput(
          time,
          delta,
          settings,
          preset,
          activePlayMode,
          createRaceTrackSnapshot(activePlayMode, raceTrack),
          camera,
          player,
          previousPlayerPosition,
          pulseSourceSnapshot,
          echoVisualState,
          particleSnapshot
        );
      } else {
        if (settings.particlesEnabled) {
          updateDiagnosticWebGpuParticles(particleState, time, delta * Math.max(0, settings.particleDensity), preset);
        }
        input = createDiagnosticRenderInput(time, delta, settings, preset, particleState.getSnapshot());
      }

      renderRuntime.beginFrame();
      renderRuntime.renderFrame(input);
      const frameMs = performance.now() - startedAt;
      applyDiagnosticUiState(renderRuntime, time, frameMs, delta, stateMode, settings);
      if (time - lastSceneStateFrameAt >= WEBGPU_SCENE_STATE_FRAME_LOG_SECONDS) {
        lastSceneStateFrameAt = time;
        logWebGpuSceneState("webgpu.sceneState.frame", "Forced WebGPU scene state frame sample", stateMode, renderRuntime, input);
        logWebGpuReadinessState("webgpu.readiness.frame", "Forced WebGPU renderer readiness frame sample", stateMode, renderRuntime, input);
        logWebGpuIntegrationReadinessState(
          "webgpu.integrationReadiness.frame",
          "Forced WebGPU integration readiness frame sample",
          stateMode,
          renderRuntime,
          input
        );
      }
      if (time - lastDefaultReadinessFrameAt >= WEBGPU_DEFAULT_READINESS_FRAME_LOG_SECONDS) {
        lastDefaultReadinessFrameAt = time;
        logWebGpuDefaultReadinessState(
          "webgpu.defaultReadiness.frame",
          "Forced WebGPU default-readiness soak frame sample",
          stateMode,
          renderRuntime,
          input,
          time
        );
      }
      if (
        time >= WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS &&
        time - lastDefaultReadinessSummaryAt >= WEBGPU_DEFAULT_READINESS_FRAME_LOG_SECONDS * 5
      ) {
        lastDefaultReadinessSummaryAt = time;
        logWebGpuDefaultReadinessState(
          "webgpu.defaultReadiness.summary",
          "Forced WebGPU default-readiness soak summary",
          stateMode,
          renderRuntime,
          input,
          time
        );
      }
      if (time - lastRendererFrameSampleAt >= RENDERER_FRAME_SAMPLE_SECONDS) {
        lastRendererFrameSampleAt = time;
        const rendererStats = renderRuntime.getStats();
        emitRendererFrameSample(rendererStats, {
          time,
          delta,
          rawDelta,
          frameMs,
          updateMs,
          renderMs: rendererStats.gpuCpuSubmitMs,
          viewport: getDiagnosticViewportSize(),
          playMode: input.playMode,
          raceTrack: input.raceTrack,
          cameraMode: input.camera.projection.cameraMode,
          stateMode,
          scenePresentation: input.scenePresentation,
          avatarPresentation: input.avatarPresentation,
          settings: input.settings,
          qualityPreset: input.qualityPreset
        });
      }
      if (stateMode === "playable" && player) {
        previousPlayerPosition.copy(player.position);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugEvent("webgpu.unavailable", "Forced WebGPU renderer unavailable", {
      requestedMode: rendererModeSelection.requestedMode,
      selectionSource: rendererModeSelection.source,
      message
    }, "error");
    debugEvent("webgpu.fallback", "Forced WebGPU renderer failed without fallback", {
      ok: false,
      activeBackend: "none",
      fallbackReason: "Forced WebGPU does not fall back to WebGL.",
      message
    }, "error");
    showWebGpuFatalError(message);
  }
}

function createDiagnosticRenderInput(
  time: number,
  delta: number,
  settings: ReturnType<typeof cloneDefaultSettings>,
  preset: QualityPreset,
  particleState: ParticleStateSnapshot = createEmptyParticleStateSnapshot()
): RenderFrameInput {
  const viewport = getDiagnosticViewportSize();
  const camera = createDiagnosticCameraSnapshot(time, viewport, preset);
  const pulseSources = createDiagnosticPulseSourceSnapshot(time, preset);
  const echoVisualState = createEmptyEchoVisualState();
  const playerSnapshot = {
    previousPosition: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    groundContact: 1,
    facingYawRadians: time * 0.72
  };
  const avatarPresentation = createAvatarPresentationSnapshot(playerSnapshot);

  return {
    time,
    delta,
    playMode: "none",
    raceTrack: DISABLED_RACE_TRACK_SNAPSHOT,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      pixelRatio: getDiagnosticPixelRatio()
    },
    camera: {
      position: vectorSnapshot(camera.position),
      quaternion: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w
      },
      viewProjectionMatrix: createViewProjectionSnapshot(camera),
      projection: {
        mode: "perspective",
        cameraMode: "diagnostic-orbit",
        near: camera.near,
        far: camera.far,
        fovDegrees: camera.fov,
        aspect: camera.aspect
      }
    },
    player: playerSnapshot,
    scenePresentation: createScenePresentationSnapshot(settings, preset),
    avatarPresentation,
    sceneLighting: createSceneLightingSnapshot(time, settings, playerSnapshot, pulseSources, echoVisualState),
    sceneShadows: createSceneShadowSnapshot(time, playerSnapshot, avatarPresentation, pulseSources, echoVisualState),
    settings: createRenderSettingsSnapshot(settings),
    qualityPreset: { ...preset },
    pulseSources,
    echoVisualState,
    particleState,
    bloomStrength: getDiagnosticBloomStrength(settings)
  };
}

function createPlayableWebGpuRenderInput(
  time: number,
  delta: number,
  settings: ReturnType<typeof cloneDefaultSettings>,
  preset: QualityPreset,
  playMode: PlayModeId | "none",
  raceTrack: RenderRaceTrackSnapshot,
  camera: THREE.PerspectiveCamera,
  player: PlayerRig,
  previousPlayerPosition: THREE.Vector3,
  pulseSources: RippleRenderSourceSnapshot,
  echoVisualState: EchoVisualStateSnapshot,
  particleState: ParticleStateSnapshot
): RenderFrameInput {
  const viewport = getDiagnosticViewportSize();
  camera.aspect = viewport.width / Math.max(1, viewport.height);
  camera.updateProjectionMatrix();
  const playerSnapshot = {
    previousPosition: vectorSnapshot(previousPlayerPosition),
    position: vectorSnapshot(player.position),
    velocity: vectorSnapshot(player.velocity),
    speed: player.getSpeed(),
    groundContact: player.getGroundContactStrength(),
    facingYawRadians: player.getFacingYaw()
  };
  const avatarPresentation = createAvatarPresentationSnapshot(playerSnapshot);

  return {
    time,
    delta,
    playMode,
    raceTrack,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      pixelRatio: getDiagnosticPixelRatio()
    },
    camera: {
      position: vectorSnapshot(camera.position),
      quaternion: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w
      },
      viewProjectionMatrix: createViewProjectionSnapshot(camera),
      projection: {
        mode: "perspective",
        cameraMode: "playable",
        near: camera.near,
        far: camera.far,
        fovDegrees: camera.fov,
        aspect: camera.aspect
      }
    },
    player: playerSnapshot,
    scenePresentation: createScenePresentationSnapshot(settings, preset),
    avatarPresentation,
    sceneLighting: createSceneLightingSnapshot(time, settings, playerSnapshot, pulseSources, echoVisualState),
    sceneShadows: createSceneShadowSnapshot(time, playerSnapshot, avatarPresentation, pulseSources, echoVisualState),
    settings: createRenderSettingsSnapshot(settings),
    qualityPreset: { ...preset },
    pulseSources,
    echoVisualState,
    particleState,
    bloomStrength: getDiagnosticBloomStrength(settings)
  };
}

function createDiagnosticCameraSnapshot(
  time: number,
  viewport: { readonly width: number; readonly height: number },
  preset: QualityPreset
): THREE.PerspectiveCamera {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const camera = new THREE.PerspectiveCamera(
    DIAGNOSTIC_WEBGPU_CAMERA_FOV_DEGREES,
    aspect,
    DIAGNOSTIC_WEBGPU_CAMERA_NEAR,
    DIAGNOSTIC_WEBGPU_CAMERA_FAR
  );
  const orbitAngle = time * 0.11 + 0.48;
  const orbitRadius = preset.fieldRadius * 1.78;
  const height = preset.fieldRadius * 0.72;

  camera.position.set(
    Math.cos(orbitAngle) * orbitRadius,
    height,
    Math.sin(orbitAngle) * orbitRadius
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function createDiagnosticPulseSourceSnapshot(time: number, preset: QualityPreset): RippleRenderSourceSnapshot {
  const period = DIAGNOSTIC_WEBGPU_PULSE_PERIOD_SECONDS;
  const arenaRadius = preset.fieldRadius;
  const firstAge = time % period;
  const secondAge = (time + period * 0.5) % period;
  const firstOriginAngle = Math.floor(time / period) * 0.92;
  const secondOriginAngle = Math.floor((time + period * 0.5) / period) * -0.74 + 1.8;
  const firstRadius = arenaRadius * 0.32;
  const secondRadius = arenaRadius * 0.22;
  const sourceLimit = 2;

  return {
    time,
    sourceLimit,
    activeCount: sourceLimit,
    renderedCount: sourceLimit,
    sources: [
      {
        positionX: Math.cos(firstOriginAngle) * firstRadius,
        positionZ: Math.sin(firstOriginAngle * 1.17) * firstRadius * 0.72,
        startTime: time - firstAge,
        strength: 0.62,
        kind: "pulse",
        speedMultiplier: 1,
        widthMultiplier: 1.12,
        dampingMultiplier: 0.82,
        lifetimeSeconds: period,
        hue: 0.52
      },
      {
        positionX: Math.cos(secondOriginAngle) * secondRadius,
        positionZ: Math.sin(secondOriginAngle * 0.86) * secondRadius,
        startTime: time - secondAge,
        strength: 0.46,
        kind: "pulse",
        speedMultiplier: 0.86,
        widthMultiplier: 1.55,
        dampingMultiplier: 0.72,
        lifetimeSeconds: period,
        hue: 0.84
      }
    ]
  };
}

function seedDiagnosticWebGpuParticles(particleState: ParticleVeilState, preset: QualityPreset): void {
  const center = new THREE.Vector3(0, sampleFieldHeight(0, 0) + 0.85, 0);
  particleState.spawnPulseBurst(center, Math.min(260, Math.floor(preset.burstParticleCount * 0.018)), 0.34);
}

function updateDiagnosticWebGpuParticles(
  particleState: ParticleVeilState,
  time: number,
  delta: number,
  preset: QualityPreset
): void {
  const orbitRadius = preset.fieldRadius * 0.2;
  const center = new THREE.Vector3(
    Math.cos(time * 0.72) * orbitRadius,
    sampleFieldHeight(0, 0) + 0.82,
    Math.sin(time * 0.58) * orbitRadius
  );
  particleState.spawnAura(center, delta, 0.18);
  particleState.update(delta);
}

function seedWebGpuEchoZones(
  stateStore: EchoZoneStateStore,
  time: number,
  preset: QualityPreset,
  playMode: PlayModeId | "none",
  raceTrack: RaceTrack | null
): number {
  if (playMode === "track" && raceTrack) {
    const first = raceTrack.samplePointAt(0.02, -raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.12);
    const second = raceTrack.samplePointAt(0.11, raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.18);
    addWebGpuEchoZoneAtPosition(
      stateStore,
      first.setY(sampleFieldHeight(first.x, first.z) + 0.16),
      time
    );
    addWebGpuEchoZoneAtPosition(
      stateStore,
      second.setY(sampleFieldHeight(second.x, second.z) + 0.16),
      time
    );

    for (let index = 2; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
      const fraction = RACE_TRACK_ECHO_SEED_FRACTIONS[index] ?? 0.22 + index * 0.09;
      const lateralOffsetMeters = (index % 2 === 0 ? 1 : -1) *
        raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.28;
      if (!spawnWebGpuEchoZoneAtTrackFraction(stateStore, time, raceTrack, fraction, lateralOffsetMeters)) {
        spawnWebGpuEchoZone(stateStore, time, preset, new THREE.Vector3(), playMode, raceTrack);
      }
    }

    return time + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
  }

  const startingAngles = [Math.PI * 0.23, Math.PI * 0.92, -Math.PI * 0.46];
  const startingRadii = [15, 27, 38];
  const playerPosition = new THREE.Vector3(0, 0, 0);

  for (let index = 0; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
    const angle = startingAngles[index] ?? Math.random() * Math.PI * 2;
    const radius = startingRadii[index] ?? ECHO_ZONE_MIN_PLAYER_DISTANCE + index * ECHO_ZONE_MIN_ZONE_DISTANCE;
    if (!spawnWebGpuEchoZoneAtPolar(stateStore, time, preset, angle, radius)) {
      spawnWebGpuEchoZone(stateStore, time, preset, playerPosition);
    }
  }

  return time + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
}

function maybeSpawnWebGpuEchoZone(
  stateStore: EchoZoneStateStore,
  time: number,
  preset: QualityPreset,
  playerPosition: THREE.Vector3,
  nextSpawnAt: number,
  playMode: PlayModeId | "none",
  raceTrack: RaceTrack | null
): number {
  if (time < nextSpawnAt) return nextSpawnAt;
  if (stateStore.getActiveCount() >= ECHO_ZONE_MAX_ACTIVE) return time + 1;

  const spawned = spawnWebGpuEchoZone(stateStore, time, preset, playerPosition, playMode, raceTrack);
  return time + (spawned ? ECHO_ZONE_SPAWN_INTERVAL_SECONDS : 1.2);
}

function spawnWebGpuEchoZone(
  stateStore: EchoZoneStateStore,
  time: number,
  preset: QualityPreset,
  playerPosition: THREE.Vector3,
  playMode: PlayModeId | "none" = "arena",
  raceTrack: RaceTrack | null = null
): boolean {
  const position = createWebGpuEchoZonePosition(stateStore, preset, playerPosition, playMode, raceTrack);
  if (!position) return false;

  addWebGpuEchoZoneAtPosition(stateStore, position, time);
  return true;
}

function spawnWebGpuEchoZoneAtPolar(
  stateStore: EchoZoneStateStore,
  time: number,
  preset: QualityPreset,
  angle: number,
  radius: number
): boolean {
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
  if (!stateStore.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) return false;

  position.y = sampleFieldHeight(position.x, position.z) + 0.16;
  addWebGpuEchoZoneAtPosition(stateStore, position, time);
  return true;
}

function spawnWebGpuEchoZoneAtTrackFraction(
  stateStore: EchoZoneStateStore,
  time: number,
  raceTrack: RaceTrack,
  fraction: number,
  lateralOffsetMeters: number
): boolean {
  const position = raceTrack.samplePointAt(fraction, lateralOffsetMeters);
  if (!stateStore.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) return false;
  position.y = sampleFieldHeight(position.x, position.z) + 0.16;
  addWebGpuEchoZoneAtPosition(stateStore, position, time);
  return true;
}

function createWebGpuEchoZonePosition(
  stateStore: EchoZoneStateStore,
  preset: QualityPreset,
  playerPosition: THREE.Vector3,
  playMode: PlayModeId | "none" = "arena",
  raceTrack: RaceTrack | null = null
): THREE.Vector3 | null {
  if (playMode === "track" && raceTrack) {
    const maxJitterMeters = raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS);
    for (let attempt = 0; attempt < ECHO_ZONE_SPAWN_ATTEMPTS; attempt += 1) {
      const position = raceTrack.samplePointAt(
        Math.random(),
        (Math.random() * 2 - 1) * maxJitterMeters
      );
      const playerDistance = Math.hypot(position.x - playerPosition.x, position.z - playerPosition.z);
      if (playerDistance < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
      if (!stateStore.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;

      position.y = sampleFieldHeight(position.x, position.z) + 0.16;
      return position;
    }

    debugEvent("track.echoPlacement", "Failed to find a clear Echo position on the race track", {
      attempts: ECHO_ZONE_SPAWN_ATTEMPTS,
      activeEchoes: stateStore.getActiveCount(),
      trackWidthMeters: roundMetric(raceTrack.getTrackWidthMeters())
    }, "warn");
    return null;
  }

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
    const playerDistance = Math.hypot(position.x - playerPosition.x, position.z - playerPosition.z);
    if (playerDistance < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
    if (!stateStore.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;

    position.y = sampleFieldHeight(position.x, position.z) + 0.16;
    return position;
  }

  return null;
}

function addWebGpuEchoZoneAtPosition(stateStore: EchoZoneStateStore, position: THREE.Vector3, time: number): void {
  stateStore.add(position, time, {
    radius: ECHO_ZONE_RADIUS,
    triggerRadius: ECHO_ZONE_TRIGGER_RADIUS,
    burstStrength: ECHO_ZONE_BURST_STRENGTH,
    discBurstRadius: ECHO_ZONE_DISC_BURST_RADIUS
  });
}

function isWebGpuDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get("webgpuDemo") === "1";
}

function spawnWebGpuPulse(
  rippleSources: RippleSourceStore,
  particleState: ParticleVeilState,
  position: THREE.Vector3,
  startTime: number,
  strength: number,
  settings: ReturnType<typeof cloneDefaultSettings>,
  preset: QualityPreset,
  options = MANUAL_PULSE_OPTIONS
): void {
  rippleSources.add(position, startTime, strength, options);
  const count = Math.max(0, Math.floor(
    preset.burstParticleCount * settings.particleDensity * (0.42 + strength * 1.7)
  ));
  if (settings.particlesEnabled) {
    particleState.spawnPulseBurst(position, count, strength);
  }
}

function addWebGpuJumpRipple(
  rippleSources: RippleSourceStore,
  particleState: ParticleVeilState,
  event: PlayerJumpEvent,
  startTime: number,
  options: RippleSourceOptions,
  message: string,
  settings: ReturnType<typeof cloneDefaultSettings>,
  preset: QualityPreset
): void {
  spawnWebGpuPulse(rippleSources, particleState, event.position, startTime, event.strength, settings, preset, options);
  debugEvent("player.jump", message, {
    time: roundMetric(startTime),
    strength: roundMetric(event.strength),
    position: vectorPayload(event.position)
  }, "info");
}

function triggerWebGpuEchoZone(
  rippleSources: RippleSourceStore,
  particleState: ParticleVeilState,
  echo: TriggeredEchoZone,
  time: number,
  stateStore: EchoZoneStateStore,
  settings: ReturnType<typeof cloneDefaultSettings>,
  preset: QualityPreset
): void {
  const detonationStartedAt = performance.now();
  const position = echo.position.clone();
  position.y = sampleFieldHeight(position.x, position.z) + 0.45;
  const effectPosition = echo.effectPosition.clone();

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
  const activeBeforeParticles = particleState.getActiveCount();
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
        emittedParticleCount = particleState.spawnDiscBurst(
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
    activeParticlesAfter: particleState.getActiveCount(),
    activeVisualBursts: stateStore.getCollectBurstCount(),
    activeRippleSources: rippleSources.getActiveSources(time).length
  });
}

function areDiagnosticInputsEnabled(): boolean {
  return sceneMenuBackdrop.hidden && changelogBackdrop.hidden;
}

function logWebGpuSceneState(
  channel: "webgpu.sceneState.init" | "webgpu.sceneState.frame",
  message: string,
  stateMode: WebGpuStateMode,
  renderRuntime: WebGpuRenderRuntime,
  input: RenderFrameInput
): void {
  const stats = renderRuntime.getStats();
  const wakeMetrics = renderRuntime.getWakeMetrics();
  const particleMetrics = renderRuntime.getParticleMetrics();
  const skyboxMetrics = renderRuntime.getSkyboxMetrics();
  const arenaMetrics = renderRuntime.getArenaMetrics();
  const pulseGlowMetrics = renderRuntime.getPulseGlowMetrics();
  const avatarMetrics = renderRuntime.getAvatarMetrics();
  const bloomMetrics = renderRuntime.getBloomMetrics();
  const lightingMetrics = renderRuntime.getLightingMetrics();
  const shadowMetrics = renderRuntime.getShadowMetrics();
  const echoVisualMetrics = renderRuntime.getEchoVisualMetrics();
  const renderedShadowCasters = Math.max(
    shadowMetrics.renderedShadowCasters,
    input.sceneShadows.casters.length
  );
  const shadowProxyCounts = getSceneShadowMapProxyDiagnosticCounts(input.sceneShadows.casters, shadowMetrics);

  debugEvent(channel, message, {
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS],
    scenePresentationMode: input.scenePresentation.mode,
    stateMode,
    ...getRaceTrackDiagnosticFields(input),
    cameraMode: input.camera.projection.cameraMode,
    time: roundMetric(input.time),
    quality: input.qualityPreset.id,
    ...getWebGpuSettingsDiagnosticFields(input.settings, input.qualityPreset),
    fieldInstanceCount: renderRuntime.getFieldMetrics().instanceCount,
    skybox: input.scenePresentation.skyboxId,
    skyboxTextureTier: skyboxMetrics.textureTier,
    arenaRadius: roundMetric(arenaMetrics.arenaRadius),
    avatarMode: avatarMetrics.avatarMode,
    avatarPresentationMode: input.avatarPresentation.mode,
    avatarAssetId: input.avatarPresentation.assetId,
    moteAvatarAssetId: input.avatarPresentation.moteAssetId,
    avatarCoreRadius: roundMetric(input.avatarPresentation.coreRadius),
    avatarGlowRadius: roundMetric(input.avatarPresentation.glowRadius),
    avatarGlowStrength: roundMetric(input.avatarPresentation.glowStrength),
    pulseGlowCount: pulseGlowMetrics.renderedGlows,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights,
    bloomMode: bloomMetrics.bloomMode,
    bloomEnabled: bloomMetrics.bloomEnabled,
    bloomStrength: roundMetric(bloomMetrics.bloomStrength),
    bloomPasses: bloomMetrics.bloomPasses,
    bloomPassMs: roundMetric(bloomMetrics.passMs),
    activeLocalLights: input.sceneLighting.activeLocalLights,
    renderedLocalLights: input.sceneLighting.localLights.length,
    localLightLimit: input.sceneLighting.localLightLimit,
    uploadedLocalLights: lightingMetrics.renderedLocalLights,
    shadowMode: shadowMetrics.shadowMode,
    activeShadowCasters: input.sceneShadows.activeCasters,
    renderedShadowCasters,
    shadowCasterLimit: shadowMetrics.shadowCasterLimit,
    shadowStrength: roundMetric(shadowMetrics.shadowStrength),
    shadowSoftness: roundMetric(shadowMetrics.shadowSoftness),
    shadowUpdateMs: roundMetric(shadowMetrics.updateMs),
    shadowMapSize: shadowMetrics.shadowMapSize ?? 0,
    shadowMapFormat: shadowMetrics.shadowMapFormat ?? "",
    shadowMapPassMs: roundMetric(shadowMetrics.shadowMapPassMs ?? 0),
    shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps ?? 0,
    shadowMapLightBounds: roundMetric(shadowMetrics.shadowMapLightBounds ?? 0),
    shadowGeometryMode: shadowMetrics.shadowGeometryMode ?? "",
    fieldReceiver: shadowMetrics.fieldReceiver === true,
    renderedOrbCasters: shadowProxyCounts.renderedOrbCasters,
    renderedColumnCasters: shadowProxyCounts.renderedColumnCasters,
    renderedDiscCasters: shadowProxyCounts.renderedDiscCasters,
    shadowMapProxyTriangles: shadowProxyCounts.shadowMapProxyTriangles,
    viewportWidth: input.viewport.width,
    viewportHeight: input.viewport.height,
    pixelRatio: roundMetric(input.viewport.pixelRatio),
    playerPosition: input.player.position,
    playerPreviousPosition: input.player.previousPosition,
    playerSpeed: roundMetric(input.player.speed),
    playerGroundContact: roundMetric(input.player.groundContact),
    activeSources: input.pulseSources.activeCount,
    renderedSources: input.pulseSources.renderedCount,
    sourceLimit: input.pulseSources.sourceLimit,
    activeEchoes: input.echoVisualState.activeEchoes,
    renderedEchoes: input.echoVisualState.echoes.length,
    activeEchoBursts: input.echoVisualState.activeVisualBursts,
    renderedEchoBursts: input.echoVisualState.collectionEvents.length,
    echoVisualActiveEchoes: echoVisualMetrics.activeEchoes,
    echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
    echoVisualActiveCollectionEvents: echoVisualMetrics.activeCollectionEvents,
    echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
    echoVisualBillboardInstances: echoVisualMetrics.billboardInstances,
    echoVisualOrbInstances: echoVisualMetrics.orbInstances,
    echoVisualCollectionVisualInstances: echoVisualMetrics.collectionVisualInstances,
    echoVisualPassMs: roundMetric(echoVisualMetrics.passMs),
    activeParticles: input.particleState.activeParticles,
    renderedParticles: particleMetrics.renderedParticles,
    particleBudget: input.particleState.particleBudget,
    particlesEnabled: input.settings.particlesEnabled,
    particleDensity: roundMetric(input.settings.particleDensity),
    wakeTextureSize: wakeMetrics.textureSize,
    wakeMaxAbsHeight: roundMetric(wakeMetrics.wakeMaxAbsHeight),
    wakeMeanAbsHeight: roundMetric(wakeMetrics.wakeMeanAbsHeight),
    wakeMaxCrest: roundMetric(wakeMetrics.wakeMaxCrest),
    wakeEnergyEstimate: roundMetric(wakeMetrics.wakeEnergyEstimate),
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    deviceLost: stats.deviceLost
  }, channel === "webgpu.sceneState.init" ? "info" : "debug");
}

function logWebGpuReadinessState(
  channel: "webgpu.readiness.init" | "webgpu.readiness.frame",
  message: string,
  stateMode: WebGpuStateMode,
  renderRuntime: WebGpuRenderRuntime,
  input: RenderFrameInput
): void {
  const stats = renderRuntime.getStats();
  const wakeMetrics = renderRuntime.getWakeMetrics();
  const particleMetrics = renderRuntime.getParticleMetrics();
  const skyboxMetrics = renderRuntime.getSkyboxMetrics();
  const bloomMetrics = renderRuntime.getBloomMetrics();
  const lightingMetrics = renderRuntime.getLightingMetrics();
  const shadowMetrics = renderRuntime.getShadowMetrics();
  const echoVisualMetrics = renderRuntime.getEchoVisualMetrics();
  const shadowProxyCounts = getSceneShadowMapProxyDiagnosticCounts(input.sceneShadows.casters, shadowMetrics);

  debugEvent(channel, message, {
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS],
    activeBackend: renderRuntime.backendId,
    stateMode,
    scenePresentationMode: input.scenePresentation.mode,
    ...getRaceTrackDiagnosticFields(input),
    cameraMode: input.camera.projection.cameraMode,
    quality: input.qualityPreset.id,
    ...getWebGpuSettingsDiagnosticFields(input.settings, input.qualityPreset),
    fieldInstanceCount: renderRuntime.getFieldMetrics().instanceCount,
    skybox: input.scenePresentation.skyboxId,
    skyboxTextureTier: skyboxMetrics.textureTier,
    avatarPresentationMode: input.avatarPresentation.mode,
    avatarAssetId: input.avatarPresentation.assetId,
    moteAvatarAssetId: input.avatarPresentation.moteAssetId,
    avatarCoreRadius: roundMetric(input.avatarPresentation.coreRadius),
    avatarGlowRadius: roundMetric(input.avatarPresentation.glowRadius),
    avatarGlowStrength: roundMetric(input.avatarPresentation.glowStrength),
    particlesEnabled: input.settings.particlesEnabled,
    particleDensity: roundMetric(input.settings.particleDensity),
    activeParticles: input.particleState.activeParticles,
    renderedParticles: particleMetrics.renderedParticles,
    particleBudget: input.particleState.particleBudget,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    bloomEnabled: bloomMetrics.bloomEnabled,
    bloomStrength: roundMetric(bloomMetrics.bloomStrength),
    bloomPasses: bloomMetrics.bloomPasses,
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights,
    activeLocalLights: input.sceneLighting.activeLocalLights,
    renderedLocalLights: lightingMetrics.renderedLocalLights,
    shadowMode: shadowMetrics.shadowMode,
    activeShadowCasters: input.sceneShadows.activeCasters,
    renderedShadowCasters: Math.max(shadowMetrics.renderedShadowCasters, input.sceneShadows.casters.length),
    shadowMapSize: shadowMetrics.shadowMapSize ?? 0,
    shadowMapFormat: shadowMetrics.shadowMapFormat ?? "",
    shadowMapPassMs: roundMetric(shadowMetrics.shadowMapPassMs ?? 0),
    shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps ?? 0,
    shadowMapLightBounds: roundMetric(shadowMetrics.shadowMapLightBounds ?? 0),
    shadowGeometryMode: shadowMetrics.shadowGeometryMode ?? "",
    fieldReceiver: shadowMetrics.fieldReceiver === true,
    renderedOrbCasters: shadowProxyCounts.renderedOrbCasters,
    renderedColumnCasters: shadowProxyCounts.renderedColumnCasters,
    renderedDiscCasters: shadowProxyCounts.renderedDiscCasters,
    shadowMapProxyTriangles: shadowProxyCounts.shadowMapProxyTriangles,
    wakeMaxAbsHeight: roundMetric(wakeMetrics.wakeMaxAbsHeight),
    wakeMeanAbsHeight: roundMetric(wakeMetrics.wakeMeanAbsHeight),
    wakeMaxCrest: roundMetric(wakeMetrics.wakeMaxCrest),
    wakeEnergyEstimate: roundMetric(wakeMetrics.wakeEnergyEstimate),
    echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
    echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    deviceLost: stats.deviceLost
  }, channel === "webgpu.readiness.init" ? "info" : "debug");
}

function logWebGpuIntegrationReadinessState(
  channel: "webgpu.integrationReadiness.init" | "webgpu.integrationReadiness.frame",
  message: string,
  stateMode: WebGpuStateMode,
  renderRuntime: WebGpuRenderRuntime,
  input: RenderFrameInput
): void {
  const stats = renderRuntime.getStats();
  const wakeMetrics = renderRuntime.getWakeMetrics();
  const fieldMetrics = renderRuntime.getFieldMetrics();
  const particleMetrics = renderRuntime.getParticleMetrics();
  const skyboxMetrics = renderRuntime.getSkyboxMetrics();
  const bloomMetrics = renderRuntime.getBloomMetrics();
  const lightingMetrics = renderRuntime.getLightingMetrics();
  const shadowMetrics = renderRuntime.getShadowMetrics();
  const echoVisualMetrics = renderRuntime.getEchoVisualMetrics();
  const renderedShadowCasters = Math.max(
    shadowMetrics.renderedShadowCasters,
    input.sceneShadows.casters.length
  );
  const shadowProxyCounts = getSceneShadowMapProxyDiagnosticCounts(input.sceneShadows.casters, shadowMetrics);

  debugEvent(channel, message, {
    integrationSurface: "core-render-snapshot",
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS],
    activeBackend: renderRuntime.backendId,
    stateMode,
    scenePresentationMode: input.scenePresentation.mode,
    ...getRaceTrackDiagnosticFields(input),
    cameraMode: input.camera.projection.cameraMode,
    quality: input.qualityPreset.id,
    ...getWebGpuSettingsDiagnosticFields(input.settings, input.qualityPreset),
    fieldInstanceCount: fieldMetrics.instanceCount,
    skybox: input.scenePresentation.skyboxId,
    skyboxTextureTier: skyboxMetrics.textureTier,
    avatarPresentationMode: input.avatarPresentation.mode,
    avatarAssetId: input.avatarPresentation.assetId,
    moteAvatarAssetId: input.avatarPresentation.moteAssetId,
    avatarCoreRadius: roundMetric(input.avatarPresentation.coreRadius),
    avatarGlowRadius: roundMetric(input.avatarPresentation.glowRadius),
    avatarGlowStrength: roundMetric(input.avatarPresentation.glowStrength),
    particlesEnabled: input.settings.particlesEnabled,
    particleDensity: roundMetric(input.settings.particleDensity),
    activeParticles: input.particleState.activeParticles,
    renderedParticles: particleMetrics.renderedParticles,
    particleBudget: input.particleState.particleBudget,
    activeSources: input.pulseSources.activeCount,
    renderedSources: input.pulseSources.renderedCount,
    sourceLimit: input.pulseSources.sourceLimit,
    activeEchoes: input.echoVisualState.activeEchoes,
    renderedEchoes: input.echoVisualState.echoes.length,
    echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
    echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    bloomEnabled: bloomMetrics.bloomEnabled,
    bloomMode: bloomMetrics.bloomMode,
    bloomStrength: roundMetric(bloomMetrics.bloomStrength),
    bloomPasses: bloomMetrics.bloomPasses,
    bloomPassMs: roundMetric(bloomMetrics.passMs),
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights,
    activeLocalLights: input.sceneLighting.activeLocalLights,
    renderedLocalLights: lightingMetrics.renderedLocalLights,
    localLightLimit: lightingMetrics.localLightLimit,
    shadowMode: shadowMetrics.shadowMode,
    activeShadowCasters: input.sceneShadows.activeCasters,
    renderedShadowCasters,
    shadowCasterLimit: shadowMetrics.shadowCasterLimit,
    shadowStrength: roundMetric(shadowMetrics.shadowStrength),
    shadowSoftness: roundMetric(shadowMetrics.shadowSoftness),
    shadowMapSize: shadowMetrics.shadowMapSize ?? 0,
    shadowMapFormat: shadowMetrics.shadowMapFormat ?? "",
    shadowMapPassMs: roundMetric(shadowMetrics.shadowMapPassMs ?? 0),
    shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps ?? 0,
    shadowMapLightBounds: roundMetric(shadowMetrics.shadowMapLightBounds ?? 0),
    shadowGeometryMode: shadowMetrics.shadowGeometryMode ?? "",
    fieldReceiver: shadowMetrics.fieldReceiver === true,
    renderedOrbCasters: shadowProxyCounts.renderedOrbCasters,
    renderedColumnCasters: shadowProxyCounts.renderedColumnCasters,
    renderedDiscCasters: shadowProxyCounts.renderedDiscCasters,
    shadowMapProxyTriangles: shadowProxyCounts.shadowMapProxyTriangles,
    wakeTextureSize: wakeMetrics.textureSize,
    wakeMaxAbsHeight: roundMetric(wakeMetrics.wakeMaxAbsHeight),
    wakeMeanAbsHeight: roundMetric(wakeMetrics.wakeMeanAbsHeight),
    wakeMaxCrest: roundMetric(wakeMetrics.wakeMaxCrest),
    wakeEnergyEstimate: roundMetric(wakeMetrics.wakeEnergyEstimate),
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    gpuCpuSubmitMs: roundMetric(stats.gpuCpuSubmitMs),
    pixelRatio: roundMetric(stats.pixelRatio),
    deviceLost: stats.deviceLost
  }, channel === "webgpu.integrationReadiness.init" ? "info" : "debug");
}

function logWebGpuDefaultReadinessState(
  channel: "webgpu.defaultReadiness.init" | "webgpu.defaultReadiness.frame" | "webgpu.defaultReadiness.summary",
  message: string,
  stateMode: WebGpuStateMode,
  renderRuntime: WebGpuRenderRuntime,
  input: RenderFrameInput,
  elapsedSeconds: number
): void {
  const stats = renderRuntime.getStats();
  const wakeMetrics = renderRuntime.getWakeMetrics();
  const fieldMetrics = renderRuntime.getFieldMetrics();
  const particleMetrics = renderRuntime.getParticleMetrics();
  const skyboxMetrics = renderRuntime.getSkyboxMetrics();
  const bloomMetrics = renderRuntime.getBloomMetrics();
  const lightingMetrics = renderRuntime.getLightingMetrics();
  const shadowMetrics = renderRuntime.getShadowMetrics();
  const echoVisualMetrics = renderRuntime.getEchoVisualMetrics();
  const shadowProxyCounts = getSceneShadowMapProxyDiagnosticCounts(input.sceneShadows.casters, shadowMetrics);
  const remainingGaps = [...WEBGPU_REMAINING_GAPS];

  debugEvent(channel, message, {
    defaultReadinessSurface: "forced-webgpu-core",
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps,
    remainingGapCount: remainingGaps.length,
    defaultRolloutSoakGapClosed: !remainingGaps.includes("default-rollout-soak"),
    activeBackend: renderRuntime.backendId,
    stateMode,
    scenePresentationMode: input.scenePresentation.mode,
    ...getRaceTrackDiagnosticFields(input),
    cameraMode: input.camera.projection.cameraMode,
    stabilityWindowSeconds: roundMetric(elapsedSeconds),
    summaryThresholdSeconds: WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS,
    quality: input.qualityPreset.id,
    ...getWebGpuSettingsDiagnosticFields(input.settings, input.qualityPreset),
    viewportWidth: input.viewport.width,
    viewportHeight: input.viewport.height,
    pixelRatio: roundMetric(input.viewport.pixelRatio),
    fieldInstanceCount: fieldMetrics.instanceCount,
    skybox: input.scenePresentation.skyboxId,
    skyboxTextureTier: skyboxMetrics.textureTier,
    avatarPresentationMode: input.avatarPresentation.mode,
    avatarAssetId: input.avatarPresentation.assetId,
    moteAvatarAssetId: input.avatarPresentation.moteAssetId,
    particlesEnabled: input.settings.particlesEnabled,
    particleDensity: roundMetric(input.settings.particleDensity),
    activeParticles: input.particleState.activeParticles,
    renderedParticles: particleMetrics.renderedParticles,
    particleBudget: input.particleState.particleBudget,
    activeSources: input.pulseSources.activeCount,
    renderedSources: input.pulseSources.renderedCount,
    sourceLimit: input.pulseSources.sourceLimit,
    activeEchoes: input.echoVisualState.activeEchoes,
    renderedEchoes: input.echoVisualState.echoes.length,
    echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
    echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    bloomEnabled: bloomMetrics.bloomEnabled,
    bloomMode: bloomMetrics.bloomMode,
    bloomStrength: roundMetric(bloomMetrics.bloomStrength),
    bloomPasses: bloomMetrics.bloomPasses,
    bloomPassMs: roundMetric(bloomMetrics.passMs),
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights,
    activeLocalLights: input.sceneLighting.activeLocalLights,
    renderedLocalLights: lightingMetrics.renderedLocalLights,
    localLightLimit: lightingMetrics.localLightLimit,
    shadowMode: shadowMetrics.shadowMode,
    activeShadowCasters: input.sceneShadows.activeCasters,
    renderedShadowCasters: Math.max(shadowMetrics.renderedShadowCasters, input.sceneShadows.casters.length),
    shadowMapSize: shadowMetrics.shadowMapSize ?? 0,
    shadowMapFormat: shadowMetrics.shadowMapFormat ?? "",
    shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps ?? 0,
    shadowMapLightBounds: roundMetric(shadowMetrics.shadowMapLightBounds ?? 0),
    shadowGeometryMode: shadowMetrics.shadowGeometryMode ?? "",
    fieldReceiver: shadowMetrics.fieldReceiver === true,
    renderedOrbCasters: shadowProxyCounts.renderedOrbCasters,
    renderedColumnCasters: shadowProxyCounts.renderedColumnCasters,
    renderedDiscCasters: shadowProxyCounts.renderedDiscCasters,
    shadowMapProxyTriangles: shadowProxyCounts.shadowMapProxyTriangles,
    wakeTextureSize: wakeMetrics.textureSize,
    wakeMaxAbsHeight: roundMetric(wakeMetrics.wakeMaxAbsHeight),
    wakeMeanAbsHeight: roundMetric(wakeMetrics.wakeMeanAbsHeight),
    wakeMaxCrest: roundMetric(wakeMetrics.wakeMaxCrest),
    wakeEnergyEstimate: roundMetric(wakeMetrics.wakeEnergyEstimate),
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    gpuCpuSubmitMs: roundMetric(stats.gpuCpuSubmitMs),
    deviceLost: stats.deviceLost
  }, channel === "webgpu.defaultReadiness.frame" ? "debug" : "info");
}

function getSceneShadowMapProxyDiagnosticCounts(
  casters: readonly RenderSceneShadowCasterSnapshot[],
  shadowMetrics: ReturnType<WebGpuRenderRuntime["getShadowMetrics"]>
): {
  renderedOrbCasters: number;
  renderedColumnCasters: number;
  renderedDiscCasters: number;
  shadowMapProxyTriangles: number;
} {
  let renderedOrbCasters = 0;
  let renderedColumnCasters = 0;
  let renderedDiscCasters = 0;

  for (const caster of casters.slice(0, RENDER_SCENE_SHADOW_CASTER_LIMIT)) {
    if (caster.shadowMapProxy.shape === "orb") renderedOrbCasters += 1;
    if (caster.shadowMapProxy.shape === "column") renderedColumnCasters += 1;
    if (caster.shadowMapProxy.shape === "disc") renderedDiscCasters += 1;
  }

  return {
    renderedOrbCasters: Math.max(shadowMetrics.renderedOrbCasters ?? 0, renderedOrbCasters),
    renderedColumnCasters: Math.max(shadowMetrics.renderedColumnCasters ?? 0, renderedColumnCasters),
    renderedDiscCasters: Math.max(shadowMetrics.renderedDiscCasters ?? 0, renderedDiscCasters),
    shadowMapProxyTriangles: Math.max(
      shadowMetrics.proxyTriangles ?? 0,
      casters.slice(0, RENDER_SCENE_SHADOW_CASTER_LIMIT).length * 6
    )
  };
}

function getWebGpuSettingsDiagnosticFields(
  settingsSnapshot: RenderFrameInput["settings"],
  presetSnapshot: QualityPreset
): RippleDebugPayload {
  const waveSpeed = getBasePropagationSpeedMetersPerSecond(settingsSnapshot.waveMedium);
  const estimate = estimateFieldInstancesForPreset(presetSnapshot);

  return {
    voxelSizeMeters: roundMetric(settingsSnapshot.voxelSizeMeters),
    hexDiameterMeters: roundMetric(settingsSnapshot.voxelSizeMeters),
    arenaRadiusMeters: roundMetric(settingsSnapshot.arenaRadiusMeters),
    walkSpeed: roundMetric(settingsSnapshot.playerSpeed.walkSpeedMetersPerSecond),
    sprintSpeed: roundMetric(settingsSnapshot.playerSpeed.sprintSpeedMetersPerSecond),
    surfaceGrip: roundMetric(settingsSnapshot.surfaceGrip),
    rippleHeight: roundMetric(settingsSnapshot.rippleHeight),
    rippleRadius: roundMetric(settingsSnapshot.rippleRadius),
    waveDepth: roundMetric(settingsSnapshot.waveMedium.effectiveDepth),
    waveSpeed: roundMetric(waveSpeed),
    fieldInstanceEstimate: estimate.estimatedInstances,
    fieldInstanceBudget: estimate.maxInstances,
    fieldInstanceExceedsBudget: estimate.exceedsBudget
  };
}

function getRaceTrackDiagnosticFields(input: RenderFrameInput): RippleDebugPayload {
  return {
    playMode: input.playMode,
    raceTrackEnabled: input.raceTrack.enabled,
    raceTrackStrength: roundMetric(input.raceTrack.strength),
    trackFieldRadius: roundMetric(input.raceTrack.fieldRadius),
    trackWidthMeters: roundMetric(input.raceTrack.trackWidthMeters),
    sceneUnitsPerMeter: roundMetric(input.raceTrack.sceneUnitsPerMeter),
    raceTrackMaskWidth: input.raceTrack.mask.width,
    raceTrackMaskHeight: input.raceTrack.mask.height,
    raceTrackMaskVersion: input.raceTrack.mask.version,
    trackMaskUploaded: input.raceTrack.enabled && input.raceTrack.mask.version > 0,
    arenaBarrierEnabled: input.playMode !== "track",
    fieldLayoutMode: input.raceTrack.enabled ? "track-mask-full-field" : "arena-full",
    culledHexCount: 0
  };
}

function getWebGpuFieldScaleGuardrailDiagnostics(result: FieldScaleGuardrailResult): RippleDebugPayload {
  return {
    fieldScaleChangedControl: result.changedControl,
    fieldScaleClampApplied: result.applied,
    fieldScaleClampedField: result.clampedField ?? "none",
    fieldScaleMaxInstances: result.maxInstances,
    fieldScaleEstimatedInstancesBefore: result.estimatedInstancesBefore,
    fieldScaleEstimatedInstancesAfter: result.estimatedInstancesAfter,
    fieldScaleVoxelSizeMetersBefore: roundMetric(result.voxelSizeMetersBefore),
    fieldScaleVoxelSizeMetersAfter: roundMetric(result.voxelSizeMetersAfter),
    fieldScaleArenaRadiusMetersBefore: roundMetric(result.arenaRadiusMetersBefore),
    fieldScaleArenaRadiusMetersAfter: roundMetric(result.arenaRadiusMetersAfter)
  };
}

type DiagnosticUiOptions = {
  readonly stateMode?: WebGpuStateMode;
  readonly settings?: ReturnType<typeof cloneDefaultSettings>;
  readonly player?: PlayerRig | null;
  readonly onQualityChange?: (qualityId: QualityPreset["id"]) => RippleDebugPayload | void;
  readonly onFieldScaleChange?: (changedControl: FieldScaleChangedControl) => RippleDebugPayload | void;
  readonly onPlayerSpeedChange?: (changedSlider: "walk" | "sprint") => RippleDebugPayload | void;
  readonly onSurfaceGripChange?: (surfaceGrip: number) => RippleDebugPayload | void;
  readonly onRenderTuningChange?: (setting: "rippleHeight" | "rippleRadius" | "waveDepth") => RippleDebugPayload | void;
  readonly onParticleToggle?: (enabled: boolean) => void;
  readonly onParticleDensityChange?: (density: number) => RippleDebugPayload | void;
};

function wireDiagnosticUi(options: DiagnosticUiOptions = {}): void {
  const stateMode = options.stateMode ?? "diagnostic-demo";
  const settings = options.settings ?? cloneDefaultSettings();
  const isPlayable = stateMode === "playable" && Boolean(options.player);
  versionLink.textContent = APP_VERSION;
  changelogContent.textContent = changelogMarkdown;
  qualitySelect.value = settings.qualityId;
  heightSlider.value = String(settings.rippleHeight);
  radiusSlider.value = String(settings.rippleRadius);
  depthSlider.value = String(settings.waveMedium.effectiveDepth);
  particleSlider.value = String(settings.particleDensity);
  voxelSizeSlider.min = String(VOXEL_SIZE_MIN_METERS);
  voxelSizeSlider.max = String(VOXEL_SIZE_MAX_METERS);
  voxelSizeSlider.step = "0.05";
  arenaRadiusSlider.min = String(ARENA_RADIUS_MIN_METERS);
  arenaRadiusSlider.max = String(ARENA_RADIUS_MAX_METERS);
  arenaRadiusSlider.step = "5";
  walkSpeedSlider.min = String(PLAYER_SPEED_LIMITS.walk.min);
  walkSpeedSlider.max = String(PLAYER_SPEED_LIMITS.walk.max);
  walkSpeedSlider.step = String(PLAYER_SPEED_LIMITS.walk.step);
  sprintSpeedSlider.max = String(PLAYER_SPEED_LIMITS.sprint.max);
  sprintSpeedSlider.step = String(PLAYER_SPEED_LIMITS.sprint.step);
  surfaceGripSlider.min = String(SURFACE_GRIP_LIMITS.min);
  surfaceGripSlider.max = String(SURFACE_GRIP_LIMITS.max);
  surfaceGripSlider.step = String(SURFACE_GRIP_LIMITS.step);
  syncDiagnosticTuningControls(settings);
  syncDiagnosticSkyboxOptions();
  skyboxSelect.value = settings.skyboxId;
  bloomSlider.value = String(settings.bloomStrength);
  updateDiagnosticEffectToggle(particleToggle, settings.particlesEnabled, particleSlider);
  updateDiagnosticEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);

  mobileControls.hidden = !isPlayable;
  for (const stick of mobileControls.querySelectorAll<HTMLElement>(".touch-stick")) {
    stick.hidden = true;
  }
  pulseButton.disabled = !isPlayable;
  particleToggle.disabled = false;
  bloomToggle.disabled = false;
  bloomSlider.disabled = !settings.bloomEnabled;
  voxelSizeSlider.disabled = false;
  arenaRadiusSlider.disabled = false;
  walkSpeedSlider.disabled = false;
  sprintSpeedSlider.disabled = false;
  surfaceGripSlider.disabled = false;
  heightSlider.disabled = false;
  radiusSlider.disabled = false;
  depthSlider.disabled = false;
  qualitySelect.disabled = false;
  skyboxSelect.disabled = false;

  menuToggle.addEventListener("click", () => setDiagnosticMenuVisible(!sceneMenuBackdrop.hidden));
  resumeButton.addEventListener("click", () => setDiagnosticMenuVisible(false));
  sceneMenuBackdrop.addEventListener("click", (event) => {
    if (event.target === sceneMenuBackdrop) setDiagnosticMenuVisible(false);
  });
  versionLink.addEventListener("click", () => {
    changelogBackdrop.hidden = false;
    changelogDialog.focus({ preventScroll: true });
  });
  changelogClose.addEventListener("click", () => {
    changelogBackdrop.hidden = true;
    versionLink.focus({ preventScroll: true });
  });
  changelogBackdrop.addEventListener("click", (event) => {
    if (event.target === changelogBackdrop) changelogBackdrop.hidden = true;
  });
  perfOverlayToggle.addEventListener("click", () => {
    perfOverlay.hidden = !perfOverlay.hidden;
    perfOverlayToggle.textContent = perfOverlay.hidden ? "Off" : "On";
    perfOverlayToggle.setAttribute("aria-pressed", String(!perfOverlay.hidden));
  });
  qualitySelect.addEventListener("change", () => {
    if (!isQualityId(qualitySelect.value)) return;
    settings.qualityId = qualitySelect.value;
    const extraPayload = options.onQualityChange?.(qualitySelect.value);
    syncDiagnosticFieldScaleControls(settings);
    bloomSlider.value = String(settings.bloomStrength);
    updateDiagnosticEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);
    updateDiagnosticEffectToggle(particleToggle, settings.particlesEnabled, particleSlider);
    logWebGpuSettingsChange("quality", settings.qualityId, stateMode, settings, extraPayload);
  });
  skyboxSelect.addEventListener("change", () => {
    if (!isSkyboxId(skyboxSelect.value)) return;
    settings.skyboxId = skyboxSelect.value;
    logWebGpuSettingsChange("skybox", settings.skyboxId, stateMode, settings);
  });
  voxelSizeSlider.addEventListener("input", () => {
    settings.voxelSizeMeters = THREE.MathUtils.clamp(
      Number(voxelSizeSlider.value),
      VOXEL_SIZE_MIN_METERS,
      VOXEL_SIZE_MAX_METERS
    );
    const extraPayload = options.onFieldScaleChange?.("voxel-size");
    syncDiagnosticFieldScaleControls(settings);
    logWebGpuSettingsChange("voxelSizeMeters", roundMetric(settings.voxelSizeMeters), stateMode, settings, extraPayload);
  });
  arenaRadiusSlider.addEventListener("input", () => {
    settings.arenaRadiusMeters = THREE.MathUtils.clamp(
      Number(arenaRadiusSlider.value),
      ARENA_RADIUS_MIN_METERS,
      ARENA_RADIUS_MAX_METERS
    );
    const extraPayload = options.onFieldScaleChange?.("arena-radius");
    syncDiagnosticFieldScaleControls(settings);
    logWebGpuSettingsChange("arenaRadiusMeters", roundMetric(settings.arenaRadiusMeters), stateMode, settings, extraPayload);
  });
  walkSpeedSlider.addEventListener("input", () => {
    updateDiagnosticPlayerSpeedSettingsFromControls(settings, "walk", options.player);
    const extraPayload = options.onPlayerSpeedChange?.("walk");
    logWebGpuSettingsChange("walkSpeed", roundMetric(settings.playerSpeed.walkSpeedMetersPerSecond), stateMode, settings, extraPayload);
  });
  sprintSpeedSlider.addEventListener("input", () => {
    updateDiagnosticPlayerSpeedSettingsFromControls(settings, "sprint", options.player);
    const extraPayload = options.onPlayerSpeedChange?.("sprint");
    logWebGpuSettingsChange("sprintSpeed", roundMetric(settings.playerSpeed.sprintSpeedMetersPerSecond), stateMode, settings, extraPayload);
  });
  surfaceGripSlider.addEventListener("input", () => {
    settings.surfaceGrip = THREE.MathUtils.clamp(
      Number(surfaceGripSlider.value),
      SURFACE_GRIP_LIMITS.min,
      SURFACE_GRIP_LIMITS.max
    );
    options.player?.setSurfaceGrip(settings.surfaceGrip);
    updateDiagnosticSurfaceGripValue(settings);
    const extraPayload = options.onSurfaceGripChange?.(settings.surfaceGrip);
    logWebGpuSettingsChange("surfaceGrip", roundMetric(settings.surfaceGrip), stateMode, settings, extraPayload);
  });
  heightSlider.addEventListener("input", () => {
    settings.rippleHeight = Number(heightSlider.value);
    const extraPayload = options.onRenderTuningChange?.("rippleHeight");
    logWebGpuSettingsChange("rippleHeight", roundMetric(settings.rippleHeight), stateMode, settings, extraPayload);
  });
  radiusSlider.addEventListener("input", () => {
    settings.rippleRadius = Number(radiusSlider.value);
    const extraPayload = options.onRenderTuningChange?.("rippleRadius");
    logWebGpuSettingsChange("rippleRadius", roundMetric(settings.rippleRadius), stateMode, settings, extraPayload);
  });
  depthSlider.addEventListener("input", () => {
    settings.waveMedium.effectiveDepth = Number(depthSlider.value);
    updateDiagnosticDepthSpeedValue(settings);
    const extraPayload = options.onRenderTuningChange?.("waveDepth");
    logWebGpuSettingsChange("waveDepth", roundMetric(settings.waveMedium.effectiveDepth), stateMode, settings, extraPayload);
  });
  bloomSlider.addEventListener("input", () => {
    settings.bloomStrength = THREE.MathUtils.clamp(Number(bloomSlider.value), 0, 0.38);
    logWebGpuSettingsChange("bloomStrength", roundMetric(settings.bloomStrength), stateMode, settings);
  });
  bloomToggle.addEventListener("click", () => {
    settings.bloomEnabled = !settings.bloomEnabled;
    updateDiagnosticEffectToggle(bloomToggle, settings.bloomEnabled, bloomSlider);
    logWebGpuSettingsChange("bloomEnabled", settings.bloomEnabled, stateMode, settings);
  });
  particleSlider.addEventListener("input", () => {
    settings.particleDensity = THREE.MathUtils.clamp(Number(particleSlider.value), 0, 1);
    const extraPayload = options.onParticleDensityChange?.(settings.particleDensity);
    logWebGpuSettingsChange("particleDensity", roundMetric(settings.particleDensity), stateMode, settings, extraPayload);
  });
  particleToggle.addEventListener("click", () => {
    settings.particlesEnabled = !settings.particlesEnabled;
    options.onParticleToggle?.(settings.particlesEnabled);
    updateDiagnosticEffectToggle(particleToggle, settings.particlesEnabled, particleSlider);
    logWebGpuSettingsChange("particlesEnabled", settings.particlesEnabled, stateMode, settings);
  });
  pulseButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const inputEnabled = areDiagnosticInputsEnabled();
    const triggered = isPlayable && inputEnabled ? Boolean(options.player?.triggerPulse()) : false;
    debugEvent("webgpu.pulse.button", "Forced WebGPU pulse button pressed", {
      readinessTier: WEBGPU_READINESS_TIER,
      defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
      remainingGaps: [...WEBGPU_REMAINING_GAPS],
      stateMode,
      isPlayable,
      inputEnabled,
      triggered,
      quality: settings.qualityId,
      particlesEnabled: settings.particlesEnabled,
      particleDensity: roundMetric(settings.particleDensity)
    }, triggered ? "info" : "debug");
  });
}

function setDiagnosticMenuVisible(visible: boolean): void {
  sceneMenuBackdrop.hidden = !visible;
  menuToggle.setAttribute("aria-expanded", String(visible));
  if (visible) {
    sceneMenu.focus({ preventScroll: true });
  } else {
    menuToggle.focus({ preventScroll: true });
  }
}

function syncDiagnosticSkyboxOptions(): void {
  if (skyboxSelect.options.length > 0) return;

  for (const option of SKYBOX_OPTIONS) {
    const optionElement = document.createElement("option");
    optionElement.value = option.id;
    optionElement.textContent = option.label;
    skyboxSelect.append(optionElement);
  }
}

function updateDiagnosticEffectToggle(button: HTMLButtonElement, enabled: boolean, slider: HTMLInputElement): void {
  button.textContent = enabled ? "On" : "Off";
  button.setAttribute("aria-pressed", String(enabled));
  slider.disabled = !enabled;
}

function syncDiagnosticTuningControls(settings: ReturnType<typeof cloneDefaultSettings>): void {
  syncDiagnosticFieldScaleControls(settings);
  syncDiagnosticPlayerSpeedControls(settings);
  surfaceGripSlider.value = String(settings.surfaceGrip);
  updateDiagnosticSurfaceGripValue(settings);
  heightSlider.value = String(settings.rippleHeight);
  radiusSlider.value = String(settings.rippleRadius);
  depthSlider.value = String(settings.waveMedium.effectiveDepth);
  updateDiagnosticDepthSpeedValue(settings);
}

function syncDiagnosticFieldScaleControls(settings: ReturnType<typeof cloneDefaultSettings>): void {
  voxelSizeSlider.value = String(settings.voxelSizeMeters);
  arenaRadiusSlider.value = String(settings.arenaRadiusMeters);
  voxelSizeValue.textContent = settings.voxelSizeMeters < 1
    ? `${Math.round(settings.voxelSizeMeters * 100)} cm`
    : `${settings.voxelSizeMeters.toFixed(2)} m`;
  arenaRadiusValue.textContent = `${Math.round(settings.arenaRadiusMeters)} m`;
}

function updateDiagnosticPlayerSpeedSettingsFromControls(
  settings: ReturnType<typeof cloneDefaultSettings>,
  changedSlider: "walk" | "sprint",
  player: PlayerRig | null | undefined
): void {
  const requestedWalkSpeed = changedSlider === "walk"
    ? Number(walkSpeedSlider.value)
    : settings.playerSpeed.walkSpeedMetersPerSecond;
  const requestedSprintSpeed = Number(sprintSpeedSlider.value);

  settings.playerSpeed = normalizePlayerSpeedSettings({
    walkSpeedMetersPerSecond: requestedWalkSpeed,
    sprintSpeedMetersPerSecond: requestedSprintSpeed
  });
  player?.setSpeedSettings(settings.playerSpeed);
  syncDiagnosticPlayerSpeedControls(settings);
}

function syncDiagnosticPlayerSpeedControls(settings: ReturnType<typeof cloneDefaultSettings>): void {
  const minimumSprintSpeed = getMinimumSprintSpeedMetersPerSecond(
    settings.playerSpeed.walkSpeedMetersPerSecond
  );
  sprintSpeedSlider.min = String(minimumSprintSpeed);
  walkSpeedSlider.value = String(settings.playerSpeed.walkSpeedMetersPerSecond);
  sprintSpeedSlider.value = String(settings.playerSpeed.sprintSpeedMetersPerSecond);
  walkSpeedValue.textContent = `${settings.playerSpeed.walkSpeedMetersPerSecond.toFixed(1)} m/s`;
  sprintSpeedValue.textContent = `${settings.playerSpeed.sprintSpeedMetersPerSecond.toFixed(1)} m/s`;
}

function updateDiagnosticSurfaceGripValue(settings: ReturnType<typeof cloneDefaultSettings>): void {
  surfaceGripValue.textContent = `${Math.round(settings.surfaceGrip * 100)}%`;
}

function updateDiagnosticDepthSpeedValue(settings: ReturnType<typeof cloneDefaultSettings>): void {
  depthSpeedValue.textContent = `${getBasePropagationSpeedMetersPerSecond(settings.waveMedium).toFixed(1)} m/s`;
}

function logWebGpuSettingsChange(
  setting: string,
  value: unknown,
  stateMode: WebGpuStateMode,
  settings: ReturnType<typeof cloneDefaultSettings>,
  extraPayload?: RippleDebugPayload | void
): void {
  const presetSnapshot = getQualityPreset(settings);
  debugEvent("webgpu.settings.change", "Forced WebGPU setting changed", {
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS],
    stateMode,
    setting,
    value,
    ...getWebGpuSettingsDiagnosticFields(createRenderSettingsSnapshot(settings), presetSnapshot),
    quality: settings.qualityId,
    skybox: settings.skyboxId,
    particlesEnabled: settings.particlesEnabled,
    particleDensity: roundMetric(settings.particleDensity),
    bloomEnabled: settings.bloomEnabled,
    bloomStrength: roundMetric(getDiagnosticBloomStrength(settings)),
    ...(extraPayload ?? {})
  }, "info");
}

function applyDiagnosticUiState(
  renderRuntime: WebGpuRenderRuntime,
  time: number,
  frameMs: number,
  delta: number,
  stateMode: WebGpuStateMode = "diagnostic-demo",
  settingsSnapshot?: ReturnType<typeof cloneDefaultSettings>
): void {
  const stats = renderRuntime.getStats();
  const wakeMetrics = renderRuntime.getWakeMetrics();
  const fieldMetrics = renderRuntime.getFieldMetrics();
  const particleMetrics = renderRuntime.getParticleMetrics();
  const skyboxMetrics = renderRuntime.getSkyboxMetrics();
  const bloomMetrics = renderRuntime.getBloomMetrics();
  const lightingMetrics = renderRuntime.getLightingMetrics();
  const echoVisualMetrics = renderRuntime.getEchoVisualMetrics();
  const shadowMetrics = renderRuntime.getShadowMetrics();
  const particlesEnabled = settingsSnapshot?.particlesEnabled ?? particleMetrics.renderedParticles > 0;
  const particleDensity = settingsSnapshot ? roundMetric(settingsSnapshot.particleDensity) : "--";
  const bloomEnabled = settingsSnapshot?.bloomEnabled ?? bloomMetrics.bloomEnabled;
  const bloomStrength = settingsSnapshot ? roundMetric(getDiagnosticBloomStrength(settingsSnapshot)) : roundMetric(bloomMetrics.bloomStrength);
  const hexSize = settingsSnapshot ? formatVoxelSize(settingsSnapshot.voxelSizeMeters) : "--";
  const arenaRadiusMeters = settingsSnapshot ? `${Math.round(settingsSnapshot.arenaRadiusMeters)}m` : "--";
  const waveDepth = settingsSnapshot ? `${roundMetric(settingsSnapshot.waveMedium.effectiveDepth)}m` : "--";
  const waveSpeed = settingsSnapshot ? `${roundMetric(getBasePropagationSpeedMetersPerSecond(settingsSnapshot.waveMedium))}m/s` : "--";
  const surfaceGrip = settingsSnapshot ? `${Math.round(settingsSnapshot.surfaceGrip * 100)}%` : "--";
  qualityBadge.textContent = "WebGPU";
  statsLine.textContent =
    `WebGPU core ${stateMode === "playable" ? "scene" : "harness"} | ${WEBGPU_READINESS_TIER} | default ${WEBGPU_DEFAULT_ELIGIBLE ? "yes" : "no"} | ${formatCompactCount(fieldMetrics.instanceCount)} cells | Echo ${fieldMetrics.activeEchoes}/${fieldMetrics.renderedEchoes} state, GPU ${echoVisualMetrics.renderedEchoes}`;
  mediumLine.textContent =
    `${skyboxMetrics.skyboxId} ${skyboxMetrics.textureTier} | ${fieldMetrics.cameraMode} | hex ${hexSize} | arena ${arenaRadiusMeters} | ${waveDepth}/${waveSpeed} | grip ${surfaceGrip} | particles ${particlesEnabled ? "on" : "off"} ${formatCompactCount(particleMetrics.renderedParticles)}/${formatCompactCount(particleMetrics.particleBudget)} d${particleDensity} | ${lightingMetrics.renderedLocalLights}/${lightingMetrics.localLightLimit} lights | shmap ${shadowMetrics.renderedShadowCasters}/${shadowMetrics.shadowCasterLimit} ${shadowMetrics.shadowMapSize ?? 0}px | bloom ${bloomEnabled ? "on" : "off"} ${bloomStrength} | ${time.toFixed(1)}s`;
  perfOverlayQuality.textContent = "WebGPU";
  perfFrame.textContent = `${frameMs.toFixed(1)} ms`;
  perfUpdate.textContent = "0.0 ms";
  perfRender.textContent = `${stats.gpuCpuSubmitMs.toFixed(1)} ms`;
  perfFps.textContent = delta > 0 ? `${Math.round(1 / delta)}` : "--";
  perfHexes.textContent = formatCompactCount(fieldMetrics.instanceCount);
  perfParticles.textContent =
    `${particlesEnabled ? "on" : "off"} d${particleDensity} | ${formatCompactCount(particleMetrics.activeParticles)}/${formatCompactCount(particleMetrics.particleBudget)} | GPU ${formatCompactCount(particleMetrics.renderedParticles)}`;
  perfWaves.textContent =
    `${fieldMetrics.activeSources} | GPU ${fieldMetrics.renderedSources}/${fieldMetrics.sourceLimit}`;
  perfWake.textContent =
    `${wakeMetrics.mode} | ${wakeMetrics.textureSize}px | ${waveDepth}/${waveSpeed} | ${wakeMetrics.passMs.toFixed(1)} ms`;
  perfRenderer.textContent =
    `${stats.backendId} | ${WEBGPU_READINESS_TIER} | default ${WEBGPU_DEFAULT_ELIGIBLE ? "yes" : "no"} | ${stats.drawCalls}c | ${formatCompactCount(stats.triangles)} tri | hex ${hexSize} | arena ${arenaRadiusMeters} | shmap ${shadowMetrics.renderedShadowCasters}/${shadowMetrics.shadowMapSize ?? 0}px | bloom ${bloomEnabled ? bloomMetrics.bloomPasses : 0}p`;
}

function reportDiagnosticRendererMode(
  renderRuntime: WebGpuRenderRuntime,
  playMode: RenderFrameInput["playMode"],
  raceTrack: RenderFrameInput["raceTrack"]
): void {
  const stats = renderRuntime.getStats();
  debugEvent("renderer.mode", "Renderer mode selected", {
    requestedMode: rendererModeSelection.requestedMode,
    selectionSource: rendererModeSelection.source,
    activeBackend: stats.backendId,
    playMode,
    raceTrackEnabled: raceTrack.enabled,
    raceTrackStrength: roundMetric(raceTrack.strength),
    trackFieldRadius: roundMetric(raceTrack.fieldRadius),
    trackWidthMeters: roundMetric(raceTrack.trackWidthMeters),
    raceTrackMaskWidth: raceTrack.mask.width,
    raceTrackMaskHeight: raceTrack.mask.height,
    raceTrackMaskVersion: raceTrack.mask.version,
    trackMaskUploaded: raceTrack.enabled && raceTrack.mask.version > 0,
    arenaBarrierEnabled: playMode !== "track",
    fieldLayoutMode: raceTrack.enabled ? "track-mask-full-field" : "arena-full",
    culledHexCount: 0,
    fallbackReason: "",
    integrationSurface: "core-render-snapshot",
    readinessTier: WEBGPU_READINESS_TIER,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS],
    maxTextureSize: renderRuntime.capabilities.maxTextureSize,
    supportsBloom: renderRuntime.capabilities.supportsBloom,
    supportsLocalLights: renderRuntime.capabilities.supportsLocalLights,
    shadowMode: stats.shadowMode ?? "",
    shadowMapSize: stats.shadowMapSize ?? 0,
    shadowMapFormat: stats.shadowMapFormat ?? "",
    shadowMapPcfTaps: stats.shadowMapPcfTaps ?? 0,
    shadowGeometryMode: stats.shadowGeometryMode ?? "",
    fieldReceiver: stats.shadowFieldReceiver === true,
    renderedOrbCasters: stats.shadowMapRenderedOrbCasters ?? 0,
    renderedColumnCasters: stats.shadowMapRenderedColumnCasters ?? 0,
    renderedDiscCasters: stats.shadowMapRenderedDiscCasters ?? 0,
    shadowMapProxyTriangles: stats.shadowMapProxyTriangles ?? 0
  }, "info");
}

function resizeDiagnosticRuntime(renderRuntime: WebGpuRenderRuntime, camera?: THREE.PerspectiveCamera): void {
  const { width, height } = getDiagnosticViewportSize();
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  if (camera) {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  renderRuntime.resize(width, height, getDiagnosticPixelRatio());
}

function showWebGpuFatalError(message: string): void {
  wireDiagnosticUi();
  mobileControls.hidden = true;
  qualityBadge.textContent = "WebGPU";
  statsLine.textContent = "Forced WebGPU renderer unavailable";
  mediumLine.textContent = "No WebGL fallback was used for this forced renderer mode.";
  perfOverlayQuality.textContent = "WebGPU";
  perfFrame.textContent = "failed";
  perfUpdate.textContent = "--";
  perfRender.textContent = "--";
  perfFps.textContent = "--";
  perfHexes.textContent = "--";
  perfParticles.textContent = "--";
  perfWaves.textContent = "--";
  perfWake.textContent = "--";
  perfRenderer.textContent = "webgpu unavailable";

  const panel = document.createElement("section");
  panel.style.position = "fixed";
  panel.style.inset = "50% auto auto 50%";
  panel.style.width = "min(620px, calc(100vw - 32px))";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.padding = "18px";
  panel.style.border = "1px solid rgba(255, 125, 231, 0.5)";
  panel.style.borderRadius = "8px";
  panel.style.background = "rgba(2, 4, 9, 0.88)";
  panel.style.color = "#edf7ff";
  panel.style.zIndex = "8";
  panel.style.boxShadow = "0 18px 60px rgba(0, 0, 0, 0.5)";
  panel.innerHTML = `
    <h1 style="margin:0 0 8px;font-size:18px;">WebGPU unavailable</h1>
    <p style="margin:0;color:rgba(237,247,255,0.78);line-height:1.5;"></p>
  `;
  const paragraph = panel.querySelector("p");
  if (paragraph) paragraph.textContent = message;
  app.append(panel);
}

function getDiagnosticViewportSize(): { width: number; height: number } {
  const visualViewport = window.visualViewport;
  return {
    width: Math.round(visualViewport?.width ?? window.innerWidth),
    height: Math.round(visualViewport?.height ?? window.innerHeight)
  };
}

function getDiagnosticPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2.5);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
