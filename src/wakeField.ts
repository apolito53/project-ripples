import type * as THREE from "three";
import type { QualityPreset } from "./qualityPresets";
import { WebGlWakeFieldBackend } from "./wake/webGlWakeFieldBackend";
import type { WakeFieldBackend, WakeFieldMetrics, WakeFieldRenderInput } from "./wake/types";

export type {
  WakeFieldBackend,
  WakeFieldMetrics,
  WakeFieldMode,
  WakeFieldRenderInput
} from "./wake/types";

export class WakeField {
  private readonly backend: WakeFieldBackend;

  constructor(renderer: THREE.WebGLRenderer, preset: QualityPreset) {
    this.backend = new WebGlWakeFieldBackend(renderer, preset);
  }

  render(input: WakeFieldRenderInput): void {
    this.backend.render(input);
  }

  prewarm(input: WakeFieldRenderInput): void {
    this.backend.prewarm(input);
  }

  resizeForPreset(preset: QualityPreset, reason = "quality"): void {
    this.backend.resizeForPreset(preset, reason);
  }

  reset(reason = "manual"): void {
    this.backend.reset(reason);
  }

  getTexture(): THREE.Texture {
    return this.backend.getTexture();
  }

  supportsVertexTextureSampling(): boolean {
    return this.backend.supportsVertexTextureSampling();
  }

  getMetrics(): WakeFieldMetrics {
    return this.backend.getMetrics();
  }

  dispose(): void {
    this.backend.dispose();
  }
}
