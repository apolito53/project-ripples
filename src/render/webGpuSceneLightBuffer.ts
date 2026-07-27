/// <reference types="@webgpu/types" />

import {
  RENDER_SCENE_LOCAL_LIGHT_LIMIT,
  type RenderFrameInput,
  type RenderSceneLocalLightSnapshot
} from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";

const LIGHT_UNIFORM_FLOATS = 48;
const LOCAL_LIGHT_FLOATS = 8;
const LIGHT_FRAME_LOG_INTERVAL_SECONDS = 0.5;

export type WebGpuSceneLightMetrics = {
  readonly mode: "webgpu-scene-light-buffer";
  readonly activeLocalLights: number;
  readonly renderedLocalLights: number;
  readonly localLightLimit: number;
  readonly ambientIntensity: number;
  readonly keyIntensity: number;
  readonly rimIntensity: number;
  readonly updateMs: number;
};

export class WebGpuSceneLightBuffer {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly localLightBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(LIGHT_UNIFORM_FLOATS);
  private readonly localLightScratch = new Float32Array(RENDER_SCENE_LOCAL_LIGHT_LIMIT * LOCAL_LIGHT_FLOATS);
  private activeLocalLights = 0;
  private renderedLocalLights = 0;
  private ambientIntensity = 0;
  private keyIntensity = 0;
  private rimIntensity = 0;
  private updateMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    bindGroupLayout: GPUBindGroupLayout
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU scene lighting uniforms",
      size: LIGHT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.localLightBuffer = device.createBuffer({
      label: "Ripple WebGPU local light buffer",
      size: this.localLightScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      label: "Ripple WebGPU scene lighting bind group",
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.localLightBuffer } }
      ]
    });

    this.log("lighting.webgpu.init", "WebGPU scene lighting buffer initialized", {
      mode: "webgpu-scene-light-buffer",
      localLightLimit: RENDER_SCENE_LOCAL_LIGHT_LIMIT,
      packing: "ambient/directional + key/rim spotlight fixtures + vec4 local lights"
    });
  }

  static async create(device: GPUDevice, log: WebGpuDiagnosticLogger): Promise<WebGpuSceneLightBuffer> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU scene lighting bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }
        ]
      });
      const scopedError = await device.popErrorScope();
      if (scopedError) throw new Error(scopedError.message);

      return new WebGpuSceneLightBuffer(device, log, bindGroupLayout);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("lighting.webgpu.error", "WebGPU scene lighting buffer failed to initialize", { message }, "error");
      throw new Error(`WebGPU scene lighting failed: ${message}`);
    }
  }

  update(input: RenderFrameInput, deviceLost: boolean): number {
    if (deviceLost) {
      this.updateMs = 0;
      return this.updateMs;
    }

    const startedAt = performance.now();
    const lighting = input.sceneLighting;
    const sortedLights = [...lighting.localLights].sort(compareLocalLights);
    const renderedLights = Math.max(
      0,
      Math.min(RENDER_SCENE_LOCAL_LIGHT_LIMIT, lighting.localLightLimit, sortedLights.length)
    );

    this.uniforms[0] = finiteOrDefault(lighting.ambientColor.x, 0.02);
    this.uniforms[1] = finiteOrDefault(lighting.ambientColor.y, 0.04);
    this.uniforms[2] = finiteOrDefault(lighting.ambientColor.z, 0.05);
    this.uniforms[3] = finiteOrDefault(lighting.ambientIntensity, 0.3);
    this.uniforms[4] = finiteOrDefault(lighting.keyDirection.x, -0.26);
    this.uniforms[5] = finiteOrDefault(lighting.keyDirection.y, 0.82);
    this.uniforms[6] = finiteOrDefault(lighting.keyDirection.z, 0.48);
    this.uniforms[7] = finiteOrDefault(lighting.keyIntensity, 0.7);
    this.uniforms[8] = finiteOrDefault(lighting.keyColor.x, 0.7);
    this.uniforms[9] = finiteOrDefault(lighting.keyColor.y, 0.9);
    this.uniforms[10] = finiteOrDefault(lighting.keyColor.z, 1);
    this.uniforms[11] = 0;
    this.uniforms[12] = finiteOrDefault(lighting.rimDirection.x, 0.4);
    this.uniforms[13] = finiteOrDefault(lighting.rimDirection.y, 0.45);
    this.uniforms[14] = finiteOrDefault(lighting.rimDirection.z, -0.78);
    this.uniforms[15] = finiteOrDefault(lighting.rimIntensity, 0.26);
    this.uniforms[16] = finiteOrDefault(lighting.rimColor.x, 1);
    this.uniforms[17] = finiteOrDefault(lighting.rimColor.y, 0.48);
    this.uniforms[18] = finiteOrDefault(lighting.rimColor.z, 0.92);
    this.uniforms[19] = 0;
    this.uniforms[20] = lighting.activeLocalLights;
    this.uniforms[21] = renderedLights;
    this.uniforms[22] = RENDER_SCENE_LOCAL_LIGHT_LIMIT;
    this.uniforms[23] = input.time;
    writeSpotLightUniforms(this.uniforms, 24, lighting.keySpotLight);
    writeSpotLightUniforms(this.uniforms, 36, lighting.rimSpotLight);

    this.localLightScratch.fill(0);
    for (let index = 0; index < renderedLights; index += 1) {
      const light = sortedLights[index];
      const writeOffset = index * LOCAL_LIGHT_FLOATS;
      this.localLightScratch[writeOffset] = finiteOrDefault(light.position.x, 0);
      this.localLightScratch[writeOffset + 1] = finiteOrDefault(light.position.y, 0);
      this.localLightScratch[writeOffset + 2] = finiteOrDefault(light.position.z, 0);
      this.localLightScratch[writeOffset + 3] = Math.max(0.01, finiteOrDefault(light.radius, 1));
      this.localLightScratch[writeOffset + 4] = finiteOrDefault(light.color.x, 1);
      this.localLightScratch[writeOffset + 5] = finiteOrDefault(light.color.y, 1);
      this.localLightScratch[writeOffset + 6] = finiteOrDefault(light.color.z, 1);
      this.localLightScratch[writeOffset + 7] = Math.max(0, finiteOrDefault(light.intensity, 0));
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
    this.device.queue.writeBuffer(this.localLightBuffer, 0, this.localLightScratch);
    this.activeLocalLights = lighting.activeLocalLights;
    this.renderedLocalLights = renderedLights;
    this.ambientIntensity = lighting.ambientIntensity;
    this.keyIntensity = lighting.keyIntensity;
    this.rimIntensity = lighting.rimIntensity;
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

  getMetrics(): WebGpuSceneLightMetrics {
    return {
      mode: "webgpu-scene-light-buffer",
      activeLocalLights: this.activeLocalLights,
      renderedLocalLights: this.renderedLocalLights,
      localLightLimit: RENDER_SCENE_LOCAL_LIGHT_LIMIT,
      ambientIntensity: this.ambientIntensity,
      keyIntensity: this.keyIntensity,
      rimIntensity: this.rimIntensity,
      updateMs: this.updateMs
    };
  }

  dispose(): void {
    this.localLightBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < LIGHT_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("lighting.webgpu.frame", "WebGPU scene lighting frame sample", {
      mode: "webgpu-scene-light-buffer",
      scenePresentationMode: input.scenePresentation.mode,
      activeLocalLights: this.activeLocalLights,
      renderedLocalLights: this.renderedLocalLights,
      localLightLimit: RENDER_SCENE_LOCAL_LIGHT_LIMIT,
      ambientIntensity: roundMetric(this.ambientIntensity),
      keyIntensity: roundMetric(this.keyIntensity),
      rimIntensity: roundMetric(this.rimIntensity),
      keySpotIntensity: roundMetric(input.sceneLighting.keySpotLight.intensity),
      keySpotRange: roundMetric(input.sceneLighting.keySpotLight.range),
      rimSpotIntensity: roundMetric(input.sceneLighting.rimSpotLight.intensity),
      rimSpotRange: roundMetric(input.sceneLighting.rimSpotLight.range),
      updateMs: roundMetric(this.updateMs),
      deviceLost
    }, "debug");
  }
}

function writeSpotLightUniforms(
  target: Float32Array,
  offset: number,
  light: RenderFrameInput["sceneLighting"]["keySpotLight"]
): void {
  const angle = Math.max(0.01, finiteOrDefault(light.angleRadians, 1.08));
  const penumbra = Math.min(1, Math.max(0, finiteOrDefault(light.penumbra, 0.74)));
  target[offset] = finiteOrDefault(light.position.x, 0);
  target[offset + 1] = finiteOrDefault(light.position.y, 24);
  target[offset + 2] = finiteOrDefault(light.position.z, 0);
  target[offset + 3] = Math.max(0.1, finiteOrDefault(light.range, 150));
  target[offset + 4] = finiteOrDefault(light.direction.x, 0);
  target[offset + 5] = finiteOrDefault(light.direction.y, -1);
  target[offset + 6] = finiteOrDefault(light.direction.z, 0);
  target[offset + 7] = Math.max(0, finiteOrDefault(light.intensity, 0));
  target[offset + 8] = Math.cos(angle);
  target[offset + 9] = Math.cos(angle * (1 - penumbra));
  target[offset + 10] = Math.max(0, finiteOrDefault(light.decay, 1.18));
  target[offset + 11] = 0;
}

function compareLocalLights(a: RenderSceneLocalLightSnapshot, b: RenderSceneLocalLightSnapshot): number {
  return b.importance - a.importance;
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
