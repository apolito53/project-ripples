/// <reference types="@webgpu/types" />

import type { RenderFrameInput, RenderVector3Snapshot } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import { WEBGPU_MOTE_AVATAR_ASSET, WEBGPU_MOTE_AVATAR_ASSET_ID } from "./webGpuMoteAvatarAsset";
import avatarSource from "./webGpuAvatarPreview.wgsl?raw";

const AVATAR_UNIFORM_FLOATS = 56;
const AVATAR_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const AVATAR_VERTEX_COUNT = 6;
const HOVER_POD_INSTANCE_COUNT = 11;
const AVATAR_INSTANCE_COUNT = WEBGPU_MOTE_AVATAR_ASSET.instanceCount + HOVER_POD_INSTANCE_COUNT;
const AVATAR_TRIANGLES = AVATAR_INSTANCE_COUNT * 2;

export type WebGpuAvatarPreviewMetrics = {
  readonly mode: "webgpu-avatar-preview";
  readonly avatarMode: "hover-pod";
  readonly moteAssetId: typeof WEBGPU_MOTE_AVATAR_ASSET_ID;
  readonly depthMode: "field-depth-read";
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuAvatarPreviewFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuAvatarPreview {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(AVATAR_UNIFORM_FLOATS);
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
      label: "Ripple WebGPU avatar preview uniforms",
      size: AVATAR_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.log("avatar.webgpu.init", "WebGPU avatar preview initialized", {
      mode: "webgpu-avatar-preview",
      avatarMode: "hover-pod",
      moteAssetId: WEBGPU_MOTE_AVATAR_ASSET_ID,
      savedMoteAssetInstances: WEBGPU_MOTE_AVATAR_ASSET.instanceCount,
      hoverPodInstances: HOVER_POD_INSTANCE_COUNT,
      depthMode: "field-depth-read",
      drawCalls: 1,
      triangles: AVATAR_TRIANGLES
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuAvatarPreview> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU avatar preview bind group layout",
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU avatar preview shader",
        code: avatarSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU avatar preview pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU avatar preview pipeline layout",
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

      return new WebGpuAvatarPreview(device, log, bindGroupLayout, pipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("avatar.webgpu.error", "WebGPU avatar preview failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU avatar preview failed: ${message}`);
    }
  }

  render(input: WebGpuAvatarPreviewFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    this.writeUniforms(input.renderInput);
    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU avatar preview bind group",
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU avatar preview render pass",
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
    pass.draw(AVATAR_VERTEX_COUNT, AVATAR_INSTANCE_COUNT);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuAvatarPreviewMetrics {
    return {
      mode: "webgpu-avatar-preview",
      avatarMode: "hover-pod",
      moteAssetId: WEBGPU_MOTE_AVATAR_ASSET_ID,
      depthMode: "field-depth-read",
      passMs: this.passMs,
      drawCalls: 1,
      triangles: AVATAR_TRIANGLES
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return { drawCalls: 1, triangles: AVATAR_TRIANGLES };
  }

  dispose(): void {
    this.uniformBuffer.destroy();
  }

  private writeUniforms(input: RenderFrameInput): void {
    for (let index = 0; index < 16; index += 1) {
      const identityFallback = index % 5 === 0 ? 1 : 0;
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], identityFallback);
    }

    const right = rotateBasisByQuaternion({ x: 1, y: 0, z: 0 }, input.camera.quaternion);
    const up = rotateBasisByQuaternion({ x: 0, y: 1, z: 0 }, input.camera.quaternion);
    const avatar = input.avatarPresentation;
    this.uniforms[16] = avatar.position.x;
    this.uniforms[17] = avatar.position.y;
    this.uniforms[18] = avatar.position.z;
    this.uniforms[19] = avatar.speed;
    this.uniforms[20] = right.x;
    this.uniforms[21] = right.y;
    this.uniforms[22] = right.z;
    this.uniforms[23] = 0;
    this.uniforms[24] = up.x;
    this.uniforms[25] = up.y;
    this.uniforms[26] = up.z;
    this.uniforms[27] = 0;
    this.uniforms[28] = input.time;
    this.uniforms[29] = avatar.groundContact;
    this.uniforms[30] = avatar.facingYawRadians;
    this.uniforms[31] = input.viewport.pixelRatio;
    this.uniforms[32] = avatar.coreRadius;
    this.uniforms[33] = avatar.glowRadius;
    this.uniforms[34] = avatar.glowStrength;
    this.uniforms[35] = 0;
    this.uniforms[36] = avatar.primaryColor.x;
    this.uniforms[37] = avatar.primaryColor.y;
    this.uniforms[38] = avatar.primaryColor.z;
    this.uniforms[39] = 1;
    this.uniforms[40] = avatar.secondaryColor.x;
    this.uniforms[41] = avatar.secondaryColor.y;
    this.uniforms[42] = avatar.secondaryColor.z;
    this.uniforms[43] = 1;
    this.uniforms[44] = avatar.accentColor.x;
    this.uniforms[45] = avatar.accentColor.y;
    this.uniforms[46] = avatar.accentColor.z;
    this.uniforms[47] = 1;
    this.uniforms[48] = avatar.bodyLength;
    this.uniforms[49] = avatar.bodyWidth;
    this.uniforms[50] = avatar.bodyHeight;
    this.uniforms[51] = avatar.noseLength;
    this.uniforms[52] = avatar.tailLength;
    this.uniforms[53] = avatar.thrusterGlow;
    this.uniforms[54] = avatar.finGlow;
    this.uniforms[55] = 1;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < AVATAR_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("avatar.webgpu.frame", "WebGPU avatar preview frame sample", {
      mode: "webgpu-avatar-preview",
      scenePresentationMode: input.scenePresentation.mode,
      avatarMode: "hover-pod",
      avatarPresentationMode: input.avatarPresentation.mode,
      avatarAssetId: input.avatarPresentation.assetId,
      moteAvatarAssetId: input.avatarPresentation.moteAssetId,
      avatarCoreRadius: roundMetric(input.avatarPresentation.coreRadius),
      avatarGlowRadius: roundMetric(input.avatarPresentation.glowRadius),
      avatarGlowStrength: roundMetric(input.avatarPresentation.glowStrength),
      savedMoteAssetInstances: WEBGPU_MOTE_AVATAR_ASSET.instanceCount,
      hoverPodInstances: HOVER_POD_INSTANCE_COUNT,
      depthMode: "field-depth-read",
      playerSpeed: roundMetric(input.avatarPresentation.speed),
      facingYawRadians: roundMetric(input.avatarPresentation.facingYawRadians),
      passMs: roundMetric(this.passMs),
      drawCalls: 1,
      triangles: AVATAR_TRIANGLES,
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
