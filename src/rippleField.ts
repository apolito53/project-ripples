import * as THREE from "three";
import type { LabSettings } from "./labSettings";
import type { QualityPreset } from "./qualityPresets";
import { MAX_SHADER_RIPPLE_SOURCES, type RippleSourceStore } from "./rippleSources";
import { sampleFieldHeight } from "./terrain";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";

const CUBE_FOOTPRINT = 0.68;
const BASE_CUBE_HEIGHT = 0.08;
const RIPPLE_WIDTH = 1.45;
const MIN_COLUMN_HEIGHT = 0.05;
const MAX_COLUMN_DEPTH = 2.55;
const COLUMN_FOOTPRINT_SCALE = 1;

// The stage floor is still the visual darkness the columns sink toward. The
// shafts are depth-limited for performance, then graded to black so their lower
// ends do not read as weird hard cutoffs.
export const FIELD_COLUMN_BASE_Y = -3.2;

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
  readonly uVoxelSize: Uniform<number>;
  readonly uBasePropagationSpeed: Uniform<number>;
  readonly uMediumDamping: Uniform<number>;
  readonly uMediumDispersion: Uniform<number>;
  readonly uBloomMood: Uniform<number>;
  readonly uRippleCount: Uniform<number>;
  readonly uRipples: Uniform<THREE.Vector4[]>;
  readonly uRippleMetadata: Uniform<THREE.Vector4[]>;
  readonly uRippleLifetimes: Uniform<Float32Array>;
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
  private readonly rippleLifetimeUniforms = new Float32Array(MAX_SHADER_RIPPLE_SOURCES);
  private capMesh: THREE.InstancedMesh | null = null;
  private columnMesh: THREE.InstancedMesh | null = null;
  private capMaterial: THREE.MeshStandardMaterial | null = null;
  private columnMaterial: THREE.MeshLambertMaterial | null = null;
  private capGeometry: THREE.BoxGeometry | null = null;
  private columnGeometry: THREE.BoxGeometry | null = null;
  private capShader: RippleShader | null = null;
  private columnShader: RippleShader | null = null;
  private instanceCount = 0;

  constructor(scene: THREE.Scene, preset: QualityPreset) {
    this.object.name = "Shader ripple voxel field";
    scene.add(this.object);
    this.rebuild(preset);
  }

  rebuild(preset: QualityPreset): void {
    this.disposeMesh();
    this.capShader = null;
    this.columnShader = null;

    const positions: number[] = [];
    const phases: number[] = [];
    const tints: number[] = [];
    const radius = preset.fieldRadius;
    const spacing = preset.cubeSpacing;

    this.capGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    this.columnGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    this.capMaterial = this.createCapMaterial();
    this.columnMaterial = this.createColumnMaterial();

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
    this.columnMesh = new THREE.InstancedMesh(this.columnGeometry, this.columnMaterial, this.instanceCount);
    this.columnMesh.name = `${preset.label} ripple column shafts`;
    this.columnMesh.frustumCulled = false;
    this.columnMesh.castShadow = false;
    this.columnMesh.receiveShadow = false;
    this.columnMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.columnMesh.renderOrder = 0;

    this.capMesh = new THREE.InstancedMesh(this.capGeometry, this.capMaterial, this.instanceCount);
    this.capMesh.name = `${preset.label} ripple cube caps`;
    this.capMesh.frustumCulled = false;
    this.capMesh.castShadow = preset.shadowMapSize > 0;
    this.capMesh.receiveShadow = true;
    this.capMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.capMesh.renderOrder = 1;

    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.instanceCount; index += 1) {
      const offset = index * 3;
      matrix.makeTranslation(positions[offset], positions[offset + 1], positions[offset + 2]);
      this.columnMesh.setMatrixAt(index, matrix);
      this.capMesh.setMatrixAt(index, matrix);
    }

    // These per-instance attributes let the shader know where each cube lives
    // without touching instance matrices every frame. That keeps the ripple
    // effect GPU-side and leaves the CPU free to merely update a few uniforms.
    setInstanceAttributes(this.capGeometry, positions, phases, tints);
    setInstanceAttributes(this.columnGeometry, positions, phases, tints);

    // Draw the cheap shafts first, then the polished caps. The caps keep PBR,
    // shadows, and the strongest sparkle response; the shafts use Lambert
    // lighting without shadows so they match the scene color without paying the
    // original full-column MeshStandard cost.
    this.object.add(this.columnMesh, this.capMesh);
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
    if (!this.capShader && !this.columnShader) return;

    const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
    const activeCount = sources.writeUniforms(
      this.rippleUniforms,
      this.rippleMetadataUniforms,
      this.rippleLifetimeUniforms,
      time
    );
    this.writeShaderUniforms(
      this.capShader,
      time,
      settings,
      preset,
      playerPosition,
      playerVelocity,
      playerSpeed,
      basePropagationSpeed,
      activeCount
    );
    this.writeShaderUniforms(
      this.columnShader,
      time,
      settings,
      preset,
      playerPosition,
      playerVelocity,
      playerSpeed,
      basePropagationSpeed,
      activeCount
    );
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  dispose(): void {
    this.disposeMesh();
    this.object.removeFromParent();
  }

  private createCapMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.22,
      roughness: 0.32,
      emissive: 0x06131d,
      emissiveIntensity: 0.28
    });

    material.onBeforeCompile = (shader) => {
      const rippleShader = shader as unknown as RippleShader;
      this.capShader = rippleShader;
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uPlayerPosition = { value: new THREE.Vector3() };
      shader.uniforms.uPlayerVelocity = { value: new THREE.Vector2() };
      shader.uniforms.uPlayerSpeed = { value: 0 };
      shader.uniforms.uRippleHeight = { value: 1.25 };
      shader.uniforms.uRippleRadius = { value: 9 };
      shader.uniforms.uVoxelSize = { value: 1 };
      shader.uniforms.uBasePropagationSpeed = { value: 9 };
      shader.uniforms.uMediumDamping = { value: 0.16 };
      shader.uniforms.uMediumDispersion = { value: 0.22 };
      shader.uniforms.uBloomMood = { value: 1 };
      shader.uniforms.uRippleCount = { value: 0 };
      shader.uniforms.uRipples = { value: this.rippleUniforms };
      shader.uniforms.uRippleMetadata = { value: this.rippleMetadataUniforms };
      shader.uniforms.uRippleLifetimes = { value: this.rippleLifetimeUniforms };

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
          uniform float uVoxelSize;
          uniform float uBasePropagationSpeed;
          uniform float uMediumDamping;
          uniform float uMediumDispersion;
          uniform float uBloomMood;
          uniform int uRippleCount;
          uniform vec4 uRipples[${MAX_SHADER_RIPPLE_SOURCES}];
          uniform vec4 uRippleMetadata[${MAX_SHADER_RIPPLE_SOURCES}];
          uniform float uRippleLifetimes[${MAX_SHADER_RIPPLE_SOURCES}];
          attribute vec3 instanceFieldPosition;
          attribute float instancePhase;
          attribute vec3 instanceTint;
          varying float vRippleGlow;
          varying float vCrestGlow;
          varying float vHeightWhiteness;
          varying vec3 vRippleTint;

          float rippleRing(vec4 ripple, vec4 metadata, float lifetime, vec2 cellPosition) {
            vec2 origin = ripple.xy;
            float startTime = ripple.z;
            float strength = ripple.w;
            float age = max(0.0, uTime - startTime);
            float fadeLifetime = max(0.2, lifetime);
            float propagationSpeed = uBasePropagationSpeed * max(0.05, metadata.x);
            float distanceToCell = distance(origin, cellPosition);
            float front = age * propagationSpeed;
            float width = ${RIPPLE_WIDTH.toFixed(2)} * max(0.2, metadata.y) +
              age * uMediumDispersion * 0.16;
            float ring = exp(-pow((distanceToCell - front) / max(0.12, width), 2.0));
            float fade = max(0.0, 1.0 - age / fadeLifetime);
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

            // Treat the avatar like a small hull, but keep this response local.
            // Lingering wake belongs to emitted source stamps; if the immediate
            // field stretches too far, it rotates with velocity and reads like a
            // flashlight beam instead of water/fabric that was disturbed.
            float bowBand = exp(-pow((distanceToPlayer - 1.75) / 1.05, 2.0));
            float bow = smoothstep(0.12, 0.94, ahead) * bowBand;
            float behind = smoothstep(0.08, 0.92, -ahead);
            float localStern = exp(-pow(distanceToPlayer / 2.65, 2.0)) *
              exp(-pow(sideways * 2.45, 2.0));
            float shoulderWake = exp(-pow((sideways - 0.54) / 0.16, 2.0)) *
              exp(-pow((distanceToPlayer - 2.0) / 1.25, 2.0));
            float texture = 0.62 + 0.38 * sin(uTime * 7.1 - distanceToPlayer * 3.2 + phase);

            return moving * (bow * 0.34 + behind * texture * (localStern * 0.18 + shoulderWake * 0.28));
          }`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
          vec2 cellPosition = instanceFieldPosition.xz;
          vec2 fromPlayer = cellPosition - uPlayerPosition.xz;
          float playerDistance = length(fromPlayer);
          float proximity = 1.0 - smoothstep(0.0, uRippleRadius, playerDistance);
          float bodyPressure = 1.0 - smoothstep(0.15, 2.55, playerDistance);
          float pressureRim = exp(-pow((playerDistance - 2.35) / 0.9, 2.0));
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
            float lifetime = uRippleLifetimes[index];
            sourceWave += rippleRing(ripple, metadata, lifetime, cellPosition);
          }

          // The player presses into the field now. The center becomes a trough,
          // while a small rim and movement wake keep the surface feeling like a
          // responsive fabric instead of a flat hole punched through the grid.
          float pressureDepression = bodyPressure * (0.82 + shimmer * 0.22 + movementPush * 0.28);
          float rimLift = pressureRim * (0.16 + shimmer * 0.14 + movementPush * 0.1);
          float shelteredSourceWave = sourceWave * (1.0 - bodyPressure * 0.5);
          // Crest glow is separate from generic ripple glow so only raised wave
          // fronts bloom. This avoids globally brightening the whole field when
          // multiple sources overlap.
          float crestGlow = clamp(max(shelteredSourceWave, 0.0) * 1.18 + max(flowWave, 0.0) * 0.34, 0.0, 0.9);
          float lift = (-pressureDepression + rimLift + shelteredSourceWave * 0.92 + flowWave * 0.58) * uRippleHeight;
          float glow = clamp(proximity * (0.04 + shimmer * 0.08) + pressureRim * 0.08 + shelteredSourceWave * 0.2 + flowWave * 0.1, 0.0, 0.46);
          float voxelScale = clamp(uVoxelSize, 0.25, 2.0);
          float cubeHeight = max(0.02, (${BASE_CUBE_HEIGHT.toFixed(2)} + pressureRim * 0.16 + shelteredSourceWave * 0.44 + flowWave * 0.22 - bodyPressure * 0.025) * voxelScale);
          float footprint = (${CUBE_FOOTPRINT.toFixed(2)} + glow * 0.05) * voxelScale;
          float visualHeight = instanceFieldPosition.y + lift + cubeHeight;
          float heightWhiteness = smoothstep(-0.75, 3.05, visualHeight);

          transformed.xz *= footprint;
          transformed.y = transformed.y * cubeHeight + cubeHeight * 0.5 + lift;
          vRippleGlow = glow;
          vCrestGlow = crestGlow;
          vHeightWhiteness = heightWhiteness;

          // Height color is driven from the animated shader height, not only the
          // baked terrain height. Ripples and the player rim can therefore flash
          // toward white as they rise, while troughs stay darker and colder.
          vec3 rippleTint = mix(instanceTint, vec3(0.18, 0.82, 0.74), clamp(glow * 0.46, 0.0, 0.7));
          vec3 shadedLowTint = rippleTint * (0.58 + heightWhiteness * 0.34);
          vRippleTint = mix(
            shadedLowTint,
            vec3(0.94, 0.985, 1.0),
            clamp(heightWhiteness * (0.34 + glow * 0.32), 0.0, 0.76)
          );
          vRippleTint = mix(vRippleTint, vec3(0.76, 1.0, 0.92), crestGlow * 0.3);`
        );

      rippleShader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uBloomMood;
          varying float vRippleGlow;
          varying float vCrestGlow;
          varying float vHeightWhiteness;
          varying vec3 vRippleTint;`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          diffuseColor.rgb *= vRippleTint * (0.62 + vRippleGlow * 0.05 + vHeightWhiteness * 0.07 + vCrestGlow * 0.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 1.0, 0.94), vCrestGlow * 0.26);`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          vec3 crestLight = mix(vRippleTint, vec3(0.7, 1.0, 0.9), 0.55);
          totalEmissiveRadiance += vRippleTint * vRippleGlow * (0.025 + uBloomMood * 0.055);
          totalEmissiveRadiance += crestLight * vCrestGlow * (0.12 + uBloomMood * 0.32);`
        );
    };

    material.customProgramCacheKey = () => "ripple-field-cap-shader-v12";
    return material;
  }

  private createColumnMaterial(): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x01070b
    });

    material.onBeforeCompile = (shader) => {
      const rippleShader = shader as unknown as RippleShader;
      this.columnShader = rippleShader;
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uPlayerPosition = { value: new THREE.Vector3() };
      shader.uniforms.uPlayerVelocity = { value: new THREE.Vector2() };
      shader.uniforms.uPlayerSpeed = { value: 0 };
      shader.uniforms.uRippleHeight = { value: 1.25 };
      shader.uniforms.uRippleRadius = { value: 9 };
      shader.uniforms.uVoxelSize = { value: 1 };
      shader.uniforms.uBasePropagationSpeed = { value: 9 };
      shader.uniforms.uMediumDamping = { value: 0.16 };
      shader.uniforms.uMediumDispersion = { value: 0.22 };
      shader.uniforms.uBloomMood = { value: 1 };
      shader.uniforms.uRippleCount = { value: 0 };
      shader.uniforms.uRipples = { value: this.rippleUniforms };
      shader.uniforms.uRippleMetadata = { value: this.rippleMetadataUniforms };
      shader.uniforms.uRippleLifetimes = { value: this.rippleLifetimeUniforms };

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
          uniform float uVoxelSize;
          uniform float uBasePropagationSpeed;
          uniform float uMediumDamping;
          uniform float uMediumDispersion;
          uniform int uRippleCount;
          uniform vec4 uRipples[${MAX_SHADER_RIPPLE_SOURCES}];
          uniform vec4 uRippleMetadata[${MAX_SHADER_RIPPLE_SOURCES}];
          uniform float uRippleLifetimes[${MAX_SHADER_RIPPLE_SOURCES}];
          attribute vec3 instanceFieldPosition;
          attribute float instancePhase;
          attribute vec3 instanceTint;
          varying vec3 vColumnTint;
          varying float vColumnDepth;
          varying float vColumnCrestGlow;

          float rippleRing(vec4 ripple, vec4 metadata, float lifetime, vec2 cellPosition) {
            vec2 origin = ripple.xy;
            float startTime = ripple.z;
            float strength = ripple.w;
            float age = max(0.0, uTime - startTime);
            float fadeLifetime = max(0.2, lifetime);
            float propagationSpeed = uBasePropagationSpeed * max(0.05, metadata.x);
            float distanceToCell = distance(origin, cellPosition);
            float front = age * propagationSpeed;
            float width = ${RIPPLE_WIDTH.toFixed(2)} * max(0.2, metadata.y) +
              age * uMediumDispersion * 0.16;
            float ring = exp(-pow((distanceToCell - front) / max(0.12, width), 2.0));
            float fade = max(0.0, 1.0 - age / fadeLifetime);
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
            float bowBand = exp(-pow((distanceToPlayer - 1.75) / 1.05, 2.0));
            float bow = smoothstep(0.12, 0.94, ahead) * bowBand;
            float behind = smoothstep(0.08, 0.92, -ahead);
            float localStern = exp(-pow(distanceToPlayer / 2.65, 2.0)) *
              exp(-pow(sideways * 2.45, 2.0));
            float shoulderWake = exp(-pow((sideways - 0.54) / 0.16, 2.0)) *
              exp(-pow((distanceToPlayer - 2.0) / 1.25, 2.0));
            float texture = 0.62 + 0.38 * sin(uTime * 7.1 - distanceToPlayer * 3.2 + phase);

            return moving * (bow * 0.34 + behind * texture * (localStern * 0.18 + shoulderWake * 0.28));
          }`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
          vec2 cellPosition = instanceFieldPosition.xz;
          vec2 fromPlayer = cellPosition - uPlayerPosition.xz;
          float playerDistance = length(fromPlayer);
          float proximity = 1.0 - smoothstep(0.0, uRippleRadius, playerDistance);
          float bodyPressure = 1.0 - smoothstep(0.15, 2.55, playerDistance);
          float pressureRim = exp(-pow((playerDistance - 2.35) / 0.9, 2.0));
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
            float lifetime = uRippleLifetimes[index];
            sourceWave += rippleRing(ripple, metadata, lifetime, cellPosition);
          }

          float pressureDepression = bodyPressure * (0.82 + shimmer * 0.22 + movementPush * 0.28);
          float rimLift = pressureRim * (0.16 + shimmer * 0.14 + movementPush * 0.1);
          float shelteredSourceWave = sourceWave * (1.0 - bodyPressure * 0.5);
          // The column shafts inherit only the top-heavy part of the crest glow.
          // Bases stay dark, while the cap/shaft join can shimmer with the wave.
          float crestGlow = clamp(max(shelteredSourceWave, 0.0) * 0.92 + max(flowWave, 0.0) * 0.24, 0.0, 0.85);
          float lift = (-pressureDepression + rimLift + shelteredSourceWave * 0.92 + flowWave * 0.58) * uRippleHeight;
          float glow = clamp(proximity * (0.04 + shimmer * 0.08) + pressureRim * 0.08 + shelteredSourceWave * 0.2 + flowWave * 0.1, 0.0, 0.46);
          float voxelScale = clamp(uVoxelSize, 0.25, 2.0);
          float capHeight = max(0.02, (${BASE_CUBE_HEIGHT.toFixed(2)} + pressureRim * 0.16 + shelteredSourceWave * 0.44 + flowWave * 0.22 - bodyPressure * 0.025) * voxelScale);
          float footprint = (${CUBE_FOOTPRINT.toFixed(2)} + glow * 0.05) * voxelScale * ${COLUMN_FOOTPRINT_SCALE.toFixed(2)};
          float visualHeight = instanceFieldPosition.y + lift + capHeight;
          float heightWhiteness = smoothstep(-0.75, 3.05, visualHeight);
          float floorBaseLocal = ${FIELD_COLUMN_BASE_Y.toFixed(2)} - instanceFieldPosition.y;
          float floorLimitedDepth = max(${MIN_COLUMN_HEIGHT.toFixed(2)} * voxelScale, lift - floorBaseLocal);
          float depthBudget = (${MAX_COLUMN_DEPTH.toFixed(2)} + heightWhiteness * 1.15 + glow * 0.65) * voxelScale;
          float columnHeight = max(${MIN_COLUMN_HEIGHT.toFixed(2)} * voxelScale, min(floorLimitedDepth, depthBudget));
          float columnTopLocal = lift;
          float columnBaseLocal = columnTopLocal - columnHeight;
          float column01 = position.y + 0.5;

          transformed.xz *= footprint;
          transformed.y = columnBaseLocal + column01 * columnHeight;

          // The shafts now use the same lit material family as the caps, but
          // without shadows or PBR. The top inherits cap tint; the bottom fades
          // to a darker version of that same hue instead of becoming white.
          float topInfluence = smoothstep(0.16, 0.96, column01);
          float baseMist = smoothstep(0.0, 0.24, column01);
          vec3 rippleTint = mix(instanceTint, vec3(0.18, 0.82, 0.74), clamp(glow * 0.46, 0.0, 0.7));
          vec3 capTint = mix(
            rippleTint,
            vec3(0.94, 0.985, 1.0),
            clamp(heightWhiteness * (0.34 + glow * 0.32), 0.0, 0.76)
          );
          capTint = mix(capTint, vec3(0.76, 1.0, 0.92), crestGlow * 0.24);
          vec3 darkRoot = capTint * 0.16;
          vec3 topTint = capTint * (0.72 + crestGlow * 0.2);
          vColumnTint = mix(darkRoot, topTint, topInfluence) * (0.52 + glow * 0.32 + baseMist * 0.16 + crestGlow * topInfluence * 0.16);
          vColumnDepth = baseMist * (0.34 + topInfluence * 0.66);
          vColumnCrestGlow = crestGlow * topInfluence;`
        );

      rippleShader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vColumnTint;
          varying float vColumnDepth;
          varying float vColumnCrestGlow;`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          diffuseColor.rgb = mix(vec3(0.002, 0.006, 0.012), vColumnTint, vColumnDepth);`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vColumnTint * vColumnDepth * (0.035 + vColumnCrestGlow * 0.13);`
        );
    };

    material.customProgramCacheKey = () => "ripple-field-column-shafts-v13";
    return material;
  }

  private writeShaderUniforms(
    shader: RippleShader | null,
    time: number,
    settings: LabSettings,
    preset: QualityPreset,
    playerPosition: THREE.Vector3,
    playerVelocity: THREE.Vector3,
    playerSpeed: number,
    basePropagationSpeed: number,
    activeCount: number
  ): void {
    if (!shader) return;

    shader.uniforms.uTime.value = time;
    shader.uniforms.uPlayerPosition.value.copy(playerPosition);
    shader.uniforms.uPlayerVelocity.value.set(playerVelocity.x, playerVelocity.z);
    shader.uniforms.uPlayerSpeed.value = playerSpeed;
    shader.uniforms.uRippleHeight.value = settings.rippleHeight;
    shader.uniforms.uRippleRadius.value = settings.rippleRadius;
    shader.uniforms.uVoxelSize.value = settings.voxelSizeMeters;
    shader.uniforms.uBasePropagationSpeed.value = basePropagationSpeed;
    shader.uniforms.uMediumDamping.value = settings.waveMedium.damping;
    shader.uniforms.uMediumDispersion.value = settings.waveMedium.dispersion;
    shader.uniforms.uBloomMood.value = Math.max(settings.bloomStrength, preset.bloomStrength);
    shader.uniforms.uRippleCount.value = activeCount;
  }

  private disposeMesh(): void {
    if (this.capMesh) {
      this.object.remove(this.capMesh);
      this.capMesh.dispose();
      this.capMesh = null;
    }
    if (this.columnMesh) {
      this.object.remove(this.columnMesh);
      this.columnMesh.dispose();
      this.columnMesh = null;
    }
    this.capGeometry?.dispose();
    this.columnGeometry?.dispose();
    this.capMaterial?.dispose();
    this.columnMaterial?.dispose();
    this.capGeometry = null;
    this.columnGeometry = null;
    this.capMaterial = null;
    this.columnMaterial = null;
    this.capShader = null;
    this.columnShader = null;
    this.instanceCount = 0;
  }
}

