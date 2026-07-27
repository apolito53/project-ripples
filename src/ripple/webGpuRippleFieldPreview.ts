/// <reference types="@webgpu/types" />

import {
  BASE_TILE_HEIGHT,
  HEX_TILE_DIAMETER,
  createRippleFieldLayout,
  type RippleFieldLayout
} from "../rippleFieldLayout";
import {
  getFieldPaletteShaderIndex,
  resolveFieldPaletteForProfile,
  shouldPreserveCorePalette,
  type ResolvedFieldPaletteId
} from "../fieldPalette";
import { MAX_SHADER_RIPPLE_SOURCES, RIPPLE_LIFETIME_SECONDS, type RippleRenderSourceSnapshot } from "../rippleSources";
import type { QualityPreset } from "../qualityPresets";
import type { RenderFrameInput, RenderPresentationProfile } from "../render/types";
import type { WebGpuDiagnosticLogger } from "../render/webgpu";
import type { WebGpuWakeFieldProbeMetrics } from "../wake/webGpuWakeFieldProbe";
import { getBasePropagationSpeedMetersPerSecond } from "../waveMedium";
import rippleFieldPreviewSource from "./webGpuRippleFieldPreview.wgsl?raw";

const FIELD_PREVIEW_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const FIELD_CAMERA_MATRIX_FLOATS = 16;
const FIELD_UNIFORM_FLOATS = FIELD_CAMERA_MATRIX_FLOATS + 40;
const FIELD_CELL_FLOATS = 8;
const SOURCE_FLOATS = 8;
const ECHO_FLOATS = 8;
const MAX_WEBGPU_ECHO_MARKERS = 8;
const MAX_WEBGPU_ECHO_COLLECTION_EVENTS = 8;
const CORE_FIELD_VERTEX_COUNT = 18;
const CLASSIC_FIELD_VERTEX_COUNT = 72;
const FIELD_DRAW_CALLS = 1;
const CORE_FIELD_TRIANGLES_PER_INSTANCE = 6;
const CLASSIC_FIELD_TRIANGLES_PER_INSTANCE = 24;
const CLASSIC_FIELD_VISIBLE_SIDE_FACE_COUNT = 6;
export const FIELD_DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

export type WebGpuRippleFieldPreviewFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly wakeTextureView: GPUTextureView;
  readonly sceneLightBindGroup: GPUBindGroup;
  readonly sceneShadowBindGroup: GPUBindGroup;
  readonly shadowMapBindGroup: GPUBindGroup;
  readonly wakeMetrics: WebGpuWakeFieldProbeMetrics;
  readonly renderInput: RenderFrameInput;
  readonly colorLoadOp?: GPULoadOp;
  readonly deviceLost: boolean;
};

export type WebGpuRippleFieldPreviewMetrics = {
  readonly mode: "webgpu-field-preview";
  readonly projectionMode: "perspective";
  readonly cameraMode: string;
  readonly depthFormat: GPUTextureFormat;
  readonly qualityId: string;
  readonly presentationProfile: RenderPresentationProfile;
  readonly fieldPalette: ResolvedFieldPaletteId;
  readonly waveDynamicsMode: "classic-parity";
  readonly playerPresenceMode: "pressure-rim";
  readonly playerPresenceAnimated: true;
  readonly fieldGeometryMode: "hex-cap" | "hex-prism";
  readonly fieldVerticesPerInstance: number;
  readonly fieldTrianglesPerInstance: number;
  readonly visibleSideFaceCount: number;
  readonly bottomFaceIncluded: boolean;
  readonly tileHeightMode: "flat-cap" | "animated-prism";
  readonly instanceCount: number;
  readonly sourceLimit: number;
  readonly activeSources: number;
  readonly renderedSources: number;
  readonly activeEchoes: number;
  readonly renderedEchoes: number;
  readonly activeEchoBursts: number;
  readonly renderedEchoBursts: number;
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly playMode: string;
  readonly raceTrackEnabled: boolean;
  readonly raceTrackStrength: number;
  readonly trackFieldRadius: number;
  readonly trackWidthMeters: number;
  readonly raceTrackMaskWidth: number;
  readonly raceTrackMaskHeight: number;
  readonly raceTrackMaskVersion: number;
  readonly trackMaskUploaded: boolean;
  readonly trackMaskBodyCoverage: number;
  readonly trackMaskEdgeCoverage: number;
  readonly trackMaskCenterCoverage: number;
  readonly fieldLayoutMode: string;
  readonly culledHexCount: number;
};

