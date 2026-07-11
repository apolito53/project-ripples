import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceUrl = new URL("../src/render/rendererRollout.ts", import.meta.url);
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
const rollout = await import(moduleUrl);
const rendererModeSourcePath = fileURLToPath(new URL("../src/render/rendererMode.ts", import.meta.url));
const rendererModeSource = readFileSync(rendererModeSourcePath, "utf8");
const rendererModeTranspiled = ts.transpileModule(rendererModeSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    isolatedModules: true
  },
  fileName: rendererModeSourcePath,
  reportDiagnostics: true
});
const rendererMode = await import(
  `data:text/javascript;base64,${Buffer.from(rendererModeTranspiled.outputText).toString("base64")}`
);

const BUILD_ID = "renderer-build-2026-07-10";
const NOW_MS = 1_752_000_000_000;
const INSTALL_ID = rollout.createRendererInstallId(
  Uint8Array.from({ length: 16 }, (_, index) => index)
);
const OTHER_INSTALL_ID = rollout.createRendererInstallId(
  Uint8Array.from({ length: 16 }, (_, index) => 255 - index)
);

const BASE_ENVIRONMENT = Object.freeze({
  secureContext: true,
  navigatorGpuAvailable: true,
  storageWritable: true,
  browser: Object.freeze({
    family: "chromium",
    brand: "chrome",
    majorVersion: rollout.MIN_SUPPORTED_CHROMIUM_MAJOR_VERSION
  }),
  maxTextureDimension2D: rollout.MIN_RENDERER_TEXTURE_DIMENSION_2D
});

const tests = [];

function test(name, verify) {
  tests.push({ name, verify });
}

function makeAutoInput(overrides = {}) {
  return {
    requestedMode: "auto",
    auto: {
      nowMs: overrides.nowMs ?? NOW_MS,
      config: {
        buildId: BUILD_ID,
        rolloutPercent: 100,
        ...(overrides.config ?? {})
      },
      environment: {
        ...BASE_ENVIRONMENT,
        ...(overrides.environment ?? {})
      },
      installId: Object.hasOwn(overrides, "installId") ? overrides.installId : INSTALL_ID,
      healthState: overrides.healthState ?? rollout.createEmptyRendererRolloutHealthState()
    }
  };
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
    removeItem(key) {
      values.delete(key);
    }
  };
}

function findInstallIdForBucket(predicate) {
  for (let candidate = 0; candidate <= 0xffff; candidate += 1) {
    const bytes = new Uint8Array(16);
    bytes[14] = candidate >>> 8;
    bytes[15] = candidate & 0xff;
    const installId = rollout.createRendererInstallId(bytes);
    const bucket = rollout.getRendererRolloutBucket(installId);
    if (predicate(bucket)) return { installId, bucket };
  }

  throw new Error("Could not find a deterministic install ID for the requested bucket predicate.");
}

test("explicit renderer modes are immune to auto-rollout state", () => {
  for (const requestedMode of ["webgl", "webgpu"]) {
    const input = { requestedMode };
    Object.defineProperty(input, "auto", {
      get() {
        throw new Error("Explicit policy must not inspect auto-rollout inputs.");
      }
    });

    const decision = rollout.evaluateRendererRollout(input);
    assert.equal(decision.selectedMode, requestedMode);
    assert.equal(decision.policyKind, "explicit");
    assert.equal(decision.autoEligible, null);
    assert.equal(decision.checks, null);
    assert.deepEqual(decision.blockingReasons, []);
  }
});

test("fully eligible auto mode returns structured WebGPU selection fields", () => {
  const decision = rollout.evaluateRendererRollout(makeAutoInput());
  assert.equal(decision.selectedMode, "webgpu");
  assert.equal(decision.decisionCode, "auto-webgpu-eligible");
  assert.equal(decision.autoEligible, true);
  assert.equal(decision.rolloutThreshold, rollout.RENDERER_ROLLOUT_BUCKET_COUNT);
  assert.equal(decision.failureCount, 0);
  assert.equal(decision.cooldownRemainingMs, 0);
  assert.equal(decision.currentBuildFailed, false);
  assert.deepEqual(decision.blockingReasons, []);
  assert.ok(decision.checks);
  assert.ok(Object.values(decision.checks).every(Boolean));
});

