import * as THREE from "three";

// WebGL needs a fixed-size uniform array for ripple uploads. This is now a
// renderer budget, not the gameplay rule that decides when a ripple disappears.
// Manual pulse cooldown, movement-wake spacing, and lifetime pruning should keep
// normal play below it while still allowing several overlapping propagating waves.
export const MAX_SHADER_RIPPLE_SOURCES = 32;
export const RIPPLE_LIFETIME_SECONDS = 7.5;

export type RippleSourceKind = "pulse" | "wake";

const CIRCULAR_SOURCE_DIRECTION = -99;

export type RippleSourceOptions = {
  readonly kind?: RippleSourceKind;
  readonly speedMultiplier?: number;
  readonly widthMultiplier?: number;
  readonly dampingMultiplier?: number;
  readonly direction?: THREE.Vector3;
};

export type RippleSource = {
  readonly position: THREE.Vector3;
  readonly startTime: number;
  readonly strength: number;
  readonly kind: RippleSourceKind;
  readonly speedMultiplier: number;
  readonly widthMultiplier: number;
  readonly dampingMultiplier: number;
  readonly directionAngle: number;
  readonly hue: number;
};

export class RippleSourceStore {
  private readonly sources: RippleSource[] = [];

  add(
    position: THREE.Vector3,
    startTime: number,
    strength = 1,
    options: RippleSourceKind | RippleSourceOptions = "pulse"
  ): RippleSource {
    this.pruneExpired(startTime);
    const normalizedOptions = typeof options === "string" ? { kind: options } : options;
    const directionAngle = normalizedOptions.direction
      ? Math.atan2(normalizedOptions.direction.z, normalizedOptions.direction.x)
      : CIRCULAR_SOURCE_DIRECTION;

    const source: RippleSource = {
      position: position.clone(),
      startTime,
      strength,
      kind: normalizedOptions.kind ?? "pulse",
      speedMultiplier: finiteOrDefault(normalizedOptions.speedMultiplier, 1),
      widthMultiplier: finiteOrDefault(normalizedOptions.widthMultiplier, 1),
      dampingMultiplier: finiteOrDefault(normalizedOptions.dampingMultiplier, 1),
      directionAngle: finiteOrDefault(directionAngle, CIRCULAR_SOURCE_DIRECTION),
      hue: (startTime * 0.08 + this.sources.length * 0.17) % 1
    };

    this.sources.unshift(source);
    return source;
  }

  getActiveSources(time: number): readonly RippleSource[] {
    this.pruneExpired(time);
    return this.sources.filter((source) => time - source.startTime < RIPPLE_LIFETIME_SECONDS);
  }

  getActiveLightSources(time: number): readonly RippleSource[] {
    return this.getActiveSources(time).filter((source) => source.kind === "pulse");
  }

  writeUniforms(target: THREE.Vector4[], metadataTarget: THREE.Vector4[], time: number): number {
    const activeSources = this.selectUploadSources(this.getActiveSources(time), target.length);
    const writtenCount = activeSources.length;

    for (let index = 0; index < target.length; index += 1) {
      const source = activeSources[index];
      if (!source) {
        target[index].set(0, 0, -999, 0);
        metadataTarget[index].set(1, 1, 1, CIRCULAR_SOURCE_DIRECTION);
        continue;
      }

      // Uniform layout is deliberately small but no longer arbitrary:
      // - target: x/z position, birth time, amplitude
      // - metadata: speed, width, damping, and optional travel direction
      target[index].set(source.position.x, source.position.z, source.startTime, source.strength);
      metadataTarget[index].set(
        finiteOrDefault(source.speedMultiplier, 1),
        finiteOrDefault(source.widthMultiplier, 1),
        finiteOrDefault(source.dampingMultiplier, 1),
        finiteOrDefault(source.directionAngle, CIRCULAR_SOURCE_DIRECTION)
      );
    }
    return writtenCount;
  }

  private selectUploadSources(sources: readonly RippleSource[], capacity: number): readonly RippleSource[] {
    if (sources.length <= capacity) return sources;

    const pulseSources = sources.filter((source) => source.kind === "pulse");
    const wakeSources = sources.filter((source) => source.kind === "wake");
    const selected = pulseSources.slice(0, capacity);
    const remainingSlots = capacity - selected.length;
    if (remainingSlots <= 0) return selected;

    // If movement ever creates more wake rings than the shader can upload, keep
    // a time-spaced sample instead of blindly taking only the newest ones. That
    // prevents the farthest visible wake from being the first thing to vanish.
    const step = Math.max(1, wakeSources.length / remainingSlots);
    for (let slot = 0; slot < remainingSlots; slot += 1) {
      const source = wakeSources[Math.floor(slot * step)];
      if (source) selected.push(source);
    }

    return selected.sort((left, right) => right.startTime - left.startTime);
  }

  private pruneExpired(time: number): void {
    for (let index = this.sources.length - 1; index >= 0; index -= 1) {
      if (time - this.sources[index].startTime >= RIPPLE_LIFETIME_SECONDS) {
        this.sources.splice(index, 1);
      }
    }
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
