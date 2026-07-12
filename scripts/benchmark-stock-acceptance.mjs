import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { delay } from "./ripple-smoke-harness.mjs";
import { toPortableRelativePath } from "./benchmark-package.mjs";
import {
  RENDERER_BENCHMARK_PROTOCOL_VERSION,
  RENDERER_BENCHMARK_SCHEMA_VERSION,
  RENDERER_BENCHMARK_WORKLOAD_VERSION
} from "./benchmark-reporting.mjs";

const FIXED_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const STOCK_SCENARIOS = Object.freeze([
  Object.freeze({ mode: "arena", scenario: "pretty-arena", qualityId: "pretty" }),
  Object.freeze({ mode: "track", scenario: "pretty-arena", qualityId: "pretty" }),
  Object.freeze({ mode: "training", scenario: "pretty-arena", qualityId: "pretty" })
]);
const VISUAL_LIMITS = Object.freeze({
  minimumAverageBrightness: 2,
  minimumNonBlackRatio: 0.01,
  maximumAverageBrightness: 185,
  maximumGlareRatio: 0.22,
  maximumCyanWashRatio: 0.9,
  maximumBlueWashRatio: 0.94
});
const SOAK_POLL_INTERVAL_MS = 250;
const SOAK_MAX_FRAME_GAP_MS = 2_000;

export async function runStockWebGpuAcceptance({
  appUrl,
  browserChannel,
  headless,
  outputDirectory,
  profile,
  registerOwnedBrowser = null
}) {
  if (browserChannel !== "chrome") {
    throw new Error("Packaged stock acceptance requires the stable Chrome channel \"chrome\".");
  }

  const startedAtMs = Date.now();
  const capturesDirectory = path.join(outputDirectory, "captures", "stock");
  await mkdir(capturesDirectory, { recursive: true });
  const browser = await chromium.launch({
    channel: browserChannel,
    headless,
    args: [],
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false
  });
  const releaseOwnedBrowser = registerOwnedBrowser?.(browser) ?? (() => {});

  try {
    const context = await browser.newContext({
      viewport: FIXED_VIEWPORT,
      deviceScaleFactor: 1
    });
    const modes = [];
    const visualChecks = [];

    for (const descriptor of STOCK_SCENARIOS) {
      const result = await runStockScenario({
        context,
        appUrl,
        descriptor,
        sampleMs: profile.stockModeSampleMs,
        outputDirectory,
        capturesDirectory
      });
      modes.push(result.modeResult);
      visualChecks.push(result.visualCheck);
    }

    const soak = await runStockSoak({
      context,
      appUrl,
      sampleMs: profile.stockSoakMs,
      outputDirectory,
      capturesDirectory
    });
    visualChecks.push(...soak.visualChecks);
    await context.close();

    const problemCount = modes.reduce((total, item) => total + item.problemCount, 0) +
      soak.problemCount;
    const finishedAtMs = Date.now();
    return {
      schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
      protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
      workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
      browser: {
        name: "Chrome",
        version: browser.version(),
        channel: browserChannel,
        headless,
        args: []
      },
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      modes,
      soak: soak.result,
      visualLimits: VISUAL_LIMITS,
      visualChecks,
      health: {
        passed: problemCount === 0 && modes.every((item) => item.passed) && soak.result.passed,
        problemCount,
        deviceLost: false,
        fallbackObserved: false
      }
    };
  } finally {
    let closed = false;
    try {
      await browser.close();
      closed = true;
    } finally {
      if (closed) releaseOwnedBrowser();
    }
  }
}

export function analyzeCanvasPng(buffer) {
  const png = PNG.sync.read(buffer);
  const totalPixels = Math.max(1, png.width * png.height);
  let nonBlackPixels = 0;
  let glarePixels = 0;
  let cyanWashPixels = 0;
  let blueWashPixels = 0;
  let brightnessTotal = 0;
  let maxBrightness = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    const brightness = (red + green + blue) / 3;
    if (alpha > 0 && brightness > 4) nonBlackPixels += 1;
    if (brightness > 246) glarePixels += 1;
    if (green > 88 && blue > 88 && red < 90 && brightness > 75) cyanWashPixels += 1;
    if (blue > 90 && red < 95 && brightness > 70) blueWashPixels += 1;
    brightnessTotal += brightness;
    maxBrightness = Math.max(maxBrightness, brightness);
  }

  return {
    width: png.width,
    height: png.height,
    maxBrightness: round(maxBrightness),
    averageBrightness: round(brightnessTotal / totalPixels),
    nonBlackRatio: round(nonBlackPixels / totalPixels),
    glareRatio: round(glarePixels / totalPixels),
    cyanWashRatio: round(cyanWashPixels / totalPixels),
    blueWashRatio: round(blueWashPixels / totalPixels)
  };
}

