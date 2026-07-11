import type { LabSettings } from "../labSettings";
import type { RendererBackendId } from "./types";

export type RenderBenchmarkScenario = "pretty-arena" | "showoff-track-motion" | "meltdown-ramp";
export type RenderBenchmarkPhase = "idle" | "warmup" | "sample" | "complete";

export type RenderBenchmarkSemanticSnapshot = {
  readonly playMode: string;
  readonly qualityId: string;
  readonly fieldInstances: number;
  readonly particleBudget: number;
  readonly activeParticles: number;
  readonly activeSources: number;
  readonly activeEchoes: number;
  readonly playerSpeed: number;
  readonly bloomEnabled: boolean;
  readonly shadowMode: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pixelRatio: number;
  readonly deviceLost: boolean;
};

export type RenderBenchmarkFrameSample = {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly rafIntervalMs: number | null;
  readonly updateCpuMs: number;
  readonly snapshotCpuMs: number;
  readonly renderCpuMs: number;
  readonly gpuFrameMs: number | null;
  readonly gpuFrameSequence: number | null;
  readonly gpuTimerMode: string;
  readonly gpuTimerErrorCount: number;
  readonly backendId: RendererBackendId;
  readonly semantic: RenderBenchmarkSemanticSnapshot;
};

export type RenderBenchmarkConfig = {
  readonly enabled: boolean;
  readonly scenario: RenderBenchmarkScenario;
  readonly tier: number;
  readonly seed: number;
};

export type RenderBenchmarkMotionSample = {
  readonly x: number;
  readonly z: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly facingYawRadians: number;
};

export type RenderBenchmarkCourseSampler = (
  fraction: number
) => { readonly x: number; readonly z: number };

export type RenderBenchmarkSnapshot = {
  readonly version: 1;
  readonly config: RenderBenchmarkConfig;
  readonly phase: RenderBenchmarkPhase;
  readonly startedAtMs: number | null;
  readonly stoppedAtMs: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly samples: readonly RenderBenchmarkFrameSample[];
};

export type RippleBenchmarkApi = {
  readonly version: 1;
  readonly config: RenderBenchmarkConfig;
  beginPhase(phase: "warmup" | "sample"): void;
  start(phase?: "warmup" | "sample"): void;
  stop(): RenderBenchmarkSnapshot;
  reset(): void;
  setMetadata(metadata: Record<string, unknown>): void;
  getSnapshot(): RenderBenchmarkSnapshot;
  getSamples(): readonly RenderBenchmarkFrameSample[];
};

declare global {
  interface Window {
    __rippleBenchmark?: RippleBenchmarkApi;
  }
}

const MAX_RETAINED_SAMPLES = 30_000;
const MELTDOWN_VOXEL_TIERS = [1, 0.75, 0.5, 0.4, 0.35] as const;
const config = readBenchmarkConfig();
let phase: RenderBenchmarkPhase = "idle";
let startedAtMs: number | null = null;
let stoppedAtMs: number | null = null;
let frameIndex = 0;
let previousFrameTimestampMs: number | null = null;
let metadata: Record<string, unknown> = {};
let samples: RenderBenchmarkFrameSample[] = [];

export function isRenderBenchmarkEnabled(): boolean {
  return config.enabled;
}

export function getRenderBenchmarkConfig(): RenderBenchmarkConfig {
  return config;
}

/** Apply scenario settings before quality-dependent scene resources are built. */
export function applyRenderBenchmarkSettings(settings: LabSettings): void {
  if (!config.enabled) return;

  if (config.scenario === "pretty-arena") {
    settings.qualityId = "pretty";
    settings.voxelSizeMeters = 1;
    settings.arenaRadiusMeters = 200;
    settings.particleDensity = 0.62;
    settings.bloomStrength = 0.14;
    settings.bloomEnabled = true;
    settings.particlesEnabled = true;
    return;
  }

  if (config.scenario === "showoff-track-motion") {
    settings.qualityId = "showoff";
    settings.voxelSizeMeters = 0.9;
    settings.arenaRadiusMeters = 300;
    settings.particleDensity = 0.82;
    settings.bloomStrength = 0.24;
    settings.bloomEnabled = true;
    settings.particlesEnabled = true;
    return;
  }

  settings.qualityId = "meltdown";
  settings.voxelSizeMeters = MELTDOWN_VOXEL_TIERS[config.tier] ?? MELTDOWN_VOXEL_TIERS[0];
  settings.arenaRadiusMeters = 400;
  settings.particleDensity = 1;
  settings.bloomStrength = 0.38;
  settings.bloomEnabled = true;
  settings.particlesEnabled = true;
}

