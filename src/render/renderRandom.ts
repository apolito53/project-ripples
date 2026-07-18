import { createEntropySeed, createNamedRandomSource, type RandomSource } from "../randomStream";
import { getRenderBenchmarkConfig } from "./renderBenchmark";

export type RenderRandomSourceDescriptor = {
  readonly streamName: string;
  readonly baseSeed: number;
  readonly seedMode: "visual-capture" | "benchmark" | "session-entropy";
};

type CachedRenderRandomSource = {
  readonly source: RandomSource;
  readonly descriptor: RenderRandomSourceDescriptor;
};

const cachedSources = new Map<string, CachedRenderRandomSource>();
const sessionSeed = resolveSessionSeed();

/** Returns one persistent named stream for the lifetime of the current page. */
export function getRenderRandomSource(streamName: string): RandomSource {
  return getCachedSource(streamName).source;
}

export function getRenderRandomSourceDescriptor(streamName: string): RenderRandomSourceDescriptor {
  return getCachedSource(streamName).descriptor;
}

function getCachedSource(streamName: string): CachedRenderRandomSource {
  const cached = cachedSources.get(streamName);
  if (cached) return cached;

  const descriptor = Object.freeze({
    streamName,
    baseSeed: sessionSeed.baseSeed,
    seedMode: sessionSeed.seedMode
  });
  const next = {
    source: createNamedRandomSource(descriptor.baseSeed, descriptor.streamName),
    descriptor
  };
  cachedSources.set(streamName, next);
  return next;
}

function resolveSessionSeed(): Omit<RenderRandomSourceDescriptor, "streamName"> {
  const captureSeed = readVisualCaptureSeed();
  if (captureSeed !== null) {
    return { baseSeed: captureSeed, seedMode: "visual-capture" };
  }

  const benchmark = getRenderBenchmarkConfig();
  if (benchmark.enabled) {
    return { baseSeed: benchmark.seed, seedMode: "benchmark" };
  }

  return { baseSeed: createEntropySeed(), seedMode: "session-entropy" };
}

function readVisualCaptureSeed(): number | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get("visualCapture") !== "1") return null;

  const value = Number(query.get("visualCaptureSeed"));
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value) >>> 0 || 1;
}
