export type WaveMediumSettings = {
  readonly gravity: number;
  effectiveDepth: number;
  damping: number;
  dispersion: number;
  wakeSpeedMultiplier: number;
};

export const DEFAULT_WAVE_MEDIUM: WaveMediumSettings = {
  gravity: 9.81,
  effectiveDepth: 8.25,
  damping: 0.16,
  dispersion: 0.22,
  wakeSpeedMultiplier: 0.82
};

export function getBasePropagationSpeedMetersPerSecond(medium: WaveMediumSettings): number {
  // Shallow-water-inspired celerity: c = sqrt(g * h). It gives us a physically
  // meaningful tuning handle without committing to a full heightfield solver.
  return Math.sqrt(Math.max(0, medium.gravity * medium.effectiveDepth));
}

export function cloneDefaultWaveMedium(): WaveMediumSettings {
  return { ...DEFAULT_WAVE_MEDIUM };
}
