import * as THREE from "three";
import { debugEvent, debugMeasure, roundMetric, vectorPayload } from "./debugLog";

export type EchoZoneOptions = {
  readonly radius: number;
  readonly triggerRadius: number;
  readonly burstStrength: number;
  readonly discBurstRadius: number;
};

export type TriggeredEchoZone = {
  readonly position: THREE.Vector3;
  readonly burstStrength: number;
  readonly discBurstRadius: number;
};

type EchoZoneVisual = EchoZoneOptions & {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly spawnTime: number;
  readonly phase: number;
  readonly columnRadius: number;
  readonly object: THREE.Group;
  readonly core: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly orbShell: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  readonly orbMist: THREE.Mesh<THREE.OctahedronGeometry, THREE.ShaderMaterial>;
  readonly columnLights: readonly THREE.PointLight[];
  readonly sparkles: EchoOrbitSparkles;
};

type EchoOrbitSparkles = {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly trails: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly positions: Float32Array;
  readonly alphas: Float32Array;
  readonly sizes: Float32Array;
  readonly trailPositions: Float32Array;
  readonly trailColors: Float32Array;
  readonly baseColors: Float32Array;
  readonly baseAngles: Float32Array;
  readonly radii: Float32Array;
  readonly heights: Float32Array;
  readonly speeds: Float32Array;
  readonly phases: Float32Array;
  readonly verticalRadii: Float32Array;
  readonly tilts: Float32Array;
};

type EchoCollectBurst = {
  readonly spawnTime: number;
  readonly columnRadius: number;
  readonly baseRotation: number;
  readonly object: THREE.Group;
  readonly flare: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly mist: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly shards: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly shardPositions: Float32Array;
  readonly shardVelocities: Float32Array;
  readonly shardAlphas: Float32Array;
  readonly shardBaseAlphas: Float32Array;
  readonly shardSizes: Float32Array;
  readonly shardBaseSizes: Float32Array;
  readonly burstLight: THREE.PointLight;
};

type EchoCollectBurstShards = {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly alphas: Float32Array;
  readonly baseAlphas: Float32Array;
  readonly sizes: Float32Array;
  readonly baseSizes: Float32Array;
};

const BEAM_LIGHT_COLOR = 0x67ffe0;
const VIOLET_COLOR = 0x95a7ff;
const CORE_COLOR = 0xffd36a;
const ORB_LIGHT_COLOR = 0xffe08a;
const ORB_SHELL_COLOR = 0xfff2c6;
const MOTE_COLOR = 0x7dffd8;
const COLUMN_HEIGHT = 7.4;
const COLUMN_BASE_LIFT = 1.45;
const ECHO_ORBIT_MOTE_COUNT = 44;
const ECHO_ORBIT_TRAIL_SEGMENTS = 5;
const ECHO_ORBIT_TRAIL_SECONDS = 0.42;
const COLLECT_BURST_MOTE_COUNT = 220;
const COLLECT_BURST_DURATION = 0.88;
const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(MOTE_COLOR);
const VIOLET = new THREE.Color(VIOLET_COLOR);
const GOLD = new THREE.Color(CORE_COLOR);

