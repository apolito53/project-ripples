export type QualityId = "clean" | "pretty" | "showoff" | "meltdown";

export type QualityPreset = {
  readonly id: QualityId;
  readonly label: string;
  readonly fieldRadius: number;
  readonly cubeSpacing: number;
  readonly particleBudget: number;
  readonly burstParticleCount: number;
  readonly bloomStrength: number;
  readonly shadowMapSize: number;
  readonly pulseLightCount: number;
  readonly fogDensity: number;
};

export const ARENA_RADIUS = 92;

// Meltdown carries the intentionally rude particle ceiling. Lower presets stay
// under that cap so the normal lab experience does not inherit stress-test
// numbers from a one-off experiment.
export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  clean: {
    id: "clean",
    label: "Clean",
    fieldRadius: ARENA_RADIUS,
    cubeSpacing: 1.2,
    particleBudget: 30000,
    burstParticleCount: 7200,
    bloomStrength: 0,
    shadowMapSize: 0,
    pulseLightCount: 0,
    fogDensity: 0.018
  },
  pretty: {
    id: "pretty",
    label: "Pretty",
    fieldRadius: ARENA_RADIUS,
    cubeSpacing: 1,
    particleBudget: 82000,
    burstParticleCount: 20500,
    bloomStrength: 0.14,
    shadowMapSize: 1024,
    pulseLightCount: 3,
    fogDensity: 0.016
  },
  showoff: {
    id: "showoff",
    label: "Showoff",
    fieldRadius: ARENA_RADIUS,
    cubeSpacing: 0.9,
    particleBudget: 165000,
    burstParticleCount: 41000,
    bloomStrength: 0.24,
    shadowMapSize: 2048,
    pulseLightCount: 5,
    fogDensity: 0.013
  },
  meltdown: {
    id: "meltdown",
    label: "Meltdown",
    fieldRadius: ARENA_RADIUS,
    cubeSpacing: 0.72,
    particleBudget: 320000,
    burstParticleCount: 82000,
    bloomStrength: 0.38,
    shadowMapSize: 4096,
    pulseLightCount: 8,
    fogDensity: 0.01
  }
};

export function isQualityId(value: string): value is QualityId {
  return value === "clean" || value === "pretty" || value === "showoff" || value === "meltdown";
}
