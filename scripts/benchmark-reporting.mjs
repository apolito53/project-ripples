const BACKENDS = ["webgl", "webgpu"];
const DYNAMIC_SEMANTIC_FIELDS = ["activeParticles", "activeSources", "activeEchoes", "playerSpeed"];
const MAX_MARKDOWN_METRICS = 40;
const DECISION_GRADE_CASE_IDS = [
  "pretty-arena",
  "showoff-track-motion",
  "meltdown-ramp-tier-0",
  "meltdown-ramp-tier-1",
  "meltdown-ramp-tier-2",
  "meltdown-ramp-tier-3",
  "meltdown-ramp-tier-4"
];

export const RENDERER_BENCHMARK_SCHEMA_VERSION = 2;
export const RENDERER_BENCHMARK_PROTOCOL_VERSION =
  "renderer-benchmark-v2-flat-top-column-stagger";
export const RENDERER_BENCHMARK_WORKLOAD_VERSION =
  "renderer-benchmark-v2-flat-top-column-stagger";

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
  assertSampleWindowCoverage(snapshot, samples, context);

  const metrics = buildMetrics(snapshot);
  const metricValues = flattenMetricValues(metrics);
  const semanticSummary = summarizeSemantics(samples);
  assertExpectedSemantics(semanticSummary, context);

  return {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
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

/**
 * Keep physical machine identity separate from software/runtime conditions.
 * Controller inventory is intentionally reduced to display names and driver
 * versions; raw Windows PNP identifiers never enter a portable artifact.
 */
export function normalizeBenchmarkMetadata({
  host = {},
  browser = {},
  runtime = {},
  renderers = {},
  git = {},
  package: packageMetadata = {}
} = {}) {
  const webgl = isRecord(renderers.webgl) ? renderers.webgl : {};
  const webgpu = isRecord(renderers.webgpu) ? renderers.webgpu : {};
  const webGpuAdapter = isRecord(webgpu.webGpuAdapter) ? webgpu.webGpuAdapter : {};
  const webGpuAdapterSummary = typeof webgpu.webGpuAdapter === "string"
    ? webgpu.webGpuAdapter
    : null;
  const gpuControllers = normalizeGpuControllers(host.gpuControllers);

  return {
    hardware: {
      cpu: {
        model: stringOrNull(host.cpuModel),
        logicalProcessorCount: finiteOrNull(host.logicalCpuCount),
        architecture: stringOrNull(host.arch)
      },
      memory: {
        totalBytes: finiteOrNull(host.totalMemoryBytes)
      },
      selectedAdapters: {
        webgl: compactRecord({
          vendor: stringOrNull(webgl.webGlVendor),
          renderer: stringOrNull(webgl.webGlRenderer)
        }),
        webgpu: compactRecord({
          vendor: stringOrNull(webGpuAdapter.vendor),
          architecture: stringOrNull(webGpuAdapter.architecture),
          device: stringOrNull(webGpuAdapter.device),
          description: stringOrNull(webGpuAdapter.description ?? webGpuAdapterSummary)
        })
      }
    },
    environment: {
      os: compactRecord({
        platform: stringOrNull(host.platform),
        release: stringOrNull(host.release),
        architecture: stringOrNull(host.arch)
      }),
      browser: compactRecord({
        name: stringOrNull(browser.name),
        version: stringOrNull(browser.version),
        channel: stringOrNull(browser.channel),
        headless: typeof browser.headless === "boolean" ? browser.headless : null,
        displayRefreshIntervalMs: finiteOrNull(browser.displayRefreshIntervalMs)
      }),
      runtime: compactRecord({
        userAgent: stringOrNull(runtime.userAgent),
        platform: stringOrNull(runtime.platform),
        language: stringOrNull(runtime.language),
        hardwareConcurrency: finiteOrNull(runtime.hardwareConcurrency),
        deviceMemoryGiB: finiteOrNull(runtime.deviceMemoryGiB),
        devicePixelRatio: finiteOrNull(runtime.devicePixelRatio),
        viewport: normalizeDimensions(runtime.viewport),
        screen: normalizeDimensions(runtime.screen),
        crossOriginIsolated: typeof runtime.crossOriginIsolated === "boolean"
          ? runtime.crossOriginIsolated
          : null
      }),
      rendererCapabilities: {
        webgl: compactRecord({
          version: stringOrNull(webgl.webGlVersion)
        }),
        webgpu: compactRecord({
          preferredFormat: stringOrNull(webgpu.webGpuPreferredFormat),
          timestampQueryEnabled: typeof webgpu.webGpuTimestampQuery === "boolean"
            ? webgpu.webGpuTimestampQuery
            : null,
          features: normalizeStringArray(webgpu.webGpuFeatures),
          limits: normalizeNumericRecord(webgpu.webGpuLimits)
        })
      },
      gpuDrivers: gpuControllers,
      powerPlan: stringOrNull(host.powerPlan),
      nodeVersion: stringOrNull(host.nodeVersion),
      freeMemoryBytesAtStart: finiteOrNull(host.freeMemoryBytesAtStart)
    },
    sourceControl: compactRecord({
      commit: stringOrNull(git.commit),
      branch: stringOrNull(git.branch),
      dirty: typeof git.dirty === "boolean" ? git.dirty : null,
      status: normalizeStringArray(git.status)
    }),
    package: compactRecord({
      name: stringOrNull(packageMetadata.name),
      version: stringOrNull(packageMetadata.version),
      playwrightVersion: stringOrNull(packageMetadata.playwrightVersion)
    })
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
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
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
    runtimeHealth: summarizeRuntimeHealth(samples),
    stableStressTiers,
    scenarios,
    artifacts: {
      summaryJson: "summary.json",
      samplesNdjsonGzip: "samples.ndjson.gz",
      summaryMarkdown: "summary.md",
      representativeCaptures: samples
        .filter((sample) => typeof sample.capturePath === "string")
        .map((sample) => ({
          caseId: sample.caseId,
          renderer: sample.renderer,
          repetition: sample.repetition,
          path: sample.capturePath
        }))
    },
    failure
  };
}

export function createBenchmarkBaseline(summary, { eligible = true, acceptanceStatus = null } = {}) {
  assertBenchmarkSummaryProtocol(summary, "benchmark summary");
  return {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    baselineKind: "renderer-benchmark-baseline",
    eligible,
    acceptanceStatus,
    sourceRun: {
      runId: summary.runId,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      status: summary.status
    },
    metadata: cloneJsonValue(summary.metadata),
    config: getComparableConfig(summary.config),
    stableStressTiers: cloneJsonValue(summary.stableStressTiers),
    scenarios: cloneBaselineScenarios(summary)
  };
}

export function compareBenchmarkBaseline(summary, baseline) {
  assertBenchmarkSummaryProtocol(summary, "current benchmark summary");
  if (!isRecord(baseline)) {
    throw new Error("Benchmark baseline must be a JSON object.");
  }

  const compatibilityReasons = getBaselineCompatibilityReasons(summary, baseline);
  if (compatibilityReasons.length > 0) {
    return {
      classification: "incompatible",
      sameHardware: false,
      status: "incompatible",
      reasons: compatibilityReasons,
      findings: []
    };
  }

  assertCompatibleBaselineShape(baseline);
  const hardwareDifferences = collectComparisonPaths(
    getHardwareIdentity(summary.metadata),
    getHardwareIdentity(baseline.metadata)
  );
  const environmentDifferences = collectComparisonPaths(
    summary.metadata?.environment ?? {},
    baseline.metadata?.environment ?? {}
  );
  const currentRefreshIntervalMs = summary.metadata?.environment?.browser?.displayRefreshIntervalMs;
  const baselineRefreshIntervalMs = baseline.metadata?.environment?.browser?.displayRefreshIntervalMs;
  const refreshIntervalComparable = areRefreshIntervalsComparable(
    currentRefreshIntervalMs,
    baselineRefreshIntervalMs
  );
  const hardwareIdentityAvailable = hasMeaningfulHardwareIdentity(summary.metadata) &&
    hasMeaningfulHardwareIdentity(baseline.metadata);
  const sameHardware = hardwareIdentityAvailable && hardwareDifferences.length === 0;
  const regressionComparable = sameHardware && refreshIntervalComparable;
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

  const effectiveFindings = regressionComparable ? findings : findings.map((finding) => ({
    ...finding,
    severity: "info"
  }));
  const classification = regressionComparable ? "comparable" : "informational";
  const reasons = regressionComparable
    ? [
        "Physical hardware and display-refresh budget match; same-machine 10% warning and 20% failure thresholds apply.",
        ...(environmentDifferences.length > 0
          ? [`Environment differences recorded: ${environmentDifferences.join(", ")}.`]
          : ["Environment metadata matches."])
      ]
    : buildInformationalComparisonReasons({
        hardwareIdentityAvailable,
        hardwareDifferences,
        refreshIntervalComparable,
        currentRefreshIntervalMs,
        baselineRefreshIntervalMs
      });
  return {
    classification,
    sameHardware,
    status: classification === "informational"
      ? "informational"
      : effectiveFindings.some((finding) => finding.severity === "fail")
        ? "failed"
        : effectiveFindings.some((finding) => finding.severity === "warn")
          ? "warning"
          : "passed",
    reasons,
    findings: effectiveFindings
  };
}

export function buildBenchmarkAcceptance({
  summary,
  stock,
  cleanTree,
  packageLifecycle = {
    passed: true,
    detail: "Package lifecycle was not separately evaluated."
  },
  packageProfile,
  requiredSoakMs
}) {
  assertBenchmarkSummaryProtocol(summary, "benchmark summary");
  const normalCaseIds = ["pretty-arena", "showoff-track-motion"];
  const timerReports = [];
  for (const benchmarkCase of summary.config.cases) {
    for (const backend of BACKENDS) {
      const report = summary.scenarios?.[benchmarkCase.id]?.backends?.[backend];
      timerReports.push({ caseId: benchmarkCase.id, backend, report });
    }
  }

  const minimumTimerCoverage = Math.min(...timerReports.map(({ report }) =>
    report?.metrics?.gpuFrameAvailabilityRatio?.min ?? Number.NEGATIVE_INFINITY
  ));
  const maximumTimerErrors = Math.max(...timerReports.map(({ report }) =>
    report?.metrics?.gpuTimerErrorCount?.max ?? Number.POSITIVE_INFINITY
  ));
  const normalWebGpuStable = normalCaseIds.every((caseId) =>
    summary.scenarios?.[caseId]?.backends?.webgpu?.allSamplesStable === true
  );
  const stockModes = new Set((stock?.modes ?? []).filter((item) => item.passed).map((item) => item.mode));
  const visualChecks = stock?.visualChecks ?? [];
  const comparison = summary.regression ?? null;
  const decisionGrade = packageProfile === "cross-hardware-acceptance";
  const decisionGradeProtocol = evaluateDecisionGradeProtocol(summary, packageProfile);
  const stockAdapterConsistency = evaluateStockAdapterConsistency(stock, summary.metadata);
  const observedSoakMs = stock?.soak?.observedDurationMs;
  const soakToleranceMs = Math.min(250, requiredSoakMs * 0.01);

  const gates = {
    decisionGradeProtocol: gate(
      decisionGradeProtocol.passed,
      decisionGradeProtocol.detail
    ),
    cleanTree: gate(Boolean(cleanTree?.passed), cleanTree?.detail ?? "Git tree must be clean before packaging."),
    packageLifecycle: gate(
      Boolean(packageLifecycle?.passed),
      packageLifecycle?.detail ?? "Strict preview and source cleanup must complete before acceptance."
    ),
    benchmarkCompleted: gate(
      summary.status === "passed",
      summary.status === "passed" ? "Instrumented benchmark completed." : summary.failure?.message ?? "Benchmark failed."
    ),
    semanticParity: gate(
      summary.semanticParity.passed,
      `${summary.semanticParity.passedChecks}/${summary.semanticParity.expectedChecks} paired checks passed.`
    ),
    stockModes: gate(
      ["arena", "track", "training"].every((mode) => stockModes.has(mode)),
      `Passed stock modes: ${[...stockModes].sort().join(", ") || "none"}.`
    ),
    stockSoak: gate(
      stock?.soak?.passed === true &&
        stock.soak.requestedDurationMs >= requiredSoakMs &&
        Number.isFinite(observedSoakMs) && observedSoakMs >= requiredSoakMs - soakToleranceMs,
      `Observed ${stock?.soak?.observedDurationMs ?? 0} ms of the required ${requiredSoakMs} ms stock soak.`
    ),
    adapterConsistency: gate(
      stockAdapterConsistency.passed,
      stockAdapterConsistency.detail
    ),
    runtimeHealth: gate(
      stock?.health?.passed === true && summary.runtimeHealth.passed === true,
      `Stock problems=${stock?.health?.problemCount ?? "unknown"}; benchmark problems=${summary.runtimeHealth.problemCount}.`
    ),
    webGpuPrettyShowoffStable: gate(
      normalWebGpuStable,
      "WebGPU Pretty Arena and Showoff Track must have every repetition marked stable."
    ),
    timerCoverage: gate(
      Number.isFinite(minimumTimerCoverage) && minimumTimerCoverage >= 0.25,
      `Minimum fresh GPU timer coverage was ${Number.isFinite(minimumTimerCoverage) ? formatPercent(minimumTimerCoverage * 100) : "unavailable"}; required >=25%.`
    ),
    timerErrors: gate(
      maximumTimerErrors === 0,
      `Maximum reported GPU timer error count was ${Number.isFinite(maximumTimerErrors) ? maximumTimerErrors : "unavailable"}.`
    ),
    visualBounds: gate(
      visualChecks.length >= 4 && visualChecks.every((item) => item.passed),
      `${visualChecks.filter((item) => item.passed).length}/${visualChecks.length} stock canvas checks stayed within bounds.`
    ),
    baselineRegression: gate(
      comparison === null || comparison.classification === "informational" || comparison.status === "passed",
      comparison === null
        ? "No prior baseline was supplied; this accepted run may become the v2 baseline."
        : `${comparison.classification}: ${comparison.status}.`
    )
  };
  const failedGateIds = Object.entries(gates)
    .filter(([, value]) => !value.passed)
    .map(([id]) => id);

  return {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    runId: summary.runId,
    packageProfile,
    decisionGrade,
    status: failedGateIds.length > 0 ? "failed" : decisionGrade ? "passed" : "test-only-passed",
    thresholds: {
      timerCoverageMinimum: 0.25,
      sameMachineWarningPercent: 10,
      sameMachineFailurePercent: 20,
      stockSoakMs: requiredSoakMs
    },
    gates,
    failedGateIds,
    comparison,
    stock
  };
}

export function renderSummaryMarkdown(summary) {
  const lines = [
    "# Ripple Renderer Benchmark",
    "",
    `- Status: **${summary.status.toUpperCase()}**`,
    `- Run: \`${escapeInline(summary.runId)}\``,
    `- Protocol: \`${escapeInline(summary.protocolVersion)}\``,
    `- Workload: \`${escapeInline(summary.workloadVersion)}\``,
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
  appendAcceptance(lines, summary.acceptance);

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
    "- `samples.ndjson.gz`: gzip-compressed normalized record per completed backend sample",
    "- `summary.md`: this human-readable report",
    ...(summary.artifacts?.acceptanceJson
      ? ["- `acceptance.json`: per-machine stock, stability, timer, visual, and regression gates"]
      : []),
    ...(summary.artifacts?.baselineJson
      ? [summary.acceptance?.status === "passed" && summary.acceptance?.decisionGrade === true
          ? "- `baseline.json`: accepted v2 baseline projection for later compatible comparisons"
          : "- `baseline.json`: ineligible current-run projection retained for audit only"]
      : []),
    ...(summary.artifacts?.manifestJson
      ? ["- `manifest.json`: relative bundle inventory with SHA-256 checksums"]
      : []),
    ...(summary.artifacts?.comparisonBaselineJson
      ? ["- `comparison-baseline.json`: checksummed prior baseline used for this regression decision"]
      : []),
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

function assertSampleWindowCoverage(snapshot, samples, context) {
  const requestedSampleMs = context.sampleMs;
  const allowedWindowShortfallMs = Math.min(500, requestedSampleMs * 0.1);
  const minimumWindowMs = requestedSampleMs - allowedWindowShortfallMs;
  const observedPhaseMs = snapshot.stoppedAtMs - snapshot.startedAtMs;
  if (observedPhaseMs < minimumWindowMs) {
    throw new Error(
      `${context.label} sampled for ${round(observedPhaseMs)} ms; expected at least ` +
      `${round(minimumWindowMs)} ms of the requested ${requestedSampleMs} ms window.`
    );
  }

  const firstTimestampMs = samples[0].timestampMs;
  const lastTimestampMs = samples[samples.length - 1].timestampMs;
  const observedFrameSpanMs = lastTimestampMs - firstTimestampMs;
  if (observedFrameSpanMs < minimumWindowMs) {
    throw new Error(
      `${context.label} frame samples span ${round(observedFrameSpanMs)} ms; expected at least ` +
      `${round(minimumWindowMs)} ms. The renderer may have stopped producing frames.`
    );
  }

  const minimumSampleCount = Math.max(2, Math.floor(requestedSampleMs / 250));
  if (samples.length < minimumSampleCount) {
    throw new Error(
      `${context.label} returned ${samples.length} frames; expected at least ${minimumSampleCount} ` +
      `across the ${requestedSampleMs} ms sample window.`
    );
  }

  let maximumFrameGapMs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const frameGapMs = samples[index].timestampMs - samples[index - 1].timestampMs;
    if (frameGapMs <= 0) {
      throw new Error(`${context.label} frame timestamps must increase strictly.`);
    }
    maximumFrameGapMs = Math.max(maximumFrameGapMs, frameGapMs);
  }
  if (maximumFrameGapMs > 500) {
    throw new Error(
      `${context.label} observed a ${round(maximumFrameGapMs)} ms frame gap; ` +
      "acceptance samples may not hide a renderer stall."
    );
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
    `Status: **${regression.status.toUpperCase()}** (${regression.classification})`,
    ""
  );
  for (const reason of regression.reasons ?? []) lines.push(`- ${escapeMarkdown(reason)}`);
  if ((regression.reasons ?? []).length > 0) lines.push("");
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

function appendAcceptance(lines, acceptance) {
  if (!acceptance) return;
  lines.push(
    "## Packaged Acceptance",
    "",
    `Result: **${acceptance.status.toUpperCase()}**`,
    "",
    "| Gate | Result | Detail |",
    "| --- | --- | --- |"
  );
  for (const [id, result] of Object.entries(acceptance.gates ?? {})) {
    lines.push(
      `| ${escapeCell(id)} | ${result.passed ? "PASS" : "FAIL"} | ${escapeCell(result.detail)} |`
    );
  }
  lines.push("");
}

function summarizeRuntimeHealth(samples) {
  let problemCount = 0;
  let deviceLostSampleCount = 0;
  for (const sample of samples) {
    const problems = sample.pageProblems ?? {};
    problemCount += (problems.consoleErrors?.length ?? 0) +
      (problems.pageErrors?.length ?? 0) +
      (problems.crashes?.length ?? 0);
    if (sample.semantics?.deviceLost === true) deviceLostSampleCount += 1;
  }
  return {
    passed: problemCount === 0 && deviceLostSampleCount === 0,
    problemCount,
    deviceLostSampleCount
  };
}

function normalizeGpuControllers(value) {
  const controllers = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  return controllers
    .map((controller) => compactRecord({
      name: stringOrNull(controller.Name ?? controller.name),
      driverVersion: stringOrNull(controller.DriverVersion ?? controller.driverVersion)
    }))
    .filter((controller) => Object.keys(controller).length > 0)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeDimensions(value) {
  if (!isRecord(value)) return null;
  const width = finiteOrNull(value.width);
  const height = finiteOrNull(value.height);
  return width === null && height === null ? null : compactRecord({ width, height });
}

function normalizeNumericRecord(value) {
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => Number.isFinite(entry))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(stringOrNull)
    .filter((entry) => entry !== null)
    .sort();
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)
  );
}

function stringOrNull(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || /(?:PNPDeviceID|(?:PCI|USB)\\(?:VEN|VID)_)/i.test(normalized)) return null;
  return normalized;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function gate(passed, detail) {
  return { passed: Boolean(passed), detail };
}

function assertBenchmarkSummaryProtocol(summary, label) {
  if (!isRecord(summary)) throw new Error(`${label} must be an object.`);
  if (summary.schemaVersion !== RENDERER_BENCHMARK_SCHEMA_VERSION ||
    summary.protocolVersion !== RENDERER_BENCHMARK_PROTOCOL_VERSION ||
    summary.workloadVersion !== RENDERER_BENCHMARK_WORKLOAD_VERSION) {
    throw new Error(
      `${label} does not use ${RENDERER_BENCHMARK_PROTOCOL_VERSION}. ` +
      `Observed schema=${JSON.stringify(summary.schemaVersion)}, ` +
      `protocol=${JSON.stringify(summary.protocolVersion)}, ` +
      `workload=${JSON.stringify(summary.workloadVersion)}.`
    );
  }
}

function getBaselineCompatibilityReasons(summary, baseline) {
  const reasons = [];
  if (baseline.schemaVersion !== summary.schemaVersion) {
    reasons.push(
      `Schema mismatch: current=${JSON.stringify(summary.schemaVersion)}, baseline=${JSON.stringify(baseline.schemaVersion)}.`
    );
  }
  if (baseline.protocolVersion !== summary.protocolVersion) {
    reasons.push(
      `Protocol mismatch: current=${JSON.stringify(summary.protocolVersion)}, baseline=${JSON.stringify(baseline.protocolVersion)}.`
    );
  }
  if (baseline.workloadVersion !== summary.workloadVersion) {
    reasons.push(
      `Workload mismatch: current=${JSON.stringify(summary.workloadVersion)}, baseline=${JSON.stringify(baseline.workloadVersion)}.`
    );
  }
  if (reasons.length > 0) return reasons;

  if (baseline.baselineKind !== "renderer-benchmark-baseline") {
    reasons.push(`Baseline kind was ${JSON.stringify(baseline.baselineKind)}.`);
  }
  if (baseline.eligible !== true) {
    reasons.push("Baseline is not marked eligible by a passed packaged acceptance run.");
  }
  if (isRecord(baseline.config)) {
    const configDifferences = collectComparisonPaths(getComparableConfig(summary.config), baseline.config);
    if (configDifferences.length > 0) {
      reasons.push(`Benchmark configuration differs at: ${configDifferences.join(", ")}.`);
    }
  }
  return reasons;
}

function assertCompatibleBaselineShape(baseline) {
  if (!isRecord(baseline.metadata?.hardware) || !isRecord(baseline.metadata?.environment)) {
    throw new Error("Compatible benchmark baseline metadata must contain hardware and environment objects.");
  }
  if (!isRecord(baseline.config) || !Array.isArray(baseline.config.cases) ||
    !Array.isArray(baseline.config.backends)) {
    throw new Error("Compatible benchmark baseline config must contain cases and backends arrays.");
  }
  if (!isRecord(baseline.stableStressTiers) || !isRecord(baseline.scenarios)) {
    throw new Error("Compatible benchmark baseline must contain stableStressTiers and scenarios objects.");
  }
  for (const benchmarkCase of baseline.config.cases) {
    if (!isRecord(benchmarkCase) || typeof benchmarkCase.id !== "string") {
      throw new Error("Compatible benchmark baseline contains a malformed case descriptor.");
    }
    const scenario = baseline.scenarios[benchmarkCase.id];
    if (!isRecord(scenario?.backends?.webgl?.metrics) ||
      !isRecord(scenario?.backends?.webgpu?.metrics)) {
      throw new Error(
        `Compatible benchmark baseline case ${benchmarkCase.id} must contain WebGL and WebGPU metrics.`
      );
    }
  }
}

function getComparableConfig(config) {
  return {
    profile: config?.profile ?? "standard",
    viewport: cloneJsonValue(config?.viewport ?? null),
    deviceScaleFactor: config?.deviceScaleFactor ?? null,
    cases: cloneJsonValue(config?.cases ?? []),
    backends: cloneJsonValue(config?.backends ?? []),
    seed: config?.seed ?? null,
    warmupMs: config?.warmupMs ?? null,
    sampleMs: config?.sampleMs ?? null,
    repetitions: config?.repetitions ?? null,
    headless: config?.headless ?? null,
    browserChannel: config?.browserChannel ?? null,
    browserArgs: cloneJsonValue(config?.browserArgs ?? [])
  };
}

function cloneBaselineScenarios(summary) {
  return Object.fromEntries(summary.config.cases.map((benchmarkCase) => {
    const scenario = summary.scenarios[benchmarkCase.id];
    return [benchmarkCase.id, {
      scenario: scenario.scenario,
      tier: scenario.tier,
      label: scenario.label,
      backends: {
        webgl: cloneJsonValue(scenario.backends.webgl),
        webgpu: cloneJsonValue(scenario.backends.webgpu)
      }
    }];
  }));
}

function getHardwareIdentity(metadata) {
  return {
    cpu: cloneJsonValue(metadata?.hardware?.cpu ?? {}),
    memory: cloneJsonValue(metadata?.hardware?.memory ?? {}),
    selectedAdapters: cloneJsonValue(metadata?.hardware?.selectedAdapters ?? {})
  };
}

function hasMeaningfulHardwareIdentity(metadata) {
  const hardware = metadata?.hardware;
  const cpuModel = hardware?.cpu?.model;
  const adapters = hardware?.selectedAdapters;
  const webGlRenderer = adapters?.webgl?.renderer;
  const webGpuAdapter = adapters?.webgpu;
  return typeof cpuModel === "string" && cpuModel.length > 0 &&
    (typeof webGlRenderer === "string" && webGlRenderer.length > 0 ||
      getAdapterIdentityKey(webGpuAdapter) !== null);
}

function areRefreshIntervalsComparable(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || current <= 0 || baseline <= 0) {
    return false;
  }
  const relativeDifference = Math.abs(current - baseline) / Math.max(current, baseline);
  return relativeDifference <= 0.1;
}

