import type * as THREE from "three";
import type { QualityPreset } from "../qualityPresets";
import type { WaveMediumSettings } from "../waveMedium";

export type WakeFieldMode = "gpu-half-float" | "gpu-ubyte" | "noop";

export type WakeFieldMetrics = {
  readonly mode: WakeFieldMode;
  readonly textureSize: number;
  readonly passMs: number;
  readonly fallbackReason: string;
  readonly supportsVertexTextures: boolean;
  readonly movementSourceAddsSinceLastFrame: number;
  readonly playerGroundContact: number;
};

export type WakeFieldRenderInput = {
  readonly time: number;
  readonly delta: number;
  readonly fieldRadius: number;
  readonly playerPosition: THREE.Vector3;
  readonly previousPlayerPosition: THREE.Vector3;
  readonly playerVelocity: THREE.Vector3;
  readonly playerSpeed: number;
  readonly playerGroundContact: number;
  readonly waveMedium: WaveMediumSettings;
  readonly activeRippleSourceCount: number;
  readonly renderedRippleSourceCount: number;
  readonly hexCount: number;
  readonly qualityId: string;
};

export interface WakeFieldBackend {
  render(input: WakeFieldRenderInput): void;
  prewarm(input: WakeFieldRenderInput): void;
  resizeForPreset(preset: QualityPreset, reason?: string): void;
  reset(reason?: string): void;
  getTexture(): THREE.Texture;
  supportsVertexTextureSampling(): boolean;
  getMetrics(): WakeFieldMetrics;
  dispose(): void;
}
