import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { delay } from "./ripple-smoke-harness.mjs";
import {
  createPackageRunId,
  createPortableManifest,
  createUniqueRunDirectory,
  getBenchmarkPackageProfile,
  REQUIRED_PORTABLE_BUNDLE_PATHS,
  serializePortableError,
  verifyPortableManifest,
  writeJsonAtomic,
  writeTextAtomic
} from "./benchmark-package.mjs";
import { runRendererBenchmark } from "./benchmark-renderers.mjs";
import {
  buildBenchmarkAcceptance,
  createBenchmarkBaseline,
  RENDERER_BENCHMARK_PROTOCOL_VERSION,
  RENDERER_BENCHMARK_SCHEMA_VERSION,
  RENDERER_BENCHMARK_WORKLOAD_VERSION,
  renderSummaryMarkdown
} from "./benchmark-reporting.mjs";
import { runStockWebGpuAcceptance } from "./benchmark-stock-acceptance.mjs";

const PREVIEW_HOST = "127.0.0.1";
const PREVIEW_PORT = 4183;
const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}/`;

if (isDirectExecution()) {
  try {
    const result = await packageRendererBenchmark();
    console.log(
      `[ripple-field-lab:benchmark:package] ${result.acceptance.decisionGrade ? "PASS" : "TEST PASS"} - ` +
      `portable bundle written to ${result.outputDirectory}`
    );
  } catch (error) {
    console.error(`[ripple-field-lab:benchmark:package] ${formatError(error)}`);
    process.exitCode = 1;
  }
}

export async function packageRendererBenchmark() {
  const initialGitState = assertCleanGitTree();
  const profile = getBenchmarkPackageProfile();
  const browserChannel = process.env.RIPPLE_CHROME_CHANNEL?.trim() || "chrome";
  if (browserChannel !== "chrome") {
    throw new Error(
      `Decision-grade packaging requires the stable Chrome channel "chrome"; received ${JSON.stringify(browserChannel)}.`
    );
  }
  const headless = process.env.RIPPLE_BROWSER_HEADLESS !== "0";
  const outputRoot = path.resolve(
    process.cwd(),
    process.env.RIPPLE_BENCHMARK_OUTPUT_DIR || "benchmark-results"
  );
  const runId = createPackageRunId();
  const outputDirectory = await createUniqueRunDirectory(outputRoot, runId);
  const comparisonBaseline = await copyComparisonBaseline(outputDirectory);
  const lifecycle = createPackageLifecycle();
  const removeInterruptHandlers = installInterruptCleanup(lifecycle);
  let stock = null;
  let stockFailure = null;
  let benchmarkFailure = null;
  let runFailure = null;
  let summary = null;
  let cleanupResult;
  try {
    console.log(
      `[ripple-field-lab:benchmark:package] profile=${profile.id} ` +
      `channel=${browserChannel} source=${initialGitState.commit.slice(0, 12)} output=${outputDirectory}`
    );
    const sourceWorktree = await createDetachedSourceWorktree(initialGitState.commit);
    lifecycle.setSourceWorktree(sourceWorktree);
    runNpmCi(sourceWorktree.directory);
    runNpmScript("build", sourceWorktree.directory);
    const expectedIndexHtml = await readFile(
      path.join(sourceWorktree.directory, "dist", "index.html"),
      "utf8"
    );
    await assertPortAvailable(PREVIEW_HOST, PREVIEW_PORT);
    const preview = await startOwnedPreview(
      expectedIndexHtml,
      sourceWorktree.directory,
      (ownedPreview) => lifecycle.setPreview(ownedPreview)
    );

    try {
      stock = await runStockWebGpuAcceptance({
        appUrl: PREVIEW_URL,
        browserChannel,
        headless,
        outputDirectory,
        profile,
        registerOwnedBrowser: (browser) => lifecycle.registerBrowser(browser)
      });
    } catch (error) {
      stockFailure = error;
      stock = createFailedStockEvidence(error, browserChannel, headless, profile);
    }
    await preview.assertHealthy();

    let benchmarkResult;
    try {
      benchmarkResult = await runRendererBenchmark({
        runId,
        outputDirectory,
        appUrl: PREVIEW_URL,
        appUrlSource: "package-owned-strict-preview",
        browserChannel,
        headless,
        warmupMs: profile.benchmarkWarmupMs,
        sampleMs: profile.benchmarkSampleMs,
        repetitions: profile.benchmarkRepetitions,
        caseFilter: "",
        profile: profile.id,
        packageMode: true,
        captureFirstRepetition: true,
        baselinePath: comparisonBaseline?.absolutePath ?? null,
        baselineDisplayPath: comparisonBaseline?.relativePath ?? null,
        registerOwnedBrowser: (browser) => lifecycle.registerBrowser(browser)
      });
    } catch (error) {
      if (!error?.summary) throw error;
      benchmarkFailure = error;
      benchmarkResult = { summary: error.summary, outputDirectory: error.outputDirectory };
    }
    summary = benchmarkResult.summary;
    await preview.assertHealthy();
  } catch (error) {
    runFailure = error;
  } finally {
    cleanupResult = await lifecycle.cleanup();
    removeInterruptHandlers();
  }

  if (!summary) {
    throw createCombinedError(
      "Packaged benchmark could not produce an instrumented summary.",
      [runFailure, ...cleanupResult.errors]
    );
  }

  summary.metadata.packageProvenance = {
    sourceCommit: initialGitState.commit,
    sourceBranch: initialGitState.branch,
    dependencyInstall: "npm-ci-from-committed-lockfile"
  };
  const cleanTree = verifyGitTreeUnchanged(initialGitState, summary.metadata?.sourceControl);
  const packageLifecycle = {
    passed: runFailure === null && cleanupResult.passed,
    detail: runFailure === null && cleanupResult.passed
      ? "Strict preview and detached source worktree shut down cleanly before acceptance."
      : sanitizeFailureList([runFailure, ...cleanupResult.errors])
  };
  const acceptance = buildBenchmarkAcceptance({
    summary,
    stock,
    cleanTree,
    packageLifecycle,
    packageProfile: profile.id,
    requiredSoakMs: profile.stockSoakMs
  });
  summary.acceptance = {
    status: acceptance.status,
    decisionGrade: acceptance.decisionGrade,
    packageProfile: acceptance.packageProfile,
    gates: acceptance.gates,
    failedGateIds: acceptance.failedGateIds
  };
  summary.artifacts = {
    ...summary.artifacts,
    manifestJson: "manifest.json",
    acceptanceJson: "acceptance.json",
    baselineJson: "baseline.json",
    comparisonBaselineJson: comparisonBaseline?.relativePath ?? null,
    stockCaptures: stock.visualChecks.map((item) => item.path)
  };
  const baseline = createBenchmarkBaseline(summary, {
    eligible: acceptance.status === "passed",
    acceptanceStatus: acceptance.status
  });

  await writeJsonAtomic(path.join(outputDirectory, "acceptance.json"), acceptance);
  await writeJsonAtomic(path.join(outputDirectory, "baseline.json"), baseline);
  await writeJsonAtomic(path.join(outputDirectory, "summary.json"), summary);
  await writeTextAtomic(path.join(outputDirectory, "summary.md"), renderSummaryMarkdown(summary));

  const manifest = await createPortableManifest(outputDirectory, {
    schemaVersion: summary.schemaVersion,
    protocolVersion: summary.protocolVersion,
    workloadVersion: summary.workloadVersion,
    runId,
    sourceCommit: initialGitState.commit,
    packageProfile: profile.id,
    decisionGrade: acceptance.decisionGrade,
    requiredPaths: REQUIRED_PORTABLE_BUNDLE_PATHS
  });
  await verifyPortableManifest(outputDirectory, manifest);

  const operationalFailures = [stockFailure, benchmarkFailure, runFailure, ...cleanupResult.errors]
    .filter(Boolean);
  if (operationalFailures.length > 0) {
    throw createCombinedError(
      `Packaged benchmark failed after portable evidence was finalized at ${outputDirectory}.`,
      operationalFailures
    );
  }
  if (acceptance.status === "failed") {
    throw new Error(
      `Packaged acceptance failed gates ${acceptance.failedGateIds.join(", ")}; ` +
      `portable evidence was finalized at ${outputDirectory}.`
    );
  }

  return { outputDirectory, summary, acceptance, baseline, manifest };
}

function createPackageLifecycle() {
  const browsers = new Set();
  let preview = null;
  let sourceWorktree = null;
  let cleanupPromise = null;
  return {
    registerBrowser(browser) {
      browsers.add(browser);
      return () => browsers.delete(browser);
    },
    setPreview(value) {
      preview = value;
    },
    setSourceWorktree(value) {
      sourceWorktree = value;
    },
    cleanup() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const errors = [];
        for (const browser of browsers) {
          try {
            await browser.close();
          } catch (error) {
            errors.push(new Error(`Browser cleanup failed: ${formatError(error)}`));
          }
        }
        browsers.clear();
        if (preview) {
          try {
            await preview.shutdown();
          } catch (error) {
            errors.push(new Error(`Strict preview cleanup failed: ${formatError(error)}`));
          }
        }
        if (sourceWorktree) {
          try {
            await sourceWorktree.cleanup();
          } catch (error) {
            errors.push(new Error(`Detached source cleanup failed: ${formatError(error)}`));
          }
        }
        return {
          passed: errors.length === 0,
          errors
        };
      })();
      return cleanupPromise;
    }
  };
}

function installInterruptCleanup(lifecycle) {
  let interrupting = false;
  const handlers = new Map();
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const handler = () => {
      if (interrupting) return;
      interrupting = true;
      console.error(`[ripple-field-lab:benchmark:package] ${signal} received; cleaning owned resources.`);
      void lifecycle.cleanup()
        .then((result) => {
          for (const error of result.errors) console.error(formatError(error));
        })
        .finally(() => process.exit(exitCode));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

function sanitizeFailureList(errors) {
  const messages = errors.filter(Boolean).map((error) => serializePortableError(error).message);
  return messages.length > 0
    ? `Package lifecycle failed: ${messages.join(" | ")}`
    : "Package lifecycle did not complete cleanly.";
}

function createCombinedError(prefix, errors) {
  const messages = errors.filter(Boolean).map((error) => formatError(error));
  return new Error(messages.length > 0 ? `${prefix} ${messages.join(" | ")}` : prefix);
}

function assertCleanGitTree() {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new Error(
      "Packaged renderer acceptance requires a clean Git tree before build or preview startup. " +
      `Dirty entries:\n${status}`
    );
  }
  const branch = runGit(["branch", "--show-current"]) || null;
  const commit = runGit(["rev-parse", "HEAD"]);
  return {
    passed: true,
    branch,
    commit,
    detail: `Clean Git tree at ${branch ? `${branch}@` : ""}${commit.slice(0, 12)}.`
  };
}

function verifyGitTreeUnchanged(initialState, summarySourceControl) {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  const commit = runGit(["rev-parse", "HEAD"]);
  const branch = runGit(["branch", "--show-current"]) || null;
  const summaryMatches = summarySourceControl?.commit === initialState.commit &&
    summarySourceControl?.dirty === false;
  const passed = status.length === 0 && commit === initialState.commit &&
    branch === initialState.branch && summaryMatches;
  return {
    passed,
    branch,
    commit,
    startedCommit: initialState.commit,
    detail: passed
      ? `Git tree remained clean at ${branch ? `${branch}@` : ""}${commit.slice(0, 12)} for the entire run.`
      : "Git branch, HEAD, worktree status, or benchmark source metadata changed during the packaged run."
  };
}

async function copyComparisonBaseline(outputDirectory) {
  const configuredPath = process.env.RIPPLE_BENCHMARK_BASELINE?.trim();
  if (!configuredPath) return null;
  const sourcePath = path.resolve(process.cwd(), configuredPath);
  const relativePath = "comparison-baseline.json";
  const baseline = JSON.parse(await readFile(sourcePath, "utf8"));
  const absolutePath = path.join(outputDirectory, relativePath);
  await writeJsonAtomic(absolutePath, baseline);
  return { absolutePath, relativePath };
}

async function createDetachedSourceWorktree(commit) {
  const directory = path.join(
    os.tmpdir(),
    `ripple-benchmark-source-${process.pid}-${randomUUID()}`
  );
  const addResult = spawnSync("git", ["worktree", "add", "--detach", directory, commit], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (addResult.error || addResult.status !== 0) {
    throw new Error(
      `Could not create detached benchmark source worktree: ` +
      `${addResult.stderr?.trim() || addResult.error?.message || `git status ${addResult.status}`}`
    );
  }

  return {
    directory,
    cleanup: async () => removeDetachedSourceWorktree(directory)
  };
}

async function removeDetachedSourceWorktree(directory) {
  const expectedPrefix = `ripple-benchmark-source-${process.pid}-`;
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected benchmark source directory ${directory}.`);
  }
  const removeResult = spawnSync("git", ["worktree", "remove", "--force", directory], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (removeResult.error || removeResult.status !== 0) {
    throw new Error(
      `Could not remove detached benchmark source worktree: ` +
      `${removeResult.stderr?.trim() || removeResult.error?.message || `git status ${removeResult.status}`}`
    );
  }
  await rm(directory, { recursive: true, force: true });
}

