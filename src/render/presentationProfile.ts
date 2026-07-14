import type { RenderPresentationProfile } from "./types";

export type PresentationProfileSource = "query" | "localStorage" | "default";

export type PresentationProfileSelection = {
  readonly profile: RenderPresentationProfile;
  readonly source: PresentationProfileSource;
  readonly rejectedValue: string | null;
};

export const DEFAULT_WEBGPU_PRESENTATION_PROFILE: RenderPresentationProfile = "classic";
export const WEBGPU_PRESENTATION_STORAGE_KEY = "rippleWebGpuPresentation";

export function resolveWebGpuPresentationProfile(
  location: Location = window.location,
  storage?: Storage | null
): PresentationProfileSelection {
  const queryValue = new URLSearchParams(location.search).get("presentation");
  if (queryValue !== null) {
    const profile = normalizePresentationProfile(queryValue);
    return {
      profile: profile ?? DEFAULT_WEBGPU_PRESENTATION_PROFILE,
      source: "query",
      rejectedValue: profile ? null : queryValue
    };
  }

  const resolvedStorage = storage === undefined ? getDefaultStorage() : storage;
  const storedValue = readStoredProfile(resolvedStorage);
  if (storedValue !== null) {
    const profile = normalizePresentationProfile(storedValue);
    return {
      profile: profile ?? DEFAULT_WEBGPU_PRESENTATION_PROFILE,
      source: "localStorage",
      rejectedValue: profile ? null : storedValue
    };
  }

  return {
    profile: DEFAULT_WEBGPU_PRESENTATION_PROFILE,
    source: "default",
    rejectedValue: null
  };
}

export function persistWebGpuPresentationProfile(
  profile: RenderPresentationProfile,
  storage?: Storage | null
): boolean {
  const resolvedStorage = storage === undefined ? getDefaultStorage() : storage;
  try {
    resolvedStorage?.setItem(WEBGPU_PRESENTATION_STORAGE_KEY, profile);
    return resolvedStorage !== null;
  } catch {
    return false;
  }
}

export function isRenderPresentationProfile(value: string): value is RenderPresentationProfile {
  return value === "classic" || value === "core";
}

function normalizePresentationProfile(value: string | null): RenderPresentationProfile | null {
  return value !== null && isRenderPresentationProfile(value) ? value : null;
}

function getDefaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredProfile(storage: Storage | null): string | null {
  try {
    return storage?.getItem(WEBGPU_PRESENTATION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
