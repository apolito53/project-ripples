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
    wakeTextureSize: 256
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
    wakeTextureSize: 384
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
    wakeTextureSize: 512
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
    wakeTextureSize: 768
  }
};

export function isQualityId(value: string): value is QualityId {
  return value === "clean" || value === "pretty" || value === "showoff" || value === "meltdown";
}
