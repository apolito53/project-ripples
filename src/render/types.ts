import * as THREE from "three";
import type { EchoVisualStateSnapshot } from "../echoState";
import type { LabSettings } from "../labSettings";
import type { ParticleStateSnapshot } from "../particleState";
import type { QualityPreset } from "../qualityPresets";
import type { RaceTrackMaskSnapshot, RaceTrackWallSnapshot } from "../raceTrack";
import type { RippleFieldLayout } from "../rippleFieldLayout";
import type { RippleRenderSourceSnapshot } from "../rippleSources";
import type { SkyboxId, SkyboxOption } from "../skybox";
import type {
  TrainingMarkerPresentationSnapshot,
  TrainingPresentationSnapshot
} from "../trainingRun";

export const RENDER_SCENE_LOCAL_LIGHT_LIMIT = 16;
export const RENDER_SCENE_SHADOW_CASTER_LIMIT = 16;

export type RenderVector3Snapshot = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type RenderQuaternionSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
};

export type RenderProjectionMode = "perspective" | "orthographic";

export type RenderCameraProjectionSnapshot = {
  readonly mode: RenderProjectionMode;
  readonly cameraMode: "playable" | "diagnostic-orbit";
  readonly near: number;
  readonly far: number;
  readonly fovDegrees: number;
  readonly aspect: number;
};

export type RenderViewportSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
};

export type RenderSettingsSnapshot = Pick<
  LabSettings,
  | "rippleHeight"
  | "rippleRadius"
  | "playerSpeed"
  | "surfaceGrip"
  | "voxelSizeMeters"
  | "arenaRadiusMeters"
  | "particleDensity"
  | "particlesEnabled"
  | "bloomStrength"
  | "bloomEnabled"
> & {
  readonly waveMedium: LabSettings["waveMedium"];
};

export type RenderPlayModeSnapshot = "arena" | "track" | "training" | "none";

export type RenderRaceTrackMaskSnapshot = RaceTrackMaskSnapshot;

export type RenderRaceTrackWallSnapshot = RaceTrackWallSnapshot;

export type RenderRaceTrackSnapshot = {
  readonly enabled: boolean;
  readonly strength: number;
  readonly fieldRadius: number;
  readonly trackWidthMeters: number;
  readonly sceneUnitsPerMeter: number;
  readonly mask: RenderRaceTrackMaskSnapshot;
  readonly walls: RenderRaceTrackWallSnapshot;
};

export type RenderTrainingMarkerSnapshot = TrainingMarkerPresentationSnapshot;

export type RenderTrainingSnapshot = TrainingPresentationSnapshot;

/**
 * Presentation profiles keep the original flat WebGPU art direction available
 * while the default Classic path restores dimensional WebGL-inspired tiles.
 */
export type RenderPresentationProfile = "core" | "classic";

export type RenderScenePresentationSnapshot = {
  readonly mode: "webgpu-core-scene";
  readonly profile: RenderPresentationProfile;
  readonly arenaRadius: number;
  readonly skyboxId: SkyboxId;
  readonly skybox: SkyboxOption;
  readonly postGlowEnabled: boolean;
  readonly postGlowStrength: number;
};

export type RenderAvatarPresentationMode = "hover-pod" | "mote-core";

export type RenderAvatarPresentationSnapshot = {
  readonly mode: RenderAvatarPresentationMode;
  readonly position: RenderVector3Snapshot;
  readonly facingYawRadians: number;
  readonly speed: number;
  readonly groundContact: number;
  readonly coreRadius: number;
  readonly glowRadius: number;
  readonly glowStrength: number;
  readonly assetId: "webgpu-hover-pod";
  readonly moteAssetId: "mote-core-orbit";
  readonly bodyLength: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly noseLength: number;
  readonly tailLength: number;
  readonly thrusterGlow: number;
  readonly finGlow: number;
  readonly primaryColor: RenderVector3Snapshot;
  readonly secondaryColor: RenderVector3Snapshot;
  readonly accentColor: RenderVector3Snapshot;
};