export class WebGpuRippleFieldPreview {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly corePipeline: GPURenderPipeline;
  private readonly classicPipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly sourceBuffer: GPUBuffer;
  private readonly echoBuffer: GPUBuffer;
  private readonly trackSampler: GPUSampler;
  private readonly uniforms = new Float32Array(FIELD_UNIFORM_FLOATS);
  private readonly sourceScratch = new Float32Array(MAX_SHADER_RIPPLE_SOURCES * SOURCE_FLOATS);
  private readonly echoScratch = new Float32Array(
    (MAX_WEBGPU_ECHO_MARKERS + MAX_WEBGPU_ECHO_COLLECTION_EVENTS) * ECHO_FLOATS
  );
  private layout: RippleFieldLayout;
  private fieldBuffer: GPUBuffer;
  private trackTexture: GPUTexture;
  private trackTextureView: GPUTextureView;
  private trackTextureWidth = 1;
  private trackTextureHeight = 1;
  private trackMaskVersion = -1;
  private trackMaskUploaded = false;
  private playMode = "none";
  private raceTrackEnabled = false;
  private raceTrackStrength = 0;
  private trackFieldRadius = 0;
  private trackWidthMeters = 0;
  private trackMaskBodyCoverage = 0;
  private trackMaskEdgeCoverage = 0;
  private trackMaskCenterCoverage = 0;
  private fieldLayoutMode = "arena-full";
  private culledHexCount = 0;
  private frameCount = 0;
  private passMs = 0;
  private renderedSourceCount = 0;
  private activeSourceCount = 0;
  private renderedEchoCount = 0;
  private activeEchoCount = 0;
  private renderedEchoBurstCount = 0;
  private activeEchoBurstCount = 0;
  private lastFrameLogAt = -Infinity;
  private depthTexture: GPUTexture | null = null;
  private depthTextureView: GPUTextureView | null = null;
  private presentationWidth = 1;
  private presentationHeight = 1;
  private cameraMode = "diagnostic-orbit";
  private presentationProfile: RenderPresentationProfile;
  private fieldPalette: ResolvedFieldPaletteId;
  private lastGeometryLogProfile: RenderPresentationProfile | null = null;

  private constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    private readonly log: WebGpuDiagnosticLogger,
    initialPreset: QualityPreset,
    initialPresentationProfile: RenderPresentationProfile,
    bindGroupLayout: GPUBindGroupLayout,
    corePipeline: GPURenderPipeline,
    classicPipeline: GPURenderPipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.corePipeline = corePipeline;
    this.classicPipeline = classicPipeline;
    this.presentationProfile = initialPresentationProfile;
    this.fieldPalette = resolveFieldPaletteForProfile("profile", initialPresentationProfile);
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU field preview uniforms",
      size: FIELD_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.sourceBuffer = device.createBuffer({
      label: "Ripple WebGPU field preview source buffer",
      size: MAX_SHADER_RIPPLE_SOURCES * SOURCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.echoBuffer = device.createBuffer({
      label: "Ripple WebGPU field preview echo marker buffer",
      size: this.echoScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.trackSampler = device.createSampler({
      label: "Ripple WebGPU field preview track mask sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear"
    });
    this.trackTexture = this.createTrackTexture(1, 1);
    this.trackTextureView = this.trackTexture.createView({
      label: "Ripple WebGPU field preview track mask texture view"
    });
    this.layout = createRippleFieldLayout(initialPreset);
    this.fieldBuffer = this.createFieldBuffer(this.layout);
    this.logLayout("init");
    this.log("ripple.webgpu.preview.init", "WebGPU RippleField diagnostic preview initialized", {
      mode: "webgpu-field-preview",
      projectionMode: "perspective",
      depthFormat: FIELD_DEPTH_FORMAT,
      format,
      quality: this.layout.qualityId,
      instanceCount: this.layout.instanceCount,
      sourceLimit: this.layout.renderedRippleSourceLimit,
      echoLimit: MAX_WEBGPU_ECHO_MARKERS,
      echoBurstLimit: MAX_WEBGPU_ECHO_COLLECTION_EVENTS,
      trackMaskFormat: "rgba8unorm",
      supportedPresentationProfiles: "classic,core",
      presentationProfile: this.presentationProfile,
      fieldPalette: this.fieldPalette,
      waveDynamicsMode: getWaveDynamicsMode(),
      ...getPlayerPresenceMetrics(),
      ...getFieldGeometryMetrics(this.presentationProfile),
      drawCalls: FIELD_DRAW_CALLS,
      triangles: this.getTriangleCount()
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    initialPreset: QualityPreset,
    log: WebGpuDiagnosticLogger,
    initialPresentationProfile: RenderPresentationProfile,
    sceneLightBindGroupLayout: GPUBindGroupLayout,
    sceneShadowBindGroupLayout: GPUBindGroupLayout,
    shadowMapBindGroupLayout: GPUBindGroupLayout
  ): Promise<WebGpuRippleFieldPreview> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = createFieldPreviewBindGroupLayout(device);
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU field preview shader",
        code: rippleFieldPreviewSource
      });
      const pipelineLayout = device.createPipelineLayout({
        label: "Ripple WebGPU field preview pipeline layout",
        bindGroupLayouts: [
          bindGroupLayout,
          sceneLightBindGroupLayout,
          sceneShadowBindGroupLayout,
          shadowMapBindGroupLayout
        ]
      });
      const createPipeline = (profile: RenderPresentationProfile): Promise<GPURenderPipeline> =>
        device.createRenderPipelineAsync({
          label: `Ripple WebGPU ${profile} field preview pipeline`,
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: profile === "classic" ? "vertexClassicMain" : "vertexCoreMain"
          },
          fragment: {
            module: shaderModule,
            entryPoint: profile === "classic" ? "fragmentClassicMain" : "fragmentCoreMain",
            targets: [{ format }]
          },
          primitive: {
            topology: "triangle-list",
            cullMode: profile === "classic" ? "back" : "none"
          },
          depthStencil: {
            format: FIELD_DEPTH_FORMAT,
            depthWriteEnabled: true,
            depthCompare: "less"
          }
        });
      const [corePipeline, classicPipeline] = await Promise.all([
        createPipeline("core"),
        createPipeline("classic")
      ]);

      const scopedError = await device.popErrorScope();
      if (scopedError) {
        throw new Error(scopedError.message);
      }

      return new WebGpuRippleFieldPreview(
        device,
        format,
        log,
        initialPreset,
        initialPresentationProfile,
        bindGroupLayout,
        corePipeline,
        classicPipeline
      );
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("ripple.webgpu.preview.error", "WebGPU RippleField diagnostic preview failed to initialize", {
        message,
        format
      }, "error");
      throw new Error(`WebGPU RippleField preview failed: ${message}`);
    }
  }

