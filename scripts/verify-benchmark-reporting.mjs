import assert from "node:assert/strict";
import {
  buildBenchmarkSummary,
  compareBenchmarkBaseline,
  compareSemanticParity,
  normalizeBenchmarkSnapshot
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
  sampleMs: 15000,
  elapsedMs: 20000,
  pageUrl: "http://127.0.0.1/",
  api: { version: 1 },
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});

const deduplicated = normalizeBenchmarkSnapshot(makeRawSnapshot(), NORMALIZE_CONTEXT);
assert.equal(deduplicated.metrics.gpuFrameMs.count, 1);
assert.equal(deduplicated.metrics.gpuFrameAvailabilityRatio, 0.25);
assert.equal(deduplicated.metrics.frameBudget.stable, true);

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

const filteredTierRun = {
  runId: "filtered",
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(1).toISOString(),
  durationMs: 1,
  expectedPairCount: 1,
  expectedSampleCount: 2,
  metadata: {},
  config: {
    appUrl: "http://127.0.0.1/",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    warmupMs: 1,
    sampleMs: 1,
    repetitions: 1,
    cases: [{ id: "meltdown-ramp-tier-4", label: "tier 4", scenario: "meltdown-ramp", tier: 4 }]
  }
};
const summarySamples = ["webgl", "webgpu"].map((renderer, index) => ({
  caseId: "meltdown-ramp-tier-4",
  renderer,
  sequence: index,
  metrics: { frameBudget: { stable: true } },
  metricValues: {
    framesPerSecond: renderer === "webgl" ? 60 : 30,
    "renderCpuMs.p95": renderer === "webgl" ? 10 : 5
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

const regression = compareBenchmarkBaseline(filteredSummary, {
  metadata: {},
  config: filteredSummary.config,
  scenarios: filteredSummary.scenarios,
  stableStressTiers: { webgl: 2, webgpu: 4, paired: 2 }
});
assert.equal(regression.status, "failed");
assert.ok(regression.findings.some((finding) => finding.metricPath === "stableStressTier"));

console.log("Benchmark reporting verifier passed timer, parity, tier, baseline, and verdict cases.");
