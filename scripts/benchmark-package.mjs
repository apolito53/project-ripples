import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

export const REQUIRED_PORTABLE_BUNDLE_PATHS = Object.freeze([
  "acceptance.json",
  "baseline.json",
  "summary.json",
  "summary.md",
  "samples.ndjson.gz"
]);

export function getBenchmarkPackageProfile(environment = process.env) {
  const testMode = environment.RIPPLE_BENCHMARK_PACKAGE_TEST === "1";
  return Object.freeze(testMode
    ? {
        id: "deterministic-short-test",
        testMode: true,
        stockModeSampleMs: 1_500,
        stockSoakMs: 1_500,
        // A full pulse cycle must settle before sampling or transient particle
        // counts differ by backend startup speed and create a false parity fail.
        benchmarkWarmupMs: 1_000,
        benchmarkSampleMs: 2_000,
        benchmarkRepetitions: 1
      }
    : {
        id: "cross-hardware-acceptance",
        testMode: false,
        stockModeSampleMs: 2_000,
        stockSoakMs: 120_000,
        benchmarkWarmupMs: 5_000,
        benchmarkSampleMs: 15_000,
        benchmarkRepetitions: 4
      });
}

export function createPackageRunId(timestamp = new Date().toISOString()) {
  return `${timestamp.replaceAll(":", "-").replace(".", "-")}-package`;
}

export async function createUniqueRunDirectory(outputRoot, runId) {
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
  throw new Error(`Could not allocate a unique packaged benchmark directory under ${outputRoot}.`);
}

export async function gzipNdjson(sourcePath, targetPath) {
  await pipeline(
    createReadStream(sourcePath),
    createGzip({ level: 9 }),
    createWriteStream(targetPath, { flags: "wx" })
  );
  await rm(sourcePath);
}

export async function writeJsonAtomic(targetPath, value) {
  await writeTextAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, "utf8");
  await rename(temporaryPath, targetPath);
}

export function toPortableRelativePath(rootDirectory, targetPath) {
  const relativePath = path.relative(path.resolve(rootDirectory), path.resolve(targetPath));
  return assertPortableRelativePath(relativePath.split(path.sep).join("/"));
}

export function assertPortableRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Portable artifact path must be a non-empty string; received ${JSON.stringify(value)}.`);
  }
  if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || value.startsWith("\\\\")) {
    throw new Error(`Portable artifact path must be relative: ${value}`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Portable artifact path contains an unsafe segment: ${value}`);
  }
  return normalized;
}

