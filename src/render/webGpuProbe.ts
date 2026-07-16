import {
  clearWebGpuCanvas,
  configureWebGpuCanvas,
  initializeWebGpu,
  WebGpuUnavailableError,
  type WebGpuDiagnosticLogger
} from "./webgpu";

export type WebGpuProbeResult = {
  readonly ok: boolean;
  readonly adapterSummary: string;
  readonly format: string;
  readonly pixelRatio: number;
  readonly presentationWidth: number;
  readonly presentationHeight: number;
  readonly firstFrameSubmitMs: number;
  readonly message: string;
};

export async function probeWebGpuAvailability(log: WebGpuDiagnosticLogger): Promise<WebGpuProbeResult> {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  try {
    const context = await initializeWebGpu(canvas, log);
    const configuration = configureWebGpuCanvas(context, 1, 1, 1, log);
    const firstFrameSubmitMs = clearWebGpuCanvas(context, log);
    const result = {
      ok: true,
      adapterSummary: context.adapterSummary,
      format: context.format,
      pixelRatio: configuration.pixelRatio,
      presentationWidth: configuration.presentationWidth,
      presentationHeight: configuration.presentationHeight,
      firstFrameSubmitMs,
      message: "WebGPU boot probe succeeded."
    };
    context.device.destroy();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WebGpuUnavailableError) {
      return {
        ok: false,
        adapterSummary: "",
        format: "",
        pixelRatio: 1,
        presentationWidth: 0,
        presentationHeight: 0,
        firstFrameSubmitMs: 0,
        message
      };
    }

    throw error;
  }
}