function buildInformationalComparisonReasons({
  hardwareIdentityAvailable,
  hardwareDifferences,
  refreshIntervalComparable,
  currentRefreshIntervalMs,
  baselineRefreshIntervalMs
}) {
  const reasons = [];
  if (!hardwareIdentityAvailable) {
    reasons.push("One or both runs lack a complete physical hardware identity.");
  } else if (hardwareDifferences.length > 0) {
    reasons.push(`Physical hardware differs at: ${hardwareDifferences.join(", ")}.`);
  }
  if (!refreshIntervalComparable) {
    reasons.push(
      `Display refresh budgets differ or are unavailable: current=${JSON.stringify(currentRefreshIntervalMs)}, ` +
      `baseline=${JSON.stringify(baselineRefreshIntervalMs)}.`
    );
  }
  reasons.push("Regression deltas are informational and cannot fail acceptance.");
  return reasons;
}

function evaluateStockAdapterConsistency(stock, metadata) {
  const stockAdapters = [
    ...(stock?.modes ?? []).map((item) => item.selectedAdapter),
    stock?.soak?.selectedAdapter
  ];
  const stockKeys = stockAdapters.map(getAdapterIdentityKey).filter((value) => value !== null);
  const benchmarkKey = getAdapterIdentityKey(metadata?.hardware?.selectedAdapters?.webgpu);
  const uniqueStockKeys = [...new Set(stockKeys)];
  const expectedStockCount = (stock?.modes?.length ?? 0) + (stock?.soak ? 1 : 0);
  const passed = expectedStockCount >= 4 && stockKeys.length === expectedStockCount &&
    uniqueStockKeys.length === 1 && benchmarkKey !== null && uniqueStockKeys[0] === benchmarkKey;
  return {
    passed,
    detail: passed
      ? `Stock and instrumented runs selected ${benchmarkKey}.`
      : `Stock adapters=${uniqueStockKeys.join(" | ") || "unavailable"}; ` +
        `instrumented adapter=${benchmarkKey ?? "unavailable"}.`
  };
}

