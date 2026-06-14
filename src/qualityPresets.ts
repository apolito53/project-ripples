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

// The lab is currently in "make the GPU sweat" mode: particle budgets and burst
// counts are deliberately 100x the previously tuned values.
export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  clean: {
    id: "clean",
    label: "Clean",
    fieldRadius: 24,
    cubeSpacing: 1.2,
    particleBudget: 300000,
    burstParticleCount: 72000,
    bloomStrength: 0,
    shadowMapSize: 0,
    pulseLightCount: 0,
    fogDensity: 0.018
  },
  pretty: {
    id: "pretty",
    label: "Pretty",
    fieldRadius: 32,
    cubeSpacing: 1,
    particleBudget: 820000,
    burstParticleCount: 205000,
    bloomStrength: 0.14,
    shadowMapSize: 1024,
    pulseLightCount: 3,
    fogDensity: 0.016
  },
  showoff: {
    id: "showoff",
    label: "Showoff",
    fieldRadius: 42,
    cubeSpacing: 0.9,
    particleBudget: 1650000,
    burstParticleCount: 410000,
    bloomStrength: 0.24,
    shadowMapSize: 2048,
    pulseLightCount: 5,
    fogDensity: 0.013
  },
  meltdown: {
    id: "meltdown",
    label: "Meltdown",
    fieldRadius: 56,
    cubeSpacing: 0.72,
    particleBudget: 3200000,
    burstParticleCount: 820000,
    bloomStrength: 0.38,
    shadowMapSize: 4096,
    pulseLightCount: 8,
    fogDensity: 0.01
  }
};

export function isQualityId(value: string): value is QualityId {
  return value === "clean" || value === "pretty" || value === "showoff" || value === "meltdown";
}
