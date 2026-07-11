/// <reference types="@webgpu/types" />

import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import type { RenderFrameInput } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import trackWallSource from "./webGpuTrackWallPass.wgsl?raw";

const TRACK_WALL_UNIFORM_FLOATS = 24;
const TRACK_WALL_MAX_SEGMENTS = 512;
const TRACK_WALL_VERTICES_PER_SEGMENT = 12;
const TRACK_WALL_FRAME_LOG_SECONDS = 0.75;

export type WebGpuTrackWallMetrics = {
  readonly mode: "webgpu-track-walls";
  readonly enabled: boolean;
  readonly version: number;
  readonly segmentCount: number;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuTrackWallFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuTrackWallPass {
  private readonly uniformBuffer: GPUBuffer;
  private readonly segmentBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniforms = new Float32Array(TRACK_WALL_UNIFORM_FLOATS);
  private enabled = false;
  private uploadedVersion = -1;
  private segmentCount = 0;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    private readonly pipeline: GPURenderPipeline,
    bindGroupLayout: GPUBindGroupLayout
  ) {
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU track wall uniforms",
      size: TRACK_WALL_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.segmentBuffer = device.createBuffer({
      label: "Ripple WebGPU packed track wall segments",
      size: TRACK_WALL_MAX_SEGMENTS * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      label: "Ripple WebGPU track wall bind group",
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } }
      ]
    });

    this.log("track.wall.webgpu.init", "WebGPU track wall pass initialized", {
      mode: "webgpu-track-walls",
      depthMode: "field-depth-read",
      maxSegments: TRACK_WALL_MAX_SEGMENTS,
      drawCalls: 1
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuTrackWallPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU track wall bind group layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" }
          }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU track wall shader",
        code: trackWallSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU track wall pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU track wall pipeline layout",
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
      return new WebGpuTrackWallPass(device, log, pipeline, bindGroupLayout);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("track.wall.webgpu.error", "WebGPU track wall pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU track wall pass failed: ${message}`);
    }
  }

  render(input: WebGpuTrackWallFrameInput): number {
    const snapshot = input.renderInput.raceTrack.walls;
    const courseMode = input.renderInput.playMode === "track" || input.renderInput.playMode === "training";
    this.segmentCount = Math.min(TRACK_WALL_MAX_SEGMENTS, Math.max(0, snapshot.segmentCount));
    this.enabled = courseMode && input.renderInput.raceTrack.enabled && this.segmentCount > 1;

    if (!this.enabled || input.deviceLost) {
      this.passMs = 0;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    const startedAt = performance.now();
    this.uploadSegments(input.renderInput);
    this.writeUniforms(input.renderInput);
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU track wall render pass",
      colorAttachments: [{ view: input.targetView, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: {
        view: input.depthTextureView,
        depthLoadOp: "load",
        depthStoreOp: "store"
      }
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(TRACK_WALL_VERTICES_PER_SEGMENT, this.segmentCount);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuTrackWallMetrics {
    return {
      mode: "webgpu-track-walls",
      enabled: this.enabled,
      version: Math.max(0, this.uploadedVersion),
      segmentCount: this.segmentCount,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: this.enabled ? 1 : 0,
      triangles: this.enabled ? this.segmentCount * 4 : 0
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    const metrics = this.getMetrics();
    return { drawCalls: metrics.drawCalls, triangles: metrics.triangles };
  }

  dispose(): void {
    this.uniformBuffer.destroy();
    this.segmentBuffer.destroy();
  }

  private uploadSegments(input: RenderFrameInput): void {
    const snapshot = input.raceTrack.walls;
    if (snapshot.version === this.uploadedVersion) return;

    const packedFloatCount = this.segmentCount * 4;
    const upload = new Float32Array(packedFloatCount);
    upload.set(snapshot.packedSegments.subarray(0, packedFloatCount));
    this.device.queue.writeBuffer(this.segmentBuffer, 0, upload);
    this.uploadedVersion = snapshot.version;
  }

  private writeUniforms(input: RenderFrameInput): void {
    for (let index = 0; index < 16; index += 1) {
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], index % 5 === 0 ? 1 : 0);
    }
    this.uniforms[16] = input.time;
    this.uniforms[17] = input.raceTrack.walls.baseY;
    this.uniforms[18] = input.raceTrack.walls.height;
    this.uniforms[19] = this.segmentCount;
    this.uniforms[20] = input.raceTrack.walls.version;
    this.uniforms[21] = input.raceTrack.fieldRadius;
    this.uniforms[22] = 0;
    this.uniforms[23] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < TRACK_WALL_FRAME_LOG_SECONDS) return;
    this.lastFrameLogAt = input.time;
    const metrics = this.getMetrics();
    this.log("track.wall.webgpu.frame", "WebGPU track wall frame sample", {
      ...metrics,
      playMode: input.playMode,
      deviceLost
    }, "debug");
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
