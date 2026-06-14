import * as THREE from "three";

export const MAX_RIPPLE_SOURCES = 8;
export const RIPPLE_LIFETIME_SECONDS = 7.5;

export type RippleSource = {
  readonly position: THREE.Vector3;
  readonly startTime: number;
  readonly strength: number;
  readonly hue: number;
};

export class RippleSourceStore {
  private readonly sources: RippleSource[] = [];

  add(position: THREE.Vector3, startTime: number, strength = 1): RippleSource {
    const source: RippleSource = {
      position: position.clone(),
      startTime,
      strength,
      hue: (startTime * 0.08 + this.sources.length * 0.17) % 1
    };

    this.sources.unshift(source);
    this.sources.length = Math.min(this.sources.length, MAX_RIPPLE_SOURCES);
    return source;
  }

  getActiveSources(time: number): readonly RippleSource[] {
    return this.sources.filter((source) => time - source.startTime < RIPPLE_LIFETIME_SECONDS);
  }

  writeUniforms(target: THREE.Vector4[], time: number): number {
    const activeSources = this.getActiveSources(time);
    for (let index = 0; index < MAX_RIPPLE_SOURCES; index += 1) {
      const source = activeSources[index];
      if (!source) {
        target[index].set(0, 0, -999, 0);
        continue;
      }

      // Uniform layout is deliberately tiny: x/z position, birth time, strength.
      // The shader derives age, ring-front distance, and glow falloff from this.
      target[index].set(source.position.x, source.position.z, source.startTime, source.strength);
    }
    return activeSources.length;
  }
}
