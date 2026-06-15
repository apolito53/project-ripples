import * as THREE from "three";
import type { LabSettings } from "./labSettings";
import type { QualityPreset } from "./qualityPresets";
import { MAX_SHADER_RIPPLE_SOURCES, type RippleSourceStore } from "./rippleSources";
import { sampleFieldHeight } from "./terrain";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";

const CUBE_FOOTPRINT = 0.68;
const BASE_CUBE_HEIGHT = 0.08;
const RIPPLE_WIDTH = 1.45;
const RIPPLE_LIFETIME = 7.5;

type Uniform<T> = {
  value: T;
};

type RippleShaderUniforms = {
  readonly uTime: Uniform<number>;
  readonly uPlayerPosition: Uniform<THREE.Vector3>;
  readonly uPlayerVelocity: Uniform<THREE.Vector2>;
  readonly uPlayerSpeed: Uniform<number>;
  readonly uRippleHeight: Uniform<number>;
  readonly uRippleRadius: Uniform<number>;
  readonly uBasePropagationSpeed: Uniform<number>;
  readonly uMediumDamping: Uniform<number>;
  readonly uMediumDispersion: Uniform<number>;
  readonly uBloomMood: Uniform<number>;
  readonly uRippleCount: Uniform<number>;
  readonly uRipples: Uniform<THREE.Vector4[]>;
  readonly uRippleMetadata: Uniform<THREE.Vector4[]>;
};

type RippleShader = {
  uniforms: RippleShaderUniforms;
  vertexShader: string;
  fragmentShader: string;
};

export class RippleField {
  readonly object = new THREE.Group();
  private readonly rippleUniforms = Array.from(
    { length: MAX_SHADER_RIPPLE_SOURCES },
    () => new THREE.Vector4(0, 0, -999, 0)
  );
  private readonly rippleMetadataUniforms = Array.from(
    { length: MAX_SHADER_RIPPLE_SOURCES },
    () => new THREE.Vector4(1, 1, 1, -99)
  );
  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private geometry: THREE.BoxGeometry | null = null;
  private shader: RippleShader | null = null;
  private instanceCount = 0;

  constructor(scene: THREE.Scene, preset: QualityPreset) {
    this.object.name = "Shader ripple voxel field";
    scene.add(this.object);
    this.rebuild(preset);
  }