export class EchoZoneField {
  private readonly scene: THREE.Scene;
  private readonly coreGeometry = new THREE.IcosahedronGeometry(0.42, 2);
  private readonly diamondGeometry = new THREE.OctahedronGeometry(1, 1);
  private readonly mistGeometry = new THREE.SphereGeometry(1, 32, 20);
  private readonly zones: EchoZoneVisual[] = [];
  private readonly collectBursts: EchoCollectBurst[] = [];
  private lastBurstSlowFrameLogAt = -Infinity;
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  add(position: THREE.Vector3, startTime: number, options: EchoZoneOptions): void {
    const object = new THREE.Group();
    object.name = `Echo zone ${this.nextId}`;
    object.position.copy(position);
    const columnRadius = Math.max(0.85, options.radius * 0.34);

    const core = new THREE.Mesh(
      this.coreGeometry,
      new THREE.MeshBasicMaterial({
        color: ORB_LIGHT_COLOR,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    core.name = "Echo bright inner orb";
    core.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;
    core.renderOrder = 3;
    object.add(core);

    const orbShell = new THREE.Mesh(
      this.diamondGeometry,
      new THREE.MeshBasicMaterial({
        color: ORB_SHELL_COLOR,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    orbShell.name = "Echo elongated diamond glow shell";
    orbShell.position.y = core.position.y;
    // The old horizontal halo read like a UI target. This faceted, stretched
    // shell keeps the collectible obvious while pushing the silhouette toward
    // a floating diamond of light around the core.
    orbShell.scale.set(columnRadius * 0.62, columnRadius * 2.95, columnRadius * 0.62);
    orbShell.renderOrder = 4;
    object.add(orbShell);

    const orbMist = new THREE.Mesh(this.diamondGeometry, createOrbMistMaterial());
    orbMist.name = "Echo vertical diamond mist";
    orbMist.position.y = core.position.y;
    orbMist.renderOrder = 2;
    // Still a fake volume, just a taller faceted one: a single additive shell
    // gives the orb a cloud of light without expensive volumetric raymarching.
    orbMist.scale.set(columnRadius * 0.95, columnRadius * 3.75, columnRadius * 0.95);
    object.add(orbMist);

    const columnLights = createColumnLights();
    for (const light of columnLights) {
      object.add(light);
    }

    const sparkles = createOrbitSparkles(columnRadius, COLUMN_HEIGHT, COLUMN_BASE_LIFT);
    object.add(sparkles.points, sparkles.trails);

    this.scene.add(object);
    this.zones.push({
      ...options,
      id: this.nextId,
      position: position.clone(),
      spawnTime: startTime,
      // Every zone breathes slightly out of phase so a cluster feels alive
      // instead of looking like one copied object blinking in sync.
      phase: Math.random() * Math.PI * 2,
      columnRadius,
      object,
      core,
      orbShell,
      orbMist,
      columnLights,
      sparkles
    });
    this.nextId += 1;
  }

  update(time: number): void {
    for (const zone of this.zones) {
      const age = time - zone.spawnTime;
      const pulse = Math.sin(age * 2.4 + zone.phase) * 0.5 + 0.5;
      const slowSpin = age * 0.45 + zone.phase;

      // The marker is now light-first instead of ring-first: the actual column
      // glow comes from point lights and the faceted diamond shell, with no
      // horizontal target circles fighting the aesthetic.
      zone.object.position.y = zone.position.y + Math.sin(age * 3 + zone.phase) * 0.045;
      zone.object.rotation.y = slowSpin * 0.2;
      zone.core.scale.setScalar(0.86 + pulse * 0.34);
      zone.orbShell.rotation.y = -slowSpin * 0.55;
      zone.orbShell.rotation.z = Math.sin(age * 0.9 + zone.phase) * 0.08;
      zone.orbShell.scale.set(
        zone.columnRadius * (0.54 + pulse * 0.18),
        zone.columnRadius * (2.75 + pulse * 0.7),
        zone.columnRadius * (0.54 + pulse * 0.18)
      );
      zone.orbMist.rotation.y = -slowSpin * 0.42;
      zone.orbMist.rotation.x = Math.sin(age * 0.55 + zone.phase) * 0.07;
      zone.orbMist.scale.set(
        zone.columnRadius * (0.9 + pulse * 0.22),
        zone.columnRadius * (3.45 + pulse * 0.78),
        zone.columnRadius * (0.9 + pulse * 0.22)
      );
      zone.core.material.opacity = 0.78 + pulse * 0.2;
      zone.orbShell.material.opacity = 0.13 + pulse * 0.24;
      zone.orbMist.material.uniforms.uTime.value = age + zone.phase;
      zone.orbMist.material.uniforms.uPulse.value = pulse;
      zone.orbMist.material.uniforms.uOpacity.value = 0.28 + pulse * 0.22;

      updateColumnLights(zone.columnLights, pulse);
      updateOrbitSparkles(zone.sparkles, age, pulse);
    }

    this.updateCollectBursts(time);
  }

  collectAt(playerPosition: THREE.Vector3, time: number): TriggeredEchoZone[] {
    const triggered: TriggeredEchoZone[] = [];

    for (let index = this.zones.length - 1; index >= 0; index -= 1) {
      const zone = this.zones[index];
      const distance = Math.hypot(playerPosition.x - zone.position.x, playerPosition.z - zone.position.z);
      if (distance > zone.triggerRadius) continue;

      debugEvent("echo.collect", "Echo zone entered trigger radius", {
        id: zone.id,
        time: roundMetric(time),
        distance: roundMetric(distance),
        triggerRadius: zone.triggerRadius,
        activeZonesBefore: this.zones.length,
        activeBurstsBefore: this.collectBursts.length,
        position: vectorPayload(zone.position)
      });

      triggered.push({
        position: zone.position.clone(),
        burstStrength: zone.burstStrength,
        discBurstRadius: zone.discBurstRadius
      });
      this.spawnCollectBurst(zone, time);
      this.removeAt(index);
    }

    return triggered;
  }

  getActiveCount(): number {
    return this.zones.length;
  }

  getCollectBurstCount(): number {
    return this.collectBursts.length;
  }

  isPositionClear(position: THREE.Vector3, clearance: number): boolean {
    return !this.zones.some((zone) => {
      const distance = Math.hypot(position.x - zone.position.x, position.z - zone.position.z);
      return distance < clearance;
    });
  }

  dispose(): void {
    for (let index = this.zones.length - 1; index >= 0; index -= 1) {
      this.removeAt(index);
    }
    for (let index = this.collectBursts.length - 1; index >= 0; index -= 1) {
      this.removeCollectBurstAt(index);
    }
    this.coreGeometry.dispose();
    this.diamondGeometry.dispose();
    this.mistGeometry.dispose();
  }

  private spawnCollectBurst(zone: EchoZoneVisual, time: number): void {
    const spawnStartedAt = performance.now();
    const object = new THREE.Group();
    object.name = `Echo collect burst ${zone.id}`;
    object.position.copy(zone.position);
    object.rotation.y = zone.object.rotation.y;
    const orbHeight = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;

    const flare = new THREE.Mesh(
      this.coreGeometry,
      new THREE.MeshBasicMaterial({
        color: ORB_SHELL_COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    flare.name = "Echo collect core flash";
    flare.position.y = orbHeight;
    flare.renderOrder = 7;
    object.add(flare);

    const mist = new THREE.Mesh(this.mistGeometry, createOrbMistMaterial());
    mist.name = "Echo collect mist shock";
    mist.position.y = orbHeight;
    mist.renderOrder = 5;
    mist.scale.set(zone.columnRadius * 1.1, zone.columnRadius * 0.82, zone.columnRadius * 1.1);
    object.add(mist);

    const shardCloud = debugMeasure(
      "echo.collect",
      "Created Echo collection shard buffers",
      () => createCollectBurstShards(zone.columnRadius, orbHeight),
      {
        id: zone.id,
        shardCount: COLLECT_BURST_MOTE_COUNT
      },
      4
    );
    object.add(shardCloud.points);

    const burstLight = new THREE.PointLight(ORB_LIGHT_COLOR, 8, 22, 1.35);
    burstLight.name = "Echo collect flash light";
    burstLight.position.y = orbHeight;
    object.add(burstLight);

    this.scene.add(object);
    this.collectBursts.push({
      spawnTime: time,
      columnRadius: zone.columnRadius,
      baseRotation: object.rotation.y,
      object,
      flare,
      mist,
      shards: shardCloud.points,
      shardPositions: shardCloud.positions,
      shardVelocities: shardCloud.velocities,
      shardAlphas: shardCloud.alphas,
      shardBaseAlphas: shardCloud.baseAlphas,
      shardSizes: shardCloud.sizes,
      shardBaseSizes: shardCloud.baseSizes,
      burstLight
    });

    debugEvent("echo.collect", "Spawned Echo collection visual burst", {
      id: zone.id,
      spawnMs: roundMetric(performance.now() - spawnStartedAt),
      activeBurstsAfter: this.collectBursts.length,
      shardCount: COLLECT_BURST_MOTE_COUNT,
      columnRadius: roundMetric(zone.columnRadius),
      position: vectorPayload(zone.position)
    });
  }

  private updateCollectBursts(time: number): void {
    const updateStartedAt = this.collectBursts.length > 0 ? performance.now() : 0;

    for (let index = this.collectBursts.length - 1; index >= 0; index -= 1) {
      const burst = this.collectBursts[index];
      const age = time - burst.spawnTime;
      const progress = THREE.MathUtils.clamp(age / COLLECT_BURST_DURATION, 0, 1);
      if (progress >= 1) {
        this.removeCollectBurstAt(index);
        continue;
      }

      const fade = 1 - progress;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const flash = fade * fade;
      const orbHeight = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;

      // The burst is now light-and-particle led instead of torus-led. The mist,
      // flare, shards, and real point light keep the detonation readable without
      // drawing graphic rings that clash with the rest of the field.
      burst.object.rotation.y = burst.baseRotation + age * 2.15 + progress * 0.55;
      burst.flare.position.y = orbHeight + easeOut * 0.35;
      burst.flare.scale.setScalar(0.9 + easeOut * 4.2);
      burst.flare.material.opacity = 0.86 * flash;

      burst.mist.rotation.y = -age * 1.2;
      burst.mist.scale.set(
        burst.columnRadius * (1.1 + easeOut * 3.7),
        burst.columnRadius * (0.82 + easeOut * 1.55),
        burst.columnRadius * (1.1 + easeOut * 3.7)
      );
      burst.mist.material.uniforms.uTime.value = age * 1.9;
      burst.mist.material.uniforms.uPulse.value = 1;
      burst.mist.material.uniforms.uOpacity.value = 0.66 * fade;

      burst.burstLight.intensity = 7.8 * flash;
      burst.burstLight.distance = 10 + easeOut * 18;
      updateCollectBurstShards(burst, age, progress);
    }

    if (this.collectBursts.length <= 0) return;

    const updateMs = performance.now() - updateStartedAt;
    if (updateMs >= 6 && time - this.lastBurstSlowFrameLogAt > 0.25) {
      this.lastBurstSlowFrameLogAt = time;
      debugEvent("echo.collect", "Slow Echo collection burst update", {
        time: roundMetric(time),
        updateMs: roundMetric(updateMs),
        activeBursts: this.collectBursts.length,
        shardCountPerBurst: COLLECT_BURST_MOTE_COUNT
      }, "warn");
    }
  }

  private removeAt(index: number): void {
    const [zone] = this.zones.splice(index, 1);
    zone.object.removeFromParent();
    zone.core.material.dispose();
    zone.orbShell.material.dispose();
    zone.orbMist.material.dispose();
    for (const light of zone.columnLights) {
      light.dispose();
    }
    zone.sparkles.points.geometry.dispose();
    zone.sparkles.points.material.dispose();
    zone.sparkles.trails.geometry.dispose();
    zone.sparkles.trails.material.dispose();
  }

  private removeCollectBurstAt(index: number): void {
    const [burst] = this.collectBursts.splice(index, 1);
    burst.object.removeFromParent();
    burst.flare.material.dispose();
    burst.mist.material.dispose();
    burst.shards.geometry.dispose();
    burst.shards.material.dispose();
    burst.burstLight.dispose();
    debugEvent("echo.collect", "Disposed Echo collection burst", {
      activeBurstsAfter: this.collectBursts.length,
      shardCount: COLLECT_BURST_MOTE_COUNT
    });
  }
}

function createColumnLights(): readonly THREE.PointLight[] {
  // Three real lights give the column volume without relying on a fake glowing
  // texture. Shadows stay off; moving point-light shadows would be far too rude
  // with this many instanced field cells. The central orb light is intentionally the
  // strongest so the collectible visibly paints nearby blocks.
  const lowerLight = new THREE.PointLight(BEAM_LIGHT_COLOR, 1.35, 13, 1.65);
  lowerLight.name = "Echo lower field light";
  lowerLight.position.y = COLUMN_BASE_LIFT + 1.1;

  const coreLight = new THREE.PointLight(ORB_LIGHT_COLOR, 2.35, 17, 1.45);
  coreLight.name = "Echo bright orb light";
  coreLight.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;

  const upperLight = new THREE.PointLight(VIOLET_COLOR, 0.95, 12, 1.8);
  upperLight.name = "Echo upper violet light";
  upperLight.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT - 0.7;

  return [lowerLight, coreLight, upperLight];
}

function updateColumnLights(lights: readonly THREE.PointLight[], pulse: number): void {
  const [lowerLight, coreLight, upperLight] = lights;
  lowerLight.intensity = 1.05 + pulse * 0.78;
  lowerLight.distance = 11.5 + pulse * 3.5;
  coreLight.intensity = 2.25 + pulse * 1.85;
  coreLight.distance = 16 + pulse * 5.5;
  upperLight.intensity = 0.68 + pulse * 0.7;
  upperLight.distance = 10 + pulse * 3;
}

function createCollectBurstShards(columnRadius: number, orbHeight: number): EchoCollectBurstShards {
  const positions = new Float32Array(COLLECT_BURST_MOTE_COUNT * 3);
  const velocities = new Float32Array(COLLECT_BURST_MOTE_COUNT * 3);
  const colors = new Float32Array(COLLECT_BURST_MOTE_COUNT * 3);
  const alphas = new Float32Array(COLLECT_BURST_MOTE_COUNT);
  const baseAlphas = new Float32Array(COLLECT_BURST_MOTE_COUNT);
  const sizes = new Float32Array(COLLECT_BURST_MOTE_COUNT);
  const baseSizes = new Float32Array(COLLECT_BURST_MOTE_COUNT);
  const twinkles = new Float32Array(COLLECT_BURST_MOTE_COUNT);

  for (let index = 0; index < COLLECT_BURST_MOTE_COUNT; index += 1) {
    const offset = index * 3;
    const angle = Math.random() * Math.PI * 2;
    const spread = Math.random();
    const horizontalSpeed = columnRadius * (3.2 + Math.random() * 5.6) * (0.42 + spread * 0.8);
    const verticalSpeed = -0.55 + Math.random() * 5.8;
    const color = pickSparkleColor(Math.random());

    // Shards start close to the orb instead of at the ground. The slight
    // random offset prevents the first frame from looking like one solid point.
    positions[offset] = (Math.random() - 0.5) * columnRadius * 0.28;
    positions[offset + 1] = orbHeight + (Math.random() - 0.5) * 0.34;
    positions[offset + 2] = (Math.random() - 0.5) * columnRadius * 0.28;
    velocities[offset] = Math.cos(angle) * horizontalSpeed;
    velocities[offset + 1] = verticalSpeed;
    velocities[offset + 2] = Math.sin(angle) * horizontalSpeed;

    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    baseAlphas[index] = 0.48 + Math.random() * 0.42;
    alphas[index] = baseAlphas[index];
    baseSizes[index] = 0.86 + Math.random() * 1.25;
    sizes[index] = baseSizes[index] * 1.35;
    twinkles[index] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", createDynamicAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aAlpha", createDynamicAttribute(alphas, 1));
  geometry.setAttribute("aSize", createDynamicAttribute(sizes, 1));
  geometry.setAttribute("aTwinkle", createDynamicAttribute(twinkles, 1));

  const points = new THREE.Points(geometry, createSparkleMaterial());
  points.name = "Echo collect burst shards";
  points.frustumCulled = false;
  points.renderOrder = 9;

  return {
    points,
    positions,
    velocities,
    alphas,
    baseAlphas,
    sizes,
    baseSizes
  };
}

function updateCollectBurstShards(burst: EchoCollectBurst, age: number, progress: number): void {
  const fade = 1 - progress;
  const gravity = 5.6;
  const drag = 1 - progress * 0.24;
  const orbHeight = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;

  burst.shards.material.uniforms.uTime.value = age * 1.8;

  for (let index = 0; index < COLLECT_BURST_MOTE_COUNT; index += 1) {
    const offset = index * 3;
    const drift = age * drag;

    // The shard spray is a local-space mini explosion: outward velocity plus
    // a little gravity so motes arc down into the larger disc burst below.
    burst.shardPositions[offset] = burst.shardVelocities[offset] * drift;
    burst.shardPositions[offset + 1] = orbHeight + burst.shardVelocities[offset + 1] * age - gravity * age * age;
    burst.shardPositions[offset + 2] = burst.shardVelocities[offset + 2] * drift;
    burst.shardAlphas[index] = burst.shardBaseAlphas[index] * Math.pow(fade, 1.35);
    burst.shardSizes[index] = burst.shardBaseSizes[index] * (0.8 + fade * 0.72);
  }

  burst.shards.geometry.attributes.position.needsUpdate = true;
  burst.shards.geometry.attributes.aAlpha.needsUpdate = true;
  burst.shards.geometry.attributes.aSize.needsUpdate = true;
}

function createOrbMistMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0.5 },
      uOpacity: { value: 0.42 },
      uCoreColor: { value: new THREE.Color(ORB_SHELL_COLOR) },
      uEdgeColor: { value: new THREE.Color(BEAM_LIGHT_COLOR) }
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      void main() {
        vLocalPosition = position;
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPulse;
      uniform float uOpacity;
      uniform vec3 uCoreColor;
      uniform vec3 uEdgeColor;
      varying vec3 vLocalPosition;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      float hash(vec3 value) {
        value = fract(value * 0.3183099 + vec3(0.11, 0.17, 0.23));
        value *= 17.0;
        return fract(value.x * value.y * value.z * (value.x + value.y + value.z));
      }

      float valueNoise(vec3 value) {
        vec3 cell = floor(value);
        vec3 local = fract(value);
        local = local * local * (3.0 - 2.0 * local);

        float c000 = hash(cell + vec3(0.0, 0.0, 0.0));
        float c100 = hash(cell + vec3(1.0, 0.0, 0.0));
        float c010 = hash(cell + vec3(0.0, 1.0, 0.0));
        float c110 = hash(cell + vec3(1.0, 1.0, 0.0));
        float c001 = hash(cell + vec3(0.0, 0.0, 1.0));
        float c101 = hash(cell + vec3(1.0, 0.0, 1.0));
        float c011 = hash(cell + vec3(0.0, 1.0, 1.0));
        float c111 = hash(cell + vec3(1.0, 1.0, 1.0));

        float x00 = mix(c000, c100, local.x);
        float x10 = mix(c010, c110, local.x);
        float x01 = mix(c001, c101, local.x);
        float x11 = mix(c011, c111, local.x);
        float y0 = mix(x00, x10, local.y);
        float y1 = mix(x01, x11, local.y);
        return mix(y0, y1, local.z);
      }

      void main() {
        vec3 viewDir = normalize(-vViewPosition);
        float facing = clamp(dot(normalize(vViewNormal), viewDir), 0.0, 1.0);

        // The mesh is only a shell, so the shader sells the volume: high alpha
        // near the view-facing center, broken up by animated value noise so the
        // glow reads like drifting mist instead of a perfect glass bubble.
        float softBody = pow(facing, 1.85);
        float softRim = pow(1.0 - facing, 3.0) * 0.22;
        float verticalFade = smoothstep(1.0, 0.05, abs(vLocalPosition.y));
        float slowWisp = valueNoise(vLocalPosition * 3.2 + vec3(0.0, uTime * 0.16, 0.0));
        float fineWisp = valueNoise(vLocalPosition * 7.4 + vec3(uTime * 0.07, -uTime * 0.11, uTime * 0.05));
        float wisps = smoothstep(0.2, 0.9, slowWisp * 0.68 + fineWisp * 0.32);
        float pulseGlow = 0.82 + uPulse * 0.42;
        float alpha = (softBody * (0.28 + wisps * 0.72) + softRim * wisps) *
          verticalFade * uOpacity * pulseGlow;

        if (alpha < 0.006) discard;

        vec3 color = mix(uEdgeColor, uCoreColor, clamp(softBody + wisps * 0.24, 0.0, 1.0));
        gl_FragColor = vec4(color * (1.1 + softBody * 1.6 + wisps * 0.6), alpha);
      }
    `
  });
}

function createOrbitSparkles(radius: number, height: number, baseLift: number): EchoOrbitSparkles {
  const positions = new Float32Array(ECHO_ORBIT_MOTE_COUNT * 3);
  const colors = new Float32Array(ECHO_ORBIT_MOTE_COUNT * 3);
  const alphas = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const sizes = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const twinkles = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const trailVertexCount = ECHO_ORBIT_MOTE_COUNT * ECHO_ORBIT_TRAIL_SEGMENTS * 2;
  const trailPositions = new Float32Array(trailVertexCount * 3);
  const trailColors = new Float32Array(trailVertexCount * 3);
  const baseColors = new Float32Array(ECHO_ORBIT_MOTE_COUNT * 3);
  const baseAngles = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const radii = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const heights = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const speeds = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const phases = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const verticalRadii = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const tilts = new Float32Array(ECHO_ORBIT_MOTE_COUNT);
  const coreHeight = baseLift + height * 0.5;

  for (let index = 0; index < ECHO_ORBIT_MOTE_COUNT; index += 1) {
    const positionOffset = index * 3;
    const color = pickSparkleColor(index / Math.max(1, ECHO_ORBIT_MOTE_COUNT - 1));

    // Keep the crystal effect in the same visual family as the avatar. The
    // diamond shell already supplies the tall silhouette; these motes stay close
    // to the core so the crystal gets deliberate energy arcs instead of bristles.
    baseAngles[index] = index * 2.399963 + Math.random() * 0.6;
    radii[index] = radius * (0.72 + Math.random() * 0.9);
    heights[index] = coreHeight + (Math.random() - 0.5) * radius * 0.4;
    speeds[index] = (index % 2 === 0 ? 1 : -1) * (2.25 + Math.random() * 2.35);
    phases[index] = Math.random() * Math.PI * 2;
    verticalRadii[index] = radius * (0.18 + Math.random() * 0.42);
    tilts[index] = -0.72 + Math.random() * 1.44;
    alphas[index] = 0.36 + Math.random() * 0.3;
    sizes[index] = 0.56 + Math.random() * 0.5;
    twinkles[index] = Math.random();

    colors[positionOffset] = color.r;
    colors[positionOffset + 1] = color.g;
    colors[positionOffset + 2] = color.b;
    baseColors[positionOffset] = color.r;
    baseColors[positionOffset + 1] = color.g;
    baseColors[positionOffset + 2] = color.b;
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", createDynamicAttribute(positions, 3));
  pointGeometry.setAttribute("color", createDynamicAttribute(colors, 3));
  pointGeometry.setAttribute("aAlpha", createDynamicAttribute(alphas, 1));
  pointGeometry.setAttribute("aSize", createDynamicAttribute(sizes, 1));
  pointGeometry.setAttribute("aTwinkle", createDynamicAttribute(twinkles, 1));

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", createDynamicAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", createDynamicAttribute(trailColors, 3));

  const points = new THREE.Points(pointGeometry, createSparkleMaterial());
  points.name = "Echo orbiting sparkle motes";
  points.frustumCulled = false;

  const trails = new THREE.LineSegments(
    trailGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.18,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  trails.name = "Echo segmented crystal orbit trails";
  trails.frustumCulled = false;

  return {
    points,
    trails,
    positions,
    alphas,
    sizes,
    trailPositions,
    trailColors,
    baseColors,
    baseAngles,
    radii,
    heights,
    speeds,
    phases,
    verticalRadii,
    tilts
  };
}

function updateOrbitSparkles(sparkles: EchoOrbitSparkles, time: number, pulse: number): void {
  sparkles.points.material.uniforms.uTime.value = time;
  sparkles.trails.material.opacity = 0.13 + pulse * 0.09;
  const trailStepSeconds = ECHO_ORBIT_TRAIL_SECONDS / ECHO_ORBIT_TRAIL_SEGMENTS;

  for (let index = 0; index < ECHO_ORBIT_MOTE_COUNT; index += 1) {
    const positionOffset = index * 3;

    // Multi-segment trails are more intentional than one long line: they imply
    // speed, fade naturally, and avoid the screenshot's sparse "hairy crystal"
    // look while keeping all writes allocation-free.
    writeOrbitPosition(sparkles.positions, positionOffset, sparkles, index, time);
    sparkles.alphas[index] = 0.28 + pulse * 0.18 + Math.sin(time * 7.2 + sparkles.phases[index]) * 0.08;
    sparkles.sizes[index] = 0.52 + pulse * 0.2 + Math.sin(time * 5.1 + sparkles.phases[index]) * 0.06;

    for (let segment = 0; segment < ECHO_ORBIT_TRAIL_SEGMENTS; segment += 1) {
      const segmentOffset = (index * ECHO_ORBIT_TRAIL_SEGMENTS + segment) * 6;
      const olderTime = time - (segment + 1) * trailStepSeconds;
      const newerTime = time - segment * trailStepSeconds;
      writeOrbitPosition(sparkles.trailPositions, segmentOffset, sparkles, index, olderTime);
      writeOrbitPosition(sparkles.trailPositions, segmentOffset + 3, sparkles, index, newerTime);
      writeOrbitTrailColor(sparkles, index, segmentOffset, segment, false);
      writeOrbitTrailColor(sparkles, index, segmentOffset + 3, segment, true);
    }
  }

  sparkles.points.geometry.attributes.position.needsUpdate = true;
  sparkles.points.geometry.attributes.aAlpha.needsUpdate = true;
  sparkles.points.geometry.attributes.aSize.needsUpdate = true;
  sparkles.trails.geometry.attributes.position.needsUpdate = true;
  sparkles.trails.geometry.attributes.color.needsUpdate = true;
}

function writeOrbitPosition(
  target: Float32Array,
  offset: number,
  sparkles: EchoOrbitSparkles,
  index: number,
  time: number
): void {
  const angle = sparkles.baseAngles[index] + time * sparkles.speeds[index] +
    Math.sin(time * 1.35 + sparkles.phases[index]) * 0.18;
  const radius = sparkles.radii[index] * (1 + Math.sin(time * 1.9 + sparkles.phases[index]) * 0.08);
  const flatX = Math.cos(angle) * radius;
  const flatZ = Math.sin(angle) * radius * 0.72;
  const verticalArc = Math.sin(angle * 1.55 + sparkles.phases[index]) * sparkles.verticalRadii[index] +
    Math.sin(time * 2.7 + sparkles.phases[index]) * 0.08;
  const tilt = sparkles.tilts[index];
  const tiltedY = verticalArc * Math.cos(tilt) - flatZ * Math.sin(tilt);
  const tiltedZ = verticalArc * Math.sin(tilt) + flatZ * Math.cos(tilt);

  target[offset] = flatX;
  target[offset + 1] = sparkles.heights[index] + tiltedY;
  target[offset + 2] = tiltedZ;
}

function writeOrbitTrailColor(
  sparkles: EchoOrbitSparkles,
  index: number,
  offset: number,
  segment: number,
  isNewerVertex: boolean
): void {
  const colorOffset = index * 3;
  const age01 = (segment + (isNewerVertex ? 0 : 1)) / (ECHO_ORBIT_TRAIL_SEGMENTS + 1);
  const intensity = Math.pow(1 - age01, 1.4);

  sparkles.trailColors[offset] = sparkles.baseColors[colorOffset] * intensity;
  sparkles.trailColors[offset + 1] = sparkles.baseColors[colorOffset + 1] * intensity;
  sparkles.trailColors[offset + 2] = sparkles.baseColors[colorOffset + 2] * intensity;
}

function createSparkleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2.5) },
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uTime;
      attribute float aAlpha;
      attribute float aSize;
      attribute float aTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        vColor = color;
        vAlpha = aAlpha;
        vTwinkle = 0.62 + 0.38 * sin(uTime * 9.5 + aTwinkle * 6.2831853);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (102.0 / max(9.0, -mvPosition.z));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        float pinCore = smoothstep(0.075, 0.0, dist);
        float softMote = smoothstep(0.24, 0.035, dist);
        float sparkle = pinCore * 0.86 + softMote * 0.14;
        float alpha = sparkle * vAlpha * vTwinkle;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vColor * (1.75 + pinCore * 3.4 + vTwinkle * 0.75), alpha);
      }
    `
  });
}

function pickSparkleColor(seed: number): THREE.Color {
  if (seed < 0.52) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.3).clone();
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.52) * 1.15).clone();
}

function createDynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}
