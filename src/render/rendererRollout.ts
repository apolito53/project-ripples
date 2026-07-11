import type { RendererMode } from "./rendererMode";

export const RENDERER_ROLLOUT_INSTALL_ID_STORAGE_KEY = "rippleRendererRollout.installId";
export const RENDERER_ROLLOUT_HEALTH_STORAGE_KEY = "rippleRendererRollout.health";
export const RENDERER_RELOAD_GUARD_STORAGE_KEY = "rippleRendererRollout.reloadGuard";

export const RENDERER_ROLLOUT_BUCKET_COUNT = 10_000;
export const MIN_RENDERER_TEXTURE_DIMENSION_2D = 4_096;
export const MIN_SUPPORTED_CHROMIUM_MAJOR_VERSION = 113;
export const SUCCESSFUL_RENDERER_SESSION_MS = 90_000;

const DAY_MS = 24 * 60 * 60 * 1_000;
export const RENDERER_FAILURE_ESCALATION_WINDOW_MS = 30 * DAY_MS;
export const FIRST_RENDERER_FAILURE_COOLDOWN_MS = DAY_MS;
export const SECOND_RENDERER_FAILURE_COOLDOWN_MS = 7 * DAY_MS;
export const MAX_RENDERER_FAILURE_COOLDOWN_MS = 30 * DAY_MS;

export const DEFAULT_RENDERER_ROLLOUT_CONFIG = Object.freeze({
  rolloutPercent: 0,
  minimumChromiumMajorVersion: MIN_SUPPORTED_CHROMIUM_MAJOR_VERSION,
  cohortKey: "ripple-webgpu-v1"
});

const INSTALL_ID_PATTERN = /^rf-[0-9a-f]{32}$/;

export type RendererRolloutStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type RendererBrowserFamily = "chromium" | "other" | "unknown";
export type RendererChromiumBrand = "chrome" | "edge" | "opera" | "chromium" | "other";

export type RendererBrowserIdentity = {
  readonly family: RendererBrowserFamily;
  readonly brand: RendererChromiumBrand;
  readonly majorVersion: number | null;
};

export type UserAgentBrandVersion = {
  readonly brand: string;
  readonly version: string;
};

export type RendererRolloutBuildConfig = {
  readonly buildId: string;
  readonly rolloutPercent?: number;
  readonly minimumChromiumMajorVersion?: number;
  readonly cohortKey?: string;
};

export type ResolvedRendererRolloutBuildConfig = {
  readonly buildId: string;
  readonly rolloutPercent: number;
  readonly minimumChromiumMajorVersion: number;
  readonly cohortKey: string;
};

export type RendererRolloutHealthState = {
  readonly version: 1;
  readonly failureCount: number;
  readonly cooldownUntilMs: number;
  readonly failedBuildId: string | null;
  readonly lastFailureAtMs: number;
  readonly lastSuccessAtMs: number;
};

export type RendererAutoRolloutEnvironment = {
  readonly secureContext: boolean;
  readonly navigatorGpuAvailable: boolean;
  readonly storageWritable: boolean;
  readonly browser: RendererBrowserIdentity;
  // Pass GPUAdapter.limits.maxTextureDimension2D from capability discovery.
  // The rollout policy itself deliberately never requests an adapter or device.
  readonly maxTextureDimension2D: number | null;
};

export type RendererAutoRolloutInput = {
  readonly nowMs: number;
  readonly config: RendererRolloutBuildConfig;
  readonly environment: RendererAutoRolloutEnvironment;
  readonly installId: string | null;
  readonly healthState?: RendererRolloutHealthState;
};

export type RendererRolloutPolicyInput =
  | { readonly requestedMode: "webgl" | "webgpu" }
  | { readonly requestedMode: "auto"; readonly auto: RendererAutoRolloutInput };

export type RendererAutoRolloutBlockReason =
  | "rollout-percent-zero"
  | "insecure-context"
  | "navigator-gpu-unavailable"
  | "storage-unwritable"
  | "install-id-unavailable"
  | "unsupported-browser-family"
  | "unsupported-browser-version"
  | "adapter-limits-unavailable"
  | "max-texture-dimension-too-low"
  | "cooldown-active"
  | "current-build-failed"
  | "outside-rollout-cohort";

