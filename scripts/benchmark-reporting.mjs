const BACKENDS = ["webgl", "webgpu"];
const DYNAMIC_SEMANTIC_FIELDS = ["activeParticles", "activeSources", "activeEchoes", "playerSpeed"];
const MAX_MARKDOWN_METRICS = 40;

export function normalizeBenchmarkSnapshot(snapshot, context) {
  assertSnapshotShape(snapshot, context.label);
  assertSnapshotIdentity(snapshot, context);

  const samples = snapshot.samples;
  if (samples.length < 2) {
    throw new Error(`${context.label} returned only ${samples.length} sampled frame(s).`);
  }

  for (let index = 0; index < samples.length; index += 1) {
    assertFrameSample(samples[index], index, context);
  }

  const metrics = buildMetrics(snapshot);
  const metricValues = flattenMetricValues(metrics);
  const semanticSummary = summarizeSemantics(samples);
  assertExpectedSemantics(semanticSummary, context);

  return {
    schemaVersion: 1,
    runId: context.runId,
    sequence: context.sequence,
    capturedAt: context.capturedAt,
    caseId: context.caseId,
    scenario: context.scenario,
    tier: context.tier,
    seed: context.seed,
    renderer: context.renderer,
    repetition: context.repetition,
    orderInRepetition: context.orderInRepetition,
    requested: {
      warmupMs: context.warmupMs,
      sampleMs: context.sampleMs
    },
    elapsedMs: context.elapsedMs,
    pageUrl: context.pageUrl,
    api: context.api,
    metrics,
    metricValues,
    semantics: semanticSummary.stable,
    semanticActivity: semanticSummary.activity,
    semanticObserved: semanticSummary.observed,
    appMetadata: snapshot.metadata,
    apiResult: snapshot
  };
}

export function compareSemanticParity(webglSample, webgpuSample) {
  if (!webglSample || !webgpuSample) {
    throw new Error("Semantic parity requires one WebGL sample and one WebGPU sample.");
  }

  const differences = [];
  collectDifferences(
    webglSample.semantics,
    webgpuSample.semantics,
    "semantics",
    differences
  );

  for (const field of DYNAMIC_SEMANTIC_FIELDS) {
    compareActivityField(
      field,
      webglSample.semanticActivity[field],
      webgpuSample.semanticActivity[field],
      differences,
      webglSample.semantics
    );
  }

  return {
    caseId: webglSample.caseId,
    scenario: webglSample.scenario,
    tier: webglSample.tier,
    repetition: webglSample.repetition,
    passed: differences.length === 0,
    webglSequence: webglSample.sequence,
    webgpuSequence: webgpuSample.sequence,
    differences
  };
}

export function buildBenchmarkSummary({ run, samples, parityChecks, failure = null }) {
  const scenarios = {};

  for (const benchmarkCase of run.config.cases) {
    const caseSamples = samples.filter((sample) => sample.caseId === benchmarkCase.id);
    const backends = {};

    for (const backend of BACKENDS) {
      const backendSamples = caseSamples.filter((sample) => sample.renderer === backend);
      backends[backend] = summarizeBackendSamples(backendSamples);
    }

    scenarios[benchmarkCase.id] = {
      scenario: benchmarkCase.scenario,
      tier: benchmarkCase.tier,
      label: benchmarkCase.label,
      sampleCount: caseSamples.length,
      backends,
      comparisons: compareBackendMetrics(backends.webgl.metrics, backends.webgpu.metrics)
    };
  }

  const passedParityChecks = parityChecks.filter((check) => check.passed).length;
  const semanticParityPassed = parityChecks.length === run.expectedPairCount &&
    passedParityChecks === parityChecks.length;
  const stableStressTiers = getStableStressTiers(run.config.cases, scenarios);

  return {
    schemaVersion: 1,
    runId: run.runId,
    status: failure ? "failed" : semanticParityPassed ? "passed" : "failed",
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    config: run.config,
    metadata: run.metadata,
    sampleCount: samples.length,
    expectedSampleCount: run.expectedSampleCount,
    semanticParity: {
      passed: semanticParityPassed,
      passedChecks: passedParityChecks,
      expectedChecks: run.expectedPairCount,
      checks: parityChecks
    },
    stableStressTiers,
    scenarios,
    artifacts: {
      summaryJson: "summary.json",
      samplesNdjson: "samples.ndjson",
      summaryMarkdown: "summary.md"
    },
    failure
  };
}

