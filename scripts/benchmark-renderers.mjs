import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { delay, isOk, waitForOk } from "./ripple-smoke-harness.mjs";
import {
  buildBenchmarkSummary,
  compareBenchmarkBaseline,
  compareSemanticParity,
  normalizeBenchmarkSnapshot,
  renderSummaryMarkdown
} from "./benchmark-reporting.mjs";

const DEFAULT_APP_URL = "http://127.0.0.1:4183/";
const FIXED_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const FIXED_DEVICE_SCALE_FACTOR = 1;
const SCENARIOS = Object.freeze([
  "pretty-arena",
  "showoff-track-motion",
  "meltdown-ramp"
]);
const BENCHMARK_SEED = 1_337;
const MELTDOWN_TIERS = Object.freeze([0, 1, 2, 3, 4]);
// Keep each ramp tier as its own paired case so both renderers see the same field load.
const BENCHMARK_CASES = Object.freeze([
  Object.freeze({ id: "pretty-arena", label: "pretty-arena", scenario: "pretty-arena", tier: 0 }),
  Object.freeze({
    id: "showoff-track-motion",
    label: "showoff-track-motion",
    scenario: "showoff-track-motion",
    tier: 0
  }),
  ...MELTDOWN_TIERS.map((tier) => Object.freeze({
    id: `meltdown-ramp-tier-${tier}`,
    label: `meltdown-ramp (tier ${tier})`,
    scenario: "meltdown-ramp",
    tier
  }))
]);
const BACKENDS = Object.freeze(["webgl", "webgpu"]);
const SCENARIO_MODES = Object.freeze({
  "pretty-arena": "arena",
  "showoff-track-motion": "track",
  "meltdown-ramp": "arena"
});
const DEFAULT_WARMUP_MS = 5_000;
const DEFAULT_SAMPLE_MS = 15_000;
const DEFAULT_REPETITIONS = 4;
const DEFAULT_API_TIMEOUT_MS = 45_000;
const BENCHMARK_BROWSER_ARGS = Object.freeze([
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding"
]);

try {
  await main();
} catch (error) {
  console.error(`[ripple-field-lab:benchmark] ${formatError(error)}`);
  process.exitCode = 1;
}

