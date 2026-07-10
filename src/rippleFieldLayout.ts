import type { QualityPreset } from "./qualityPresets";
import { MAX_SHADER_RIPPLE_SOURCES } from "./rippleSources";
import { sampleFieldHeight } from "./terrain";

export const HEX_TILE_DIAMETER = 0.89;
export const BASE_TILE_HEIGHT = 0.08;
export const RIPPLE_WIDTH = 1.45;

const HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO = 0.75;
const HEX_FLAT_TOP_VERTICAL_SPACING_RATIO = Math.sqrt(3) * 0.5;
const HEX_AREA_RATIO = HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO * HEX_FLAT_TOP_VERTICAL_SPACING_RATIO;
const MIN_RENDERED_RIPPLE_SOURCES = 8;
const SHADER_SOURCE_EVALUATION_BUDGET = 2_400_000;

export type RippleFieldLayout = {
  readonly qualityId: QualityPreset["id"];
  readonly qualityLabel: string;
  readonly fieldRadius: number;
  readonly tileSpacing: number;
  readonly hexHorizontalSpacing: number;
  readonly hexVerticalSpacing: number;
  readonly instanceCount: number;
  readonly buildStats: RippleFieldBuildStats;
  readonly renderedRippleSourceLimit: number;
  readonly positions: readonly number[];
  readonly phases: readonly number[];
  readonly tints: readonly number[];
};

export type FieldPlacementClipper = {
  readonly label: string;
  containsPoint(x: number, z: number): boolean;
};

export type RippleFieldBuildStats = {
  readonly mode: "full" | "clipped";
  readonly clipperLabel: string;
  readonly fullHexCount: number;
  readonly culledHexCount: number;
  readonly instanceCount: number;
};

export function createRippleFieldLayout(
  preset: QualityPreset,
  placementClipper: FieldPlacementClipper | null = null
): RippleFieldLayout {
  const positions: number[] = [];
  const phases: number[] = [];
  const tints: number[] = [];
  const radius = preset.fieldRadius;
  const spacing = getHexHorizontalSpacing(preset);
  const rowSpacing = getHexVerticalSpacing(preset);

  const halfColumnCount = Math.ceil(radius / spacing) + 1;
  const halfRowCount = Math.ceil(radius / rowSpacing) + 1;
  const placementRadius = radius + spacing * 0.5;
  const placementRadiusSquared = placementRadius * placementRadius;
  let fullHexCount = 0;

  // The arena floor is circular, but the cells live on a flat-top hex lattice.
  // Keeping this builder renderer-neutral lets WebGL and WebGPU share exactly
  // the same placement budget before their material implementations diverge.
  // Track mode can add a CPU clipper for WebGL field layout without passing the
  // RaceTrack object through the render contract.
  for (let iz = -halfRowCount; iz <= halfRowCount; iz += 1) {
    const rowOffset = Math.abs(iz % 2) === 1 ? spacing * 0.5 : 0;
    const z = iz * rowSpacing;

    for (let ix = -halfColumnCount; ix <= halfColumnCount; ix += 1) {
      const x = ix * spacing + rowOffset;
      if (x * x + z * z > placementRadiusSquared) continue;
      fullHexCount += 1;
      if (placementClipper && !placementClipper.containsPoint(x, z)) continue;

      const y = sampleFieldHeight(x, z);
      const terrainTint = createTerrainTint(x, y, z);

      positions.push(x, y, z);
      phases.push(pseudoRandom(x, z) * Math.PI * 2);
      tints.push(terrainTint.r, terrainTint.g, terrainTint.b);
    }
  }

  const instanceCount = positions.length / 3;
  const buildStats: RippleFieldBuildStats = {
    mode: placementClipper ? "clipped" : "full",
    clipperLabel: placementClipper?.label ?? "none",
    fullHexCount,
    culledHexCount: Math.max(0, fullHexCount - instanceCount),
    instanceCount
  };
  return {
    qualityId: preset.id,
    qualityLabel: preset.label,
    fieldRadius: radius,
    tileSpacing: preset.tileSpacing,
    hexHorizontalSpacing: spacing,
    hexVerticalSpacing: rowSpacing,
    instanceCount,
    buildStats,
    renderedRippleSourceLimit: getRenderedRippleSourceLimit(instanceCount),
    positions,
    phases,
    tints
  };
}

export function getRenderedRippleSourceLimit(instanceCount: number): number {
  // Ripple source evaluation runs once per rendered hex cap. At 25cm voxels a
  // single arena can have hundreds of thousands of caps, so keeping all 32 wave
  // sources visible turns each frame into millions of shader evaluations. This
  // keeps the newest sources visible while density is extreme, without deleting
  // older gameplay sources before their lifetimes finish.
  const densityLimit = Math.floor(SHADER_SOURCE_EVALUATION_BUDGET / Math.max(1, instanceCount));
  return clamp(densityLimit, MIN_RENDERED_RIPPLE_SOURCES, MAX_SHADER_RIPPLE_SOURCES);
}

function createTerrainTint(x: number, y: number, z: number): { readonly r: number; readonly g: number; readonly b: number } {
  const cool = hexToRgb(0x143a55);
  const warm = hexToRgb(0x2a5a6a);
  const accent = hexToRgb(0x3958a7);
  const high = hexToRgb(0xd8fbff);
  const mix = pseudoRandom(x * 0.3 + y, z * 0.7);
  const terrainWhiteness = smoothstep(-1.35, 1.95, y) * 0.24;

  // The shader handles animated height whitening every frame. This baked tint
  // gives the still terrain the same language before any waves pass through it.
  return lerpColor(
    lerpColor(
      lerpColor(cool, warm, 0.35 + mix * 0.35),
      accent,
      Math.max(0, y) * 0.035
    ),
    high,
    terrainWhiteness
  );
}

function getHexHorizontalSpacing(preset: QualityPreset): number {
  return getHexPlacementDiameter(preset) * HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO;
}

function getHexVerticalSpacing(preset: QualityPreset): number {
  return getHexPlacementDiameter(preset) * HEX_FLAT_TOP_VERTICAL_SPACING_RATIO;
}

function getHexPlacementDiameter(preset: QualityPreset): number {
  // Before the hex conversion, `tileSpacing` roughly meant one cell's area in
  // the placement grid. Preserve that density by solving for the flat-top hex
  // diameter that gives the same center-cell area. `HEX_TILE_DIAMETER` is then
  // calibrated so Meltdown's visual footprint nearly equals this placement
  // diameter, producing an interlocking honeycomb without inflating the old
  // instance count.
  return preset.tileSpacing / Math.sqrt(HEX_AREA_RATIO);
}

function hexToRgb(hex: number): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255
  };
}

function lerpColor(
  from: { readonly r: number; readonly g: number; readonly b: number },
  to: { readonly r: number; readonly g: number; readonly b: number },
  alpha: number
): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: from.r + (to.r - from.r) * alpha,
    g: from.g + (to.g - from.g) * alpha,
    b: from.b + (to.b - from.b) * alpha
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function pseudoRandom(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
