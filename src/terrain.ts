export function sampleFieldHeight(x: number, z: number): number {
  // The field is intentionally terrain-ish without becoming a voxel world.
  // Slow sine bands create glossy rolling ground for the cubes to cling to.
  const broad = Math.sin(x * 0.09) * 0.85 + Math.cos(z * 0.075) * 0.72;
  const cross = Math.sin((x + z) * 0.045) * 0.65;
  const detail = Math.sin(x * 0.21 + z * 0.13) * 0.22;
  return broad + cross + detail;
}
