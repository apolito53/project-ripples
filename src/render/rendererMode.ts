export type RendererMode = "auto" | "webgl" | "webgpu";

export type RendererModeSource = "query" | "localStorage" | "default";

export type RendererModeSelection = {
  readonly requestedMode: RendererMode;
  readonly source: RendererModeSource;
  readonly fallbackReason: string;
};

const RENDERER_MODE_STORAGE_KEY = "rippleRendererMode";

export function resolveRendererMode(
  location: Location = window.location,
  storage?: Storage | null
): RendererModeSelection {
  const queryMode = normalizeRendererMode(new URLSearchParams(location.search).get("renderer"));
  if (queryMode) {
    return {
      requestedMode: queryMode,
      source: "query",
      fallbackReason: getCurrentFallbackReason(queryMode)
    };
  }

  const resolvedStorage = storage === undefined ? getDefaultStorage() : storage;
  const storedMode = normalizeRendererMode(readStoredRendererMode(resolvedStorage));
  if (storedMode) {
    // Stage 0 only permits an explicit query to force WebGPU. A preference
    // written by an older build must not silently bypass the dormant rollout.
    const effectiveMode = storedMode === "webgpu" ? "auto" : storedMode;
    return {
      requestedMode: effectiveMode,
      source: "localStorage",
      fallbackReason: getCurrentFallbackReason(effectiveMode)
    };
  }

  return {
    requestedMode: "auto",
    source: "default",
    fallbackReason: getCurrentFallbackReason("auto")
  };
}

function getDefaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeRendererMode(value: string | null): RendererMode | null {
  if (value === "auto" || value === "webgl" || value === "webgpu") return value;
  return null;
}

function readStoredRendererMode(storage: Storage | null): string | null {
  try {
    return storage?.getItem(RENDERER_MODE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function getCurrentFallbackReason(mode: RendererMode): string {
  if (mode === "webgpu") {
    return "Forced WebGPU runs the integration-candidate core renderer.";
  }

  if (mode === "auto") {
    return "Auto rollout stage 0 keeps WebGL active while cross-hardware benchmark evidence is gathered.";
  }

  return "";
}