function evaluateDecisionGradeProtocol(summary, packageProfile) {
  if (packageProfile !== "cross-hardware-acceptance") {
    return {
      passed: true,
      detail: `${packageProfile} is a tooling-only profile and cannot mint an eligible baseline.`
    };
  }
  const caseIds = (summary.config?.cases ?? []).map((item) => item.id);
  const passed = summary.config?.profile === packageProfile &&
    summary.config?.warmupMs === 5_000 &&
    summary.config?.sampleMs === 15_000 &&
    summary.config?.repetitions === 4 &&
    JSON.stringify(caseIds) === JSON.stringify(DECISION_GRADE_CASE_IDS) &&
    summary.semanticParity?.expectedChecks === 28 &&
    summary.expectedSampleCount === 56;
  return {
    passed,
    detail: passed
      ? "Decision-grade protocol contains seven fixed cases, four repetitions, 28 pairs, and 56 samples."
      : "Decision-grade profile must use the fixed seven-case, four-repetition, 5s/15s protocol."
  };
}

function getAdapterIdentityKey(value) {
  if (!isRecord(value)) return null;
  const parts = ["vendor", "architecture", "device", "description"]
    .map((key) => stringOrNull(value[key])?.toLowerCase() ?? null)
    .filter((entry) => entry !== null);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function collectComparisonPaths(left, right, limit = 16) {
  const paths = [];
  const visit = (leftValue, rightValue, currentPath) => {
    if (paths.length >= limit || Object.is(leftValue, rightValue)) return;
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue) ||
        JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
        paths.push(currentPath || "<root>");
      }
      return;
    }
    if (isRecord(leftValue) && isRecord(rightValue)) {
      const keys = [...new Set([...Object.keys(leftValue), ...Object.keys(rightValue)])].sort();
      for (const key of keys) {
        visit(leftValue[key], rightValue[key], currentPath ? `${currentPath}.${key}` : key);
      }
      return;
    }
    paths.push(currentPath || "<root>");
  };
  visit(left, right, "");
  return paths;
}

