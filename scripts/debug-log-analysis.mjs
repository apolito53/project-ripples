import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_TOP_LIMIT = 8;
const DEFAULT_FRAME_HITCH_MS = 45;

export async function findDebugLogPath(logsDirectory, dateStamp) {
  if (dateStamp) {
    return resolve(logsDirectory, `ripple-debug-${dateStamp}.jsonl`);
  }

  const entries = await readdir(logsDirectory, { withFileTypes: true });
  const logNames = entries
    .filter((entry) => entry.isFile() && /^ripple-debug-\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (logNames.length === 0) {
    throw new Error(`No Ripple debug logs found in ${logsDirectory}.`);
  }

  return resolve(logsDirectory, logNames.at(-1));
}

export async function readDebugLogFile(logPath) {
  const text = await readFile(logPath, "utf8");
  return parseDebugLogText(text);
}

export function parseDebugLogText(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        return {
          ...JSON.parse(line),
          __lineNumber: lineNumber
        };
      } catch (error) {
        return {
          __lineNumber: lineNumber,
          __parseError: error instanceof Error ? error.message : "Unable to parse JSONL record.",
          rawLine: line
        };
      }
    });
}

export function normalizeDebugRecord(rawRecord, fallbackLineNumber = 0) {
  const raw = isPlainObject(rawRecord) ? rawRecord : {};
  const entry = isPlainObject(raw.entry) ? raw.entry : raw;
  const payload = isPlainObject(entry.payload) ? entry.payload : {};

  return {
    raw,
    lineNumber: readFiniteNumber(raw.__lineNumber) ?? fallbackLineNumber,
    receivedAt: typeof raw.receivedAt === "string" ? raw.receivedAt : "",
    batchIndex: readFiniteNumber(raw.batchIndex) ?? 0,
    context: isPlainObject(raw.context) ? raw.context : {},
    index: readFiniteNumber(entry.index) ?? 0,
    level: typeof entry.level === "string" ? entry.level : "info",
    channel: typeof entry.channel === "string" ? entry.channel : "unknown",
    message: typeof entry.message === "string" ? entry.message : "",
    pageMs: readFiniteNumber(entry.pageMs) ?? 0,
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
    payload,
    parseError: typeof raw.__parseError === "string" ? raw.__parseError : ""
  };
}

export function summarizeDebugRecords(rawRecords, options = {}) {
  const topLimit = readFiniteNumber(options.topLimit) ?? DEFAULT_TOP_LIMIT;
  const hitchThresholdMs = readFiniteNumber(options.hitchThresholdMs) ?? DEFAULT_FRAME_HITCH_MS;
  const records = rawRecords.map((record, index) => normalizeDebugRecord(record, index + 1));
  const summary = {
    totalRecords: records.length,
    parseErrors: records.filter((record) => record.parseError).length,
    warningCount: 0,
    errorCount: 0,
    channels: {},
    levels: {},
    hitchesByKind: {},
    warningsByChannel: {},
    tops: {
      frameMs: [],
      rawClockDeltaMs: [],
      fieldRebuildMs: [],
      updateMs: [],
      renderMs: [],
      wakePassMs: []
    },
    latestWarnings: []
  };

  for (const record of records) {
    increment(summary.channels, record.channel);
    increment(summary.levels, record.level);

    if (record.level === "warn") {
      summary.warningCount += 1;
      increment(summary.warningsByChannel, record.channel);
      pushLatest(summary.latestWarnings, compactRecord(record), topLimit);
    }

    if (record.level === "error") {
      summary.errorCount += 1;
    }

    const payload = record.payload;
    const frameMs = readFiniteNumber(payload.frameMs);
    const rawClockDeltaMs = readFiniteNumber(payload.rawClockDeltaMs);
    const updateMs = readFiniteNumber(payload.updateMs);
    const renderMs = readFiniteNumber(payload.renderMs);
    const durationMs = readFiniteNumber(payload.durationMs);
    const wakePassMs = readFiniteNumber(payload.passMs) ?? readFiniteNumber(payload.wakePassMs);

    if (frameMs !== undefined) {
      pushTop(summary.tops.frameMs, compactRecord(record, { value: frameMs }), "value", topLimit);
    }

    if (rawClockDeltaMs !== undefined) {
      pushTop(summary.tops.rawClockDeltaMs, compactRecord(record, { value: rawClockDeltaMs }), "value", topLimit);
    }

    if (record.channel === "field.rebuild" && durationMs !== undefined) {
      pushTop(summary.tops.fieldRebuildMs, compactRecord(record, { value: durationMs }), "value", topLimit);
    }

    if (updateMs !== undefined) {
      pushTop(summary.tops.updateMs, compactRecord(record, { value: updateMs }), "value", topLimit);
    }

    if (renderMs !== undefined) {
      pushTop(summary.tops.renderMs, compactRecord(record, { value: renderMs }), "value", topLimit);
    }

    if (wakePassMs !== undefined) {
      pushTop(summary.tops.wakePassMs, compactRecord(record, { value: wakePassMs }), "value", topLimit);
    }

    if (isFrameHitchChannel(record.channel)) {
      const hitchKind = typeof payload.hitchKind === "string"
        ? payload.hitchKind
        : classifyHitchPayload(payload, hitchThresholdMs);
      increment(summary.hitchesByKind, hitchKind);
    }
  }

  return summary;
}

