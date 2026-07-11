/// <reference types="@webgpu/types" />

import {
  RENDER_SCENE_SHADOW_CASTER_LIMIT,
  type RenderFrameInput,
  type RenderSceneShadowCasterKind,
  type RenderSceneShadowCasterSnapshot
} from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";

const SHADOW_UNIFORM_FLOATS = 8;
const SHADOW_CASTER_FLOATS = 8;
const SHADOW_FRAME_LOG_INTERVAL_SECONDS = 0.5;

export type WebGpuSceneShadowMetrics = {
  readonly mode: "webgpu-scene-shadow-buffer";
  readonly shadowMode: "shadow-map-contact";
  readonly activeShadowCasters: number;
  readonly renderedShadowCasters: number;
  readonly shadowCasterLimit: number;
  readonly shadowStrength: number;
  readonly shadowSoftness: number;
  readonly updateMs: number;
  readonly shadowMapSize?: number;
  readonly shadowMapFormat?: GPUTextureFormat;
  readonly shadowMapPassMs?: number;
  readonly shadowMapPcfTaps?: number;
  readonly shadowMapLightBounds?: number;
  readonly shadowGeometryMode?: string;
  readonly fieldReceiver?: boolean;
  readonly renderedOrbCasters?: number;
  readonly renderedColumnCasters?: number;
  readonly renderedDiscCasters?: number;
  readonly proxyTriangles?: number;
};

export class WebGpuSceneShadowBuffer {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly casterBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(SHADOW_UNIFORM_FLOATS);
  private readonly casterScratch = new Float32Array(RENDER_SCENE_SHADOW_CASTER_LIMIT * SHADOW_CASTER_FLOATS);
  private activeShadowCasters = 0;
  private renderedShadowCasters = 0;
  private shadowStrength = 0;
  private shadowSoftness = 1;
  private updateMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    bindGroupLayout: GPUBindGroupLayout
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU scene shadow uniforms",
      size: SHADOW_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.casterBuffer = device.createBuffer({
      label: "Ripple WebGPU contact shadow caster buffer",
      size: this.casterScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      label: "Ripple WebGPU scene shadow bind group",
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.casterBuffer } }
      ]
    });

    this.log("shadow.webgpu.init", "WebGPU scene contact shadow buffer initialized", {
      mode: "webgpu-scene-shadow-buffer",
      shadowMode: "shadow-map-contact",
      contactMode: "contact-occlusion",
      shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
      packing: "vec4-position-radius + vec4-strength-softness-kind-importance"
    });
  }

  static async create(device: GPUDevice, log: WebGpuDiagnosticLogger): Promise<WebGpuSceneShadowBuffer> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU scene shadow bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }
        ]
      });
      const scopedError = await device.popErrorScope();
      if (scopedError) throw new Error(scopedError.message);

      return new WebGpuSceneShadowBuffer(device, log, bindGroupLayout);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("shadow.webgpu.error", "WebGPU scene shadow buffer failed to initialize", { message }, "error");
      throw new Error(`WebGPU scene shadows failed: ${message}`);
    }
  }

  update(input: RenderFrameInput, deviceLost: boolean): number {
    if (deviceLost) {
      this.updateMs = 0;
      return this.updateMs;
    }

    const startedAt = performance.now();
    const shadows = input.sceneShadows;
    const sortedCasters = [...shadows.casters].sort(compareShadowCasters);
    const renderedCasters = Math.max(
      0,
      Math.min(RENDER_SCENE_SHADOW_CASTER_LIMIT, shadows.casterLimit, sortedCasters.length)
    );

    this.uniforms[0] = Math.max(0, finiteOrDefault(shadows.strength, 0));
    this.uniforms[1] = Math.max(0.1, finiteOrDefault(shadows.softness, 1));
    this.uniforms[2] = finiteOrDefault(input.time, 0);
    this.uniforms[3] = 0;
    this.uniforms[4] = shadows.activeCasters;
    this.uniforms[5] = renderedCasters;
    this.uniforms[6] = RENDER_SCENE_SHADOW_CASTER_LIMIT;
    this.uniforms[7] = 0;

    this.casterScratch.fill(0);
    for (let index = 0; index < renderedCasters; index += 1) {
      const caster = sortedCasters[index];
      const writeOffset = index * SHADOW_CASTER_FLOATS;
      this.casterScratch[writeOffset] = finiteOrDefault(caster.position.x, 0);
      this.casterScratch[writeOffset + 1] = finiteOrDefault(caster.position.y, 0);
      this.casterScratch[writeOffset + 2] = finiteOrDefault(caster.position.z, 0);
      this.casterScratch[writeOffset + 3] = Math.max(0.1, finiteOrDefault(caster.radius, 1));
      this.casterScratch[writeOffset + 4] = Math.max(0, finiteOrDefault(caster.strength, 0));
      this.casterScratch[writeOffset + 5] = Math.max(0.1, finiteOrDefault(caster.softness, 1));
      this.casterScratch[writeOffset + 6] = shadowKindId(caster.kind);
      this.casterScratch[writeOffset + 7] = finiteOrDefault(caster.importance, 0);
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
    this.device.queue.writeBuffer(this.casterBuffer, 0, this.casterScratch);
    this.activeShadowCasters = shadows.activeCasters;
    this.renderedShadowCasters = renderedCasters;
    this.shadowStrength = shadows.strength;
    this.shadowSoftness = shadows.softness;
    this.updateMs = performance.now() - startedAt;
    this.maybeLogFrame(input, deviceLost);
    return this.updateMs;
  }

  getBindGroupLayout(): GPUBindGroupLayout {
    return this.bindGroupLayout;
  }

  getBindGroup(): GPUBindGroup {
    return this.bindGroup;
  }

  getMetrics(): WebGpuSceneShadowMetrics {
    return {
      mode: "webgpu-scene-shadow-buffer",
      shadowMode: "shadow-map-contact",
      activeShadowCasters: this.activeShadowCasters,
      renderedShadowCasters: this.renderedShadowCasters,
      shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
      shadowStrength: this.shadowStrength,
      shadowSoftness: this.shadowSoftness,
      updateMs: this.updateMs
    };
  }

  dispose(): void {
    this.casterBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < SHADOW_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("shadow.webgpu.frame", "WebGPU scene contact shadow frame sample", {
      mode: "webgpu-scene-shadow-buffer",
      scenePresentationMode: input.scenePresentation.mode,
      shadowMode: "shadow-map-contact",
      contactMode: "contact-occlusion",
      activeShadowCasters: this.activeShadowCasters,
      renderedShadowCasters: this.renderedShadowCasters,
      shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
      shadowStrength: roundMetric(this.shadowStrength),
      shadowSoftness: roundMetric(this.shadowSoftness),
      updateMs: roundMetric(this.updateMs),
      deviceLost
    }, "debug");
  }
}

function compareShadowCasters(a: RenderSceneShadowCasterSnapshot, b: RenderSceneShadowCasterSnapshot): number {
  return b.importance - a.importance;
}

function shadowKindId(kind: RenderSceneShadowCasterKind): number {
  switch (kind) {
    case "avatar":
      return 1;
    case "echo":
      return 2;
    case "echo-burst":
      return 3;
    case "pulse":
      return 4;
    default:
      return 0;
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
