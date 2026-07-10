/// <reference types="@webgpu/types" />

import {
  DEFAULT_SKYBOX_ID,
  getSkyboxOption,
  type SkyboxId,
  type SkyboxOption
} from "../skybox";
import type { RenderFrameInput } from "./types";
import type { WebGpuDiagnosticLogger } from "./webgpu";
import skyboxSource from "./webGpuSkyboxPass.wgsl?raw";

const SKYBOX_UNIFORM_FLOATS = 16;
const SKYBOX_FRAME_LOG_INTERVAL_SECONDS = 0.75;

export type WebGpuSkyboxPassMetrics = {
  readonly mode: "webgpu-skybox";
  readonly skyboxId: SkyboxId;
  readonly textureTier: "8k" | "4k" | "solid";
  readonly textureReady: boolean;
  readonly passMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
};

export type WebGpuSkyboxFrameInput = {
  readonly commandEncoder: GPUCommandEncoder;
  readonly targetView: GPUTextureView;
  readonly renderInput: RenderFrameInput;
  readonly deviceLost: boolean;
};

type LoadedSkyboxTexture = {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  readonly tier: "8k" | "4k" | "solid";
  readonly url: string;
};

export class WebGpuSkyboxPass {
  private readonly sampler: GPUSampler;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniforms = new Float32Array(SKYBOX_UNIFORM_FLOATS);
  private activeOption = getSkyboxOption(DEFAULT_SKYBOX_ID);
  private loadedTexture: LoadedSkyboxTexture;
  private pendingSkyboxId: SkyboxId | null = null;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  private constructor(
    private readonly device: GPUDevice,
    private readonly maxTextureSize: number,
    private readonly log: WebGpuDiagnosticLogger,
    format: GPUTextureFormat,
    bindGroupLayout: GPUBindGroupLayout,
    pipeline: GPURenderPipeline,
    placeholderTexture: LoadedSkyboxTexture
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.loadedTexture = placeholderTexture;
    this.sampler = device.createSampler({
      label: "Ripple WebGPU skybox sampler",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8
    });
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU skybox uniforms",
      size: SKYBOX_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.log("skybox.webgpu.init", "WebGPU skybox pass initialized", {
      mode: "webgpu-skybox",
      format,
      maxTextureSize,
      drawCalls: 1,
      triangles: 1
    });
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    maxTextureSize: number,
    initialSkyboxId: SkyboxId,
    log: WebGpuDiagnosticLogger
  ): Promise<WebGpuSkyboxPass> {
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Ripple WebGPU skybox bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
        ]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU skybox shader",
        code: skyboxSource
      });
      const pipeline = await device.createRenderPipelineAsync({
        label: "Ripple WebGPU skybox pipeline",
        layout: device.createPipelineLayout({
          label: "Ripple WebGPU skybox pipeline layout",
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

      const pass = new WebGpuSkyboxPass(
        device,
        maxTextureSize,
        log,
        format,
        bindGroupLayout,
        pipeline,
        createSolidSkyboxTexture(device, getSkyboxOption(initialSkyboxId))
      );
      await pass.loadSkybox(getSkyboxOption(initialSkyboxId));
      return pass;
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("skybox.webgpu.error", "WebGPU skybox pass failed to initialize", { message, format }, "error");
      throw new Error(`WebGPU skybox pass failed: ${message}`);
    }
  }

  render(input: WebGpuSkyboxFrameInput): number {
    if (input.deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    this.ensureSkybox(input.renderInput.scenePresentation.skyboxId, input.renderInput.scenePresentation.skybox);
    this.writeUniforms(input.renderInput);
    const bindGroup = this.device.createBindGroup({
      label: "Ripple WebGPU skybox bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.loadedTexture.view },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    });
    const clearColor = input.renderInput.scenePresentation.skybox.clearColor;
    const pass = input.commandEncoder.beginRenderPass({
      label: "Ripple WebGPU skybox render pass",
      colorAttachments: [{
        view: input.targetView,
        clearValue: hexToGpuColor(clearColor),
        loadOp: "clear",
        storeOp: "store"
      }]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input.renderInput, input.deviceLost);
    return this.passMs;
  }

  getMetrics(): WebGpuSkyboxPassMetrics {
    return {
      mode: "webgpu-skybox",
      skyboxId: this.activeOption.id,
      textureTier: this.loadedTexture.tier,
      textureReady: this.loadedTexture.tier !== "solid",
      passMs: this.passMs,
      drawCalls: 1,
      triangles: 1
    };
  }

  getDrawStats(): { readonly drawCalls: number; readonly triangles: number } {
    return { drawCalls: 1, triangles: 1 };
  }

  dispose(): void {
    this.loadedTexture.texture.destroy();
    this.uniformBuffer.destroy();
  }

  private ensureSkybox(id: SkyboxId, option: SkyboxOption): void {
    if (id === this.activeOption.id || id === this.pendingSkyboxId) return;
    this.pendingSkyboxId = id;
    void this.loadSkybox(option).finally(() => {
      if (this.pendingSkyboxId === id) this.pendingSkyboxId = null;
    });
  }

  private async loadSkybox(option: SkyboxOption): Promise<void> {
    const choice = this.chooseTexture(option);
    try {
      const texture = await loadBitmapTexture(this.device, choice.url, choice.tier);
      this.replaceTexture(texture);
      this.activeOption = option;
      this.log("skybox.webgpu.load", "Loaded WebGPU skybox texture", {
        mode: "webgpu-skybox",
        skybox: option.id,
        label: option.label,
        textureUrl: choice.url,
        textureTier: choice.tier,
        textureReason: choice.reason,
        width: texture.width,
        height: texture.height,
        verticalRepeat: option.verticalRepeat,
        verticalOffset: option.verticalOffset
      }, "info");
    } catch (error) {
      if (choice.url !== option.fallbackTextureUrl) {
        this.log("skybox.webgpu.fallback", "High-res WebGPU skybox failed; loading fallback texture", {
          mode: "webgpu-skybox",
          skybox: option.id,
          textureUrl: choice.url,
          fallbackTextureUrl: option.fallbackTextureUrl,
          error: String(error)
        }, "warn");
        try {
          const fallbackTexture = await loadBitmapTexture(this.device, option.fallbackTextureUrl, "4k");
          this.replaceTexture(fallbackTexture);
          this.activeOption = option;
          this.log("skybox.webgpu.load", "Loaded fallback WebGPU skybox texture", {
            mode: "webgpu-skybox",
            skybox: option.id,
            label: option.label,
            textureUrl: option.fallbackTextureUrl,
            textureTier: "4k",
            textureReason: "high-res load failed",
            width: fallbackTexture.width,
            height: fallbackTexture.height,
            verticalRepeat: option.verticalRepeat,
            verticalOffset: option.verticalOffset
          }, "info");
          return;
        } catch (fallbackError) {
          this.log("skybox.webgpu.error", "Fallback WebGPU skybox texture failed to load", {
            mode: "webgpu-skybox",
            skybox: option.id,
            error: String(fallbackError)
          }, "warn");
        }
      } else {
        this.log("skybox.webgpu.error", "WebGPU skybox texture failed to load", {
          mode: "webgpu-skybox",
          skybox: option.id,
          textureUrl: choice.url,
          error: String(error)
        }, "warn");
      }

      this.replaceTexture(createSolidSkyboxTexture(this.device, option));
      this.activeOption = option;
    }
  }

  private chooseTexture(option: SkyboxOption): { readonly url: string; readonly tier: "8k" | "4k"; readonly reason: string } {
    if (this.maxTextureSize < option.textureWidthPixels) {
      this.log("skybox.webgpu.fallback", "WebGPU texture limit selected fallback skybox", {
        mode: "webgpu-skybox",
        skybox: option.id,
        maxTextureSize: this.maxTextureSize,
        requestedTextureWidth: option.textureWidthPixels,
        fallbackTextureUrl: option.fallbackTextureUrl
      }, "warn");
      return {
        url: option.fallbackTextureUrl,
        tier: "4k",
        reason: `maxTextureSize ${this.maxTextureSize} < ${option.textureWidthPixels}`
      };
    }

    return { url: option.textureUrl, tier: "8k", reason: "high-res supported" };
  }

  private replaceTexture(nextTexture: LoadedSkyboxTexture): void {
    this.loadedTexture.texture.destroy();
    this.loadedTexture = nextTexture;
  }

  private writeUniforms(input: RenderFrameInput): void {
    const skybox = input.scenePresentation.skybox;
    const clear = hexToRgb(skybox.clearColor);
    this.uniforms[0] = input.camera.quaternion.x;
    this.uniforms[1] = input.camera.quaternion.y;
    this.uniforms[2] = input.camera.quaternion.z;
    this.uniforms[3] = input.camera.quaternion.w;
    this.uniforms[4] = input.time;
    this.uniforms[5] = input.camera.projection.aspect;
    this.uniforms[6] = input.camera.projection.fovDegrees * Math.PI / 180;
    this.uniforms[7] = this.loadedTexture.tier === "solid" ? 0 : 1;
    this.uniforms[8] = clear.r;
    this.uniforms[9] = clear.g;
    this.uniforms[10] = clear.b;
    this.uniforms[11] = 1;
    this.uniforms[12] = skybox.verticalRepeat;
    this.uniforms[13] = skybox.verticalOffset;
    this.uniforms[14] = 0;
    this.uniforms[15] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < SKYBOX_FRAME_LOG_INTERVAL_SECONDS) return;
    this.lastFrameLogAt = input.time;
    this.log("skybox.webgpu.frame", "WebGPU skybox frame sample", {
      mode: "webgpu-skybox",
      scenePresentationMode: input.scenePresentation.mode,
      skybox: this.activeOption.id,
      textureTier: this.loadedTexture.tier,
      textureReady: this.loadedTexture.tier !== "solid",
      passMs: roundMetric(this.passMs),
      drawCalls: 1,
      triangles: 1,
      deviceLost
    }, "debug");
  }
}

async function loadBitmapTexture(
  device: GPUDevice,
  url: string,
  tier: "8k" | "4k"
): Promise<LoadedSkyboxTexture> {
  const absoluteUrl = new URL(url, window.location.href).toString();
  const response = await fetch(absoluteUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const texture = device.createTexture({
    label: `Ripple WebGPU skybox ${tier} texture`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    { width, height }
  );
  bitmap.close();

  return {
    texture,
    view: texture.createView({ label: `Ripple WebGPU skybox ${tier} texture view` }),
    width,
    height,
    tier,
    url
  };
}

function createSolidSkyboxTexture(device: GPUDevice, option: SkyboxOption): LoadedSkyboxTexture {
  const color = hexToRgb(option.clearColor);
  const data = new Uint8Array([
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    255
  ]);
  const texture = device.createTexture({
    label: "Ripple WebGPU solid skybox fallback texture",
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: 4 }, { width: 1, height: 1 });
  return {
    texture,
    view: texture.createView({ label: "Ripple WebGPU solid skybox fallback view" }),
    width: 1,
    height: 1,
    tier: "solid",
    url: "solid"
  };
}

function hexToRgb(hex: number): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255
  };
}

function hexToGpuColor(hex: number): GPUColor {
  const color = hexToRgb(hex);
  return { r: color.r, g: color.g, b: color.b, a: 1 };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
