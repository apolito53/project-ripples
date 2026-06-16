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
  }
}

const MAX_RETAINED_ENTRIES = 400;
let nextEntryIndex = 1;

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

  // Keep the console line compact but structured. The full retained log is
  // always available from window.__rippleDebugDump(), which is more useful
  // after a freeze than scrolling through a noisy console.
  const writer = console[level] ?? console.info;
  writer.call(console, `[ripple:${channel}] ${message}`, entry);
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
  const storedValue = window.localStorage.getItem("rippleDebug");
  const hostIsLocal = window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "";

  // Local runs default to logging because this is a visual lab and freezes are
  // otherwise painful to pin down. Production-style hosts can opt in with
  // ?debug=1 or localStorage.rippleDebug = "1".
  const enabled = queryValue === "0"
    ? false
    : queryValue === "1" || storedValue === "1" || (hostIsLocal && storedValue !== "0");
  window.__rippleDebugEnabled = enabled;
  window.__rippleDebugDump = () => [...getDebugLog()];
  return enabled;
}

function getDebugLog(): RippleDebugEntry[] {
  window.__rippleDebugLog ??= [];
  return window.__rippleDebugLog;
}

// Install the dump hook as soon as the module loads, even before the first
// detonation. That way DevTools always has a stable place to look after a
// freeze instead of depending on whether the first log event completed.
if (isDebugLoggingEnabled()) {
  debugEvent("debug", "Ripple debug logging ready", {
    retainedEntries: MAX_RETAINED_ENTRIES
  }, "debug");
}
