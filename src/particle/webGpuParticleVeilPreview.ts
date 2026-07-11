/// <reference types="@webgpu/types" />

import type { ParticleStateSnapshot } from "../particleState";
import type { QualityPreset } from "../qualityPresets";
import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import type { RenderFrameInput } from "../render/types";
import type { WebGpuDiagnosticLogger } from "../render/webgpu";
import particlePreviewSource from "./webGpuParticleVeilPreview.wgsl?raw";

const PARTICLE_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const PARTICLE_CAMERA_MATRIX_FLOATS = 16;
const PARTICLE_UNIFORM_FLOATS = PARTICLE_CAMERA_MATRIX_FLOATS + 4;
const PARTICLE_FLOATS = 12;
const PARTICLE_VERTEX_COUNT = 6;
const PARTICLE_TRIANGLES_PER_INSTANCE = 2;

export type WebGpuParticleVeilPreviewFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export type WebGpuParticleVeilPreviewMetrics = {
  readonly mode: "webgpu-particle-preview";
  readonly qualityId: string;
  readonly activeParticles: number;
  readonly renderedParticles: number;
  readonly particleBudget: number;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export class WebGpuParticleVeilPreview {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(PARTICLE_UNIFORM_FLOATS);
  private particleBuffer: GPUBuffer;
  private particleScratch: Float32Array;
  private particleBudget: number;
  private activeParticles = 0;
  private renderedParticles = 0;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    initialPreset: QualityPreset,
    private qualityId: string,
    bindGroupLayout: GPUBindGroupLayout,
    pipeline: GPURenderPipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.particleBudget = Math.max(1, initialPreset.particleBudget);
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU particle preview uniforms",
      size: PARTICLE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.particleScratch = new Float32Array(this.particleBudget * PARTICLE_FLOATS);
    this.particleBuffer = this.createParticleBuffer(this.particleBudget);

    this.log("particle.webgpu.init", "WebGPU ParticleVeil diagnostic preview initialized", {
      mode: "webgpu-particle-preview",
      quality: this.qualityId,
      particleBudget: this.particleBudget,
      depthMode: "field-depth-read",
      vertexCount: PARTICLE_VERTEX_COUNT
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    initialPreset: QualityPreset,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuParticleVeilPreview> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = createParticlePreviewBindGroupLayout(device);
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU particle preview shader",
        code: particlePreviewSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU particle preview pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU particle preview pipeline layout",
          bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain"
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [{
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one",
                operation: "add"
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one",
                operation: "add"
              }
            }
          }]
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "none"
        },
        depthStencil: {
          format: FIELD_DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: "less-equal"
        }
      });

      const scopedError = await device.popErrorScope();
      if (scopedError) {
        throw new Error(scopedError.message);
      }

      return new WebGpuParticleVeilPreview(
        device,
        log,
        initialPreset,
        initialPreset.id,
        bindGroupLayout,
        pipeline
      );
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("particle.webgpu.error", "WebGPU ParticleVeil diagnostic preview failed to initialize", {
        message,
        format
      }, "error");
      throw new Error(`WebGPU particle preview failed: ${message}`);
    }
  }

  applyQualityPreset(preset: QualityPreset): void {
    const nextBudget = Math.max(1, preset.particleBudget);
    this.qualityId = preset.id;
    if (nextBudget === this.particleBudget) return;

    this.particleBuffer.destroy();
    this.particleBudget = nextBudget;
    this.particleScratch = new Float32Array(nextBudget * PARTICLE_FLOATS);
    this.particleBuffer = this.createParticleBuffer(nextBudget);
    this.activeParticles = 0;
    this.renderedParticles = 0;

    this.log("particle.webgpu.resize", "Resized WebGPU ParticleVeil diagnostic buffers", {
      mode: "webgpu-particle-preview",
      quality: preset.id,
      depthMode: "field-depth-read",
      particleBudget: nextBudget
    });
  }

  render(input: WebGpuParticleVeilPreviewFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    const renderedParticles = this.writeParticleBuffer(input.renderInput.particleState);
    this.writeUniforms(input.renderInput);

    if (renderedParticles <= 0) {
      this.passMs = performance.now() - startedAt;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU particle preview bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } }
      ]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU particle preview render pass",
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
    pass.draw(PARTICLE_VERTEX_COUNT, renderedParticles);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuParticleVeilPreviewMetrics {
    return {
      mode: "webgpu-particle-preview",
      qualityId: this.qualityId,
      activeParticles: this.activeParticles,
      renderedParticles: this.renderedParticles,
      particleBudget: this.particleBudget,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: this.renderedParticles > 0 ? 1 : 0,
      triangles: this.renderedParticles * PARTICLE_TRIANGLES_PER_INSTANCE
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return {
      drawCalls: this.renderedParticles > 0 ? 1 : 0,
      triangles: this.renderedParticles * PARTICLE_TRIANGLES_PER_INSTANCE
    };
  }

  dispose(): void {
    this.particleBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private createParticleBuffer(particleBudget: number): GPUBuffer {
    return this.device.createBuffer({
      label: "Ripple WebGPU particle preview particle buffer",
      size: Math.max(1, particleBudget) * PARTICLE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
  }

  private writeUniforms(input: RenderFrameInput): void {
    for (let index = 0; index < PARTICLE_CAMERA_MATRIX_FLOATS; index += 1) {
      const identityFallback = index % 5 === 0 ? 1 : 0;
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], identityFallback);
    }

    const uniformOffset = PARTICLE_CAMERA_MATRIX_FLOATS;
    this.uniforms[uniformOffset] = input.time;
    this.uniforms[uniformOffset + 1] = input.viewport.pixelRatio;
    this.uniforms[uniformOffset + 2] = input.viewport.width;
    this.uniforms[uniformOffset + 3] = input.viewport.height;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private writeParticleBuffer(snapshot: ParticleStateSnapshot): number {
    const renderedParticles = Math.max(
      0,
      Math.min(snapshot.activeParticles, snapshot.particleBudget, this.particleBudget)
    );

    this.activeParticles = snapshot.activeParticles;
    this.renderedParticles = renderedParticles;
    if (renderedParticles <= 0) return 0;

    for (let index = 0; index < renderedParticles; index += 1) {
      const positionOffset = index * 3;
      const writeOffset = index * PARTICLE_FLOATS;

      this.particleScratch[writeOffset] = finiteOrDefault(snapshot.positions[positionOffset], 0);
      this.particleScratch[writeOffset + 1] = finiteOrDefault(snapshot.positions[positionOffset + 1], -999);
      this.particleScratch[writeOffset + 2] = finiteOrDefault(snapshot.positions[positionOffset + 2], 0);
      this.particleScratch[writeOffset + 3] = finiteOrDefault(snapshot.alphas[index], 0);
      this.particleScratch[writeOffset + 4] = finiteOrDefault(snapshot.colors[positionOffset], 1);
      this.particleScratch[writeOffset + 5] = finiteOrDefault(snapshot.colors[positionOffset + 1], 1);
      this.particleScratch[writeOffset + 6] = finiteOrDefault(snapshot.colors[positionOffset + 2], 1);
      this.particleScratch[writeOffset + 7] = finiteOrDefault(snapshot.sizes[index], 0);
      this.particleScratch[writeOffset + 8] = finiteOrDefault(snapshot.twinkles[index], 0);
      this.particleScratch[writeOffset + 9] = finiteOrDefault(snapshot.cloudinesses[index], 0);
      this.particleScratch[writeOffset + 10] = 0;
      this.particleScratch[writeOffset + 11] = 0;
    }

    this.device.queue.writeBuffer(
      this.particleBuffer,
      0,
      this.particleScratch.buffer,
      0,
      renderedParticles * PARTICLE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    );
    return renderedParticles;
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < PARTICLE_FRAME_LOG_INTERVAL_SECONDS) return;

    this.lastFrameLogAt = input.time;
    this.log("particle.webgpu.frame", "WebGPU ParticleVeil diagnostic frame sample", {
      time: roundMetric(input.time),
      mode: "webgpu-particle-preview",
      backendId: "webgpu",
      quality: this.qualityId,
      activeParticles: this.activeParticles,
      renderedParticles: this.renderedParticles,
      particleBudget: this.particleBudget,
      depthMode: "field-depth-read",
      passMs: roundMetric(this.passMs),
      drawCalls: this.renderedParticles > 0 ? 1 : 0,
      triangles: this.renderedParticles * PARTICLE_TRIANGLES_PER_INSTANCE,
      deviceLost
    }, "debug");
  }
}

function createParticlePreviewBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "Ripple WebGPU particle preview bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" }
      }
    ]
  });
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
