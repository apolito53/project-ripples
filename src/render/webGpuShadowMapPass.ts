/// <reference types="@webgpu/types" />

import * as THREE from "three";
import type { QualityPreset } from "../qualityPresets";
import {
  RENDER_SCENE_SHADOW_CASTER_LIMIT,
  type RenderFrameInput,
  type RenderSceneShadowCasterKind,
  type RenderSceneShadowCasterSnapshot
} from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import shadowMapSource from "./webGpuShadowMapPass.wgsl?raw";

export const WEBGPU_SHADOW_MAP_FORMAT: GPUTextureFormat = "depth32float";

const SHADOW_MAP_UNIFORM_FLOATS = 24;
const SHADOW_MAP_CASTER_FLOATS = 8;
const SHADOW_MAP_VERTEX_COUNT = 18;
const SHADOW_MAP_TRIANGLES_PER_CASTER = SHADOW_MAP_VERTEX_COUNT / 3;
const SHADOW_MAP_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const SHADOW_MAP_MIN_SIZE = 512;
const SHADOW_MAP_PCF_TAPS = 9;
const SHADOW_GEOMETRY_MODE = "shape-proxy-casters";

export type WebGpuShadowMapPassMetrics = {
  readonly mode: "webgpu-shadow-map";
  readonly shadowMode: "shadow-map-contact";
  readonly mapSize: number;
  readonly format: GPUTextureFormat;
  readonly activeShadowCasters: number;
  readonly renderedShadowCasters: number;
  readonly shadowCasterLimit: number;
  readonly lightBounds: number;
  readonly pcfTaps: number;
  readonly passMs: number;
  readonly ready: boolean;
  readonly shadowGeometryMode: typeof SHADOW_GEOMETRY_MODE;
  readonly fieldReceiver: boolean;
  readonly renderedOrbCasters: number;
  readonly renderedColumnCasters: number;
  readonly renderedDiscCasters: number;
  readonly proxyTriangles: number;
};

