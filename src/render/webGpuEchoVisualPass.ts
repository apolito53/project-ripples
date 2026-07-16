/// <reference types="@webgpu/types" />

import { FIELD_DEPTH_FORMAT } from "../ripple/webGpuRippleFieldPreview";
import type { RenderFrameInput, RenderVector3Snapshot } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import echoVisualSource from "./webGpuEchoVisualPass.wgsl?raw";

const ECHO_VISUAL_UNIFORM_FLOATS = 28;
const ECHO_VISUAL_FLOATS = 8;
const ECHO_BURST_FLOATS = 8;
const MAX_WEBGPU_ECHO_VISUALS = 8;
const MAX_WEBGPU_ECHO_COLLECTION_EVENTS = 8;
const ECHO_BILLBOARD_COMPONENTS_PER_ECHO = 31;
const ECHO_ORB_COMPONENTS_PER_ECHO = 3;
const ECHO_BURST_COMPONENTS = 2;
const ECHO_MOTE_COUNT = 14;
const ECHO_TRAIL_COUNT = 14;
const ECHO_VISUAL_VERTEX_COUNT = 6;
const ECHO_BILLBOARD_TRIANGLES_PER_INSTANCE = 2;
const ECHO_VISUAL_FRAME_LOG_INTERVAL_SECONDS = 0.5;