  rebuild(preset: QualityPreset): void {
    this.disposeMesh();
    this.shader = null;

    const positions: number[] = [];
    const phases: number[] = [];
    const tints: number[] = [];
    const radius = preset.fieldRadius;
    const spacing = preset.cubeSpacing;

    this.geometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    this.material = this.createMaterial();

    const halfCellCount = Math.ceil(radius / spacing);
    const placementRadius = radius + spacing * 0.5;
    const placementRadiusSquared = placementRadius * placementRadius;

    // The arena floor is circular, so the voxel field should be circular too.
    // We still walk a square coordinate range because it is the simplest grid
    // generator, but only cells whose footprint reaches the arena disc survive.
    for (let iz = -halfCellCount; iz <= halfCellCount; iz += 1) {
      for (let ix = -halfCellCount; ix <= halfCellCount; ix += 1) {
        const x = ix * spacing;
        const z = iz * spacing;
        if (x * x + z * z > placementRadiusSquared) continue;

        const y = sampleFieldHeight(x, z);
        const terrainTint = createTerrainTint(x, y, z);

        positions.push(x, y, z);
        phases.push(pseudoRandom(x, z) * Math.PI * 2);
        tints.push(terrainTint.r, terrainTint.g, terrainTint.b);
      }
    }

    this.instanceCount = positions.length / 3;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.instanceCount);
    this.mesh.name = `${preset.label} ripple cube field`;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = preset.shadowMapSize > 0;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.instanceCount; index += 1) {
      const offset = index * 3;
      matrix.makeTranslation(positions[offset], positions[offset + 1], positions[offset + 2]);
      this.mesh.setMatrixAt(index, matrix);
    }

    // These per-instance attributes let the shader know where each cube lives
    // without touching instance matrices every frame. That keeps the ripple
    // effect GPU-side and leaves the CPU free to merely update a few uniforms.
    this.geometry.setAttribute(
      "instanceFieldPosition",
      new THREE.InstancedBufferAttribute(new Float32Array(positions), 3)
    );
    this.geometry.setAttribute(
      "instancePhase",
      new THREE.InstancedBufferAttribute(new Float32Array(phases), 1)
    );
    this.geometry.setAttribute(
      "instanceTint",
      new THREE.InstancedBufferAttribute(new Float32Array(tints), 3)
    );

    this.object.add(this.mesh);
  }

  update(
    time: number,
    settings: LabSettings,
    preset: QualityPreset,
    sources: RippleSourceStore,
    playerPosition: THREE.Vector3,
    playerVelocity: THREE.Vector3,
    playerSpeed: number
  ): void {
    if (!this.shader) return;

    const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
    const activeCount = sources.writeUniforms(this.rippleUniforms, this.rippleMetadataUniforms, time);
    this.shader.uniforms.uTime.value = time;
    this.shader.uniforms.uPlayerPosition.value.copy(playerPosition);
    this.shader.uniforms.uPlayerVelocity.value.set(playerVelocity.x, playerVelocity.z);
    this.shader.uniforms.uPlayerSpeed.value = playerSpeed;
    this.shader.uniforms.uRippleHeight.value = settings.rippleHeight;
    this.shader.uniforms.uRippleRadius.value = settings.rippleRadius;
    this.shader.uniforms.uBasePropagationSpeed.value = basePropagationSpeed;
    this.shader.uniforms.uMediumDamping.value = settings.waveMedium.damping;
    this.shader.uniforms.uMediumDispersion.value = settings.waveMedium.dispersion;
    this.shader.uniforms.uBloomMood.value = Math.max(settings.bloomStrength, preset.bloomStrength);
    this.shader.uniforms.uRippleCount.value = activeCount;
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  dispose(): void {
    this.disposeMesh();
    this.object.removeFromParent();
  }

  private createMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.22,
      roughness: 0.32,
      emissive: 0x06131d,
      emissiveIntensity: 0.28
    });

    material.onBeforeCompile = (shader) => {
      const rippleShader = shader as unknown as RippleShader;
      this.shader = rippleShader;
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uPlayerPosition = { value: new THREE.Vector3() };
      shader.uniforms.uPlayerVelocity = { value: new THREE.Vector2() };
      shader.uniforms.uPlayerSpeed = { value: 0 };
      shader.uniforms.uRippleHeight = { value: 1.25 };
      shader.uniforms.uRippleRadius = { value: 9 };
      shader.uniforms.uBasePropagationSpeed = { value: 9 };
      shader.uniforms.uMediumDamping = { value: 0.16 };
      shader.uniforms.uMediumDispersion = { value: 0.22 };
      shader.uniforms.uBloomMood = { value: 1 };
      shader.uniforms.uRippleCount = { value: 0 };
      shader.uniforms.uRipples = { value: this.rippleUniforms };
      shader.uniforms.uRippleMetadata = { value: this.rippleMetadataUniforms };

      rippleShader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uTime;
          uniform vec3 uPlayerPosition;
          uniform vec2 uPlayerVelocity;
          uniform float uPlayerSpeed;
          uniform float uRippleHeight;
          uniform float uRippleRadius;
          uniform float uBasePropagationSpeed;
          uniform float uMediumDamping;
          uniform float uMediumDispersion;
          uniform float uBloomMood;
          uniform int uRippleCount;
          uniform vec4 uRipples[${MAX_SHADER_RIPPLE_SOURCES}];
          uniform vec4 uRippleMetadata[${MAX_SHADER_RIPPLE_SOURCES}];
          attribute vec3 instanceFieldPosition;
          attribute float instancePhase;
          attribute vec3 instanceTint;
          varying float vRippleGlow;
          varying vec3 vRippleTint;

          float rippleRing(vec4 ripple, vec4 metadata, vec2 cellPosition) {
            vec2 origin = ripple.xy;
            float startTime = ripple.z;
            float strength = ripple.w;
            float age = max(0.0, uTime - startTime);
            float propagationSpeed = uBasePropagationSpeed * max(0.05, metadata.x);
            float distanceToCell = distance(origin, cellPosition);
            float front = age * propagationSpeed;
            float width = ${RIPPLE_WIDTH.toFixed(2)} * max(0.2, metadata.y) +
              age * uMediumDispersion * 0.16;
            float ring = exp(-pow((distanceToCell - front) / max(0.12, width), 2.0));
            float fade = max(0.0, 1.0 - age / ${RIPPLE_LIFETIME.toFixed(2)});
            float damping = exp(-age * uMediumDamping * max(0.05, metadata.z)) *
              exp(-distanceToCell * uMediumDamping * max(0.05, metadata.z) * 0.018);
            float directionalSource = step(-10.0, metadata.w);
            float directionMask = 1.0;

            if (directionalSource > 0.5 && distanceToCell > 0.001) {
              vec2 direction = vec2(cos(metadata.w), sin(metadata.w));
              vec2 radial = (cellPosition - origin) / distanceToCell;
              float behind = smoothstep(-0.15, 0.78, dot(radial, -direction));
              float lateral = abs(radial.x * direction.y - radial.y * direction.x);
              float centerTrail = exp(-pow(lateral / 0.42, 2.0)) * 0.34;
              float shoulderTrail = exp(-pow((lateral - 0.52) / 0.24, 2.0)) * 0.72;
              directionMask = clamp(behind * (0.25 + centerTrail + shoulderTrail), 0.0, 1.0);
            }

            return ring * fade * damping * strength * mix(1.0, directionMask, directionalSource);
          }

          float movingBodyWake(vec2 fromPlayer, float distanceToPlayer, float phase) {
            float speed = length(uPlayerVelocity);
            float moving = smoothstep(0.8, 10.5, speed);
            if (moving <= 0.001 || distanceToPlayer <= 0.001) {
              return 0.0;
            }

            vec2 direction = uPlayerVelocity / max(speed, 0.001);
            vec2 radial = fromPlayer / max(distanceToPlayer, 0.001);
            float ahead = dot(radial, direction);
            float sideways = abs(radial.x * direction.y - radial.y * direction.x);

            // Treat the avatar like a small hull: a compact bow ridge in front,
            // then a wider V-shaped wake and foamy centerline behind it. This is
            // the immediate displacement field; emitted wake sources keep waves
            // traveling after the player stops moving.
            float bowBand = exp(-pow((distanceToPlayer - 2.0) / 1.55, 2.0));
            float bow = smoothstep(0.12, 0.94, ahead) * bowBand;
            float behind = smoothstep(0.08, 0.92, -ahead);
            float centerTrail = exp(-pow(sideways * 2.75, 2.0)) *
              exp(-distanceToPlayer / max(3.0, uRippleRadius * 0.75));
            float shoulderWake = exp(-pow((sideways - 0.54) / 0.16, 2.0)) *
              exp(-distanceToPlayer / max(4.0, uRippleRadius * 1.2));
            float texture = 0.62 + 0.38 * sin(uTime * 7.1 - distanceToPlayer * 3.2 + phase);

            return moving * (bow * 0.44 + behind * texture * (centerTrail * 0.2 + shoulderWake * 0.36));
          }`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
          vec2 cellPosition = instanceFieldPosition.xz;
          vec2 fromPlayer = cellPosition - uPlayerPosition.xz;
          float playerDistance = length(fromPlayer);
          float proximity = 1.0 - smoothstep(0.0, uRippleRadius, playerDistance);
          float movementPush = clamp(uPlayerSpeed / 16.0, 0.0, 1.0);
          float shimmer = sin(uTime * 5.8 - playerDistance * 2.15 + instancePhase) * 0.5 + 0.5;
          float flowWave = movingBodyWake(fromPlayer, playerDistance, instancePhase);
          float sourceWave = 0.0;

          for (int index = 0; index < ${MAX_SHADER_RIPPLE_SOURCES}; index += 1) {
            if (index >= uRippleCount) {
              break;
            }
            vec4 ripple = uRipples[index];
            vec4 metadata = uRippleMetadata[index];
            sourceWave += rippleRing(ripple, metadata, cellPosition);
          }

          float nearLift = proximity * (0.22 + shimmer * 0.68) * (0.34 + movementPush * 0.52);
          float lift = (nearLift + sourceWave * 0.92 + flowWave * 0.82) * uRippleHeight;
          float glow = clamp(proximity * (0.04 + shimmer * 0.1) + sourceWave * 0.18 + flowWave * 0.14, 0.0, 0.38);
          float cubeHeight = ${BASE_CUBE_HEIGHT.toFixed(2)} + proximity * 0.42 + sourceWave * 0.44 + flowWave * 0.34;
          float footprint = ${CUBE_FOOTPRINT.toFixed(2)} + glow * 0.05;

          transformed.xz *= footprint;
          transformed.y = transformed.y * cubeHeight + cubeHeight * 0.5 + lift;
          vRippleGlow = glow;
          vRippleTint = mix(instanceTint, vec3(0.18, 0.82, 0.74), clamp(glow * 0.46, 0.0, 0.7));`
        );

      rippleShader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uBloomMood;
          varying float vRippleGlow;
          varying vec3 vRippleTint;`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          diffuseColor.rgb *= vRippleTint * (0.64 + vRippleGlow * 0.05);`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vRippleTint * vRippleGlow * (0.025 + uBloomMood * 0.055);`
        );
    };

    material.customProgramCacheKey = () => "ripple-field-shader-v3";
    return material;
  }

  private disposeMesh(): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry?.dispose();
    this.material?.dispose();
    this.geometry = null;
    this.material = null;
    this.instanceCount = 0;
  }
}

function createTerrainTint(x: number, y: number, z: number): THREE.Color {
  const color = new THREE.Color();
  const cool = new THREE.Color(0x143a55);
  const warm = new THREE.Color(0x2a5a6a);
  const accent = new THREE.Color(0x3958a7);
  const mix = pseudoRandom(x * 0.3 + y, z * 0.7);
  color.copy(cool).lerp(warm, 0.35 + mix * 0.35).lerp(accent, Math.max(0, y) * 0.035);
  return color;
}

function pseudoRandom(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
