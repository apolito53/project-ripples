/// <reference types="@webgpu/types" />

import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import type { RenderFrameInput } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import trainingMarkerSource from "./webGpuTrainingMarkerPass.wgsl?raw";

const TRAINING_MARKER_UNIFORM_FLOATS = 32;
const TRAINING_MARKER_VERTEX_COUNT = 6;
const TRAINING_MARKER_INSTANCE_COUNT = 4;
const TRAINING_MARKER_TRIANGLES = TRAINING_MARKER_INSTANCE_COUNT * 2;
const TRAINING_MARKER_FRAME_LOG_SECONDS = 0.75;

export type WebGpuTrainingMarkerMetrics = {
  readonly mode: "webgpu-training-marker";
  readonly enabled: boolean;
  readonly trainingEnabled: boolean;
  readonly trainingActive: boolean;
  readonly trainingComplete: boolean;
  readonly markerVisible: boolean;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuTrainingMarkerFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuTrainingMarkerPass {
  private readonly uniformBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniforms = new Float32Array(TRAINING_MARKER_UNIFORM_FLOATS);
  private enabled = false;
  private trainingEnabled = false;
  private trainingActive = false;
  private trainingComplete = false;
  private markerVisible = false;
  private stepId = "";
  private stepIndex = 0;
  private stepCount = 0;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    private readonly pipeline: GPURenderPipeline,
    bindGroupLayout: GPUBindGroupLayout
  ) {
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU training marker uniforms",
      size: TRAINING_MARKER_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      label: "Ripple WebGPU training marker bind group",
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });

    this.log("training.webgpu.init", "WebGPU Training marker pass initialized", {
      mode: "webgpu-training-marker",
      depthMode: "field-depth-read",
      instances: TRAINING_MARKER_INSTANCE_COUNT,
      drawCalls: 1,
      triangles: TRAINING_MARKER_TRIANGLES
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuTrainingMarkerPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU training marker bind group layout",
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" }
        }]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU training marker shader",
        code: trainingMarkerSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU training marker pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU training marker pipeline layout",
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
      return new WebGpuTrainingMarkerPass(device, log, pipeline, bindGroupLayout);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("training.webgpu.error", "WebGPU Training marker pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU Training marker pass failed: ${message}`);
    }
  }

  render(input: WebGpuTrainingMarkerFrameInput): number {
    const training = input.renderInput.training;
    this.stepId = training.stepId;
    this.stepIndex = training.stepIndex;
    this.stepCount = training.stepCount;
    this.trainingEnabled = training.enabled;
    this.trainingActive = training.active;
    this.trainingComplete = training.complete;
    this.markerVisible = training.marker.visible;
    this.enabled = input.renderInput.playMode === "training" && this.trainingEnabled && this.markerVisible;

    if (!this.enabled || input.deviceLost) {
      this.passMs = 0;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    const startedAt = performance.now();
    this.writeUniforms(input.renderInput);
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU Training marker render pass",
      colorAttachments: [{ view: input.targetView, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: {
        view: input.depthTextureView,
        depthLoadOp: "load",
        depthStoreOp: "store"
      }
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(TRAINING_MARKER_VERTEX_COUNT, TRAINING_MARKER_INSTANCE_COUNT);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuTrainingMarkerMetrics {
    return {
      mode: "webgpu-training-marker",
      enabled: this.enabled,
      trainingEnabled: this.trainingEnabled,
      trainingActive: this.trainingActive,
      trainingComplete: this.trainingComplete,
      markerVisible: this.markerVisible,
      stepId: this.stepId,
      stepIndex: this.stepIndex,
      stepCount: this.stepCount,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: this.enabled ? 1 : 0,
      triangles: this.enabled ? TRAINING_MARKER_TRIANGLES : 0
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    const metrics = this.getMetrics();
    return { drawCalls: metrics.drawCalls, triangles: metrics.triangles };
  }

  dispose(): void {
    this.uniformBuffer.destroy();
  }

  private writeUniforms(input: RenderFrameInput): void {
    const marker = input.training.marker;
    for (let index = 0; index < 16; index += 1) {
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], index % 5 === 0 ? 1 : 0);
    }
    this.uniforms[16] = marker.position.x;
    this.uniforms[17] = marker.position.y;
    this.uniforms[18] = marker.position.z;
    this.uniforms[19] = marker.facingYawRadians;
    this.uniforms[20] = marker.halfWidth;
    this.uniforms[21] = marker.postHeight;
    this.uniforms[22] = marker.postWidth;
    this.uniforms[23] = input.time;
    this.uniforms[24] = marker.beamY;
    this.uniforms[25] = marker.beamThickness;
    this.uniforms[26] = marker.beamDepth;
    this.uniforms[27] = marker.glowWidth;
    this.uniforms[28] = marker.glowHeight;
    this.uniforms[29] = input.training.stepIndex;
    this.uniforms[30] = input.training.stepCount;
    this.uniforms[31] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < TRAINING_MARKER_FRAME_LOG_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("training.webgpu.frame", "WebGPU Training marker frame sample", {
      ...this.getMetrics(),
      playMode: input.playMode,
      trainingActive: input.training.active,
      trainingComplete: input.training.complete,
      deviceLost
    }, "debug");
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