export type RenderSceneLocalLightKind = "avatar" | "pulse" | "echo" | "echo-burst";

export type RenderSceneLocalLightSnapshot = {
  readonly kind: RenderSceneLocalLightKind;
  readonly position: RenderVector3Snapshot;
  readonly color: RenderVector3Snapshot;
  readonly intensity: number;
  readonly radius: number;
  readonly importance: number;
};

export type RenderSceneLightingSnapshot = {
  readonly ambientColor: RenderVector3Snapshot;
  readonly ambientIntensity: number;
  readonly keyDirection: RenderVector3Snapshot;
  readonly keyColor: RenderVector3Snapshot;
  readonly keyIntensity: number;
  readonly rimDirection: RenderVector3Snapshot;
  readonly rimColor: RenderVector3Snapshot;
  readonly rimIntensity: number;
  readonly activeLocalLights: number;
  readonly localLightLimit: number;
  readonly localLights: readonly RenderSceneLocalLightSnapshot[];
};

export type RenderSceneShadowCasterKind = "avatar" | "echo" | "echo-burst" | "pulse";

export type RenderSceneShadowMapProxyShape = "orb" | "column" | "disc";

export type RenderSceneShadowMapProxySnapshot = {
  readonly shape: RenderSceneShadowMapProxyShape;
  readonly radius: number;
  readonly height: number;
  readonly strength: number;
};

export type RenderSceneShadowCasterSnapshot = {
  readonly kind: RenderSceneShadowCasterKind;
  readonly position: RenderVector3Snapshot;
  readonly radius: number;
  readonly height: number;
  readonly strength: number;
  readonly softness: number;
  readonly shadowMapProxy: RenderSceneShadowMapProxySnapshot;
  readonly importance: number;
};

export type RenderSceneShadowSnapshot = {
  readonly mode: "shadow-map-contact";
  readonly strength: number;
  readonly softness: number;
  readonly activeCasters: number;
  readonly casterLimit: number;
  readonly casters: readonly RenderSceneShadowCasterSnapshot[];
};

export type RenderInput = {
  readonly time: number;
  readonly delta: number;
  readonly playMode: RenderPlayModeSnapshot;
  readonly fieldLayout: RippleFieldLayout;
  readonly raceTrack: RenderRaceTrackSnapshot;
  readonly training: RenderTrainingSnapshot;
  readonly viewport: RenderViewportSnapshot;
  readonly camera: {
    readonly position: RenderVector3Snapshot;
    readonly quaternion: RenderQuaternionSnapshot;
    readonly viewProjectionMatrix: readonly number[];
    readonly projection: RenderCameraProjectionSnapshot;
  };
  readonly player: {
    readonly previousPosition: RenderVector3Snapshot;
    readonly position: RenderVector3Snapshot;
    readonly velocity: RenderVector3Snapshot;
    readonly speed: number;
    readonly groundContact: number;
    readonly facingYawRadians: number;
  };
  readonly scenePresentation: RenderScenePresentationSnapshot;
  readonly avatarPresentation: RenderAvatarPresentationSnapshot;
  readonly sceneLighting: RenderSceneLightingSnapshot;
  readonly sceneShadows: RenderSceneShadowSnapshot;
  readonly settings: RenderSettingsSnapshot;
  readonly qualityPreset: QualityPreset;
  readonly pulseSources: RippleRenderSourceSnapshot;
  readonly echoVisualState: EchoVisualStateSnapshot;
  readonly particleState: ParticleStateSnapshot;
  readonly bloomStrength: number;
};

export type RendererBackendId = "webgl" | "webgpu";

export type RenderRuntimeCapabilities = {
  readonly backendId: RendererBackendId;
  readonly maxTextureSize: number;
  readonly supportsBloom: boolean;
  readonly supportsLocalLights: boolean;
  readonly fallbackReason: string;
  readonly deviceLost: boolean;
};