export function filterDebugRecords(rawRecords, filters = {}) {
  return rawRecords.filter((rawRecord, index) => {
    const record = normalizeDebugRecord(rawRecord, index + 1);
    const payload = record.payload;

    if (filters.channel && record.channel !== filters.channel) return false;
    if (filters.level && record.level !== filters.level) return false;

    if (filters.hitchKind) {
      const hitchKind = typeof payload.hitchKind === "string"
        ? payload.hitchKind
        : classifyHitchPayload(payload);
      if (hitchKind !== filters.hitchKind) return false;
    }

    if (!passesMinimum(payload.frameMs, filters.minFrameMs)) return false;
    if (!passesMinimum(payload.rawClockDeltaMs, filters.minRawClockDeltaMs)) return false;
    if (!passesMinimum(payload.durationMs, filters.minDurationMs)) return false;

    return true;
  });
}

export function formatSummaryText(summary, sourceLabel = "current records") {
  const lines = [
    `Ripple diagnostics summary (${sourceLabel})`,
    `records=${summary.totalRecords} warnings=${summary.warningCount} errors=${summary.errorCount} parseErrors=${summary.parseErrors}`,
    "",
    "Channels:",
    ...formatCountMap(summary.channels),
    "",
    "Hitches by kind:",
    ...formatCountMap(summary.hitchesByKind),
    "",
    "Top frame times:",
    ...formatTopList(summary.tops.frameMs, "frameMs"),
    "",
    "Top raw clock gaps:",
    ...formatTopList(summary.tops.rawClockDeltaMs, "rawClockDeltaMs"),
    "",
    "Top field rebuilds:",
    ...formatTopList(summary.tops.fieldRebuildMs, "durationMs")
  ];

  return `${lines.join("\n")}\n`;
}

export function buildRecordFilters(searchParams) {
  return {
    channel: emptyToUndefined(searchParams.get("channel")),
    level: emptyToUndefined(searchParams.get("level")),
    hitchKind: emptyToUndefined(searchParams.get("hitchKind")),
    minFrameMs: readFiniteNumber(searchParams.get("minFrameMs")),
    minRawClockDeltaMs: readFiniteNumber(searchParams.get("minRawClockDeltaMs")),
    minDurationMs: readFiniteNumber(searchParams.get("minDurationMs"))
  };
}

export function classifyHitchPayload(payload, thresholdMs = DEFAULT_FRAME_HITCH_MS) {
  const frameMs = readFiniteNumber(payload.frameMs) ?? 0;
  const updateMs = readFiniteNumber(payload.updateMs) ?? 0;
  const renderMs = readFiniteNumber(payload.renderMs) ?? 0;
  const rawClockDeltaMs = readFiniteNumber(payload.rawClockDeltaMs) ?? 0;

  if (frameMs >= thresholdMs) {
    if (renderMs >= 24 && renderMs >= updateMs * 1.2) return "render";
    if (updateMs >= 24 && updateMs >= renderMs * 1.2) return "update";
    return "mixed";
  }

  if (rawClockDeltaMs >= thresholdMs) return "clock-gap";
  return "sample";
}

export function readFiniteNumber(value) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function compactRecord(record, extra = {}) {
  const payload = record.payload;
  return {
    line: record.lineNumber,
    index: record.index,
    level: record.level,
    channel: record.channel,
    message: record.message,
    timestamp: record.timestamp,
    frameMs: readFiniteNumber(payload.frameMs),
    updateMs: readFiniteNumber(payload.updateMs),
    renderMs: readFiniteNumber(payload.renderMs),
    rawClockDeltaMs: readFiniteNumber(payload.rawClockDeltaMs),
    durationMs: readFiniteNumber(payload.durationMs),
    quality: typeof payload.quality === "string" ? payload.quality : undefined,
    hexCount: readFiniteNumber(payload.hexCount),
    hexDiameterMeters: readFiniteNumber(payload.hexDiameterMeters),
    arenaRadiusMeters: readFiniteNumber(payload.arenaRadiusMeters),
    hitchKind: typeof payload.hitchKind === "string" ? payload.hitchKind : undefined,
    ...extra
  };
}

function isFrameHitchChannel(channel) {
  return channel === "frame.hitch" ||
    channel === "frame.renderHitch" ||
    channel === "frame.updateHitch" ||
    channel === "frame.mixedHitch" ||
    channel === "frame.clockGap";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function pushTop(list, item, key, limit) {
  list.push(item);
  list.sort((left, right) => (right[key] ?? 0) - (left[key] ?? 0));
  if (list.length > limit) list.pop();
}

function pushLatest(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.shift();
}

function passesMinimum(value, minimum) {
  if (minimum === undefined) return true;
  const numberValue = readFiniteNumber(value);
  return numberValue !== undefined && numberValue >= minimum;
}

function emptyToUndefined(value) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function formatCountMap(map) {
  const entries = Object.entries(map).sort((left, right) => right[1] - left[1]);
  if (entries.length === 0) return ["  none"];
  return entries.map(([key, count]) => `  ${key}: ${count}`);
}

function formatTopList(records, label) {
  if (records.length === 0) return ["  none"];
  return records.map((record) => {
    const context = [
      record.quality ? `quality=${record.quality}` : "",
      record.hexCount ? `hexes=${record.hexCount.toLocaleString()}` : "",
      record.hitchKind ? `kind=${record.hitchKind}` : ""
    ].filter(Boolean).join(" ");
    return `  line ${record.line} ${record.channel} ${label}=${record.value ?? "?"} ${context}`.trimEnd();
  });
}
