import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { QualityPreset } from "../qualityPresets";
import type {
  RenderFrameInput,
  RenderRuntime,
  RenderRuntimeCapabilities,
  RenderRuntimeStats,
  ThreeRenderRuntimeOptions
} from "./types";
import { WebGlGpuFrameTimer } from "./gpuFrameTimer";
import { isRenderBenchmarkEnabled } from "./renderBenchmark";

export class ThreeRenderRuntime implements RenderRuntime {
  readonly backendId = "webgl" as const;
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: RenderRuntimeCapabilities;
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  private gpuCpuSubmitMs = 0;
  private readonly gpuFrameTimer: WebGlGpuFrameTimer;

  constructor(private readonly options: ThreeRenderRuntimeOptions) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.setClearColor(0x020409, 1);
    this.renderer.info.autoReset = false;
    this.gpuFrameTimer = new WebGlGpuFrameTimer(
      this.renderer.getContext() as WebGL2RenderingContext,
      isRenderBenchmarkEnabled()
    );

    this.canvas = this.renderer.domElement;
    this.canvas.dataset.rendererBackend = this.backendId;
    options.app.append(this.canvas);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(options.scene, options.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), options.initialBloomStrength, 0.3, 0.95);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.capabilities = {
      backendId: this.backendId,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      supportsBloom: true,
      supportsLocalLights: true,
      fallbackReason: options.fallbackReason,
      deviceLost: false
    };
  }

  beginFrame(): void {
    this.renderer.info.reset();
    this.gpuFrameTimer.begin();
  }

  renderFrame(input: RenderFrameInput): void {
    this.renderCurrentScene(input.bloomStrength);
  }

  /** Render the Three-owned scene without manufacturing a neutral snapshot. */
  renderCurrentScene(bloomStrength: number): void {
    const startedAt = performance.now();
    this.bloomPass.strength = bloomStrength;

    if (bloomStrength > 0.02) {
      this.composer.render();
    } else {
      this.renderer.render(this.options.scene, this.options.camera);
    }

    this.gpuFrameTimer.end();
    this.gpuCpuSubmitMs = performance.now() - startedAt;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
  }

  applyQualityPreset(preset: QualityPreset, bloomStrength: number, reason: "quality" | "field-scale" = "quality"): void {
    void reason;
    this.renderer.shadowMap.enabled = preset.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.bloomPass.strength = bloomStrength;
  }

  prewarm(): void {
    this.renderer.compile(this.options.scene, this.options.camera);
  }

  setAnimationLoop(callback: Parameters<THREE.WebGLRenderer["setAnimationLoop"]>[0]): void {
    this.renderer.setAnimationLoop(callback);
  }

  getStats(): RenderRuntimeStats {
    const gpuResult = this.gpuFrameTimer.getLatestResult();
    return {
      backendId: this.backendId,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
      gpuCpuSubmitMs: this.gpuCpuSubmitMs,
      gpuFrameMs: gpuResult?.durationMs,
      gpuFrameSequence: gpuResult?.sequence,
      gpuTimerMode: this.gpuFrameTimer.mode,
      gpuTimerErrorCount: this.gpuFrameTimer.getErrorCount(),
      fallbackReason: this.capabilities.fallbackReason,
      deviceLost: this.capabilities.deviceLost
    };
  }

  destroy(): void {
    this.setAnimationLoop(null);
    this.gpuFrameTimer.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
