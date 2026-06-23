import {
  DEFAULT_PLAYER_SPEED_SETTINGS,
  type PlayerSpeedSettings
} from "./controls";
import {
  ARENA_RADIUS,
  ARENA_RADIUS_MAX_METERS,
  ARENA_RADIUS_MIN_METERS,
  DEFAULT_ARENA_RADIUS_METERS,
  DEFAULT_VOXEL_SIZE_METERS,
  QUALITY_PRESETS,
  VOXEL_SIZE_MAX_METERS,
  VOXEL_SIZE_MIN_METERS,
  type QualityId,
  type QualityPreset
} from "./qualityPresets";
import {
  cloneDefaultWaveMedium,
  type WaveMediumSettings
} from "./waveMedium";
import { DEFAULT_SKYBOX_ID, type SkyboxId } from "./skybox";

export type LabSettings = {
  qualityId: QualityId;
  skyboxId: SkyboxId;
  playerSpeed: PlayerSpeedSettings;
  surfaceGrip: number;
  rippleHeight: number;
  rippleRadius: number;
  voxelSizeMeters: number;
  arenaRadiusMeters: number;
  waveMedium: WaveMediumSettings;
  particleDensity: number;
  particlesEnabled: boolean;
  bloomStrength: number;
  bloomEnabled: boolean;
};

export const DEFAULT_SETTINGS: LabSettings = {
  qualityId: "pretty",
  skyboxId: DEFAULT_SKYBOX_ID,
  playerSpeed: DEFAULT_PLAYER_SPEED_SETTINGS,
  surfaceGrip: 1,
  rippleHeight: 1.25,
  rippleRadius: 9,
  voxelSizeMeters: DEFAULT_VOXEL_SIZE_METERS,
  arenaRadiusMeters: DEFAULT_ARENA_RADIUS_METERS,
  waveMedium: cloneDefaultWaveMedium(),
  particleDensity: 0.62,
  particlesEnabled: true,
  bloomStrength: QUALITY_PRESETS.pretty.bloomStrength,
  bloomEnabled: true
};

export function getQualityPreset(settings: LabSettings): QualityPreset {
  const basePreset = QUALITY_PRESETS[settings.qualityId];
  const voxelSizeMeters = clamp(settings.voxelSizeMeters, VOXEL_SIZE_MIN_METERS, VOXEL_SIZE_MAX_METERS);

  // Quality still picks the baseline density. The size slider scales that
  // baseline spacing and now represents the hex tile's widest point-to-point
  // diameter, so Meltdown can keep its visual character while cells shrink.
  return {
    ...basePreset,
    fieldRadius: getArenaRadiusSceneUnits(settings.arenaRadiusMeters),
    tileSpacing: basePreset.tileSpacing * voxelSizeMeters
  };
}

export function cloneDefaultSettings(): LabSettings {
  return {
    ...DEFAULT_SETTINGS,
    playerSpeed: { ...DEFAULT_SETTINGS.playerSpeed },
    waveMedium: { ...DEFAULT_SETTINGS.waveMedium }
  };
}

export function getArenaRadiusSceneUnits(arenaRadiusMeters: number): number {
  const radiusMeters = clamp(arenaRadiusMeters, ARENA_RADIUS_MIN_METERS, ARENA_RADIUS_MAX_METERS);
  return ARENA_RADIUS * (radiusMeters / DEFAULT_ARENA_RADIUS_METERS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
