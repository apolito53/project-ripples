import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  assertPortableValue,
  createPortableManifest,
  getBenchmarkPackageProfile,
  REQUIRED_PORTABLE_BUNDLE_PATHS,
  serializePortableError,
  verifyPortableManifest
} from "./benchmark-package.mjs";
import {
  buildBenchmarkAcceptance,
  buildBenchmarkSummary,
  compareBenchmarkBaseline,
  compareSemanticParity,
  createBenchmarkBaseline,
  normalizeBenchmarkMetadata,
  normalizeBenchmarkSnapshot,
  RENDERER_BENCHMARK_PROTOCOL_VERSION,
  RENDERER_BENCHMARK_SCHEMA_VERSION,
  RENDERER_BENCHMARK_WORKLOAD_VERSION
} from "./benchmark-reporting.mjs";

const BASE_SEMANTIC = Object.freeze({
  playMode: "arena",
  qualityId: "pretty",
  fieldInstances: 26853,
  particleBudget: 82000,
  activeParticles: 5000,
  activeSources: 2,
  activeEchoes: 3,
  playerSpeed: 10,
  bloomEnabled: true,
  shadowMode: "shadow-map",
  viewportWidth: 1280,
  viewportHeight: 720,
  pixelRatio: 1,
  deviceLost: false
});

function makeRawSnapshot({ gpuSequence = 1, gpuErrorCount = 0 } = {}) {
  return {
    version: 1,
    config: { enabled: true, scenario: "pretty-arena", tier: 0, seed: 1337 },
    phase: "complete",
    startedAtMs: 0,
    stoppedAtMs: 48,
    metadata: { displayRefreshIntervalMs: 16 },
    samples: [0, 1, 2, 3].map((index) => ({
      frameIndex: index + 1,
      timestampMs: index * 16,
      rafIntervalMs: index === 0 ? null : 16,
      updateCpuMs: 1,
      snapshotCpuMs: 1,
      renderCpuMs: 2,
      gpuFrameMs: gpuSequence === null ? null : 4,
      gpuFrameSequence: gpuSequence,
      gpuTimerMode: gpuSequence === null ? "unavailable" : "timestamp-query",
      gpuTimerErrorCount: gpuErrorCount,
      backendId: "webgpu",
      semantic: { ...BASE_SEMANTIC }
    }))
  };
}

const NORMALIZE_CONTEXT = Object.freeze({
  label: "synthetic WebGPU snapshot",
  runId: "synthetic",
  sequence: 0,
  capturedAt: new Date(0).toISOString(),
  caseId: "pretty-arena",
  scenario: "pretty-arena",
  tier: 0,
  seed: 1337,
  renderer: "webgpu",
  repetition: 0,
  orderInRepetition: 0,
  warmupMs: 5000,
  sampleMs: 48,
  elapsedMs: 20000,
  pageUrl: "http://127.0.0.1/",
  api: { version: 1 },
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});

const deduplicated = normalizeBenchmarkSnapshot(makeRawSnapshot(), NORMALIZE_CONTEXT);
assert.equal(deduplicated.schemaVersion, RENDERER_BENCHMARK_SCHEMA_VERSION);
assert.equal(deduplicated.protocolVersion, RENDERER_BENCHMARK_PROTOCOL_VERSION);
assert.equal(deduplicated.metrics.gpuFrameMs.count, 1);
assert.equal(deduplicated.metrics.gpuFrameAvailabilityRatio, 0.25);
assert.equal(deduplicated.metrics.frameBudget.stable, true);

assert.throws(
  () => normalizeBenchmarkSnapshot(makeRawSnapshot(), {
    ...NORMALIZE_CONTEXT,
    sampleMs: 15_000
  }),
  /sampled for 48 ms/
);

const missingGpu = normalizeBenchmarkSnapshot(
  makeRawSnapshot({ gpuSequence: null }),
  NORMALIZE_CONTEXT
);
assert.equal(missingGpu.metrics.gpuTimingAvailable, false);
assert.equal(missingGpu.metrics.frameBudget.stable, false);

