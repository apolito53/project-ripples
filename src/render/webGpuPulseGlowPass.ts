/// <reference types="@webgpu/types" />

import { RIPPLE_LIFETIME_SECONDS, type RippleRenderSourceSnapshot } from "../rippleSources";
import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import { getBasePropagationSpeedMetersPerSecond } from "../waveMedium";
import type { RenderFrameInput, RenderVector3Snapshot } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import pulseGlowSource from "./webGpuPulseGlowPass.wgsl?raw";

const PULSE_UNIFORM_FLOATS = 28;
const PULSE_FLOATS = 8;
const MAX_WEBGPU_PULSE_GLOWS = 8;
const PULSE_VERTEX_COUNT = 6;
const PULSE_TRIANGLES_PER_INSTANCE = 2;
const PULSE_FRAME_LOG_INTERVAL_SECONDS = 0.5;

export type WebGpuPulseGlowPassMetrics = {
  readonly mode: "webgpu-pulse-glow";
  readonly presentationMode: "core-proxy" | "disabled-classic";
  readonly activeSources: number;
  readonly renderedGlows: number;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuPulseGlowFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuPulseGlowPass {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly pulseBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(PULSE_UNIFORM_FLOATS);
  private readonly pulseScratch = new Float32Array(MAX_WEBGPU_PULSE_GLOWS * PULSE_FLOATS);
  private activeSources = 0;
  private renderedGlows = 0;
  private presentationMode: WebGpuPulseGlowPassMetrics["presentationMode"] = "disabled-classic";
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    bindGroupLayout: GPUBindGroupLayout,
    pipeline: GPURenderPipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU pulse glow uniforms",
      size: PULSE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.pulseBuffer = device.createBuffer({
      label: "Ripple WebGPU pulse glow source buffer",
      size: this.pulseScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.log("pulseLight.webgpu.init", "WebGPU pulse glow proxy initialized", {
      mode: "webgpu-pulse-glow",
      pulseGlowLimit: MAX_WEBGPU_PULSE_GLOWS,
      classicMode: "disabled",
      coreMode: "core-proxy",
      depthMode: "field-depth-read",
      drawCalls: 1,
      trianglesPerGlow: PULSE_TRIANGLES_PER_INSTANCE
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuPulseGlowPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU pulse glow bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU pulse glow shader",
        code: pulseGlowSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU pulse glow pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU pulse glow pipeline layout",
          bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: { module: shaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [{
            format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
            }
          }]
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: FIELD_DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: "less-equal"
        }
      });
      const scopedError = await device.popErrorScope();
      if (scopedError) throw new Error(scopedError.message);

      return new WebGpuPulseGlowPass(device, log, bindGroupLayout, pipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("pulseLight.webgpu.error", "WebGPU pulse glow proxy failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU pulse glow pass failed: ${message}`);
    }
  }

  render(input: WebGpuPulseGlowFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    if (input.renderInput.scenePresentation.profile === "classic") {
      this.activeSources = input.renderInput.pulseSources.activeCount;
      this.renderedGlows = 0;
      this.presentationMode = "disabled-classic";
      this.passMs = performance.now() - startedAt;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    this.presentationMode = "core-proxy";
    const renderedGlows = this.writePulseBuffer(input.renderInput.pulseSources);
    this.writeUniforms(input.renderInput);

    if (renderedGlows <= 0) {
      this.passMs = performance.now() - startedAt;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU pulse glow bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.pulseBuffer } }
      ]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU pulse glow render pass",
      colorAttachments: [{
        view: input.targetView,
        loadOp: "load",
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: input.depthTextureView,
        depthLoadOp: "load",
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(PULSE_VERTEX_COUNT, renderedGlows);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuPulseGlowPassMetrics {
    return {
      mode: "webgpu-pulse-glow",
      presentationMode: this.presentationMode,
      activeSources: this.activeSources,
      renderedGlows: this.renderedGlows,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: this.renderedGlows > 0 ? 1 : 0,
      triangles: this.renderedGlows * PULSE_TRIANGLES_PER_INSTANCE
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return {
      drawCalls: this.renderedGlows > 0 ? 1 : 0,
      triangles: this.renderedGlows * PULSE_TRIANGLES_PER_INSTANCE
    };
  }

  dispose(): void {
    this.pulseBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private writeUniforms(input: RenderFrameInput): void {
    for (let index = 0; index < 16; index += 1) {
      const identityFallback = index % 5 === 0 ? 1 : 0;
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], identityFallback);
    }

    const right = rotateBasisByQuaternion({ x: 1, y: 0, z: 0 }, input.camera.quaternion);
    const up = rotateBasisByQuaternion({ x: 0, y: 1, z: 0 }, input.camera.quaternion);
    this.uniforms[16] = right.x;
    this.uniforms[17] = right.y;
    this.uniforms[18] = right.z;
    this.uniforms[19] = 0;
    this.uniforms[20] = up.x;
    this.uniforms[21] = up.y;
    this.uniforms[22] = up.z;
    this.uniforms[23] = 0;
    this.uniforms[24] = input.time;
    this.uniforms[25] = getBasePropagationSpeedMetersPerSecond(input.settings.waveMedium);
    this.uniforms[26] = 0;
    this.uniforms[27] = this.renderedGlows;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private writePulseBuffer(snapshot: RippleRenderSourceSnapshot): number {
    const renderedGlows = Math.max(0, Math.min(MAX_WEBGPU_PULSE_GLOWS, snapshot.sources.length));
    this.pulseScratch.fill(0);

    for (let index = 0; index < renderedGlows; index += 1) {
      const source = snapshot.sources[index];
      const writeOffset = index * PULSE_FLOATS;
      this.pulseScratch[writeOffset] = finiteOrDefault(source.positionX, 0);
      this.pulseScratch[writeOffset + 1] = finiteOrDefault(source.positionZ, 0);
      this.pulseScratch[writeOffset + 2] = finiteOrDefault(source.startTime, snapshot.time);
      this.pulseScratch[writeOffset + 3] = finiteOrDefault(source.strength, 0);
      this.pulseScratch[writeOffset + 4] = finiteOrDefault(source.speedMultiplier, 1);
      this.pulseScratch[writeOffset + 5] = finiteOrDefault(source.widthMultiplier, 1);
      // The field consumes damping, while this presentation proxy needs the
      // source-specific lifetime so short jump pulses do not linger for the
      // global manual-pulse horizon.
      this.pulseScratch[writeOffset + 6] = finiteOrDefault(
        source.lifetimeSeconds,
        RIPPLE_LIFETIME_SECONDS
      );
      this.pulseScratch[writeOffset + 7] = finiteOrDefault(source.hue, index % 2 === 0 ? 0.2 : 0.75);
    }

    this.device.queue.writeBuffer(this.pulseBuffer, 0, this.pulseScratch);
    this.activeSources = snapshot.activeCount;
    this.renderedGlows = renderedGlows;
    return renderedGlows;
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < PULSE_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("pulseLight.webgpu.frame", "WebGPU pulse glow proxy frame sample", {
      mode: "webgpu-pulse-glow",
      presentationMode: this.presentationMode,
      presentationProfile: input.scenePresentation.profile,
      scenePresentationMode: input.scenePresentation.mode,
      activeSources: this.activeSources,
      renderedGlows: this.renderedGlows,
      depthMode: "field-depth-read",
      passMs: roundMetric(this.passMs),
      drawCalls: this.renderedGlows > 0 ? 1 : 0,
      triangles: this.renderedGlows * PULSE_TRIANGLES_PER_INSTANCE,
      deviceLost
    }, "debug");
  }
}

function rotateBasisByQuaternion(
  vector: RenderVector3Snapshot,
  quaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
): RenderVector3Snapshot {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);
  return {
    x: vector.x + quaternion.w * tx + (quaternion.y * tz - quaternion.z * ty),
    y: vector.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz),
    z: vector.z + quaternion.w * tz + (quaternion.x * ty - quaternion.y * tx)
  };
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
