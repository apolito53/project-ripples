// Flat-top hexes have a point-to-point diameter of 2R. Adjacent columns are
// 3R/2 apart and alternate by half a row vertically; adjacent rows are sqrt(3)R
// apart. Keep these helpers renderer-free so layout construction and the
// regression check use one definition of the honeycomb.
export const FLAT_TOP_HEX_HORIZONTAL_SPACING_RATIO = 0.75;
export const FLAT_TOP_HEX_VERTICAL_SPACING_RATIO = Math.sqrt(3) * 0.5;
export const FLAT_TOP_HEX_AREA_RATIO =
  FLAT_TOP_HEX_HORIZONTAL_SPACING_RATIO * FLAT_TOP_HEX_VERTICAL_SPACING_RATIO;

export function getFlatTopHexPlacementDiameter(tileSpacing: number): number {
  return tileSpacing / Math.sqrt(FLAT_TOP_HEX_AREA_RATIO);
}

export function getFlatTopHexHorizontalSpacing(pointToPointDiameter: number): number {
  return pointToPointDiameter * FLAT_TOP_HEX_HORIZONTAL_SPACING_RATIO;
}

export function getFlatTopHexVerticalSpacing(pointToPointDiameter: number): number {
  return pointToPointDiameter * FLAT_TOP_HEX_VERTICAL_SPACING_RATIO;
}

export function getFlatTopHexColumnOffset(column: number, verticalSpacing: number): number {
  return Math.abs(column % 2) === 1 ? verticalSpacing * 0.5 : 0;
}
