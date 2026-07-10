/// <reference types="@webgpu/types" />

import type { WebGpuDiagnosticLogger } from "../render/webgpu";
import type { WebGpuWakeFieldProbeMetrics } from "./webGpuWakeFieldProbe";
import wakePreviewSource from "./webGpuWakeFieldPreview.wgsl?raw";

const PREVIEW_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const PREVIEW_DRAW_CALLS = 1;
const PREVIEW_TRIANGLES = 1;

export type WebGpuWakeFieldPreviewFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly wakeTextureView: GPUTextureView;
  readonly wakeMetrics: WebGpuWakeFieldProbeMetrics;
  readonly time: number;
  readonly deviceLost: boolean;
};

export class WebGpuWakeFieldPreview {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private frameCount = 0;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly log: WebGpuDiagnosticLogger,
    bindGroupLayout: GPUBindGroupLayout,
    pipeline: GPURenderPipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.log("wake.webgpu.preview.init", "WebGPU wake texture preview initialized", {
      mode: "webgpu-preview",
      format,
      drawCalls: PREVIEW_DRAW_CALLS,
      triangles: PREVIEW_TRIANGLES
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuWakeFieldPreview> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = createPreviewBindGroupLayout(device);
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU wake preview shader",
        code: wakePreviewSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU wake preview pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU wake preview pipeline layout",
          bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain"
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format }]
        },
        primitive: {
          topology: "triangle-list"
        }
      });

      const scopedError = await device.popErrorScope();
      if (scopedError) {
        throw new Error(scopedError.message);
      }

      return new WebGpuWakeFieldPreview(device, format, log, bindGroupLayout, pipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("wake.webgpu.preview.error", "WebGPU wake texture preview failed to initialize", {
        message,
        format
      }, "error");
      throw new Error(`WebGPU wake preview failed: ${message}`);
    }
  }

  render(input: WebGpuWakeFieldPreviewFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU wake preview bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: input.wakeTextureView }
      ]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU wake preview render pass",
      colorAttachments: [{
        view: input.targetView,
        clearValue: { r: 0.01, g: 0.014, b: 0.022, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.frameCount += 1;
    this.maybeLogFrame(input);
    return this.passMs;
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return {
      drawCalls: PREVIEW_DRAW_CALLS,
      triangles: PREVIEW_TRIANGLES
    };
  }

  getPassMs(): number {
    return this.passMs;
  }

  dispose(): void {
    // Pipeline and layout resources are owned by the device and do not expose
    // explicit destroy methods. The runtime destroys the device on teardown.
  }

  private maybeLogFrame(input: WebGpuWakeFieldPreviewFrameInput): void {
    if (input.time - this.lastFrameLogAt < PREVIEW_FRAME_LOG_INTERVAL_SECONDS) return;

    this.lastFrameLogAt = input.time;
    this.log("wake.webgpu.preview.frame", "WebGPU wake texture preview frame sample", {
      time: roundMetric(input.time),
      mode: "webgpu-preview",
      passMs: roundMetric(this.passMs),
      textureSize: input.wakeMetrics.textureSize,
      textureFormat: input.wakeMetrics.format,
      targetFormat: this.format,
      frameCount: this.frameCount,
      drawCalls: PREVIEW_DRAW_CALLS,
      triangles: PREVIEW_TRIANGLES,
      deviceLost: input.deviceLost
    }, "debug");
  }
}

function createPreviewBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "Ripple WebGPU wake preview bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: "unfilterable-float",
        viewDimension: "2d",
        multisampled: false
      }
    }]
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