export type RendererRolloutChecks = {
  readonly rolloutEnabled: boolean;
  readonly secureContext: boolean;
  readonly navigatorGpuAvailable: boolean;
  readonly storageWritable: boolean;
  readonly installIdAvailable: boolean;
  readonly browserFamilySupported: boolean;
  readonly browserVersionSupported: boolean;
  readonly adapterLimitsAvailable: boolean;
  readonly textureLimitSupported: boolean;
  readonly cooldownClear: boolean;
  readonly currentBuildHealthy: boolean;
  readonly cohortEligible: boolean;
};

export type RendererRolloutDecisionCode =
  | "explicit-webgl"
  | "explicit-webgpu"
  | "auto-webgpu-eligible"
  | "auto-webgl-disabled"
  | "auto-webgl-fallback";

// The nullable auto fields make explicit decisions easy to log without
// pretending that dormant rollout checks had any authority over them.
export type RendererRolloutDecision = {
  readonly requestedMode: RendererMode;
  readonly selectedMode: "webgl" | "webgpu";
  readonly policyKind: "explicit" | "auto";
  readonly decisionCode: RendererRolloutDecisionCode;
  readonly webGpuSelected: boolean;
  readonly autoEligible: boolean | null;
  readonly blockingReasons: readonly RendererAutoRolloutBlockReason[];
  readonly checks: RendererRolloutChecks | null;
  readonly buildId: string | null;
  readonly rolloutPercent: number | null;
  readonly rolloutThreshold: number | null;
  readonly cohortBucket: number | null;
  readonly minimumChromiumMajorVersion: number | null;
  readonly maxTextureDimension2D: number | null;
  readonly failureCount: number | null;
  readonly cooldownUntilMs: number | null;
  readonly cooldownRemainingMs: number | null;
  readonly currentBuildFailed: boolean | null;
};

export type RendererInstallIdResolution = {
  readonly storageWritable: boolean;
  readonly installId: string | null;
  readonly created: boolean;
  readonly reason:
    | "ready"
    | "storage-unavailable"
    | "storage-read-denied"
    | "storage-write-denied"
    | "install-id-generation-failed";
};

export type RendererReloadGuardState = {
  readonly version: 1;
  readonly buildId: string;
  readonly claimedAtMs: number;
};

export type RendererReloadGuardClaim = {
  readonly shouldReload: boolean;
  readonly reason: "first-reload-for-build" | "already-reloaded-for-build";
  readonly nextState: RendererReloadGuardState;
};