test("build rollout percentage defaults to dormant zero", () => {
  const input = makeAutoInput();
  input.auto.config = { buildId: BUILD_ID };

  const decision = rollout.evaluateRendererRollout(input);
  assert.equal(decision.selectedMode, "webgl");
  assert.equal(decision.rolloutPercent, 0);
  assert.equal(decision.rolloutThreshold, 0);
  assert.equal(decision.decisionCode, "auto-webgl-disabled");
  assert.deepEqual(decision.blockingReasons, ["rollout-percent-zero"]);
});

test("renderer mode resolution survives a denied localStorage getter", () => {
  const previousWindow = globalThis.window;
  const deniedWindow = {};
  Object.defineProperty(deniedWindow, "localStorage", {
    configurable: true,
    get() { throw new DOMException("denied", "SecurityError"); }
  });
  globalThis.window = deniedWindow;

  try {
    const explicit = rendererMode.resolveRendererMode({ search: "?renderer=webgl" });
    assert.equal(explicit.requestedMode, "webgl");
    assert.equal(explicit.source, "query");

    const automatic = rendererMode.resolveRendererMode({ search: "" });
    assert.equal(automatic.requestedMode, "auto");
    assert.equal(automatic.source, "default");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("each auto gate reports its own blocker without reason precedence", () => {
  const outsideCohort = findInstallIdForBucket((bucket) => bucket >= 5_000);
  const cases = [
    {
      name: "rollout disabled",
      input: makeAutoInput({ config: { rolloutPercent: 0 } }),
      reason: "rollout-percent-zero"
    },
    {
      name: "insecure context",
      input: makeAutoInput({ environment: { secureContext: false } }),
      reason: "insecure-context"
    },
    {
      name: "navigator.gpu missing",
      input: makeAutoInput({ environment: { navigatorGpuAvailable: false } }),
      reason: "navigator-gpu-unavailable"
    },
    {
      name: "storage unwritable",
      input: makeAutoInput({ environment: { storageWritable: false } }),
      reason: "storage-unwritable"
    },
    {
      name: "install ID missing",
      input: makeAutoInput({ installId: null }),
      reason: "install-id-unavailable"
    },
    {
      name: "browser family unsupported",
      input: makeAutoInput({
        environment: { browser: { family: "other", brand: "other", majorVersion: 130 } }
      }),
      reason: "unsupported-browser-family"
    },
    {
      name: "browser version unsupported",
      input: makeAutoInput({
        environment: {
          browser: {
            family: "chromium",
            brand: "chrome",
            majorVersion: rollout.MIN_SUPPORTED_CHROMIUM_MAJOR_VERSION - 1
          }
        }
      }),
      reason: "unsupported-browser-version"
    },
    {
      name: "adapter limits missing",
      input: makeAutoInput({ environment: { maxTextureDimension2D: null } }),
      reason: "adapter-limits-unavailable"
    },
    {
      name: "texture limit too low",
      input: makeAutoInput({
        environment: {
          maxTextureDimension2D: rollout.MIN_RENDERER_TEXTURE_DIMENSION_2D - 1
        }
      }),
      reason: "max-texture-dimension-too-low"
    },
    {
      name: "cooldown active",
      input: makeAutoInput({
        healthState: {
          ...rollout.createEmptyRendererRolloutHealthState(),
          failureCount: 1,
          cooldownUntilMs: NOW_MS + 1,
          failedBuildId: "older-build"
        }
      }),
      reason: "cooldown-active"
    },
    {
      name: "current build failed",
      input: makeAutoInput({
        healthState: {
          ...rollout.createEmptyRendererRolloutHealthState(),
          failureCount: 1,
          failedBuildId: BUILD_ID
        }
      }),
      reason: "current-build-failed"
    },
    {
      name: "outside cohort",
      input: makeAutoInput({
        config: { rolloutPercent: 50 },
        installId: outsideCohort.installId
      }),
      reason: "outside-rollout-cohort"
    }
  ];

  for (const policyCase of cases) {
    const decision = rollout.evaluateRendererRollout(policyCase.input);
    assert.equal(decision.selectedMode, "webgl", policyCase.name);
    assert.deepEqual(decision.blockingReasons, [policyCase.reason], policyCase.name);
  }

  const combinedDecision = rollout.evaluateRendererRollout(makeAutoInput({
    environment: {
      secureContext: false,
      navigatorGpuAvailable: false,
      storageWritable: false,
      browser: { family: "other", brand: "other", majorVersion: null },
      maxTextureDimension2D: 1
    },
    installId: null
  }));
  assert.deepEqual(combinedDecision.blockingReasons, [
    "insecure-context",
    "navigator-gpu-unavailable",
    "storage-unwritable",
    "install-id-unavailable",
    "unsupported-browser-family",
    "max-texture-dimension-too-low"
  ]);
});

test("cohort buckets are deterministic with exact percentage boundaries", () => {
  assert.equal(rollout.getRendererRolloutThreshold(-1), 0);
  assert.equal(rollout.getRendererRolloutThreshold(0), 0);
  assert.equal(rollout.getRendererRolloutThreshold(0.01), 1);
  assert.equal(rollout.getRendererRolloutThreshold(50), 5_000);
  assert.equal(rollout.getRendererRolloutThreshold(100), 10_000);
  assert.equal(rollout.getRendererRolloutThreshold(101), 10_000);

  assert.equal(rollout.isRendererRolloutBucketEligible(0, 0), false);
  assert.equal(rollout.isRendererRolloutBucketEligible(0, 0.01), true);
  assert.equal(rollout.isRendererRolloutBucketEligible(4_999, 50), true);
  assert.equal(rollout.isRendererRolloutBucketEligible(5_000, 50), false);
  assert.equal(rollout.isRendererRolloutBucketEligible(9_999, 100), true);
  assert.equal(rollout.isRendererRolloutBucketEligible(10_000, 100), false);

  const firstBucket = rollout.getRendererRolloutBucket(INSTALL_ID);
  assert.equal(rollout.getRendererRolloutBucket(INSTALL_ID), firstBucket);
  assert.ok(firstBucket >= 0 && firstBucket < rollout.RENDERER_ROLLOUT_BUCKET_COUNT);
});

test("stable install IDs persist and storage denial is ineligible", () => {
  const storage = createMemoryStorage();
  const first = rollout.ensureStableRendererInstallId(storage, () => INSTALL_ID);
  const second = rollout.ensureStableRendererInstallId(storage, () => OTHER_INSTALL_ID);
  assert.deepEqual(first, {
    storageWritable: true,
    installId: INSTALL_ID,
    created: true,
    reason: "ready"
  });
  assert.deepEqual(second, {
    storageWritable: true,
    installId: INSTALL_ID,
    created: false,
    reason: "ready"
  });
  assert.equal(
    rollout.getRendererRolloutBucket(first.installId),
    rollout.getRendererRolloutBucket(second.installId)
  );

  assert.equal(
    rollout.ensureStableRendererInstallId(null, () => INSTALL_ID).reason,
    "storage-unavailable"
  );

  const readDenied = {
    getItem() { throw new Error("denied"); },
    setItem() {},
    removeItem() {}
  };
  assert.equal(
    rollout.ensureStableRendererInstallId(readDenied, () => INSTALL_ID).reason,
    "storage-read-denied"
  );

  const writeDenied = {
    getItem() { return null; },
    setItem() { throw new Error("denied"); },
    removeItem() {}
  };
  const deniedResolution = rollout.ensureStableRendererInstallId(writeDenied, () => INSTALL_ID);
  assert.equal(deniedResolution.reason, "storage-write-denied");
  assert.equal(deniedResolution.storageWritable, false);
  assert.equal(deniedResolution.installId, null);
});

test("Chromium detection and texture limits reject unsupported environments", () => {
  const chrome = rollout.identifyRendererBrowser(
    "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36"
  );
  const edge = rollout.identifyRendererBrowser(
    "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
  );
  const firefox = rollout.identifyRendererBrowser(
    "Mozilla/5.0 Gecko/20100101 Firefox/128.0"
  );
  const brandIdentity = rollout.identifyRendererBrowser("", [
    { brand: "Not A(Brand", version: "99" },
    { brand: "Google Chrome", version: "131.0.0.0" },
    { brand: "Chromium", version: "131.0.0.0" }
  ]);

  assert.deepEqual(chrome, { family: "chromium", brand: "chrome", majorVersion: 130 });
  assert.deepEqual(edge, { family: "chromium", brand: "edge", majorVersion: 130 });
  assert.deepEqual(firefox, { family: "other", brand: "other", majorVersion: null });
  assert.deepEqual(brandIdentity, {
    family: "chromium",
    brand: "chrome",
    majorVersion: 131
  });

  const lowLimitDecision = rollout.evaluateRendererRollout(makeAutoInput({
    environment: { maxTextureDimension2D: 4_095 }
  }));
  assert.equal(lowLimitDecision.checks.adapterLimitsAvailable, true);
  assert.equal(lowLimitDecision.checks.textureLimitSupported, false);
  assert.deepEqual(lowLimitDecision.blockingReasons, ["max-texture-dimension-too-low"]);
});

test("failure cooldowns escalate, cap, and recover through healthy sessions", () => {
  let state = rollout.createEmptyRendererRolloutHealthState();

  state = rollout.recordRendererRolloutFailure(state, "build-1", NOW_MS);
  assert.equal(state.failureCount, 1);
  assert.equal(
    state.cooldownUntilMs,
    NOW_MS + rollout.FIRST_RENDERER_FAILURE_COOLDOWN_MS
  );

  const secondFailureAtMs = NOW_MS + 1_000;
  state = rollout.recordRendererRolloutFailure(state, "build-2", secondFailureAtMs);
  assert.equal(state.failureCount, 2);
  assert.equal(
    state.cooldownUntilMs,
    secondFailureAtMs + rollout.SECOND_RENDERER_FAILURE_COOLDOWN_MS
  );

  const thirdFailureAtMs = NOW_MS + 2_000;
  state = rollout.recordRendererRolloutFailure(state, "build-3", thirdFailureAtMs);
  assert.equal(state.failureCount, 3);
  assert.equal(
    state.cooldownUntilMs,
    thirdFailureAtMs + rollout.MAX_RENDERER_FAILURE_COOLDOWN_MS
  );

  const fourthFailureAtMs = NOW_MS + 3_000;
  state = rollout.recordRendererRolloutFailure(state, "build-4", fourthFailureAtMs);
  assert.equal(state.failureCount, 4);
  assert.equal(
    state.cooldownUntilMs,
    fourthFailureAtMs + rollout.MAX_RENDERER_FAILURE_COOLDOWN_MS
  );
  assert.equal(
    rollout.getRendererFailureCooldownMs(100),
    rollout.MAX_RENDERER_FAILURE_COOLDOWN_MS
  );

  const blocked = rollout.evaluateRendererRollout(makeAutoInput({
    nowMs: fourthFailureAtMs,
    config: { buildId: "build-4" },
    healthState: state
  }));
  assert.deepEqual(blocked.blockingReasons, ["cooldown-active", "current-build-failed"]);

  const shortSession = rollout.recordSuccessfulRendererSession(
    state,
    "build-4",
    rollout.SUCCESSFUL_RENDERER_SESSION_MS - 1,
    fourthFailureAtMs + rollout.SUCCESSFUL_RENDERER_SESSION_MS
  );
  assert.deepEqual(shortSession, state);

  const recovered = rollout.recordSuccessfulRendererSession(
    state,
    "build-4",
    rollout.SUCCESSFUL_RENDERER_SESSION_MS,
    fourthFailureAtMs + rollout.SUCCESSFUL_RENDERER_SESSION_MS
  );
  assert.equal(recovered.failureCount, 3);
  assert.equal(recovered.failedBuildId, "build-4");
  assert.equal(recovered.cooldownUntilMs, state.cooldownUntilMs);

  const failedBuildAfterCooldown = rollout.evaluateRendererRollout(makeAutoInput({
    nowMs: recovered.cooldownUntilMs,
    config: { buildId: "build-4" },
    healthState: recovered
  }));
  assert.deepEqual(failedBuildAfterCooldown.blockingReasons, ["current-build-failed"]);

  const nextBuildAfterCooldown = rollout.evaluateRendererRollout(makeAutoInput({
    nowMs: recovered.cooldownUntilMs,
    config: { buildId: "build-5" },
    healthState: recovered
  }));
  assert.equal(nextBuildAfterCooldown.selectedMode, "webgpu");
  assert.deepEqual(nextBuildAfterCooldown.blockingReasons, []);

  const outsideEscalationWindow = rollout.recordRendererRolloutFailure(
    recovered,
    "build-6",
    recovered.lastFailureAtMs + rollout.RENDERER_FAILURE_ESCALATION_WINDOW_MS + 1
  );
  assert.equal(outsideEscalationWindow.failureCount, 1);
  assert.equal(
    outsideEscalationWindow.cooldownUntilMs,
    outsideEscalationWindow.lastFailureAtMs + rollout.FIRST_RENDERER_FAILURE_COOLDOWN_MS
  );

  const storage = createMemoryStorage();
  assert.equal(rollout.writeRendererRolloutHealthState(storage, recovered), true);
  assert.deepEqual(rollout.readRendererRolloutHealthState(storage), recovered);
});

test("reload guard permits one reload per build and supports safe clearing", () => {
  const firstClaim = rollout.claimRendererReloadOnce(null, "build-a", NOW_MS);
  assert.equal(firstClaim.shouldReload, true);
  assert.equal(firstClaim.reason, "first-reload-for-build");

  const repeatedClaim = rollout.claimRendererReloadOnce(
    firstClaim.nextState,
    "build-a",
    NOW_MS + 1
  );
  assert.equal(repeatedClaim.shouldReload, false);
  assert.equal(repeatedClaim.reason, "already-reloaded-for-build");
  assert.deepEqual(repeatedClaim.nextState, firstClaim.nextState);

  const nextBuildClaim = rollout.claimRendererReloadOnce(
    repeatedClaim.nextState,
    "build-b",
    NOW_MS + 2
  );
  assert.equal(nextBuildClaim.shouldReload, true);
  assert.equal(nextBuildClaim.nextState.buildId, "build-b");
  assert.deepEqual(
    rollout.clearRendererReloadGuard(nextBuildClaim.nextState, "build-a"),
    nextBuildClaim.nextState
  );
  assert.equal(rollout.clearRendererReloadGuard(nextBuildClaim.nextState, "build-b"), null);

  const storage = createMemoryStorage();
  assert.equal(rollout.writeRendererReloadGuardState(storage, nextBuildClaim.nextState), true);
  assert.deepEqual(
    rollout.readRendererReloadGuardState(storage),
    nextBuildClaim.nextState
  );
  assert.equal(rollout.writeRendererReloadGuardState(storage, null), true);
  assert.equal(rollout.readRendererReloadGuardState(storage), null);
});

test("policy source performs no GPU adapter or device requests", () => {
  assert.doesNotMatch(source, /\brequestAdapter\s*\(/);
  assert.doesNotMatch(source, /\brequestDevice\s*\(/);
});

let passed = 0;
for (const { name, verify } of tests) {
  try {
    await verify();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`Renderer rollout verifier passed ${passed}/${tests.length} cases.`);