export function compareBenchmarkBaseline(summary, baseline) {
  const sameHardware = getHardwareSignature(summary.metadata) === getHardwareSignature(baseline.metadata);
  const findings = [];
  for (const benchmarkCase of summary.config.cases) {
    for (const backend of BACKENDS) {
      for (const metricPath of ["rafIntervalMs.p95", "gpuFrameMs.p95", "totalCpuMs.p95"]) {
        const current = summary.scenarios?.[benchmarkCase.id]?.backends?.[backend]?.metrics?.[metricPath]?.mean;
        const previous = baseline.scenarios?.[benchmarkCase.id]?.backends?.[backend]?.metrics?.[metricPath]?.mean;
        if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) continue;
        const percent = ((current - previous) / previous) * 100;
        if (percent >= 10) {
          findings.push({
            severity: percent >= 20 ? "fail" : "warn",
            caseId: benchmarkCase.id,
            backend,
            metricPath,
            previous: round(previous),
            current: round(current),
            percent: round(percent)
          });
        }
      }
    }
  }

  for (const backend of BACKENDS) {
    const currentTier = summary.stableStressTiers?.[backend];
    const previousTier = baseline.stableStressTiers?.[backend];
    if (Number.isFinite(previousTier) && (!Number.isFinite(currentTier) || currentTier < previousTier)) {
      findings.push({
        severity: "fail",
        caseId: "meltdown-ramp",
        backend,
        metricPath: "stableStressTier",
        previous: previousTier,
        current: currentTier,
        percent: null
      });
    }
  }

  const effectiveFindings = sameHardware ? findings : findings.map((finding) => ({
    ...finding,
    severity: "info"
  }));
  return {
    sameHardware,
    status: effectiveFindings.some((finding) => finding.severity === "fail")
      ? "failed"
      : effectiveFindings.some((finding) => finding.severity === "warn")
        ? "warning"
        : "passed",
    findings: effectiveFindings
  };
}