export function evaluateRendererRollout(input: RendererRolloutPolicyInput): RendererRolloutDecision {
  if (input.requestedMode !== "auto") {
    const selectedMode = input.requestedMode;
    return {
      requestedMode: selectedMode,
      selectedMode,
      policyKind: "explicit",
      decisionCode: selectedMode === "webgpu" ? "explicit-webgpu" : "explicit-webgl",
      webGpuSelected: selectedMode === "webgpu",
      autoEligible: null,
      blockingReasons: [],
      checks: null,
      buildId: null,
      rolloutPercent: null,
      rolloutThreshold: null,
      cohortBucket: null,
      minimumChromiumMajorVersion: null,
      maxTextureDimension2D: null,
      failureCount: null,
      cooldownUntilMs: null,
      cooldownRemainingMs: null,
      currentBuildFailed: null
    };
  }

  const nowMs = requireNonNegativeFiniteNumber(input.auto.nowMs, "nowMs");
  const config = resolveRendererRolloutBuildConfig(input.auto.config);
  const healthState = normalizeRendererRolloutHealthState(input.auto.healthState);
  const environment = input.auto.environment;
  const installIdAvailable = isRendererInstallId(input.auto.installId);
  const cohortBucket = installIdAvailable
    ? getRendererRolloutBucket(input.auto.installId, config.cohortKey)
    : null;
  const rolloutThreshold = getRendererRolloutThreshold(config.rolloutPercent);
  const browserFamilySupported = environment.browser.family === "chromium";
  const browserVersionSupported = environment.browser.majorVersion !== null
    && environment.browser.majorVersion >= config.minimumChromiumMajorVersion;
  const adapterLimitsAvailable = environment.maxTextureDimension2D !== null
    && Number.isFinite(environment.maxTextureDimension2D)
    && environment.maxTextureDimension2D > 0;
  const textureLimitSupported = adapterLimitsAvailable
    && environment.maxTextureDimension2D! >= MIN_RENDERER_TEXTURE_DIMENSION_2D;
  const cooldownRemainingMs = Math.max(0, healthState.cooldownUntilMs - nowMs);
  const currentBuildFailed = healthState.failedBuildId === config.buildId;

  const checks: RendererRolloutChecks = {
    rolloutEnabled: rolloutThreshold > 0,
    secureContext: environment.secureContext,
    navigatorGpuAvailable: environment.navigatorGpuAvailable,
    storageWritable: environment.storageWritable,
    installIdAvailable,
    browserFamilySupported,
    browserVersionSupported,
    adapterLimitsAvailable,
    textureLimitSupported,
    cooldownClear: cooldownRemainingMs === 0,
    currentBuildHealthy: !currentBuildFailed,
    cohortEligible: cohortBucket !== null
      && isRendererRolloutBucketEligible(cohortBucket, config.rolloutPercent)
  };

  const blockingReasons = collectAutoRolloutBlockingReasons(checks);
  const autoEligible = blockingReasons.length === 0;
  const selectedMode = autoEligible ? "webgpu" : "webgl";

  return {
    requestedMode: "auto",
    selectedMode,
    policyKind: "auto",
    decisionCode: autoEligible
      ? "auto-webgpu-eligible"
      : checks.rolloutEnabled ? "auto-webgl-fallback" : "auto-webgl-disabled",
    webGpuSelected: autoEligible,
    autoEligible,
    blockingReasons,
    checks,
    buildId: config.buildId,
    rolloutPercent: config.rolloutPercent,
    rolloutThreshold,
    cohortBucket,
    minimumChromiumMajorVersion: config.minimumChromiumMajorVersion,
    maxTextureDimension2D: environment.maxTextureDimension2D,
    failureCount: healthState.failureCount,
    cooldownUntilMs: healthState.cooldownUntilMs,
    cooldownRemainingMs,
    currentBuildFailed
  };
}

export function resolveRendererRolloutBuildConfig(
  config: RendererRolloutBuildConfig
): ResolvedRendererRolloutBuildConfig {
  return {
    buildId: requireBuildId(config.buildId),
    rolloutPercent: normalizeRolloutPercent(
      config.rolloutPercent ?? DEFAULT_RENDERER_ROLLOUT_CONFIG.rolloutPercent
    ),
    minimumChromiumMajorVersion: normalizeMinimumChromiumVersion(
      config.minimumChromiumMajorVersion
        ?? DEFAULT_RENDERER_ROLLOUT_CONFIG.minimumChromiumMajorVersion
    ),
    cohortKey: normalizeCohortKey(config.cohortKey)
  };
}

export function identifyRendererBrowser(
  userAgent: string,
  brands: readonly UserAgentBrandVersion[] = []
): RendererBrowserIdentity {
  const brandIdentity = identifyBrowserFromBrands(brands);
  if (brandIdentity) return brandIdentity;

  const chromiumPatterns: readonly [RegExp, RendererChromiumBrand][] = [
    [/\bEdg(?:A)?\/(\d+)/i, "edge"],
    [/\bOPR\/(\d+)/i, "opera"],
    [/\bChromium\/(\d+)/i, "chromium"],
    [/\b(?:HeadlessChrome|Chrome)\/(\d+)/i, "chrome"]
  ];

  for (const [pattern, brand] of chromiumPatterns) {
    const match = pattern.exec(userAgent);
    if (match) {
      return { family: "chromium", brand, majorVersion: parseMajorVersion(match[1]) };
    }
  }

  return {
    family: userAgent.trim() ? "other" : "unknown",
    brand: "other",
    majorVersion: null
  };
}

export function createRendererInstallId(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? createRandomInstallIdBytes();
  if (bytes.byteLength !== 16) {
    throw new RangeError("Renderer install IDs require exactly 16 random bytes.");
  }

  const encoded = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `rf-${encoded}`;
}

export function isRendererInstallId(value: string | null | undefined): value is string {
  return typeof value === "string" && INSTALL_ID_PATTERN.test(value);
}

