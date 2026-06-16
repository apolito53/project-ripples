export type RippleDebugLevel = "debug" | "info" | "warn" | "error";

export type RippleDebugPayload = Record<string, unknown>;

export type RippleDebugEntry = {
  readonly index: number;
  readonly level: RippleDebugLevel;
  readonly channel: string;
  readonly message: string;
  readonly pageMs: number;
  readonly timestamp: string;
  readonly payload?: RippleDebugPayload;
};

declare global {
  interface Window {
    __rippleDebugEnabled?: boolean;
    __rippleDebugLog?: RippleDebugEntry[];
    __rippleDebugDump?: () => RippleDebugEntry[];
    __rippleDebugFlush?: () => void;
  }
}

const MAX_RETAINED_ENTRIES = 400;
const LOCAL_LOG_ENDPOINT = "http://127.0.0.1:5184/__ripple_debug_log";
const LOCAL_LOG_BATCH_DELAY_MS = 120;
const LOCAL_LOG_MAX_QUEUED_ENTRIES = 80;
const KEEPALIVE_MAX_BYTES = 60 * 1024;
let nextEntryIndex = 1;
let localLogQueue: RippleDebugEntry[] = [];
let localLogFlushHandle: number | undefined;
let localLogServerEnabled: boolean | undefined;

export function debugEvent(
  channel: string,
  message: string,
  payload?: RippleDebugPayload,
  level: RippleDebugLevel = "info"
): void {
  if (!isDebugLoggingEnabled()) return;

  const entry: RippleDebugEntry = {
    index: nextEntryIndex,
    level,
    channel,
    message,
    pageMs: roundMetric(performance.now()),
    timestamp: new Date().toISOString(),
    payload
  };
  nextEntryIndex += 1;

  const log = getDebugLog();
  log.push(entry);
  if (log.length > MAX_RETAINED_ENTRIES) {
    log.splice(0, log.length - MAX_RETAINED_ENTRIES);
  }

  // Keep the console line self-contained. Browser automation tends to collapse
  // object arguments into "Object", so the JSON has to live in the message text
  // if we want hitch captures to be readable without opening DevTools manually.
  const writer = console[level] ?? console.info;
  writer.call(console, formatConsoleLine(entry));
  queueLocalLogEntry(entry);
}

export function debugMeasure<T>(
  channel: string,
  message: string,
  action: () => T,
  payload?: RippleDebugPayload,
  warnAfterMs = 10
): T {
  const startMs = performance.now();
  try {
    return action();
  } finally {
    const durationMs = performance.now() - startMs;
    debugEvent(
      channel,
      message,
      {
        ...payload,
        durationMs: roundMetric(durationMs)
      },
      durationMs >= warnAfterMs ? "warn" : "info"
    );
  }
}

export function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

export function vectorPayload(value: { readonly x: number; readonly y: number; readonly z: number }): RippleDebugPayload {
  return {
    x: roundMetric(value.x),
    y: roundMetric(value.y),
    z: roundMetric(value.z)
  };
}

function isDebugLoggingEnabled(): boolean {
  if (typeof window.__rippleDebugEnabled === "boolean") {
    return window.__rippleDebugEnabled;
  }

  const queryValue = new URLSearchParams(window.location.search).get("debug");
  const storedValue = readLocalStorage("rippleDebug");
  const hostIsLocal = isLocalHost();

  // Local runs default to logging because this is a visual lab and freezes are
  // otherwise painful to pin down. Production-style hosts can opt in with
  // ?debug=1 or localStorage.rippleDebug = "1".
  const enabled = queryValue === "0"
    ? false
    : queryValue === "1" || storedValue === "1" || (hostIsLocal && storedValue !== "0");
  window.__rippleDebugEnabled = enabled;
  window.__rippleDebugDump = () => [...getDebugLog()];
  window.__rippleDebugFlush = flushLocalLogEntries;
  return enabled;
}

function getDebugLog(): RippleDebugEntry[] {
  window.__rippleDebugLog ??= [];
  return window.__rippleDebugLog;
}

function queueLocalLogEntry(entry: RippleDebugEntry): void {
  if (!shouldWriteLocalLogServer()) return;

  localLogQueue.push(entry);
  if (localLogQueue.length > LOCAL_LOG_MAX_QUEUED_ENTRIES) {
    localLogQueue.splice(0, localLogQueue.length - LOCAL_LOG_MAX_QUEUED_ENTRIES);
  }

  if (localLogFlushHandle !== undefined) return;
  localLogFlushHandle = window.setTimeout(flushLocalLogEntries, LOCAL_LOG_BATCH_DELAY_MS);
}

function flushLocalLogEntries(): void {
  localLogFlushHandle = undefined;
  if (!shouldWriteLocalLogServer() || localLogQueue.length === 0) return;

  const entries = localLogQueue.splice(0, localLogQueue.length);
  const body = safeStringify({
    source: "ripple-field-lab",
    href: window.location.href,
    userAgent: navigator.userAgent,
    sentAtIso: new Date().toISOString(),
    entries
  });

  // The receiver is a local development aid. Missing server, CORS mistakes, or
  // shutdown races should never add new console noise while we are diagnosing a
  // render hitch, so writes are fire-and-forget and intentionally quiet.
  void fetch(LOCAL_LOG_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body,
    keepalive: body.length <= KEEPALIVE_MAX_BYTES
  }).catch(() => {});
}

function shouldWriteLocalLogServer(): boolean {
  if (typeof localLogServerEnabled === "boolean") return localLogServerEnabled;

  const queryValue = new URLSearchParams(window.location.search).get("logServer");
  const storedValue = readLocalStorage("rippleLogServer");
  localLogServerEnabled = queryValue === "0"
    ? false
    : queryValue === "1" || storedValue === "1" || (isLocalHost() && storedValue !== "0");
  return localLogServerEnabled;
}

function formatConsoleLine(entry: RippleDebugEntry): string {
  return `[ripple:${entry.channel}] ${entry.message} ${safeStringify({
    index: entry.index,
    level: entry.level,
    pageMs: entry.pageMs,
    timestamp: entry.timestamp,
    payload: entry.payload ?? {}
  })}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(toJsonSafeValue(value));
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : "Unable to serialize debug payload."
    });
  }
}

function toJsonSafeValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return value.toString();

  if (value instanceof Date) return value.toISOString();
  if (depth >= 6) return "[max-depth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => toJsonSafeValue(item, seen, depth + 1));
    }

    const safeObject: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      safeObject[key] = toJsonSafeValue(childValue, seen, depth + 1);
    }
    return safeObject;
  }

  return String(value);
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isLocalHost(): boolean {
  return window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "";
}

// Install the dump hook as soon as the module loads, even before the first
// detonation. That way DevTools always has a stable place to look after a
// freeze instead of depending on whether the first log event completed.
if (isDebugLoggingEnabled()) {
  debugEvent("debug", "Ripple debug logging ready", {
    retainedEntries: MAX_RETAINED_ENTRIES
  }, "debug");
}
