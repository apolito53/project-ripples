import * as THREE from "three";
import type { QualityPreset } from "./qualityPresets";
import type { WaveMediumSettings } from "./waveMedium";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";
import { debugEvent, roundMetric } from "./debugLog";

const NO_OP_PIXEL = new Uint8Array([128, 128, 0, 255]);
const WAKE_FRAME_LOG_INTERVAL_SECONDS = 0.5;
const WAKE_MIN_INJECTION_SPEED = 1.2;
const WAKE_BRUSH_RADIUS_METERS = 1.4;
const WAKE_SHOULDER_OFFSET_METERS = 0.9;
const WAKE_HEIGHT_STRENGTH = 0.08;
const WAKE_MAX_SIM_DELTA_SECONDS = 1 / 30;

type WakeFieldUniforms = {
  readonly uPreviousWake: THREE.IUniform<THREE.Texture>;
  readonly uDeltaTime: THREE.IUniform<number>;
  readonly uFieldRadius: THREE.IUniform<number>;
  readonly uPlayerPrevious: THREE.IUniform<THREE.Vector2>;
  readonly uPlayerCurrent: THREE.IUniform<THREE.Vector2>;
  readonly uPlayerVelocity: THREE.IUniform<THREE.Vector2>;
  readonly uPlayerSpeed: THREE.IUniform<number>;
  readonly uTexelSize: THREE.IUniform<THREE.Vector2>;
  readonly uPropagationSpeed: THREE.IUniform<number>;
  readonly uDamping: THREE.IUniform<number>;
  readonly uInjectionStrength: THREE.IUniform<number>;
  readonly uBrushRadius: THREE.IUniform<number>;
  readonly uShoulderOffset: THREE.IUniform<number>;
  readonly uTextureEncoding: THREE.IUniform<number>;
};

export type WakeFieldMode = "gpu-half-float" | "gpu-ubyte" | "noop";

export type WakeFieldMetrics = {
  readonly mode: WakeFieldMode;
  readonly textureSize: number;
  readonly passMs: number;
  readonly fallbackReason: string;
  readonly supportsVertexTextures: boolean;
  readonly movementSourceAddsSinceLastFrame: number;
};

export type WakeFieldRenderInput = {
  readonly time: number;
  readonly delta: number;
  readonly fieldRadius: number;
  readonly playerPosition: THREE.Vector3;
  readonly previousPlayerPosition: THREE.Vector3;
  readonly playerVelocity: THREE.Vector3;
  readonly playerSpeed: number;
  readonly waveMedium: WaveMediumSettings;
  readonly activeRippleSourceCount: number;
  readonly renderedRippleSourceCount: number;
  readonly hexCount: number;
  readonly qualityId: string;
};

type WakeFieldModeSelection = {
  readonly mode: WakeFieldMode;
  readonly fallbackReason: string;
};

export class WakeField {
  private readonly noopTexture = new THREE.DataTexture(NO_OP_PIXEL, 1, 1, THREE.RGBAFormat);
  private readonly supportsVertexTextures: boolean;
  private readonly fallbackReason: string;
  private readonly mode: WakeFieldMode;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly uniforms: WakeFieldUniforms;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readTarget: THREE.WebGLRenderTarget | null = null;
  private writeTarget: THREE.WebGLRenderTarget | null = null;
  private textureSize = 1;
  private passMs = 0;
  private lastFrameLogAt = -Infinity;

