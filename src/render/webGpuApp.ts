import * as THREE from "three";
import {
  GAMEPAD_SENSITIVITY_LIMITS,
  SURFACE_GRIP_LIMITS,
  getMinimumBoostSpeedMetersPerSecond,
  normalizePlayerSpeedSettings,
  PlayerRig,
  type PlayAreaConstraint,
  type PlayerJumpEvent
} from "../controls";
import { debugEvent, roundMetric, vectorPayload, type RippleDebugPayload } from "../debugLog";
import {
  GAMEPAD_BUTTON,
  GamepadInput,
  type GamepadNavigationDirection
} from "../gamepadInput";
import {
  EchoZoneStateStore,
  type EchoVisualStateSnapshot,
  type TriggeredEchoZone
} from "../echoState";
import { isFieldPaletteId, resolveFieldPaletteForProfile } from "../fieldPalette";
import { applyFieldInstanceBudget, type FieldScaleChangedControl } from "../fieldScaleGuardrails";
import { formatCompactCount, formatVoxelSize } from "../frameTelemetry";
import { cloneDefaultSettings, getQualityPreset, type LabSettings } from "../labSettings";
import { ParticleVeilState } from "../particleState";
import { wirePauseMenuTabs } from "../pauseMenuTabs";
import {
  ARENA_RADIUS_MAX_METERS,
  ARENA_RADIUS_MIN_METERS,
  VOXEL_SIZE_MAX_METERS,
  VOXEL_SIZE_MIN_METERS,
  isQualityId,
  type QualityPreset
} from "../qualityPresets";
import {
  createRippleFieldLayout,
  type FieldPlacementClipper
} from "../rippleFieldLayout";
import {
  RippleSourceStore,
  sampleRippleSourceLifecycle,
  type RippleRenderSourceSnapshot,
  type RippleSourceOptions
} from "../rippleSources";
import { getSkyboxOption, isSkyboxId, SKYBOX_OPTIONS } from "../skybox";
import { sampleFieldHeight } from "../terrain";
import { TrainingRun, type TrainingCourse, type TrainingHudState } from "../trainingRun";
import { getBasePropagationSpeedMetersPerSecond } from "../waveMedium";
import changelogMarkdown from "../../CHANGELOG.md?raw";
import packageMetadata from "../../package.json";
import type { RendererModeSelection } from "./rendererMode";
import {
  isRenderPresentationProfile,
  persistWebGpuPresentationProfile,
  resolveWebGpuPresentationProfile,
  type PresentationProfileSelection
} from "./presentationProfile";
import {
  applyRenderBenchmarkSettings,
  createRenderBenchmarkMotion,
  isRenderBenchmarkEnabled,
  recordRenderBenchmarkFrame,
  setRenderBenchmarkMetadata
} from "./renderBenchmark";
import {
  createVisualCaptureCourseState,
  createVisualCaptureEchoState,
  createVisualCaptureSourceState,
  createRenderVisualCaptureController,
  hashVisualCaptureNumbers,
  type RenderVisualCaptureController
} from "./renderVisualCapture";
import {
  RENDER_SCENE_LOCAL_LIGHT_LIMIT,
  RENDER_SCENE_SHADOW_CASTER_LIMIT,
  type RenderAvatarPresentationSnapshot,
  type RenderFrameInput,
  type RenderRaceTrackMaskSnapshot,
  type RenderRaceTrackSnapshot,
  type RenderRaceTrackWallSnapshot,
  type RenderSceneLightingSnapshot,
  type RenderSceneLocalLightSnapshot,
  type RenderSceneShadowCasterSnapshot,
  type RenderSceneShadowSnapshot,
  type RenderTrainingSnapshot,
  type RenderVector3Snapshot,
  type RenderPresentationProfile
} from "./types";
import { WebGpuRenderRuntime } from "./webGpuRenderRuntime";
import { WEBGPU_MOTE_AVATAR_ASSET_ID } from "./webGpuMoteAvatarAsset";

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
const ECHO_ZONE_TRACK_SEED_FRACTIONS = [0.08, 0.39, 0.68] as const;
const ECHO_ZONE_ARENA_SEED_POLAR = [
  { angle: 0.14, radius: 0.36 },
  { angle: 0.52, radius: 0.46 },
  { angle: 0.82, radius: 0.32 }
] as const;
const ECHO_ZONE_BURST_STRENGTH = 0.76;
const ECHO_ZONE_DISC_BURST_RADIUS = 8.6;
const ECHO_DISC_BURST_PARTICLE_CAP_RATIO = 0.16;
const ECHO_DISC_BURST_MIN_PARTICLE_CAP = 5000;
const SIM_STEP_SECONDS = 1 / 60;
const MAX_SIM_FRAME_SECONDS = 0.25;
const MAX_SIM_STEPS_PER_FRAME = 10;
const MIN_SIM_REMAINING_SECONDS = 0.000001;
const WEBGPU_BLOOM_STRENGTH_CAP = 0.32;
const WEBGPU_READINESS_TIER = "diagnostic-core";
const WEBGPU_DEFAULT_ELIGIBLE = false;
const WEBGPU_ROLLOUT_STAGE = "stage-0-disabled";
const WEBGPU_REMAINING_GAPS: string[] = [];
const RENDERER_FRAME_SAMPLE_SECONDS = 0.5;
const DEFAULT_READINESS_FRAME_SECONDS = 2;
const DEFAULT_READINESS_SUMMARY_SECONDS = 90;
const PULSE_LIGHT_COLORS: readonly RenderVector3Snapshot[] = [
  { x: 0.49, y: 1, z: 0.85 },
  { x: 0.49, y: 0.58, z: 1 },
  { x: 1, y: 0.83, z: 0.42 },
  { x: 1, y: 0.49, z: 0.91 }
];

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

type AppState = "mainMenu" | "playing" | "paused";
type PlayModeId = "arena" | "track" | "training";

type WebGpuDom = ReturnType<typeof getDom>;

declare global {
  interface Window {
    __rippleDebugForceWebGpuDeviceLoss?: () => void;
    __rippleDebugForceWebGpuRuntimeFailure?: () => void;
  }
}

export type WebGpuCourseGameplay = PlayAreaConstraint & TrainingCourse & {
  setArena(fieldRadius: number, arenaRadiusMeters: number, reason?: string): void;
  containsPoint(x: number, z: number, marginSceneUnits?: number): boolean;
  getFieldRadius(): number;
  getTrackWidthMeters(): number;
  getSceneUnitsPerMeter(): number;
  getSafeEchoJitterMeters(echoRadiusSceneUnits: number): number;
  getMaskSnapshot(): RenderRaceTrackMaskSnapshot;
  getWallSnapshot(): RenderRaceTrackWallSnapshot;
};

export type WebGpuCourseGameplayFactory = (
  fieldRadius: number,
  arenaRadiusMeters: number
) => WebGpuCourseGameplay;

export async function startWebGpuApp(
  rendererModeSelection: RendererModeSelection,
  createCourseGameplay: WebGpuCourseGameplayFactory
): Promise<void> {
  const dom = getDom();
  const presentationSelection = resolveWebGpuPresentationProfile();
  const runtimeHolder: { current: WebGpuRenderRuntime | null } = { current: null };
  const cleanupHolder: { current: (() => void) | null } = { current: null };
  try {
    await startWebGpuAppInternal(
      rendererModeSelection,
      createCourseGameplay,
      presentationSelection,
      dom,
      (runtime) => { runtimeHolder.current = runtime; },
      (cleanup) => { cleanupHolder.current = cleanup; }
    );
  } catch (error) {
    try {
      if (cleanupHolder.current) cleanupHolder.current();
      else {
        delete window.__rippleDebugForceWebGpuDeviceLoss;
        delete window.__rippleDebugForceWebGpuRuntimeFailure;
        runtimeHolder.current?.destroy();
      }
    } catch (cleanupError) {
      debugEvent("webgpu.cleanup.error", "WebGPU cleanup failed after startup error", {
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }, "warn");
    }
    const message = error instanceof Error ? error.message : String(error);
    reportWebGpuFatalFailure(dom, rendererModeSelection, presentationSelection.profile, message, "startup");
  }
}

