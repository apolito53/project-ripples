import { QUALITY_PRESETS, type QualityId, type QualityPreset } from "./qualityPresets";
import {
  cloneDefaultWaveMedium,
  type WaveMediumSettings
} from "./waveMedium";

export type LabSettings = {
  qualityId: QualityId;
  rippleHeight: number;
  rippleRadius: number;
  waveMedium: WaveMediumSettings;
  particleDensity: number;
  bloomStrength: number;
};

export const DEFAULT_SETTINGS: LabSettings = {
  qualityId: "pretty",
  rippleHeight: 1.25,
  rippleRadius: 9,
  waveMedium: cloneDefaultWaveMedium(),
  particleDensity: 0.62,
  bloomStrength: QUALITY_PRESETS.pretty.bloomStrength
};

export function getQualityPreset(settings: LabSettings): QualityPreset {
  return QUALITY_PRESETS[settings.qualityId];
}

export function cloneDefaultSettings(): LabSettings {
  return {
    ...DEFAULT_SETTINGS,
    waveMedium: { ...DEFAULT_SETTINGS.waveMedium }
  };
}
