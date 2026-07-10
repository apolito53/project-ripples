/// <reference types="@webgpu/types" />

import type { QualityPreset } from "../qualityPresets";
import type { RenderFrameInput } from "../render/types";
import type { WebGpuDiagnosticLogger } from "../render/webgpu";
import { getBasePropagationSpeedMetersPerSecond } from "../waveMedium";
import wakeComputeSource from "./webGpuWakeFieldProbe.wgsl?raw";

const WAKE_TEXTURE_FORMAT: GPUTextureFormat = "rgba16float";
const WAKE_WORKGROUP_SIZE = 8;
const WAKE_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const WAKE_MIN_INJECTION_SPEED = 1.2;
const WAKE_BRUSH_RADIUS_METERS = 1.4;
const WAKE_SHOULDER_OFFSET_METERS = 0.9;
const WAKE_HEIGHT_STRENGTH = 0.08;
const WAKE_MAX_SIM_DELTA_SECONDS = 1 / 30;
const WAKE_EDGE_ABSORB_START_RATIO = 0.72;
const WAKE_EDGE_ABSORB_END_RATIO = 0.98;
const WAKE_EDGE_FADE_START_RATIO = 0.965;
const WAKE_MICRO_DAMPING_START = 0.012;
const WAKE_MICRO_DAMPING_END = 0.08;
const WAKE_UNIFORM_FLOATS = 24;
const WAKE_METRIC_GRID_SIZE = 16;
const WAKE_METRIC_SAMPLE_COUNT = WAKE_METRIC_GRID_SIZE * WAKE_METRIC_GRID_SIZE;
const WAKE_METRIC_FLOATS_PER_SAMPLE = 4;
const WAKE_METRIC_BYTE_LENGTH = WAKE_METRIC_SAMPLE_COUNT * WAKE_METRIC_FLOATS_PER_SAMPLE * Float32Array.BYTES_PER_ELEMENT;
const WAKE_METRIC_SAMPLE_INTERVAL_SECONDS = 0.75;

export type WebGpuWakeFieldProbeMetrics = {
  readonly mode: "webgpu-compute";
  readonly textureSize: number;
  readonly format: GPUTextureFormat;
  readonly passMs: number;
  readonly dispatchX: number;
  readonly dispatchY: number;
  readonly workgroupSize: number;
  readonly qualityId: string;
  readonly playerSpeed: number;
  readonly playerGroundContact: number;
  readonly frameCount: number;
  readonly wakeMaxAbsHeight: number;
  readonly wakeMeanAbsHeight: number;
  readonly wakeMaxCrest: number;
  readonly wakeEnergyEstimate: number;
  readonly deviceLost: boolean;
};

type WebGpuWakeFieldProbeOptions = {
  readonly device: GPUDevice;
  readonly log: WebGpuDiagnosticLogger;
  readonly initialPreset: QualityPreset;
};

type WakeTexturePair = {
  readonly textures: [GPUTexture, GPUTexture];
  readonly views: [GPUTextureView, GPUTextureView];
  readonly bindGroups: [GPUBindGroup, GPUBindGroup];
  readonly metricBindGroups: [GPUBindGroup, GPUBindGroup];
};

type WakeMetricReadbackState = "idle" | "copy-submitted" | "mapping";

type WakeStepInput = {
  readonly previousX: number;
  readonly previousZ: number;
  readonly currentX: number;
  readonly currentZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly playerSpeed: number;
  readonly playerGroundContact: number;
};