  constructor(private readonly renderer: THREE.WebGLRenderer, preset: QualityPreset) {
    this.noopTexture.name = "No-op wake texture";
    this.noopTexture.needsUpdate = true;

    const capabilities = renderer.capabilities;
    this.supportsVertexTextures = capabilities.maxVertexTextures > 0;
    const modeSelection = this.supportsVertexTextures
      ? chooseWakeFieldMode(renderer)
      : {
        mode: "noop" as const,
        fallbackReason: "Vertex shader texture sampling is unavailable."
      };
    this.mode = modeSelection.mode;
    this.fallbackReason = modeSelection.fallbackReason;

    this.uniforms = {
      uPreviousWake: { value: this.noopTexture },
      uDeltaTime: { value: 0 },
      uFieldRadius: { value: preset.fieldRadius },
      uPlayerPrevious: { value: new THREE.Vector2() },
      uPlayerCurrent: { value: new THREE.Vector2() },
      uPlayerVelocity: { value: new THREE.Vector2() },
      uPlayerSpeed: { value: 0 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uPropagationSpeed: { value: 9 },
      uDamping: { value: 0.16 },
      uInjectionStrength: { value: WAKE_HEIGHT_STRENGTH },
      uBrushRadius: { value: WAKE_BRUSH_RADIUS_METERS },
      uShoulderOffset: { value: WAKE_SHOULDER_OFFSET_METERS },
      uTextureEncoding: { value: this.mode === "gpu-ubyte" ? 1 : 0 }
    };
    this.material = createWakeMaterial(this.uniforms);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.resizeForPreset(preset, "init");
    debugEvent("wake.init", "Wake field initialized", {
      mode: this.mode,
      fallbackReason: this.fallbackReason,
      supportsVertexTextures: this.supportsVertexTextures,
      maxVertexTextures: capabilities.maxVertexTextures,
      maxTextureSize: capabilities.maxTextureSize,
      isWebGL2: capabilities.isWebGL2,
      textureSize: this.textureSize,
      quality: preset.id
    }, this.mode === "noop" ? "warn" : "info");
    if (this.fallbackReason) {
      debugEvent("wake.fallback", "Wake field fallback selected", {
        mode: this.mode,
        fallbackReason: this.fallbackReason,
        supportsVertexTextures: this.supportsVertexTextures,
        maxVertexTextures: capabilities.maxVertexTextures,
        textureSize: this.textureSize,
        quality: preset.id
      }, this.mode === "noop" ? "warn" : "info");
    }
  }

  render(input: WakeFieldRenderInput): void {
    if (this.mode === "noop" || !this.readTarget || !this.writeTarget) {
      this.passMs = 0;
      return;
    }

    const startedAt = performance.now();
    const delta = Math.min(Math.max(0, input.delta), WAKE_MAX_SIM_DELTA_SECONDS);
    const previousRenderTarget = this.renderer.getRenderTarget();
    const previousAutoClear = this.renderer.autoClear;
    const velocityX = input.playerVelocity.x;
    const velocityZ = input.playerVelocity.z;

    this.uniforms.uPreviousWake.value = this.readTarget.texture;
    this.uniforms.uDeltaTime.value = delta;
    this.uniforms.uFieldRadius.value = input.fieldRadius;
    this.uniforms.uPlayerPrevious.value.set(input.previousPlayerPosition.x, input.previousPlayerPosition.z);
    this.uniforms.uPlayerCurrent.value.set(input.playerPosition.x, input.playerPosition.z);
    this.uniforms.uPlayerVelocity.value.set(velocityX, velocityZ);
    this.uniforms.uPlayerSpeed.value = input.playerSpeed;
    this.uniforms.uPropagationSpeed.value =
      getBasePropagationSpeedMetersPerSecond(input.waveMedium) * input.waveMedium.wakeSpeedMultiplier;
    this.uniforms.uDamping.value = input.waveMedium.damping;

    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.writeTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousRenderTarget);
    this.renderer.autoClear = previousAutoClear;
    this.swapTargets();

    this.passMs = performance.now() - startedAt;
    this.maybeLogFrame(input);
  }

  prewarm(input: WakeFieldRenderInput): void {
    // Compile the wake pass against the allocated target before the first real
    // gameplay frame after startup or quality rebuild. Previous/current match,
    // so this writes a neutral frame and does not stamp player movement.
    this.render({
      ...input,
      delta: 0,
      playerSpeed: 0,
      activeRippleSourceCount: input.activeRippleSourceCount,
      renderedRippleSourceCount: input.renderedRippleSourceCount
    });
  }

  resizeForPreset(preset: QualityPreset, reason = "quality"): void {
    if (this.mode === "noop") {
      this.textureSize = 1;
      return;
    }

    const nextTextureSize = Math.max(1, preset.wakeTextureSize);
    if (nextTextureSize !== this.textureSize || !this.readTarget || !this.writeTarget) {
      this.disposeTargets();
      this.textureSize = nextTextureSize;
      this.readTarget = createWakeTarget(nextTextureSize, this.mode);
      this.writeTarget = createWakeTarget(nextTextureSize, this.mode);
      this.uniforms.uTexelSize.value.set(1 / nextTextureSize, 1 / nextTextureSize);
      this.reset(reason);
    } else {
      this.reset(reason);
    }
  }