export function evaluateVisualBounds(metrics) {
  const reasons = [];
  if (metrics.averageBrightness <= VISUAL_LIMITS.minimumAverageBrightness) {
    reasons.push("average brightness is too low");
  }
  if (metrics.nonBlackRatio <= VISUAL_LIMITS.minimumNonBlackRatio) {
    reasons.push("non-black coverage is too low");
  }
  if (metrics.averageBrightness > VISUAL_LIMITS.maximumAverageBrightness) {
    reasons.push("average brightness exceeds the upper bound");
  }
  if (metrics.glareRatio > VISUAL_LIMITS.maximumGlareRatio) {
    reasons.push("glare coverage exceeds the upper bound");
  }
  if (metrics.cyanWashRatio > VISUAL_LIMITS.maximumCyanWashRatio) {
    reasons.push("cyan wash coverage exceeds the upper bound");
  }
  if (metrics.blueWashRatio > VISUAL_LIMITS.maximumBlueWashRatio) {
    reasons.push("blue wash coverage exceeds the upper bound");
  }
  return { passed: reasons.length === 0, reasons };
}

async function runStockScenario(options) {
  const page = await options.context.newPage();
  const problems = collectPageProblems(page);
  const url = createStockUrl(options.appUrl, options.descriptor);
  try {
    const startedAtMs = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const canvas = await waitForStockWebGpu(page);
    await waitForStockEvidence(page, options.descriptor);
    await delay(Math.max(0, options.sampleMs - (Date.now() - startedAtMs)));
    const evidence = await readStockEvidence(page);
    const health = assertStockEvidence(evidence, options.descriptor, `stock ${options.descriptor.mode}`);
    problems.assertNone(`Stock ${options.descriptor.mode}`);

    const capturePath = path.join(options.capturesDirectory, `${options.descriptor.mode}.png`);
    const png = await canvas.screenshot({ type: "png", path: capturePath });
    const visualCheck = createVisualCheck(
      `stock-${options.descriptor.mode}`,
      options.outputDirectory,
      capturePath,
      png
    );
    if (!visualCheck.passed) {
      throw new Error(
        `Stock ${options.descriptor.mode} canvas failed visual bounds: ${visualCheck.reasons.join(", ")}.`
      );
    }

    return {
      modeResult: {
        mode: options.descriptor.mode,
        scenario: options.descriptor.scenario,
        qualityId: options.descriptor.qualityId,
        passed: true,
        instrumented: false,
        sampleCount: health.frameSamples.length,
        deviceLost: false,
        fallbackObserved: false,
        problemCount: problems.count(),
        selectedAdapter: normalizeAdapter(health.ready.payload.adapter),
        capturePath: visualCheck.path
      },
      visualCheck
    };
  } finally {
    await page.close();
  }
}

