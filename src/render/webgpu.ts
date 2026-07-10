/// <reference types="@webgpu/types" />

export type WebGpuDiagnosticLevel = "debug" | "info" | "warn" | "error";

export type WebGpuDiagnosticLogger = (
  channel: string,
  message: string,
  payload?: Record<string, string | number | boolean | null>,
  level?: WebGpuDiagnosticLevel
) => void;

export type WebGpuContext = {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly canvasContext: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly adapterSummary: string;
};

export type WebGpuCanvasConfiguration = {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly presentationWidth: number;
  readonly presentationHeight: number;
  readonly maxTextureDimension2D: number;
  readonly format: GPUTextureFormat;
};

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuUnavailableError";
  }
}

type AdapterWithInfo = GPUAdapter & {
  readonly info?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
  };
};

export async function initializeWebGpu(
  canvas: HTMLCanvasElement,
  log: WebGpuDiagnosticLogger
): Promise<WebGpuContext> {
  const gpu = navigator.gpu;
  log("webgpu.support", "Checked navigator.gpu", { available: Boolean(gpu) });

  if (!gpu) {
    throw new WebGpuUnavailableError("This browser does not expose navigator.gpu.");
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new WebGpuUnavailableError("No WebGPU adapter was available.");
  }

  const device = await adapter.requestDevice();
  const canvasContext = canvas.getContext("webgpu");
  if (!canvasContext) {
    device.destroy();
    throw new WebGpuUnavailableError("Could not create a WebGPU canvas context.");
  }

  const format = gpu.getPreferredCanvasFormat();
  const adapterSummary = summarizeAdapter(adapter);

  device.lost.then((info) => {
    log("webgpu.deviceLost", "WebGPU device lost", {
      reason: info.reason,
      message: info.message
    }, "warn");
  });

  device.addEventListener("uncapturederror", (event) => {
    const gpuEvent = event as GPUUncapturedErrorEvent;
    log("webgpu.uncapturedError", "WebGPU uncaptured validation error", {
      message: gpuEvent.error.message
    }, "error");
  });

  log("webgpu.ready", "WebGPU device ready", {
    adapter: adapterSummary,
    preferredFormat: format
  });

  return { adapter, device, canvas, canvasContext, format, adapterSummary };
}

export function configureWebGpuCanvas(
  context: WebGpuContext,
  width: number,
  height: number,
  requestedPixelRatio: number,
  log: WebGpuDiagnosticLogger
): WebGpuCanvasConfiguration {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const maxTextureDimension2D = Math.max(1, context.device.limits.maxTextureDimension2D);
  const pixelRatio = clampCanvasPixelRatio(
    requestedPixelRatio,
    safeWidth,
    safeHeight,
    maxTextureDimension2D
  );
  const presentationWidth = Math.max(1, Math.floor(safeWidth * pixelRatio));
  const presentationHeight = Math.max(1, Math.floor(safeHeight * pixelRatio));

  context.canvas.width = presentationWidth;
  context.canvas.height = presentationHeight;
  context.canvasContext.configure({
    device: context.device,
    format: context.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: "opaque"
  });

  const configuration = {
    width: safeWidth,
    height: safeHeight,
    pixelRatio,
    presentationWidth,
    presentationHeight,
    maxTextureDimension2D,
    format: context.format
  };
  log("webgpu.canvas.configure", "Configured WebGPU canvas context", configuration);
  return configuration;
}

export function clearWebGpuCanvas(
  context: WebGpuContext,
  log: WebGpuDiagnosticLogger | null,
  clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 }
): number {
  const startedAt = performance.now();
  const commandEncoder = context.device.createCommandEncoder({ label: "Ripple WebGPU boot clear" });
  const pass = commandEncoder.beginRenderPass({
    label: "Ripple WebGPU boot clear pass",
    colorAttachments: [{
      view: context.canvasContext.getCurrentTexture().createView(),
      clearValue: clearColor,
      loadOp: "clear",
      storeOp: "store"
    }]
  });
  pass.end();
  context.device.queue.submit([commandEncoder.finish()]);

  const submitMs = performance.now() - startedAt;
  log?.("webgpu.firstFrame", "Submitted WebGPU boot clear pass", {
    submitMs: roundMetric(submitMs)
  });
  return submitMs;
}

function summarizeAdapter(adapter: GPUAdapter): string {
  const info = (adapter as AdapterWithInfo).info;
  const pieces = [
    info?.vendor,
    info?.architecture,
    info?.device,
    info?.description
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join(" / ") : "WebGPU adapter";
}

function clampCanvasPixelRatio(
  requestedPixelRatio: number,
  width: number,
  height: number,
  maxTextureDimension2D: number
): number {
  const finiteRatio = Number.isFinite(requestedPixelRatio) ? requestedPixelRatio : 1;
  const maxRatioByWidth = maxTextureDimension2D / Math.max(1, width);
  const maxRatioByHeight = maxTextureDimension2D / Math.max(1, height);
  return Math.max(1, Math.min(finiteRatio, 2.5, maxRatioByWidth, maxRatioByHeight));
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