async function startWebGpuAppInternal(
  rendererModeSelection: RendererModeSelection,
  createCourseGameplay: WebGpuCourseGameplayFactory,
  presentationSelection: PresentationProfileSelection,
  dom: WebGpuDom,
  registerRuntime: (runtime: WebGpuRenderRuntime) => void,
  registerCleanup: (cleanup: () => void) => void
): Promise<void> {
  const settings = cloneDefaultSettings();
  applyRenderBenchmarkSettings(settings);
  let preset = getQualityPreset(settings);
  let presentationProfile = presentationSelection.profile;
  let particleState = new ParticleVeilState(preset.particleBudget);
  const rippleSources = new RippleSourceStore();
  const echoState = new EchoZoneStateStore();
  const gamepad = new GamepadInput();
  const raceTrack = createCourseGameplay(preset.fieldRadius, settings.arenaRadiusMeters);
  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
  const clock = new THREE.Clock();
  const previousPlayerPosition = new THREE.Vector3();
  const benchmarkPlayerPosition = new THREE.Vector3();
  const benchmarkPlayerVelocity = new THREE.Vector3();
  let fieldLayout = createRippleFieldLayout(preset);
  let appState: AppState = "mainMenu";
  let activePlayMode: PlayModeId | null = null;
  let simulationTimeSeconds = 0;
  let nextEchoZoneAt = ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
  let lastRendererFrameSampleAt = -Infinity;
  let lastDefaultReadinessFrameAt = -Infinity;
  let lastDefaultReadinessSummaryAt = -Infinity;
  let lastFrameUpdateMs = 0;
  let lastFrameSnapshotMs = 0;
  let lastFrameRenderMs = 0;
  let perfOverlayVisible = false;
  let changelogVisible = false;
  let lastGamepadStatusText = "";
  let pointerLockWasActive = false;
  let suppressNextPointerUnlockMenu = false;
  const uiAbortController = new AbortController();
  let playerReference: PlayerRig | null = null;
  let visualCaptureReference: RenderVisualCaptureController | null = null;
  let initialReadinessFrameId = 0;
  let runtimeReference: WebGpuRenderRuntime | null = null;
  let runtimeFatalFailureShown = false;
  let forceRuntimeFailureOnNextFrame = false;
  let runtime: WebGpuRenderRuntime;

  const cleanupAfterTerminalFailure = (): void => {
    const cleanupErrors: string[] = [];
    const attempt = (label: string, action: () => void): void => {
      try {
        action();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    attempt("ui", () => uiAbortController.abort());
    const playerToDispose = playerReference;
    playerReference = null;
    if (playerToDispose) attempt("player", () => playerToDispose.dispose());
    const captureToDestroy = visualCaptureReference;
    visualCaptureReference = null;
    if (captureToDestroy) attempt("visual-capture", () => captureToDestroy.destroy());
    if (initialReadinessFrameId !== 0) {
      attempt("readiness-frame", () => cancelAnimationFrame(initialReadinessFrameId));
      initialReadinessFrameId = 0;
    }
    const runtimeToDestroy = runtimeReference;
    runtimeReference = null;
    if (document.pointerLockElement === runtimeToDestroy?.canvas) {
      attempt("pointer-lock", () => document.exitPointerLock());
    }
    if (runtimeToDestroy) {
      attempt("animation-loop", () => runtimeToDestroy.setAnimationLoop(null));
      attempt("runtime", () => runtimeToDestroy.destroy());
    }
    delete window.__rippleDebugForceWebGpuDeviceLoss;
    delete window.__rippleDebugForceWebGpuRuntimeFailure;
    if (cleanupErrors.length > 0) {
      debugEvent("webgpu.cleanup.error", "WebGPU terminal cleanup completed with errors", {
        errors: cleanupErrors
      }, "warn");
    }
  };

  const handleDeviceLost = (info: GPUDeviceLostInfo): void => {
    if (runtimeFatalFailureShown) return;
    runtimeFatalFailureShown = true;
    cleanupAfterTerminalFailure();
    const reason = info.reason === "unknown" ? "unknown reason" : info.reason;
    const detail = info.message ? `: ${info.message}` : "";
    reportWebGpuFatalFailure(
      dom,
      rendererModeSelection,
      presentationProfile,
      `WebGPU device lost (${reason})${detail}`,
      "device-lost"
    );
  };

  const handleRuntimeFailure = (error: unknown): void => {
    if (runtimeFatalFailureShown) return;
    runtimeFatalFailureShown = true;
    const message = error instanceof Error ? error.message : String(error);
    cleanupAfterTerminalFailure();
    reportWebGpuFatalFailure(
      dom,
      rendererModeSelection,
      presentationProfile,
      message,
      "runtime"
    );
  };

  try {
    runtime = await WebGpuRenderRuntime.create({
      app: dom.app,
      log: debugEvent,
      fallbackReason: "",
      initialQualityPreset: preset,
      initialSkyboxId: settings.skyboxId,
      initialPresentationProfile: presentationProfile,
      onDeviceLost: handleDeviceLost
    });
    runtimeReference = runtime;
    registerRuntime(runtime);
    registerCleanup(cleanupAfterTerminalFailure);
    window.__rippleDebugForceWebGpuDeviceLoss = () => runtime.forceDeviceLossForVerification();
    window.__rippleDebugForceWebGpuRuntimeFailure = () => {
      forceRuntimeFailureOnNextFrame = true;
    };
    if (runtimeFatalFailureShown || runtime.capabilities.deviceLost) {
      cleanupAfterTerminalFailure();
      return;
    }
    setRenderBenchmarkMetadata({
      presentationProfile,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: (navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory ?? null
    });
    debugEvent("webgpu.presentation.init", "Initialized WebGPU presentation profile", {
      presentationProfile,
      presentationProfileSource: presentationSelection.source,
      rejectedPresentationProfile: presentationSelection.rejectedValue,
      defaultPresentationProfile: "classic"
    }, "info");
    if (presentationSelection.rejectedValue !== null) {
      debugEvent("webgpu.presentation.invalid", "Rejected invalid WebGPU presentation profile", {
        rejectedPresentationProfile: presentationSelection.rejectedValue,
        resolvedPresentationProfile: presentationProfile,
        presentationProfileSource: presentationSelection.source
      }, "warn");
    }
  } catch (error) {
    if (runtimeReference) cleanupAfterTerminalFailure();
    if (runtimeFatalFailureShown) return;
    const message = error instanceof Error ? error.message : String(error);
    reportWebGpuFatalFailure(dom, rendererModeSelection, presentationProfile, message, "startup");
    return;
  }

  const trainingRun = new TrainingRun(null, {
    sampleHeight: sampleFieldHeight,
    spawnEchoAtTrackFraction: (fraction, lateralOffsetMeters, time) => {
      echoState.clear();
      nextEchoZoneAt = Infinity;
      return spawnEchoAtTrackFraction(fraction, lateralOffsetMeters, time);
    },
    spawnCelebrationPulse: (position, time) => spawnPulse(position, 0.46, ECHO_BURST_OPTIONS, time)
  });

  const player = new PlayerRig({
    canvas: runtime.canvas,
    camera,
    sampleHeight: sampleFieldHeight,
    getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
    onPulse: (position) => spawnPulse(position, 0.45),
    onQuietPointerUnlock: () => {
      suppressNextPointerUnlockMenu = true;
    },
    onJump: (event) => {
      triggerJumpRipple(event, JUMP_TAKEOFF_OPTIONS, "Player jumped from field surface");
      gamepad.playHaptic({ durationMs: 70, strongMagnitude: 0.08, weakMagnitude: 0.22 });
    },
    onLand: (event) => {
      triggerJumpRipple(event, JUMP_LANDING_OPTIONS, "Player landed on field surface");
      gamepad.playHaptic({ durationMs: 125, strongMagnitude: 0.34, weakMagnitude: 0.18 });
    },
    gamepad,
    speedSettings: settings.playerSpeed,
    surfaceGrip: settings.surfaceGrip,
    gamepadSensitivity: settings.gamepadSensitivity,
    isInputEnabled: () => appState === "playing" && activePlayMode !== null && !changelogVisible
  });
  playerReference = player;

  wireUi();
  wirePauseMenuTabs();
  dom.presentationProfileRow.hidden = false;
  syncControlValues();
  resize();
  runtime.prewarm();

  const visualCapture = createRenderVisualCaptureController({
    fixedStepSeconds: SIM_STEP_SECONDS,
    describe: describeWebGpuVisualCapture,
    waitForGpuIdle: () => runtime.waitForGpuIdle()
  });
  visualCaptureReference = visualCapture;

  const requestedMode = readRequestedPlayMode();
  if (requestedMode) {
    startGame(requestedMode, "query");
  } else {
    showMainMenu(false, "startup");
  }

  runtime.setAnimationLoop(animate);

  function startGame(mode: PlayModeId, reason = "menu"): void {
    activePlayMode = mode;
    appState = "playing";
    changelogVisible = false;
    dom.changelogBackdrop.hidden = true;
    dom.sceneMenuBackdrop.hidden = true;
    applyPlayMode(mode, reason);
    updateAppChrome();
    emitRendererMode();

    debugEvent("mode.select", "Started Ripple Field Lab play mode", {
      mode,
      reason,
      backend: "webgpu",
      quality: preset.id,
      hexCount: fieldLayout.instanceCount,
      buildStats: fieldLayout.buildStats
    }, "info");
  }

  function showMainMenu(shouldFocus = true, reason = "exit"): void {
    if (document.pointerLockElement === runtime.canvas) document.exitPointerLock();
    activePlayMode = null;
    appState = "mainMenu";
    resetSimulationClock();
    resetRuntimeState("main-menu");
    player.setPlayAreaConstraint(null);
    const spawn = createArenaSpawnPoint();
    player.resetForSession(spawn.position, spawn.facingYaw);
    previousPlayerPosition.copy(player.position);
    rebuildFieldLayout("main-menu");
    updateAppChrome();
    emitRendererMode();
    debugEvent("mode.menu", "Returned to main menu", { reason, quality: preset.id, backend: "webgpu" }, "info");
    if (shouldFocus) dom.startTrainingButton.focus({ preventScroll: true });
  }

  function applyPlayMode(mode: PlayModeId, reason: string): void {
    if (mode === "arena") {
      applyFieldInstanceBudget(settings, "arena-radius", isFieldStressModeEnabled());
      preset = getQualityPreset(settings);
    }

    raceTrack.setArena(preset.fieldRadius, settings.arenaRadiusMeters, `mode-${reason}`);
    const usesCourse = isCourseMode(mode);
    const spawn = usesCourse ? createTrackSpawnPoint() : createArenaSpawnPoint();
    const constraint: PlayAreaConstraint | null = usesCourse ? raceTrack : null;
    player.setPlayAreaConstraint(constraint);
    player.resetForSession(spawn.position, spawn.facingYaw);
    previousPlayerPosition.copy(player.position);
    resetSimulationClock();
    resetRuntimeState(`mode-${reason}`);
    rebuildFieldLayout(`mode-${reason}`);

    if (mode === "training") {
      trainingRun.start(simulationTimeSeconds, player.position, player.getTelemetry(), raceTrack);
    } else {
      seedStartupPulses(simulationTimeSeconds);
      seedEchoZones(simulationTimeSeconds);
    }
    updateTrainingHud();
  }

  function resetSimulationClock(): void {
    simulationTimeSeconds = 0;
    lastRendererFrameSampleAt = -Infinity;
    lastDefaultReadinessFrameAt = -Infinity;
    lastDefaultReadinessSummaryAt = -Infinity;
  }

  function resetRuntimeState(reason: string): void {
    rippleSources.clear();
    echoState.clear();
    trainingRun.reset(reason);
    particleState.clear();
    runtime.resetSession(reason);
    nextEchoZoneAt = simulationTimeSeconds + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
  }

  function rebuildFieldLayout(reason: string): void {
    const clipper = getActiveFieldPlacementClipper();
    fieldLayout = createRippleFieldLayout(preset, clipper);
    runtime.applyFieldLayout(fieldLayout, reason);
  }

  function rebuildActiveModeAfterSettingsChange(reason: string): void {
    const rebuildStartedAt = performance.now();
    rebuildFieldLayout(reason);
    let echoZonesReseeded = false;

    if (activePlayMode === "training") {
      echoState.clear();
      trainingRun.reset(reason);
      trainingRun.start(simulationTimeSeconds, player.position, player.getTelemetry(), raceTrack);
      nextEchoZoneAt = Infinity;
      echoZonesReseeded = true;
    } else if (activePlayMode) {
      echoState.clear();
      seedEchoZones(simulationTimeSeconds);
      echoZonesReseeded = true;
    }

    updateTrainingHud();
    updateAppChrome();
    debugEvent("field.rebuild", "Rebuilt WebGPU field without resetting the active run", {
      backend: "webgpu",
      reason,
      mode: activePlayMode ?? "none",
      durationMs: roundMetric(performance.now() - rebuildStartedAt),
      sessionPreserved: true,
      simulationTimeSeconds: roundMetric(simulationTimeSeconds),
      playerPosition: vectorPayload(player.position),
      echoZonesReseeded,
      quality: preset.id,
      hexCount: fieldLayout.instanceCount,
      buildStats: fieldLayout.buildStats
    }, "info");
  }

  function getActiveFieldPlacementClipper(): FieldPlacementClipper | null {
    if (!isCourseMode(activePlayMode)) return null;
    const safetySkirtSceneUnits =
      TRACK_FIELD_SAFETY_SKIRT_METERS * raceTrack.getSceneUnitsPerMeter() + preset.tileSpacing * 2;
    return {
      label: "race-track-ribbon",
      containsPoint: (x, z) => raceTrack.containsPoint(x, z, safetySkirtSceneUnits)
    };
  }

  function createTrackSpawnPoint(): { position: THREE.Vector3; facingYaw: number } {
    const point = raceTrack.samplePointAt(0);
    return {
      position: new THREE.Vector3(point.x, sampleFieldHeight(point.x, point.z) + PLAYER_START_HEIGHT, point.z),
      facingYaw: raceTrack.getFacingYawAt(0)
    };
  }

  function createArenaSpawnPoint(): { position: THREE.Vector3; facingYaw: number } {
    return {
      position: new THREE.Vector3(0, sampleFieldHeight(0, 0) + PLAYER_START_HEIGHT, 0),
      facingYaw: Math.PI * 0.23
    };
  }

  function seedStartupPulses(time: number): void {
    if (isCourseMode(activePlayMode)) {
      const jitter = raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS);
      const first = raceTrack.samplePointAt(0.02, -jitter * 0.12);
      const second = raceTrack.samplePointAt(0.11, jitter * 0.18);
      first.y = sampleFieldHeight(first.x, first.z) + 0.45;
      second.y = sampleFieldHeight(second.x, second.z) + 0.45;
      spawnPulse(first, 0.28, MANUAL_PULSE_OPTIONS, time);
      spawnPulse(second, 0.18, MANUAL_PULSE_OPTIONS, time);
      return;
    }
    spawnPulse(new THREE.Vector3(0, sampleFieldHeight(0, 0) + 0.45, 0), 0.28, MANUAL_PULSE_OPTIONS, time);
    spawnPulse(new THREE.Vector3(9, sampleFieldHeight(9, -7) + 0.45, -7), 0.18, MANUAL_PULSE_OPTIONS, time);
  }

  function spawnPulse(
    position: THREE.Vector3,
    strength: number,
    options: RippleSourceOptions = MANUAL_PULSE_OPTIONS,
    time = simulationTimeSeconds
  ): void {
    rippleSources.add(position, time, strength, options);
    if (!settings.particlesEnabled) return;
    const count = Math.max(0, Math.floor(
      preset.burstParticleCount * settings.particleDensity * (0.42 + strength * 1.7)
    ));
    particleState.spawnPulseBurst(position, count, strength);
  }

  function triggerJumpRipple(event: PlayerJumpEvent, options: RippleSourceOptions, message: string): void {
    spawnPulse(event.position, event.strength, options);
    debugEvent("player.jump", message, {
      time: roundMetric(simulationTimeSeconds),
      strength: roundMetric(event.strength),
      airtimeSeconds: roundMetric(event.airtimeSeconds),
      impactSpeed: roundMetric(event.impactSpeed),
      position: vectorPayload(event.position)
    }, "info");
  }

  function seedEchoZones(time: number): void {
    if (!activePlayMode || activePlayMode === "training") return;
    if (activePlayMode === "track") {
      for (let index = 0; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
        const fraction = ECHO_ZONE_TRACK_SEED_FRACTIONS[index] ?? index / ECHO_ZONE_INITIAL_COUNT;
        const lateral = index === 1
          ? raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.34
          : -raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS) * 0.22;
        if (!spawnEchoAtTrackFraction(fraction, lateral, time)) {
          spawnRandomTrackEcho(time);
        }
      }
    } else {
      for (let index = 0; index < ECHO_ZONE_INITIAL_COUNT; index += 1) {
        const seed = ECHO_ZONE_ARENA_SEED_POLAR[index] ?? { angle: index / ECHO_ZONE_INITIAL_COUNT, radius: 0.4 };
        const position = createArenaEchoSeedPosition(seed.angle, seed.radius);
        if (!position || !echoState.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) {
          spawnRandomArenaEcho(time);
          continue;
        }
        addEcho(position, time);
      }
    }
    nextEchoZoneAt = time + ECHO_ZONE_SPAWN_INTERVAL_SECONDS;
    echoState.logInit(time);
  }

  function maybeSpawnEchoZone(time: number): void {
    if (isRenderBenchmarkEnabled()) return;
    if (!activePlayMode || activePlayMode === "training" || time < nextEchoZoneAt) return;
    if (echoState.getActiveCount() >= ECHO_ZONE_MAX_ACTIVE) {
      nextEchoZoneAt = time + 1;
      return;
    }

    const spawned = activePlayMode === "track"
      ? spawnRandomTrackEcho(time)
      : spawnRandomArenaEcho(time);
    nextEchoZoneAt = time + (spawned ? ECHO_ZONE_SPAWN_INTERVAL_SECONDS : 1.2);
  }

  function spawnRandomTrackEcho(time: number): boolean {
    const maxJitter = raceTrack.getSafeEchoJitterMeters(ECHO_ZONE_RADIUS);
    for (let attempt = 0; attempt < ECHO_ZONE_SPAWN_ATTEMPTS; attempt += 1) {
      const position = raceTrack.samplePointAt(Math.random(), (Math.random() * 2 - 1) * maxJitter);
      position.y = sampleFieldHeight(position.x, position.z) + 0.16;
      if (Math.hypot(position.x - player.position.x, position.z - player.position.z) < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
      if (!echoState.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;
      addEcho(position, time);
      return true;
    }
    return false;
  }

  function spawnRandomArenaEcho(time: number): boolean {
    for (let attempt = 0; attempt < ECHO_ZONE_SPAWN_ATTEMPTS; attempt += 1) {
      const radius = Math.sqrt(Math.random()) * Math.max(0, preset.fieldRadius - ECHO_ZONE_RADIUS - PLAYER_BOUNDARY_PADDING);
      const angle = Math.random() * Math.PI * 2;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      );
      position.y = sampleFieldHeight(position.x, position.z) + 0.16;
      if (Math.hypot(position.x - player.position.x, position.z - player.position.z) < ECHO_ZONE_MIN_PLAYER_DISTANCE) continue;
      if (!echoState.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) continue;
      addEcho(position, time);
      return true;
    }
    return false;
  }

  function spawnEchoAtTrackFraction(fraction: number, lateralOffsetMeters: number, time: number): boolean {
    const position = raceTrack.samplePointAt(fraction, lateralOffsetMeters);
    position.y = sampleFieldHeight(position.x, position.z) + 0.16;
    if (!echoState.isPositionClear(position, ECHO_ZONE_MIN_ZONE_DISTANCE)) return false;
    addEcho(position, time);
    return true;
  }

  function createArenaEchoSeedPosition(angleFraction: number, radiusFraction: number): THREE.Vector3 | null {
    const maxRadius = Math.max(0, preset.fieldRadius - ECHO_ZONE_RADIUS - PLAYER_BOUNDARY_PADDING);
    const angle = angleFraction * Math.PI * 2;
    const position = new THREE.Vector3(
      Math.cos(angle) * maxRadius * radiusFraction,
      0,
      Math.sin(angle) * maxRadius * radiusFraction
    );
    position.y = sampleFieldHeight(position.x, position.z) + 0.16;
    return Math.hypot(position.x - player.position.x, position.z - player.position.z) >= ECHO_ZONE_MIN_PLAYER_DISTANCE
      ? position
      : null;
  }

  function addEcho(position: THREE.Vector3, time: number): void {
    echoState.add(position, time, {
      radius: ECHO_ZONE_RADIUS,
      triggerRadius: ECHO_ZONE_TRIGGER_RADIUS,
      burstStrength: ECHO_ZONE_BURST_STRENGTH,
      discBurstRadius: ECHO_ZONE_DISC_BURST_RADIUS
    });
  }

  function collectEchoZones(time: number): void {
    const triggered = echoState.collectAt(player.position, time);
    if (triggered.length > 0) {
      gamepad.playHaptic({ durationMs: 240, strongMagnitude: 0.58, weakMagnitude: 0.72 });
    }
    for (const echo of triggered) triggerEchoZone(echo, time);
  }

  function triggerEchoZone(echo: TriggeredEchoZone, time: number): void {
    if (activePlayMode === "training") {
      trainingRun.handleEchoCollected(time, player.getTelemetry(), raceTrack);
    }
    rippleSources.add(echo.position, time, echo.burstStrength, ECHO_BURST_OPTIONS);
    const cap = Math.max(ECHO_DISC_BURST_MIN_PARTICLE_CAP, preset.particleBudget * ECHO_DISC_BURST_PARTICLE_CAP_RATIO);
    const requested = Math.min(cap, Math.floor(
      preset.burstParticleCount * settings.particleDensity * (0.58 + echo.burstStrength * 0.45)
    ));
    const emittedParticleCount = settings.particlesEnabled
      ? particleState.spawnDiscBurst(echo.effectPosition, requested, echo.burstStrength, echo.discBurstRadius)
      : 0;
    debugEvent("echo.collect", "Finished Echo detonation gameplay burst", {
      id: echo.id,
      time: roundMetric(time),
      emittedParticleCount,
      activeEchoes: echoState.getActiveCount(),
      activeVisualBursts: echoState.getCollectBurstCount()
    }, "info");
  }

  function animate(frameTimestampMs = performance.now()): void {
    if (runtimeFatalFailureShown) return;
    try {
      animateFrame(frameTimestampMs);
    } catch (error) {
      handleRuntimeFailure(error);
    }
  }

  function animateFrame(frameTimestampMs: number): void {
    // Poll once per rendered frame before fixed-step catch-up so consumable
    // button edges can only trigger one gameplay action.
    gamepad.poll();
    handleGamepadUiInput();
    updateGamepadStatus();
    const rawDelta = visualCapture.resolveFrameDelta(clock.getDelta());
    const frameStartedAt = performance.now();
    const simulatedDelta = runSimulationFrame(rawDelta);
    visualCapture.recordSimulation(simulatedDelta);

    if (appState === "playing" && simulatedDelta > 0 && settings.particlesEnabled) {
      const speed = player.getSpeed();
      const contact = player.getGroundContactStrength();
      particleState.spawnAura(player.position, simulatedDelta * settings.particleDensity, speed / 18);
      particleState.spawnWake(
        player.position,
        simulatedDelta * settings.particleDensity,
        (speed / 18) * contact,
        player.velocity
      );
      particleState.update(simulatedDelta);
    }

    echoState.update(simulationTimeSeconds);
    const updateFinishedAt = performance.now();
    lastFrameUpdateMs = updateFinishedAt - frameStartedAt;
    const input = createRenderInput(simulatedDelta);
    const renderStartedAt = performance.now();
    lastFrameSnapshotMs = renderStartedAt - updateFinishedAt;
    runtime.beginFrame();
    if (forceRuntimeFailureOnNextFrame) {
      forceRuntimeFailureOnNextFrame = false;
      throw new Error("Forced WebGPU runtime frame failure for verification.");
    }
    runtime.renderFrame(input);
    lastFrameRenderMs = performance.now() - renderStartedAt;
    recordWebGpuBenchmarkFrame(input, frameTimestampMs);
    updateRuntimeUi(input, rawDelta);
    emitFrameDiagnostics(input, performance.now() - frameStartedAt);
    previousPlayerPosition.copy(player.position);
    visualCapture.afterRender();
  }

  function recordWebGpuBenchmarkFrame(input: RenderFrameInput, frameTimestampMs: number): void {
    const stats = runtime.getStats();
    const fieldMetrics = runtime.getFieldMetrics();
    recordRenderBenchmarkFrame({
      backendId: "webgpu",
      updateCpuMs: lastFrameUpdateMs,
      snapshotCpuMs: lastFrameSnapshotMs,
      renderCpuMs: lastFrameRenderMs,
      gpuFrameMs: stats.gpuFrameMs ?? null,
      gpuFrameSequence: stats.gpuFrameSequence ?? null,
      gpuTimerMode: stats.gpuTimerMode ?? "unavailable",
      gpuTimerErrorCount: stats.gpuTimerErrorCount ?? 0,
      semantic: {
        playMode: input.playMode,
        qualityId: input.qualityPreset.id,
        fieldInstances: fieldMetrics.instanceCount,
        particleBudget: input.particleState.particleBudget,
        activeParticles: input.particleState.activeParticles,
        activeSources: input.pulseSources.activeCount,
        activeEchoes: input.echoVisualState.activeEchoes,
        playerSpeed: input.player.speed,
        bloomEnabled: input.bloomStrength > 0.02,
        shadowMode: stats.shadowMode ?? "disabled",
        viewportWidth: runtime.canvas.width,
        viewportHeight: runtime.canvas.height,
        pixelRatio: stats.pixelRatio,
        deviceLost: stats.deviceLost
      }
    }, frameTimestampMs);
  }

  function describeWebGpuVisualCapture(tick: number): Readonly<Record<string, unknown>> {
    const input = createRenderInput(0);
    const fieldMetrics = runtime.getFieldMetrics();
    const particleMetrics = runtime.getParticleMetrics();
    return {
      backendId: "webgpu",
      presentationProfile: input.scenePresentation.profile,
      fieldPalette: input.settings.fieldPaletteId,
      resolvedFieldPalette: fieldMetrics.fieldPalette,
      playMode: input.playMode,
      tick,
      simulationTimeSeconds,
      qualityId: input.qualityPreset.id,
      fieldInstances: fieldMetrics.instanceCount,
      activeSources: input.pulseSources.activeCount,
      activeEchoes: input.echoVisualState.activeEchoes,
      activeParticles: particleMetrics.activeParticles,
      sourceState: createVisualCaptureSourceState(input.pulseSources),
      echoState: createVisualCaptureEchoState(input.echoVisualState),
      field: {
        mode: fieldLayout.buildStats.mode,
        fullHexCount: fieldLayout.buildStats.fullHexCount,
        culledHexCount: fieldLayout.buildStats.culledHexCount,
        instanceCount: fieldLayout.buildStats.instanceCount
      },
      course: createVisualCaptureCourseState(
        input.raceTrack.enabled,
        input.raceTrack.mask,
        input.raceTrack.walls
      ),
      player: {
        position: input.player.position,
        velocity: input.player.velocity,
        speed: input.player.speed,
        groundContact: input.player.groundContact,
        facingYawRadians: input.player.facingYawRadians
      },
      camera: {
        position: input.camera.position,
        quaternion: input.camera.quaternion,
        viewProjectionMatrix: input.camera.viewProjectionMatrix
      },
      training: input.training.enabled ? {
        active: input.training.active,
        complete: input.training.complete,
        stepId: input.training.stepId,
        stepIndex: input.training.stepIndex,
        markerVisible: input.training.marker.visible,
        markerDigest: hashVisualCaptureNumbers([
          input.training.marker.position.x,
          input.training.marker.position.y,
          input.training.marker.position.z,
          input.training.marker.facingYawRadians
        ])
      } : null,
      viewport: {
        width: runtime.canvas.width,
        height: runtime.canvas.height,
        pixelRatio: runtime.getStats().pixelRatio
      }
    };
  }

  function runSimulationFrame(rawDelta: number): number {
    if (appState !== "playing") return 0;
    let remainingDelta = Math.min(Math.max(0, rawDelta), MAX_SIM_FRAME_SECONDS);
    let simulatedDelta = 0;
    let steps = 0;

    while (remainingDelta > MIN_SIM_REMAINING_SECONDS && steps < MAX_SIM_STEPS_PER_FRAME) {
      const stepDelta = Math.min(SIM_STEP_SECONDS, remainingDelta);
      simulationTimeSeconds += stepDelta;
      if (isRenderBenchmarkEnabled()) updateBenchmarkPlayer(stepDelta, simulationTimeSeconds);
      else player.update(stepDelta, simulationTimeSeconds);
      if (activePlayMode === "training") {
        trainingRun.update({
          time: simulationTimeSeconds,
          playerPosition: player.position,
          telemetry: player.getTelemetry(),
          raceTrack
        });
        updateTrainingHud();
      }
      collectEchoZones(simulationTimeSeconds);
      maybeSpawnEchoZone(simulationTimeSeconds);
      simulatedDelta += stepDelta;
      remainingDelta -= stepDelta;
      steps += 1;
    }
    return simulatedDelta;
  }

  function updateBenchmarkPlayer(delta: number, time: number): void {
    const motion = createRenderBenchmarkMotion(
      time,
      delta,
      preset.fieldRadius,
      isCourseMode(activePlayMode)
        ? (fraction) => raceTrack.samplePointAt(fraction)
        : null
    );
    benchmarkPlayerPosition.set(
      motion.x,
      sampleFieldHeight(motion.x, motion.z) + PLAYER_START_HEIGHT,
      motion.z
    );
    benchmarkPlayerVelocity.set(motion.velocityX, 0, motion.velocityZ);
    player.applyScriptedPose(
      benchmarkPlayerPosition,
      benchmarkPlayerVelocity,
      motion.facingYawRadians,
      delta,
      time
    );
  }

  function createRenderInput(delta: number): RenderFrameInput {
    const viewport = getViewportSize();
    const pulseSources = rippleSources.getRenderSourceSnapshot(
      simulationTimeSeconds,
      fieldLayout.renderedRippleSourceLimit
    );
    const echoVisualState = echoState.getRenderSnapshot(simulationTimeSeconds);
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
      time: simulationTimeSeconds,
      delta,
      playMode: activePlayMode ?? "none",
      fieldLayout,
      raceTrack: createRaceTrackSnapshot(),
      training: createTrainingSnapshot(),
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
      scenePresentation: createScenePresentationSnapshot(settings, preset, presentationProfile),
      avatarPresentation,
      sceneLighting: createSceneLightingSnapshot(
        settings,
        playerSnapshot,
        pulseSources,
        echoVisualState,
        simulationTimeSeconds
      ),
      sceneShadows: createSceneShadowSnapshot(
        settings,
        playerSnapshot,
        pulseSources,
        echoVisualState,
        simulationTimeSeconds
      ),
      settings: createRenderSettingsSnapshot(settings),
      qualityPreset: { ...preset },
      pulseSources,
      echoVisualState,
      particleState: particleState.getSnapshot(),
      bloomStrength: getWebGpuBloomStrength(settings)
    };
  }

  function createRaceTrackSnapshot(): RenderRaceTrackSnapshot {
    if (!isCourseMode(activePlayMode)) return createDisabledRaceTrackSnapshot();
    return {
      enabled: true,
      strength: 1,
      fieldRadius: raceTrack.getFieldRadius(),
      trackWidthMeters: raceTrack.getTrackWidthMeters(),
      sceneUnitsPerMeter: raceTrack.getSceneUnitsPerMeter(),
      mask: raceTrack.getMaskSnapshot(),
      walls: raceTrack.getWallSnapshot()
    };
  }

  function createTrainingSnapshot(): RenderTrainingSnapshot {
    if (activePlayMode !== "training") return createDisabledTrainingSnapshot();
    const training = trainingRun.getPresentationSnapshot();
    return {
      enabled: training.enabled,
      active: training.active,
      complete: training.complete,
      stepId: training.stepId,
      stepIndex: training.stepIndex,
      stepCount: training.stepCount,
      marker: {
        visible: training.marker.visible,
        position: {
          x: training.marker.position.x,
          y: training.marker.position.y,
          z: training.marker.position.z
        },
        facingYawRadians: training.marker.facingYawRadians,
        halfWidth: training.marker.halfWidth,
        postHeight: training.marker.postHeight,
        postWidth: training.marker.postWidth,
        beamY: training.marker.beamY,
        beamThickness: training.marker.beamThickness,
        beamDepth: training.marker.beamDepth,
        glowWidth: training.marker.glowWidth,
        glowHeight: training.marker.glowHeight
      }
    };
  }

  function emitRendererMode(): void {
    const raceSnapshot = createRaceTrackSnapshot();
    const trainingSnapshot = createTrainingSnapshot();
    const fieldMetrics = runtime.getFieldMetrics();
    debugEvent("renderer.mode", "Renderer mode selected", {
      requestedMode: rendererModeSelection.requestedMode,
      selectionSource: rendererModeSelection.source,
      activeBackend: "webgpu",
      presentationProfile,
      fieldPalette: settings.fieldPaletteId,
      resolvedFieldPalette: fieldMetrics.fieldPalette,
      waveDynamicsMode: fieldMetrics.waveDynamicsMode,
      fieldGeometryMode: fieldMetrics.fieldGeometryMode,
      fieldVerticesPerInstance: fieldMetrics.fieldVerticesPerInstance,
      fieldTrianglesPerInstance: fieldMetrics.fieldTrianglesPerInstance,
      visibleSideFaceCount: fieldMetrics.visibleSideFaceCount,
      bottomFaceIncluded: fieldMetrics.bottomFaceIncluded,
      tileHeightMode: fieldMetrics.tileHeightMode,
      rolloutStage: WEBGPU_ROLLOUT_STAGE,
      rolloutDecisionCode: "explicit-webgpu",
      playMode: activePlayMode ?? "none",
      raceTrackEnabled: raceSnapshot.enabled,
      trackMaskUploaded: raceSnapshot.enabled && raceSnapshot.mask.version > 0,
      arenaBarrierEnabled: !isCourseMode(activePlayMode),
      fieldLayoutMode: fieldLayout.buildStats.mode === "clipped" ? "track-clipped" : "arena-full",
      culledHexCount: fieldLayout.buildStats.culledHexCount,
      trackWallEnabled: raceSnapshot.enabled,
      trackWallSegments: raceSnapshot.walls.segmentCount,
      trainingEnabled: activePlayMode === "training",
      trainingStepIndex: trainingSnapshot.stepIndex,
      trainingMarkerVisible: trainingSnapshot.marker.visible,
      integrationSurface: "core-render-snapshot",
      ...getGamepadDiagnosticsPayload(),
      ...readinessPayload(presentationProfile),
      supportsBloom: true,
      supportsLocalLights: true
    }, "info");
  }

  function emitFrameDiagnostics(input: RenderFrameInput, frameMs: number): void {
    const time = simulationTimeSeconds;
    if (time - lastRendererFrameSampleAt < RENDERER_FRAME_SAMPLE_SECONDS) return;
    lastRendererFrameSampleAt = time;
    const payload = collectRuntimePayload(input, frameMs);
    debugEvent("renderer.frameSample", "Renderer frame sample", payload, "debug");
    debugEvent("webgpu.sceneState.frame", "Forced WebGPU scene state frame sample", payload, "debug");
    debugEvent("webgpu.readiness.frame", "Forced WebGPU renderer readiness frame sample", payload, "debug");
    debugEvent("webgpu.integrationReadiness.frame", "Forced WebGPU integration readiness frame sample", payload, "debug");

    if (time - lastDefaultReadinessFrameAt >= DEFAULT_READINESS_FRAME_SECONDS) {
      lastDefaultReadinessFrameAt = time;
      debugEvent("webgpu.defaultReadiness.frame", "Forced WebGPU default-readiness frame sample", {
        ...payload,
        defaultReadinessSurface: "forced-webgpu-core",
        defaultRolloutSoakGapClosed: WEBGPU_REMAINING_GAPS.length === 0,
        remainingGapCount: WEBGPU_REMAINING_GAPS.length,
        stabilityWindowSeconds: time
      }, "debug");
    }
    if (time >= DEFAULT_READINESS_SUMMARY_SECONDS && time - lastDefaultReadinessSummaryAt >= 10) {
      lastDefaultReadinessSummaryAt = time;
      debugEvent("webgpu.defaultReadiness.summary", "Forced WebGPU default-readiness soak summary", {
        ...payload,
        defaultReadinessSurface: "forced-webgpu-core",
        defaultRolloutSoakGapClosed: WEBGPU_REMAINING_GAPS.length === 0,
        remainingGapCount: WEBGPU_REMAINING_GAPS.length,
        stabilityWindowSeconds: time
      }, "info");
    }
  }

  function collectRuntimePayload(input: RenderFrameInput, frameMs: number): RippleDebugPayload {
    const stats = runtime.getStats();
    const fieldMetrics = runtime.getFieldMetrics();
    const wakeMetrics = runtime.getWakeMetrics();
    const particleMetrics = runtime.getParticleMetrics();
    const skyboxMetrics = runtime.getSkyboxMetrics();
    const bloomMetrics = runtime.getBloomMetrics();
    const lightingMetrics = runtime.getLightingMetrics();
    const shadowMetrics = runtime.getShadowMetrics();
    const echoMetrics = runtime.getEchoVisualMetrics();
    const trackWallMetrics = runtime.getTrackWallMetrics();
    const trainingMarkerMetrics = runtime.getTrainingMarkerMetrics();

    return {
      backendId: "webgpu",
      activeBackend: "webgpu",
      rolloutStage: WEBGPU_ROLLOUT_STAGE,
      rolloutDecisionCode: "explicit-webgpu",
      stateMode: "playable",
      integrationSurface: "core-render-snapshot",
      scenePresentationMode: input.scenePresentation.mode,
      presentationProfile: input.scenePresentation.profile,
      fieldPalette: input.settings.fieldPaletteId,
      resolvedFieldPalette: fieldMetrics.fieldPalette,
      waveDynamicsMode: fieldMetrics.waveDynamicsMode,
      fieldGeometryMode: fieldMetrics.fieldGeometryMode,
      fieldVerticesPerInstance: fieldMetrics.fieldVerticesPerInstance,
      fieldTrianglesPerInstance: fieldMetrics.fieldTrianglesPerInstance,
      visibleSideFaceCount: fieldMetrics.visibleSideFaceCount,
      bottomFaceIncluded: fieldMetrics.bottomFaceIncluded,
      tileHeightMode: fieldMetrics.tileHeightMode,
      playMode: input.playMode,
      cameraMode: input.camera.projection.cameraMode,
      simulationTimeSeconds: roundMetric(simulationTimeSeconds),
      playerPosition: vectorPayload(player.position),
      frameMs: roundMetric(frameMs),
      updateMs: roundMetric(lastFrameUpdateMs),
      snapshotMs: roundMetric(lastFrameSnapshotMs),
      renderMs: roundMetric(lastFrameRenderMs),
      gpuFrameMs: stats.gpuFrameMs === undefined ? null : roundMetric(stats.gpuFrameMs),
      gpuFrameSequence: stats.gpuFrameSequence ?? null,
      gpuTimerMode: stats.gpuTimerMode ?? "unavailable",
      gpuTimerErrorCount: stats.gpuTimerErrorCount ?? 0,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      deviceLost: stats.deviceLost,
      supportsBloom: true,
      supportsLocalLights: true,
      quality: settings.qualityId,
      skybox: skyboxMetrics.skyboxId,
      skyboxTextureTier: skyboxMetrics.textureTier,
      arenaRadius: preset.fieldRadius,
      voxelSizeMeters: roundMetric(settings.voxelSizeMeters),
      arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
      baseSpeed: roundMetric(settings.playerSpeed.baseSpeedMetersPerSecond),
      boostSpeed: roundMetric(settings.playerSpeed.boostSpeedMetersPerSecond),
      surfaceGrip: roundMetric(settings.surfaceGrip),
      rippleHeight: roundMetric(settings.rippleHeight),
      rippleRadius: roundMetric(settings.rippleRadius),
      waveDepth: roundMetric(settings.waveMedium.effectiveDepth),
      waveSpeed: roundMetric(getBasePropagationSpeedMetersPerSecond(settings.waveMedium)),
      particlesEnabled: settings.particlesEnabled,
      particleDensity: roundMetric(settings.particleDensity),
      bloomEnabled: settings.bloomEnabled,
      bloomStrength: roundMetric(getWebGpuBloomStrength(settings)),
      bloomMode: bloomMetrics.bloomMode,
      bloomPasses: bloomMetrics.bloomPasses,
      playerSpeed: roundMetric(input.player.speed),
      avatarMode: "hover-pod",
      avatarPresentationMode: input.avatarPresentation.mode,
      avatarAssetId: input.avatarPresentation.assetId,
      moteAvatarAssetId: input.avatarPresentation.moteAssetId,
      avatarCoreRadius: input.avatarPresentation.coreRadius,
      sourceLimit: fieldMetrics.sourceLimit,
      fieldInstanceCount: fieldMetrics.instanceCount,
      wakeTextureSize: wakeMetrics.textureSize,
      activeSources: input.pulseSources.activeCount,
      renderedSources: fieldMetrics.renderedSources,
      activeEchoes: input.echoVisualState.activeEchoes,
      renderedEchoes: fieldMetrics.renderedEchoes,
      activeEchoBursts: input.echoVisualState.activeVisualBursts,
      echoVisualRenderedEchoes: echoMetrics.renderedEchoes,
      echoVisualRenderedCollectionEvents: echoMetrics.renderedCollectionEvents,
      pulseGlowMode: runtime.getPulseGlowMetrics().presentationMode,
      pulseGlowCount: runtime.getPulseGlowMetrics().renderedGlows,
      activeParticles: particleMetrics.activeParticles,
      renderedParticles: particleMetrics.renderedParticles,
      particleBudget: particleMetrics.particleBudget,
      activeLocalLights: lightingMetrics.activeLocalLights,
      renderedLocalLights: lightingMetrics.renderedLocalLights,
      shadowMode: shadowMetrics.shadowMode,
      renderedShadowCasters: shadowMetrics.renderedShadowCasters,
      shadowMapSize: shadowMetrics.shadowMapSize,
      shadowMapFormat: shadowMetrics.shadowMapFormat,
      shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps,
      shadowGeometryMode: shadowMetrics.shadowGeometryMode,
      fieldReceiver: shadowMetrics.fieldReceiver,
      renderedOrbCasters: shadowMetrics.renderedOrbCasters,
      renderedColumnCasters: shadowMetrics.renderedColumnCasters,
      renderedDiscCasters: shadowMetrics.renderedDiscCasters,
      shadowMapProxyTriangles: shadowMetrics.proxyTriangles,
      wakeMaxAbsHeight: wakeMetrics.wakeMaxAbsHeight,
      wakeMeanAbsHeight: wakeMetrics.wakeMeanAbsHeight,
      wakeMaxCrest: wakeMetrics.wakeMaxCrest,
      wakeEnergyEstimate: wakeMetrics.wakeEnergyEstimate,
      raceTrackEnabled: input.raceTrack.enabled,
      trackMaskUploaded: fieldMetrics.trackMaskUploaded,
      trackMaskBodyCoverage: fieldMetrics.trackMaskBodyCoverage,
      trackMaskEdgeCoverage: fieldMetrics.trackMaskEdgeCoverage,
      trackMaskCenterCoverage: fieldMetrics.trackMaskCenterCoverage,
      arenaBarrierEnabled: runtime.getArenaMetrics().arenaBarrierEnabled,
      fieldLayoutMode: fieldMetrics.fieldLayoutMode,
      culledHexCount: fieldMetrics.culledHexCount,
      trackWallEnabled: trackWallMetrics.enabled,
      trackWallVersion: trackWallMetrics.version,
      trackWallSegments: trackWallMetrics.segmentCount,
      trackWallDrawCalls: trackWallMetrics.drawCalls,
      trackWallTriangles: trackWallMetrics.triangles,
      trainingEnabled: input.training.enabled,
      trainingActive: input.training.active,
      trainingComplete: input.training.complete,
      trainingStepId: input.training.stepId,
      trainingStepIndex: input.training.stepIndex,
      trainingStepCount: input.training.stepCount,
      trainingMarkerVisible: input.training.marker.visible,
      trainingMarkerDrawCalls: trainingMarkerMetrics.drawCalls,
      trainingMarkerTriangles: trainingMarkerMetrics.triangles,
      viewportWidth: input.viewport.width,
      viewportHeight: input.viewport.height,
      ...getGamepadDiagnosticsPayload(),
      ...readinessPayload(presentationProfile)
    };
  }

  function emitInitialReadiness(input: RenderFrameInput): void {
    const payload = collectRuntimePayload(input, 0);
    debugEvent("webgpu.sceneState.init", "Initialized forced WebGPU scene state", payload, "info");
    debugEvent("webgpu.readiness.init", "Initialized forced WebGPU renderer readiness", payload, "info");
    debugEvent("webgpu.integrationReadiness.init", "Initialized forced WebGPU integration readiness", payload, "info");
    debugEvent("webgpu.defaultReadiness.init", "Initialized forced WebGPU default-readiness surface", {
      ...payload,
      defaultReadinessSurface: "forced-webgpu-core",
      defaultRolloutSoakGapClosed: WEBGPU_REMAINING_GAPS.length === 0,
      remainingGapCount: WEBGPU_REMAINING_GAPS.length,
      stabilityWindowSeconds: 0
    }, "info");
  }

  function updateRuntimeUi(input: RenderFrameInput, rawDelta: number): void {
    const stats = runtime.getStats();
    const wake = runtime.getWakeMetrics();
    const field = runtime.getFieldMetrics();
    const particles = runtime.getParticleMetrics();
    const modeLabel = getPlayModeLabel();
    const profileLabel = presentationProfile === "classic" ? "Classic" : "Core";
    dom.qualityBadge.textContent = activePlayMode ? `${modeLabel} / ${preset.label}` : preset.label;
    dom.statsLine.textContent = `${modeLabel} | ${formatCompactCount(field.instanceCount)} cells | ${input.echoVisualState.activeEchoes} echoes`;
    dom.mediumLine.textContent = `${getBasePropagationSpeedMetersPerSecond(settings.waveMedium).toFixed(1)} m/s | ${formatVoxelSize(settings.voxelSizeMeters)} hex | ${settings.arenaRadiusMeters.toFixed(0)}m arena`;
    dom.perfOverlayQuality.textContent = `${modeLabel} / WebGPU ${profileLabel}`;
    dom.perfFrame.textContent = `${(rawDelta * 1000).toFixed(1)} ms`;
    dom.perfUpdate.textContent = `${lastFrameUpdateMs.toFixed(1)} ms`;
    dom.perfRender.textContent = `${lastFrameRenderMs.toFixed(1)} ms`;
    dom.perfFps.textContent = rawDelta > 0 ? String(Math.round(1 / rawDelta)) : "--";
    dom.perfHexes.textContent = formatCompactCount(field.instanceCount);
    dom.perfParticles.textContent = `${formatCompactCount(particles.activeParticles)}/${formatCompactCount(particles.particleBudget)}`;
    dom.perfWaves.textContent = `${input.pulseSources.activeCount} | GPU ${field.renderedSources}/${field.sourceLimit}`;
    dom.perfWake.textContent = `${wake.mode} | ${wake.textureSize}px | ${wake.passMs.toFixed(1)} ms`;
    dom.perfRenderer.textContent = `${stats.backendId} | ${stats.drawCalls}c | ${formatCompactCount(stats.triangles)} tri`;
  }

  function updateAppChrome(): void {
    const inGameplayShell = appState !== "mainMenu" && activePlayMode !== null;
    dom.mainMenu.hidden = appState !== "mainMenu";
    dom.hud.hidden = !inGameplayShell;
    dom.menuToggle.hidden = !inGameplayShell;
    dom.sceneMenuBackdrop.hidden = appState !== "paused";
    document.body.classList.toggle("main-menu-open", appState === "mainMenu");
    document.body.classList.toggle("menu-open", appState === "paused");
    dom.menuToggle.setAttribute("aria-expanded", String(appState === "paused"));
    dom.menuToggle.setAttribute("aria-label", appState === "paused" ? "Close pause menu" : "Open pause menu");
    dom.statsLine.hidden = !perfOverlayVisible || !inGameplayShell;
    dom.mediumLine.hidden = !perfOverlayVisible || !inGameplayShell;
    dom.perfOverlay.hidden = !perfOverlayVisible || !inGameplayShell;
    dom.perfOverlayToggle.textContent = perfOverlayVisible ? "On" : "Off";
    dom.perfOverlayToggle.setAttribute("aria-pressed", String(perfOverlayVisible));
    updateTrainingHud();
    updateMobileControlsVisibility();
  }

  function updateTrainingHud(): void {
    const state = trainingRun.getHudState();
    const visible = activePlayMode === "training" && appState !== "mainMenu" && state.visible;
    dom.trainingHud.hidden = !visible;
    if (!visible) return;
    dom.trainingTitle.textContent = state.title;
    dom.trainingInstruction.textContent = state.complete
      ? state.instruction
      : `${state.stepIndex + 1}/${state.stepCount} - ${state.instruction}`;
    renderTrainingProgress(state);
  }

  function renderTrainingProgress(state: TrainingHudState): void {
    dom.trainingProgress.replaceChildren();
    for (const chip of state.chips) {
      const element = document.createElement("span");
      element.className = chip.complete
        ? "training-progress__chip training-progress__chip--complete"
        : "training-progress__chip";
      element.textContent = chip.label;
      dom.trainingProgress.append(element);
    }
  }

  function setMenuVisible(visible: boolean): void {
    if (appState === "mainMenu" || !activePlayMode) return;
    appState = visible ? "paused" : "playing";
    if (visible && document.pointerLockElement === runtime.canvas) document.exitPointerLock();
    updateAppChrome();
    if (visible) dom.resumeButton.focus({ preventScroll: true });
    else runtime.canvas.focus({ preventScroll: true });
  }

  function setChangelogVisible(visible: boolean): void {
    changelogVisible = visible;
    dom.changelogBackdrop.hidden = !visible;
    if (visible) dom.changelogDialog.focus({ preventScroll: true });
  }

  function applyQualityChange(nextQualityId: string): void {
    if (!isQualityId(nextQualityId)) return;
    settings.qualityId = nextQualityId;
    if (activePlayMode === "arena") {
      applyFieldInstanceBudget(settings, "quality", isFieldStressModeEnabled());
    }
    preset = getQualityPreset(settings);
    settings.bloomStrength = preset.bloomStrength;
    settings.bloomEnabled = preset.bloomStrength > 0;
    particleState = new ParticleVeilState(preset.particleBudget);
    raceTrack.setArena(preset.fieldRadius, settings.arenaRadiusMeters, "quality");
    runtime.applyQualityPreset(preset, getWebGpuBloomStrength(settings), "quality");
    rebuildActiveModeAfterSettingsChange("quality");
    syncControlValues();
    logSettingsChange("quality", settings.qualityId);
  }

  function applyFieldScaleChange(changedControl: FieldScaleChangedControl): void {
    if (activePlayMode === "arena") {
      applyFieldInstanceBudget(settings, changedControl, isFieldStressModeEnabled());
    }
    preset = getQualityPreset(settings);
    raceTrack.setArena(preset.fieldRadius, settings.arenaRadiusMeters, "field-scale");
    runtime.applyQualityPreset(preset, getWebGpuBloomStrength(settings), "field-scale");
    rebuildActiveModeAfterSettingsChange("field-scale");
    syncControlValues();
    logSettingsChange(changedControl === "voxel-size" ? "voxelSizeMeters" : "arenaRadiusMeters",
      changedControl === "voxel-size" ? settings.voxelSizeMeters : settings.arenaRadiusMeters,
      { fieldScaleChangedControl: changedControl });
  }

  function syncControlValues(): void {
    if (dom.skyboxSelect.options.length === 0) {
      for (const option of SKYBOX_OPTIONS) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = option.label;
        dom.skyboxSelect.append(element);
      }
    }
    dom.mainMenuVersionLink.textContent = APP_VERSION;
    dom.versionLink.textContent = APP_VERSION;
    dom.changelogContent.textContent = changelogMarkdown;
    dom.qualitySelect.value = settings.qualityId;
    dom.skyboxSelect.value = settings.skyboxId;
    dom.presentationProfileSelect.value = presentationProfile;
    dom.fieldPaletteSelect.value = settings.fieldPaletteId;
    dom.voxelSizeSlider.value = String(settings.voxelSizeMeters);
    dom.voxelSizeValue.textContent = formatVoxelSize(settings.voxelSizeMeters);
    dom.arenaRadiusSlider.value = String(settings.arenaRadiusMeters);
    dom.arenaRadiusValue.textContent = `${Math.round(settings.arenaRadiusMeters)} m`;
    dom.baseSpeedSlider.value = String(settings.playerSpeed.baseSpeedMetersPerSecond);
    dom.baseSpeedValue.textContent = `${settings.playerSpeed.baseSpeedMetersPerSecond.toFixed(1)} m/s`;
    dom.boostSpeedSlider.min = String(getMinimumBoostSpeedMetersPerSecond(settings.playerSpeed.baseSpeedMetersPerSecond));
    dom.boostSpeedSlider.value = String(settings.playerSpeed.boostSpeedMetersPerSecond);
    dom.boostSpeedValue.textContent = `${settings.playerSpeed.boostSpeedMetersPerSecond.toFixed(1)} m/s`;
    dom.surfaceGripSlider.value = String(settings.surfaceGrip);
    dom.surfaceGripValue.textContent = `${Math.round(settings.surfaceGrip * 100)}%`;
    dom.leftStickSensitivitySlider.min = String(GAMEPAD_SENSITIVITY_LIMITS.min);
    dom.leftStickSensitivitySlider.max = String(GAMEPAD_SENSITIVITY_LIMITS.max);
    dom.leftStickSensitivitySlider.step = String(GAMEPAD_SENSITIVITY_LIMITS.step);
    dom.leftStickSensitivitySlider.value = String(settings.gamepadSensitivity.leftStick);
    dom.leftStickSensitivityValue.textContent = `${Math.round(settings.gamepadSensitivity.leftStick * 100)}%`;
    dom.rightStickSensitivitySlider.min = String(GAMEPAD_SENSITIVITY_LIMITS.min);
    dom.rightStickSensitivitySlider.max = String(GAMEPAD_SENSITIVITY_LIMITS.max);
    dom.rightStickSensitivitySlider.step = String(GAMEPAD_SENSITIVITY_LIMITS.step);
    dom.rightStickSensitivitySlider.value = String(settings.gamepadSensitivity.rightStick);
    dom.rightStickSensitivityValue.textContent = `${Math.round(settings.gamepadSensitivity.rightStick * 100)}%`;
    dom.heightSlider.value = String(settings.rippleHeight);
    dom.radiusSlider.value = String(settings.rippleRadius);
    dom.depthSlider.value = String(settings.waveMedium.effectiveDepth);
    dom.depthSpeedValue.textContent = `${getBasePropagationSpeedMetersPerSecond(settings.waveMedium).toFixed(1)} m/s`;
    dom.particleSlider.value = String(settings.particleDensity);
    updateEffectToggle(dom.particleToggle, settings.particlesEnabled, dom.particleSlider);
    dom.bloomSlider.value = String(settings.bloomStrength);
    updateEffectToggle(dom.bloomToggle, settings.bloomEnabled, dom.bloomSlider);
  }

  function wireUi(): void {
    const listenerOptions = { signal: uiAbortController.signal };
    dom.startTrainingButton.addEventListener("click", () => startGame("training"), listenerOptions);
    dom.startTrackButton.addEventListener("click", () => startGame("track"), listenerOptions);
    dom.startArenaButton.addEventListener("click", () => startGame("arena"), listenerOptions);
    dom.menuToggle.addEventListener("click", () => setMenuVisible(appState !== "paused"), listenerOptions);
    dom.resumeButton.addEventListener("click", () => setMenuVisible(false), listenerOptions);
    dom.exitToMainMenuButton.addEventListener("click", () => showMainMenu(), listenerOptions);
    dom.versionLink.addEventListener("click", () => setChangelogVisible(true), listenerOptions);
    dom.mainMenuVersionLink.addEventListener("click", () => setChangelogVisible(true), listenerOptions);
    dom.changelogClose.addEventListener("click", () => setChangelogVisible(false), listenerOptions);
    dom.changelogBackdrop.addEventListener("pointerdown", (event) => {
      if (event.target === dom.changelogBackdrop) setChangelogVisible(false);
    }, listenerOptions);
    dom.qualitySelect.addEventListener("change", () => applyQualityChange(dom.qualitySelect.value), listenerOptions);
    dom.presentationProfileSelect.addEventListener("change", () => {
      applyPresentationProfileChange(dom.presentationProfileSelect.value);
    }, listenerOptions);
    dom.skyboxSelect.addEventListener("change", () => {
      if (!isSkyboxId(dom.skyboxSelect.value)) return;
      settings.skyboxId = dom.skyboxSelect.value;
      logSettingsChange("skybox", settings.skyboxId);
    }, listenerOptions);
    dom.fieldPaletteSelect.addEventListener("change", () => {
      if (!isFieldPaletteId(dom.fieldPaletteSelect.value)) return;
      settings.fieldPaletteId = dom.fieldPaletteSelect.value;
      logSettingsChange("fieldPalette", settings.fieldPaletteId);
    }, listenerOptions);
    dom.voxelSizeSlider.addEventListener("input", () => {
      settings.voxelSizeMeters = THREE.MathUtils.clamp(Number(dom.voxelSizeSlider.value), VOXEL_SIZE_MIN_METERS, VOXEL_SIZE_MAX_METERS);
      applyFieldScaleChange("voxel-size");
    }, listenerOptions);
    dom.arenaRadiusSlider.addEventListener("input", () => {
      settings.arenaRadiusMeters = THREE.MathUtils.clamp(Number(dom.arenaRadiusSlider.value), ARENA_RADIUS_MIN_METERS, ARENA_RADIUS_MAX_METERS);
      applyFieldScaleChange("arena-radius");
    }, listenerOptions);
    dom.baseSpeedSlider.addEventListener("input", () => updatePlayerSpeeds("base"), listenerOptions);
    dom.boostSpeedSlider.addEventListener("input", () => updatePlayerSpeeds("boost"), listenerOptions);
    dom.surfaceGripSlider.addEventListener("input", () => {
      settings.surfaceGrip = THREE.MathUtils.clamp(Number(dom.surfaceGripSlider.value), SURFACE_GRIP_LIMITS.min, SURFACE_GRIP_LIMITS.max);
      player.setSurfaceGrip(settings.surfaceGrip);
      syncControlValues();
      logSettingsChange("surfaceGrip", settings.surfaceGrip);
    }, listenerOptions);
    dom.leftStickSensitivitySlider.addEventListener("input", () => {
      settings.gamepadSensitivity = {
        ...settings.gamepadSensitivity,
        leftStick: THREE.MathUtils.clamp(
          Number(dom.leftStickSensitivitySlider.value),
          GAMEPAD_SENSITIVITY_LIMITS.min,
          GAMEPAD_SENSITIVITY_LIMITS.max
        )
      };
      player.setGamepadSensitivity(settings.gamepadSensitivity);
      syncControlValues();
      logSettingsChange("leftStickSensitivity", settings.gamepadSensitivity.leftStick);
    }, listenerOptions);
    dom.rightStickSensitivitySlider.addEventListener("input", () => {
      settings.gamepadSensitivity = {
        ...settings.gamepadSensitivity,
        rightStick: THREE.MathUtils.clamp(
          Number(dom.rightStickSensitivitySlider.value),
          GAMEPAD_SENSITIVITY_LIMITS.min,
          GAMEPAD_SENSITIVITY_LIMITS.max
        )
      };
      player.setGamepadSensitivity(settings.gamepadSensitivity);
      syncControlValues();
      logSettingsChange("rightStickSensitivity", settings.gamepadSensitivity.rightStick);
    }, listenerOptions);
    dom.heightSlider.addEventListener("input", () => {
      settings.rippleHeight = Number(dom.heightSlider.value);
      logSettingsChange("rippleHeight", settings.rippleHeight);
    }, listenerOptions);
    dom.radiusSlider.addEventListener("input", () => {
      settings.rippleRadius = Number(dom.radiusSlider.value);
      logSettingsChange("rippleRadius", settings.rippleRadius);
    }, listenerOptions);
    dom.depthSlider.addEventListener("input", () => {
      settings.waveMedium.effectiveDepth = Number(dom.depthSlider.value);
      syncControlValues();
      logSettingsChange("waveDepth", settings.waveMedium.effectiveDepth);
    }, listenerOptions);
    dom.particleSlider.addEventListener("input", () => {
      settings.particleDensity = THREE.MathUtils.clamp(Number(dom.particleSlider.value), 0, 1);
      logSettingsChange("particleDensity", settings.particleDensity);
    }, listenerOptions);
    dom.particleToggle.addEventListener("click", () => {
      settings.particlesEnabled = !settings.particlesEnabled;
      if (!settings.particlesEnabled) particleState.clear();
      syncControlValues();
      logSettingsChange("particlesEnabled", settings.particlesEnabled);
    }, listenerOptions);
    dom.bloomSlider.addEventListener("input", () => {
      settings.bloomStrength = THREE.MathUtils.clamp(Number(dom.bloomSlider.value), 0, 0.38);
      logSettingsChange("bloomStrength", settings.bloomStrength);
    }, listenerOptions);
    dom.bloomToggle.addEventListener("click", () => {
      settings.bloomEnabled = !settings.bloomEnabled;
      syncControlValues();
      logSettingsChange("bloomEnabled", settings.bloomEnabled);
    }, listenerOptions);
    dom.perfOverlayToggle.addEventListener("click", () => {
      perfOverlayVisible = !perfOverlayVisible;
      updateAppChrome();
    }, listenerOptions);
    dom.pulseButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const inputEnabled = appState === "playing" && activePlayMode !== null && !changelogVisible;
      if (inputEnabled) player.triggerPulse();
      debugEvent("webgpu.pulse.button", "Forced WebGPU pulse button pressed", {
        ...readinessPayload(presentationProfile),
        stateMode: "playable",
        inputEnabled,
        triggered: inputEnabled,
        quality: settings.qualityId
      }, inputEnabled ? "info" : "debug");
    }, listenerOptions);
    window.addEventListener("keydown", (event) => {
      if (event.code === "F2") {
        event.preventDefault();
        perfOverlayVisible = !perfOverlayVisible;
        updateAppChrome();
        return;
      }
      if (event.code !== "Escape") return;
      if (changelogVisible) {
        setChangelogVisible(false);
      } else if (appState !== "mainMenu") {
        setMenuVisible(appState !== "paused");
      }
    }, listenerOptions);
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === runtime.canvas;
      if (locked) {
        pointerLockWasActive = true;
        return;
      }
      if (pointerLockWasActive && !suppressNextPointerUnlockMenu && appState === "playing") {
        setMenuVisible(true);
      }
      pointerLockWasActive = false;
      suppressNextPointerUnlockMenu = false;
    }, listenerOptions);
    window.addEventListener("resize", resize, listenerOptions);
    window.visualViewport?.addEventListener("resize", resize, listenerOptions);
    window.visualViewport?.addEventListener("scroll", resize, listenerOptions);
    wireTouchSticks(listenerOptions);
  }

  function handleGamepadUiInput(): void {
    const state = gamepad.getState();
    if (!state.connected) return;

    if (gamepad.consumePress(GAMEPAD_BUTTON.view)) {
      perfOverlayVisible = !perfOverlayVisible;
      updateAppChrome();
      gamepad.playHaptic({ durationMs: 48, strongMagnitude: 0.04, weakMagnitude: 0.12 });
    }

    if (gamepad.consumePress(GAMEPAD_BUTTON.menu)) {
      if (changelogVisible) {
        setChangelogVisible(false);
      } else if (appState !== "mainMenu") {
        setMenuVisible(appState !== "paused");
      }
      gamepad.playHaptic({ durationMs: 54, strongMagnitude: 0.06, weakMagnitude: 0.14 });
      return;
    }

    // B remains the live gameplay brake and becomes Back only while a menu
    // surface owns controller input.
    if (appState !== "playing" && gamepad.consumePress(GAMEPAD_BUTTON.secondary)) {
      if (changelogVisible) {
        setChangelogVisible(false);
      } else if (appState === "paused") {
        setMenuVisible(false);
      }
      return;
    }

    if (appState === "playing") return;
    const root = getActiveGamepadMenuRoot();
    if (!root) return;

    const verticalDirection = consumeGamepadNavigationPair("up", "down");
    if (verticalDirection !== 0) moveGamepadFocus(root, verticalDirection);

    const horizontalDirection = consumeGamepadNavigationPair("left", "right");
    if (horizontalDirection !== 0) {
      const adjusted = adjustFocusedGamepadControl(horizontalDirection);
      if (!adjusted && appState === "mainMenu") moveGamepadFocus(root, horizontalDirection);
    }

    if (!gamepad.consumePress(GAMEPAD_BUTTON.primary)) return;
    const focusable = getGamepadFocusableElements(root);
    const activeElement = document.activeElement instanceof HTMLElement
      && focusable.includes(document.activeElement)
      ? document.activeElement
      : focusable[0];
    if (!activeElement) return;

    activeElement.focus({ preventScroll: true });
    if (activeElement instanceof HTMLButtonElement) {
      activeElement.click();
      gamepad.playHaptic({ durationMs: 62, strongMagnitude: 0.05, weakMagnitude: 0.18 });
    }
  }

  function getActiveGamepadMenuRoot(): HTMLElement | null {
    if (changelogVisible) return dom.changelogDialog;
    if (appState === "mainMenu") return dom.mainMenu;
    if (appState === "paused") return dom.sceneMenu;
    return null;
  }

  function consumeGamepadNavigationPair(
    negative: GamepadNavigationDirection,
    positive: GamepadNavigationDirection
  ): number {
    const negativePressed = gamepad.consumeNavigation(negative);
    const positivePressed = gamepad.consumeNavigation(positive);
    return (positivePressed ? 1 : 0) - (negativePressed ? 1 : 0);
  }

  function moveGamepadFocus(root: HTMLElement, direction: number): void {
    const focusable = getGamepadFocusableElements(root);
    if (focusable.length === 0) return;

    const currentIndex = document.activeElement instanceof HTMLElement
      ? focusable.indexOf(document.activeElement)
      : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + Math.sign(direction) + focusable.length) % focusable.length;
    const next = focusable[nextIndex];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  }

  function getGamepadFocusableElements(root: HTMLElement): HTMLElement[] {
    if (root === dom.mainMenu) {
      return [
        dom.startTrainingButton,
        dom.startTrackButton,
        dom.startArenaButton,
        dom.mainMenuVersionLink
      ];
    }

    return Array.from(root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), select:not(:disabled), input[type='range']:not(:disabled)"
    )).filter((element) => !element.hidden && element.closest("[hidden]") === null);
  }

  function adjustFocusedGamepadControl(direction: number): boolean {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLButtonElement && activeElement.matches("[data-settings-tab]")) {
      const tabs = Array.from(dom.sceneMenu.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));
      const currentIndex = tabs.indexOf(activeElement);
      if (currentIndex < 0 || tabs.length === 0) return false;
      const nextIndex = (currentIndex + Math.sign(direction) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      next.click();
      next.focus({ preventScroll: true });
      return true;
    }

    if (activeElement instanceof HTMLInputElement && activeElement.type === "range") {
      const step = Number(activeElement.step) || 1;
      const min = Number.isFinite(Number(activeElement.min)) ? Number(activeElement.min) : -Infinity;
      const max = Number.isFinite(Number(activeElement.max)) ? Number(activeElement.max) : Infinity;
      activeElement.value = String(THREE.MathUtils.clamp(
        Number(activeElement.value) + Math.sign(direction) * step,
        min,
        max
      ));
      activeElement.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    if (activeElement instanceof HTMLSelectElement) {
      activeElement.selectedIndex = THREE.MathUtils.clamp(
        activeElement.selectedIndex + Math.sign(direction),
        0,
        activeElement.options.length - 1
      );
      activeElement.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  function updateGamepadStatus(): void {
    const state = gamepad.getState();
    const controllerName = state.id.length > 44 ? `${state.id.slice(0, 41)}...` : state.id;
    const nextText = state.connected
      ? `${controllerName} ready - A select - Menu pause`
      : "Controller: press any button to connect";
    if (nextText === lastGamepadStatusText) return;

    lastGamepadStatusText = nextText;
    dom.gamepadStatus.textContent = nextText;
    dom.gamepadStatus.classList.toggle("gamepad-status--connected", state.connected);
  }

  function getGamepadDiagnosticsPayload(): RippleDebugPayload {
    const state = gamepad.getState();
    return {
      gamepadConnected: state.connected,
      gamepadActive: state.connected && performance.now() - state.lastInputAt <= 1_000,
      gamepadHapticsAvailable: state.hapticsAvailable,
      gamepadLeftStickSensitivity: roundMetric(settings.gamepadSensitivity.leftStick),
      gamepadRightStickSensitivity: roundMetric(settings.gamepadSensitivity.rightStick)
    };
  }

  function applyPresentationProfileChange(value: string): void {
    if (!isRenderPresentationProfile(value) || value === presentationProfile) {
      syncControlValues();
      return;
    }

    const startedAt = performance.now();
    const previousProfile = presentationProfile;
    const previousSimulationTimeSeconds = simulationTimeSeconds;
    const previousPlayerPosition = player.position.clone();
    presentationProfile = value;
    const persisted = persistWebGpuPresentationProfile(value);
    setRenderBenchmarkMetadata({ presentationProfile });
    syncControlValues();

    debugEvent("webgpu.presentation.change", "Changed WebGPU presentation profile without resetting the session", {
      previousPresentationProfile: previousProfile,
      presentationProfile,
      persisted,
      profileSwitchPreservedSession: true,
      profileSwitchMs: roundMetric(performance.now() - startedAt),
      simulationTimeSeconds: roundMetric(simulationTimeSeconds),
      previousSimulationTimeSeconds: roundMetric(previousSimulationTimeSeconds),
      playerPosition: vectorPayload(player.position),
      previousPlayerPosition: vectorPayload(previousPlayerPosition),
      playMode: activePlayMode ?? "none"
    }, "info");
  }

  function updatePlayerSpeeds(changed: "base" | "boost"): void {
    settings.playerSpeed = normalizePlayerSpeedSettings({
      baseSpeedMetersPerSecond: changed === "base"
        ? Number(dom.baseSpeedSlider.value)
        : settings.playerSpeed.baseSpeedMetersPerSecond,
      boostSpeedMetersPerSecond: Number(dom.boostSpeedSlider.value)
    });
    player.setSpeedSettings(settings.playerSpeed);
    syncControlValues();
    logSettingsChange(changed === "base" ? "baseSpeed" : "boostSpeed",
      changed === "base" ? settings.playerSpeed.baseSpeedMetersPerSecond : settings.playerSpeed.boostSpeedMetersPerSecond);
  }

  function wireTouchSticks(listenerOptions: AddEventListenerOptions): void {
    for (const stick of document.querySelectorAll<HTMLElement>("[data-stick]")) {
      const kind = stick.dataset.stick;
      const knob = stick.querySelector<HTMLElement>(".touch-stick__knob");
      if (!knob || (kind !== "move" && kind !== "look")) continue;
      let pointerId: number | null = null;
      const update = (event: PointerEvent) => {
        const rect = stick.getBoundingClientRect();
        const x = THREE.MathUtils.clamp((event.clientX - (rect.left + rect.width * 0.5)) / (rect.width * 0.35), -1, 1);
        const y = THREE.MathUtils.clamp((event.clientY - (rect.top + rect.height * 0.5)) / (rect.height * 0.35), -1, 1);
        knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
        if (kind === "move") player.setMobileMoveIntent(x, y);
        else player.setMobileLookIntent(x, y);
      };
      stick.addEventListener("pointerdown", (event) => {
        pointerId = event.pointerId;
        stick.setPointerCapture(pointerId);
        update(event);
      }, listenerOptions);
      stick.addEventListener("pointermove", (event) => {
        if (event.pointerId === pointerId) update(event);
      }, listenerOptions);
      const release = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        knob.style.transform = "";
        if (kind === "move") player.setMobileMoveIntent(0, 0);
        else player.setMobileLookIntent(0, 0);
      };
      stick.addEventListener("pointerup", release, listenerOptions);
      stick.addEventListener("pointercancel", release, listenerOptions);
    }
  }

  function updateMobileControlsVisibility(): void {
    const coarse = window.matchMedia("(pointer: coarse), (hover: none)").matches;
    dom.mobileControls.hidden = !(coarse && appState === "playing" && activePlayMode !== null);
  }

  function logSettingsChange(setting: string, value: unknown, extra: RippleDebugPayload = {}): void {
    debugEvent("webgpu.settings.change", "Forced WebGPU setting changed", {
      ...readinessPayload(presentationProfile),
      stateMode: "playable",
      simulationTimeSeconds: roundMetric(simulationTimeSeconds),
      playerPosition: vectorPayload(player.position),
      setting,
      value,
      quality: settings.qualityId,
      skybox: settings.skyboxId,
      fieldPalette: settings.fieldPaletteId,
      resolvedFieldPalette: resolveFieldPaletteForProfile(settings.fieldPaletteId, presentationProfile),
      voxelSizeMeters: roundMetric(settings.voxelSizeMeters),
      arenaRadiusMeters: roundMetric(settings.arenaRadiusMeters),
      baseSpeed: roundMetric(settings.playerSpeed.baseSpeedMetersPerSecond),
      boostSpeed: roundMetric(settings.playerSpeed.boostSpeedMetersPerSecond),
      surfaceGrip: roundMetric(settings.surfaceGrip),
      rippleHeight: roundMetric(settings.rippleHeight),
      rippleRadius: roundMetric(settings.rippleRadius),
      waveDepth: roundMetric(settings.waveMedium.effectiveDepth),
      waveSpeed: roundMetric(getBasePropagationSpeedMetersPerSecond(settings.waveMedium)),
      particleDensity: roundMetric(settings.particleDensity),
      particlesEnabled: settings.particlesEnabled,
      bloomEnabled: settings.bloomEnabled,
      bloomStrength: roundMetric(getWebGpuBloomStrength(settings)),
      ...getGamepadDiagnosticsPayload(),
      fieldInstanceEstimate: fieldLayout.instanceCount,
      wakeTextureSize: runtime.getWakeMetrics().textureSize,
      ...extra
    }, "info");
  }

  function resize(): void {
    const { width, height } = getViewportSize();
    document.documentElement.style.setProperty("--app-height", `${height}px`);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    runtime.resize(width, height, getPixelRatio());
  }

  function getPixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, settings.qualityId === "meltdown" ? 2.5 : 2);
  }

  function getPlayModeLabel(): string {
    if (activePlayMode === "arena") return "Arena";
    if (activePlayMode === "track") return "Track";
    if (activePlayMode === "training") return "Training";
    return "Menu";
  }

  // Emit init payloads only after the first submitted frame populated pass metrics.
  initialReadinessFrameId = requestAnimationFrame(() => {
    initialReadinessFrameId = 0;
    if (runtimeFatalFailureShown) return;
    const initialInput = createRenderInput(0);
    emitInitialReadiness(initialInput);
  });
}