async function runStockSoak(options) {
  const page = await options.context.newPage();
  const problems = collectPageProblems(page);
  const descriptor = STOCK_SCENARIOS[0];
  const url = createStockUrl(options.appUrl, descriptor);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const canvas = await waitForStockWebGpu(page);
    await waitForStockEvidence(page, descriptor);
    const startupEvidence = await readStockEvidence(page);
    const startupHealth = assertStockEvidence(startupEvidence, descriptor, "stock soak startup");
    const initialCapturePath = path.join(options.capturesDirectory, "soak-initial.png");
    const initialPng = await canvas.screenshot({ type: "png", path: initialCapturePath });
    const startedAtMs = Date.now();
    let frameContinuity;
    await page.keyboard.down("w");
    try {
      frameContinuity = await monitorStockSoakFrames(
        page,
        descriptor,
        startupHealth,
        options.sampleMs
      );
    } finally {
      await page.keyboard.up("w");
    }
    const observedDurationMs = Date.now() - startedAtMs;
    const evidence = await readStockEvidence(page);
    const health = assertStockContinuationEvidence(
      evidence,
      descriptor,
      startupHealth,
      "stock soak",
      options.sampleMs,
      frameContinuity
    );
    problems.assertNone("Stock WebGPU soak");

    const finalCapturePath = path.join(options.capturesDirectory, "soak-final.png");
    const finalPng = await canvas.screenshot({ type: "png", path: finalCapturePath });
    const animation = analyzeAnimation(initialPng, finalPng);
    if (!animation.passed) {
      throw new Error(
        `Stock WebGPU soak canvas did not visibly animate: changedRatio=${animation.changedRatio}, ` +
        `averageDiff=${animation.averageDiff}.`
      );
    }

    const initialVisual = createVisualCheck(
      "stock-soak-initial",
      options.outputDirectory,
      initialCapturePath,
      initialPng
    );
    const finalVisual = createVisualCheck(
      "stock-soak-final",
      options.outputDirectory,
      finalCapturePath,
      finalPng
    );
    if (!initialVisual.passed || !finalVisual.passed) {
      throw new Error("Stock WebGPU soak canvas exceeded visual acceptance bounds.");
    }

    return {
      result: {
        passed: true,
        instrumented: false,
        requestedDurationMs: options.sampleMs,
        observedDurationMs,
        sampleCount: health.frameSamples.length,
        deviceLost: false,
        fallbackObserved: false,
        selectedAdapter: normalizeAdapter(health.ready.payload.adapter),
        frameContinuity,
        animation
      },
      visualChecks: [initialVisual, finalVisual],
      problemCount: problems.count()
    };
  } finally {
    await page.close();
  }
}

function createStockUrl(appUrl, descriptor) {
  const url = new URL(appUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("logServer", "0");
  url.searchParams.set("renderer", "webgpu");
  url.searchParams.set("mode", descriptor.mode);
  return url.toString();
}

async function waitForStockWebGpu(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[data-renderer-backend="webgpu"]');
    const bounds = canvas?.getBoundingClientRect();
    return typeof window.__rippleDebugDump === "function" && window.__rippleBenchmark === undefined &&
      canvas instanceof HTMLCanvasElement &&
      canvas.width > 0 && canvas.height > 0 && bounds && bounds.width > 0 && bounds.height > 0;
  }, undefined, { timeout: 45_000 });
  if (await page.locator(".webgpu-fatal").count() > 0) {
    throw new Error("Forced WebGPU entered its fatal unavailable surface during stock acceptance.");
  }
  const canvases = page.locator("canvas");
  if (await canvases.count() !== 1) {
    throw new Error(`Stock acceptance expected one renderer canvas, found ${await canvases.count()}.`);
  }
  return canvases.first();
}

async function waitForStockEvidence(page, descriptor) {
  await page.waitForFunction(({ mode, qualityId }) => {
    const entries = window.__rippleDebugDump?.() ?? [];
    return entries.some((entry) =>
      entry.channel === "webgpu.ready" && entry.payload?.timestampQueryEnabled === false
    ) && entries.some((entry) =>
      entry.channel === "renderer.mode" && entry.payload?.activeBackend === "webgpu" &&
      entry.payload?.playMode === mode
    ) && entries.some((entry) =>
      entry.channel === "renderer.frameSample" && entry.payload?.backendId === "webgpu" &&
      entry.payload?.playMode === mode && entry.payload?.quality === qualityId &&
      entry.payload?.deviceLost === false
    );
  }, { mode: descriptor.mode, qualityId: descriptor.qualityId }, { timeout: 20_000 });
}

async function readStockEvidence(page) {
  return page.evaluate(() => ({
    instrumented: window.__rippleBenchmark !== undefined,
    entries: window.__rippleDebugDump?.() ?? []
  }));
}

