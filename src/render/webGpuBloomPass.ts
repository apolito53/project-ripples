/// <reference types="@webgpu/types" />

import type { RenderFrameInput } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import bloomSource from "./webGpuBloomPass.wgsl?raw";

const BLOOM_UNIFORM_FLOATS = 12;
const BLOOM_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const BLOOM_TEXTURE_SCALE = 0.5;
const BLOOM_THRESHOLD = 0.74;
const BLOOM_STRENGTH_CAP = 0.32;
const BLOOM_DRAWS = 4;

type BloomPassMode = 0 | 1 | 2;

export type WebGpuBloomPassMetrics = {
  readonly mode: "webgpu-bloom";
  readonly bloomMode: "bright-downsample-separable-blur";
  readonly bloomEnabled: boolean;
  readonly bloomStrength: number;
  readonly bloomPasses: number;
  readonly bloomThreshold: number;
  readonly presentationWidth: number;
  readonly presentationHeight: number;
  readonly bloomWidth: number;
  readonly bloomHeight: number;
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuBloomFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuBloomPass {
  private readonly sampler: GPUSampler;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly brightUniformBuffer: GPUBuffer;
  private readonly blurHorizontalUniformBuffer: GPUBuffer;
  private readonly blurVerticalUniformBuffer: GPUBuffer;
  private readonly compositeUniformBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(BLOOM_UNIFORM_FLOATS);
  private sceneTexture: GPUTexture | null = null;
  private sceneTextureView: GPUTextureView | null = null;
  private bloomTextureA: GPUTexture | null = null;
  private bloomTextureB: GPUTexture | null = null;
  private bloomTextureViewA: GPUTextureView | null = null;
  private bloomTextureViewB: GPUTextureView | null = null;
  private presentationWidth = 1;
  private presentationHeight = 1;
  private bloomWidth = 1;
  private bloomHeight = 1;
  private passMs = 0;
  private bloomEnabled = false;
  private bloomStrength = 0;
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
    this.sampler = device.createSampler({
      label: "Ripple WebGPU bloom sampler",
      magFilter: "linear",
      minFilter: "linear"
    });
    this.brightUniformBuffer = this.createUniformBuffer("bright");
    this.blurHorizontalUniformBuffer = this.createUniformBuffer("horizontal blur");
    this.blurVerticalUniformBuffer = this.createUniformBuffer("vertical blur");
    this.compositeUniformBuffer = this.createUniformBuffer("composite");

    this.log("bloom.webgpu.init", "WebGPU bloom pass initialized", {
      mode: "webgpu-bloom",
      bloomMode: "bright-downsample-separable-blur",
      format,
      bloomPasses: BLOOM_DRAWS,
      bloomThreshold: BLOOM_THRESHOLD,
      bloomStrengthCap: BLOOM_STRENGTH_CAP,
      drawCalls: BLOOM_DRAWS,
      triangles: BLOOM_DRAWS
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuBloomPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU bloom bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU bloom shader",
        code: bloomSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU bloom pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU bloom pipeline layout",
          bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: { module: shaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format }]
        },
        primitive: { topology: "triangle-list" }
      });

      const scopedError = await device.popErrorScope();
      if (scopedError) throw new Error(scopedError.message);

      return new WebGpuBloomPass(device, format, log, bindGroupLayout, pipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("bloom.webgpu.error", "WebGPU bloom pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU bloom pass failed: ${message}`);
    }
  }

  resize(presentationWidth: number, presentationHeight: number): void {
    const nextWidth = Math.max(1, Math.floor(presentationWidth));
    const nextHeight = Math.max(1, Math.floor(presentationHeight));
    const nextBloomWidth = Math.max(1, Math.floor(nextWidth * BLOOM_TEXTURE_SCALE));
    const nextBloomHeight = Math.max(1, Math.floor(nextHeight * BLOOM_TEXTURE_SCALE));
    if (
      this.sceneTextureView &&
      this.bloomTextureViewA &&
      nextWidth === this.presentationWidth &&
      nextHeight === this.presentationHeight &&
      nextBloomWidth === this.bloomWidth &&
      nextBloomHeight === this.bloomHeight
    ) {
      return;
    }

    this.sceneTexture?.destroy();
    this.bloomTextureA?.destroy();
    this.bloomTextureB?.destroy();
    this.presentationWidth = nextWidth;
    this.presentationHeight = nextHeight;
    this.bloomWidth = nextBloomWidth;
    this.bloomHeight = nextBloomHeight;
    this.sceneTexture = this.createTexture("scene presentation color target", nextWidth, nextHeight);
    this.bloomTextureA = this.createTexture("bloom ping texture", nextBloomWidth, nextBloomHeight);
    this.bloomTextureB = this.createTexture("bloom pong texture", nextBloomWidth, nextBloomHeight);
    this.sceneTextureView = this.sceneTexture.createView({
      label: "Ripple WebGPU scene presentation color target view"
    });
    this.bloomTextureViewA = this.bloomTextureA.createView({
      label: "Ripple WebGPU bloom ping texture view"
    });
    this.bloomTextureViewB = this.bloomTextureB.createView({
      label: "Ripple WebGPU bloom pong texture view"
    });

    this.log("bloom.webgpu.resize", "Configured WebGPU bloom targets", {
      mode: "webgpu-bloom",
      bloomMode: "bright-downsample-separable-blur",
      presentationWidth: nextWidth,
      presentationHeight: nextHeight,
      bloomWidth: nextBloomWidth,
      bloomHeight: nextBloomHeight,
      bloomPasses: BLOOM_DRAWS
    }, "debug");
  }

  getSceneTargetView(): GPUTextureView {
    if (!this.sceneTextureView) this.resize(this.presentationWidth, this.presentationHeight);
    return this.sceneTextureView!;
  }

  render(input: WebGpuBloomFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    this.bloomStrength = Math.min(Math.max(0, input.renderInput.scenePresentation.postGlowStrength), BLOOM_STRENGTH_CAP);
    this.bloomEnabled = input.renderInput.scenePresentation.postGlowEnabled && this.bloomStrength > 0.001;
    const sceneView = this.getSceneTargetView();
    const bloomViewA = this.getBloomTextureViewA();
    const bloomViewB = this.getBloomTextureViewB();

    this.writeUniforms(this.brightUniformBuffer, 0, 0, 0);
    this.renderFullScreenPass(input.commandEncoder, "Ripple WebGPU bloom bright pass", bloomViewA, sceneView, sceneView, this.brightUniformBuffer);
    this.writeUniforms(this.blurHorizontalUniformBuffer, 1, 1, 0);
    this.renderFullScreenPass(input.commandEncoder, "Ripple WebGPU bloom horizontal blur pass", bloomViewB, bloomViewA, sceneView, this.blurHorizontalUniformBuffer);
    this.writeUniforms(this.blurVerticalUniformBuffer, 1, 0, 1);
    this.renderFullScreenPass(input.commandEncoder, "Ripple WebGPU bloom vertical blur pass", bloomViewA, bloomViewB, sceneView, this.blurVerticalUniformBuffer);
    this.writeUniforms(this.compositeUniformBuffer, 2, 0, 0);
    this.renderFullScreenPass(input.commandEncoder, "Ripple WebGPU bloom composite pass", input.targetView, sceneView, bloomViewA, this.compositeUniformBuffer);

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuBloomPassMetrics {
    return {
      mode: "webgpu-bloom",
      bloomMode: "bright-downsample-separable-blur",
      bloomEnabled: this.bloomEnabled,
      bloomStrength: this.bloomStrength,
      bloomPasses: BLOOM_DRAWS,
      bloomThreshold: BLOOM_THRESHOLD,
      presentationWidth: this.presentationWidth,
      presentationHeight: this.presentationHeight,
      bloomWidth: this.bloomWidth,
      bloomHeight: this.bloomHeight,
      passMs: this.passMs,
      drawCalls: BLOOM_DRAWS,
      triangles: BLOOM_DRAWS
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return { drawCalls: BLOOM_DRAWS, triangles: BLOOM_DRAWS };
  }

  dispose(): void {
    this.sceneTexture?.destroy();
    this.bloomTextureA?.destroy();
    this.bloomTextureB?.destroy();
    this.brightUniformBuffer.destroy();
    this.blurHorizontalUniformBuffer.destroy();
    this.blurVerticalUniformBuffer.destroy();
    this.compositeUniformBuffer.destroy();
  }

  private createUniformBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label: `Ripple WebGPU bloom ${label} uniforms`,
      size: BLOOM_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  private createTexture(label: string, width: number, height: number): GPUTexture {
    return this.device.createTexture({
      label: `Ripple WebGPU ${label}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }

  private getBloomTextureViewA(): GPUTextureView {
    if (!this.bloomTextureViewA) this.resize(this.presentationWidth, this.presentationHeight);
    return this.bloomTextureViewA!;
  }

  private getBloomTextureViewB(): GPUTextureView {
    if (!this.bloomTextureViewB) this.resize(this.presentationWidth, this.presentationHeight);
    return this.bloomTextureViewB!;
  }

  private writeUniforms(buffer: GPUBuffer, mode: BloomPassMode, directionX: number, directionY: number): void {
    this.uniforms[0] = this.presentationWidth;
    this.uniforms[1] = this.presentationHeight;
    this.uniforms[2] = this.bloomWidth;
    this.uniforms[3] = this.bloomHeight;
    this.uniforms[4] = BLOOM_THRESHOLD;
    this.uniforms[5] = this.bloomStrength;
    this.uniforms[6] = this.bloomEnabled ? 1 : 0;
    this.uniforms[7] = mode;
    this.uniforms[8] = directionX;
    this.uniforms[9] = directionY;
    this.uniforms[10] = 0;
    this.uniforms[11] = 0;
    this.device.queue.writeBuffer(buffer, 0, this.uniforms);
  }

  private renderFullScreenPass(
    commandEncoder: GPUCommandEncoder,
    label: string,
    targetView: GPUTextureView,
    sourceView: GPUTextureView,
    bloomView: GPUTextureView,
    uniformBuffer: GPUBuffer
  ): void {
    const bindGroup = this.device.createBindGroup({
      label: `${label} bind group`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: sourceView },
        { binding: 2, resource: bloomView },
        { binding: 3, resource: { buffer: uniformBuffer } }
      ]
    });
    const pass = commandEncoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < BLOOM_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("bloom.webgpu.frame", "WebGPU bloom frame sample", {
      mode: "webgpu-bloom",
      scenePresentationMode: input.scenePresentation.mode,
      bloomMode: "bright-downsample-separable-blur",
      bloomEnabled: this.bloomEnabled,
      bloomStrength: roundMetric(this.bloomStrength),
      bloomPasses: BLOOM_DRAWS,
      bloomThreshold: BLOOM_THRESHOLD,
      presentationWidth: this.presentationWidth,
      presentationHeight: this.presentationHeight,
      bloomWidth: this.bloomWidth,
      bloomHeight: this.bloomHeight,
      passMs: roundMetric(this.passMs),
      drawCalls: BLOOM_DRAWS,
      triangles: BLOOM_DRAWS,
      deviceLost
    }, "debug");
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