export function renderSummaryMarkdown(summary) {
  const lines = [
    "# Ripple Renderer Benchmark",
    "",
    `- Status: **${summary.status.toUpperCase()}**`,
    `- Run: \`${escapeInline(summary.runId)}\``,
    `- Started: ${summary.startedAt}`,
    `- Duration: ${formatDuration(summary.durationMs)}`,
    `- App URL: \`${escapeInline(summary.config.appUrl)}\``,
    `- Viewport: ${summary.config.viewport.width}x${summary.config.viewport.height} at DPR ${summary.config.deviceScaleFactor}`,
    `- Warmup/sample: ${formatDuration(summary.config.warmupMs)} / ${formatDuration(summary.config.sampleMs)}`,
    `- Repetitions: ${summary.config.repetitions}`,
    `- Samples: ${summary.sampleCount}/${summary.expectedSampleCount}`,
    ""
  ];

  appendEnvironment(lines, summary.metadata);
  appendOrder(lines, summary.config);
  appendParity(lines, summary.semanticParity);
  appendStability(lines, summary.stableStressTiers);
  appendRegression(lines, summary.regression);

  for (const benchmarkCase of summary.config.cases) {
    appendScenario(lines, summary.scenarios[benchmarkCase.id]);
  }

  if (summary.failure) {
    lines.push(
      "## Failure",
      "",
      `**${escapeMarkdown(summary.failure.name || "Error")}:** ${escapeMarkdown(summary.failure.message)}`,
      ""
    );
  }

  lines.push(
    "## Artifacts",
    "",
    "- `summary.json`: configuration, metadata, aggregates, and parity checks",
    "- `samples.ndjson`: one normalized raw record per completed backend sample",
    "- `summary.md`: this human-readable report",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function assertSnapshotShape(snapshot, label) {
  if (!isRecord(snapshot)) {
    throw new Error(`${label} returned ${describeValue(snapshot)} instead of a benchmark snapshot.`);
  }
  if (snapshot.version !== 1) {
    throw new Error(`${label} returned API version ${JSON.stringify(snapshot.version)}; expected 1.`);
  }
  if (!isRecord(snapshot.config) || !Array.isArray(snapshot.samples)) {
    throw new Error(`${label} must contain config and samples fields.`);
  }
  if (snapshot.phase !== "complete") {
    throw new Error(`${label} stopped in phase ${JSON.stringify(snapshot.phase)} instead of complete.`);
  }
  if (!Number.isFinite(snapshot.startedAtMs) || !Number.isFinite(snapshot.stoppedAtMs)) {
    throw new Error(`${label} did not report finite sample start/stop timestamps.`);
  }
  if (snapshot.stoppedAtMs < snapshot.startedAtMs) {
    throw new Error(`${label} reported a stop timestamp before its start timestamp.`);
  }
  if (!isRecord(snapshot.metadata)) {
    throw new Error(`${label}.metadata must be an object.`);
  }
}

function assertSnapshotIdentity(snapshot, context) {
  const expected = {
    enabled: true,
    scenario: context.scenario,
    tier: context.tier,
    seed: context.seed
  };

  for (const [key, value] of Object.entries(expected)) {
    if (snapshot.config[key] !== value) {
      throw new Error(
        `${context.label} config.${key} was ${JSON.stringify(snapshot.config[key])}; ` +
        `expected ${JSON.stringify(value)}.`
      );
    }
  }
}

function assertFrameSample(sample, index, context) {
  const label = `${context.label}.samples[${index}]`;
  if (!isRecord(sample) || !isRecord(sample.semantic)) {
    throw new Error(`${label} must be a frame object with a semantic snapshot.`);
  }
  if (sample.backendId !== context.renderer) {
    throw new Error(
      `${label}.backendId was ${JSON.stringify(sample.backendId)}; expected ${context.renderer}.`
    );
  }

  for (const field of [
    "frameIndex",
    "timestampMs",
    "updateCpuMs",
    "snapshotCpuMs",
    "renderCpuMs"
  ]) {
    assertNonNegativeFinite(sample[field], `${label}.${field}`);
  }
  for (const field of ["rafIntervalMs", "gpuFrameMs"]) {
    if (sample[field] !== null) assertNonNegativeFinite(sample[field], `${label}.${field}`);
  }
  if (sample.gpuFrameSequence !== null) {
    assertNonNegativeFinite(sample.gpuFrameSequence, `${label}.gpuFrameSequence`);
  }
  assertNonNegativeFinite(sample.gpuTimerErrorCount, `${label}.gpuTimerErrorCount`);

  const semantic = sample.semantic;
  for (const field of [
    "fieldInstances",
    "particleBudget",
    "activeParticles",
    "activeSources",
    "activeEchoes",
    "playerSpeed",
    "viewportWidth",
    "viewportHeight",
    "pixelRatio"
  ]) {
    assertNonNegativeFinite(semantic[field], `${label}.semantic.${field}`);
  }
  for (const field of ["playMode", "qualityId", "shadowMode"]) {
    if (typeof semantic[field] !== "string" || semantic[field].length === 0) {
      throw new Error(`${label}.semantic.${field} must be a non-empty string.`);
    }
  }
  if (typeof sample.gpuTimerMode !== "string" || sample.gpuTimerMode.length === 0) {
    throw new Error(`${label}.gpuTimerMode must be a non-empty string.`);
  }
  for (const field of ["bloomEnabled", "deviceLost"]) {
    if (typeof semantic[field] !== "boolean") {
      throw new Error(`${label}.semantic.${field} must be boolean.`);
    }
  }
}

function assertExpectedSemantics(summary, context) {
  const expectedQuality = {
    "pretty-arena": "pretty",
    "showoff-track-motion": "showoff",
    "meltdown-ramp": "meltdown"
  }[context.scenario];
  const expectedPlayMode = context.scenario === "showoff-track-motion" ? "track" : "arena";
  const expected = {
    playMode: expectedPlayMode,
    qualityId: expectedQuality,
    viewportWidth: context.viewport.width * context.deviceScaleFactor,
    viewportHeight: context.viewport.height * context.deviceScaleFactor,
    pixelRatio: context.deviceScaleFactor,
    bloomEnabled: true,
    deviceLost: false
  };

  for (const [field, value] of Object.entries(expected)) {
    if (!Object.is(summary.stable[field], value)) {
      throw new Error(
        `${context.label} semantic ${field} was ${JSON.stringify(summary.stable[field])}; ` +
        `expected ${JSON.stringify(value)}.`
      );
    }
  }
  if (summary.stable.fieldInstances <= 0) {
    throw new Error(`${context.label} reported no field instances.`);
  }
}

function buildMetrics(snapshot) {
  const samples = snapshot.samples;
  const rafIntervals = finiteValues(samples.map((sample) => sample.rafIntervalMs));
  const updateCpu = samples.map((sample) => sample.updateCpuMs);
  const snapshotCpu = samples.map((sample) => sample.snapshotCpuMs);
  const renderCpu = samples.map((sample) => sample.renderCpuMs);
  const totalCpu = samples.map((sample) =>
    sample.updateCpuMs + sample.snapshotCpuMs + sample.renderCpuMs
  );
  const seenGpuSequences = new Set();
  const gpuFrames = [];
  for (const sample of samples) {
    if (!Number.isInteger(sample.gpuFrameSequence) || sample.gpuFrameSequence <= 0) continue;
    if (!Number.isFinite(sample.gpuFrameMs) || seenGpuSequences.has(sample.gpuFrameSequence)) continue;
    seenGpuSequences.add(sample.gpuFrameSequence);
    gpuFrames.push(sample.gpuFrameMs);
  }
  const gpuTimerErrorCount = Math.max(...samples.map((sample) => sample.gpuTimerErrorCount), 0);
  const measuredDurationMs = snapshot.stoppedAtMs - snapshot.startedAtMs;
  const raf = summarizeNumbers(rafIntervals);
  const gpu = summarizeNumbers(gpuFrames);
  const measuredRefreshIntervalMs = Number.isFinite(snapshot.metadata.displayRefreshIntervalMs)
    ? snapshot.metadata.displayRefreshIntervalMs
    : raf?.median ?? 16.67;
  const missedFrameRatio = ratioAbove(rafIntervals, measuredRefreshIntervalMs * 1.5);
  const rafP99WithinLimit = Boolean(raf && raf.p99 < measuredRefreshIntervalMs * 2);
  const gpuFrameAvailabilityRatio = round(gpuFrames.length / samples.length);
  const gpuTimingAvailable = gpu !== null && gpuFrameAvailabilityRatio >= 0.25;
  const gpuTimingHealthy = gpuTimerErrorCount === 0;
  const gpuP95WithinLimit = Boolean(
    gpuTimingAvailable && gpuTimingHealthy && gpu && gpu.p95 < measuredRefreshIntervalMs * 0.9
  );
  const stable = missedFrameRatio !== null && missedFrameRatio <= 0.01 &&
    rafP99WithinLimit && gpuP95WithinLimit;

  return {
    frameCount: samples.length,
    measuredDurationMs: round(measuredDurationMs),
    framesPerSecond: raf?.mean ? round(1000 / raf.mean) : null,
    onePercentLowFps: raf?.p99 ? round(1000 / raf.p99) : null,
    rafIntervalMs: raf,
    updateCpuMs: summarizeNumbers(updateCpu),
    snapshotCpuMs: summarizeNumbers(snapshotCpu),
    renderCpuMs: summarizeNumbers(renderCpu),
    totalCpuMs: summarizeNumbers(totalCpu),
    gpuFrameMs: gpu,
    gpuFrameAvailabilityRatio,
    gpuTimerErrorCount,
    gpuTimingAvailable,
    gpuTimingHealthy,
    gpuHeadroomRatio: gpu ? round(1 - (gpu.p95 / measuredRefreshIntervalMs)) : null,
    frameBudget: {
      over16_67MsRatio: ratioAbove(rafIntervals, 16.67),
      over33_33MsRatio: ratioAbove(rafIntervals, 33.33),
      over50MsRatio: ratioAbove(rafIntervals, 50),
      measuredRefreshIntervalMs: round(measuredRefreshIntervalMs),
      missedFrameRatio,
      rafP99WithinLimit,
      gpuP95WithinLimit,
      stable
    }
  };
}

function summarizeSemantics(samples) {
  const stable = {
    playMode: singleValue(samples, (sample) => sample.semantic.playMode, "playMode"),
    qualityId: singleValue(samples, (sample) => sample.semantic.qualityId, "qualityId"),
    fieldInstances: singleValue(
      samples,
      (sample) => sample.semantic.fieldInstances,
      "fieldInstances"
    ),
    particleBudget: singleValue(
      samples,
      (sample) => sample.semantic.particleBudget,
      "particleBudget"
    ),
    bloomEnabled: singleValue(
      samples,
      (sample) => sample.semantic.bloomEnabled,
      "bloomEnabled"
    ),
    viewportWidth: singleValue(
      samples,
      (sample) => sample.semantic.viewportWidth,
      "viewportWidth"
    ),
    viewportHeight: singleValue(
      samples,
      (sample) => sample.semantic.viewportHeight,
      "viewportHeight"
    ),
    pixelRatio: singleValue(samples, (sample) => sample.semantic.pixelRatio, "pixelRatio"),
    deviceLost: samples.some((sample) => sample.semantic.deviceLost),
    shadowEnabled: samples.every((sample) => isShadowEnabled(sample.semantic.shadowMode))
  };
  const activity = {};
  for (const field of DYNAMIC_SEMANTIC_FIELDS) {
    activity[field] = summarizeNumbers(samples.map((sample) => sample.semantic[field]));
  }

  return {
    stable,
    activity,
    observed: {
      shadowModes: [...new Set(samples.map((sample) => sample.semantic.shadowMode))].sort(),
      gpuTimerModes: [...new Set(samples.map((sample) => sample.gpuTimerMode))].sort()
    }
  };
}

function compareActivityField(field, webgl, webgpu, differences, stableSemantics) {
  if (!webgl || !webgpu) {
    differences.push({ path: `semanticActivity.${field}`, webgl, webgpu });
    return;
  }

  // Burst timing and renderer startup differ enough that live particle counts
  // are not meaningfully lockstep. Exact budget parity plus nonzero activity is
  // the invariant; source and Echo medians remain exact.
  if (field === "activeParticles") {
    const minimumPressure = Math.max(100, stableSemantics.particleBudget * 0.005);
    const allowedDifference = Math.max(250, Math.max(webgl.mean, webgpu.mean) * 0.1);
    if (webgl.mean < minimumPressure || webgpu.mean < minimumPressure ||
      Math.abs(webgl.mean - webgpu.mean) > allowedDifference) {
      differences.push({
        path: "semanticActivity.activeParticles.mean",
        webgl: webgl.mean,
        webgpu: webgpu.mean,
        minimumPressure: round(minimumPressure),
        allowedDifference: round(allowedDifference)
      });
    }
    return;
  }

  if (field === "playerSpeed") {
    const allowedDifference = Math.max(0.25, Math.max(webgl.median, webgpu.median) * 0.05);
    if (webgl.median <= 0.5 || webgpu.median <= 0.5 ||
      Math.abs(webgl.median - webgpu.median) > allowedDifference) {
      differences.push({
        path: "semanticActivity.playerSpeed.median",
        webgl: webgl.median,
        webgpu: webgpu.median,
        requirement: "both backends must sustain matching deterministic movement",
        allowedDifference: round(allowedDifference)
      });
    }
    return;
  }

  const absoluteTolerance = 0;
  const relativeTolerance = 0;
  const webglValue = webgl.median;
  const webgpuValue = webgpu.median;
  const allowedDifference = Math.max(
    absoluteTolerance,
    Math.max(Math.abs(webglValue), Math.abs(webgpuValue)) * relativeTolerance
  );
  const actualDifference = Math.abs(webglValue - webgpuValue);

  if (actualDifference > allowedDifference) {
    differences.push({
      path: `semanticActivity.${field}.median`,
      webgl: webglValue,
      webgpu: webgpuValue,
      allowedDifference: round(allowedDifference)
    });
  }
}

function singleValue(samples, selector, field) {
  const values = [...new Set(samples.map(selector))];
  if (values.length !== 1) {
    throw new Error(`Semantic field ${field} changed during one sample: ${JSON.stringify(values)}.`);
  }
  return values[0];
}

function isShadowEnabled(mode) {
  const normalized = mode.toLowerCase();
  return normalized !== "disabled" && normalized !== "none" && normalized !== "unavailable";
}

function summarizeBackendSamples(samples) {
  const metricBuckets = new Map();
  for (const sample of samples) {
    for (const [metricPath, value] of Object.entries(sample.metricValues)) {
      const values = metricBuckets.get(metricPath) ?? [];
      values.push(value);
      metricBuckets.set(metricPath, values);
    }
  }

  const metrics = {};
  for (const [metricPath, values] of [...metricBuckets.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    metrics[metricPath] = summarizeNumbers(values);
  }

  return {
    sampleCount: samples.length,
    sequences: samples.map((sample) => sample.sequence),
    stableSampleCount: samples.filter((sample) => sample.metrics.frameBudget.stable).length,
    allSamplesStable: samples.length > 0 && samples.every((sample) => sample.metrics.frameBudget.stable),
    metrics
  };
}

function getStableStressTiers(cases, scenarios) {
  const result = { webgl: null, webgpu: null, paired: null };
  for (const backend of BACKENDS) {
    const tierCases = cases
      .filter((item) => item.scenario === "meltdown-ramp")
      .sort((left, right) => left.tier - right.tier);
    let highestContiguousStableTier = null;
    let expectedTier = 0;
    for (const item of tierCases) {
      if (item.tier !== expectedTier) break;
      if (!scenarios[item.id]?.backends?.[backend]?.allSamplesStable) break;
      highestContiguousStableTier = item.tier;
      expectedTier += 1;
    }
    result[backend] = highestContiguousStableTier;
  }
  result.paired = result.webgl === null || result.webgpu === null
    ? null
    : Math.min(result.webgl, result.webgpu);
  return result;
}

function appendStability(lines, stability) {
  lines.push(
    "## Stable Stress Tier",
    "",
    `- WebGL: ${stability.webgl ?? "none"}`,
    `- WebGPU: ${stability.webgpu ?? "none"}`,
    `- Paired: ${stability.paired ?? "none"}`,
    ""
  );
}

function appendRegression(lines, regression) {
  if (!regression) return;
  lines.push(
    "## Baseline Comparison",
    "",
    `Status: **${regression.status.toUpperCase()}** (${regression.sameHardware ? "same hardware" : "cross-machine informational"})`,
    ""
  );
  if (regression.findings.length === 0) return;
  lines.push("| Severity | Case | Backend | Metric | Change |", "| --- | --- | --- | --- | ---: |");
  for (const finding of regression.findings) {
    lines.push(
      `| ${finding.severity} | ${escapeCell(finding.caseId)} | ${finding.backend} | ` +
      `${escapeCell(finding.metricPath)} | ${finding.percent === null ? `${finding.previous} -> ${finding.current}` : formatPercent(finding.percent)} |`
    );
  }
  lines.push("");
}

function getHardwareSignature(metadata) {
  return JSON.stringify({
    cpuModel: metadata?.host?.cpuModel ?? null,
    gpuControllers: metadata?.host?.gpuControllers ?? null,
    browserChannel: metadata?.browser?.channel ?? null
  });
}

function compareBackendMetrics(webglMetrics, webgpuMetrics) {
  const comparisons = {};
  const commonPaths = Object.keys(webglMetrics)
    .filter((metricPath) => metricPath in webgpuMetrics)
    .sort();

  for (const metricPath of commonPaths) {
    const webglMean = webglMetrics[metricPath].mean;
    const webgpuMean = webgpuMetrics[metricPath].mean;
    const rawPercent = webglMean === 0
      ? null
      : ((webgpuMean - webglMean) / Math.abs(webglMean)) * 100;
    const direction = getMetricDirection(metricPath);
    const performancePercent = rawPercent === null || direction === "neutral"
      ? null
      : direction === "higher" ? rawPercent : -rawPercent;
    comparisons[metricPath] = {
      webglMean,
      webgpuMean,
      webgpuToWebglRatio: webglMean === 0 ? null : round(webgpuMean / webglMean),
      webgpuVsWebglPercent: rawPercent === null ? null : round(rawPercent),
      verdict: performancePercent === null
        ? "unclassified"
        : Math.abs(performancePercent) < 10
          ? "tie"
          : performancePercent > 0 ? "webgpu-faster" : "webgpu-slower"
    };
  }
  return comparisons;
}

function getMetricDirection(metricPath) {
  if (metricPath === "framesPerSecond" || metricPath === "onePercentLowFps" ||
    metricPath === "gpuHeadroomRatio" || metricPath === "gpuFrameAvailabilityRatio") {
    return "higher";
  }
  if (metricPath === "measuredDurationMs" || metricPath === "frameCount" ||
    metricPath.endsWith(".count")) {
    return "neutral";
  }
  if (metricPath.includes("Ms") || metricPath.includes("over") ||
    metricPath === "gpuTimerErrorCount" || metricPath.endsWith("missedFrameRatio")) {
    return "lower";
  }
  return "neutral";
}

function summarizeNumbers(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance = sorted.reduce((total, value) => total + ((value - mean) ** 2), 0) /
    sorted.length;

  return {
    count: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    standardDeviation: round(Math.sqrt(variance))
  };
}

function flattenMetricValues(metrics) {
  const flattened = {};
  visitMetric(metrics, "", flattened);
  return flattened;
}

function visitMetric(value, metricPath, flattened) {
  if (typeof value === "number") {
    if (metricPath) flattened[metricPath] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitMetric(entry, `${metricPath}[${index}]`, flattened));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    visitMetric(entry, metricPath ? `${metricPath}.${key}` : key, flattened);
  }
}

function collectDifferences(left, right, fieldPath, differences) {
  if (differences.length >= 25 || Object.is(left, right)) return;
  if (typeof left !== typeof right || left === null || right === null) {
    differences.push({ path: fieldPath, webgl: left, webgpu: right });
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      differences.push({ path: fieldPath, webgl: left, webgpu: right });
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      collectDifferences(left[index], right[index], `${fieldPath}[${index}]`, differences);
    }
    return;
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) {
        differences.push({
          path: `${fieldPath}.${key}`,
          webgl: key in left ? left[key] : "<missing>",
          webgpu: key in right ? right[key] : "<missing>"
        });
      } else {
        collectDifferences(left[key], right[key], `${fieldPath}.${key}`, differences);
      }
    }
    return;
  }
  differences.push({ path: fieldPath, webgl: left, webgpu: right });
}