const timerFailure = normalizeBenchmarkSnapshot(
  makeRawSnapshot({ gpuErrorCount: 1 }),
  NORMALIZE_CONTEXT
);
assert.equal(timerFailure.metrics.gpuTimingHealthy, false);
assert.equal(timerFailure.metrics.frameBudget.stable, false);

function activity(mean, median = mean, max = mean) {
  return { count: 100, min: mean, max, mean, median, p95: mean, p99: mean, standardDeviation: 0 };
}

function paritySample(renderer, particleMean, playerSpeed = 10) {
  return {
    caseId: "pretty-arena",
    scenario: "pretty-arena",
    tier: 0,
    repetition: 0,
    sequence: renderer === "webgl" ? 0 : 1,
    semantics: {
      playMode: "arena",
      qualityId: "pretty",
      fieldInstances: 26853,
      particleBudget: 82000,
      bloomEnabled: true,
      viewportWidth: 1280,
      viewportHeight: 720,
      pixelRatio: 1,
      deviceLost: false,
      shadowEnabled: true
    },
    semanticActivity: {
      activeParticles: activity(particleMean),
      activeSources: activity(2),
      activeEchoes: activity(3),
      playerSpeed: activity(playerSpeed)
    }
  };
}

const particleMismatch = compareSemanticParity(
  paritySample("webgl", 1000),
  paritySample("webgpu", 100000)
);
assert.equal(particleMismatch.passed, false);
assert.ok(particleMismatch.differences.some((item) => item.path.includes("activeParticles")));

const movementMismatch = compareSemanticParity(
  paritySample("webgl", 5000, 10),
  paritySample("webgpu", 5000, 5)
);
assert.equal(movementMismatch.passed, false);
assert.ok(movementMismatch.differences.some((item) => item.path.includes("playerSpeed")));

const normalizedMetadata = normalizeBenchmarkMetadata({
  host: {
    platform: "win32",
    release: "test-release",
    arch: "x64",
    cpuModel: "Synthetic CPU",
    logicalCpuCount: 8,
    totalMemoryBytes: 16 * (1024 ** 3),
    freeMemoryBytesAtStart: 8 * (1024 ** 3),
    nodeVersion: "v24.0.0",
    powerPlan: "Balanced",
    gpuControllers: [{
      Name: "Synthetic GPU",
      DriverVersion: "1.2.3",
      PNPDeviceID: "PCI\\VEN_DEAD&DEV_BEEF"
    }]
  },
  browser: {
    name: "Chromium",
    version: "150.0.0.0",
    channel: "chrome",
    headless: true,
    displayRefreshIntervalMs: 16.67
  },
  runtime: {
    userAgent: "Synthetic Chrome",
    platform: "Win32",
    language: "en-US",
    hardwareConcurrency: 8,
    deviceMemoryGiB: 16,
    devicePixelRatio: 1,
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080 },
    crossOriginIsolated: false
  },
  renderers: {
    webgl: {
      webGlVendor: "Synthetic Vendor",
      webGlRenderer: "Synthetic WebGL Adapter",
      webGlVersion: "WebGL 2.0"
    },
    webgpu: {
      webGpuAdapter: {
        vendor: "Synthetic Vendor",
        architecture: "synthetic-arch",
        device: "synthetic-device",
        description: "Synthetic WebGPU Adapter"
      },
      webGpuPreferredFormat: "bgra8unorm",
      webGpuTimestampQuery: true,
      webGpuFeatures: ["timestamp-query"],
      webGpuLimits: { maxTextureDimension2D: 16384 }
    }
  },
  git: { commit: "a".repeat(40), branch: "test", dirty: false, status: [] },
  package: { name: "ripple-field-lab", version: "test", playwrightVersion: "test" }
});
assert.equal(normalizedMetadata.hardware.selectedAdapters.webgpu.description, "Synthetic WebGPU Adapter");
assert.equal(normalizedMetadata.environment.gpuDrivers[0].driverVersion, "1.2.3");
assert.ok(!JSON.stringify(normalizedMetadata).includes("PNPDeviceID"));
assert.ok(!JSON.stringify(normalizedMetadata).includes("VEN_DEAD"));

