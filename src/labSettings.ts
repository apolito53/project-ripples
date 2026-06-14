import { QUALITY_PRESETS, type QualityId, type QualityPreset } from "./qualityPresets";

export type LabSettings = {
  qualityId: QualityId;
  rippleHeight: number;
  rippleRadius: number;
  waveSpeed: number;
  particleDensity: number;
  bloomStrength: number;
};

export const DEFAULT_SETTINGS: LabSettings = {
  qualityId: "pretty",
  rippleHeight: 1.25,
  rippleRadius: 9,
  waveSpeed: 9,
  particleDensity: 0.72,
  bloomStrength: QUALITY_PRESETS.pretty.bloomStrength
};

export function getQualityPreset(settings: LabSettings): QualityPreset {
  return QUALITY_PRESETS[settings.qualityId];
}

export function cloneDefaultSettings(): LabSettings {
  return { ...DEFAULT_SETTINGS };
}
