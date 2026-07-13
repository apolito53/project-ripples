/// <reference types="@webgpu/types" />

import * as THREE from "three";
import type { QualityPreset } from "../qualityPresets";
import type { RippleFieldLayout } from "../rippleFieldLayout";
import type { SkyboxId } from "../skybox";
import type {
  RenderFrameInput,
  RenderRuntime,
  RenderRuntimeCapabilities,
  RenderRuntimeStats
} from "./types";
import {
  WebGpuArenaBarrierPass,
  type WebGpuArenaBarrierMetrics
} from "./webGpuArenaBarrierPass";
import {
  WebGpuAvatarPreview,
  type WebGpuAvatarPreviewMetrics
} from "./webGpuAvatarPreview";
import {
  WebGpuBloomPass,
  type WebGpuBloomPassMetrics
} from "./webGpuBloomPass";
import {
  WebGpuEchoVisualPass,
  type WebGpuEchoVisualPassMetrics
} from "./webGpuEchoVisualPass";
import {
  WebGpuPulseGlowPass,
  type WebGpuPulseGlowPassMetrics
} from "./webGpuPulseGlowPass";
import {
  WebGpuSceneLightBuffer,
  type WebGpuSceneLightMetrics
} from "./webGpuSceneLightBuffer";
import {
  WebGpuSceneShadowBuffer,
  type WebGpuSceneShadowMetrics
} from "./webGpuSceneShadowBuffer";
import {
  WebGpuShadowMapPass,
  type WebGpuShadowMapPassMetrics
} from "./webGpuShadowMapPass";
import {
  WebGpuSkyboxPass,
  type WebGpuSkyboxPassMetrics
} from "./webGpuSkyboxPass";
import {
  WebGpuTrackWallPass,
  type WebGpuTrackWallMetrics
} from "./webGpuTrackWallPass";
import {
  WebGpuTrainingMarkerPass,
  type WebGpuTrainingMarkerMetrics
} from "./webGpuTrainingMarkerPass";
import {
  configureWebGpuCanvas,
  initializeWebGpu,
  type WebGpuCanvasConfiguration,
  type WebGpuContext,
  type WebGpuDiagnosticLogger
} from "./webgpu";
import {
  WebGpuRippleFieldPreview,
  type WebGpuRippleFieldPreviewMetrics
} from "../ripple/webGpuRippleFieldPreview";
import {
  WebGpuParticleVeilPreview,
  type WebGpuParticleVeilPreviewMetrics
} from "../particle/webGpuParticleVeilPreview";
import {
  WebGpuWakeFieldProbe,
  type WebGpuWakeFieldProbeMetrics
} from "../wake/webGpuWakeFieldProbe";
import { WebGpuFrameTimer } from "./gpuFrameTimer";
import {
  isRenderBenchmarkEnabled,
  setRenderBenchmarkMetadata
} from "./renderBenchmark";

export type WebGpuRenderRuntimeOptions = {
  readonly app: HTMLElement;
  readonly log: WebGpuDiagnosticLogger;
  readonly fallbackReason: string;
  readonly initialQualityPreset: QualityPreset;
  readonly initialSkyboxId: SkyboxId;
};

export class WebGpuRenderRuntime implements RenderRuntime {
  readonly backendId = "webgpu" as const;
  readonly canvas: HTMLCanvasElement;
  private animationFrameId = 0;
  private animationCallback: Parameters<THREE.WebGLRenderer["setAnimationLoop"]>[0] = null;
  private configuration: WebGpuCanvasConfiguration | null = null;
  private gpuCpuSubmitMs = 0;
  private deviceLost = false;
  private submittedFirstFrame = false;
  private readonly gpuFrameTimer: WebGpuFrameTimer;

