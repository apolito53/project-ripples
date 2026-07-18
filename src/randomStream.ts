export type RandomSource = () => number;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Creates a deterministic stream whose sequence depends only on the base seed
 * and its stable name. Unrelated renderer initialization can consume global
 * randomness without shifting this stream.
 */
export function createNamedRandomSource(baseSeed: number, streamName: string): RandomSource {
  let state = mixSeed(normalizeSeed(baseSeed), hashString(streamName));

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a non-deterministic session seed without depending on renderer order. */
export function createEntropySeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  }

  const timeSeed = Date.now() >>> 0;
  const performanceSeed = typeof performance === "undefined"
    ? 0
    : Math.floor(performance.now() * 1000) >>> 0;
  return mixSeed(timeSeed, performanceSeed) || 1;
}

function normalizeSeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.trunc(value) >>> 0 || 1;
}

function hashString(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), FNV_PRIME);
  }
  return hash >>> 0;
}

function mixSeed(left: number, right: number): number {
  let value = (left ^ right ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}