/** Deterministic movement that cannot stall against an Arena/Track boundary. */
export function createRenderBenchmarkMotion(
  timeSeconds: number,
  deltaSeconds: number,
  fieldRadius: number,
  courseSampler: RenderBenchmarkCourseSampler | null
): RenderBenchmarkMotionSample {
  // RaceTrack intentionally returns one of 720 cached centerline samples.
  // A wider velocity window avoids reporting zero speed between sample hops.
  const sampleDelta = courseSampler ? 1 / 12 : Math.max(1 / 120, deltaSeconds);
  const sampleAt = (time: number) => {
    if (courseSampler) {
      return courseSampler(positiveModulo(time * 0.018, 1));
    }
    const angle = time * 0.3;
    const radius = Math.max(4, fieldRadius * 0.44);
    return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
  };
  const current = sampleAt(timeSeconds);
  const previous = sampleAt(timeSeconds - sampleDelta);
  const velocityX = (current.x - previous.x) / sampleDelta;
  const velocityZ = (current.z - previous.z) / sampleDelta;
  return {
    x: current.x,
    z: current.z,
    velocityX,
    velocityZ,
    facingYawRadians: Math.atan2(velocityX, velocityZ)
  };
}

export function setRenderBenchmarkMetadata(nextMetadata: Record<string, unknown>): void {
  if (!config.enabled) return;
  metadata = { ...metadata, ...nextMetadata };
}

export function recordRenderBenchmarkFrame(
  sample: Omit<RenderBenchmarkFrameSample, "frameIndex" | "timestampMs" | "rafIntervalMs">,
  timestampMs = performance.now()
): void {
  if (!config.enabled) return;
  const rafIntervalMs = previousFrameTimestampMs === null
    ? null
    : Math.max(0, timestampMs - previousFrameTimestampMs);
  previousFrameTimestampMs = timestampMs;
  frameIndex += 1;

  if (phase !== "warmup" && phase !== "sample") return;
  samples.push({
    ...sample,
    frameIndex,
    timestampMs,
    rafIntervalMs
  });
  if (samples.length > MAX_RETAINED_SAMPLES) {
    samples.splice(0, samples.length - MAX_RETAINED_SAMPLES);
  }
}

function beginPhase(nextPhase: "warmup" | "sample"): void {
  if (!config.enabled) return;
  if (nextPhase === "sample") samples = [];
  phase = nextPhase;
  startedAtMs = performance.now();
  stoppedAtMs = null;
  previousFrameTimestampMs = null;
}

function stop(): RenderBenchmarkSnapshot {
  if (config.enabled) {
    phase = "complete";
    stoppedAtMs = performance.now();
  }
  return getSnapshot();
}

function reset(): void {
  samples = [];
  phase = "idle";
  startedAtMs = null;
  stoppedAtMs = null;
  frameIndex = 0;
  previousFrameTimestampMs = null;
}

function getSnapshot(): RenderBenchmarkSnapshot {
  return {
    version: 1,
    config,
    phase,
    startedAtMs,
    stoppedAtMs,
    metadata: { ...metadata },
    samples: samples.map((sample) => ({ ...sample, semantic: { ...sample.semantic } }))
  };
}

function readBenchmarkConfig(): RenderBenchmarkConfig {
  if (typeof window === "undefined") {
    return { enabled: false, scenario: "pretty-arena", tier: 0, seed: 1 };
  }

  const query = new URLSearchParams(window.location.search);
  const scenarioValue = query.get("benchmarkScenario");
  const scenario: RenderBenchmarkScenario = scenarioValue === "showoff-track-motion" || scenarioValue === "meltdown-ramp"
    ? scenarioValue
    : "pretty-arena";
  const tier = clampInteger(Number(query.get("benchmarkTier") ?? 0), 0, MELTDOWN_VOXEL_TIERS.length - 1);
  const seed = clampInteger(Number(query.get("benchmarkSeed") ?? 1), 1, 0x7fffffff);
  return {
    enabled: query.get("benchmark") === "1",
    scenario,
    tier,
    seed
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

if (typeof window !== "undefined" && config.enabled) {
  window.__rippleBenchmark = {
    version: 1,
    config,
    beginPhase,
    start: (nextPhase = "sample") => beginPhase(nextPhase),
    stop,
    reset,
    setMetadata: setRenderBenchmarkMetadata,
    getSnapshot,
    getSamples: () => getSnapshot().samples
  };
}