async function main() {
  const config = readConfig();
  const benchmarkCases = selectBenchmarkCases(config.caseFilter);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = createRunId(startedAt);
  const outputDirectory = await createOutputDirectory(config.outputRoot, runId);
  const samplesPath = path.join(outputDirectory, "samples.ndjson");
  const samples = [];
  const parityChecks = [];
  const run = {
    runId,
    startedAt,
    config: {
      appUrl: redactUrl(config.appUrl),
      appUrlSource: config.appUrlSource,
      viewport: FIXED_VIEWPORT,
      deviceScaleFactor: FIXED_DEVICE_SCALE_FACTOR,
      scenarios: [...SCENARIOS],
      cases: benchmarkCases.map((benchmarkCase) => ({ ...benchmarkCase })),
      backends: [...BACKENDS],
      seed: BENCHMARK_SEED,
      warmupMs: config.warmupMs,
      sampleMs: config.sampleMs,
      repetitions: config.repetitions,
      schedule: Array.from({ length: config.repetitions }, (_, repetition) => ({
        repetition,
        rendererOrder: repetition % 2 === 0 ? [...BACKENDS] : [...BACKENDS].reverse(),
        caseOrder: getBenchmarkCaseOrder(benchmarkCases, repetition).map((item) => item.id)
      })),
      apiTimeoutMs: config.apiTimeoutMs,
      headless: config.headless,
      browserArgs: [...BENCHMARK_BROWSER_ARGS],
      baselinePath: config.baselinePath
    },
    expectedPairCount: benchmarkCases.length * config.repetitions,
    expectedSampleCount: benchmarkCases.length * config.repetitions * BACKENDS.length,
    metadata: {
      host: collectHostMetadata(),
      git: collectGitMetadata(),
      package: await collectPackageMetadata(),
      browser: null,
      runtime: null,
      renderers: {}
    }
  };

  await writeFile(samplesPath, "", "utf8");
  printConfiguration(run, outputDirectory);

  let browser;
  let context;
  let serverScope;
  let failure = null;

  try {
    serverScope = await ensureBenchmarkApp(config);
    const launch = await launchBrowser(config);
    browser = launch.browser;
    run.metadata.browser = {
      name: "Chromium",
      version: browser.version(),
      channel: launch.channel,
      headless: config.headless
    };

    context = await browser.newContext({
      viewport: FIXED_VIEWPORT,
      deviceScaleFactor: FIXED_DEVICE_SCALE_FACTOR
    });
    const displayRefreshIntervalMs = await measureDisplayRefreshInterval(context);
    run.metadata.browser.displayRefreshIntervalMs = displayRefreshIntervalMs;

    let sequence = 0;
    for (let repetition = 0; repetition < config.repetitions; repetition += 1) {
      const caseOrder = getBenchmarkCaseOrder(benchmarkCases, repetition);
      for (const benchmarkCase of caseOrder) {
        const rendererOrder = repetition % 2 === 0 ? BACKENDS : [...BACKENDS].reverse();
        const pair = {};

        console.log(
          `[ripple-field-lab:benchmark] ${benchmarkCase.label} ` +
          `repetition ${repetition + 1}/${config.repetitions}: ` +
          rendererOrder.join(" -> ")
        );

        for (let orderInRepetition = 0; orderInRepetition < rendererOrder.length; orderInRepetition += 1) {
          const renderer = rendererOrder[orderInRepetition];
          const sample = await runBackendSample({
            context,
            config,
            runId,
            benchmarkCase,
            renderer,
            repetition,
            orderInRepetition,
            sequence,
            displayRefreshIntervalMs
          });

          sequence += 1;
          pair[renderer] = sample;
          if (!run.metadata.runtime && sample.runtimeMetadata) {
            run.metadata.runtime = sample.runtimeMetadata;
          }
          if (!run.metadata.renderers[renderer]) {
            run.metadata.renderers[renderer] = sample.appMetadata;
          }
          delete sample.runtimeMetadata;
          samples.push(sample);
          // Preserve completed evidence even when the paired semantic check fails next.
          await appendFile(samplesPath, `${JSON.stringify(sample)}\n`, "utf8");

          console.log(
            `[ripple-field-lab:benchmark] captured ${benchmarkCase.id}/${renderer} ` +
            `repetition ${repetition + 1} (${Object.keys(sample.metricValues).length} metrics)`
          );
        }

        const parity = compareSemanticParity(pair.webgl, pair.webgpu);
        parityChecks.push(parity);
        if (!parity.passed) {
          const details = parity.differences
            .map((difference) =>
              `${difference.path}: webgl=${JSON.stringify(difference.webgl)}, ` +
              `webgpu=${JSON.stringify(difference.webgpu)}`
            )
            .join("; ");
          throw new Error(
            `Semantic parity failed for ${benchmarkCase.label}, ` +
            `repetition ${repetition + 1}: ${details}`
          );
        }
    }
    }
  } catch (error) {
    failure = serializeError(error);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    serverScope?.shutdown();
  }

  const finishedAtMs = Date.now();
  run.finishedAt = new Date(finishedAtMs).toISOString();
  run.durationMs = finishedAtMs - startedAtMs;

  const summary = buildBenchmarkSummary({ run, samples, parityChecks, failure });
  if (config.baselinePath) {
    const baseline = JSON.parse(await readFile(config.baselinePath, "utf8"));
    summary.regression = compareBenchmarkBaseline(summary, baseline);
    if (summary.regression.status === "failed" && !failure) {
      failure = {
        name: "BenchmarkRegressionError",
        message: "Same-hardware benchmark regression exceeded the configured 20% or stable-tier limit.",
        stack: null
      };
      summary.status = "failed";
      summary.failure = failure;
    }
  }
  await writeArtifacts(outputDirectory, summary);

  if (failure) {
    throw new Error(
      `${failure.message}\nBenchmark artifacts were written to ${outputDirectory}`,
      failure.stack ? { cause: new Error(failure.stack) } : undefined
    );
  }

  console.log(`[ripple-field-lab:benchmark] PASS - artifacts written to ${outputDirectory}`);
}

