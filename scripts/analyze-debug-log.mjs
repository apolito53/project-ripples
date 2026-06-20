import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findDebugLogPath,
  formatSummaryText,
  readDebugLogFile,
  readFiniteNumber,
  summarizeDebugRecords
} from "./debug-log-analysis.mjs";

const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGS_DIRECTORY = resolve(ROOT_DIRECTORY, "logs");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logPath = args.file
    ? resolve(process.cwd(), args.file)
    : await findDebugLogPath(LOGS_DIRECTORY, args.date);
  const records = await readDebugLogFile(logPath);
  const summary = summarizeDebugRecords(records, {
    topLimit: args.limit ?? 8
  });

  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      logPath,
      summary
    }, null, 2));
  } else {
    console.log(formatSummaryText(summary, logPath));
  }

  const failures = collectThresholdFailures(summary, args);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[ripple-diagnostics] ${failure}`);
    }
    process.exitCode = 1;
  }
}

function parseArgs(rawArgs) {
  const args = {};

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      args.json = true;
      continue;
    }

    const [rawKey, rawValue = ""] = rawArg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key) continue;

    if (key === "file") args.file = value;
    if (key === "date") args.date = value;
    if (key === "limit") args.limit = readFiniteNumber(value);
    if (key === "max-frame-ms") args.maxFrameMs = readFiniteNumber(value);
    if (key === "max-rebuild-ms") args.maxRebuildMs = readFiniteNumber(value);
    if (key === "max-update-ms") args.maxUpdateMs = readFiniteNumber(value);
    if (key === "max-render-ms") args.maxRenderMs = readFiniteNumber(value);
    if (key === "max-warnings") args.maxWarnings = readFiniteNumber(value);
  }

  return args;
}

function collectThresholdFailures(summary, args) {
  const failures = [];
  const topFrame = summary.tops.frameMs[0];
  const topRebuild = summary.tops.fieldRebuildMs[0];
  const topUpdate = summary.tops.updateMs[0];
  const topRender = summary.tops.renderMs[0];

  addThresholdFailure(failures, "frameMs", topFrame, args.maxFrameMs);
  addThresholdFailure(failures, "field rebuild durationMs", topRebuild, args.maxRebuildMs);
  addThresholdFailure(failures, "updateMs", topUpdate, args.maxUpdateMs);
  addThresholdFailure(failures, "renderMs", topRender, args.maxRenderMs);

  if (args.maxWarnings !== undefined && summary.warningCount > args.maxWarnings) {
    failures.push(`warningCount ${summary.warningCount} exceeded max ${args.maxWarnings}`);
  }

  return failures;
}

function addThresholdFailure(failures, label, topRecord, maximum) {
  if (maximum === undefined || !topRecord) return;
  if (topRecord.value <= maximum) return;

  failures.push(`${label} ${topRecord.value}ms at line ${topRecord.line} exceeded max ${maximum}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to analyze Ripple debug logs.");
  process.exitCode = 1;
});