export type WebGpuEchoVisualPassMetrics = {
  readonly mode: "webgpu-echo-visual";
  readonly depthMode: "field-depth-read";
  readonly activeEchoes: number;
  readonly renderedEchoes: number;
  readonly activeCollectionEvents: number;
  readonly renderedCollectionEvents: number;
  readonly orbInstances: number;
  readonly billboardInstances: number;
  readonly collectionVisualInstances: number;
  readonly moteInstances: number;
  readonly trailInstances: number;
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuEchoVisualFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly depthTextureView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

export class WebGpuEchoVisualPass {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly billboardPipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly echoBuffer: GPUBuffer;
  private readonly burstBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(ECHO_VISUAL_UNIFORM_FLOATS);
  private readonly echoScratch = new Float32Array(MAX_WEBGPU_ECHO_VISUALS * ECHO_VISUAL_FLOATS);
  private readonly burstScratch = new Float32Array(MAX_WEBGPU_ECHO_COLLECTION_EVENTS * ECHO_BURST_FLOATS);
  private activeEchoes = 0;
  private renderedEchoes = 0;
  private activeCollectionEvents = 0;
  private renderedCollectionEvents = 0;
  private orbInstances = 0;
  private billboardInstances = 0;
  private collectionVisualInstances = 0;
  private moteInstances = 0;
  private trailInstances = 0;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    bindGroupLayout: GPUBindGroupLayout,
    billboardPipeline: GPURenderPipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.billboardPipeline = billboardPipeline;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU Echo visual uniforms",
      size: ECHO_VISUAL_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.echoBuffer = device.createBuffer({
      label: "Ripple WebGPU Echo visual active Echo buffer",
      size: this.echoScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.burstBuffer = device.createBuffer({
      label: "Ripple WebGPU Echo visual collection-event buffer",
      size: this.burstScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.log("echo.webgpu.init", "WebGPU Echo visual pass initialized", {
      mode: "webgpu-echo-visual",
      depthMode: "field-depth-read",
      echoLimit: MAX_WEBGPU_ECHO_VISUALS,
      collectionEventLimit: MAX_WEBGPU_ECHO_COLLECTION_EVENTS,
      activeVisualMode: "layered-orb-billboard",
      orbComponentsPerEcho: ECHO_ORB_COMPONENTS_PER_ECHO,
      billboardComponentsPerEcho: ECHO_BILLBOARD_COMPONENTS_PER_ECHO,
      componentsPerCollectionEvent: ECHO_BURST_COMPONENTS,
      drawCalls: 1
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuEchoVisualPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU Echo visual bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU Echo visual shader",
        code: echoVisualSource
      });
      const billboardPipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU Echo billboard visual pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU Echo billboard visual pipeline layout",
          bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: { module: shaderModule, entryPoint: "billboardVertexMain" },
        fragment: {
          module: shaderModule,
          entryPoint: "billboardFragmentMain",
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

      return new WebGpuEchoVisualPass(device, log, bindGroupLayout, billboardPipeline);
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("echo.webgpu.error", "WebGPU Echo visual pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU Echo visual pass failed: ${message}`);
    }
  }

  render(input: WebGpuEchoVisualFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    const renderedEchoes = this.writeEchoBuffer(input.renderInput);
    const renderedCollectionEvents = this.writeBurstBuffer(input.renderInput);
    this.writeUniforms(input.renderInput, renderedEchoes, renderedCollectionEvents);
    this.updateInstanceCounts(renderedEchoes, renderedCollectionEvents);
    const billboardInstanceCount = this.billboardInstances;

    if (billboardInstanceCount <= 0) {
      this.passMs = performance.now() - startedAt;
      this.maybeLogFrame(input.renderInput, input.deviceLost);
      return this.passMs;
    }

    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU Echo visual bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.echoBuffer } },
        { binding: 2, resource: { buffer: this.burstBuffer } }
      ]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU Echo visual render pass",
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

    pass.setBindGroup(0, bindGroup);
    if (billboardInstanceCount > 0) {
      pass.setPipeline(this.billboardPipeline);
      pass.draw(ECHO_VISUAL_VERTEX_COUNT, billboardInstanceCount);
    }
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuEchoVisualPassMetrics {
    return {
      mode: "webgpu-echo-visual",
      depthMode: "field-depth-read",
      activeEchoes: this.activeEchoes,
      renderedEchoes: this.renderedEchoes,
      activeCollectionEvents: this.activeCollectionEvents,
      renderedCollectionEvents: this.renderedCollectionEvents,
      orbInstances: this.orbInstances,
      billboardInstances: this.billboardInstances,
      collectionVisualInstances: this.collectionVisualInstances,
      moteInstances: this.moteInstances,
      trailInstances: this.trailInstances,
      passMs: this.passMs,
      drawCalls: this.getDrawStats().drawCalls,
      triangles: this.getDrawStats().triangles
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    const billboardDrawCalls = this.billboardInstances > 0 ? 1 : 0;
    return {
      drawCalls: billboardDrawCalls,
      triangles: this.billboardInstances * ECHO_BILLBOARD_TRIANGLES_PER_INSTANCE
    };
  }

  dispose(): void {
    this.burstBuffer.destroy();
    this.echoBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private writeUniforms(
    input: RenderFrameInput,
    renderedEchoes: number,
    renderedCollectionEvents: number
  ): void {
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
    this.uniforms[25] = renderedEchoes;
    this.uniforms[26] = renderedCollectionEvents;
    this.uniforms[27] = input.viewport.pixelRatio;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private writeEchoBuffer(input: RenderFrameInput): number {
    const snapshot = input.echoVisualState;
    const renderedEchoes = Math.max(0, Math.min(MAX_WEBGPU_ECHO_VISUALS, snapshot.echoes.length));
    this.echoScratch.fill(0);

    for (let index = 0; index < renderedEchoes; index += 1) {
      const echo = snapshot.echoes[index];
      const writeOffset = index * ECHO_VISUAL_FLOATS;
      this.echoScratch[writeOffset] = finiteOrDefault(echo.positionX, 0);
      this.echoScratch[writeOffset + 1] = finiteOrDefault(echo.positionY, 0);
      this.echoScratch[writeOffset + 2] = finiteOrDefault(echo.positionZ, 0);
      this.echoScratch[writeOffset + 3] = finiteOrDefault(echo.age, 0);
      this.echoScratch[writeOffset + 4] = finiteOrDefault(echo.triggerRadius, 1);
      this.echoScratch[writeOffset + 5] = finiteOrDefault(echo.radius, 1);
      this.echoScratch[writeOffset + 6] = finiteOrDefault(echo.columnRadius, Math.max(0.85, echo.radius * 0.34));
      this.echoScratch[writeOffset + 7] = finiteOrDefault(echo.phase, 0);
    }

    this.device.queue.writeBuffer(this.echoBuffer, 0, this.echoScratch);
    this.activeEchoes = snapshot.activeEchoes;
    this.renderedEchoes = renderedEchoes;
    return renderedEchoes;
  }

  private writeBurstBuffer(input: RenderFrameInput): number {
    const snapshot = input.echoVisualState;
    const renderedEvents = Math.max(0, Math.min(MAX_WEBGPU_ECHO_COLLECTION_EVENTS, snapshot.collectionEvents.length));
    this.burstScratch.fill(0);

    for (let index = 0; index < renderedEvents; index += 1) {
      const event = snapshot.collectionEvents[index];
      const writeOffset = index * ECHO_BURST_FLOATS;
      this.burstScratch[writeOffset] = finiteOrDefault(event.positionX, 0);
      this.burstScratch[writeOffset + 1] = finiteOrDefault(event.positionY, 0);
      this.burstScratch[writeOffset + 2] = finiteOrDefault(event.positionZ, 0);
      this.burstScratch[writeOffset + 3] = finiteOrDefault(event.age, 0);
      this.burstScratch[writeOffset + 4] = finiteOrDefault(event.effectPositionY, event.positionY + 5.15);
      this.burstScratch[writeOffset + 5] = finiteOrDefault(event.burstStrength, 1);
      this.burstScratch[writeOffset + 6] = finiteOrDefault(event.discBurstRadius, 1);
      this.burstScratch[writeOffset + 7] = finiteOrDefault(event.columnRadius, Math.max(0.85, event.discBurstRadius * 0.12));
    }

    this.device.queue.writeBuffer(this.burstBuffer, 0, this.burstScratch);
    this.activeCollectionEvents = snapshot.activeVisualBursts;
    this.renderedCollectionEvents = renderedEvents;
    return renderedEvents;
  }

  private updateInstanceCounts(renderedEchoes: number, renderedCollectionEvents: number): void {
    this.orbInstances = renderedEchoes * ECHO_ORB_COMPONENTS_PER_ECHO;
    this.billboardInstances = renderedEchoes * ECHO_BILLBOARD_COMPONENTS_PER_ECHO +
      renderedCollectionEvents * ECHO_BURST_COMPONENTS;
    this.collectionVisualInstances = renderedCollectionEvents * ECHO_BURST_COMPONENTS;
    this.moteInstances = renderedEchoes * ECHO_MOTE_COUNT;
    this.trailInstances = renderedEchoes * ECHO_TRAIL_COUNT;
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < ECHO_VISUAL_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("echo.webgpu.frame", "WebGPU Echo visual frame sample", {
      mode: "webgpu-echo-visual",
      scenePresentationMode: input.scenePresentation.mode,
      depthMode: "field-depth-read",
      activeEchoes: this.activeEchoes,
      renderedEchoes: this.renderedEchoes,
      activeCollectionEvents: this.activeCollectionEvents,
      renderedCollectionEvents: this.renderedCollectionEvents,
      activeVisualMode: "layered-orb-billboard",
      orbInstances: this.orbInstances,
      billboardInstances: this.billboardInstances,
      collectionVisualInstances: this.collectionVisualInstances,
      moteInstances: this.moteInstances,
      trailInstances: this.trailInstances,
      passMs: roundMetric(this.passMs),
      drawCalls: this.getDrawStats().drawCalls,
      triangles: this.getDrawStats().triangles,
      supportsBloom: true,
      supportsLocalLights: true,
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