function createTerrainTint(x: number, y: number, z: number): THREE.Color {
  const color = new THREE.Color();
  const cool = new THREE.Color(0x143a55);
  const warm = new THREE.Color(0x2a5a6a);
  const accent = new THREE.Color(0x3958a7);
  const high = new THREE.Color(0xd8fbff);
  const mix = pseudoRandom(x * 0.3 + y, z * 0.7);
  const terrainWhiteness = smoothstep(-1.35, 1.95, y) * 0.24;

  // The shader handles animated height whitening every frame. This baked tint
  // gives the still terrain the same language before any waves pass through it.
  color.copy(cool)
    .lerp(warm, 0.35 + mix * 0.35)
    .lerp(accent, Math.max(0, y) * 0.035)
    .lerp(high, terrainWhiteness);
  return color;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function setInstanceAttributes(
  geometry: THREE.BoxGeometry,
  positions: number[],
  phases: number[],
  tints: number[]
): void {
  geometry.setAttribute(
    "instanceFieldPosition",
    new THREE.InstancedBufferAttribute(new Float32Array(positions), 3)
  );
  geometry.setAttribute(
    "instancePhase",
    new THREE.InstancedBufferAttribute(new Float32Array(phases), 1)
  );
  geometry.setAttribute(
    "instanceTint",
    new THREE.InstancedBufferAttribute(new Float32Array(tints), 3)
  );
}

function pseudoRandom(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