  private constructor(
    private readonly options: WebGpuRenderRuntimeOptions,
    private readonly context: WebGpuContext,
    private readonly wakeProbe: WebGpuWakeFieldProbe,
    private readonly sceneLights: WebGpuSceneLightBuffer,
    private readonly sceneShadows: WebGpuSceneShadowBuffer,
    private readonly shadowMap: WebGpuShadowMapPass,
    private readonly skyboxPass: WebGpuSkyboxPass,
    private readonly fieldPreview: WebGpuRippleFieldPreview,
    private readonly arenaBarrier: WebGpuArenaBarrierPass,
    private readonly trackWalls: WebGpuTrackWallPass,
    private readonly trainingMarker: WebGpuTrainingMarkerPass,
    private readonly pulseGlow: WebGpuPulseGlowPass,
    private readonly echoVisual: WebGpuEchoVisualPass,
    private readonly avatarPreview: WebGpuAvatarPreview,
    private readonly particlePreview: WebGpuParticleVeilPreview,
    private readonly bloom: WebGpuBloomPass
  ) {
    this.canvas = context.canvas;
    this.canvas.dataset.rendererBackend = this.backendId;
    options.app.append(this.canvas);
    this.gpuFrameTimer = new WebGpuFrameTimer(
      context.device,
      context.timestampQueryEnabled
    );

    context.device.lost.then(() => {
      this.deviceLost = true;
    });
  }

  static async create(options: WebGpuRenderRuntimeOptions): Promise<WebGpuRenderRuntime> {
    const canvas = document.createElement("canvas");
    const context = await initializeWebGpu(canvas, options.log, {
      enableTimestampQuery: isRenderBenchmarkEnabled()
    });
    setRenderBenchmarkMetadata({
      webGpuAdapter: context.adapterSummary,
      webGpuPreferredFormat: context.format,
      webGpuTimestampQuery: context.timestampQueryEnabled,
      webGpuFeatures: [...context.device.features].sort(),
      webGpuLimits: {
        maxTextureDimension2D: context.device.limits.maxTextureDimension2D,
        maxStorageBufferBindingSize: context.device.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupsPerDimension: context.device.limits.maxComputeWorkgroupsPerDimension
      }
    });
    let wakeProbe: WebGpuWakeFieldProbe | undefined;
    let sceneLights: WebGpuSceneLightBuffer | undefined;
    let sceneShadows: WebGpuSceneShadowBuffer | undefined;
    let shadowMap: WebGpuShadowMapPass | undefined;
    let skyboxPass: WebGpuSkyboxPass | undefined;
    let fieldPreview: WebGpuRippleFieldPreview | undefined;
    let arenaBarrier: WebGpuArenaBarrierPass | undefined;
    let trackWalls: WebGpuTrackWallPass | undefined;
    let trainingMarker: WebGpuTrainingMarkerPass | undefined;
    let pulseGlow: WebGpuPulseGlowPass | undefined;
    let echoVisual: WebGpuEchoVisualPass | undefined;
    let avatarPreview: WebGpuAvatarPreview | undefined;
    let particlePreview: WebGpuParticleVeilPreview | undefined;
    let bloom: WebGpuBloomPass | undefined;

    try {
      wakeProbe = await WebGpuWakeFieldProbe.create({
        device: context.device,
        log: options.log,
        initialPreset: options.initialQualityPreset
      });
      sceneLights = await WebGpuSceneLightBuffer.create(context.device, options.log);
      sceneShadows = await WebGpuSceneShadowBuffer.create(context.device, options.log);
      shadowMap = await WebGpuShadowMapPass.create(
        context.device,
        options.initialQualityPreset,
        options.log,
        context.device.limits.maxTextureDimension2D
      );
      skyboxPass = await WebGpuSkyboxPass.create(
        context.device,
        context.format,
        context.device.limits.maxTextureDimension2D,
        options.initialSkyboxId,
        options.log
      );
      fieldPreview = await WebGpuRippleFieldPreview.create(
        context.device,
        context.format,
        options.initialQualityPreset,
        options.log,
        sceneLights.getBindGroupLayout(),
        sceneShadows.getBindGroupLayout(),
        shadowMap.getSampleBindGroupLayout()
      );
      arenaBarrier = await WebGpuArenaBarrierPass.create(context.device, context.format, options.log);
      trackWalls = await WebGpuTrackWallPass.create(context.device, context.format, options.log);
      trainingMarker = await WebGpuTrainingMarkerPass.create(context.device, context.format, options.log);
      pulseGlow = await WebGpuPulseGlowPass.create(context.device, context.format, options.log);
      echoVisual = await WebGpuEchoVisualPass.create(context.device, context.format, options.log);
      avatarPreview = await WebGpuAvatarPreview.create(context.device, context.format, options.log);
      particlePreview = await WebGpuParticleVeilPreview.create(
        context.device,
        context.format,
        options.initialQualityPreset,
        options.log
      );
      bloom = await WebGpuBloomPass.create(context.device, context.format, options.log);
    } catch (error) {
      bloom?.dispose();
      particlePreview?.dispose();
      avatarPreview?.dispose();
      echoVisual?.dispose();
      pulseGlow?.dispose();
      trainingMarker?.dispose();
      trackWalls?.dispose();
      arenaBarrier?.dispose();
      fieldPreview?.dispose();
      skyboxPass?.dispose();
      shadowMap?.dispose();
      sceneShadows?.dispose();
      sceneLights?.dispose();
      wakeProbe?.dispose();
      context.device.destroy();
      throw error;
    }

    if (
      !wakeProbe ||
      !sceneLights ||
      !sceneShadows ||
      !shadowMap ||
      !skyboxPass ||
      !fieldPreview ||
      !arenaBarrier ||
      !trackWalls ||
      !trainingMarker ||
      !pulseGlow ||
      !echoVisual ||
      !avatarPreview ||
      !particlePreview ||
      !bloom
    ) {
      context.device.destroy();
      throw new Error("WebGPU core scene presentation failed to initialize.");
    }

    const runtime = new WebGpuRenderRuntime(
      options,
      context,
      wakeProbe,
      sceneLights,
      sceneShadows,
      shadowMap,
      skyboxPass,
      fieldPreview,
      arenaBarrier,
      trackWalls,
      trainingMarker,
      pulseGlow,
      echoVisual,
      avatarPreview,
      particlePreview,
      bloom
    );

    options.log("webgpu.runtime.init", "WebGPU diagnostic runtime initialized", {
      adapter: context.adapterSummary,
      preferredFormat: context.format,
      maxTextureSize: context.device.limits.maxTextureDimension2D,
      supportsBloom: true,
      supportsLocalLights: true
    });

    return runtime;
  }