  applyQualityPreset(preset: QualityPreset, reason = "quality"): void {
    this.applyLayout(createRippleFieldLayout(preset), reason);
  }

  applyLayout(nextLayout: RippleFieldLayout, reason = "layout"): void {
    if (
      nextLayout.qualityId === this.layout.qualityId &&
      nextLayout.fieldRadius === this.layout.fieldRadius &&
      nextLayout.tileSpacing === this.layout.tileSpacing &&
      nextLayout.instanceCount === this.layout.instanceCount &&
      nextLayout.buildStats.mode === this.layout.buildStats.mode &&
      nextLayout.buildStats.clipperLabel === this.layout.buildStats.clipperLabel
    ) {
      return;
    }

    this.fieldBuffer.destroy();
    this.layout = nextLayout;
    this.fieldBuffer = this.createFieldBuffer(nextLayout);
    this.logLayout(reason);
  }

  resize(presentationWidth: number, presentationHeight: number): void {
    const nextWidth = Math.max(1, Math.floor(presentationWidth));
    const nextHeight = Math.max(1, Math.floor(presentationHeight));

    if (
      this.depthTextureView &&
      nextWidth === this.presentationWidth &&
      nextHeight === this.presentationHeight
    ) {
      return;
    }

    this.depthTexture?.destroy();
    this.presentationWidth = nextWidth;
    this.presentationHeight = nextHeight;
    this.depthTexture = this.device.createTexture({
      label: "Ripple WebGPU field preview depth texture",
      size: { width: nextWidth, height: nextHeight, depthOrArrayLayers: 1 },
      format: FIELD_DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthTextureView = this.depthTexture.createView({
      label: "Ripple WebGPU field preview depth texture view"
    });

    this.log("ripple.webgpu.preview.depth", "Configured WebGPU RippleField preview depth target", {
      mode: "webgpu-field-preview",
      projectionMode: "perspective",
      depthFormat: FIELD_DEPTH_FORMAT,
      presentationWidth: nextWidth,
      presentationHeight: nextHeight
    });
  }

  render(input: WebGpuRippleFieldPreviewFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    this.applyLayout(input.renderInput.fieldLayout, "frame-contract");
    const renderedSourceCount = this.writeSourceBuffer(input.renderInput.pulseSources);
    const echoCounts = this.writeEchoBuffer(input.renderInput.echoVisualState);
    this.updateTrackMask(input.renderInput);
    this.cameraMode = input.renderInput.camera.projection.cameraMode;
    this.presentationProfile = input.renderInput.scenePresentation.profile;
    this.writeUniforms(input.renderInput, input.wakeMetrics, renderedSourceCount, echoCounts);
    const depthView = this.getDepthTextureView(input.renderInput);
    this.maybeLogGeometry();

    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU field preview bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.fieldBuffer } },
        { binding: 2, resource: input.wakeTextureView },
        { binding: 3, resource: { buffer: this.sourceBuffer } },
        { binding: 4, resource: { buffer: this.echoBuffer } },
        { binding: 5, resource: this.trackTextureView },
        { binding: 6, resource: this.trackSampler }
      ]
    });
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU field preview render pass",
      colorAttachments: [{
        view: input.targetView,
        clearValue: { r: 0.01, g: 0.014, b: 0.022, a: 1 },
        loadOp: input.colorLoadOp ?? "clear",
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(this.presentationProfile === "classic" ? this.classicPipeline : this.corePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setBindGroup(1, input.sceneLightBindGroup);
    pass.setBindGroup(2, input.sceneShadowBindGroup);
    pass.setBindGroup(3, input.shadowMapBindGroup);
    pass.draw(getFieldVertexCount(this.presentationProfile), this.layout.instanceCount);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.frameCount += 1;
    this.maybeLogFrame(input.renderInput, input.wakeMetrics, input.deviceLost);
    return this.passMs;
  }

  getSharedDepthTextureView(input: RenderFrameInput): GPUTextureView {
    return this.getDepthTextureView(input);
  }

  getMetrics(): WebGpuRippleFieldPreviewMetrics {
    return {
      mode: "webgpu-field-preview",
      projectionMode: "perspective",
      cameraMode: this.cameraMode,
      depthFormat: FIELD_DEPTH_FORMAT,
      qualityId: this.layout.qualityId,
      presentationProfile: this.presentationProfile,
      fieldPalette: this.fieldPalette,
      waveDynamicsMode: getWaveDynamicsMode(),
      ...getPlayerPresenceMetrics(),
      ...getFieldGeometryMetrics(this.presentationProfile),
      instanceCount: this.layout.instanceCount,
      sourceLimit: this.layout.renderedRippleSourceLimit,
      activeSources: this.activeSourceCount,
      renderedSources: this.renderedSourceCount,
      activeEchoes: this.activeEchoCount,
      renderedEchoes: this.renderedEchoCount,
      activeEchoBursts: this.activeEchoBurstCount,
      renderedEchoBursts: this.renderedEchoBurstCount,
      passMs: this.passMs,
      drawCalls: FIELD_DRAW_CALLS,
      triangles: this.getTriangleCount(),
      playMode: this.playMode,
      raceTrackEnabled: this.raceTrackEnabled,
      raceTrackStrength: this.raceTrackStrength,
      trackFieldRadius: this.trackFieldRadius,
      trackWidthMeters: this.trackWidthMeters,
      raceTrackMaskWidth: this.trackTextureWidth,
      raceTrackMaskHeight: this.trackTextureHeight,
      raceTrackMaskVersion: this.trackMaskVersion,
      trackMaskUploaded: this.trackMaskUploaded,
      trackMaskBodyCoverage: this.trackMaskBodyCoverage,
      trackMaskEdgeCoverage: this.trackMaskEdgeCoverage,
      trackMaskCenterCoverage: this.trackMaskCenterCoverage,
      fieldLayoutMode: this.fieldLayoutMode,
      culledHexCount: this.culledHexCount
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return {
      drawCalls: FIELD_DRAW_CALLS,
      triangles: this.getTriangleCount()
    };
  }

  dispose(): void {
    this.depthTexture?.destroy();
    this.trackTexture.destroy();
    this.fieldBuffer.destroy();
    this.echoBuffer.destroy();
    this.sourceBuffer.destroy();
    this.uniformBuffer.destroy();
  }

  private createFieldBuffer(layout: RippleFieldLayout): GPUBuffer {
    const packedCells = new Float32Array(Math.max(1, layout.instanceCount) * FIELD_CELL_FLOATS);

    for (let index = 0; index < layout.instanceCount; index += 1) {
      const positionOffset = index * 3;
      const tintOffset = index * 3;
      const writeOffset = index * FIELD_CELL_FLOATS;

      packedCells[writeOffset] = layout.positions[positionOffset];
      packedCells[writeOffset + 1] = layout.positions[positionOffset + 1];
      packedCells[writeOffset + 2] = layout.positions[positionOffset + 2];
      packedCells[writeOffset + 3] = layout.phases[index];
      packedCells[writeOffset + 4] = layout.tints[tintOffset];
      packedCells[writeOffset + 5] = layout.tints[tintOffset + 1];
      packedCells[writeOffset + 6] = layout.tints[tintOffset + 2];
      packedCells[writeOffset + 7] = 0;
    }

    const buffer = this.device.createBuffer({
      label: "Ripple WebGPU field preview cell buffer",
      size: packedCells.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(buffer, 0, packedCells);
    return buffer;
  }

  private writeUniforms(
    input: RenderFrameInput,
    wakeMetrics: WebGpuWakeFieldProbeMetrics,
    renderedSourceCount: number,
    echoCounts: { readonly renderedEchoes: number; readonly renderedEchoBursts: number }
  ): void {
    const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(input.settings.waveMedium);

    for (let index = 0; index < FIELD_CAMERA_MATRIX_FLOATS; index += 1) {
      const identityFallback = index % 5 === 0 ? 1 : 0;
      this.uniforms[index] = finiteOrDefault(input.camera.viewProjectionMatrix[index], identityFallback);
    }

    const uniformOffset = FIELD_CAMERA_MATRIX_FLOATS;
    this.uniforms[uniformOffset] = input.time;
    this.uniforms[uniformOffset + 1] = input.delta;
    this.uniforms[uniformOffset + 2] = this.layout.fieldRadius;
    this.uniforms[uniformOffset + 3] = input.camera.projection.aspect;
    this.uniforms[uniformOffset + 4] = input.player.position.x;
    this.uniforms[uniformOffset + 5] = input.player.position.z;
    this.uniforms[uniformOffset + 6] = input.player.speed;
    this.uniforms[uniformOffset + 7] = input.player.groundContact;
    this.uniforms[uniformOffset + 8] = input.player.velocity.x;
    this.uniforms[uniformOffset + 9] = input.player.velocity.z;
    this.uniforms[uniformOffset + 10] = 0;
    this.uniforms[uniformOffset + 11] = 0;
    this.uniforms[uniformOffset + 12] = input.settings.rippleHeight;
    this.uniforms[uniformOffset + 13] = input.settings.rippleRadius;
    this.uniforms[uniformOffset + 14] = input.settings.voxelSizeMeters;
    this.uniforms[uniformOffset + 15] = basePropagationSpeed;
    this.uniforms[uniformOffset + 16] = input.settings.waveMedium.damping;
    this.uniforms[uniformOffset + 17] = input.settings.waveMedium.dispersion;
    this.uniforms[uniformOffset + 18] = input.bloomStrength;
    this.uniforms[uniformOffset + 19] = renderedSourceCount;
    this.uniforms[uniformOffset + 20] = this.layout.renderedRippleSourceLimit;
    this.uniforms[uniformOffset + 21] = wakeMetrics.textureSize;
    this.uniforms[uniformOffset + 22] = HEX_TILE_DIAMETER;
    this.uniforms[uniformOffset + 23] = BASE_TILE_HEIGHT;
    this.uniforms[uniformOffset + 24] = echoCounts.renderedEchoes;
    this.uniforms[uniformOffset + 25] = echoCounts.renderedEchoBursts;
    this.uniforms[uniformOffset + 26] = MAX_WEBGPU_ECHO_MARKERS;
    this.uniforms[uniformOffset + 27] = MAX_WEBGPU_ECHO_COLLECTION_EVENTS;
    this.uniforms[uniformOffset + 28] = input.raceTrack.enabled ? input.raceTrack.strength : 0;
    this.uniforms[uniformOffset + 29] = input.raceTrack.fieldRadius;
    this.uniforms[uniformOffset + 30] = input.raceTrack.mask.width;
    this.uniforms[uniformOffset + 31] = input.raceTrack.mask.height;
    this.fieldPalette = resolveFieldPaletteForProfile(input.settings.fieldPaletteId, this.presentationProfile);
    this.uniforms[uniformOffset + 32] = getFieldPaletteShaderIndex(this.fieldPalette);
    // Core's Match Field Style option preserves the original muted treatment;
    // an explicit Legacy Neon choice opts into the stronger shared palette.
    this.uniforms[uniformOffset + 33] = shouldPreserveCorePalette(
      input.settings.fieldPaletteId,
      this.presentationProfile
    ) ? 1 : 0;
    this.uniforms[uniformOffset + 34] = 0;
    this.uniforms[uniformOffset + 35] = 0;
    // The field fragment shader needs the real camera position for the same
    // view-dependent reflected-light response as Three's MeshStandardMaterial.
    this.uniforms[uniformOffset + 36] = input.camera.position.x;
    this.uniforms[uniformOffset + 37] = input.camera.position.y;
    this.uniforms[uniformOffset + 38] = input.camera.position.z;
    this.uniforms[uniformOffset + 39] = 1;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private updateTrackMask(input: RenderFrameInput): void {
    this.playMode = input.playMode;
    this.raceTrackEnabled = input.raceTrack.enabled;
    this.raceTrackStrength = input.raceTrack.strength;
    this.trackFieldRadius = input.raceTrack.fieldRadius;
    this.trackWidthMeters = input.raceTrack.trackWidthMeters;
    this.fieldLayoutMode = this.layout.buildStats.mode === "clipped" ? "track-clipped" : "arena-full";
    this.culledHexCount = this.layout.buildStats.culledHexCount;

    if (!input.raceTrack.enabled) {
      this.trackMaskUploaded = false;
      this.trackMaskBodyCoverage = 0;
      this.trackMaskEdgeCoverage = 0;
      this.trackMaskCenterCoverage = 0;
      return;
    }

    const mask = input.raceTrack.mask;
    if (
      mask.version === this.trackMaskVersion &&
      mask.width === this.trackTextureWidth &&
      mask.height === this.trackTextureHeight
    ) {
      this.trackMaskUploaded = true;
      return;
    }

    if (mask.width <= 0 || mask.height <= 0 || mask.rgba.byteLength < mask.width * mask.height * 4) {
      this.trackMaskUploaded = false;
      this.trackMaskBodyCoverage = 0;
      this.trackMaskEdgeCoverage = 0;
      this.trackMaskCenterCoverage = 0;
      this.log("ripple.webgpu.preview.error", "Skipped invalid WebGPU race-track mask upload", {
        playMode: input.playMode,
        raceTrackEnabled: input.raceTrack.enabled,
        raceTrackMaskWidth: mask.width,
        raceTrackMaskHeight: mask.height,
        raceTrackMaskVersion: mask.version,
        byteLength: mask.rgba.byteLength
      }, "error");
      return;
    }

    if (mask.width !== this.trackTextureWidth || mask.height !== this.trackTextureHeight) {
      this.trackTexture.destroy();
      this.trackTexture = this.createTrackTexture(mask.width, mask.height);
      this.trackTextureView = this.trackTexture.createView({
        label: "Ripple WebGPU field preview track mask texture view"
      });
      this.trackTextureWidth = mask.width;
      this.trackTextureHeight = mask.height;
    }

    this.device.queue.writeTexture(
      { texture: this.trackTexture },
      mask.rgba.buffer as GPUAllowSharedBufferSource,
      { offset: mask.rgba.byteOffset, bytesPerRow: mask.width * 4, rowsPerImage: mask.height },
      { width: mask.width, height: mask.height, depthOrArrayLayers: 1 }
    );
    this.trackMaskVersion = mask.version;
    this.trackMaskUploaded = true;
    const coverage = analyzeTrackMaskCoverage(mask.rgba, mask.width, mask.height);
    this.trackMaskBodyCoverage = coverage.body;
    this.trackMaskEdgeCoverage = coverage.edge;
    this.trackMaskCenterCoverage = coverage.center;
  }

  private writeSourceBuffer(snapshot: RippleRenderSourceSnapshot): number {
    const maxWrittenSources = Math.max(
      0,
      Math.min(
        MAX_SHADER_RIPPLE_SOURCES,
        this.layout.renderedRippleSourceLimit,
        snapshot.sourceLimit,
        snapshot.sources.length
      )
    );

    this.sourceScratch.fill(0);
    for (let index = 0; index < maxWrittenSources; index += 1) {
      const source = snapshot.sources[index];
      const writeOffset = index * SOURCE_FLOATS;

      this.sourceScratch[writeOffset] = finiteOrDefault(source.positionX, 0);
      this.sourceScratch[writeOffset + 1] = finiteOrDefault(source.positionZ, 0);
      this.sourceScratch[writeOffset + 2] = finiteOrDefault(source.startTime, snapshot.time);
      this.sourceScratch[writeOffset + 3] = finiteOrDefault(source.strength, 0);
      this.sourceScratch[writeOffset + 4] = finiteOrDefault(source.speedMultiplier, 1);
      this.sourceScratch[writeOffset + 5] = finiteOrDefault(source.widthMultiplier, 1);
      this.sourceScratch[writeOffset + 6] = finiteOrDefault(source.dampingMultiplier, 1);
      this.sourceScratch[writeOffset + 7] = finiteOrDefault(source.lifetimeSeconds, RIPPLE_LIFETIME_SECONDS);
    }

    this.device.queue.writeBuffer(this.sourceBuffer, 0, this.sourceScratch);
    this.renderedSourceCount = maxWrittenSources;
    this.activeSourceCount = snapshot.activeCount;
    return maxWrittenSources;
  }

  private writeEchoBuffer(
    snapshot: RenderFrameInput["echoVisualState"]
  ): { readonly renderedEchoes: number; readonly renderedEchoBursts: number } {
    const renderedEchoes = Math.max(0, Math.min(MAX_WEBGPU_ECHO_MARKERS, snapshot.echoes.length));
    const renderedEchoBursts = Math.max(
      0,
      Math.min(MAX_WEBGPU_ECHO_COLLECTION_EVENTS, snapshot.collectionEvents.length)
    );

    this.echoScratch.fill(0);
    for (let index = 0; index < renderedEchoes; index += 1) {
      const echo = snapshot.echoes[index];
      const writeOffset = index * ECHO_FLOATS;

      this.echoScratch[writeOffset] = finiteOrDefault(echo.positionX, 0);
      this.echoScratch[writeOffset + 1] = finiteOrDefault(echo.positionZ, 0);
      this.echoScratch[writeOffset + 2] = finiteOrDefault(echo.triggerRadius, 1);
      this.echoScratch[writeOffset + 3] = finiteOrDefault(echo.age, 0);
      this.echoScratch[writeOffset + 4] = finiteOrDefault(echo.radius, 1);
      this.echoScratch[writeOffset + 5] = finiteOrDefault(echo.phase, 0);
      this.echoScratch[writeOffset + 6] = finiteOrDefault(echo.id, 0);
      this.echoScratch[writeOffset + 7] = finiteOrDefault(echo.positionY, 0);
    }

    const burstBaseOffset = MAX_WEBGPU_ECHO_MARKERS * ECHO_FLOATS;
    for (let index = 0; index < renderedEchoBursts; index += 1) {
      const event = snapshot.collectionEvents[index];
      const writeOffset = burstBaseOffset + index * ECHO_FLOATS;

      this.echoScratch[writeOffset] = finiteOrDefault(event.positionX, 0);
      this.echoScratch[writeOffset + 1] = finiteOrDefault(event.positionZ, 0);
      this.echoScratch[writeOffset + 2] = finiteOrDefault(event.discBurstRadius, 1);
      this.echoScratch[writeOffset + 3] = finiteOrDefault(event.age, 0);
      this.echoScratch[writeOffset + 4] = finiteOrDefault(event.burstStrength, 0);
      this.echoScratch[writeOffset + 5] = finiteOrDefault(event.id, 0);
      this.echoScratch[writeOffset + 6] = finiteOrDefault(event.positionY, 0);
      this.echoScratch[writeOffset + 7] = finiteOrDefault(event.effectPositionY, 0);
    }

    this.device.queue.writeBuffer(this.echoBuffer, 0, this.echoScratch);
    this.activeEchoCount = snapshot.activeEchoes;
    this.renderedEchoCount = renderedEchoes;
    this.activeEchoBurstCount = snapshot.activeVisualBursts;
    this.renderedEchoBurstCount = renderedEchoBursts;
    return { renderedEchoes, renderedEchoBursts };
  }

  private maybeLogFrame(
    input: RenderFrameInput,
    wakeMetrics: WebGpuWakeFieldProbeMetrics,
    deviceLost: boolean
  ): void {
    if (input.time - this.lastFrameLogAt < FIELD_PREVIEW_FRAME_LOG_INTERVAL_SECONDS) return;

    let renderedOrbCasters = 0;
    let renderedColumnCasters = 0;
    let renderedDiscCasters = 0;
    for (const caster of input.sceneShadows.casters) {
      if (caster.shadowMapProxy.shape === "orb") renderedOrbCasters += 1;
      if (caster.shadowMapProxy.shape === "column") renderedColumnCasters += 1;
      if (caster.shadowMapProxy.shape === "disc") renderedDiscCasters += 1;
    }

    this.lastFrameLogAt = input.time;
    this.log("ripple.webgpu.preview.frame", "WebGPU RippleField diagnostic preview frame sample", {
      time: roundMetric(input.time),
      mode: "webgpu-field-preview",
      backendId: "webgpu",
      projectionMode: "perspective",
      cameraMode: this.cameraMode,
      depthFormat: FIELD_DEPTH_FORMAT,
      passMs: roundMetric(this.passMs),
      quality: this.layout.qualityId,
      presentationProfile: this.presentationProfile,
      fieldPalette: this.fieldPalette,
      waveDynamicsMode: getWaveDynamicsMode(),
      ...getPlayerPresenceMetrics(),
      ...getFieldGeometryMetrics(this.presentationProfile),
      instanceCount: this.layout.instanceCount,
      sourceLimit: this.layout.renderedRippleSourceLimit,
      activeSources: this.activeSourceCount,
      renderedSources: this.renderedSourceCount,
      activeEchoes: this.activeEchoCount,
      renderedEchoes: this.renderedEchoCount,
      activeEchoBursts: this.activeEchoBurstCount,
      renderedEchoBursts: this.renderedEchoBurstCount,
      activeLocalLights: input.sceneLighting.activeLocalLights,
      renderedLocalLights: input.sceneLighting.localLights.length,
      shadowMode: input.sceneShadows.mode,
      activeShadowCasters: input.sceneShadows.activeCasters,
      renderedShadowCasters: input.sceneShadows.casters.length,
      shadowStrength: roundMetric(input.sceneShadows.strength),
      shadowSoftness: roundMetric(input.sceneShadows.softness),
      shadowMapMode: "directional-depth32float",
      shadowGeometryMode: "shape-proxy-casters",
      fieldReceiver: true,
      renderedOrbCasters,
      renderedColumnCasters,
      renderedDiscCasters,
      shadowMapProxyTriangles: input.sceneShadows.casters.length * 6,
      playMode: input.playMode,
      raceTrackEnabled: input.raceTrack.enabled,
      raceTrackStrength: roundMetric(input.raceTrack.strength),
      trackFieldRadius: roundMetric(input.raceTrack.fieldRadius),
      trackWidthMeters: roundMetric(input.raceTrack.trackWidthMeters),
      raceTrackMaskWidth: input.raceTrack.mask.width,
      raceTrackMaskHeight: input.raceTrack.mask.height,
      raceTrackMaskVersion: input.raceTrack.mask.version,
      trackMaskUploaded: this.trackMaskUploaded,
      trackMaskBodyCoverage: roundMetric(this.trackMaskBodyCoverage),
      trackMaskEdgeCoverage: roundMetric(this.trackMaskEdgeCoverage),
      trackMaskCenterCoverage: roundMetric(this.trackMaskCenterCoverage),
      arenaBarrierEnabled: input.playMode !== "track" && input.playMode !== "training",
      fieldLayoutMode: this.fieldLayoutMode,
      culledHexCount: this.culledHexCount,
      wakeTextureSize: wakeMetrics.textureSize,
      drawCalls: FIELD_DRAW_CALLS,
      triangles: this.getTriangleCount(),
      deviceLost
    }, "debug");
  }

  private logLayout(reason: string): void {
    this.log("ripple.webgpu.layout", "Built WebGPU RippleField diagnostic layout", {
      reason,
      mode: "webgpu-field-preview",
      projectionMode: "perspective",
      depthFormat: FIELD_DEPTH_FORMAT,
      quality: this.layout.qualityId,
      fieldRadius: roundMetric(this.layout.fieldRadius),
      tileSpacing: roundMetric(this.layout.tileSpacing),
      instanceCount: this.layout.instanceCount,
      sourceLimit: this.layout.renderedRippleSourceLimit,
      echoLimit: MAX_WEBGPU_ECHO_MARKERS,
      echoBurstLimit: MAX_WEBGPU_ECHO_COLLECTION_EVENTS,
      fieldLayoutMode: this.layout.buildStats.mode === "clipped" ? "track-clipped" : "arena-full",
      culledHexCount: this.layout.buildStats.culledHexCount
    });
  }

  private createTrackTexture(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      label: "Ripple WebGPU field preview track mask texture",
      size: { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
  }

  private getTriangleCount(): number {
    return this.layout.instanceCount * getFieldTrianglesPerInstance(this.presentationProfile);
  }

  private maybeLogGeometry(): void {
    if (this.lastGeometryLogProfile === this.presentationProfile) return;
    const previousPresentationProfile = this.lastGeometryLogProfile;
    this.lastGeometryLogProfile = this.presentationProfile;
    this.log("ripple.webgpu.geometry", "Selected WebGPU RippleField geometry profile", {
      presentationProfile: this.presentationProfile,
      waveDynamicsMode: getWaveDynamicsMode(),
      ...getPlayerPresenceMetrics(),
      previousPresentationProfile,
      geometrySelectionReason: previousPresentationProfile === null ? "startup" : "profile-switch",
      ...getFieldGeometryMetrics(this.presentationProfile),
      instanceCount: this.layout.instanceCount,
      triangles: this.getTriangleCount(),
      ...(previousPresentationProfile === null ? {} : { profileSwitchPreservedSession: true })
    }, "info");
  }

  private getDepthTextureView(input: RenderFrameInput): GPUTextureView {
    if (!this.depthTextureView) {
      this.resize(
        input.viewport.width * input.viewport.pixelRatio,
        input.viewport.height * input.viewport.pixelRatio
      );
    }

    if (!this.depthTextureView) {
      throw new Error("WebGPU RippleField preview depth texture was not configured.");
    }

    return this.depthTextureView;
  }
}

function createFieldPreviewBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "Ripple WebGPU field preview bind group layout",
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
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: "unfilterable-float",
          viewDimension: "2d",
          multisampled: false
        }
      },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" }
      },
      {
        binding: 4,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" }
      },
      {
        binding: 5,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: "float",
          viewDimension: "2d",
          multisampled: false
        }
      },
      {
        binding: 6,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" }
      }
    ]
  });
}