function getBenchmarkCaseOrder(cases, repetition) {
  if (cases.length <= 1) return [...cases];
  const rotation = Math.floor(repetition / 2) % cases.length;
  const rotated = [...cases.slice(rotation), ...cases.slice(0, rotation)];
  return repetition % 2 === 0 ? rotated : rotated.reverse();
}

async function ensureBenchmarkApp(config) {
  if (await isOk(config.appUrl)) return { shutdown() {} };
  if (config.appUrlSource !== "default-preview") {
    throw new Error(
      `Benchmark app is unavailable at ${config.appUrl}. Start the configured production server first.`
    );
  }

  const npmRunner = resolveNpmRunner();
  const child = spawn(npmRunner.command, [...npmRunner.args, "run", "preview"], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[ripple-field-lab:preview] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[ripple-field-lab:preview] ${chunk}`));

  try {
    await waitForOk(config.appUrl, "benchmark preview app");
  } catch (error) {
    killProcessTree(child.pid);
    throw error;
  }

  return { shutdown: () => killProcessTree(child.pid) };
}

function resolveNpmRunner() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath?.endsWith(".js")) {
    return { command: process.execPath, args: [npmExecPath] };
  }
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd"] };
  }
  return { command: "npm", args: [] };
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Preview may already have exited after an earlier benchmark failure.
  }
}

async function runBackendSample(options) {
  const page = await options.context.newPage();
  const pageProblems = collectPageProblems(page);
  const pageUrl = createScenarioUrl(options);
  const label = `${options.benchmarkCase.id}/${options.renderer}/repetition-${options.repetition + 1}`;

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: options.config.apiTimeoutMs });
    const api = await waitForBenchmarkApi(page, pageUrl, options.config.apiTimeoutMs);
    assertBenchmarkApiConfig(api, options.benchmarkCase);
    await page.locator(`canvas[data-renderer-backend="${options.renderer}"]`).waitFor({
      state: "visible",
      timeout: options.config.apiTimeoutMs
    });
    await page.locator("#hud:not([hidden])").waitFor({ timeout: options.config.apiTimeoutMs });
    await delay(250);
    await installDeterministicWorkload(
      page,
      options.benchmarkCase.scenario,
      BENCHMARK_SEED,
      options.displayRefreshIntervalMs
    );
    const startedAt = performance.now();
    const snapshot = await invokeBenchmarkApi(page, options.config);
    const elapsedMs = performance.now() - startedAt;
    pageProblems.assertNoProblems(`Benchmark sample ${label}`);

    const normalized = normalizeBenchmarkSnapshot(snapshot, {
      label: `window.__rippleBenchmark for ${label}`,
      runId: options.runId,
      sequence: options.sequence,
      capturedAt: new Date().toISOString(),
      caseId: options.benchmarkCase.id,
      scenario: options.benchmarkCase.scenario,
      tier: options.benchmarkCase.tier,
      seed: BENCHMARK_SEED,
      renderer: options.renderer,
      repetition: options.repetition,
      orderInRepetition: options.orderInRepetition,
      warmupMs: options.config.warmupMs,
      sampleMs: options.config.sampleMs,
      elapsedMs: round(elapsedMs),
      pageUrl: redactUrl(pageUrl),
      api,
      viewport: FIXED_VIEWPORT,
      deviceScaleFactor: FIXED_DEVICE_SCALE_FACTOR
    });

    normalized.runtimeMetadata = options.sequence === 0
      ? await collectRuntimeMetadata(page)
      : null;
    normalized.pageProblems = pageProblems.snapshot();
    return normalized;
  } catch (error) {
    throw new Error(`Benchmark sample ${label} failed: ${formatError(error)}`, { cause: error });
  } finally {
    await page.close().catch(() => {});
  }
}

async function installDeterministicWorkload(page, scenario, seed, displayRefreshIntervalMs) {
  await page.evaluate(({ scenarioId, workloadSeed, refreshIntervalMs }) => {
    let randomState = workloadSeed >>> 0;
    Math.random = () => {
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    window.__rippleBenchmark.setMetadata({
      displayRefreshIntervalMs: refreshIntervalMs,
      workloadSeed
    });
    // Pulses are scheduled in-page so Playwright IPC does not contaminate the
    // measured CPU phases. The seed controls a stable phase offset per run.
    const pulsePeriodMs = scenarioId === "meltdown-ramp" ? 900 : 1_250;
    const firstPulseDelayMs = 250 + (workloadSeed % 200);
    let pulseIntervalId = 0;
    const pulseTimeoutId = window.setTimeout(() => {
      document.querySelector("#pulse-button")?.click();
      pulseIntervalId = window.setInterval(() => {
        document.querySelector("#pulse-button")?.click();
      }, pulsePeriodMs);
    }, firstPulseDelayMs);

    window.__rippleBenchmarkWorkloadCleanup = () => {
      window.clearTimeout(pulseTimeoutId);
      if (pulseIntervalId) window.clearInterval(pulseIntervalId);
      delete window.__rippleBenchmarkWorkloadCleanup;
    };
  }, { scenarioId: scenario, workloadSeed: seed, refreshIntervalMs: displayRefreshIntervalMs });
}

async function measureDisplayRefreshInterval(context) {
  const page = await context.newPage();
  try {
    await page.goto("about:blank");
    const intervals = await page.evaluate(() => new Promise((resolve, reject) => {
      const samples = [];
      let previous = null;
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Timed out while measuring blank-page display refresh."));
      }, 10_000);
      const collect = (timestamp) => {
        if (previous !== null) samples.push(timestamp - previous);
        previous = timestamp;
        if (samples.length >= 180) {
          window.clearTimeout(timeoutId);
          resolve(samples);
        }
        else requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    }));
    const stable = intervals
      .filter((value) => Number.isFinite(value) && value > 0 && value < 100)
      .sort((left, right) => left - right);
    if (stable.length < 60) throw new Error("Could not collect a stable blank-page refresh sample.");
    return round(stable[Math.ceil(stable.length * 0.5) - 1]);
  } finally {
    await page.close();
  }
}

async function waitForBenchmarkApi(page, pageUrl, timeoutMs) {
  try {
    await page.waitForFunction(
      () => window.__rippleBenchmark !== undefined && window.__rippleBenchmark !== null,
      undefined,
      { timeout: timeoutMs }
    );
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      href: window.location.href,
      readyState: document.readyState,
      title: document.title
    })).catch(() => ({ href: pageUrl, readyState: "unavailable", title: "unavailable" }));

    throw new Error(
      `Benchmark API absent after ${timeoutMs} ms at ${pageState.href}. ` +
      "Expected window.__rippleBenchmark from the built app. " +
      `Page state: ${pageState.readyState}; title: ${JSON.stringify(pageState.title)}. ` +
      "Build the benchmark-enabled app and point RIPPLE_BENCHMARK_APP_URL at its preview URL.",
      { cause: error }
    );
  }

  const descriptor = await page.evaluate(() => {
    const api = window.__rippleBenchmark;
    const keys = new Set(Reflect.ownKeys(api).filter((key) => typeof key === "string"));
    let prototype = Object.getPrototypeOf(api);
    if (prototype && prototype !== Object.prototype) {
      for (const key of Reflect.ownKeys(prototype)) {
        if (typeof key === "string" && key !== "constructor") keys.add(key);
      }
    }

    const methods = [...keys].filter((key) => typeof api[key] === "function").sort();
    return {
      version: api.version ?? api.schemaVersion ?? null,
      config: api.config ?? null,
      keys: [...keys].sort(),
      methods
    };
  });

  const requiredMethods = ["reset", "beginPhase", "stop", "getSnapshot", "getSamples"];
  const missingMethods = requiredMethods.filter((name) => !descriptor.methods.includes(name));
  if (descriptor.version === 1 && missingMethods.length === 0) return descriptor;

  throw new Error(
    "window.__rippleBenchmark is present but does not implement the version 1 lifecycle. " +
    `Observed version: ${JSON.stringify(descriptor.version)}. ` +
    `Missing methods: ${missingMethods.length > 0 ? missingMethods.join(", ") : "<none>"}. ` +
    `Observed keys: ${descriptor.keys.length > 0 ? descriptor.keys.join(", ") : "<none>"}.`
  );
}

async function invokeBenchmarkApi(page, config) {
  await page.evaluate(() => {
    const api = window.__rippleBenchmark;
    api.reset();
    api.beginPhase("warmup");
  });

  // The API is installed before renderer startup; begin the timed warmup after its first frame.
  try {
    await page.waitForFunction(
      () => window.__rippleBenchmark.getSamples().length > 0,
      undefined,
      { timeout: config.apiTimeoutMs }
    );
  } catch (error) {
    const snapshot = await page.evaluate(() => window.__rippleBenchmark.getSnapshot())
      .catch(() => null);
    throw new Error(
      `Benchmark API was present but captured no warmup frames within ${config.apiTimeoutMs} ms. ` +
      `Observed phase: ${JSON.stringify(snapshot?.phase ?? "unavailable")}; ` +
      `samples: ${snapshot?.samples?.length ?? "unavailable"}.`,
      { cause: error }
    );
  }
  if (config.warmupMs > 0) await delay(config.warmupMs);

  await page.evaluate(() => {
    const api = window.__rippleBenchmark;
    const intervals = api.getSamples()
      .map((sample) => sample.rafIntervalMs)
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    const midpoint = Math.max(0, Math.ceil(intervals.length * 0.5) - 1);
    api.setMetadata({
      observedWarmupFrameIntervalMs: intervals[midpoint] ?? null,
      warmupFrameCount: api.getSamples().length
    });
    api.beginPhase("sample");
  });
  await delay(config.sampleMs);
  return page.evaluate(() => window.__rippleBenchmark.stop());
}

function assertBenchmarkApiConfig(api, benchmarkCase) {
  const expected = {
    enabled: true,
    scenario: benchmarkCase.scenario,
    tier: benchmarkCase.tier,
    seed: BENCHMARK_SEED
  };

  for (const [key, value] of Object.entries(expected)) {
    if (api.config?.[key] !== value) {
      throw new Error(
        `window.__rippleBenchmark.config.${key} was ${JSON.stringify(api.config?.[key])}; ` +
        `expected ${JSON.stringify(value)}. Check the benchmark query contract and preview build.`
      );
    }
  }
}

function createScenarioUrl(options) {
  const url = new URL(options.config.appUrl);
  url.searchParams.set("debug", "0");
  url.searchParams.set("logServer", "0");
  url.searchParams.set("renderer", options.renderer);
  url.searchParams.set("mode", SCENARIO_MODES[options.benchmarkCase.scenario]);
  url.searchParams.set("benchmark", "1");
  url.searchParams.set("benchmarkScenario", options.benchmarkCase.scenario);
  url.searchParams.set("benchmarkTier", String(options.benchmarkCase.tier));
  url.searchParams.set("benchmarkSeed", String(BENCHMARK_SEED));
  url.searchParams.set("stress", "1");
  url.searchParams.set("benchmarkRun", options.runId);
  url.searchParams.set("benchmarkRepetition", String(options.repetition));
  return url.toString();
}

function collectPageProblems(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const crashes = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("crash", () => crashes.push("Renderer process crashed."));

  return {
    assertNoProblems(label) {
      const problems = [...pageErrors, ...crashes, ...consoleErrors];
      if (problems.length > 0) {
        throw new Error(`${label} emitted browser errors:\n${problems.join("\n")}`);
      }
    },
    snapshot() {
      return { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors], crashes: [...crashes] };
    }
  };
}

async function launchBrowser(config) {
  const launchOptions = {
    headless: config.headless,
    args: [...BENCHMARK_BROWSER_ARGS]
  };

  const requestedChannel = process.env.RIPPLE_CHROME_CHANNEL ||
    (process.platform === "win32" ? "chrome" : null);
  if (requestedChannel) launchOptions.channel = requestedChannel;

  try {
    return {
      browser: await chromium.launch(launchOptions),
      channel: requestedChannel ?? "bundled"
    };
  } catch (error) {
    if (process.env.RIPPLE_CHROME_CHANNEL || !requestedChannel) throw error;
    console.warn(
      `[ripple-field-lab:benchmark] Chrome channel unavailable (${formatError(error)}); ` +
      "falling back to bundled Chromium."
    );
    delete launchOptions.channel;
    return {
      browser: await chromium.launch(launchOptions),
      channel: "bundled"
    };
  }
}

async function collectRuntimeMetadata(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const webgl = gl ? {
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION)
    } : null;

    let webgpu = null;
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const info = adapter.info ?? {};
          webgpu = {
            vendor: info.vendor || null,
            architecture: info.architecture || null,
            device: info.device || null,
            description: info.description || null,
            features: [...adapter.features].sort(),
            limits: {
              maxBufferSize: adapter.limits.maxBufferSize,
              maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
              maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
              maxTextureDimension2D: adapter.limits.maxTextureDimension2D
            }
          };
        }
      } catch (error) {
        webgpu = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      crossOriginIsolated: window.crossOriginIsolated,
      webgl,
      webgpu
    };
  });
}

function collectHostMetadata() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    nodeVersion: process.version,
    powerPlan: collectWindowsPowerPlan(),
    gpuControllers: collectWindowsGpuControllers()
  };
}

function collectWindowsPowerPlan() {
  if (process.platform !== "win32") return null;
  try {
    return execFileSync("powercfg.exe", ["/getactivescheme"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
  } catch {
    return null;
  }
}

function collectWindowsGpuControllers() {
  if (process.platform !== "win32") return null;
  try {
    const command = "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,PNPDeviceID | ConvertTo-Json -Compress";
    const value = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function collectGitMetadata() {
  try {
    const commit = runGit(["rev-parse", "HEAD"]);
    const branch = runGit(["branch", "--show-current"]);
    const status = runGit(["status", "--porcelain"]);
    return {
      commit,
      branch: branch || null,
      dirty: status.length > 0,
      status: status ? status.split(/\r?\n/).filter(Boolean) : []
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

async function collectPackageMetadata() {
  try {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
    return {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      playwrightVersion: packageJson.devDependencies?.playwright ?? null
    };
  } catch (error) {
    return { error: formatError(error) };
  }
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}

function readConfig() {
  const appUrlValue = process.env.RIPPLE_BENCHMARK_APP_URL ||
    process.env.RIPPLE_APP_URL ||
    DEFAULT_APP_URL;
  const appUrlSource = process.env.RIPPLE_BENCHMARK_APP_URL
    ? "RIPPLE_BENCHMARK_APP_URL"
    : process.env.RIPPLE_APP_URL
      ? "RIPPLE_APP_URL"
      : "default-preview";
  const appUrl = validateAppUrl(appUrlValue);

  return {
    appUrl,
    appUrlSource,
    warmupMs: readIntegerEnv("RIPPLE_BENCHMARK_WARMUP_MS", DEFAULT_WARMUP_MS, 0, 600_000),
    sampleMs: readIntegerEnv("RIPPLE_BENCHMARK_SAMPLE_MS", DEFAULT_SAMPLE_MS, 100, 600_000),
    repetitions: readIntegerEnv(
      "RIPPLE_BENCHMARK_REPETITIONS",
      DEFAULT_REPETITIONS,
      1,
      50
    ),
    apiTimeoutMs: readIntegerEnv(
      "RIPPLE_BENCHMARK_API_TIMEOUT_MS",
      DEFAULT_API_TIMEOUT_MS,
      1_000,
      300_000
    ),
    outputRoot: path.resolve(
      process.cwd(),
      process.env.RIPPLE_BENCHMARK_OUTPUT_DIR || "benchmark-results"
    ),
    headless: process.env.RIPPLE_BROWSER_HEADLESS !== "0",
    caseFilter: process.env.RIPPLE_BENCHMARK_CASES?.trim() || "",
    baselinePath: process.env.RIPPLE_BENCHMARK_BASELINE
      ? path.resolve(process.cwd(), process.env.RIPPLE_BENCHMARK_BASELINE)
      : null
  };
}

function selectBenchmarkCases(caseFilter) {
  if (!caseFilter) return BENCHMARK_CASES;
  const requested = new Set(caseFilter.split(",").map((value) => value.trim()).filter(Boolean));
  const selected = BENCHMARK_CASES.filter((benchmarkCase) =>
    requested.has(benchmarkCase.id) || requested.has(benchmarkCase.scenario)
  );
  if (selected.length === 0) {
    throw new Error(
      `RIPPLE_BENCHMARK_CASES matched no cases. Available: ${BENCHMARK_CASES.map((item) => item.id).join(", ")}`
    );
  }
  return selected;
}

function validateAppUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid benchmark app URL ${JSON.stringify(value)}.`, { cause: error });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Benchmark app URL must use http or https, received ${url.protocol}`);
  }
  url.hash = "";
  return url.toString();
}

function readIntegerEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}; received ${raw}.`);
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}; received ${raw}.`);
  }
  return value;
}

async function createOutputDirectory(outputRoot, runId) {
  await mkdir(outputRoot, { recursive: true });

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const directoryName = suffix === 0 ? runId : `${runId}-${suffix}`;
    const outputDirectory = path.join(outputRoot, directoryName);
    try {
      await mkdir(outputDirectory);
      return outputDirectory;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  throw new Error(`Could not allocate a unique benchmark output directory under ${outputRoot}.`);
}

async function writeArtifacts(outputDirectory, summary) {
  await writeAtomic(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  await writeAtomic(
    path.join(outputDirectory, "summary.md"),
    renderSummaryMarkdown(summary)
  );
}

async function writeAtomic(targetPath, contents) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, targetPath);
}

function createRunId(timestamp) {
  return `${timestamp.replaceAll(":", "-").replace(".", "-")}-pid-${process.pid}`;
}

function printConfiguration(run, outputDirectory) {
  console.log(
    `[ripple-field-lab:benchmark] app=${run.config.appUrl} ` +
    `viewport=${FIXED_VIEWPORT.width}x${FIXED_VIEWPORT.height}@${FIXED_DEVICE_SCALE_FACTOR} ` +
    `warmup=${run.config.warmupMs}ms sample=${run.config.sampleMs}ms ` +
    `repetitions=${run.config.repetitions}`
  );
  console.log(`[ripple-field-lab:benchmark] output=${outputDirectory}`);
}

function serializeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? null };
  }
  return { name: "Error", message: String(error), stack: null };
}

function redactUrl(value) {
  const url = new URL(value);
  if (url.username) url.username = "<redacted>";
  if (url.password) url.password = "<redacted>";
  return url.toString();
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