export function assertPortableValue(value, label = "portable value") {
  const visit = (entry, entryPath) => {
    if (typeof entry === "string") {
      assertPortableString(entry, entryPath);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${entryPath}[${index}]`));
      return;
    }
    if (entry === null || typeof entry !== "object") return;
    for (const [key, item] of Object.entries(entry)) {
      if (/pnpdeviceid/i.test(key)) {
        throw new Error(`${entryPath}.${key} exposes a raw PNP identifier field.`);
      }
      visit(item, `${entryPath}.${key}`);
    }
  };
  visit(value, label);
}

export async function createPortableManifest(bundleDirectory, options) {
  const files = await listBundleFiles(bundleDirectory);
  const relativePaths = files
    .map((filePath) => toPortableRelativePath(bundleDirectory, filePath))
    .filter((filePath) => filePath !== "manifest.json")
    .sort();
  for (const requiredPath of options.requiredPaths ?? REQUIRED_PORTABLE_BUNDLE_PATHS) {
    if (!relativePaths.includes(requiredPath)) {
      throw new Error(`Portable benchmark bundle is missing required artifact ${requiredPath}.`);
    }
  }

  const entries = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(bundleDirectory, ...relativePath.split("/"));
    await assertPortableFileContents(absolutePath, relativePath);
    const contents = await readFile(absolutePath);
    const fileStat = await stat(absolutePath);
    entries.push({
      path: relativePath,
      sizeBytes: fileStat.size,
      sha256: createHash("sha256").update(contents).digest("hex")
    });
  }

  const manifest = {
    schemaVersion: options.schemaVersion,
    protocolVersion: options.protocolVersion,
    workloadVersion: options.workloadVersion,
    bundleKind: "renderer-benchmark-portable-run",
    runId: options.runId,
    sourceCommit: options.sourceCommit ?? null,
    packageProfile: options.packageProfile ?? null,
    decisionGrade: options.decisionGrade ?? null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    checksumAlgorithm: "sha256",
    manifestPath: "manifest.json",
    files: entries
  };
  assertPortableValue(manifest, "manifest");
  await writeJsonAtomic(path.join(bundleDirectory, "manifest.json"), manifest);
  return manifest;
}

export async function verifyPortableManifest(bundleDirectory, manifestOrPath = "manifest.json") {
  const manifest = typeof manifestOrPath === "string"
    ? JSON.parse(await readFile(path.join(bundleDirectory, manifestOrPath), "utf8"))
    : manifestOrPath;
  if (manifest?.checksumAlgorithm !== "sha256" || !Array.isArray(manifest.files)) {
    throw new Error("Portable benchmark manifest must use SHA-256 and contain a files array.");
  }
  assertPortableValue(manifest, "manifest");

  const seen = new Set();
  for (const entry of manifest.files) {
    const relativePath = assertPortableRelativePath(entry.path);
    if (seen.has(relativePath)) throw new Error(`Manifest contains duplicate path ${relativePath}.`);
    seen.add(relativePath);
    const absolutePath = path.join(bundleDirectory, ...relativePath.split("/"));
    const contents = await readFile(absolutePath);
    const checksum = createHash("sha256").update(contents).digest("hex");
    if (checksum !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${relativePath}: expected ${entry.sha256}, received ${checksum}.`);
    }
    if (contents.length !== entry.sizeBytes) {
      throw new Error(`Byte-size mismatch for ${relativePath}: expected ${entry.sizeBytes}, received ${contents.length}.`);
    }
    if (relativePath === "samples.ndjson.gz") await inspectCompressedSamples(absolutePath);
  }
  for (const requiredPath of REQUIRED_PORTABLE_BUNDLE_PATHS) {
    if (!seen.has(requiredPath)) {
      throw new Error(`Portable benchmark manifest is missing required artifact ${requiredPath}.`);
    }
  }
  await assertBundleProtocolCoherence(bundleDirectory, manifest);
  return true;
}

export function sanitizePortableDiagnostic(value) {
  if (typeof value !== "string") return String(value);
  return value
    .replace(/\\\\[^\\\s]+\\[^\s\r\n`"']+/g, "<local-path>")
    .replace(/[A-Za-z]:[\\/][^\s\r\n`"']+/g, "<local-path>")
    .replace(/(^|[\s(`"'=:\[])\/(?!\/)(?:[^/\s\r\n`"')]+\/)+[^\s\r\n`"')]+/g,
      (_match, prefix) => `${prefix}<local-path>`);
}

export function serializePortableError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: sanitizePortableDiagnostic(error instanceof Error ? error.message : String(error)),
    stack: null
  };
}

async function listBundleFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listBundleFiles(entryPath));
    else if (entry.isFile() && !entry.name.endsWith(".tmp") && !entry.name.endsWith(".partial")) {
      result.push(entryPath);
    }
  }
  return result;
}

async function assertPortableFileContents(absolutePath, relativePath) {
  if (relativePath.endsWith(".json")) {
    const value = JSON.parse(await readFile(absolutePath, "utf8"));
    assertPortableValue(value, relativePath);
    return;
  }
  if (relativePath.endsWith(".md")) {
    assertPortableString(await readFile(absolutePath, "utf8"), relativePath);
    return;
  }
  if (relativePath === "samples.ndjson.gz") await inspectCompressedSamples(absolutePath, true);
}

async function inspectCompressedSamples(absolutePath, assertPortable = false) {
  const input = createReadStream(absolutePath).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const samples = [];
  for await (const line of lines) {
    if (line.length === 0) continue;
    const sample = JSON.parse(line);
    if (assertPortable) assertPortableValue(sample, `samples.ndjson.gz[${samples.length}]`);
    samples.push(sample);
  }
  return samples;
}