function assertStockEvidence(evidence, descriptor, label) {
  if (evidence.instrumented) throw new Error(`${label} unexpectedly enabled benchmark instrumentation.`);
  const ready = evidence.entries.find((entry) => entry.channel === "webgpu.ready");
  if (!ready || ready.payload?.timestampQueryEnabled !== false || !ready.payload?.adapter) {
    throw new Error(`${label} did not expose an uninstrumented selected WebGPU adapter.`);
  }
  const mode = evidence.entries.find((entry) =>
    entry.channel === "renderer.mode" && entry.payload?.activeBackend === "webgpu" &&
    entry.payload?.playMode === descriptor.mode
  );
  if (!mode) throw new Error(`${label} did not confirm forced WebGPU ${descriptor.mode} mode.`);
  const frameSamples = evidence.entries.filter((entry) => entry.channel === "renderer.frameSample");
  if (frameSamples.length === 0 || frameSamples.some((entry) =>
    entry.payload?.backendId !== "webgpu" || entry.payload?.playMode !== descriptor.mode ||
    entry.payload?.quality !== descriptor.qualityId || entry.payload?.deviceLost !== false
  )) {
    throw new Error(`${label} observed fallback, device loss, or unexpected mode/quality diagnostics.`);
  }
  assertNoCriticalDiagnostics(evidence, label);
  return { ready, frameSamples };
}

async function monitorStockSoakFrames(page, descriptor, startupHealth, requiredDurationMs) {
  const startupFrame = startupHealth.frameSamples.at(-1);
  if (!startupFrame) throw new Error("Stock soak cannot monitor continuity without a startup frame sample.");
  const startedAtMs = Date.now();
  let lastFrameIndex = startupFrame.index;
  let lastFramePageMs = startupFrame.pageMs;
  let lastFrameObservedAtMs = startedAtMs;
  let observedFrameCount = 0;
  let maximumFrameGapMs = 0;

  while (Date.now() - startedAtMs < requiredDurationMs) {
    const remainingMs = requiredDurationMs - (Date.now() - startedAtMs);
    await delay(Math.min(SOAK_POLL_INTERVAL_MS, Math.max(1, remainingMs)));
    const evidence = await readStockEvidence(page);
    if (evidence.instrumented) throw new Error("stock soak unexpectedly enabled benchmark instrumentation.");
    assertNoCriticalDiagnostics(evidence, "stock soak continuity");
    const frameSamples = evidence.entries
      .filter((entry) => entry.channel === "renderer.frameSample")
      .filter((entry) => entry.payload?.backendId === "webgpu" &&
        entry.payload?.playMode === descriptor.mode &&
        entry.payload?.quality === descriptor.qualityId &&
        entry.payload?.deviceLost === false &&
        Number.isFinite(entry.index) && Number.isFinite(entry.pageMs) &&
        entry.index > lastFrameIndex)
      .sort((left, right) => left.index - right.index);

    for (const frame of frameSamples) {
      if (frame.pageMs <= lastFramePageMs) {
        throw new Error("stock soak frame timestamps stopped increasing.");
      }
      maximumFrameGapMs = Math.max(maximumFrameGapMs, frame.pageMs - lastFramePageMs);
      lastFrameIndex = frame.index;
      lastFramePageMs = frame.pageMs;
      lastFrameObservedAtMs = Date.now();
      observedFrameCount += 1;
    }

    const wallGapMs = Date.now() - lastFrameObservedAtMs;
    if (wallGapMs > SOAK_MAX_FRAME_GAP_MS || maximumFrameGapMs > SOAK_MAX_FRAME_GAP_MS) {
      throw new Error(
        `stock soak observed a renderer frame-sample gap above ${SOAK_MAX_FRAME_GAP_MS} ms; ` +
        `wall gap=${round(wallGapMs)} ms, page gap=${round(maximumFrameGapMs)} ms.`
      );
    }
  }

  return {
    pollIntervalMs: SOAK_POLL_INTERVAL_MS,
    maximumAllowedFrameGapMs: SOAK_MAX_FRAME_GAP_MS,
    maximumObservedFrameGapMs: round(maximumFrameGapMs),
    observedFrameCount,
    finalFrameIndex: lastFrameIndex,
    finalFramePageMs: round(lastFramePageMs)
  };
}