const filteredTierRun = {
  runId: "filtered",
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(1).toISOString(),
  durationMs: 1,
  expectedPairCount: 1,
  expectedSampleCount: 2,
  metadata: normalizedMetadata,
  config: {
    appUrl: "http://127.0.0.1/",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    warmupMs: 5000,
    sampleMs: 15000,
    repetitions: 1,
    profile: "standard",
    headless: true,
    browserChannel: "chrome",
    browserArgs: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"],
    seed: 1337,
    backends: ["webgl", "webgpu"],
    cases: [{ id: "meltdown-ramp-tier-4", label: "tier 4", scenario: "meltdown-ramp", tier: 4 }]
  }
};
const summarySamples = ["webgl", "webgpu"].map((renderer, index) => ({
  caseId: "meltdown-ramp-tier-4",
  renderer,
  sequence: index,
  semantics: { deviceLost: false },
  pageProblems: { consoleErrors: [], pageErrors: [], crashes: [] },
  metrics: { frameBudget: { stable: true } },
  metricValues: {
    framesPerSecond: renderer === "webgl" ? 60 : 30,
    "renderCpuMs.p95": renderer === "webgl" ? 10 : 5,
    gpuFrameAvailabilityRatio: 0.5,
    gpuTimerErrorCount: 0
  }
}));
const filteredSummary = buildBenchmarkSummary({
  run: filteredTierRun,
  samples: summarySamples,
  parityChecks: [{ passed: true }]
});
assert.deepEqual(filteredSummary.stableStressTiers, { webgl: null, webgpu: null, paired: null });
assert.equal(
  filteredSummary.scenarios["meltdown-ramp-tier-4"].comparisons.framesPerSecond.verdict,
  "webgpu-slower"
);
assert.equal(
  filteredSummary.scenarios["meltdown-ramp-tier-4"].comparisons["renderCpuMs.p95"].verdict,
  "webgpu-faster"
);

const baseline = createBenchmarkBaseline(filteredSummary, {
  eligible: true,
  acceptanceStatus: "passed"
});
baseline.stableStressTiers = { webgl: 2, webgpu: 4, paired: 2 };
const regression = compareBenchmarkBaseline(filteredSummary, baseline);
assert.equal(regression.classification, "comparable");
assert.equal(regression.status, "failed");
assert.ok(regression.findings.some((finding) => finding.metricPath === "stableStressTier"));

const protocolMismatch = compareBenchmarkBaseline(filteredSummary, {
  ...baseline,
  protocolVersion: "renderer-benchmark-v1"
});
assert.equal(protocolMismatch.classification, "incompatible");
assert.equal(protocolMismatch.findings.length, 0);
assert.ok(protocolMismatch.reasons.some((reason) => reason.includes("Protocol mismatch")));

const crossHardwareBaseline = structuredClone(baseline);
crossHardwareBaseline.metadata.hardware.cpu.model = "Other CPU";
const crossHardware = compareBenchmarkBaseline(filteredSummary, crossHardwareBaseline);
assert.equal(crossHardware.classification, "informational");
assert.equal(crossHardware.status, "informational");
assert.ok(crossHardware.findings.every((finding) => finding.severity === "info"));

const differentRefreshBaseline = structuredClone(baseline);
differentRefreshBaseline.metadata.environment.browser.displayRefreshIntervalMs = 6.94;
const differentRefresh = compareBenchmarkBaseline(filteredSummary, differentRefreshBaseline);
assert.equal(differentRefresh.classification, "informational");
assert.ok(differentRefresh.reasons.some((reason) => reason.includes("Display refresh budgets differ")));

assert.throws(
  () => compareBenchmarkBaseline(filteredSummary, { ...baseline, scenarios: {} }),
  /must contain WebGL and WebGPU metrics/
);

