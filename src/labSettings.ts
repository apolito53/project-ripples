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

export type LabSettings = {
  qualityId: QualityId;
  rippleHeight: number;
  rippleRadius: number;
  voxelSizeMeters: number;
  arenaRadiusMeters: number;
  waveMedium: WaveMediumSettings;
  particleDensity: number;
  bloomStrength: number;
};

export const DEFAULT_SETTINGS: LabSettings = {
  qualityId: "pretty",
  rippleHeight: 1.25,
  rippleRadius: 9,
  voxelSizeMeters: DEFAULT_VOXEL_SIZE_METERS,
  arenaRadiusMeters: ARENA_RADIUS_MIN_METERS,
  waveMedium: cloneDefaultWaveMedium(),
  particleDensity: 0.62,
  bloomStrength: QUALITY_PRESETS.pretty.bloomStrength
};

export function getQualityPreset(settings: LabSettings): QualityPreset {
  const basePreset = QUALITY_PRESETS[settings.qualityId];
  const voxelSizeMeters = clamp(settings.voxelSizeMeters, VOXEL_SIZE_MIN_METERS, VOXEL_SIZE_MAX_METERS);

  // Quality still picks the baseline density. The voxel-size slider scales that
  // baseline spacing, so Meltdown can keep its visual character while the user
  // makes the individual blocks smaller or chunkier.
  return {
    ...basePreset,
    fieldRadius: getArenaRadiusSceneUnits(settings.arenaRadiusMeters),
    cubeSpacing: basePreset.cubeSpacing * voxelSizeMeters
  };
}

export function cloneDefaultSettings(): LabSettings {
  return {
    ...DEFAULT_SETTINGS,
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