  get capabilities(): RenderRuntimeCapabilities {
    return {
      backendId: this.backendId,
      maxTextureSize: this.context.device.limits.maxTextureDimension2D,
      supportsBloom: true,
      supportsLocalLights: true,
      fallbackReason: this.options.fallbackReason,
      deviceLost: this.deviceLost
    };
  }

  beginFrame(): void {
    // WebGPU diagnostics do not expose draw counters yet. Keep this method so
    // the runtime contract matches ThreeRenderRuntime while later subsystems
    // fill in real pass accounting.
  }

  /** Wait for deterministic capture callers without blocking ordinary frames. */
  async waitForGpuIdle(): Promise<void> {
    await this.context.device.queue.onSubmittedWorkDone();
  }

  renderFrame(input: RenderFrameInput): void {
    if (this.deviceLost) {
      this.gpuCpuSubmitMs = 0;
      return;
    }

    const startedAt = performance.now();
    const commandEncoder = this.context.device.createCommandEncoder({
      label: "Ripple WebGPU core scene presentation frame"
    });
    this.gpuFrameTimer.begin(commandEncoder);
    const swapchainView = this.context.canvasContext.getCurrentTexture().createView();
    const sceneTargetView = this.bloom.getSceneTargetView();
    const lightingUpdateMs = this.sceneLights.update(input, this.deviceLost);
    const shadowUpdateMs = this.sceneShadows.update(input, this.deviceLost);
    const shadowMapPassMs = this.shadowMap.render(commandEncoder, input, this.deviceLost);
    const wakePassMs = this.wakeProbe.encodeStep(input, commandEncoder, this.deviceLost);
    const wakeMetrics = this.wakeProbe.getMetrics(this.deviceLost);
    const skyboxPassMs = this.skyboxPass.render({
      commandEncoder,
      targetView: sceneTargetView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const previewPassMs = this.fieldPreview.render({
      commandEncoder,
      targetView: sceneTargetView,
      wakeTextureView: this.wakeProbe.getSampledTextureView(),
      sceneLightBindGroup: this.sceneLights.getBindGroup(),
      sceneShadowBindGroup: this.sceneShadows.getBindGroup(),
      shadowMapBindGroup: this.shadowMap.getSampleBindGroup(),
      wakeMetrics,
      renderInput: input,
      colorLoadOp: "load",
      deviceLost: this.deviceLost
    });
    const sharedDepthTextureView = this.fieldPreview.getSharedDepthTextureView(input);
    const fieldMetrics = this.fieldPreview.getMetrics();
    const arenaPassMs = this.arenaBarrier.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const trackWallPassMs = this.trackWalls.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const trainingMarkerPassMs = this.trainingMarker.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const pulseGlowPassMs = this.pulseGlow.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const echoVisualPassMs = this.echoVisual.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const particlePassMs = this.particlePreview.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const avatarPassMs = this.avatarPreview.render({
      commandEncoder,
      targetView: sceneTargetView,
      depthTextureView: sharedDepthTextureView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const particleMetrics = this.particlePreview.getMetrics();
    const bloomPassMs = this.bloom.render({
      commandEncoder,
      targetView: swapchainView,
      renderInput: input,
      deviceLost: this.deviceLost
    });
    const drawStats = this.getCombinedDrawStats();

    this.gpuFrameTimer.end(commandEncoder);
    this.context.device.queue.submit([commandEncoder.finish()]);
    this.gpuFrameTimer.afterSubmit();
    this.wakeProbe.afterSubmit();
    this.gpuCpuSubmitMs = performance.now() - startedAt;

    if (!this.submittedFirstFrame) {
      const skyboxMetrics = this.skyboxPass.getMetrics();
      const arenaMetrics = this.arenaBarrier.getMetrics();
      const trackWallMetrics = this.trackWalls.getMetrics();
      const trainingMarkerMetrics = this.trainingMarker.getMetrics();
      const pulseGlowMetrics = this.pulseGlow.getMetrics();
      const avatarMetrics = this.avatarPreview.getMetrics();
      const bloomMetrics = this.bloom.getMetrics();
      const lightingMetrics = this.sceneLights.getMetrics();
      const shadowMetrics = this.getShadowMetrics();
      const echoVisualMetrics = this.echoVisual.getMetrics();
      this.options.log("webgpu.firstFrame", "Submitted WebGPU core scene presentation frame", {
        integrationSurface: "core-render-snapshot",
        scenePresentationMode: input.scenePresentation.mode,
        presentationProfile: input.scenePresentation.profile,
        playMode: input.playMode,
        raceTrackEnabled: input.raceTrack.enabled,
        raceTrackStrength: roundMetric(input.raceTrack.strength),
        trackFieldRadius: roundMetric(input.raceTrack.fieldRadius),
        trackWidthMeters: roundMetric(input.raceTrack.trackWidthMeters),
        raceTrackMaskWidth: input.raceTrack.mask.width,
        raceTrackMaskHeight: input.raceTrack.mask.height,
        raceTrackMaskVersion: input.raceTrack.mask.version,
        trackMaskUploaded: fieldMetrics.trackMaskUploaded,
        trackMaskBodyCoverage: roundMetric(fieldMetrics.trackMaskBodyCoverage),
        trackMaskEdgeCoverage: roundMetric(fieldMetrics.trackMaskEdgeCoverage),
        trackMaskCenterCoverage: roundMetric(fieldMetrics.trackMaskCenterCoverage),
        arenaBarrierEnabled: arenaMetrics.arenaBarrierEnabled,
        trackWallEnabled: trackWallMetrics.enabled,
        trackWallVersion: trackWallMetrics.version,
        trackWallSegments: trackWallMetrics.segmentCount,
        trackWallDrawCalls: trackWallMetrics.drawCalls,
        trackWallTriangles: trackWallMetrics.triangles,
        trainingEnabled: input.training.enabled,
        trainingActive: input.training.active,
        trainingComplete: input.training.complete,
        trainingStepId: input.training.stepId,
        trainingStepIndex: input.training.stepIndex,
        trainingStepCount: input.training.stepCount,
        trainingMarkerVisible: input.training.marker.visible,
        trainingMarkerDrawCalls: trainingMarkerMetrics.drawCalls,
        trainingMarkerTriangles: trainingMarkerMetrics.triangles,
        fieldLayoutMode: fieldMetrics.fieldLayoutMode,
        culledHexCount: fieldMetrics.culledHexCount,
        submitMs: roundMetric(this.gpuCpuSubmitMs),
        lightingUpdateMs: roundMetric(lightingUpdateMs),
        supportsLocalLights: true,
        activeLocalLights: lightingMetrics.activeLocalLights,
        renderedLocalLights: lightingMetrics.renderedLocalLights,
        localLightLimit: lightingMetrics.localLightLimit,
        shadowMode: shadowMetrics.shadowMode,
        shadowUpdateMs: roundMetric(shadowUpdateMs),
        activeShadowCasters: shadowMetrics.activeShadowCasters,
        renderedShadowCasters: shadowMetrics.renderedShadowCasters,
        shadowCasterLimit: shadowMetrics.shadowCasterLimit,
        shadowStrength: roundMetric(shadowMetrics.shadowStrength),
        shadowSoftness: roundMetric(shadowMetrics.shadowSoftness),
        shadowMapSize: shadowMetrics.shadowMapSize ?? 0,
        shadowMapFormat: shadowMetrics.shadowMapFormat ?? "",
        shadowMapPassMs: roundMetric(shadowMapPassMs),
        shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps ?? 0,
        shadowMapLightBounds: roundMetric(shadowMetrics.shadowMapLightBounds ?? 0),
        shadowGeometryMode: shadowMetrics.shadowGeometryMode ?? "",
        fieldReceiver: shadowMetrics.fieldReceiver === true,
        renderedOrbCasters: shadowMetrics.renderedOrbCasters ?? 0,
        renderedColumnCasters: shadowMetrics.renderedColumnCasters ?? 0,
        renderedDiscCasters: shadowMetrics.renderedDiscCasters ?? 0,
        shadowMapProxyTriangles: shadowMetrics.proxyTriangles ?? 0,
        wakePassMs: roundMetric(wakePassMs),
        wakeMaxAbsHeight: roundMetric(wakeMetrics.wakeMaxAbsHeight),
        wakeMeanAbsHeight: roundMetric(wakeMetrics.wakeMeanAbsHeight),
        wakeMaxCrest: roundMetric(wakeMetrics.wakeMaxCrest),
        wakeEnergyEstimate: roundMetric(wakeMetrics.wakeEnergyEstimate),
        skyboxPassMs: roundMetric(skyboxPassMs),
        previewPassMs: roundMetric(previewPassMs),
        arenaPassMs: roundMetric(arenaPassMs),
        trackWallPassMs: roundMetric(trackWallPassMs),
        trainingMarkerPassMs: roundMetric(trainingMarkerPassMs),
        pulseGlowPassMs: roundMetric(pulseGlowPassMs),
        echoVisualPassMs: roundMetric(echoVisualPassMs),
        avatarPassMs: roundMetric(avatarPassMs),
        particlePassMs: roundMetric(particlePassMs),
        bloomPassMs: roundMetric(bloomPassMs),
        wakeTextureSize: wakeMetrics.textureSize,
        wakeTextureFormat: wakeMetrics.format,
        skybox: skyboxMetrics.skyboxId,
        skyboxTextureTier: skyboxMetrics.textureTier,
        arenaRadius: roundMetric(arenaMetrics.arenaRadius),
        avatarMode: avatarMetrics.avatarMode,
        avatarPresentationMode: input.avatarPresentation.mode,
        avatarAssetId: input.avatarPresentation.assetId,
        moteAvatarAssetId: input.avatarPresentation.moteAssetId,
        avatarCoreRadius: roundMetric(input.avatarPresentation.coreRadius),
        avatarGlowRadius: roundMetric(input.avatarPresentation.glowRadius),
        avatarGlowStrength: roundMetric(input.avatarPresentation.glowStrength),
        pulseGlowCount: pulseGlowMetrics.renderedGlows,
        echoVisualActiveEchoes: echoVisualMetrics.activeEchoes,
        echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
        echoVisualActiveCollectionEvents: echoVisualMetrics.activeCollectionEvents,
        echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
        echoVisualBillboardInstances: echoVisualMetrics.billboardInstances,
        echoVisualOrbInstances: echoVisualMetrics.orbInstances,
        echoVisualCollectionVisualInstances: echoVisualMetrics.collectionVisualInstances,
        supportsBloom: true,
        bloomMode: bloomMetrics.bloomMode,
        bloomEnabled: bloomMetrics.bloomEnabled,
        bloomStrength: roundMetric(bloomMetrics.bloomStrength),
        bloomPasses: bloomMetrics.bloomPasses,
        projectionMode: fieldMetrics.projectionMode,
        cameraMode: fieldMetrics.cameraMode,
        depthFormat: fieldMetrics.depthFormat,
        fieldInstances: fieldMetrics.instanceCount,
        activeEchoes: fieldMetrics.activeEchoes,
        renderedEchoes: fieldMetrics.renderedEchoes,
        activeEchoBursts: fieldMetrics.activeEchoBursts,
        renderedEchoBursts: fieldMetrics.renderedEchoBursts,
        activeParticles: particleMetrics.activeParticles,
        renderedParticles: particleMetrics.renderedParticles,
        particleBudget: particleMetrics.particleBudget,
        drawCalls: drawStats.drawCalls,
        triangles: drawStats.triangles,
        deviceLost: this.deviceLost
      });
    }

    this.submittedFirstFrame = true;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.configuration = configureWebGpuCanvas(this.context, width, height, pixelRatio, this.options.log);
    this.bloom.resize(this.configuration.presentationWidth, this.configuration.presentationHeight);
    this.fieldPreview.resize(this.configuration.presentationWidth, this.configuration.presentationHeight);
  }

  applyQualityPreset(preset: QualityPreset, bloomStrength: number, reason: "quality" | "field-scale" = "quality"): void {
    void bloomStrength;
    this.wakeProbe.resizeForPreset(preset, reason);
    this.fieldPreview.applyQualityPreset(preset, reason);
    this.particlePreview.applyQualityPreset(preset);
    this.shadowMap.resizeForPreset(preset, reason);
  }

  applyFieldLayout(layout: RippleFieldLayout, reason = "layout"): void {
    this.fieldPreview.applyLayout(layout, reason);
  }

  resetSession(reason = "session"): void {
    this.wakeProbe.reset(reason);
  }

  prewarm(): void {
    // Pipeline creation happens during runtime construction so forced WebGPU
    // fails loudly before the animation loop starts if the wake proof is invalid.
  }

  setAnimationLoop(callback: Parameters<THREE.WebGLRenderer["setAnimationLoop"]>[0]): void {
    if (this.animationFrameId !== 0) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }

    this.animationCallback = callback;
    if (!callback) return;

    const tick = (frameTimestampMs: number) => {
      if (!this.animationCallback) return;
      this.animationFrameId = requestAnimationFrame(tick);
      this.animationCallback(frameTimestampMs, undefined as never);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  getStats(): RenderRuntimeStats {
    const drawStats = this.getCombinedDrawStats();
    const wakeMetrics = this.wakeProbe.getMetrics(this.deviceLost);
    const lightingMetrics = this.sceneLights.getMetrics();
    const shadowMetrics = this.getShadowMetrics();
    const bloomMetrics = this.bloom.getMetrics();
    const fieldMetrics = this.fieldPreview.getMetrics();
    const echoVisualMetrics = this.echoVisual.getMetrics();
    const trackWallMetrics = this.trackWalls.getMetrics();
    const trainingMarkerMetrics = this.trainingMarker.getMetrics();
    const gpuResult = this.gpuFrameTimer.getLatestResult();
    return {
      backendId: this.backendId,
      drawCalls: this.deviceLost ? 0 : drawStats.drawCalls,
      triangles: this.deviceLost ? 0 : drawStats.triangles,
      pixelRatio: this.configuration?.pixelRatio ?? 1,
      gpuCpuSubmitMs: this.gpuCpuSubmitMs,
      gpuFrameMs: gpuResult?.durationMs,
      gpuFrameSequence: gpuResult?.sequence,
      gpuTimerMode: this.gpuFrameTimer.mode,
      gpuTimerErrorCount: this.gpuFrameTimer.getErrorCount(),
      fallbackReason: this.capabilities.fallbackReason,
      deviceLost: this.deviceLost,
      wakeMaxAbsHeight: wakeMetrics.wakeMaxAbsHeight,
      wakeMeanAbsHeight: wakeMetrics.wakeMeanAbsHeight,
      wakeMaxCrest: wakeMetrics.wakeMaxCrest,
      wakeEnergyEstimate: wakeMetrics.wakeEnergyEstimate,
      activeLocalLights: lightingMetrics.activeLocalLights,
      renderedLocalLights: lightingMetrics.renderedLocalLights,
      shadowMode: shadowMetrics.shadowMode,
      activeShadowCasters: shadowMetrics.activeShadowCasters,
      renderedShadowCasters: shadowMetrics.renderedShadowCasters,
      shadowCasterLimit: shadowMetrics.shadowCasterLimit,
      shadowStrength: shadowMetrics.shadowStrength,
      shadowSoftness: shadowMetrics.shadowSoftness,
      shadowUpdateMs: shadowMetrics.updateMs,
      shadowMapSize: shadowMetrics.shadowMapSize,
      shadowMapFormat: shadowMetrics.shadowMapFormat,
      shadowMapPassMs: shadowMetrics.shadowMapPassMs,
      shadowMapPcfTaps: shadowMetrics.shadowMapPcfTaps,
      shadowMapLightBounds: shadowMetrics.shadowMapLightBounds,
      shadowGeometryMode: shadowMetrics.shadowGeometryMode,
      shadowFieldReceiver: shadowMetrics.fieldReceiver,
      shadowMapRenderedOrbCasters: shadowMetrics.renderedOrbCasters,
      shadowMapRenderedColumnCasters: shadowMetrics.renderedColumnCasters,
      shadowMapRenderedDiscCasters: shadowMetrics.renderedDiscCasters,
      shadowMapProxyTriangles: shadowMetrics.proxyTriangles,
      raceTrackEnabled: fieldMetrics.raceTrackEnabled,
      raceTrackStrength: fieldMetrics.raceTrackStrength,
      trackFieldRadius: fieldMetrics.trackFieldRadius,
      trackWidthMeters: fieldMetrics.trackWidthMeters,
      raceTrackMaskWidth: fieldMetrics.raceTrackMaskWidth,
      raceTrackMaskHeight: fieldMetrics.raceTrackMaskHeight,
      raceTrackMaskVersion: fieldMetrics.raceTrackMaskVersion,
      trackMaskUploaded: fieldMetrics.trackMaskUploaded,
      trackMaskBodyCoverage: fieldMetrics.trackMaskBodyCoverage,
      trackMaskEdgeCoverage: fieldMetrics.trackMaskEdgeCoverage,
      trackMaskCenterCoverage: fieldMetrics.trackMaskCenterCoverage,
      arenaBarrierEnabled: this.arenaBarrier.getMetrics().arenaBarrierEnabled,
      trackWallEnabled: trackWallMetrics.enabled,
      trackWallVersion: trackWallMetrics.version,
      trackWallSegments: trackWallMetrics.segmentCount,
      trackWallDrawCalls: trackWallMetrics.drawCalls,
      trackWallTriangles: trackWallMetrics.triangles,
      trackWallPassMs: trackWallMetrics.passMs,
      trainingEnabled: trainingMarkerMetrics.trainingEnabled,
      trainingActive: trainingMarkerMetrics.trainingActive,
      trainingComplete: trainingMarkerMetrics.trainingComplete,
      trainingStepId: trainingMarkerMetrics.stepId,
      trainingStepIndex: trainingMarkerMetrics.stepIndex,
      trainingStepCount: trainingMarkerMetrics.stepCount,
      trainingMarkerVisible: trainingMarkerMetrics.markerVisible,
      trainingMarkerDrawCalls: trainingMarkerMetrics.drawCalls,
      trainingMarkerTriangles: trainingMarkerMetrics.triangles,
      trainingMarkerPassMs: trainingMarkerMetrics.passMs,
      fieldLayoutMode: fieldMetrics.fieldLayoutMode,
      culledHexCount: fieldMetrics.culledHexCount,
      echoVisualActiveEchoes: echoVisualMetrics.activeEchoes,
      echoVisualRenderedEchoes: echoVisualMetrics.renderedEchoes,
      echoVisualActiveCollectionEvents: echoVisualMetrics.activeCollectionEvents,
      echoVisualRenderedCollectionEvents: echoVisualMetrics.renderedCollectionEvents,
      echoVisualPassMs: echoVisualMetrics.passMs,
      bloomMode: bloomMetrics.bloomMode,
      bloomPasses: bloomMetrics.bloomPasses,
      bloomStrength: bloomMetrics.bloomStrength,
      bloomPassMs: bloomMetrics.passMs
    };
  }

  getWakeMetrics(): WebGpuWakeFieldProbeMetrics {
    return this.wakeProbe.getMetrics(this.deviceLost);
  }

  getFieldMetrics(): WebGpuRippleFieldPreviewMetrics {
    return this.fieldPreview.getMetrics();
  }

  getParticleMetrics(): WebGpuParticleVeilPreviewMetrics {
    return this.particlePreview.getMetrics();
  }

  getSkyboxMetrics(): WebGpuSkyboxPassMetrics {
    return this.skyboxPass.getMetrics();
  }

  getArenaMetrics(): WebGpuArenaBarrierMetrics {
    return this.arenaBarrier.getMetrics();
  }

  getTrackWallMetrics(): WebGpuTrackWallMetrics {
    return this.trackWalls.getMetrics();
  }

  getTrainingMarkerMetrics(): WebGpuTrainingMarkerMetrics {
    return this.trainingMarker.getMetrics();
  }

  getPulseGlowMetrics(): WebGpuPulseGlowPassMetrics {
    return this.pulseGlow.getMetrics();
  }

  getEchoVisualMetrics(): WebGpuEchoVisualPassMetrics {
    return this.echoVisual.getMetrics();
  }

  getAvatarMetrics(): WebGpuAvatarPreviewMetrics {
    return this.avatarPreview.getMetrics();
  }

  getLightingMetrics(): WebGpuSceneLightMetrics {
    return this.sceneLights.getMetrics();
  }

  getShadowMetrics(): WebGpuSceneShadowMetrics {
    return mergeShadowMetrics(this.sceneShadows.getMetrics(), this.shadowMap.getMetrics());
  }

  getShadowMapMetrics(): WebGpuShadowMapPassMetrics {
    return this.shadowMap.getMetrics();
  }

  getBloomMetrics(): WebGpuBloomPassMetrics {
    return this.bloom.getMetrics();
  }

  private getCombinedDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return combineDrawStats(
      this.skyboxPass.getDrawStats(),
      this.fieldPreview.getDrawStats(),
      this.arenaBarrier.getDrawStats(),
      this.trackWalls.getDrawStats(),
      this.trainingMarker.getDrawStats(),
      this.pulseGlow.getDrawStats(),
      this.echoVisual.getDrawStats(),
      this.avatarPreview.getDrawStats(),
      this.particlePreview.getDrawStats(),
      this.bloom.getDrawStats()
    );
  }

  destroy(): void {
    this.setAnimationLoop(null);
    this.gpuFrameTimer.dispose();
    this.bloom.dispose();
    this.particlePreview.dispose();
    this.avatarPreview.dispose();
    this.echoVisual.dispose();
    this.pulseGlow.dispose();
    this.trainingMarker.dispose();
    this.trackWalls.dispose();
    this.arenaBarrier.dispose();
    this.fieldPreview.dispose();
    this.skyboxPass.dispose();
    this.shadowMap.dispose();
    this.sceneShadows.dispose();
    this.sceneLights.dispose();
    this.wakeProbe.dispose();
    this.context.device.destroy();
    this.canvas.remove();
  }
}

function combineDrawStats(
  ...stats: readonly { readonly drawCalls: number; readonly triangles: number }[]
): { readonly drawCalls: number; readonly triangles: number } {
  return stats.reduce(
    (total, item) => ({
      drawCalls: total.drawCalls + item.drawCalls,
      triangles: total.triangles + item.triangles
    }),
    { drawCalls: 0, triangles: 0 }
  );
}

function mergeShadowMetrics(
  contactMetrics: WebGpuSceneShadowMetrics,
  shadowMapMetrics: WebGpuShadowMapPassMetrics
): WebGpuSceneShadowMetrics {
  return {
    ...contactMetrics,
    shadowMode: "shadow-map-contact",
    shadowMapSize: shadowMapMetrics.mapSize,
    shadowMapFormat: shadowMapMetrics.format,
    shadowMapPassMs: shadowMapMetrics.passMs,
    shadowMapPcfTaps: shadowMapMetrics.pcfTaps,
    shadowMapLightBounds: shadowMapMetrics.lightBounds,
    shadowGeometryMode: shadowMapMetrics.shadowGeometryMode,
    fieldReceiver: shadowMapMetrics.fieldReceiver,
    renderedOrbCasters: shadowMapMetrics.renderedOrbCasters,
    renderedColumnCasters: shadowMapMetrics.renderedColumnCasters,
    renderedDiscCasters: shadowMapMetrics.renderedDiscCasters,
    proxyTriangles: shadowMapMetrics.proxyTriangles
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
