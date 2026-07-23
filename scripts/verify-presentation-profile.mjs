import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const profilePolicy = await importTypeScriptModule("../src/render/presentationProfile.ts");
const fieldPalettePolicy = await importTypeScriptModule("../src/fieldPalette.ts");
const tests = [];
// Reviewed after the v0.6 Core idle-presence parity capture. Update this only
// after a deliberate Core art-direction change receives fresh visual evidence.
const PRESERVED_CORE_SHADER_SHA256 = "19288760217a51410ae8e60e960318b7a2852f82653056d6c98d6a299abfc69a";

async function importTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const sourcePath = fileURLToPath(sourceUrl);
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      isolatedModules: true
    },
    fileName: sourcePath,
    reportDiagnostics: true
  });
  const syntaxErrors = (transpiled.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxErrors.length > 0) {
    const host = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    };
    throw new Error(ts.formatDiagnostics(syntaxErrors, host));
  }

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

function test(name, verify) {
  tests.push({ name, verify });
}

function createLocation(search = "") {
  return { search };
}

function createMemoryStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    read(key) {
      return values.get(key) ?? null;
    }
  };
}

test("Classic is the default WebGPU presentation", () => {
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation(), null),
    { profile: "classic", source: "default", rejectedValue: null }
  );
});

test("explicit query profiles win over stored preference", () => {
  const storage = createMemoryStorage({
    [profilePolicy.WEBGPU_PRESENTATION_STORAGE_KEY]: "core"
  });
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation("?presentation=classic"), storage),
    { profile: "classic", source: "query", rejectedValue: null }
  );
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation("?presentation=core"), storage),
    { profile: "core", source: "query", rejectedValue: null }
  );
});

test("valid stored profiles are honored when the query is omitted", () => {
  for (const expected of ["classic", "core"]) {
    const storage = createMemoryStorage({
      [profilePolicy.WEBGPU_PRESENTATION_STORAGE_KEY]: expected
    });
    assert.deepEqual(
      profilePolicy.resolveWebGpuPresentationProfile(createLocation(), storage),
      { profile: expected, source: "localStorage", rejectedValue: null }
    );
  }
});

test("invalid query and storage values fail closed to Classic", () => {
  const storage = createMemoryStorage({
    [profilePolicy.WEBGPU_PRESENTATION_STORAGE_KEY]: "wireframe"
  });
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation("?presentation=flat"), storage),
    { profile: "classic", source: "query", rejectedValue: "flat" }
  );
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation(), storage),
    { profile: "classic", source: "localStorage", rejectedValue: "wireframe" }
  );
});

test("denied storage reads degrade to the Classic default", () => {
  const deniedStorage = {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    }
  };
  assert.deepEqual(
    profilePolicy.resolveWebGpuPresentationProfile(createLocation(), deniedStorage),
    { profile: "classic", source: "default", rejectedValue: null }
  );
  assert.equal(profilePolicy.persistWebGpuPresentationProfile("classic", deniedStorage), false);
});

test("profile persistence reports whether storage accepted the value", () => {
  const storage = createMemoryStorage();
  assert.equal(profilePolicy.persistWebGpuPresentationProfile("core", storage), true);
  assert.equal(storage.read(profilePolicy.WEBGPU_PRESENTATION_STORAGE_KEY), "core");
  assert.equal(profilePolicy.persistWebGpuPresentationProfile("classic", null), false);
});

test("the runtime guard accepts only the two supported profiles", () => {
  assert.equal(profilePolicy.isRenderPresentationProfile("classic"), true);
  assert.equal(profilePolicy.isRenderPresentationProfile("core"), true);
  assert.equal(profilePolicy.isRenderPresentationProfile("flat"), false);
  assert.equal(profilePolicy.isRenderPresentationProfile(""), false);
});

test("field palette defaults follow the active presentation profile", () => {
  assert.equal(fieldPalettePolicy.resolveFieldPaletteId("profile", "reference"), "reference");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteId("profile", "legacy-neon"), "legacy-neon");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteId("reference", "legacy-neon"), "reference");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteId("legacy-neon", "reference"), "legacy-neon");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteForProfile("profile", "webgl-reference"), "reference");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteForProfile("profile", "classic"), "reference");
  assert.equal(fieldPalettePolicy.resolveFieldPaletteForProfile("profile", "core"), "legacy-neon");
  assert.equal(fieldPalettePolicy.getFieldPaletteShaderIndex("reference"), 0);
  assert.equal(fieldPalettePolicy.getFieldPaletteShaderIndex("legacy-neon"), 1);
  assert.equal(fieldPalettePolicy.shouldPreserveCorePalette("profile", "core"), true);
  assert.equal(fieldPalettePolicy.shouldPreserveCorePalette("legacy-neon", "core"), false);
  assert.equal(fieldPalettePolicy.shouldPreserveCorePalette("profile", "classic"), false);
});

test("the reviewed Core vertex and fragment shader contract stays unchanged", () => {
  const shaderSource = readFileSync(
    fileURLToPath(new URL("../src/ripple/webGpuRippleFieldPreview.wgsl", import.meta.url)),
    "utf8"
  );
  const contract = [
    extractWgslFunction(shaderSource, "buildCoreFieldVertex"),
    extractWgslFunction(shaderSource, "fragmentCoreMain")
  ].join("\n\n");
  const digest = createHash("sha256").update(contract).digest("hex");
  assert.equal(
    digest,
    PRESERVED_CORE_SHADER_SHA256,
    "Core shader math changed. Treat that as an intentional art-direction change and update the golden only after visual review."
  );
});

test("Core keeps the WebGL pressure-rim player-presence contract", () => {
  const shaderSource = readFileSync(
    fileURLToPath(new URL("../src/ripple/webGpuRippleFieldPreview.wgsl", import.meta.url)),
    "utf8"
  );
  const presence = extractWgslFunction(shaderSource, "playerPresenceAt");
  const coreVertex = extractWgslFunction(shaderSource, "buildCoreFieldVertex");

  for (const expected of [
    "smoothstep(0.15, 2.55, playerDistance)",
    "(playerDistance - 2.35) / 0.9",
    "field.timing.x * 5.8 - playerDistance * 2.15 + instancePhase",
    "0.35 + shimmer * 0.09 + movementPush * 0.115",
    "0.16 + shimmer * 0.14 + movementPush * 0.1"
  ]) {
    assert.ok(presence.includes(expected), `Core player presence lost ${JSON.stringify(expected)}.`);
  }
  for (const expected of [
    "playerPresenceAt(cellPosition, cell.positionPhase.w)",
    "playerPresence.footprintGrowth",
    "playerPresence.lift",
    "playerPresence.glow"
  ]) {
    assert.ok(coreVertex.includes(expected), `Core field vertex no longer consumes ${JSON.stringify(expected)}.`);
  }
});

function extractWgslFunction(source, functionName) {
  const marker = `fn ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing WGSL function ${functionName}.`);
  const openingBrace = source.indexOf("{", start);
  assert.notEqual(openingBrace, -1, `Missing opening brace for WGSL function ${functionName}.`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).replaceAll("\r\n", "\n").trim();
  }

  throw new Error(`WGSL function ${functionName} was not terminated.`);
}

let passed = 0;
for (const entry of tests) {
  try {
    await entry.verify();
    passed += 1;
  } catch (error) {
    console.error(`[ripple-field-lab:presentation-profile] FAIL ${entry.name}`);
    throw error;
  }
}

console.log(`[ripple-field-lab:presentation-profile] PASS - ${passed}/${tests.length} profile-policy checks passed`);
