import * as THREE from "three";
import type { LabSettings } from "./labSettings";
import type { QualityPreset } from "./qualityPresets";
import { MAX_SHADER_RIPPLE_SOURCES, type RippleSourceStore } from "./rippleSources";
import { sampleFieldHeight } from "./terrain";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";

const HEX_TILE_DIAMETER = 0.89;
const BASE_TILE_HEIGHT = 0.08;
const RIPPLE_WIDTH = 1.45;
const HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO = 0.75;
const HEX_FLAT_TOP_VERTICAL_SPACING_RATIO = Math.sqrt(3) * 0.5;
const HEX_AREA_RATIO = HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO * HEX_FLAT_TOP_VERTICAL_SPACING_RATIO;
const MIN_RENDERED_RIPPLE_SOURCES = 8;
const SHADER_SOURCE_EVALUATION_BUDGET = 2_400_000;

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
  private capMaterial: THREE.MeshStandardMaterial | null = null;
  private capGeometry: THREE.CylinderGeometry | null = null;
  private capShader: RippleShader | null = null;
  private instanceCount = 0;
  private renderedRippleSourceCount = 0;
  private renderedRippleSourceLimit = MAX_SHADER_RIPPLE_SOURCES;

  constructor(scene: THREE.Scene, preset: QualityPreset) {
    this.object.name = "Shader ripple hex field";
    scene.add(this.object);
    this.rebuild(preset);
  }

  rebuild(preset: QualityPreset): void {
    this.disposeMesh();
    this.capShader = null;

    const positions: number[] = [];
    const phases: number[] = [];
    const tints: number[] = [];
    const radius = preset.fieldRadius;
    const spacing = getHexHorizontalSpacing(preset);
    const rowSpacing = getHexVerticalSpacing(preset);

    this.capGeometry = createHexPrismGeometry();
    this.capMaterial = this.createCapMaterial();

    const halfColumnCount = Math.ceil(radius / spacing) + 1;
    const halfRowCount = Math.ceil(radius / rowSpacing) + 1;
    const placementRadius = radius + spacing * 0.5;
    const placementRadiusSquared = placementRadius * placementRadius;

    // The arena floor is circular, but the cells live on a flat-top hex lattice.
    // The footprint calibration below makes Meltdown read as an interlocked
    // honeycomb while preserving the old stress-test density budget.
    for (let iz = -halfRowCount; iz <= halfRowCount; iz += 1) {
      const rowOffset = Math.abs(iz % 2) === 1 ? spacing * 0.5 : 0;
      const z = iz * rowSpacing;

      for (let ix = -halfColumnCount; ix <= halfColumnCount; ix += 1) {
        const x = ix * spacing + rowOffset;
        if (x * x + z * z > placementRadiusSquared) continue;

        const y = sampleFieldHeight(x, z);
        const terrainTint = createTerrainTint(x, y, z);

        positions.push(x, y, z);
        phases.push(pseudoRandom(x, z) * Math.PI * 2);
        tints.push(terrainTint.r, terrainTint.g, terrainTint.b);
      }
    }

    this.instanceCount = positions.length / 3;
    this.capMesh = new THREE.InstancedMesh(this.capGeometry, this.capMaterial, this.instanceCount);
    this.capMesh.name = `${preset.label} ripple hex caps`;
    this.capMesh.frustumCulled = false;
    this.capMesh.castShadow = preset.shadowMapSize > 0;
    this.capMesh.receiveShadow = true;
    this.capMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.capMesh.renderOrder = 1;

    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.instanceCount; index += 1) {
      const offset = index * 3;
      matrix.makeTranslation(positions[offset], positions[offset + 1], positions[offset + 2]);
      this.capMesh.setMatrixAt(index, matrix);
    }

    // These per-instance attributes let the shader know where each hex cell
    // lives without touching instance matrices every frame. Keeping only the
    // cap surface makes the upcoming curved/spherical arena path much less
    // tangled than the old cap-plus-shaft pair.
    setInstanceAttributes(this.capGeometry, positions, phases, tints);

    this.object.add(this.capMesh);
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
    if (!this.capShader) return;

    const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
    const sourceLimit = getRenderedRippleSourceLimit(this.instanceCount);
    const activeCount = sources.writeUniforms(
      this.rippleUniforms,
      this.rippleMetadataUniforms,
      this.rippleLifetimeUniforms,
      time,
      sourceLimit
    );
    this.renderedRippleSourceCount = activeCount;
    this.renderedRippleSourceLimit = sourceLimit;
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
  }

  getInstanceCount(): number {
    return this.instanceCount;
  }

  getRenderedRippleSourceCount(): number {
    return this.renderedRippleSourceCount;
  }

  getRenderedRippleSourceLimit(): number {
    return this.renderedRippleSourceLimit;
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
          // Keep the depression modest so the avatar disturbs the field without
          // looking like it is being swallowed by the surrounding hexes. The
          // current pressure depth is intentionally half of the previous tune.
          float pressureDepression = bodyPressure * (0.35 + shimmer * 0.09 + movementPush * 0.115);
          float rimLift = pressureRim * (0.16 + shimmer * 0.14 + movementPush * 0.1);
          float shelteredSourceWave = sourceWave * (1.0 - bodyPressure * 0.44);
          // Crest glow is separate from generic ripple glow so only raised wave
          // fronts bloom. This avoids globally brightening the whole field when
          // multiple sources overlap.
          float crestGlow = clamp(max(shelteredSourceWave, 0.0) * 1.18 + max(flowWave, 0.0) * 0.34, 0.0, 0.9);
          float lift = (-pressureDepression + rimLift + shelteredSourceWave * 0.92 + flowWave * 0.58) * uRippleHeight;
          float glow = clamp(proximity * (0.04 + shimmer * 0.08) + pressureRim * 0.08 + shelteredSourceWave * 0.2 + flowWave * 0.1, 0.0, 0.46);
          float voxelScale = clamp(uVoxelSize, 0.25, 2.0);
          float tileHeight = max(0.02, (${BASE_TILE_HEIGHT.toFixed(2)} + pressureRim * 0.16 + shelteredSourceWave * 0.44 + flowWave * 0.22 - bodyPressure * 0.009) * voxelScale);
          float footprint = (${HEX_TILE_DIAMETER.toFixed(2)} + glow * 0.05) * voxelScale;
          float visualHeight = instanceFieldPosition.y + lift + tileHeight;
          float heightWhiteness = smoothstep(-0.75, 3.05, visualHeight);

          transformed.xz *= footprint;
          transformed.y = transformed.y * tileHeight + tileHeight * 0.5 + lift;
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

    material.customProgramCacheKey = () => "ripple-field-hex-cap-shader-v1";
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
    shader.uniforms.uBloomMood.value = settings.bloomEnabled ? Math.max(settings.bloomStrength, preset.bloomStrength) : 0;
    shader.uniforms.uRippleCount.value = activeCount;
  }

  private disposeMesh(): void {
    if (this.capMesh) {
      this.object.remove(this.capMesh);
      this.capMesh.dispose();
      this.capMesh = null;
    }
    this.capGeometry?.dispose();
    this.capMaterial?.dispose();
    this.capGeometry = null;
    this.capMaterial = null;
    this.capShader = null;
    this.instanceCount = 0;
    this.renderedRippleSourceCount = 0;
    this.renderedRippleSourceLimit = MAX_SHADER_RIPPLE_SOURCES;
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

function createHexPrismGeometry(): THREE.CylinderGeometry {
  // CylinderGeometry with six radial segments gives us a real hexagonal prism.
  // The radius is 0.5 so shader-side footprint scaling treats `1.0` as the
  // full point-to-point diameter, matching the user's "widest point" size rule.
  // `thetaStart = 0` rotates each hex so its shared edges face the staggered
  // neighbor directions. With the flat-top lattice below, Meltdown now reads as
  // one interlocking honeycomb instead of offset individual badges.
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false, 0);
  return geometry;
}

