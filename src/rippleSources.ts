import * as THREE from "three";

// WebGL needs a fixed-size uniform array for ripple uploads. This is now a
// renderer budget, not the gameplay rule that decides when a ripple disappears.
// Manual pulse cooldown, Echo collection cadence, and lifetime pruning should
// keep normal play below it while still allowing overlapping propagating waves.
export const MAX_SHADER_RIPPLE_SOURCES = 32;
export const RIPPLE_LIFETIME_SECONDS = 7.5;

export type RippleSourceKind = "pulse";

export type RippleSourceOptions = {
  readonly kind?: RippleSourceKind;
  readonly speedMultiplier?: number;
  readonly widthMultiplier?: number;
  readonly dampingMultiplier?: number;
  readonly lifetimeSeconds?: number;
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
  readonly hue: number;
};

export type RippleRenderSource = {
  readonly positionX: number;
  readonly positionZ: number;
  readonly startTime: number;
  readonly strength: number;
  readonly kind: RippleSourceKind;
  readonly speedMultiplier: number;
  readonly widthMultiplier: number;
  readonly dampingMultiplier: number;
  readonly lifetimeSeconds: number;
  readonly hue: number;
};

export type RippleRenderSourceSnapshot = {
  readonly time: number;
  readonly sourceLimit: number;
  readonly activeCount: number;
  readonly renderedCount: number;
  readonly sources: readonly RippleRenderSource[];
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

    const source: RippleSource = {
      position: position.clone(),
      startTime,
      strength,
      kind: normalizedOptions.kind ?? "pulse",
      speedMultiplier: finiteOrDefault(normalizedOptions.speedMultiplier, 1),
      widthMultiplier: finiteOrDefault(normalizedOptions.widthMultiplier, 1),
      dampingMultiplier: finiteOrDefault(normalizedOptions.dampingMultiplier, 1),
      lifetimeSeconds: finiteOrDefault(normalizedOptions.lifetimeSeconds, RIPPLE_LIFETIME_SECONDS),
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

  getRenderSourceSnapshot(time: number, sourceLimit = MAX_SHADER_RIPPLE_SOURCES): RippleRenderSourceSnapshot {
    this.pruneExpired(time);

    const maxRenderedSources = Math.max(0, Math.floor(sourceLimit));
    const renderedSources = this.sources
      .slice(0, maxRenderedSources)
      .map(toRenderSource);

    return {
      time,
      sourceLimit: maxRenderedSources,
      activeCount: this.sources.length,
      renderedCount: renderedSources.length,
      sources: renderedSources
    };
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

function toRenderSource(source: RippleSource): RippleRenderSource {
  return {
    positionX: source.position.x,
    positionZ: source.position.z,
    startTime: source.startTime,
    strength: source.strength,
    kind: source.kind,
    speedMultiplier: finiteOrDefault(source.speedMultiplier, 1),
    widthMultiplier: finiteOrDefault(source.widthMultiplier, 1),
    dampingMultiplier: finiteOrDefault(source.dampingMultiplier, 1),
    lifetimeSeconds: finiteOrDefault(source.lifetimeSeconds, RIPPLE_LIFETIME_SECONDS),
    hue: source.hue
  };
}
