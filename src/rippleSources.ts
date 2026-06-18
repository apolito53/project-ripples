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
  readonly lifetimeSeconds?: number;
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
  readonly lifetimeSeconds: number;
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
      lifetimeSeconds: finiteOrDefault(normalizedOptions.lifetimeSeconds, RIPPLE_LIFETIME_SECONDS),
      directionAngle: finiteOrDefault(directionAngle, CIRCULAR_SOURCE_DIRECTION),
      hue: (startTime * 0.08 + this.sources.length * 0.17) % 1
    };

    this.sources.unshift(source);
    return source;
  }

  getActiveSources(time: number): readonly RippleSource[] {
    this.pruneExpired(time);
    return this.sources.filter((source) => time - source.startTime < source.lifetimeSeconds);
  }

  getActiveLightSources(time: number): readonly RippleSource[] {
    return this.getActiveSources(time).filter((source) => source.kind === "pulse");
  }

  writeUniforms(
    target: THREE.Vector4[],
    metadataTarget: THREE.Vector4[],
    lifetimeTarget: Float32Array,
    time: number,
    sourceLimit = target.length
  ): number {
    this.pruneExpired(time);

    const maxWrittenSources = Math.max(0, Math.min(target.length, Math.floor(sourceLimit)));
    let writtenCount = 0;
    for (const source of this.sources) {
      if (writtenCount >= maxWrittenSources) break;

      // Uniform layout is deliberately small but no longer arbitrary:
      // - target: x/z position, birth time, amplitude
      // - metadata: speed, width, damping, and optional travel direction
      // - lifetime: source-specific fade horizon so dense wakes can age out
      //   before the fixed WebGL upload budget starts swapping rings around.
      target[writtenCount].set(source.position.x, source.position.z, source.startTime, source.strength);
      metadataTarget[writtenCount].set(
        finiteOrDefault(source.speedMultiplier, 1),
        finiteOrDefault(source.widthMultiplier, 1),
        finiteOrDefault(source.dampingMultiplier, 1),
        finiteOrDefault(source.directionAngle, CIRCULAR_SOURCE_DIRECTION)
      );
      lifetimeTarget[writtenCount] = finiteOrDefault(source.lifetimeSeconds, RIPPLE_LIFETIME_SECONDS);
      writtenCount += 1;
    }

    // Clear the rest of the fixed WebGL uniform array every frame. The shader
    // loop stops at uRippleCount, but stale entries here are confusing during
    // debugging and can leak visual state if the count ever changes mid-frame.
    for (let index = writtenCount; index < target.length; index += 1) {
      target[index].set(0, 0, -999, 0);
      metadataTarget[index].set(1, 1, 1, CIRCULAR_SOURCE_DIRECTION);
      lifetimeTarget[index] = RIPPLE_LIFETIME_SECONDS;
    }

    return writtenCount;
  }

  private pruneExpired(time: number): void {
    for (let index = this.sources.length - 1; index >= 0; index -= 1) {
      if (time - this.sources[index].startTime >= this.sources[index].lifetimeSeconds) {
        this.sources.splice(index, 1);
      }
    }
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
