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
  storage: Storage | null = window.localStorage
): RendererModeSelection {
  const queryMode = normalizeRendererMode(new URLSearchParams(location.search).get("renderer"));
  if (queryMode) {
    return {
      requestedMode: queryMode,
      source: "query",
      fallbackReason: getCurrentFallbackReason(queryMode)
    };
  }

  const storedMode = normalizeRendererMode(readStoredRendererMode(storage));
  if (storedMode) {
    return {
      requestedMode: storedMode,
      source: "localStorage",
      fallbackReason: getCurrentFallbackReason(storedMode)
    };
  }

  return {
    requestedMode: "auto",
    source: "default",
    fallbackReason: getCurrentFallbackReason("auto")
  };
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
    return "Forced WebGPU uses a diagnostic runtime until field, wake, particle, and postprocessing parity land.";
  }

  if (mode === "auto") {
    return "Auto mode keeps WebGL as the visual backend until WebGPU render parity is implemented.";
  }

  return "";
}
