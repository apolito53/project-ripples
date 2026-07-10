/// <reference types="@webgpu/types" />

import type { RenderFrameInput } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import arenaBarrierSource from "./webGpuArenaBarrierPass.wgsl?raw";

const ARENA_UNIFORM_FLOATS = 20;
const ARENA_FRAME_LOG_INTERVAL_SECONDS = 0.75;
const ARENA_SEGMENTS = 256;
const ARENA_VERTEX_COUNT = 6;
const ARENA_TRIANGLES = ARENA_SEGMENTS * 2;
const BARRIER_HEIGHT = 20;
const BARRIER_BASE_Y = -2.85;

export type WebGpuArenaBarrierMetrics = {
  readonly mode: "webgpu-arena-barrier";
  readonly arenaRadius: number;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly arenaBarrierEnabled: boolean;
};

export type WebGpuArenaBarrierFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuArenaBarrierPass {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(ARENA_UNIFORM_FLOATS);
  private arenaRadius = 1;
  private arenaBarrierEnabled = true;
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
      label: "Ripple WebGPU arena barrier uniforms",
      size: ARENA_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.log("arena.webgpu.init", "WebGPU arena barrier pass initialized", {
      mode: "webgpu-arena-barrier",
      depthMode: "field-depth-read",
      segments: ARENA_SEGMENTS,
      drawCalls: 1,
      triangles: ARENA_TRIANGLES
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuArenaBarrierPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU arena barrier bind group layout",
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU arena barrier shader",
        code: arenaBarrierSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU arena barrier pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU arena barrier pipeline layout",
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

      return new WebGpuArenaBarrierPass(device, log, bindGroupLayout, pipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("arena.webgpu.error", "WebGPU arena barrier pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU arena barrier pass failed: ${message}`);
    }
  }

  render(input: WebGpuArenaBarrierFrameInput): number {
    this.arenaBarrierEnabled = input.renderInput.playMode !== "track";
    if (!this.arenaBarrierEnabled) {
      this.passMs = 0;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    this.writeUniforms(input.renderInput);
    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU arena barrier bind group",
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU arena barrier render pass",
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
    pass.draw(ARENA_VERTEX_COUNT, ARENA_SEGMENTS);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuArenaBarrierMetrics {
    return {
      mode: "webgpu-arena-barrier",
      arenaRadius: this.arenaRadius,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: this.arenaBarrierEnabled ? 1 : 0,
      triangles: this.arenaBarrierEnabled ? ARENA_TRIANGLES : 0,
      arenaBarrierEnabled: this.arenaBarrierEnabled
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return this.arenaBarrierEnabled
      ? { drawCalls: 1, triangles: ARENA_TRIANGLES }
      : { drawCalls: 0, triangles: 0 };
  }

  dispose(): void {
    this.uniformBuffer.destroy();
  }

  private writeUniforms(input: RenderFrameInput): void {
    for (let index = 0; index < 16; index += 1) {
      const identityFallback = index % 5 === 0 ? 1 : 0;
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], identityFallback);
    }

    this.arenaRadius = Math.max(1, input.scenePresentation.arenaRadius);
    this.uniforms[16] = input.time;
    this.uniforms[17] = this.arenaRadius + input.qualityPreset.tileSpacing * 0.5;
    this.uniforms[18] = BARRIER_HEIGHT;
    this.uniforms[19] = BARRIER_BASE_Y;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < ARENA_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("arena.webgpu.frame", "WebGPU arena barrier frame sample", {
      mode: "webgpu-arena-barrier",
      scenePresentationMode: input.scenePresentation.mode,
      playMode: input.playMode,
      arenaBarrierEnabled: this.arenaBarrierEnabled,
      arenaRadius: roundMetric(this.arenaRadius),
      depthMode: "field-depth-read",
      passMs: roundMetric(this.passMs),
      drawCalls: this.arenaBarrierEnabled ? 1 : 0,
      triangles: this.arenaBarrierEnabled ? ARENA_TRIANGLES : 0,
      deviceLost
    }, "debug");
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