function appendEnvironment(lines, metadata) {
  const host = metadata.host ?? {};
  const browser = metadata.browser ?? {};
  const runtime = metadata.runtime ?? {};
  const webgpu = runtime.webgpu ?? {};

  lines.push(
    "## Environment",
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| OS | ${escapeCell(`${host.platform ?? "unknown"} ${host.release ?? ""} ${host.arch ?? ""}`.trim())} |`,
    `| CPU | ${escapeCell(`${host.cpuModel ?? "unknown"} (${host.logicalCpuCount ?? "?"} logical)`)} |`,
    `| Memory | ${formatBytes(host.totalMemoryBytes)} |`,
    `| Browser | ${escapeCell(`${browser.name ?? "Chromium"} ${browser.version ?? "unknown"}`)} |`,
    `| Channel | ${escapeCell(browser.channel ?? "bundled Chromium")} |`,
    `| User agent | ${escapeCell(runtime.userAgent ?? "unavailable")} |`,
    `| WebGL GPU | ${escapeCell(runtime.webgl?.renderer ?? "unavailable")} |`,
    `| WebGPU adapter | ${escapeCell(webgpu.description || webgpu.device || "unavailable")} |`,
    `| Git | ${escapeCell(formatGit(metadata.git))} |`,
    ""
  );
}

function appendOrder(lines, config) {
  lines.push(
    "## Run Order",
    "",
    "| Repetition | Renderer order | Case order |",
    "| ---: | --- | --- |"
  );
  for (let index = 0; index < config.repetitions; index += 1) {
    const scheduled = config.schedule?.[index];
    const rendererOrder = scheduled?.rendererOrder?.join(", ") ??
      (index % 2 === 0 ? "webgl, webgpu" : "webgpu, webgl");
    const caseOrder = scheduled?.caseOrder?.join(", ") ?? "legacy order";
    lines.push(`| ${index + 1} | ${escapeCell(rendererOrder)} | ${escapeCell(caseOrder)} |`);
  }
  lines.push("");
}

function appendParity(lines, parity) {
  lines.push(
    "## Semantic Parity",
    "",
    `Result: **${parity.passed ? "PASS" : "FAIL"}** ` +
      `(${parity.passedChecks}/${parity.expectedChecks} paired checks)`,
    ""
  );
  const failures = parity.checks.filter((check) => !check.passed);
  if (failures.length === 0) return;

  lines.push("| Scenario | Repetition | Differences |", "| --- | ---: | --- |");
  for (const check of failures) {
    const details = check.differences
      .map((difference) =>
        `${difference.path}: ${formatBrief(difference.webgl)} vs ${formatBrief(difference.webgpu)}`
      )
      .join("; ");
    lines.push(`| ${escapeCell(check.caseId)} | ${check.repetition + 1} | ${escapeCell(details)} |`);
  }
  lines.push("");
}

function appendScenario(lines, report) {
  lines.push(`## ${report.label}`, "", `Completed samples: ${report.sampleCount}`, "");
  const comparisons = Object.entries(report.comparisons)
    .sort(([left], [right]) => metricPriority(left) - metricPriority(right) || left.localeCompare(right));
  if (comparisons.length === 0) {
    lines.push("No common numeric metrics were available for comparison.", "");
    return;
  }

  lines.push(
    "| Metric | WebGL mean | WebGPU mean | GPU/GL ratio | GPU vs GL | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | --- |"
  );
  for (const [metricPath, comparison] of comparisons.slice(0, MAX_MARKDOWN_METRICS)) {
    lines.push(
      `| ${escapeCell(metricPath)} | ${formatNumber(comparison.webglMean)} | ` +
      `${formatNumber(comparison.webgpuMean)} | ${formatNumber(comparison.webgpuToWebglRatio)} | ` +
      `${formatPercent(comparison.webgpuVsWebglPercent)} | ${comparison.verdict} |`
    );
  }
  if (comparisons.length > MAX_MARKDOWN_METRICS) {
    lines.push(
      "",
      `${comparisons.length - MAX_MARKDOWN_METRICS} additional metrics are available in \`summary.json\`.`
    );
  }
  lines.push("");
}

function metricPriority(metricPath) {
  const normalized = metricPath.toLowerCase();
  const priorities = ["fps", "frame", "gpu", "cpu", "raf", "budget", "count"];
  const index = priorities.findIndex((token) => normalized.includes(token));
  return index === -1 ? priorities.length : index;
}

function finiteValues(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}

function ratioAbove(values, threshold) {
  if (values.length === 0) return null;
  return round(values.filter((value) => value > threshold).length / values.length);
}

function percentile(sorted, fraction) {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function assertNonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number; received ${value}.`);
  }
}

function formatGit(git) {
  if (!git?.commit) return "unavailable";
  const branch = git.branch ? `${git.branch}@` : "";
  return `${branch}${git.commit.slice(0, 12)}${git.dirty ? " (dirty)" : ""}`;
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${round(value / 1000)} s`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "unavailable";
  return `${round(value / (1024 ** 3))} GiB`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}%`;
}

function formatBrief(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function escapeInline(value) {
  return String(value).replaceAll("`", "\\`");
}

function escapeCell(value) {
  return escapeMarkdown(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