function runNpmCi(cwd) {
  runNpmCommand(["ci", "--no-audit", "--no-fund"], cwd, "npm ci");
}

function createFailedStockEvidence(error, browserChannel, headless, profile) {
  const failure = serializePortableError(error);
  return {
    schemaVersion: RENDERER_BENCHMARK_SCHEMA_VERSION,
    protocolVersion: RENDERER_BENCHMARK_PROTOCOL_VERSION,
    workloadVersion: RENDERER_BENCHMARK_WORKLOAD_VERSION,
    browser: { name: "Chrome", channel: browserChannel, headless, args: [] },
    modes: [],
    soak: {
      passed: false,
      requestedDurationMs: profile.stockSoakMs,
      observedDurationMs: 0
    },
    visualChecks: [],
    health: {
      passed: false,
      problemCount: 1,
      deviceLost: null,
      fallbackObserved: null
    },
    failure
  };
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}

function runNpmScript(scriptName, cwd = process.cwd()) {
  runNpmCommand(["run", scriptName], cwd, `npm run ${scriptName}`);
}

function runNpmCommand(args, cwd, label) {
  const npmRunner = resolveNpmRunner();
  const result = spawnSync(npmRunner.command, [...npmRunner.args, ...args], {
    cwd,
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status}.`);
  }
}

async function startOwnedPreview(expectedIndexHtml, cwd = process.cwd(), onSpawn = () => {}) {
  const npmRunner = resolveNpmRunner();
  const child = spawn(npmRunner.command, [...npmRunner.args, "run", "preview"], {
    cwd,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let childAnnouncedPreview = false;
  let previewOutput = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    process.stdout.write(`[ripple-field-lab:preview] ${text}`);
    previewOutput = `${previewOutput}${stripVTControlCharacters(text)}`.slice(-4_096);
    if (previewOutput.includes(PREVIEW_URL)) childAnnouncedPreview = true;
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[ripple-field-lab:preview] ${chunk}`));
  const ownedPreview = {
    assertHealthy: async () => {
      if (child.exitCode !== null || !await previewMatchesBuild(expectedIndexHtml)) {
        throw new Error("Owned strict-port preview stopped or no longer serves the packaged production build.");
      }
    },
    shutdown: async () => shutdownOwnedPreview(child)
  };
  onSpawn(ownedPreview);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Owned strict-port preview exited early with status ${child.exitCode}.`);
    }
    if (childAnnouncedPreview && await previewMatchesBuild(expectedIndexHtml)) {
      await delay(150);
      if (child.exitCode !== null) {
        throw new Error(`Owned strict-port preview exited after readiness with status ${child.exitCode}.`);
      }
      return ownedPreview;
    }
    await delay(100);
  }
  await shutdownOwnedPreview(child);
  throw new Error(`Owned production preview did not become ready at ${PREVIEW_URL}.`);
}

async function previewMatchesBuild(expectedIndexHtml) {
  try {
    const response = await fetch(PREVIEW_URL, { cache: "no-store" });
    return response.ok && await response.text() === expectedIndexHtml;
  } catch {
    return false;
  }
}

async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      reject(new Error(
        `Packaged benchmark owns strict preview port ${host}:${port}, but the port is unavailable: ` +
        formatError(error)
      ));
    });
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
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

async function shutdownOwnedPreview(child) {
  if (!child?.pid) return;
  if (process.platform === "win32" && child.exitCode === null) {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    if (result.status !== 0 && child.exitCode === null) {
      throw new Error(
        `Could not stop owned preview process ${child.pid}: ` +
        `${result.stderr?.trim() || result.error?.message || `taskkill status ${result.status}`}`
      );
    }
  } else if (child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch (error) {
      throw new Error(`Could not stop owned preview process ${child.pid}: ${formatError(error)}`);
    }
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && await canBindPort(PREVIEW_HOST, PREVIEW_PORT)) return;
    await delay(100);
  }
  throw new Error(`Owned preview process ${child.pid} or port ${PREVIEW_PORT} did not shut down cleanly.`);
}

async function canBindPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
