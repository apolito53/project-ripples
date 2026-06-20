export type QualityId = "clean" | "pretty" | "showoff" | "meltdown";

export type QualityPreset = {
  readonly id: QualityId;
  readonly label: string;
  readonly fieldRadius: number;
  readonly tileSpacing: number;
  readonly particleBudget: number;
  readonly burstParticleCount: number;
  readonly bloomStrength: number;
  readonly shadowMapSize: number;
  readonly pulseLightCount: number;
  readonly fogDensity: number;
  readonly wakeTextureSize: number;
  readonly maxFieldInstances: number;
};

export type FieldInstanceEstimate = {
  readonly estimatedInstances: number;
  readonly maxInstances: number;
  readonly exceedsBudget: boolean;
};

// Internal scene units are kept on the original art scale, while the UI now
// speaks in meters. At the default 200m arena radius, the scene is visually
// identical to the pre-slider field; 100m halves it and 400m doubles that internal limit.
export const ARENA_RADIUS = 92;
export const DEFAULT_ARENA_RADIUS_METERS = 200;
export const ARENA_RADIUS_MIN_METERS = 100;
export const ARENA_RADIUS_MAX_METERS = DEFAULT_ARENA_RADIUS_METERS * 2;
export const DEFAULT_VOXEL_SIZE_METERS = 1;
export const VOXEL_SIZE_MIN_METERS = 0.25;
export const VOXEL_SIZE_MAX_METERS = 2;
const HEX_PLACEMENT_AREA_RATIO = 0.75 * (Math.sqrt(3) * 0.5);
const HEX_HORIZONTAL_SPACING_RATIO = 0.75;

// Meltdown carries the intentionally rude particle ceiling. Lower presets stay
// under that cap so the normal lab experience does not inherit stress-test
// numbers from a one-off experiment.
export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  clean: {
    id: "clean",
    label: "Clean",
    fieldRadius: ARENA_RADIUS,
    tileSpacing: 1.2,
    particleBudget: 30000,
    burstParticleCount: 7200,
    bloomStrength: 0,
    shadowMapSize: 0,
    pulseLightCount: 0,
    fogDensity: 0.018,
    wakeTextureSize: 256,
    maxFieldInstances: 350000
  },
  pretty: {
    id: "pretty",
    label: "Pretty",
    fieldRadius: ARENA_RADIUS,
    tileSpacing: 1,
    particleBudget: 82000,
    burstParticleCount: 20500,
    bloomStrength: 0.14,
    shadowMapSize: 1024,
    pulseLightCount: 3,
    fogDensity: 0.016,
    wakeTextureSize: 384,
    maxFieldInstances: 500000
  },
  showoff: {
    id: "showoff",
    label: "Showoff",
    fieldRadius: ARENA_RADIUS,
    tileSpacing: 0.9,
    particleBudget: 165000,
    burstParticleCount: 41000,
    bloomStrength: 0.24,
    shadowMapSize: 2048,
    pulseLightCount: 5,
    fogDensity: 0.013,
    wakeTextureSize: 512,
    maxFieldInstances: 700000
  },
  meltdown: {
    id: "meltdown",
    label: "Meltdown",
    fieldRadius: ARENA_RADIUS,
    tileSpacing: 0.72,
    particleBudget: 320000,
    burstParticleCount: 82000,
    bloomStrength: 0.38,
    shadowMapSize: 4096,
    pulseLightCount: 8,
    fogDensity: 0.01,
    wakeTextureSize: 768,
    maxFieldInstances: 950000
  }
};

export function isQualityId(value: string): value is QualityId {
  return value === "clean" || value === "pretty" || value === "showoff" || value === "meltdown";
}

export function estimateFieldInstancesForPreset(preset: QualityPreset): FieldInstanceEstimate {
  const estimatedInstances = estimateHexInstanceCount(preset.fieldRadius, preset.tileSpacing);
  return {
    estimatedInstances,
    maxInstances: preset.maxFieldInstances,
    exceedsBudget: estimatedInstances > preset.maxFieldInstances
  };
}

export function getMaxArenaRadiusMetersForFieldBudget(qualityId: QualityId, voxelSizeMeters: number): number {
  const basePreset = QUALITY_PRESETS[qualityId];
  const safeVoxelSize = clamp(voxelSizeMeters, VOXEL_SIZE_MIN_METERS, VOXEL_SIZE_MAX_METERS);
  const tileSpacing = basePreset.tileSpacing * safeVoxelSize;
  const maxSceneRadius = getMaxSceneRadiusForInstanceBudget(tileSpacing, basePreset.maxFieldInstances);
  const maxArenaMeters = DEFAULT_ARENA_RADIUS_METERS * (maxSceneRadius / ARENA_RADIUS);
  return clamp(roundDownToStep(maxArenaMeters, 5), ARENA_RADIUS_MIN_METERS, ARENA_RADIUS_MAX_METERS);
}

export function getMinVoxelSizeMetersForFieldBudget(qualityId: QualityId, arenaRadiusMeters: number): number {
  const basePreset = QUALITY_PRESETS[qualityId];
  const safeArenaMeters = clamp(arenaRadiusMeters, ARENA_RADIUS_MIN_METERS, ARENA_RADIUS_MAX_METERS);
  const sceneRadius = ARENA_RADIUS * (safeArenaMeters / DEFAULT_ARENA_RADIUS_METERS);

  // The exact loop includes a tiny placement margin derived from tile spacing.
  // Ignoring that margin here makes the first-pass size slightly optimistic, so
  // the caller re-checks after applying this value before trusting the clamp.
  const requiredTileSpacing = Math.sqrt(Math.PI * sceneRadius * sceneRadius / basePreset.maxFieldInstances);
  const requiredVoxelSize = requiredTileSpacing / basePreset.tileSpacing;
  return clamp(roundUpToStep(requiredVoxelSize, 0.05), VOXEL_SIZE_MIN_METERS, VOXEL_SIZE_MAX_METERS);
}

function estimateHexInstanceCount(fieldRadius: number, tileSpacing: number): number {
  const placementDiameter = tileSpacing / Math.sqrt(HEX_PLACEMENT_AREA_RATIO);
  const horizontalSpacing = placementDiameter * HEX_HORIZONTAL_SPACING_RATIO;
  const placementRadius = fieldRadius + horizontalSpacing * 0.5;

  // The staggered placement loop effectively tests one candidate per
  // tileSpacing^2 of area. This estimate tracks the real loop closely enough to
  // guard rebuilds without running the expensive placement walk twice.
  return Math.ceil(Math.PI * placementRadius * placementRadius / Math.max(0.0001, tileSpacing * tileSpacing));
}

function getMaxSceneRadiusForInstanceBudget(tileSpacing: number, maxInstances: number): number {
  const placementDiameter = tileSpacing / Math.sqrt(HEX_PLACEMENT_AREA_RATIO);
  const horizontalSpacing = placementDiameter * HEX_HORIZONTAL_SPACING_RATIO;
  const placementRadius = Math.sqrt(maxInstances * tileSpacing * tileSpacing / Math.PI);
  return Math.max(0, placementRadius - horizontalSpacing * 0.5);
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function roundDownToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