async function assertBundleProtocolCoherence(bundleDirectory, manifest) {
  const [summary, acceptance, baseline, samples] = await Promise.all([
    readJsonArtifact(bundleDirectory, "summary.json"),
    readJsonArtifact(bundleDirectory, "acceptance.json"),
    readJsonArtifact(bundleDirectory, "baseline.json"),
    inspectCompressedSamples(path.join(bundleDirectory, "samples.ndjson.gz"), true)
  ]);
  const expectedIdentity = {
    schemaVersion: manifest.schemaVersion,
    protocolVersion: manifest.protocolVersion,
    workloadVersion: manifest.workloadVersion
  };
  for (const [label, value] of [
    ["summary.json", summary],
    ["acceptance.json", acceptance],
    ["baseline.json", baseline]
  ]) {
    for (const [field, expected] of Object.entries(expectedIdentity)) {
      if (value?.[field] !== expected) {
        throw new Error(`${label}.${field} does not match manifest.json.`);
      }
    }
  }
  if (summary.runId !== manifest.runId || acceptance.runId !== manifest.runId ||
    baseline.sourceRun?.runId !== manifest.runId) {
    throw new Error("Portable benchmark run IDs do not agree across manifest, summary, acceptance, and baseline.");
  }
  if (manifest.sourceCommit !== null &&
    summary.metadata?.packageProvenance?.sourceCommit !== manifest.sourceCommit) {
    throw new Error("manifest.json sourceCommit does not match summary package provenance.");
  }
  if (manifest.packageProfile !== null && acceptance.packageProfile !== manifest.packageProfile) {
    throw new Error("manifest.json packageProfile does not match acceptance.json.");
  }
  if (manifest.decisionGrade !== null && acceptance.decisionGrade !== manifest.decisionGrade) {
    throw new Error("manifest.json decisionGrade does not match acceptance.json.");
  }
  if (summary.acceptance?.status !== acceptance.status ||
    summary.acceptance?.decisionGrade !== acceptance.decisionGrade ||
    summary.acceptance?.packageProfile !== acceptance.packageProfile) {
    throw new Error("summary.json acceptance projection does not match acceptance.json.");
  }
  const expectedBaselineEligibility = acceptance.status === "passed" && acceptance.decisionGrade === true;
  if (baseline.eligible !== expectedBaselineEligibility ||
    baseline.acceptanceStatus !== acceptance.status) {
    throw new Error("baseline.json eligibility or acceptance status does not match acceptance.json.");
  }
  if (manifest.sourceCommit !== null &&
    baseline.metadata?.sourceControl?.commit !== manifest.sourceCommit) {
    throw new Error("baseline.json source commit does not match manifest.json.");
  }
  if (summary.sampleCount !== samples.length) {
    throw new Error(
      `summary.json reports ${summary.sampleCount} samples, but samples.ndjson.gz contains ${samples.length}.`
    );
  }
  if (summary.status === "passed" && samples.length === 0) {
    throw new Error("A passed benchmark bundle must contain sampled frame evidence.");
  }

  const sequences = new Set();
  const sampleTuples = new Set();
  const cases = new Map((summary.config?.cases ?? []).map((entry) => [entry.id, entry]));
  const repetitions = summary.config?.repetitions;
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0 || cases.size === 0) {
    throw new Error("summary.json must describe at least one case and repetition.");
  }
  const expectedSampleCount = cases.size * repetitions * 2;
  if (summary.sampleCount !== expectedSampleCount || summary.expectedSampleCount !== expectedSampleCount) {
    throw new Error(
      `summary.json sample counts do not match the ${cases.size}-case, ${repetitions}-repetition matrix.`
    );
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    assertPortableSampleRecord(sample, index);
    for (const [field, expected] of Object.entries(expectedIdentity)) {
      if (sample?.[field] !== expected) {
        throw new Error(`samples.ndjson.gz[${index}].${field} does not match manifest.json.`);
      }
    }
    if (sample.runId !== manifest.runId) {
      throw new Error(`samples.ndjson.gz[${index}].runId does not match manifest.json.`);
    }
    if (!Number.isSafeInteger(sample.sequence) || sequences.has(sample.sequence)) {
      throw new Error(`samples.ndjson.gz contains an invalid or duplicate sequence at index ${index}.`);
    }
    sequences.add(sample.sequence);
    const benchmarkCase = cases.get(sample.caseId);
    if (!benchmarkCase || sample.scenario !== benchmarkCase.scenario || sample.tier !== benchmarkCase.tier) {
      throw new Error(`samples.ndjson.gz[${index}] does not match its configured benchmark case.`);
    }
    if (sample.repetition >= repetitions ||
      sample.requested.warmupMs !== summary.config.warmupMs ||
      sample.requested.sampleMs !== summary.config.sampleMs) {
      throw new Error(`samples.ndjson.gz[${index}] does not match the configured repetition or timing.`);
    }
    const tuple = `${sample.repetition}|${sample.caseId}|${sample.renderer}`;
    if (sampleTuples.has(tuple)) {
      throw new Error(`samples.ndjson.gz contains duplicate matrix tuple ${tuple}.`);
    }
    sampleTuples.add(tuple);
  }
  for (let sequence = 0; sequence < expectedSampleCount; sequence += 1) {
    if (!sequences.has(sequence)) {
      throw new Error(`samples.ndjson.gz is missing contiguous sequence ${sequence}.`);
    }
  }
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const caseId of cases.keys()) {
      for (const renderer of ["webgl", "webgpu"]) {
        const tuple = `${repetition}|${caseId}|${renderer}`;
        if (!sampleTuples.has(tuple)) {
          throw new Error(`samples.ndjson.gz is missing expected matrix tuple ${tuple}.`);
        }
      }
    }
  }
}