function assertStockContinuationEvidence(
  evidence,
  descriptor,
  startupHealth,
  label,
  requiredContinuationMs,
  frameContinuity
) {
  if (evidence.instrumented) throw new Error(`${label} unexpectedly enabled benchmark instrumentation.`);
  const frameSamples = evidence.entries.filter((entry) => entry.channel === "renderer.frameSample");
  if (frameSamples.length === 0 || frameSamples.some((entry) =>
    entry.payload?.backendId !== "webgpu" || entry.payload?.playMode !== descriptor.mode ||
    entry.payload?.quality !== descriptor.qualityId || entry.payload?.deviceLost !== false
  )) {
    throw new Error(`${label} stopped producing healthy WebGPU frame samples.`);
  }
  const startupFrame = startupHealth.frameSamples.at(-1);
  const finalFrame = frameSamples.at(-1);
  const continuationMs = (finalFrame?.pageMs ?? 0) - (startupFrame?.pageMs ?? 0);
  const continuationToleranceMs = Math.min(500, requiredContinuationMs * 0.01);
  if (!startupFrame || !finalFrame || finalFrame.index <= startupFrame.index ||
    continuationMs < requiredContinuationMs - continuationToleranceMs) {
    throw new Error(
      `${label} did not produce a newer frame sample near the end of the soak; ` +
      `observed continuation=${round(continuationMs)} ms.`
    );
  }
  if (!frameContinuity || frameContinuity.observedFrameCount === 0 ||
    frameContinuity.maximumObservedFrameGapMs > frameContinuity.maximumAllowedFrameGapMs) {
    throw new Error(`${label} did not preserve bounded frame continuity through the full soak.`);
  }
  assertNoCriticalDiagnostics(evidence, label);
  return { ready: startupHealth.ready, frameSamples };
}

function assertNoCriticalDiagnostics(evidence, label) {
  const criticalChannels = new Set([
    "webgpu.deviceLost",
    "webgpu.uncapturedError",
    "webgpu.fallback",
    "webgpu.unavailable"
  ]);
  const critical = evidence.entries.filter((entry) =>
    entry.level === "error" || criticalChannels.has(entry.channel)
  );
  if (critical.length > 0) {
    throw new Error(`${label} emitted critical diagnostics: ${critical.map((entry) => entry.channel).join(", ")}.`);
  }
}

function collectPageProblems(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const crashes = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("crash", () => crashes.push("Renderer process crashed."));
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  return {
    count: () => consoleErrors.length + pageErrors.length + crashes.length + requestFailures.length,
    assertNone(label) {
      const all = [...consoleErrors, ...pageErrors, ...crashes, ...requestFailures];
      if (all.length > 0) throw new Error(`${label} emitted browser problems:\n${all.join("\n")}`);
    }
  };
}

function createVisualCheck(id, outputDirectory, capturePath, png) {
  const metrics = analyzeCanvasPng(png);
  const evaluation = evaluateVisualBounds(metrics);
  return {
    id,
    path: toPortableRelativePath(outputDirectory, capturePath),
    passed: evaluation.passed,
    reasons: evaluation.reasons,
    metrics
  };
}

function analyzeAnimation(firstBuffer, secondBuffer) {
  const first = PNG.sync.read(firstBuffer);
  const second = PNG.sync.read(secondBuffer);
  if (first.width !== second.width || first.height !== second.height) {
    return { passed: false, changedRatio: 0, averageDiff: 0 };
  }
  let changedPixels = 0;
  let diffTotal = 0;
  const totalPixels = Math.max(1, first.width * first.height);
  for (let index = 0; index < first.data.length; index += 4) {
    const diff = Math.abs(first.data[index] - second.data[index]) +
      Math.abs(first.data[index + 1] - second.data[index + 1]) +
      Math.abs(first.data[index + 2] - second.data[index + 2]);
    if (diff > 3) changedPixels += 1;
    diffTotal += diff / 3;
  }
  const changedRatio = round(changedPixels / totalPixels);
  const averageDiff = round(diffTotal / totalPixels);
  return { passed: changedRatio > 0.02 && averageDiff > 1, changedRatio, averageDiff };
}

function normalizeAdapter(value) {
  if (typeof value === "string" && value.length > 0) return { description: value };
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    ["vendor", "architecture", "device", "description"]
      .filter((key) => typeof value[key] === "string" && value[key].length > 0)
      .map((key) => [key, value[key]])
  );
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
