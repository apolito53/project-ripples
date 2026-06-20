import { getQualityPreset, type LabSettings } from "./labSettings";
import {
  estimateFieldInstancesForPreset,
  getMaxArenaRadiusMetersForFieldBudget,
  getMinVoxelSizeMetersForFieldBudget
} from "./qualityPresets";

export type FieldScaleChangedControl = "quality" | "voxel-size" | "arena-radius";
export type FieldScaleClampedField = "voxelSizeMeters" | "arenaRadiusMeters";

export type FieldScaleGuardrailResult = {
  readonly applied: boolean;
  readonly changedControl: FieldScaleChangedControl;
  readonly clampedField?: FieldScaleClampedField;
  readonly quality: string;
  readonly maxInstances: number;
  readonly estimatedInstancesBefore: number;
  readonly estimatedInstancesAfter: number;
  readonly voxelSizeMetersBefore: number;
  readonly voxelSizeMetersAfter: number;
  readonly arenaRadiusMetersBefore: number;
  readonly arenaRadiusMetersAfter: number;
};

export function applyFieldInstanceBudget(
  settings: LabSettings,
  changedControl: FieldScaleChangedControl,
  stressModeEnabled: boolean
): FieldScaleGuardrailResult {
  const beforePreset = getQualityPreset(settings);
  const beforeEstimate = estimateFieldInstancesForPreset(beforePreset);
  const beforeVoxelSizeMeters = settings.voxelSizeMeters;
  const beforeArenaRadiusMeters = settings.arenaRadiusMeters;

  if (stressModeEnabled || !beforeEstimate.exceedsBudget) {
    return {
      applied: false,
      changedControl,
      quality: settings.qualityId,
      maxInstances: beforeEstimate.maxInstances,
      estimatedInstancesBefore: beforeEstimate.estimatedInstances,
      estimatedInstancesAfter: beforeEstimate.estimatedInstances,
      voxelSizeMetersBefore: beforeVoxelSizeMeters,
      voxelSizeMetersAfter: settings.voxelSizeMeters,
      arenaRadiusMetersBefore: beforeArenaRadiusMeters,
      arenaRadiusMetersAfter: settings.arenaRadiusMeters
    };
  }

  const clampedField = getPreferredClampField(changedControl);
  applyClamp(settings, clampedField);

  // UI-friendly step rounding can still leave the estimate a hair over budget.
  // If that happens, clamp radius as the final safety valve because shrinking
  // the arena has a predictable square-law effect on instance count.
  let afterPreset = getQualityPreset(settings);
  let afterEstimate = estimateFieldInstancesForPreset(afterPreset);
  if (afterEstimate.exceedsBudget) {
    applyClamp(settings, "arenaRadiusMeters");
    afterPreset = getQualityPreset(settings);
    afterEstimate = estimateFieldInstancesForPreset(afterPreset);
  }

  return {
    applied: true,
    changedControl,
    clampedField,
    quality: settings.qualityId,
    maxInstances: afterEstimate.maxInstances,
    estimatedInstancesBefore: beforeEstimate.estimatedInstances,
    estimatedInstancesAfter: afterEstimate.estimatedInstances,
    voxelSizeMetersBefore: beforeVoxelSizeMeters,
    voxelSizeMetersAfter: settings.voxelSizeMeters,
    arenaRadiusMetersBefore: beforeArenaRadiusMeters,
    arenaRadiusMetersAfter: settings.arenaRadiusMeters
  };
}

function getPreferredClampField(changedControl: FieldScaleChangedControl): FieldScaleClampedField {
  // Preserve the last thing the user touched. Shrinking hexes clamps radius,
  // while expanding the arena or changing quality grows the hex diameter just
  // enough to avoid a surprise multi-million-instance rebuild.
  return changedControl === "voxel-size" ? "arenaRadiusMeters" : "voxelSizeMeters";
}

function applyClamp(settings: LabSettings, clampedField: FieldScaleClampedField): void {
  if (clampedField === "arenaRadiusMeters") {
    settings.arenaRadiusMeters = getMaxArenaRadiusMetersForFieldBudget(
      settings.qualityId,
      settings.voxelSizeMeters
    );
    return;
  }

  settings.voxelSizeMeters = getMinVoxelSizeMetersForFieldBudget(
    settings.qualityId,
    settings.arenaRadiusMeters
  );
}