function assertPortableSampleRecord(sample, index) {
  const label = `samples.ndjson.gz[${index}]`;
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const field of ["runId", "capturedAt", "caseId", "scenario", "renderer"]) {
    if (typeof sample[field] !== "string" || sample[field].length === 0) {
      throw new Error(`${label}.${field} must be a non-empty string.`);
    }
  }
  if (!Number.isFinite(Date.parse(sample.capturedAt))) {
    throw new Error(`${label}.capturedAt must be an ISO-compatible timestamp.`);
  }
  if (!new Set(["webgl", "webgpu"]).has(sample.renderer)) {
    throw new Error(`${label}.renderer must be webgl or webgpu.`);
  }
  for (const field of ["sequence", "repetition", "orderInRepetition"]) {
    if (!Number.isSafeInteger(sample[field]) || sample[field] < 0) {
      throw new Error(`${label}.${field} must be a non-negative safe integer.`);
    }
  }
  if (!sample.requested || !Number.isFinite(sample.requested.warmupMs) ||
    !Number.isFinite(sample.requested.sampleMs) || sample.requested.sampleMs <= 0) {
    throw new Error(`${label}.requested must contain finite warmup and positive sample durations.`);
  }
  for (const field of ["metrics", "metricValues", "semantics", "apiResult"]) {
    if (!sample[field] || typeof sample[field] !== "object" || Array.isArray(sample[field])) {
      throw new Error(`${label}.${field} must be an object.`);
    }
  }
  if (Object.keys(sample.metricValues).length === 0 ||
    Object.values(sample.metricValues).some((value) => !Number.isFinite(value))) {
    throw new Error(`${label}.metricValues must contain finite numeric metrics.`);
  }
  if (!Array.isArray(sample.apiResult.samples) || sample.apiResult.samples.length < 2) {
    throw new Error(`${label}.apiResult must retain at least two frame samples.`);
  }
}

async function readJsonArtifact(bundleDirectory, relativePath) {
  return JSON.parse(await readFile(path.join(bundleDirectory, relativePath), "utf8"));
}

function assertPortableString(value, label) {
  if (/(?:^|[\s`"'(])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)/m.test(value) ||
    /file:\/{2,3}[A-Za-z]:/i.test(value) ||
    /(?:^|[\s`"'=:\[])\/(?!\/)(?:[^/\s\r\n`"')]+\/)+[^\s\r\n`"')]+/m.test(value)) {
    throw new Error(`${label} contains an absolute local filesystem path.`);
  }
  if (/(?:PNPDeviceID|(?:PCI|USB)\\(?:VEN|VID)_)/i.test(value)) {
    throw new Error(`${label} contains a raw PNP device identifier.`);
  }
}