const fullProfile = getBenchmarkPackageProfile({});
const shortProfile = getBenchmarkPackageProfile({ RIPPLE_BENCHMARK_PACKAGE_TEST: "1" });
assert.equal(fullProfile.stockSoakMs, 120_000);
assert.equal(fullProfile.benchmarkRepetitions, 4);
assert.equal(shortProfile.testMode, true);
assert.equal(shortProfile.stockModeSampleMs, 1_500);
assert.ok(shortProfile.stockSoakMs < 5_000);
assert.equal(shortProfile.benchmarkWarmupMs, 1_000);
assert.equal(shortProfile.benchmarkSampleMs, 2_000);
assert.equal(shortProfile.benchmarkRepetitions, 1);

function acceptanceBackend(stable = true, coverage = 0.5, timerErrors = 0) {
  return {
    allSamplesStable: stable,
    metrics: {
      gpuFrameAvailabilityRatio: { min: coverage },
      gpuTimerErrorCount: { max: timerErrors }
    }
  };
}

const ACCEPTANCE_CASES = [
  { id: "pretty-arena", label: "Pretty Arena", scenario: "pretty-arena", tier: 0 },
  { id: "showoff-track-motion", label: "Showoff Track", scenario: "showoff-track-motion", tier: 0 },
  ...Array.from({ length: 5 }, (_, tier) => ({
    id: `meltdown-ramp-tier-${tier}`,
    label: `Meltdown tier ${tier}`,
    scenario: "meltdown-ramp",
    tier
  }))
];