function getHexHorizontalSpacing(preset: QualityPreset): number {
  return getHexPlacementDiameter(preset) * HEX_FLAT_TOP_HORIZONTAL_SPACING_RATIO;
}

function getHexVerticalSpacing(preset: QualityPreset): number {
  return getHexPlacementDiameter(preset) * HEX_FLAT_TOP_VERTICAL_SPACING_RATIO;
}

function getHexPlacementDiameter(preset: QualityPreset): number {
  // Before the hex conversion, `tileSpacing` roughly meant one cell's area in
  // the placement grid. Preserve that density by solving for the flat-top hex
  // diameter that gives the same center-cell area. `HEX_TILE_DIAMETER` is then
  // calibrated so Meltdown's visual footprint nearly equals this placement
  // diameter, producing an interlocking honeycomb without inflating the old
  // instance count.
  return preset.tileSpacing / Math.sqrt(HEX_AREA_RATIO);
}

function getRenderedRippleSourceLimit(instanceCount: number): number {
  // Ripple source evaluation runs once per rendered hex cap. At 25cm voxels a
  // single arena can have hundreds of thousands of caps, so keeping all 32 wave
  // sources visible turns each frame into millions of shader evaluations. This
  // keeps the newest sources visible while density is extreme, without deleting
  // older gameplay sources before their lifetimes finish.
  const densityLimit = Math.floor(SHADER_SOURCE_EVALUATION_BUDGET / Math.max(1, instanceCount));
  return THREE.MathUtils.clamp(densityLimit, MIN_RENDERED_RIPPLE_SOURCES, MAX_SHADER_RIPPLE_SOURCES);
}

function setInstanceAttributes(
  geometry: THREE.BufferGeometry,
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