export function ensureStableRendererInstallId(
  storage: RendererRolloutStorage | null,
  createInstallId: () => string = createRendererInstallId
): RendererInstallIdResolution {
  if (!storage) {
    return {
      storageWritable: false,
      installId: null,
      created: false,
      reason: "storage-unavailable"
    };
  }

  let storedInstallId: string | null;
  try {
    storedInstallId = storage.getItem(RENDERER_ROLLOUT_INSTALL_ID_STORAGE_KEY);
  } catch {
    return {
      storageWritable: false,
      installId: null,
      created: false,
      reason: "storage-read-denied"
    };
  }

  const existingInstallId = isRendererInstallId(storedInstallId) ? storedInstallId : null;
  let installId = existingInstallId;
  if (!installId) {
    try {
      const generatedInstallId = createInstallId();
      if (!isRendererInstallId(generatedInstallId)) throw new Error("Invalid install ID");
      installId = generatedInstallId;
    } catch {
      return {
        storageWritable: false,
        installId: null,
        created: false,
        reason: "install-id-generation-failed"
      };
    }
  }

  try {
    // Writing the resolved value back proves writability even when the ID was
    // already present, without introducing a temporary probe key.
    storage.setItem(RENDERER_ROLLOUT_INSTALL_ID_STORAGE_KEY, installId);
    if (storage.getItem(RENDERER_ROLLOUT_INSTALL_ID_STORAGE_KEY) !== installId) {
      throw new Error("Install ID write was not retained");
    }
  } catch {
    return {
      storageWritable: false,
      installId: null,
      created: false,
      reason: "storage-write-denied"
    };
  }

  return {
    storageWritable: true,
    installId,
    created: existingInstallId === null,
    reason: "ready"
  };
}