function analyzeTrackMaskCoverage(
  rgba: Uint8Array,
  width: number,
  height: number
): { readonly body: number; readonly edge: number; readonly center: number } {
  const pixelCount = Math.max(1, width * height);
  let bodyPixels = 0;
  let edgePixels = 0;
  let centerPixels = 0;

  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    if (rgba[offset] > 16) bodyPixels += 1;
    if (rgba[offset + 1] > 16) edgePixels += 1;
    if (rgba[offset + 2] > 16) centerPixels += 1;
  }

  return {
    body: bodyPixels / pixelCount,
    edge: edgePixels / pixelCount,
    center: centerPixels / pixelCount
  };
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getFieldVertexCount(profile: RenderPresentationProfile): number {
  return profile === "classic" ? CLASSIC_FIELD_VERTEX_COUNT : CORE_FIELD_VERTEX_COUNT;
}

function getFieldTrianglesPerInstance(profile: RenderPresentationProfile): number {
  return profile === "classic"
    ? CLASSIC_FIELD_TRIANGLES_PER_INSTANCE
    : CORE_FIELD_TRIANGLES_PER_INSTANCE;
}

function getFieldGeometryMetrics(profile: RenderPresentationProfile) {
  const classic = profile === "classic";
  return {
    fieldGeometryMode: classic ? "hex-prism" as const : "hex-cap" as const,
    fieldVerticesPerInstance: getFieldVertexCount(profile),
    fieldTrianglesPerInstance: getFieldTrianglesPerInstance(profile),
    visibleSideFaceCount: classic ? CLASSIC_FIELD_VISIBLE_SIDE_FACE_COUNT : 0,
    bottomFaceIncluded: classic,
    tileHeightMode: classic ? "animated-prism" as const : "flat-cap" as const
  };
}

function getPlayerPresenceMetrics() {
  return {
    playerPresenceMode: "pressure-rim" as const,
    playerPresenceAnimated: true as const
  };
}

function getWaveDynamicsMode(): WebGpuRippleFieldPreviewMetrics["waveDynamicsMode"] {
  return "classic-parity";
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
