import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const sourcePath = path.resolve("src/hexLattice.ts");
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  },
  fileName: sourcePath
}).outputText;
const lattice = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const diameter = 1;
const horizontal = lattice.getFlatTopHexHorizontalSpacing(diameter);
const vertical = lattice.getFlatTopHexVerticalSpacing(diameter);
const oddColumnOffset = lattice.getFlatTopHexColumnOffset(1, vertical);
const negativeOddColumnOffset = lattice.getFlatTopHexColumnOffset(-1, vertical);

assertClose(horizontal, 0.75, "flat-top horizontal spacing");
assertClose(vertical, Math.sqrt(3) * 0.5, "flat-top vertical spacing");
assertClose(oddColumnOffset, vertical * 0.5, "odd-column vertical offset");
assertClose(negativeOddColumnOffset, vertical * 0.5, "negative odd-column vertical offset");

// The vertical neighbor and both staggered-column neighbors must be equally
// distant. The old row-staggered basis failed this invariant and produced the
// repeating triangular holes visible in dense Meltdown fields.
const verticalNeighborDistance = vertical;
const upperDiagonalNeighborDistance = Math.hypot(horizontal, oddColumnOffset);
const lowerDiagonalNeighborDistance = Math.hypot(horizontal, oddColumnOffset - vertical);
assertClose(upperDiagonalNeighborDistance, verticalNeighborDistance, "upper diagonal neighbor distance");
assertClose(lowerDiagonalNeighborDistance, verticalNeighborDistance, "lower diagonal neighbor distance");

console.log("[ripple-field-lab:hex-lattice] flat-top interlocking invariant passed");

function assertClose(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-10,
    `${label}: expected ${expected}, received ${actual}`
  );
}
