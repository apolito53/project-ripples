export const FIELD_PALETTE_IDS = ["profile", "reference", "legacy-neon"] as const;

export type FieldPaletteId = (typeof FIELD_PALETTE_IDS)[number];
export type ResolvedFieldPaletteId = Exclude<FieldPaletteId, "profile">;
export type FieldPalettePresentationProfile = "webgl-reference" | "classic" | "core";

export const DEFAULT_FIELD_PALETTE_ID: FieldPaletteId = "profile";

export function isFieldPaletteId(value: string): value is FieldPaletteId {
  return FIELD_PALETTE_IDS.includes(value as FieldPaletteId);
}

/**
 * Style Default keeps Classic/WebGL on the reference palette and preserves
 * Core's original neon treatment. Explicit choices override that pairing.
 */
export function resolveFieldPaletteId(
  selected: FieldPaletteId,
  profileDefault: ResolvedFieldPaletteId
): ResolvedFieldPaletteId {
  return selected === "profile" ? profileDefault : selected;
}

export function resolveFieldPaletteForProfile(
  selected: FieldPaletteId,
  profile: FieldPalettePresentationProfile
): ResolvedFieldPaletteId {
  return resolveFieldPaletteId(selected, profile === "core" ? "legacy-neon" : "reference");
}

export function getFieldPaletteShaderIndex(palette: ResolvedFieldPaletteId): 0 | 1 {
  return palette === "legacy-neon" ? 1 : 0;
}
