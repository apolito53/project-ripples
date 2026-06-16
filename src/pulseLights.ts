import * as THREE from "three";
import { RIPPLE_LIFETIME_SECONDS, type RippleSource } from "./rippleSources";

const LIGHT_COLORS = [
  new THREE.Color(0x7dffd8),
  new THREE.Color(0x7d95ff),
  new THREE.Color(0xffd36a),
  new THREE.Color(0xff7de7)
] as const;

export class PulseLightRig {
  private readonly lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene, count: number) {
    for (let index = 0; index < count; index += 1) {
      const light = new THREE.PointLight(0x7dffd8, 0, 18, 2.2);
      light.name = `Ripple pulse light ${index + 1}`;
      scene.add(light);
      this.lights.push(light);
    }
  }

  resize(scene: THREE.Scene, count: number): PulseLightRig {
    this.dispose();
    return new PulseLightRig(scene, count);
  }

  update(
    sources: readonly RippleSource[],
    time: number,
    intensityScale: number,
    basePropagationSpeed: number
  ): void {
    for (let index = 0; index < this.lights.length; index += 1) {
      const source = sources[index];
      const light = this.lights[index];
      if (!source) {
        light.intensity = 0;
        continue;
      }

      const age = time - source.startTime;
      const lifetime = Number.isFinite(source.lifetimeSeconds)
        ? source.lifetimeSeconds
        : RIPPLE_LIFETIME_SECONDS;
      const fade = Math.max(0, 1 - age / lifetime);
      const pulse = Math.sin(age * 9) * 0.5 + 0.5;
      const speedMultiplier = Number.isFinite(source.speedMultiplier) ? source.speedMultiplier : 1;
      light.color.copy(LIGHT_COLORS[index % LIGHT_COLORS.length]);
      light.position.set(source.position.x, source.position.y + 2.4 + pulse * 0.8, source.position.z);
      light.intensity = intensityScale * source.strength * fade * (0.75 + pulse * 1.15);
      // Keep the light halo tied to the same propagation model as the cube
      // shader, just scaled down so it supports the ring instead of flooding it.
      light.distance = 5.8 + age * basePropagationSpeed * speedMultiplier * 0.42;
    }
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
    this.lights.length = 0;
  }
}