function cloneJsonValue(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
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
  const hardware = metadata.hardware ?? {};
  const environment = metadata.environment ?? {};
  const cpu = hardware.cpu ?? {};
  const memory = hardware.memory ?? {};
  const browser = environment.browser ?? {};
  const runtime = environment.runtime ?? {};
  const webgl = hardware.selectedAdapters?.webgl ?? {};
  const webgpu = hardware.selectedAdapters?.webgpu ?? {};
  const osMetadata = environment.os ?? {};

  lines.push(
    "## Environment",
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| OS | ${escapeCell(`${osMetadata.platform ?? "unknown"} ${osMetadata.release ?? ""} ${osMetadata.architecture ?? ""}`.trim())} |`,
    `| CPU | ${escapeCell(`${cpu.model ?? "unknown"} (${cpu.logicalProcessorCount ?? "?"} logical)`)} |`,
    `| Memory | ${formatBytes(memory.totalBytes)} |`,
    `| Browser | ${escapeCell(`${browser.name ?? "Chromium"} ${browser.version ?? "unknown"}`)} |`,
    `| Channel | ${escapeCell(browser.channel ?? "bundled Chromium")} |`,
    `| User agent | ${escapeCell(runtime.userAgent ?? "unavailable")} |`,
    `| WebGL GPU | ${escapeCell(webgl.renderer ?? "unavailable")} |`,
    `| WebGPU adapter | ${escapeCell(webgpu.description || webgpu.device || "unavailable")} |`,
    `| Git | ${escapeCell(formatGit(metadata.sourceControl))} |`,
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