  reset(reason = "manual"): void {
    if (this.mode === "noop") return;
    clearTarget(this.renderer, this.readTarget, this.mode);
    clearTarget(this.renderer, this.writeTarget, this.mode);
    debugEvent("wake.reset", "Reset wake field texture", {
      reason,
      mode: this.mode,
      textureSize: this.textureSize
    }, "info");
  }

  getTexture(): THREE.Texture {
    return this.readTarget?.texture ?? this.noopTexture;
  }

  supportsVertexTextureSampling(): boolean {
    return this.supportsVertexTextures;
  }

  getMetrics(): WakeFieldMetrics {
    return {
      mode: this.mode,
      textureSize: this.textureSize,
      passMs: this.passMs,
      fallbackReason: this.fallbackReason,
      supportsVertexTextures: this.supportsVertexTextures,
      movementSourceAddsSinceLastFrame: 0
    };
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.geometry.dispose();
    this.material.dispose();
    this.noopTexture.dispose();
  }

  private maybeLogFrame(input: WakeFieldRenderInput): void {
    if (input.time - this.lastFrameLogAt < WAKE_FRAME_LOG_INTERVAL_SECONDS) return;
    if (input.playerSpeed < WAKE_MIN_INJECTION_SPEED) return;

    this.lastFrameLogAt = input.time;
    debugEvent("wake.frame", "Wake field frame sample", {
      time: roundMetric(input.time),
      mode: this.mode,
      passMs: roundMetric(this.passMs),
      textureSize: this.textureSize,
      playerSpeed: roundMetric(input.playerSpeed),
      activeRippleSources: input.activeRippleSourceCount,
      renderedRippleSources: input.renderedRippleSourceCount,
      movementSourceAddsSinceLastFrame: 0,
      quality: input.qualityId,
      hexCount: input.hexCount
    }, "debug");
  }

  private swapTargets(): void {
    const oldReadTarget = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = oldReadTarget;
  }

  private disposeTargets(): void {
    this.readTarget?.dispose();
    this.writeTarget?.dispose();
    this.readTarget = null;
    this.writeTarget = null;
  }
}

function chooseWakeFieldMode(renderer: THREE.WebGLRenderer): WakeFieldModeSelection {
  // Three exposes a portable HalfFloatType, but rendering into it still depends
  // on browser/GPU extensions. If the nicer path is missing, the same shader can
  // encode signed height/velocity into unsigned bytes instead.
  const capabilities = renderer.capabilities;
  const supportsHalfFloatTexture = capabilities.isWebGL2 || renderer.extensions.has("OES_texture_half_float");
  const supportsHalfFloatRenderTarget = renderer.extensions.has("EXT_color_buffer_half_float") ||
    renderer.extensions.has("EXT_color_buffer_float");

  if (supportsHalfFloatTexture && supportsHalfFloatRenderTarget) {
    return { mode: "gpu-half-float", fallbackReason: "" };
  }

  return {
    mode: "gpu-ubyte",
    fallbackReason: "Half-float wake render targets are unavailable; using unsigned-byte encoded height/velocity."
  };
}

function createWakeTarget(size: number, mode: WakeFieldMode): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: mode === "gpu-half-float" ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false
  });
  target.texture.name = `Wake field ${size}px`;
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

function clearTarget(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget | null,
  mode: WakeFieldMode
): void {
  if (!target) return;
  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = new THREE.Color();
  renderer.getClearColor(previousClearColor);
  const previousClearAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(mode === "gpu-ubyte" ? 0x808000 : 0x000000, 1);
  renderer.clear(true, false, false);
  renderer.setClearColor(previousClearColor, previousClearAlpha);
  renderer.setRenderTarget(previousTarget);
}