export class WebGpuShadowMapPass {
  private readonly sampleBindGroupLayout: GPUBindGroupLayout;
  private readonly renderBindGroupLayout: GPUBindGroupLayout;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly casterBuffer: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly uniforms = new Float32Array(SHADOW_MAP_UNIFORM_FLOATS);
  private readonly casterScratch = new Float32Array(RENDER_SCENE_SHADOW_CASTER_LIMIT * SHADOW_MAP_CASTER_FLOATS);
  private readonly lightViewProjection = new THREE.Matrix4();
  private readonly lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private texture: GPUTexture | null = null;
  private textureView: GPUTextureView | null = null;
  private sampleBindGroup: GPUBindGroup | null = null;
  private mapSize = 1;
  private activeShadowCasters = 0;
  private renderedShadowCasters = 0;
  private renderedOrbCasters = 0;
  private renderedColumnCasters = 0;
  private renderedDiscCasters = 0;
  private lightBounds = 1;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    private readonly maxTextureDimension2D: number,
    sampleBindGroupLayout: GPUBindGroupLayout,
    renderBindGroupLayout: GPUBindGroupLayout,
    renderPipeline: GPURenderPipeline
  ) {
    this.sampleBindGroupLayout = sampleBindGroupLayout;
    this.renderBindGroupLayout = renderBindGroupLayout;
    this.renderPipeline = renderPipeline;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU shadow map uniforms",
      size: SHADOW_MAP_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.casterBuffer = device.createBuffer({
      label: "Ripple WebGPU shadow map caster buffer",
      size: this.casterScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.sampler = device.createSampler({
      label: "Ripple WebGPU shadow map comparison sampler",
      compare: "less-equal",
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

  static async create(
    device: GPUDevice,
    initialPreset: QualityPreset,
    log: WebGpuDiagnosticLogger,
    maxTextureDimension2D: number
  ): Promise<WebGpuShadowMapPass> {
    device.pushErrorScope("validation");

    try {
      const sampleBindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU shadow map sampling bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "depth", viewDimension: "2d", multisampled: false }
          }
        ]
      });
      const renderBindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU shadow map render bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU shadow map shader",
        code: shadowMapSource
      });
      const renderPipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU shadow map pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU shadow map pipeline layout",
          bindGroupLayouts: [renderBindGroupLayout]
        }),
        vertex: { module: shaderModule, entryPoint: "vertexMain" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: WEBGPU_SHADOW_MAP_FORMAT,
          depthWriteEnabled: true,
          depthCompare: "less"
        }
      });

      const scopedError = await device.popErrorScope();
      if (scopedError) throw new Error(scopedError.message);

      const pass = new WebGpuShadowMapPass(
        device,
        log,
        maxTextureDimension2D,
        sampleBindGroupLayout,
        renderBindGroupLayout,
        renderPipeline
      );
      pass.resizeForPreset(initialPreset, "init");
      log("shadow.webgpu.map.init", "WebGPU directional shadow map pass initialized", {
        mode: "webgpu-shadow-map",
        shadowMode: "shadow-map-contact",
        mapSize: pass.mapSize,
        format: WEBGPU_SHADOW_MAP_FORMAT,
        shadowGeometryMode: SHADOW_GEOMETRY_MODE,
        fieldReceiver: true,
        pcfTaps: SHADOW_MAP_PCF_TAPS,
        trianglesPerCaster: SHADOW_MAP_TRIANGLES_PER_CASTER,
        shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT
      });
      return pass;
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("shadow.webgpu.map.error", "WebGPU directional shadow map pass failed to initialize", { message }, "error");
      throw new Error(`WebGPU shadow map pass failed: ${message}`);
    }
  }

  resizeForPreset(preset: QualityPreset, reason: "init" | "quality" | "field-scale" = "quality"): void {
    const nextSize = getShadowMapSize(preset, this.maxTextureDimension2D);
    if (this.textureView && nextSize === this.mapSize) return;

    this.texture?.destroy();
    this.mapSize = nextSize;
    this.texture = this.device.createTexture({
      label: "Ripple WebGPU directional shadow map texture",
      size: { width: nextSize, height: nextSize, depthOrArrayLayers: 1 },
      format: WEBGPU_SHADOW_MAP_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.textureView = this.texture.createView({
      label: "Ripple WebGPU directional shadow map texture view"
    });
    this.sampleBindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU shadow map sampling bind group",
      layout: this.sampleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.textureView }
      ]
    });

    this.log("shadow.webgpu.map.resize", "Configured WebGPU directional shadow map target", {
      mode: "webgpu-shadow-map",
      shadowMode: "shadow-map-contact",
      reason,
      quality: preset.id,
      mapSize: this.mapSize,
      format: WEBGPU_SHADOW_MAP_FORMAT,
      pcfTaps: SHADOW_MAP_PCF_TAPS
    });
  }

  render(commandEncoder: GPUCommandEncoder, input: RenderFrameInput, deviceLost: boolean): number {
    if (deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    const renderedCasters = this.writeResources(input);

    if (renderedCasters > 0) {
      const textureView = this.requireTextureView();
      const renderBindGroup = this.device.createBindGroup({
        label: "Ripple WebGPU shadow map render bind group",
        layout: this.renderBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.casterBuffer } }
        ]
      });
      const pass = commandEncoder.beginRenderPass({
        label: "Ripple WebGPU directional shadow map render pass",
        colorAttachments: [],
        depthStencilAttachment: {
          view: textureView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store"
        }
      });

      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, renderBindGroup);
      pass.draw(SHADOW_MAP_VERTEX_COUNT, renderedCasters);
      pass.end();
    }

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input, deviceLost);
    return this.passMs;
  }

  getSampleBindGroupLayout(): GPUBindGroupLayout {
    return this.sampleBindGroupLayout;
  }

  getSampleBindGroup(): GPUBindGroup {
    if (!this.sampleBindGroup) {
      throw new Error("WebGPU shadow map sampling bind group was not configured.");
    }
    return this.sampleBindGroup;
  }

  getMetrics(): WebGpuShadowMapPassMetrics {
    return {
      mode: "webgpu-shadow-map",
      shadowMode: "shadow-map-contact",
      mapSize: this.mapSize,
      format: WEBGPU_SHADOW_MAP_FORMAT,
      activeShadowCasters: this.activeShadowCasters,
      renderedShadowCasters: this.renderedShadowCasters,
      shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
      lightBounds: this.lightBounds,
      pcfTaps: SHADOW_MAP_PCF_TAPS,
      passMs: this.passMs,
      ready: Boolean(this.textureView && this.sampleBindGroup),
      shadowGeometryMode: SHADOW_GEOMETRY_MODE,
      fieldReceiver: true,
      renderedOrbCasters: this.renderedOrbCasters,
      renderedColumnCasters: this.renderedColumnCasters,
      renderedDiscCasters: this.renderedDiscCasters,
      proxyTriangles: this.renderedShadowCasters * SHADOW_MAP_TRIANGLES_PER_CASTER
    };
  }

  dispose(): void {
    this.texture?.destroy();
    this.casterBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private writeResources(input: RenderFrameInput): number {
    const shadows = input.sceneShadows;
    const sortedCasters = [...shadows.casters].sort(compareShadowCasters);
    const renderedCasters = Math.max(
      0,
      Math.min(RENDER_SCENE_SHADOW_CASTER_LIMIT, shadows.casterLimit, sortedCasters.length)
    );

    this.activeShadowCasters = shadows.activeCasters;
    this.renderedShadowCasters = renderedCasters;
    this.renderedOrbCasters = 0;
    this.renderedColumnCasters = 0;
    this.renderedDiscCasters = 0;
    this.updateLightCamera(input);
    this.uniforms.fill(0);
    this.lightViewProjection.toArray(this.uniforms, 0);
    this.uniforms[16] = input.sceneLighting.keyDirection.x;
    this.uniforms[17] = input.sceneLighting.keyDirection.y;
    this.uniforms[18] = input.sceneLighting.keyDirection.z;
    this.uniforms[19] = this.lightBounds;
    this.uniforms[20] = this.mapSize;
    this.uniforms[21] = renderedCasters;
    this.uniforms[22] = getDepthBias(input.qualityPreset);
    this.uniforms[23] = Math.min(0.38, Math.max(0, shadows.strength * 0.72));

    this.casterScratch.fill(0);
    for (let index = 0; index < renderedCasters; index += 1) {
      const caster = sortedCasters[index];
      const proxy = caster.shadowMapProxy;
      const proxyShapeId = shadowProxyShapeId(proxy.shape);
      const writeOffset = index * SHADOW_MAP_CASTER_FLOATS;
      this.casterScratch[writeOffset] = finiteOrDefault(caster.position.x, 0);
      this.casterScratch[writeOffset + 1] = finiteOrDefault(caster.position.y, 0);
      this.casterScratch[writeOffset + 2] = finiteOrDefault(caster.position.z, 0);
      this.casterScratch[writeOffset + 3] = Math.max(0.08, finiteOrDefault(proxy.radius, caster.radius));
      this.casterScratch[writeOffset + 4] = Math.max(0, finiteOrDefault(proxy.strength, caster.strength));
      this.casterScratch[writeOffset + 5] = Math.max(0.08, finiteOrDefault(proxy.height, caster.height));
      this.casterScratch[writeOffset + 6] = proxyShapeId;
      this.casterScratch[writeOffset + 7] = shadowKindId(caster.kind);

      if (proxyShapeId === 1) this.renderedOrbCasters += 1;
      if (proxyShapeId === 2) this.renderedColumnCasters += 1;
      if (proxyShapeId === 3) this.renderedDiscCasters += 1;
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
    this.device.queue.writeBuffer(this.casterBuffer, 0, this.casterScratch);
    return renderedCasters;
  }

  private updateLightCamera(input: RenderFrameInput): void {
    const arenaRadius = Math.max(24, finiteOrDefault(input.scenePresentation.arenaRadius, 92));
    const heightPadding = Math.max(18, arenaRadius * 0.28);
    const lightBounds = Math.max(32, arenaRadius * 1.22 + heightPadding);
    const lightDirection = new THREE.Vector3(
      finiteOrDefault(input.sceneLighting.keyDirection.x, -0.26),
      finiteOrDefault(input.sceneLighting.keyDirection.y, 0.82),
      finiteOrDefault(input.sceneLighting.keyDirection.z, 0.48)
    ).normalize();

    this.lightBounds = lightBounds;
    this.lightCamera.left = -lightBounds;
    this.lightCamera.right = lightBounds;
    this.lightCamera.top = lightBounds;
    this.lightCamera.bottom = -lightBounds;
    this.lightCamera.near = 0.1;
    this.lightCamera.far = lightBounds * 3.4;
    this.lightCamera.position.copy(lightDirection).multiplyScalar(lightBounds * 1.45);
    this.lightCamera.position.y += heightPadding * 0.35;
    this.lightCamera.lookAt(0, 0, 0);
    this.lightCamera.updateMatrixWorld();
    this.lightCamera.updateProjectionMatrix();
    this.lightViewProjection.multiplyMatrices(this.lightCamera.projectionMatrix, this.lightCamera.matrixWorldInverse);
  }

  private requireTextureView(): GPUTextureView {
    if (!this.textureView) {
      throw new Error("WebGPU shadow map texture was not configured.");
    }
    return this.textureView;
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < SHADOW_MAP_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("shadow.webgpu.map.frame", "WebGPU directional shadow map frame sample", {
      mode: "webgpu-shadow-map",
      scenePresentationMode: input.scenePresentation.mode,
      shadowMode: "shadow-map-contact",
      shadowGeometryMode: SHADOW_GEOMETRY_MODE,
      fieldReceiver: true,
      mapSize: this.mapSize,
      format: WEBGPU_SHADOW_MAP_FORMAT,
      activeShadowCasters: this.activeShadowCasters,
      renderedShadowCasters: this.renderedShadowCasters,
      renderedOrbCasters: this.renderedOrbCasters,
      renderedColumnCasters: this.renderedColumnCasters,
      renderedDiscCasters: this.renderedDiscCasters,
      shadowCasterLimit: RENDER_SCENE_SHADOW_CASTER_LIMIT,
      lightBounds: roundMetric(this.lightBounds),
      pcfTaps: SHADOW_MAP_PCF_TAPS,
      trianglesPerCaster: SHADOW_MAP_TRIANGLES_PER_CASTER,
      shadowMapProxyTriangles: this.renderedShadowCasters * SHADOW_MAP_TRIANGLES_PER_CASTER,
      proxyTriangles: this.renderedShadowCasters * SHADOW_MAP_TRIANGLES_PER_CASTER,
      passMs: roundMetric(this.passMs),
      deviceLost
    }, "debug");
  }
}

function getShadowMapSize(preset: QualityPreset, maxTextureDimension2D: number): number {
  const requestedSize = preset.shadowMapSize > 0 ? preset.shadowMapSize : SHADOW_MAP_MIN_SIZE;
  const clampedSize = Math.max(1, Math.min(requestedSize, maxTextureDimension2D));
  return nearestLowerPowerOfTwo(Math.max(SHADOW_MAP_MIN_SIZE, clampedSize));
}

function nearestLowerPowerOfTwo(value: number): number {
  return 2 ** Math.floor(Math.log2(Math.max(1, value)));
}

function getDepthBias(preset: QualityPreset): number {
  return Math.max(0.0014, 2.15 / Math.max(SHADOW_MAP_MIN_SIZE, preset.shadowMapSize || SHADOW_MAP_MIN_SIZE));
}

function compareShadowCasters(a: RenderSceneShadowCasterSnapshot, b: RenderSceneShadowCasterSnapshot): number {
  return b.importance - a.importance;
}

function shadowKindId(kind: RenderSceneShadowCasterKind): number {
  switch (kind) {
    case "avatar":
      return 1;
    case "echo":
      return 2;
    case "echo-burst":
      return 3;
    case "pulse":
      return 4;
    default:
      return 0;
  }
}

function shadowProxyShapeId(shape: RenderSceneShadowCasterSnapshot["shadowMapProxy"]["shape"]): number {
  switch (shape) {
    case "orb":
      return 1;
    case "column":
      return 2;
    case "disc":
      return 3;
    default:
      return 0;
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