export class WebGpuWakeFieldProbe {
  private readonly uniforms = new Float32Array(WAKE_UNIFORM_FLOATS);
  private readonly uniformBuffer: GPUBuffer;
  private readonly metricSamplesBuffer: GPUBuffer;
  private readonly metricReadbackBuffer: GPUBuffer;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly metricBindGroupLayout: GPUBindGroupLayout;
  private readonly resetPipeline: GPUComputePipeline;
  private readonly simulatePipeline: GPUComputePipeline;
  private readonly metricsPipeline: GPUComputePipeline;
  private resources: WakeTexturePair;
  private textureSize = 1;
  private activeReadIndex: 0 | 1 = 0;
  private passMs = 0;
  private frameCount = 0;
  private lastFrameLogAt = -Infinity;
  private qualityId = "";
  private playerSpeed = 0;
  private playerGroundContact = 1;
  private disposed = false;
  private metricReadbackState: WakeMetricReadbackState = "idle";
  private lastMetricSampleAt = -Infinity;
  private wakeMaxAbsHeight = 0;
  private wakeMeanAbsHeight = 0;
  private wakeMaxCrest = 0;
  private wakeEnergyEstimate = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly log: WebGpuDiagnosticLogger,
    initialPreset: QualityPreset,
    bindGroupLayout: GPUBindGroupLayout,
    metricBindGroupLayout: GPUBindGroupLayout,
    resetPipeline: GPUComputePipeline,
    simulatePipeline: GPUComputePipeline,
    metricsPipeline: GPUComputePipeline
  ) {
    this.bindGroupLayout = bindGroupLayout;
    this.metricBindGroupLayout = metricBindGroupLayout;
    this.resetPipeline = resetPipeline;
    this.simulatePipeline = simulatePipeline;
    this.metricsPipeline = metricsPipeline;
    this.uniformBuffer = device.createBuffer({
      label: "Ripple WebGPU wake uniforms",
      size: WAKE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.metricSamplesBuffer = device.createBuffer({
      label: "Ripple WebGPU wake metric samples",
      size: WAKE_METRIC_BYTE_LENGTH,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.metricReadbackBuffer = device.createBuffer({
      label: "Ripple WebGPU wake metric readback",
      size: WAKE_METRIC_BYTE_LENGTH,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.resources = this.createTexturePair(initialPreset);
    this.reset("init");
    this.log("wake.webgpu.init", "WebGPU wake compute proof initialized", {
      mode: "webgpu-compute",
      textureSize: this.textureSize,
      format: WAKE_TEXTURE_FORMAT,
      workgroupSize: WAKE_WORKGROUP_SIZE,
      maxTextureSize: this.device.limits.maxTextureDimension2D,
      quality: this.qualityId
    });
  }

  static async create(options: WebGpuWakeFieldProbeOptions): Promise<WebGpuWakeFieldProbe> {
    const { device, log } = options;
    device.pushErrorScope("validation");

    try {
      const bindGroupLayout = createWakeBindGroupLayout(device);
      const metricBindGroupLayout = createWakeMetricBindGroupLayout(device);
      const pipelineLayout = device.createPipelineLayout({
        label: "Ripple WebGPU wake pipeline layout",
        bindGroupLayouts: [bindGroupLayout]
      });
      const metricsPipelineLayout = device.createPipelineLayout({
        label: "Ripple WebGPU wake metrics pipeline layout",
        bindGroupLayouts: [bindGroupLayout, metricBindGroupLayout]
      });
      const shaderModule = device.createShaderModule({
        label: "Ripple WebGPU wake compute shader",
        code: wakeComputeSource
      });
      const resetPipeline = await device.createComputePipelineAsync({
        label: "Ripple WebGPU wake reset pipeline",
        layout: pipelineLayout,
        compute: {
          module: shaderModule,
          entryPoint: "resetMain"
        }
      });
      const simulatePipeline = await device.createComputePipelineAsync({
        label: "Ripple WebGPU wake simulation pipeline",
        layout: pipelineLayout,
        compute: {
          module: shaderModule,
          entryPoint: "simulateMain"
        }
      });
      const metricsPipeline = await device.createComputePipelineAsync({
        label: "Ripple WebGPU wake metrics pipeline",
        layout: metricsPipelineLayout,
        compute: {
          module: shaderModule,
          entryPoint: "metricsMain"
        }
      });

      const scopedError = await device.popErrorScope();
      if (scopedError) {
        throw new Error(scopedError.message);
      }

      return new WebGpuWakeFieldProbe(
        device,
        log,
        options.initialPreset,
        bindGroupLayout,
        metricBindGroupLayout,
        resetPipeline,
        simulatePipeline,
        metricsPipeline
      );
    } catch (error) {
      const scopedError = await device.popErrorScope().catch(() => null);
      const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
      log("wake.webgpu.error", "WebGPU wake compute proof failed to initialize", {
        message,
        format: WAKE_TEXTURE_FORMAT
      }, "error");
      throw new Error(`WebGPU wake compute proof failed: ${message}`);
    }
  }

  resizeForPreset(preset: QualityPreset, reason = "quality"): void {
    const nextTextureSize = getWakeTextureSize(this.device, preset);
    if (nextTextureSize === this.textureSize && preset.id === this.qualityId) {
      this.reset(reason);
      return;
    }

    this.disposeTexturePair(this.resources);
    this.resources = this.createTexturePair(preset);
    this.reset(reason);
  }

  reset(reason = "manual"): void {
    if (this.disposed) return;

    this.writeUniformsForReset();
    const dispatchX = getDispatchCount(this.textureSize);
    const dispatchY = getDispatchCount(this.textureSize);
    const commandEncoder = this.device.createCommandEncoder({
      label: "Ripple WebGPU wake reset encoder"
    });

    const pass = commandEncoder.beginComputePass({ label: "Ripple WebGPU wake reset pass" });
    pass.setPipeline(this.resetPipeline);
    pass.setBindGroup(0, this.resources.bindGroups[0]);
    pass.dispatchWorkgroups(dispatchX, dispatchY);
    pass.setBindGroup(0, this.resources.bindGroups[1]);
    pass.dispatchWorkgroups(dispatchX, dispatchY);
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);

    this.activeReadIndex = 0;
    this.frameCount = 0;
    this.passMs = 0;
    this.wakeMaxAbsHeight = 0;
    this.wakeMeanAbsHeight = 0;
    this.wakeMaxCrest = 0;
    this.wakeEnergyEstimate = 0;
    this.lastMetricSampleAt = -Infinity;
    this.log("wake.webgpu.reset", "Reset WebGPU wake proof textures", {
      reason,
      mode: "webgpu-compute",
      textureSize: this.textureSize,
      format: WAKE_TEXTURE_FORMAT,
      dispatchX,
      dispatchY,
      quality: this.qualityId
    });
  }

  encodeStep(input: RenderFrameInput, commandEncoder: GPUCommandEncoder, deviceLost: boolean): number {
    if (this.disposed || deviceLost) {
      this.passMs = 0;
      return this.passMs;
    }

    const startedAt = performance.now();
    const wakeInput = createWakeStepInput(input);
    this.writeUniforms(input, wakeInput);

    const dispatchX = getDispatchCount(this.textureSize);
    const dispatchY = getDispatchCount(this.textureSize);
    const pass = commandEncoder.beginComputePass({ label: "Ripple WebGPU wake simulation pass" });
    pass.setPipeline(this.simulatePipeline);
    pass.setBindGroup(0, this.resources.bindGroups[this.activeReadIndex]);
    pass.dispatchWorkgroups(dispatchX, dispatchY);
    pass.end();

    this.activeReadIndex = flipIndex(this.activeReadIndex);
    this.encodeMetricSample(input, commandEncoder);
    this.passMs = performance.now() - startedAt;
    this.frameCount += 1;
    this.playerSpeed = wakeInput.playerSpeed;
    this.playerGroundContact = wakeInput.playerGroundContact;
    this.maybeLogFrame(input, dispatchX, dispatchY, deviceLost);
    return this.passMs;
  }

  afterSubmit(): void {
    if (this.disposed || this.metricReadbackState !== "copy-submitted") return;

    this.metricReadbackState = "mapping";
    void this.metricReadbackBuffer.mapAsync(GPUMapMode.READ)
      .then(() => {
        const range = this.metricReadbackBuffer.getMappedRange();
        const samples = new Float32Array(range);
        let maxAbsHeight = 0;
        let sumAbsHeight = 0;
        let maxCrest = 0;
        let sumEnergy = 0;

        for (let index = 0; index < WAKE_METRIC_SAMPLE_COUNT; index += 1) {
          const offset = index * WAKE_METRIC_FLOATS_PER_SAMPLE;
          const absHeight = finiteOrDefault(samples[offset], 0);
          const crest = finiteOrDefault(samples[offset + 2], 0);
          const energy = finiteOrDefault(samples[offset + 3], 0);
          maxAbsHeight = Math.max(maxAbsHeight, absHeight);
          sumAbsHeight += absHeight;
          maxCrest = Math.max(maxCrest, crest);
          sumEnergy += energy;
        }

        this.metricReadbackBuffer.unmap();
        if (!this.disposed) {
          this.wakeMaxAbsHeight = maxAbsHeight;
          this.wakeMeanAbsHeight = sumAbsHeight / WAKE_METRIC_SAMPLE_COUNT;
          this.wakeMaxCrest = maxCrest;
          this.wakeEnergyEstimate = sumEnergy / WAKE_METRIC_SAMPLE_COUNT;
        }
        this.metricReadbackState = "idle";
      })
      .catch((error) => {
        if (!this.disposed) {
          this.log("wake.webgpu.error", "WebGPU wake metric readback failed", {
            mode: "webgpu-compute",
            message: error instanceof Error ? error.message : String(error)
          }, "warn");
        }
        this.metricReadbackState = "idle";
      });
  }

  getSampledTextureView(): GPUTextureView {
    return this.resources.views[this.activeReadIndex];
  }

  getMetrics(deviceLost = false): WebGpuWakeFieldProbeMetrics {
    return {
      mode: "webgpu-compute",
      textureSize: this.textureSize,
      format: WAKE_TEXTURE_FORMAT,
      passMs: this.passMs,
      dispatchX: getDispatchCount(this.textureSize),
      dispatchY: getDispatchCount(this.textureSize),
      workgroupSize: WAKE_WORKGROUP_SIZE,
      qualityId: this.qualityId,
      playerSpeed: this.playerSpeed,
      playerGroundContact: this.playerGroundContact,
      frameCount: this.frameCount,
      wakeMaxAbsHeight: this.wakeMaxAbsHeight,
      wakeMeanAbsHeight: this.wakeMeanAbsHeight,
      wakeMaxCrest: this.wakeMaxCrest,
      wakeEnergyEstimate: this.wakeEnergyEstimate,
      deviceLost
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeTexturePair(this.resources);
    this.uniformBuffer.destroy();
    this.metricSamplesBuffer.destroy();
    this.metricReadbackBuffer.destroy();
  }

  private encodeMetricSample(input: RenderFrameInput, commandEncoder: GPUCommandEncoder): void {
    if (
      this.metricReadbackState !== "idle" ||
      input.time - this.lastMetricSampleAt < WAKE_METRIC_SAMPLE_INTERVAL_SECONDS
    ) {
      return;
    }

    const pass = commandEncoder.beginComputePass({ label: "Ripple WebGPU wake metrics pass" });
    pass.setPipeline(this.metricsPipeline);
    pass.setBindGroup(0, this.resources.bindGroups[this.activeReadIndex]);
    pass.setBindGroup(1, this.resources.metricBindGroups[this.activeReadIndex]);
    pass.dispatchWorkgroups(1, 1);
    pass.end();
    commandEncoder.copyBufferToBuffer(
      this.metricSamplesBuffer,
      0,
      this.metricReadbackBuffer,
      0,
      WAKE_METRIC_BYTE_LENGTH
    );
    this.lastMetricSampleAt = input.time;
    this.metricReadbackState = "copy-submitted";
  }

  private createTexturePair(preset: QualityPreset): WakeTexturePair {
    this.textureSize = getWakeTextureSize(this.device, preset);
    this.qualityId = preset.id;
    const textures: [GPUTexture, GPUTexture] = [
      createWakeTexture(this.device, this.textureSize, "A"),
      createWakeTexture(this.device, this.textureSize, "B")
    ];
    const views: [GPUTextureView, GPUTextureView] = [
      textures[0].createView({ label: "Ripple WebGPU wake texture view A" }),
      textures[1].createView({ label: "Ripple WebGPU wake texture view B" })
    ];

    return {
      textures,
      views,
      bindGroups: [
        this.createBindGroup(views[0], views[1], "A to B"),
        this.createBindGroup(views[1], views[0], "B to A")
      ],
      metricBindGroups: [
        this.createMetricBindGroup(views[0], "A"),
        this.createMetricBindGroup(views[1], "B")
      ]
    };
  }

  private createBindGroup(inputView: GPUTextureView, outputView: GPUTextureView, label: string): GPUBindGroup {
    return this.device.createBindGroup({
      label: `Ripple WebGPU wake bind group ${label}`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: inputView },
        { binding: 2, resource: outputView }
      ]
    });
  }

  private createMetricBindGroup(inputView: GPUTextureView, label: string): GPUBindGroup {
    return this.device.createBindGroup({
      label: `Ripple WebGPU wake metric bind group ${label}`,
      layout: this.metricBindGroupLayout,
      entries: [
        { binding: 0, resource: inputView },
        { binding: 1, resource: { buffer: this.metricSamplesBuffer } }
      ]
    });
  }

  private disposeTexturePair(resources: WakeTexturePair): void {
    resources.textures[0].destroy();
    resources.textures[1].destroy();
  }

  private writeUniformsForReset(): void {
    this.uniforms.fill(0);
    this.uniforms[2] = 1;
    this.uniforms[3] = this.textureSize;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private writeUniforms(input: RenderFrameInput, wakeInput: WakeStepInput): void {
    const medium = input.settings.waveMedium;
    const delta = Math.min(Math.max(0, input.delta), WAKE_MAX_SIM_DELTA_SECONDS);
    const propagationSpeed = getBasePropagationSpeedMetersPerSecond(medium) * medium.wakeSpeedMultiplier;

    this.uniforms[0] = delta;
    this.uniforms[1] = input.time;
    this.uniforms[2] = input.qualityPreset.fieldRadius;
    this.uniforms[3] = this.textureSize;
    this.uniforms[4] = wakeInput.previousX;
    this.uniforms[5] = wakeInput.previousZ;
    this.uniforms[6] = wakeInput.currentX;
    this.uniforms[7] = wakeInput.currentZ;
    this.uniforms[8] = wakeInput.velocityX;
    this.uniforms[9] = wakeInput.velocityZ;
    this.uniforms[10] = wakeInput.playerSpeed;
    this.uniforms[11] = wakeInput.playerGroundContact;
    this.uniforms[12] = propagationSpeed;
    this.uniforms[13] = medium.damping;
    this.uniforms[14] = WAKE_HEIGHT_STRENGTH;
    this.uniforms[15] = WAKE_BRUSH_RADIUS_METERS;
    this.uniforms[16] = WAKE_SHOULDER_OFFSET_METERS;
    this.uniforms[17] = WAKE_MIN_INJECTION_SPEED;
    this.uniforms[18] = WAKE_EDGE_ABSORB_START_RATIO;
    this.uniforms[19] = WAKE_EDGE_ABSORB_END_RATIO;
    this.uniforms[20] = WAKE_EDGE_FADE_START_RATIO;
    this.uniforms[21] = WAKE_MICRO_DAMPING_START;
    this.uniforms[22] = WAKE_MICRO_DAMPING_END;
    this.uniforms[23] = 1 / Math.max(1, this.textureSize);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private maybeLogFrame(input: RenderFrameInput, dispatchX: number, dispatchY: number, deviceLost: boolean): void {
    if (input.time - this.lastFrameLogAt < WAKE_FRAME_LOG_INTERVAL_SECONDS) return;

    this.lastFrameLogAt = input.time;
    this.log("wake.webgpu.frame", "WebGPU wake compute proof frame sample", {
      time: roundMetric(input.time),
      mode: "webgpu-compute",
      passMs: roundMetric(this.passMs),
      textureSize: this.textureSize,
      format: WAKE_TEXTURE_FORMAT,
      dispatchX,
      dispatchY,
      workgroupSize: WAKE_WORKGROUP_SIZE,
      quality: this.qualityId,
      playerSpeed: roundMetric(this.playerSpeed),
      playerGroundContact: roundMetric(this.playerGroundContact),
      wakeMaxAbsHeight: roundMetric(this.wakeMaxAbsHeight),
      wakeMeanAbsHeight: roundMetric(this.wakeMeanAbsHeight),
      wakeMaxCrest: roundMetric(this.wakeMaxCrest),
      wakeEnergyEstimate: roundMetric(this.wakeEnergyEstimate),
      deviceLost
    }, "debug");
  }
}

function createWakeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "Ripple WebGPU wake bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: "unfilterable-float",
          viewDimension: "2d",
          multisampled: false
        }
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: "write-only",
          format: WAKE_TEXTURE_FORMAT,
          viewDimension: "2d"
        }
      }
    ]
  });
}

function createWakeMetricBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "Ripple WebGPU wake metric bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "float" }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" }
      }
    ]
  });
}

function createWakeTexture(device: GPUDevice, textureSize: number, labelSuffix: string): GPUTexture {
  return device.createTexture({
    label: `Ripple WebGPU wake texture ${labelSuffix}`,
    size: {
      width: textureSize,
      height: textureSize,
      depthOrArrayLayers: 1
    },
    format: WAKE_TEXTURE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
  });
}

function getWakeTextureSize(device: GPUDevice, preset: QualityPreset): number {
  return Math.max(1, Math.min(preset.wakeTextureSize, device.limits.maxTextureDimension2D));
}

function getDispatchCount(textureSize: number): number {
  return Math.ceil(textureSize / WAKE_WORKGROUP_SIZE);
}

function createWakeStepInput(input: RenderFrameInput): WakeStepInput {
  if (input.camera.projection.cameraMode !== "diagnostic-orbit") {
    return {
      previousX: finiteOrDefault(input.player.previousPosition.x, input.player.position.x),
      previousZ: finiteOrDefault(input.player.previousPosition.z, input.player.position.z),
      currentX: finiteOrDefault(input.player.position.x, 0),
      currentZ: finiteOrDefault(input.player.position.z, 0),
      velocityX: finiteOrDefault(input.player.velocity.x, 0),
      velocityZ: finiteOrDefault(input.player.velocity.z, 0),
      playerSpeed: finiteOrDefault(input.player.speed, 0),
      playerGroundContact: Math.min(1, Math.max(0, finiteOrDefault(input.player.groundContact, 1)))
    };
  }

  return createSyntheticWakeInput(input);
}

function createSyntheticWakeInput(input: RenderFrameInput): WakeStepInput {
  const fieldRadius = input.qualityPreset.fieldRadius;
  const pathRadius = fieldRadius * 0.32;
  const angularSpeed = 0.58;
  const previousTime = Math.max(0, input.time - input.delta);
  const previousAngle = previousTime * angularSpeed;
  const currentAngle = input.time * angularSpeed;
  const previousX = Math.cos(previousAngle) * pathRadius;
  const previousZ = Math.sin(previousAngle * 1.17) * pathRadius * 0.72;
  const currentX = Math.cos(currentAngle) * pathRadius;
  const currentZ = Math.sin(currentAngle * 1.17) * pathRadius * 0.72;
  const safeDelta = Math.max(input.delta, 1 / 120);
  const velocityX = (currentX - previousX) / safeDelta;
  const velocityZ = (currentZ - previousZ) / safeDelta;
  const playerSpeed = Math.hypot(velocityX, velocityZ);

  return {
    previousX,
    previousZ,
    currentX,
    currentZ,
    velocityX,
    velocityZ,
    playerSpeed,
    playerGroundContact: 1
  };
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function flipIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