function createRenderSettingsSnapshot(settings: LabSettings): RenderFrameInput["settings"] {
  return {
    rippleHeight: settings.rippleHeight,
    rippleRadius: settings.rippleRadius,
    voxelSizeMeters: settings.voxelSizeMeters,
    arenaRadiusMeters: settings.arenaRadiusMeters,
    fieldPaletteId: settings.fieldPaletteId,
    waveMedium: { ...settings.waveMedium },
    particleDensity: settings.particleDensity,
    particlesEnabled: settings.particlesEnabled,
    bloomStrength: getWebGpuBloomStrength(settings),
    bloomEnabled: settings.bloomEnabled
  };
}

function createScenePresentationSnapshot(
  settings: LabSettings,
  preset: QualityPreset,
  profile: RenderPresentationProfile
): RenderFrameInput["scenePresentation"] {
  const skybox = getSkyboxOption(settings.skyboxId);
  const postGlowStrength = getWebGpuBloomStrength(settings);
  return {
    mode: "webgpu-core-scene",
    profile,
    arenaRadius: preset.fieldRadius,
    skyboxId: skybox.id,
    skybox,
    postGlowEnabled: postGlowStrength > 0,
    postGlowStrength
  };
}

function createAvatarPresentationSnapshot(player: {
  readonly position: RenderVector3Snapshot;
  readonly facingYawRadians: number;
  readonly speed: number;
  readonly groundContact: number;
}): RenderAvatarPresentationSnapshot {
  const motionGlow = THREE.MathUtils.clamp(player.speed / 18, 0, 1);
  return {
    mode: "hover-pod",
    position: player.position,
    facingYawRadians: player.facingYawRadians,
    speed: player.speed,
    groundContact: player.groundContact,
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
  settings: LabSettings,
  player: { readonly position: RenderVector3Snapshot; readonly speed: number; readonly groundContact: number },
  pulseSources: RippleRenderSourceSnapshot,
  echoState: EchoVisualStateSnapshot,
  time: number
): RenderSceneLightingSnapshot {
  const localLights: RenderSceneLocalLightSnapshot[] = [{
    kind: "avatar",
    position: { x: player.position.x, y: player.position.y + 1.1, z: player.position.z },
    color: { x: 0.34, y: 1, z: 0.82 },
    intensity: 0.58 + Math.min(1, player.speed / 24) * 0.32,
    radius: 8.5 + player.groundContact * 2.5,
    importance: 120
  }];

  const pulseLightIntensityScale = 0.28 + getWebGpuBloomStrength(settings) * 0.42;
  const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
  for (let index = 0; index < pulseSources.sources.length; index += 1) {
    const source = pulseSources.sources[index];
    const lifecycle = sampleRippleSourceLifecycle(source, time);
    if (lifecycle.fade <= 0.001) continue;
    const speedMultiplier = Number.isFinite(source.speedMultiplier) ? source.speedMultiplier : 1;
    const intensity = pulseLightIntensityScale * source.strength * lifecycle.fade *
      (0.75 + lifecycle.pulse * 1.15);
    localLights.push({
      kind: "pulse",
      position: {
        x: source.positionX,
        y: sampleFieldHeight(source.positionX, source.positionZ) + 2.4 + lifecycle.pulse * 0.8,
        z: source.positionZ
      },
      color: PULSE_LIGHT_COLORS[index % PULSE_LIGHT_COLORS.length],
      intensity,
      radius: 5.8 + lifecycle.ageSeconds * basePropagationSpeed * speedMultiplier * 0.42,
      importance: 45 + lifecycle.fade * 25 + intensity * 30
    });
  }
  for (const echo of echoState.echoes) {
    localLights.push({
      kind: "echo",
      position: { x: echo.positionX, y: echo.positionY + 5.15, z: echo.positionZ },
      color: { x: 0.32, y: 1, z: 0.84 },
      intensity: 0.68,
      radius: 10,
      importance: 90
    });
  }
  for (const event of echoState.collectionEvents) {
    localLights.push({
      kind: "echo-burst",
      position: { x: event.positionX, y: event.effectPositionY, z: event.positionZ },
      color: { x: 1, y: 0.36, z: 0.82 },
      intensity: Math.max(0, 1 - event.age) * event.burstStrength,
      radius: event.discBurstRadius,
      importance: 110
    });
  }
  localLights.sort((a, b) => b.importance - a.importance);
  const rendered = localLights.slice(0, RENDER_SCENE_LOCAL_LIGHT_LIMIT);
  const waveSpeed = basePropagationSpeed;
  return {
    ambientColor: { x: 0.12, y: 0.2, z: 0.32 },
    ambientIntensity: 0.34,
    keyDirection: normalizeVector({ x: -0.44, y: -1, z: 0.28 }),
    keyColor: { x: 0.74, y: 0.92, z: 1 },
    keyIntensity: 1.02 + waveSpeed * 0.004,
    rimDirection: normalizeVector({ x: 0.54, y: -0.42, z: -0.72 }),
    rimColor: { x: 1, y: 0.42, z: 0.86 },
    rimIntensity: 0.58,
    activeLocalLights: localLights.length,
    localLightLimit: RENDER_SCENE_LOCAL_LIGHT_LIMIT,
    localLights: rendered
  };
}

function createSceneShadowSnapshot(
  settings: LabSettings,
  player: { readonly position: RenderVector3Snapshot; readonly groundContact: number },
  pulseSources: RippleRenderSourceSnapshot,
  echoState: EchoVisualStateSnapshot,
  time: number
): RenderSceneShadowSnapshot {
  const casters: RenderSceneShadowCasterSnapshot[] = [{
    kind: "avatar",
    position: player.position,
    radius: 1.1,
    height: 1.8,
    strength: 0.34 * player.groundContact,
    softness: 1.08,
    shadowMapProxy: { shape: "orb", radius: 1.1, height: 1.8, strength: 0.34 },
    importance: 120
  }];
  for (const echo of echoState.echoes) {
    casters.push({
      kind: "echo",
      position: { x: echo.positionX, y: echo.positionY, z: echo.positionZ },
      radius: echo.columnRadius,
      height: 7.4,
      strength: 0.24,
      softness: 1.2,
      shadowMapProxy: { shape: "column", radius: echo.columnRadius, height: 7.4, strength: 0.24 },
      importance: 80
    });
  }
  const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
  for (const source of pulseSources.sources.slice(0, 3)) {
    const lifecycle = sampleRippleSourceLifecycle(source, time);
    if (lifecycle.fade <= 0.02) continue;
    const speedMultiplier = Number.isFinite(source.speedMultiplier) ? source.speedMultiplier : 1;
    const radius = THREE.MathUtils.clamp(
      1.5 + lifecycle.ageSeconds * basePropagationSpeed * speedMultiplier * 0.18,
      1.5,
      8
    );
    const strength = 0.12 * source.strength * lifecycle.fade;
    casters.push({
      kind: "pulse",
      position: { x: source.positionX, y: 0.2, z: source.positionZ },
      radius,
      height: 0.2,
      strength,
      softness: 1.4,
      shadowMapProxy: { shape: "disc", radius, height: 0.2, strength },
      importance: 20 + lifecycle.fade * 25
    });
  }
  casters.sort((a, b) => b.importance - a.importance);
  return {
    mode: "shadow-map-contact",
    strength: 0.34,
    softness: 1.08,
    activeCasters: casters.length,
    casterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
    casters: casters.slice(0, RENDER_SCENE_SHADOW_CASTER_LIMIT)
  };
}

function createDisabledRaceTrackSnapshot(): RenderRaceTrackSnapshot {
  return {
    enabled: false,
    strength: 0,
    fieldRadius: 1,
    trackWidthMeters: 0,
    sceneUnitsPerMeter: 1,
    mask: { width: 1, height: 1, version: 0, rgba: new Uint8Array([0, 0, 0, 255]) },
    walls: {
      version: 0,
      segmentCount: 0,
      baseY: 0,
      height: 0,
      packedSegments: new Float32Array(0)
    }
  };
}

function createDisabledTrainingSnapshot(): RenderTrainingSnapshot {
  return {
    enabled: false,
    active: false,
    complete: false,
    stepId: "",
    stepIndex: 0,
    stepCount: 0,
    marker: {
      visible: false,
      position: { x: 0, y: 0, z: 0 },
      facingYawRadians: 0,
      halfWidth: 0,
      postHeight: 0,
      postWidth: 0,
      beamY: 0,
      beamThickness: 0,
      beamDepth: 0,
      glowWidth: 0,
      glowHeight: 0
    }
  };
}

function vectorSnapshot(vector: THREE.Vector3): RenderVector3Snapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function normalizeVector(vector: RenderVector3Snapshot): RenderVector3Snapshot {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function createViewProjectionSnapshot(camera: THREE.Camera): readonly number[] {
  camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return [...viewProjection.elements];
}

function getWebGpuBloomStrength(settings: LabSettings): number {
  return settings.bloomEnabled ? Math.min(settings.bloomStrength, WEBGPU_BLOOM_STRENGTH_CAP) : 0;
}

function readinessPayload(presentationProfile: RenderPresentationProfile): RippleDebugPayload {
  return {
    readinessTier: WEBGPU_READINESS_TIER,
    presentationProfile,
    defaultEligible: WEBGPU_DEFAULT_ELIGIBLE,
    remainingGaps: [...WEBGPU_REMAINING_GAPS]
  };
}

function readRequestedPlayMode(): PlayModeId | null {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "arena" || mode === "track" || mode === "training" ? mode : null;
}

function isCourseMode(mode: PlayModeId | null): boolean {
  return mode === "track" || mode === "training";
}

function isFieldStressModeEnabled(): boolean {
  const query = new URLSearchParams(window.location.search).get("stress");
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem("rippleStressMode");
  } catch {
    stored = null;
  }
  return query === "1" || stored === "1";
}

function getViewportSize(): { readonly width: number; readonly height: number } {
  return {
    width: Math.round(window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(window.visualViewport?.height ?? window.innerHeight)
  };
}

function updateEffectToggle(button: HTMLButtonElement, enabled: boolean, slider: HTMLInputElement): void {
  button.textContent = enabled ? "On" : "Off";
  button.setAttribute("aria-pressed", String(enabled));
  slider.disabled = !enabled;
}

function reportWebGpuFatalFailure(
  dom: WebGpuDom,
  rendererModeSelection: RendererModeSelection,
  presentationProfile: RenderPresentationProfile,
  message: string,
  failureKind: "startup" | "runtime" | "device-lost"
): void {
  const diagnosticChannel = failureKind === "startup" ? "webgpu.unavailable" : "webgpu.runtimeFatal";
  debugEvent(diagnosticChannel, "Forced WebGPU renderer reached a terminal failure", {
    failureKind,
    requestedMode: rendererModeSelection.requestedMode,
    selectionSource: rendererModeSelection.source,
    requestedPresentationProfile: presentationProfile,
    message
  }, "error");
  debugEvent("webgpu.fallback", "Forced WebGPU renderer failed without fallback", {
    ok: false,
    activeBackend: "none",
    failureKind,
    requestedPresentationProfile: presentationProfile,
    fallbackReason: "Forced WebGPU does not fall back to WebGL.",
    message
  }, "error");
  showWebGpuFatalError(dom, message, failureKind);
}

function showWebGpuFatalError(
  dom: WebGpuDom,
  message: string,
  failureKind: "startup" | "runtime" | "device-lost"
): void {
  dom.mainMenu.hidden = true;
  dom.hud.hidden = false;
  dom.menuToggle.hidden = true;
  dom.sceneMenuBackdrop.hidden = true;
  dom.trainingHud.hidden = true;
  dom.mobileControls.hidden = true;
  dom.pulseButton.hidden = true;
  dom.qualityBadge.textContent = "WebGPU";
  dom.statsLine.hidden = false;
  dom.mediumLine.hidden = false;
  dom.statsLine.textContent = failureKind === "device-lost"
    ? "Forced WebGPU renderer stopped after device loss"
    : failureKind === "runtime"
      ? "Forced WebGPU renderer stopped after a runtime failure"
      : "Forced WebGPU renderer unavailable";
  dom.mediumLine.textContent = "No WebGL fallback was used for this forced renderer mode.";

  const panel = document.createElement("section");
  panel.className = "webgpu-fatal";
  panel.style.position = "fixed";
  panel.style.inset = "50% auto auto 50%";
  panel.style.width = "min(620px, calc(100vw - 32px))";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.padding = "18px";
  panel.style.border = "1px solid rgba(255, 125, 231, 0.5)";
  panel.style.background = "rgba(2, 4, 9, 0.96)";
  panel.style.color = "white";
  const heading = document.createElement("h1");
  heading.textContent = failureKind === "device-lost"
    ? "WebGPU device lost"
    : failureKind === "runtime"
      ? "WebGPU renderer stopped"
      : "WebGPU unavailable";
  const detail = document.createElement("p");
  detail.textContent = message;
  const policy = document.createElement("p");
  policy.textContent = "No WebGL fallback was used for this forced renderer mode.";
  panel.append(heading, detail, policy);
  dom.app.append(panel);
}

function getDom() {
  return {
    app: requireElement<HTMLElement>("#app"),
    mainMenu: requireElement<HTMLElement>("#main-menu"),
    startTrainingButton: requireElement<HTMLButtonElement>("#start-training-button"),
    startTrackButton: requireElement<HTMLButtonElement>("#start-track-button"),
    startArenaButton: requireElement<HTMLButtonElement>("#start-arena-button"),
    mainMenuVersionLink: requireElement<HTMLButtonElement>("#main-menu-version-link"),
    gamepadStatus: requireElement<HTMLElement>("#gamepad-status"),
    hud: requireElement<HTMLElement>("#hud"),
    qualityBadge: requireElement<HTMLElement>("#quality-badge"),
    statsLine: requireElement<HTMLElement>("#stats-line"),
    mediumLine: requireElement<HTMLElement>("#medium-line"),
    trainingHud: requireElement<HTMLElement>("#training-hud"),
    trainingTitle: requireElement<HTMLElement>("#training-title"),
    trainingInstruction: requireElement<HTMLElement>("#training-instruction"),
    trainingProgress: requireElement<HTMLElement>("#training-progress"),
    menuToggle: requireElement<HTMLButtonElement>("#menu-toggle"),
    sceneMenuBackdrop: requireElement<HTMLDivElement>("#scene-menu-backdrop"),
    sceneMenu: requireElement<HTMLElement>("#scene-menu"),
    resumeButton: requireElement<HTMLButtonElement>("#resume-button"),
    exitToMainMenuButton: requireElement<HTMLButtonElement>("#exit-to-main-menu-button"),
    versionLink: requireElement<HTMLButtonElement>("#version-link"),
    qualitySelect: requireElement<HTMLSelectElement>("#quality-select"),
    skyboxSelect: requireElement<HTMLSelectElement>("#skybox-select"),
    presentationProfileRow: requireElement<HTMLElement>("#presentation-profile-row"),
    presentationProfileSelect: requireElement<HTMLSelectElement>("#presentation-profile-select"),
    fieldPaletteSelect: requireElement<HTMLSelectElement>("#field-palette-select"),
    perfOverlayToggle: requireElement<HTMLButtonElement>("#perf-overlay-toggle"),
    voxelSizeSlider: requireElement<HTMLInputElement>("#voxel-size-slider"),
    voxelSizeValue: requireElement<HTMLOutputElement>("#voxel-size-value"),
    arenaRadiusSlider: requireElement<HTMLInputElement>("#arena-radius-slider"),
    arenaRadiusValue: requireElement<HTMLOutputElement>("#arena-radius-value"),
    baseSpeedSlider: requireElement<HTMLInputElement>("#base-speed-slider"),
    baseSpeedValue: requireElement<HTMLOutputElement>("#base-speed-value"),
    boostSpeedSlider: requireElement<HTMLInputElement>("#boost-speed-slider"),
    boostSpeedValue: requireElement<HTMLOutputElement>("#boost-speed-value"),
    surfaceGripSlider: requireElement<HTMLInputElement>("#surface-grip-slider"),
    surfaceGripValue: requireElement<HTMLOutputElement>("#surface-grip-value"),
    leftStickSensitivitySlider: requireElement<HTMLInputElement>("#left-stick-sensitivity-slider"),
    leftStickSensitivityValue: requireElement<HTMLOutputElement>("#left-stick-sensitivity-value"),
    rightStickSensitivitySlider: requireElement<HTMLInputElement>("#right-stick-sensitivity-slider"),
    rightStickSensitivityValue: requireElement<HTMLOutputElement>("#right-stick-sensitivity-value"),
    heightSlider: requireElement<HTMLInputElement>("#height-slider"),
    radiusSlider: requireElement<HTMLInputElement>("#radius-slider"),
    depthSlider: requireElement<HTMLInputElement>("#depth-slider"),
    depthSpeedValue: requireElement<HTMLOutputElement>("#depth-speed-value"),
    particleSlider: requireElement<HTMLInputElement>("#particle-slider"),
    particleToggle: requireElement<HTMLButtonElement>("#particle-toggle"),
    bloomSlider: requireElement<HTMLInputElement>("#bloom-slider"),
    bloomToggle: requireElement<HTMLButtonElement>("#bloom-toggle"),
    changelogBackdrop: requireElement<HTMLDivElement>("#changelog-backdrop"),
    changelogDialog: requireElement<HTMLElement>("#changelog-dialog"),
    changelogClose: requireElement<HTMLButtonElement>("#changelog-close"),
    changelogContent: requireElement<HTMLPreElement>("#changelog-content"),
    perfOverlay: requireElement<HTMLElement>("#perf-overlay"),
    perfOverlayQuality: requireElement<HTMLElement>("#perf-overlay-quality"),
    perfFrame: requireElement<HTMLElement>("#perf-frame"),
    perfUpdate: requireElement<HTMLElement>("#perf-update"),
    perfRender: requireElement<HTMLElement>("#perf-render"),
    perfFps: requireElement<HTMLElement>("#perf-fps"),
    perfHexes: requireElement<HTMLElement>("#perf-hexes"),
    perfParticles: requireElement<HTMLElement>("#perf-particles"),
    perfWaves: requireElement<HTMLElement>("#perf-waves"),
    perfWake: requireElement<HTMLElement>("#perf-wake"),
    perfRenderer: requireElement<HTMLElement>("#perf-renderer"),
    mobileControls: requireElement<HTMLDivElement>("#mobile-controls"),
    pulseButton: requireElement<HTMLButtonElement>("#pulse-button")
  };
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