export function getRendererRolloutBucket(
  installId: string,
  cohortKey: string = DEFAULT_RENDERER_ROLLOUT_CONFIG.cohortKey
): number {
  if (!isRendererInstallId(installId)) {
    throw new Error("A valid stable renderer install ID is required for cohort bucketing.");
  }

  const key = normalizeCohortKey(cohortKey);
  let hash = 0x811c9dc5;
  const input = `${key}\u0000${installId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0) % RENDERER_ROLLOUT_BUCKET_COUNT;
}

export function getRendererRolloutThreshold(rolloutPercent: number): number {
  return Math.round(normalizeRolloutPercent(rolloutPercent) * 100);
}

export function isRendererRolloutBucketEligible(
  bucket: number,
  rolloutPercent: number
): boolean {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= RENDERER_ROLLOUT_BUCKET_COUNT) {
    return false;
  }

  return bucket < getRendererRolloutThreshold(rolloutPercent);
}

export function createEmptyRendererRolloutHealthState(): RendererRolloutHealthState {
  return {
    version: 1,
    failureCount: 0,
    cooldownUntilMs: 0,
    failedBuildId: null,
    lastFailureAtMs: 0,
    lastSuccessAtMs: 0
  };
}

export function getRendererFailureCooldownMs(failureCount: number): number {
  const normalizedCount = normalizeFailureCount(failureCount);
  if (normalizedCount <= 0) return 0;
  if (normalizedCount === 1) return FIRST_RENDERER_FAILURE_COOLDOWN_MS;
  if (normalizedCount === 2) return SECOND_RENDERER_FAILURE_COOLDOWN_MS;
  return MAX_RENDERER_FAILURE_COOLDOWN_MS;
}

export function recordRendererRolloutFailure(
  state: RendererRolloutHealthState,
  buildId: string,
  failedAtMs: number
): RendererRolloutHealthState {
  const normalizedState = normalizeRendererRolloutHealthState(state);
  const normalizedBuildId = requireBuildId(buildId);
  const normalizedFailedAtMs = requireNonNegativeFiniteNumber(failedAtMs, "failedAtMs");
  const withinEscalationWindow = normalizedState.lastFailureAtMs > 0 &&
    normalizedFailedAtMs - normalizedState.lastFailureAtMs <= RENDERER_FAILURE_ESCALATION_WINDOW_MS;
  const previousFailureCount = withinEscalationWindow ? normalizedState.failureCount : 0;
  const failureCount = Math.min(Number.MAX_SAFE_INTEGER, previousFailureCount + 1);
  const nextCooldownUntilMs = Math.min(
    Number.MAX_SAFE_INTEGER,
    normalizedFailedAtMs + getRendererFailureCooldownMs(failureCount)
  );

  return {
    ...normalizedState,
    failureCount,
    cooldownUntilMs: Math.max(normalizedState.cooldownUntilMs, nextCooldownUntilMs),
    failedBuildId: normalizedBuildId,
    lastFailureAtMs: normalizedFailedAtMs
  };
}

export function recordSuccessfulRendererSession(
  state: RendererRolloutHealthState,
  buildId: string,
  sessionDurationMs: number,
  succeededAtMs: number
): RendererRolloutHealthState {
  const normalizedState = normalizeRendererRolloutHealthState(state);
  requireBuildId(buildId);
  const normalizedDurationMs = requireNonNegativeFiniteNumber(
    sessionDurationMs,
    "sessionDurationMs"
  );
  const normalizedSucceededAtMs = requireNonNegativeFiniteNumber(succeededAtMs, "succeededAtMs");

  if (normalizedDurationMs < SUCCESSFUL_RENDERER_SESSION_MS) return normalizedState;

  return {
    ...normalizedState,
    failureCount: Math.max(0, normalizedState.failureCount - 1),
    lastSuccessAtMs: normalizedSucceededAtMs
  };
}

export function normalizeRendererRolloutHealthState(
  state: RendererRolloutHealthState | null | undefined
): RendererRolloutHealthState {
  if (!state || state.version !== 1) return createEmptyRendererRolloutHealthState();

  return {
    version: 1,
    failureCount: normalizeFailureCount(state.failureCount),
    cooldownUntilMs: normalizeStoredTimestamp(state.cooldownUntilMs),
    failedBuildId: normalizeStoredBuildId(state.failedBuildId),
    lastFailureAtMs: normalizeStoredTimestamp(state.lastFailureAtMs),
    lastSuccessAtMs: normalizeStoredTimestamp(state.lastSuccessAtMs)
  };
}

export function parseRendererRolloutHealthState(serialized: string | null): RendererRolloutHealthState {
  if (!serialized) return createEmptyRendererRolloutHealthState();

  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1) return createEmptyRendererRolloutHealthState();
    return normalizeRendererRolloutHealthState(value as RendererRolloutHealthState);
  } catch {
    return createEmptyRendererRolloutHealthState();
  }
}

export function readRendererRolloutHealthState(
  storage: RendererRolloutStorage | null
): RendererRolloutHealthState {
  try {
    return parseRendererRolloutHealthState(
      storage?.getItem(RENDERER_ROLLOUT_HEALTH_STORAGE_KEY) ?? null
    );
  } catch {
    return createEmptyRendererRolloutHealthState();
  }
}

export function writeRendererRolloutHealthState(
  storage: RendererRolloutStorage | null,
  state: RendererRolloutHealthState
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(
      RENDERER_ROLLOUT_HEALTH_STORAGE_KEY,
      JSON.stringify(normalizeRendererRolloutHealthState(state))
    );
    return true;
  } catch {
    return false;
  }
}

export function claimRendererReloadOnce(
  state: RendererReloadGuardState | null,
  buildId: string,
  claimedAtMs: number
): RendererReloadGuardClaim {
  const normalizedBuildId = requireBuildId(buildId);
  const normalizedClaimedAtMs = requireNonNegativeFiniteNumber(claimedAtMs, "claimedAtMs");
  const normalizedState = normalizeRendererReloadGuardState(state);

  if (normalizedState?.buildId === normalizedBuildId) {
    return {
      shouldReload: false,
      reason: "already-reloaded-for-build",
      nextState: normalizedState
    };
  }

  return {
    shouldReload: true,
    reason: "first-reload-for-build",
    nextState: {
      version: 1,
      buildId: normalizedBuildId,
      claimedAtMs: normalizedClaimedAtMs
    }
  };
}

export function clearRendererReloadGuard(
  state: RendererReloadGuardState | null,
  buildId: string
): RendererReloadGuardState | null {
  const normalizedState = normalizeRendererReloadGuardState(state);
  if (!normalizedState) return null;
  return normalizedState.buildId === requireBuildId(buildId) ? null : normalizedState;
}

export function parseRendererReloadGuardState(serialized: string | null): RendererReloadGuardState | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return null;
    return normalizeRendererReloadGuardState(value as RendererReloadGuardState);
  } catch {
    return null;
  }
}

export function readRendererReloadGuardState(
  storage: RendererRolloutStorage | null
): RendererReloadGuardState | null {
  try {
    return parseRendererReloadGuardState(
      storage?.getItem(RENDERER_RELOAD_GUARD_STORAGE_KEY) ?? null
    );
  } catch {
    return null;
  }
}

export function writeRendererReloadGuardState(
  storage: RendererRolloutStorage | null,
  state: RendererReloadGuardState | null
): boolean {
  if (!storage) return false;

  try {
    if (state) {
      storage.setItem(RENDERER_RELOAD_GUARD_STORAGE_KEY, JSON.stringify(state));
    } else {
      storage.removeItem(RENDERER_RELOAD_GUARD_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

function collectAutoRolloutBlockingReasons(
  checks: RendererRolloutChecks
): RendererAutoRolloutBlockReason[] {
  const reasons: RendererAutoRolloutBlockReason[] = [];
  if (!checks.rolloutEnabled) return ["rollout-percent-zero"];
  if (!checks.secureContext) reasons.push("insecure-context");
  if (!checks.navigatorGpuAvailable) reasons.push("navigator-gpu-unavailable");
  if (!checks.storageWritable) reasons.push("storage-unwritable");
  if (!checks.installIdAvailable) reasons.push("install-id-unavailable");
  if (!checks.browserFamilySupported) {
    reasons.push("unsupported-browser-family");
  } else if (!checks.browserVersionSupported) {
    reasons.push("unsupported-browser-version");
  }
  if (!checks.adapterLimitsAvailable) {
    reasons.push("adapter-limits-unavailable");
  } else if (!checks.textureLimitSupported) {
    reasons.push("max-texture-dimension-too-low");
  }
  if (!checks.cooldownClear) reasons.push("cooldown-active");
  if (!checks.currentBuildHealthy) reasons.push("current-build-failed");
  if (checks.rolloutEnabled && checks.installIdAvailable && !checks.cohortEligible) {
    reasons.push("outside-rollout-cohort");
  }
  return reasons;
}

function identifyBrowserFromBrands(
  brands: readonly UserAgentBrandVersion[]
): RendererBrowserIdentity | null {
  const knownBrands: readonly [RegExp, RendererChromiumBrand][] = [
    [/Microsoft Edge/i, "edge"],
    [/Google Chrome/i, "chrome"],
    [/Opera/i, "opera"],
    [/^Chromium$/i, "chromium"]
  ];

  for (const [pattern, normalizedBrand] of knownBrands) {
    const match = brands.find((candidate) => pattern.test(candidate.brand));
    if (match) {
      return {
        family: "chromium",
        brand: normalizedBrand,
        majorVersion: parseMajorVersion(match.version)
      };
    }
  }

  return null;
}

function parseMajorVersion(value: string): number | null {
  const majorVersion = Number.parseInt(value.split(".", 1)[0] ?? "", 10);
  return Number.isFinite(majorVersion) && majorVersion >= 0 ? majorVersion : null;
}

function normalizeRolloutPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RENDERER_ROLLOUT_CONFIG.rolloutPercent;
  return Math.min(100, Math.max(0, value));
}

function normalizeMinimumChromiumVersion(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_RENDERER_ROLLOUT_CONFIG.minimumChromiumMajorVersion;
  }
  return Math.floor(value);
}

function normalizeCohortKey(value: string | undefined): string {
  const cohortKey = value?.trim() || DEFAULT_RENDERER_ROLLOUT_CONFIG.cohortKey;
  return cohortKey;
}

function normalizeFailureCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function normalizeStoredTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, value);
}

function normalizeStoredBuildId(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const buildId = value.trim();
  return buildId || null;
}

function normalizeRendererReloadGuardState(
  state: RendererReloadGuardState | null | undefined
): RendererReloadGuardState | null {
  if (!state || state.version !== 1) return null;
  const buildId = normalizeStoredBuildId(state.buildId);
  if (!buildId) return null;
  return {
    version: 1,
    buildId,
    claimedAtMs: normalizeStoredTimestamp(state.claimedAtMs)
  };
}

function requireBuildId(value: string): string {
  const buildId = value.trim();
  if (!buildId) throw new Error("Renderer rollout buildId must not be empty.");
  return buildId;
}

function requireNonNegativeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function createRandomInstallIdBytes(): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random values are unavailable for renderer install ID generation.");
  }

  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