function createWakeMaterial(uniforms: WakeFieldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform sampler2D uPreviousWake;
      uniform float uDeltaTime;
      uniform float uFieldRadius;
      uniform vec2 uPlayerPrevious;
      uniform vec2 uPlayerCurrent;
      uniform vec2 uPlayerVelocity;
      uniform float uPlayerSpeed;
      uniform vec2 uTexelSize;
      uniform float uPropagationSpeed;
      uniform float uDamping;
      uniform float uInjectionStrength;
      uniform float uBrushRadius;
      uniform float uShoulderOffset;
      uniform float uTextureEncoding;
      varying vec2 vUv;

      vec4 decodeWake(vec4 sampleValue) {
        if (uTextureEncoding > 0.5) {
          return vec4(sampleValue.rg * 2.0 - 1.0, sampleValue.b, sampleValue.a);
        }
        return sampleValue;
      }

      vec4 encodeWake(float height, float velocity, float crest, float reserved) {
        if (uTextureEncoding > 0.5) {
          return vec4(height * 0.5 + 0.5, velocity * 0.5 + 0.5, crest, reserved);
        }
        return vec4(height, velocity, crest, reserved);
      }

      float segmentDistance(vec2 point, vec2 a, vec2 b) {
        vec2 ab = b - a;
        float h = clamp(dot(point - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
        return length(point - (a + ab * h));
      }

      void main() {
        vec4 center = decodeWake(texture2D(uPreviousWake, vUv));
        float left = decodeWake(texture2D(uPreviousWake, vUv - vec2(uTexelSize.x, 0.0))).r;
        float right = decodeWake(texture2D(uPreviousWake, vUv + vec2(uTexelSize.x, 0.0))).r;
        float down = decodeWake(texture2D(uPreviousWake, vUv - vec2(0.0, uTexelSize.y))).r;
        float up = decodeWake(texture2D(uPreviousWake, vUv + vec2(0.0, uTexelSize.y))).r;

        float height = center.r;
        float velocity = center.g;
        float crest = center.b;
        vec2 worldPosition = (vUv - vec2(0.5)) * uFieldRadius * 2.0;
        float cellMeters = max(0.25, uFieldRadius * 2.0 * uTexelSize.x);
        float safeDelta = min(max(uDeltaTime, 0.0), ${WAKE_MAX_SIM_DELTA_SECONDS.toFixed(5)});
        float cfl = min(0.42, safeDelta * uPropagationSpeed / cellMeters);
        float laplacian = (left + right + down + up - height * 4.0);

        velocity += laplacian * cfl * 0.42;
        velocity *= max(0.0, 1.0 - uDamping * safeDelta * 1.65);
        height += velocity * cfl * 1.45;
        height *= max(0.0, 1.0 - uDamping * safeDelta * 0.42);

        vec2 movement = uPlayerCurrent - uPlayerPrevious;
        vec2 direction = normalize(uPlayerVelocity + vec2(0.0001, 0.0));
        float motionDistance = length(movement);
        float moving = smoothstep(${WAKE_MIN_INJECTION_SPEED.toFixed(2)}, 8.0, uPlayerSpeed) *
          smoothstep(0.015, 0.12, motionDistance);
        float centerDistance = segmentDistance(worldPosition, uPlayerPrevious, uPlayerCurrent);
        float centerBrush = exp(-pow(centerDistance / max(0.2, uBrushRadius), 2.0));
        float lateral = abs((worldPosition.x - uPlayerCurrent.x) * direction.y -
          (worldPosition.y - uPlayerCurrent.y) * direction.x);
        float shoulder = exp(-pow((lateral - uShoulderOffset) / max(0.14, uBrushRadius * 0.22), 2.0)) *
          exp(-pow(centerDistance / max(0.35, uBrushRadius * 1.65), 2.0));
        float stern = smoothstep(0.2, 1.0, dot(worldPosition - uPlayerCurrent, -direction));
        float injection = moving * uInjectionStrength;

        height += injection * (-centerBrush * 0.82 + shoulder * stern * 0.42);
        velocity += injection * (-centerBrush * 1.15 + shoulder * stern * 0.62);
        crest = max(crest * max(0.0, 1.0 - safeDelta * 1.4), moving * (centerBrush * 0.12 + shoulder * 0.75));

        float arenaMask = 1.0 - smoothstep(uFieldRadius * 0.96, uFieldRadius, length(worldPosition));
        height *= arenaMask;
        velocity *= arenaMask;
        crest *= arenaMask;

        gl_FragColor = encodeWake(clamp(height, -0.9, 0.9), clamp(velocity, -0.95, 0.95), clamp(crest, 0.0, 1.0), 1.0);
      }
    `
  });
}