export type RenderRuntimeStats = {
  readonly backendId: RendererBackendId;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly pixelRatio: number;
  readonly gpuCpuSubmitMs: number;
  readonly gpuFrameMs?: number;
  readonly gpuFrameSequence?: number;
  readonly gpuTimerMode?: string;
  readonly gpuTimerErrorCount?: number;
  readonly fallbackReason: string;
  readonly deviceLost: boolean;
  readonly wakeMaxAbsHeight?: number;
  readonly wakeMeanAbsHeight?: number;
  readonly wakeMaxCrest?: number;
  readonly wakeEnergyEstimate?: number;
  readonly activeLocalLights?: number;
  readonly renderedLocalLights?: number;
  readonly echoVisualActiveEchoes?: number;
  readonly echoVisualRenderedEchoes?: number;
  readonly echoVisualActiveCollectionEvents?: number;
  readonly echoVisualRenderedCollectionEvents?: number;
  readonly echoVisualPassMs?: number;
  readonly bloomMode?: string;
  readonly bloomPasses?: number;
  readonly bloomStrength?: number;
  readonly bloomPassMs?: number;
  readonly shadowMode?: string;
  readonly activeShadowCasters?: number;
  readonly renderedShadowCasters?: number;
  readonly shadowCasterLimit?: number;
  readonly shadowStrength?: number;
  readonly shadowSoftness?: number;
  readonly shadowUpdateMs?: number;
  readonly shadowMapSize?: number;
  readonly shadowMapFormat?: string;
  readonly shadowMapPassMs?: number;
  readonly shadowMapPcfTaps?: number;
  readonly shadowMapLightBounds?: number;
  readonly shadowGeometryMode?: string;
  readonly shadowFieldReceiver?: boolean;
  readonly shadowMapRenderedOrbCasters?: number;
  readonly shadowMapRenderedColumnCasters?: number;
  readonly shadowMapRenderedDiscCasters?: number;
  readonly shadowMapProxyTriangles?: number;
  readonly raceTrackEnabled?: boolean;
  readonly raceTrackStrength?: number;
  readonly trackFieldRadius?: number;
  readonly trackWidthMeters?: number;
  readonly raceTrackMaskWidth?: number;
  readonly raceTrackMaskHeight?: number;
  readonly raceTrackMaskVersion?: number;
  readonly trackMaskUploaded?: boolean;
  readonly trackMaskBodyCoverage?: number;
  readonly trackMaskEdgeCoverage?: number;
  readonly trackMaskCenterCoverage?: number;
  readonly arenaBarrierEnabled?: boolean;
  readonly trackWallEnabled?: boolean;
  readonly trackWallVersion?: number;
  readonly trackWallSegments?: number;
  readonly trackWallDrawCalls?: number;
  readonly trackWallTriangles?: number;
  readonly trackWallPassMs?: number;
  readonly trainingEnabled?: boolean;
  readonly trainingActive?: boolean;
  readonly trainingComplete?: boolean;
  readonly trainingStepId?: string;
  readonly trainingStepIndex?: number;
  readonly trainingStepCount?: number;
  readonly trainingMarkerVisible?: boolean;
  readonly trainingMarkerDrawCalls?: number;
  readonly trainingMarkerTriangles?: number;
  readonly trainingMarkerPassMs?: number;
  readonly fieldLayoutMode?: string;
  readonly culledHexCount?: number;
};

export type RenderFrameInput = RenderInput;

export interface RenderRuntime {
  readonly backendId: RendererBackendId;
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: RenderRuntimeCapabilities;
  beginFrame(): void;
  renderFrame(input: RenderFrameInput): void;
  resize(width: number, height: number, pixelRatio: number): void;
  applyQualityPreset(preset: QualityPreset, bloomStrength: number, reason?: "quality" | "field-scale"): void;
  prewarm(): void;
  setAnimationLoop(callback: Parameters<THREE.WebGLRenderer["setAnimationLoop"]>[0]): void;
  getStats(): RenderRuntimeStats;
  destroy(): void;
}

export type ThreeRenderRuntimeOptions = {
  readonly app: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly initialBloomStrength: number;
  readonly fallbackReason: string;
};
