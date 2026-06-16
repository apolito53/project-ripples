import * as THREE from "three";

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
  readonly lowerRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly upperRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly core: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
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
  readonly baseAngles: Float32Array;
  readonly radii: Float32Array;
  readonly heights: Float32Array;
  readonly speeds: Float32Array;
  readonly phases: Float32Array;
  readonly verticalSpeeds: Float32Array;
};

const BEAM_LIGHT_COLOR = 0x67ffe0;
const RING_COLOR = 0x95a7ff;
const CORE_COLOR = 0xffd36a;
const MOTE_COLOR = 0x7dffd8;
const COLUMN_HEIGHT = 7.4;
const COLUMN_BASE_LIFT = 1.45;
const SPARK_MOTE_COUNT = 128;
const TRAIL_BACKSTEP_SECONDS = 0.18;
const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(MOTE_COLOR);
const VIOLET = new THREE.Color(RING_COLOR);
const GOLD = new THREE.Color(CORE_COLOR);

export class EchoZoneField {
  private readonly scene: THREE.Scene;
  private readonly ringGeometry = new THREE.TorusGeometry(1, 0.018, 8, 112);
  private readonly coreGeometry = new THREE.IcosahedronGeometry(0.42, 2);
  private readonly zones: EchoZoneVisual[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  add(position: THREE.Vector3, startTime: number, options: EchoZoneOptions): void {
    const object = new THREE.Group();
    object.name = `Echo zone ${this.nextId}`;
    object.position.copy(position);
    const columnRadius = Math.max(0.85, options.radius * 0.34);

    const lowerRing = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    lowerRing.name = "Echo floating lower halo";
    lowerRing.position.y = COLUMN_BASE_LIFT;
    lowerRing.rotation.x = -Math.PI / 2;
    lowerRing.scale.setScalar(columnRadius);
    object.add(lowerRing);

    const upperRing = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: BEAM_LIGHT_COLOR,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    upperRing.name = "Echo floating upper halo";
    upperRing.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT;
    upperRing.rotation.x = -Math.PI / 2;
    upperRing.scale.setScalar(columnRadius * 0.58);
    object.add(upperRing);

    const core = new THREE.Mesh(
      this.coreGeometry,
      new THREE.MeshBasicMaterial({
        color: CORE_COLOR,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    core.name = "Echo unstable core";
    core.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;
    object.add(core);

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
      lowerRing,
      upperRing,
      core,
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
      const radiusPulse = 1 + pulse * 0.08;

      // The old marker was a translucent cylinder pretending to be a light
      // column. These rings/core are just readable accents now; the actual
      // column glow comes from the point lights below.
      zone.object.position.y = zone.position.y + Math.sin(age * 3 + zone.phase) * 0.045;
      zone.object.rotation.y = slowSpin * 0.2;
      zone.lowerRing.rotation.z = slowSpin * 0.9;
      zone.upperRing.rotation.z = -slowSpin * 1.25;
      zone.lowerRing.scale.setScalar(zone.columnRadius * radiusPulse);
      zone.upperRing.scale.setScalar(zone.columnRadius * (0.55 + pulse * 0.1));
      zone.core.scale.setScalar(0.78 + pulse * 0.28);
      zone.lowerRing.material.opacity = 0.38 + pulse * 0.28;
      zone.upperRing.material.opacity = 0.2 + pulse * 0.18;
      zone.core.material.opacity = 0.38 + pulse * 0.34;

      updateColumnLights(zone.columnLights, pulse);
      updateOrbitSparkles(zone.sparkles, age, pulse);
    }
  }

  collectAt(playerPosition: THREE.Vector3): TriggeredEchoZone[] {
    const triggered: TriggeredEchoZone[] = [];

    for (let index = this.zones.length - 1; index >= 0; index -= 1) {
      const zone = this.zones[index];
      const distance = Math.hypot(playerPosition.x - zone.position.x, playerPosition.z - zone.position.z);
      if (distance > zone.triggerRadius) continue;

      triggered.push({
        position: zone.position.clone(),
        burstStrength: zone.burstStrength,
        discBurstRadius: zone.discBurstRadius
      });
      this.removeAt(index);
    }

    return triggered;
  }

  getActiveCount(): number {
    return this.zones.length;
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
    this.ringGeometry.dispose();
    this.coreGeometry.dispose();
  }

  private removeAt(index: number): void {
    const [zone] = this.zones.splice(index, 1);
    zone.object.removeFromParent();
    zone.lowerRing.material.dispose();
    zone.upperRing.material.dispose();
    zone.core.material.dispose();
    for (const light of zone.columnLights) {
      light.dispose();
    }
    zone.sparkles.points.geometry.dispose();
    zone.sparkles.points.material.dispose();
    zone.sparkles.trails.geometry.dispose();
    zone.sparkles.trails.material.dispose();
  }
}

function createColumnLights(): readonly THREE.PointLight[] {
  // Three real lights give the column volume without relying on a fake glowing
  // texture. Shadows stay off; moving point-light shadows would be far too rude
  // with this many instanced cubes.
  const lowerLight = new THREE.PointLight(BEAM_LIGHT_COLOR, 1.35, 13, 1.65);
  lowerLight.name = "Echo lower cube light";
  lowerLight.position.y = COLUMN_BASE_LIFT + 1.1;

  const coreLight = new THREE.PointLight(CORE_COLOR, 1.75, 15, 1.55);
  coreLight.name = "Echo warm core light";
  coreLight.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;

  const upperLight = new THREE.PointLight(RING_COLOR, 0.95, 12, 1.8);
  upperLight.name = "Echo upper violet light";
  upperLight.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT - 0.7;

  return [lowerLight, coreLight, upperLight];
}

function updateColumnLights(lights: readonly THREE.PointLight[], pulse: number): void {
  const [lowerLight, coreLight, upperLight] = lights;
  lowerLight.intensity = 1.05 + pulse * 0.78;
  lowerLight.distance = 11.5 + pulse * 3.5;
  coreLight.intensity = 1.45 + pulse * 1.15;
  coreLight.distance = 13 + pulse * 4;
  upperLight.intensity = 0.68 + pulse * 0.7;
  upperLight.distance = 10 + pulse * 3;
}

function createOrbitSparkles(radius: number, height: number, baseLift: number): EchoOrbitSparkles {
  const positions = new Float32Array(SPARK_MOTE_COUNT * 3);
  const colors = new Float32Array(SPARK_MOTE_COUNT * 3);
  const alphas = new Float32Array(SPARK_MOTE_COUNT);
  const sizes = new Float32Array(SPARK_MOTE_COUNT);
  const twinkles = new Float32Array(SPARK_MOTE_COUNT);
  const trailPositions = new Float32Array(SPARK_MOTE_COUNT * 2 * 3);
  const trailColors = new Float32Array(SPARK_MOTE_COUNT * 2 * 3);
  const baseAngles = new Float32Array(SPARK_MOTE_COUNT);
  const radii = new Float32Array(SPARK_MOTE_COUNT);
  const heights = new Float32Array(SPARK_MOTE_COUNT);
  const speeds = new Float32Array(SPARK_MOTE_COUNT);
  const phases = new Float32Array(SPARK_MOTE_COUNT);
  const verticalSpeeds = new Float32Array(SPARK_MOTE_COUNT);

  for (let index = 0; index < SPARK_MOTE_COUNT; index += 1) {
    const positionOffset = index * 3;
    const trailOffset = index * 6;
    const color = pickSparkleColor(Math.random());

    baseAngles[index] = index * 2.399963 + Math.random() * 0.75;
    radii[index] = radius * (0.28 + Math.random() * 0.92);
    heights[index] = baseLift + Math.random() * height;
    speeds[index] = (Math.random() < 0.5 ? -1 : 1) * (0.34 + Math.random() * 0.78);
    phases[index] = Math.random() * Math.PI * 2;
    verticalSpeeds[index] = 1.1 + Math.random() * 2.3;
    alphas[index] = 0.42 + Math.random() * 0.38;
    sizes[index] = 0.62 + Math.random() * 0.92;
    twinkles[index] = Math.random();

    colors[positionOffset] = color.r;
    colors[positionOffset + 1] = color.g;
    colors[positionOffset + 2] = color.b;

    // Both trail vertices use the same color; opacity is intentionally handled
    // by the material so the trails stay subtle instead of becoming neon wire.
    trailColors[trailOffset] = color.r;
    trailColors[trailOffset + 1] = color.g;
    trailColors[trailOffset + 2] = color.b;
    trailColors[trailOffset + 3] = color.r;
    trailColors[trailOffset + 4] = color.g;
    trailColors[trailOffset + 5] = color.b;
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", createDynamicAttribute(positions, 3));
  pointGeometry.setAttribute("color", createDynamicAttribute(colors, 3));
  pointGeometry.setAttribute("aAlpha", createDynamicAttribute(alphas, 1));
  pointGeometry.setAttribute("aSize", createDynamicAttribute(sizes, 1));
  pointGeometry.setAttribute("aTwinkle", createDynamicAttribute(twinkles, 1));

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", createDynamicAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));

  const points = new THREE.Points(pointGeometry, createSparkleMaterial());
  points.name = "Echo orbiting sparkle motes";
  points.frustumCulled = false;

  const trails = new THREE.LineSegments(
    trailGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.11,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  trails.name = "Echo subtle orbit trails";
  trails.frustumCulled = false;

  return {
    points,
    trails,
    positions,
    alphas,
    sizes,
    trailPositions,
    baseAngles,
    radii,
    heights,
    speeds,
    phases,
    verticalSpeeds
  };
}

function updateOrbitSparkles(sparkles: EchoOrbitSparkles, time: number, pulse: number): void {
  sparkles.points.material.uniforms.uTime.value = time;
  sparkles.trails.material.opacity = 0.055 + pulse * 0.075;

  for (let index = 0; index < SPARK_MOTE_COUNT; index += 1) {
    const positionOffset = index * 3;
    const trailOffset = index * 6;

    // Write both the current sparkle point and the trailing segment directly
    // into typed arrays. This avoids a stream of per-frame Vector3 allocations
    // while several Echo columns are alive.
    writeOrbitPosition(sparkles.trailPositions, trailOffset, sparkles, index, time - TRAIL_BACKSTEP_SECONDS);
    writeOrbitPosition(sparkles.positions, positionOffset, sparkles, index, time);
    sparkles.trailPositions[trailOffset + 3] = sparkles.positions[positionOffset];
    sparkles.trailPositions[trailOffset + 4] = sparkles.positions[positionOffset + 1];
    sparkles.trailPositions[trailOffset + 5] = sparkles.positions[positionOffset + 2];
    sparkles.alphas[index] = 0.32 + pulse * 0.18 + Math.sin(time * 6.2 + sparkles.phases[index]) * 0.1;
    sparkles.sizes[index] = 0.62 + pulse * 0.26 + Math.sin(time * 4.1 + sparkles.phases[index]) * 0.08;
  }

  sparkles.points.geometry.attributes.position.needsUpdate = true;
  sparkles.points.geometry.attributes.aAlpha.needsUpdate = true;
  sparkles.points.geometry.attributes.aSize.needsUpdate = true;
  sparkles.trails.geometry.attributes.position.needsUpdate = true;
}

function writeOrbitPosition(
  target: Float32Array,
  offset: number,
  sparkles: EchoOrbitSparkles,
  index: number,
  time: number
): void {
  const orbitWobble = 1 + Math.sin(time * 1.7 + sparkles.phases[index]) * 0.12;
  const angle = sparkles.baseAngles[index] + time * sparkles.speeds[index] +
    Math.sin(time * 0.8 + sparkles.phases[index]) * 0.2;
  const radius = sparkles.radii[index] * orbitWobble;
  const y = sparkles.heights[index] + Math.sin(time * sparkles.verticalSpeeds[index] + sparkles.phases[index]) * 0.32;
  target[offset] = Math.cos(angle) * radius;
  target[offset + 1] = y;
  target[offset + 2] = Math.sin(angle) * radius;
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
