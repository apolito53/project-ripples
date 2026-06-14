import * as THREE from "three";

// WebGL needs a fixed-size uniform array for ripple uploads. This is now a
// renderer budget, not the gameplay rule that decides when a ripple disappears.
// The manual pulse cooldown plus lifetime should keep normal play below it.
export const MAX_SHADER_RIPPLE_SOURCES = 32;
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
    this.pruneExpired(startTime);

    const source: RippleSource = {
      position: position.clone(),
      startTime,
      strength,
      hue: (startTime * 0.08 + this.sources.length * 0.17) % 1
    };

    this.sources.unshift(source);
    return source;
  }

  getActiveSources(time: number): readonly RippleSource[] {
    this.pruneExpired(time);
    return this.sources.filter((source) => time - source.startTime < RIPPLE_LIFETIME_SECONDS);
  }

  writeUniforms(target: THREE.Vector4[], time: number): number {
    const activeSources = this.getActiveSources(time);
    const writtenCount = Math.min(activeSources.length, target.length);

    for (let index = 0; index < target.length; index += 1) {
      const source = activeSources[index];
      if (!source) {
        target[index].set(0, 0, -999, 0);
        continue;
      }

      // Uniform layout is deliberately tiny: x/z position, birth time, strength.
      // The shader derives age, ring-front distance, and glow falloff from this.
      target[index].set(source.position.x, source.position.z, source.startTime, source.strength);
    }
    return writtenCount;
  }

  private pruneExpired(time: number): void {
    for (let index = this.sources.length - 1; index >= 0; index -= 1) {
      if (time - this.sources[index].startTime >= RIPPLE_LIFETIME_SECONDS) {
        this.sources.splice(index, 1);
      }
    }
  }
}