const acceptanceSummary = {
  ...filteredSummary,
  runId: "acceptance",
  status: "passed",
  sampleCount: 56,
  expectedSampleCount: 56,
  failure: null,
  config: {
    ...filteredSummary.config,
    profile: "cross-hardware-acceptance",
    repetitions: 4,
    cases: ACCEPTANCE_CASES
  },
  semanticParity: { passed: true, passedChecks: 28, expectedChecks: 28, checks: [] },
  runtimeHealth: { passed: true, problemCount: 0, deviceLostSampleCount: 0 },
  scenarios: Object.fromEntries(ACCEPTANCE_CASES.map((item) => [item.id, {
    backends: { webgl: acceptanceBackend(), webgpu: acceptanceBackend() }
  }])),
  regression: null
};
const stockAcceptance = {
  modes: ["arena", "track", "training"].map((mode) => ({
    mode,
    passed: true,
    selectedAdapter: {
      vendor: "Synthetic Vendor",
      architecture: "synthetic-arch",
      device: "synthetic-device",
      description: "Synthetic WebGPU Adapter"
    }
  })),
  soak: {
    passed: true,
    requestedDurationMs: 120_000,
    observedDurationMs: 120_050,
    selectedAdapter: {
      vendor: "Synthetic Vendor",
      architecture: "synthetic-arch",
      device: "synthetic-device",
      description: "Synthetic WebGPU Adapter"
    }
  },
  visualChecks: Array.from({ length: 5 }, (_, index) => ({ id: `visual-${index}`, passed: true })),
  health: { passed: true, problemCount: 0, deviceLost: false, fallbackObserved: false }
};
const acceptance = buildBenchmarkAcceptance({
  summary: acceptanceSummary,
  stock: stockAcceptance,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(acceptance.status, "passed");
assert.equal(acceptance.decisionGrade, true);

const shortStockAcceptance = structuredClone(stockAcceptance);
shortStockAcceptance.soak.requestedDurationMs = 1_500;
shortStockAcceptance.soak.observedDurationMs = 1_500;
const shortAcceptance = buildBenchmarkAcceptance({
  summary: { ...acceptanceSummary, config: { ...acceptanceSummary.config, profile: "deterministic-short-test" } },
  stock: shortStockAcceptance,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "deterministic-short-test",
  requiredSoakMs: 1_500
});
assert.equal(shortAcceptance.status, "test-only-passed");
assert.equal(shortAcceptance.decisionGrade, false);

const shortObservedSoak = structuredClone(stockAcceptance);
shortObservedSoak.soak.observedDurationMs = 1;
const shortObservedAcceptance = buildBenchmarkAcceptance({
  summary: acceptanceSummary,
  stock: shortObservedSoak,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(shortObservedAcceptance.status, "failed");
assert.equal(shortObservedAcceptance.gates.stockSoak.passed, false);

const mixedAdapterStock = structuredClone(stockAcceptance);
mixedAdapterStock.modes[1].selectedAdapter.description = "Other Adapter";
const mixedAdapterAcceptance = buildBenchmarkAcceptance({
  summary: acceptanceSummary,
  stock: mixedAdapterStock,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(mixedAdapterAcceptance.status, "failed");
assert.equal(mixedAdapterAcceptance.gates.adapterConsistency.passed, false);

const lowCoverageSummary = structuredClone(acceptanceSummary);
lowCoverageSummary.scenarios["pretty-arena"].backends.webgpu.metrics.gpuFrameAvailabilityRatio.min = 0.24;
const lowCoverageAcceptance = buildBenchmarkAcceptance({
  summary: lowCoverageSummary,
  stock: stockAcceptance,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(lowCoverageAcceptance.status, "failed");
assert.equal(lowCoverageAcceptance.gates.timerCoverage.passed, false);

const cleanupFailureAcceptance = buildBenchmarkAcceptance({
  summary: acceptanceSummary,
  stock: stockAcceptance,
  cleanTree: { passed: true, detail: "clean" },
  packageLifecycle: { passed: false, detail: "cleanup failed" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(cleanupFailureAcceptance.status, "failed");
assert.equal(cleanupFailureAcceptance.gates.packageLifecycle.passed, false);

const warningSummary = structuredClone(acceptanceSummary);
warningSummary.regression = { classification: "comparable", status: "warning", reasons: [], findings: [] };
const warningAcceptance = buildBenchmarkAcceptance({
  summary: warningSummary,
  stock: stockAcceptance,
  cleanTree: { passed: true, detail: "clean" },
  packageProfile: "cross-hardware-acceptance",
  requiredSoakMs: 120_000
});
assert.equal(warningAcceptance.status, "failed");
assert.equal(warningAcceptance.gates.baselineRegression.passed, false);

assert.throws(
  () => assertPortableValue({ path: "C:\\private\\summary.json" }),
  /absolute local filesystem path/
);
assert.throws(
  () => assertPortableValue({ path: "/home/private/summary.json" }),
  /absolute local filesystem path/
);
assert.throws(
  () => assertPortableValue({ path: "/opt/private/summary.json" }),
  /absolute local filesystem path/
);
assert.throws(
  () => assertPortableValue({ path: "/data/builds/summary.json" }),
  /absolute local filesystem path/
);
assert.throws(
  () => assertPortableValue({ path: "\\\\server\\share\\summary.json" }),
  /absolute local filesystem path/
);
assert.throws(
  () => assertPortableValue({ PNPDeviceID: "PCI\\VEN_DEAD" }),
  /raw PNP identifier field/
);
const portableError = serializePortableError(
  new Error("Failed at C:\\Users\\private\\runner.mjs and \\\\server\\share\\capture.png")
);
assert.equal(portableError.stack, null);
assert.doesNotMatch(portableError.message, /C:\\|\\\\server/);

const temporaryBundle = await mkdtemp(path.join(os.tmpdir(), "ripple-benchmark-verifier-"));
try {
  const portableRunId = "synthetic-portable";
  const portableSummary = {
    ...filteredSummary,
    runId: portableRunId,
    config: {
      ...filteredSummary.config,
      repetitions: 1,
      warmupMs: deduplicated.requested.warmupMs,
      sampleMs: deduplicated.requested.sampleMs,
      cases: filteredSummary.config.cases
    },
    sampleCount: 2,
    expectedSampleCount: 2,
    status: "passed",
    acceptance: {
      status: acceptance.status,
      decisionGrade: acceptance.decisionGrade,
      packageProfile: acceptance.packageProfile,
      gates: acceptance.gates,
      failedGateIds: acceptance.failedGateIds
    }
  };
  const portableAcceptance = {
    ...acceptance,
    runId: portableRunId
  };
  const portableBaseline = createBenchmarkBaseline(portableSummary, {
    eligible: true,
    acceptanceStatus: "passed"
  });
  const portableWebGpuSample = {
    ...deduplicated,
    runId: portableRunId,
    sequence: 1,
    caseId: "meltdown-ramp-tier-4",
    scenario: "meltdown-ramp",
    tier: 4,
    renderer: "webgpu",
    orderInRepetition: 1
  };
  const portableWebGlSample = {
    ...portableWebGpuSample,
    sequence: 0,
    renderer: "webgl",
    orderInRepetition: 0
  };
  const portableSamples = [portableWebGlSample, portableWebGpuSample];
  await writeFile(path.join(temporaryBundle, "acceptance.json"), `${JSON.stringify(portableAcceptance)}\n`);
  await writeFile(path.join(temporaryBundle, "baseline.json"), `${JSON.stringify(portableBaseline)}\n`);
  await writeFile(path.join(temporaryBundle, "summary.json"), `${JSON.stringify(portableSummary)}\n`);
  await writeFile(path.join(temporaryBundle, "summary.md"), "# Synthetic portable summary\n");
  await writeFile(
    path.join(temporaryBundle, "samples.ndjson.gz"),
    gzipSync(Buffer.from(`${portableSamples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8"))
  );
  let manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  assert.ok(manifest.files.every((entry) => !path.isAbsolute(entry.path)));
  assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  await verifyPortableManifest(temporaryBundle, manifest);

  await writeFile(
    path.join(temporaryBundle, "baseline.json"),
    `${JSON.stringify({ ...portableBaseline, eligible: false })}\n`
  );
  manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  await assert.rejects(
    () => verifyPortableManifest(temporaryBundle, manifest),
    /eligibility or acceptance status does not match/
  );
  await writeFile(path.join(temporaryBundle, "baseline.json"), `${JSON.stringify(portableBaseline)}\n`);

  await writeFile(
    path.join(temporaryBundle, "samples.ndjson.gz"),
    gzipSync(Buffer.from(`${[
      { ...portableWebGlSample, metricValues: {} },
      portableWebGpuSample
    ].map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8"))
  );
  manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  await assert.rejects(
    () => verifyPortableManifest(temporaryBundle, manifest),
    /metricValues must contain finite numeric metrics/
  );

  await writeFile(
    path.join(temporaryBundle, "samples.ndjson.gz"),
    gzipSync(Buffer.from(`${[
      portableWebGlSample,
      { ...portableWebGpuSample, renderer: "webgl" }
    ].map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8"))
  );
  manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  await assert.rejects(
    () => verifyPortableManifest(temporaryBundle, manifest),
    /duplicate matrix tuple/
  );

  await writeFile(
    path.join(temporaryBundle, "samples.ndjson.gz"),
    gzipSync(Buffer.from(`${[
      { ...portableWebGlSample, protocolVersion: "wrong" },
      portableWebGpuSample
    ].map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8"))
  );
  manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  await assert.rejects(
    () => verifyPortableManifest(temporaryBundle, manifest),
    /protocolVersion does not match/
  );

  await writeFile(
    path.join(temporaryBundle, "samples.ndjson.gz"),
    gzipSync(Buffer.from(`${portableSamples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8"))
  );
  manifest = await createPortableManifest(temporaryBundle, {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: portableRunId,
    generatedAt: new Date(0).toISOString(),
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });

  await writeFile(path.join(temporaryBundle, "summary.md"), "tampered\n");
  await assert.rejects(
    () => verifyPortableManifest(temporaryBundle, manifest),
    /SHA-256 mismatch/
  );
} finally {
  await rm(temporaryBundle, { recursive: true, force: true });
}

console.log(
  "Benchmark reporting verifier passed protocol, metadata, timer, parity, acceptance, baseline, and portable-bundle cases."
);
