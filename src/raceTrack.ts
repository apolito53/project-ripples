import * as THREE from "three";
import type { PlayAreaConstraint } from "./controls";
import { debugEvent, roundMetric, vectorPayload } from "./debugLog";

const TRACK_MASK_SIZE = 512;
const TRACK_CENTERLINE_SAMPLES = 384;
const TRACK_WALL_SEGMENTS = 256;
const TRACK_FULL_WIDTH_MIN_METERS = 46;
const TRACK_FULL_WIDTH_MAX_METERS = 78;
const TRACK_WALL_HEIGHT = 12;
const TRACK_WALL_BASE_Y = -2.5;
const TRACK_WALL_SPEED_BLEED_MAX = 0.08;
const TRACK_CONTACT_LOG_INTERVAL_SECONDS = 0.7;
const TRACK_RENDER_ORDER = 3;

type TrackSample = {
  readonly point: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly fraction: number;
};

type NearestTrackSample = TrackSample & {
  readonly signedLateralDistance: number;
  readonly lateralDistance: number;
};

type TrackWallUniforms = {
  readonly uTime: { value: number };
};

/**
 * First racing layer: a wide ribbon track living inside the existing circular
 * arena. The class deliberately owns geometry, mask texture, and collision math
 * together so future track-design work has one obvious place to start.
 */
export class RaceTrack implements PlayAreaConstraint {
  readonly object = new THREE.Group();
  private readonly centerlineSamples: TrackSample[] = [];
  private readonly wallUniforms: TrackWallUniforms = { uTime: { value: 0 } };
  private readonly leftWall: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly rightWall: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private maskTexture = createEmptyTrackMaskTexture();
  private fieldRadius = 1;
  private arenaRadiusMeters = 1;
  private sceneUnitsPerMeter = 1;
  private trackWidthMeters = TRACK_FULL_WIDTH_MIN_METERS;
  private trackHalfWidthSceneUnits = 1;
  private lastWallContactLogSecond = -Infinity;

  constructor(scene: THREE.Scene, fieldRadius: number, arenaRadiusMeters: number) {
    this.object.name = "Race track prototype";

    this.leftWall = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createTrackWallMaterial(this.wallUniforms)
    );
    this.leftWall.name = "Race track left energy wall";
    this.leftWall.renderOrder = TRACK_RENDER_ORDER;

    this.rightWall = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createTrackWallMaterial(this.wallUniforms)
    );
    this.rightWall.name = "Race track right energy wall";
    this.rightWall.renderOrder = TRACK_RENDER_ORDER;

    this.object.add(this.leftWall, this.rightWall);
    scene.add(this.object);
    this.setArena(fieldRadius, arenaRadiusMeters, "initial");
  }

  setArena(fieldRadius: number, arenaRadiusMeters: number, reason = "arena"): void {
    this.fieldRadius = Math.max(1, fieldRadius);
    this.arenaRadiusMeters = Math.max(1, arenaRadiusMeters);
    this.sceneUnitsPerMeter = this.fieldRadius / this.arenaRadiusMeters;
    this.trackWidthMeters = getTrackWidthMeters(this.arenaRadiusMeters);
    this.trackHalfWidthSceneUnits = this.trackWidthMeters * this.sceneUnitsPerMeter * 0.5;

    this.rebuildCenterline();
    this.rebuildWalls();
    this.rebuildMaskTexture();

    debugEvent("track.rebuild", "Rebuilt race track ribbon", {
      reason,
      fieldRadius: roundMetric(this.fieldRadius),
      arenaRadiusMeters: roundMetric(this.arenaRadiusMeters),
      trackWidthMeters: roundMetric(this.trackWidthMeters),
      maskSize: TRACK_MASK_SIZE,
      samples: this.centerlineSamples.length
    }, "info");
  }

  update(time: number): void {
    this.wallUniforms.uTime.value = time;
  }

  getMaskTexture(): THREE.Texture {
    return this.maskTexture;
  }

  getTrackWidthMeters(): number {
    return this.trackWidthMeters;
  }

  /**
   * Clamp a moving body into the track ribbon and trim only the velocity that
   * points through the wall. Tangential speed survives so wall contact feels
   * like a glancing scrape instead of a full stop.
   */
  constrain(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    const nearest = this.findNearestSample(position.x, position.z);
    if (nearest.lateralDistance <= this.trackHalfWidthSceneUnits) return false;

    const side = nearest.signedLateralDistance >= 0 ? 1 : -1;
    const wallNormal = nearest.normal.clone().multiplyScalar(side);
    position.x = nearest.point.x + wallNormal.x * this.trackHalfWidthSceneUnits;
    position.z = nearest.point.z + wallNormal.z * this.trackHalfWidthSceneUnits;

    const outwardSpeed = velocity.x * wallNormal.x + velocity.z * wallNormal.z;
    if (outwardSpeed > 0) {
      velocity.x -= wallNormal.x * outwardSpeed;
      velocity.z -= wallNormal.z * outwardSpeed;

      // Scale the bleed from a kiss to a shove. Repeated wall riding loses a bit
      // of speed, but a light touch still preserves the racing line.
      const bleed = 1 - Math.min(TRACK_WALL_SPEED_BLEED_MAX, outwardSpeed * 0.004);
      velocity.x *= bleed;
      velocity.z *= bleed;
    }

    this.maybeLogWallContact(position, velocity, nearest);
    return true;
  }

  clampPoint(point: THREE.Vector3): boolean {
    const nearest = this.findNearestSample(point.x, point.z);
    if (nearest.lateralDistance <= this.trackHalfWidthSceneUnits) return false;

    const side = nearest.signedLateralDistance >= 0 ? 1 : -1;
    const wallNormal = nearest.normal.clone().multiplyScalar(side);
    point.x = nearest.point.x + wallNormal.x * this.trackHalfWidthSceneUnits;
    point.z = nearest.point.z + wallNormal.z * this.trackHalfWidthSceneUnits;
    return true;
  }

  samplePointAt(fraction: number, lateralOffsetMeters = 0): THREE.Vector3 {
    const wrappedFraction = wrap01(fraction);
    const sampleIndex = Math.round(wrappedFraction * TRACK_CENTERLINE_SAMPLES) % TRACK_CENTERLINE_SAMPLES;
    const sample = this.centerlineSamples[sampleIndex] ?? this.centerlineSamples[0];
    const safeOffsetSceneUnits = THREE.MathUtils.clamp(
      lateralOffsetMeters * this.sceneUnitsPerMeter,
      -this.trackHalfWidthSceneUnits * 0.62,
      this.trackHalfWidthSceneUnits * 0.62
    );

    return new THREE.Vector3(
      sample.point.x + sample.normal.x * safeOffsetSceneUnits,
      0,
      sample.point.z + sample.normal.z * safeOffsetSceneUnits
    );
  }

  getFacingYawAt(fraction: number): number {
    const wrappedFraction = wrap01(fraction);
    const sampleIndex = Math.round(wrappedFraction * TRACK_CENTERLINE_SAMPLES) % TRACK_CENTERLINE_SAMPLES;
    const sample = this.centerlineSamples[sampleIndex] ?? this.centerlineSamples[0];
    return Math.atan2(sample.tangent.x, sample.tangent.z);
  }

  getSafeEchoJitterMeters(echoRadiusSceneUnits: number): number {
    const marginSceneUnits = Math.max(1, echoRadiusSceneUnits * 1.35);
    const safeSceneUnits = Math.max(0, this.trackHalfWidthSceneUnits - marginSceneUnits);
    return safeSceneUnits / this.sceneUnitsPerMeter;
  }

  dispose(): void {
    this.leftWall.geometry.dispose();
    this.leftWall.material.dispose();
    this.rightWall.geometry.dispose();
    this.rightWall.material.dispose();
    this.maskTexture.dispose();
    this.object.removeFromParent();
  }

  private rebuildCenterline(): void {
    this.centerlineSamples.length = 0;
    const curve = new THREE.CatmullRomCurve3(
      TRACK_CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x * this.fieldRadius, 0, z * this.fieldRadius)),
      true,
      "centripetal"
    );

    for (let index = 0; index < TRACK_CENTERLINE_SAMPLES; index += 1) {
      const fraction = index / TRACK_CENTERLINE_SAMPLES;
      const point = curve.getPointAt(fraction);
      const tangent = curve.getTangentAt(fraction).setY(0).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      this.centerlineSamples.push({ point, tangent, normal, fraction });
    }
  }

  private rebuildWalls(): void {
    this.replaceWallGeometry(this.leftWall, 1);
    this.replaceWallGeometry(this.rightWall, -1);
  }

  private replaceWallGeometry(
    wall: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    side: 1 | -1
  ): void {
    const oldGeometry = wall.geometry;
    wall.geometry = createTrackWallGeometry(this.centerlineSamples, this.trackHalfWidthSceneUnits, side);
    oldGeometry.dispose();
  }

  private rebuildMaskTexture(): void {
    const data = new Uint8Array(TRACK_MASK_SIZE * TRACK_MASK_SIZE * 4);

    for (let y = 0; y < TRACK_MASK_SIZE; y += 1) {
      const z = ((y + 0.5) / TRACK_MASK_SIZE - 0.5) * this.fieldRadius * 2;

      for (let x = 0; x < TRACK_MASK_SIZE; x += 1) {
        const worldX = ((x + 0.5) / TRACK_MASK_SIZE - 0.5) * this.fieldRadius * 2;
        const nearest = this.findNearestSample(worldX, z);
        const body = 1 - smoothstep(
          this.trackHalfWidthSceneUnits * 0.94,
          this.trackHalfWidthSceneUnits * 1.06,
          nearest.lateralDistance
        );
        const edgeDistance = Math.abs(nearest.lateralDistance - this.trackHalfWidthSceneUnits);
        const edge = Math.exp(-Math.pow(edgeDistance / Math.max(0.9, this.trackHalfWidthSceneUnits * 0.045), 2));
        const center = Math.exp(-Math.pow(nearest.lateralDistance / Math.max(1, this.trackHalfWidthSceneUnits * 0.18), 2));
        const offset = (y * TRACK_MASK_SIZE + x) * 4;
        data[offset] = Math.round(body * 255);
        data[offset + 1] = Math.round(edge * 255);
        data[offset + 2] = Math.round(center * 255);
        data[offset + 3] = 255;
      }
    }

    const oldTexture = this.maskTexture;
    this.maskTexture = new THREE.DataTexture(data, TRACK_MASK_SIZE, TRACK_MASK_SIZE, THREE.RGBAFormat);
    this.maskTexture.name = "Race track surface mask";
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.maskTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTexture.generateMipmaps = false;
    this.maskTexture.needsUpdate = true;
    oldTexture.dispose();
  }

  private findNearestSample(x: number, z: number): NearestTrackSample {
    let bestSample = this.centerlineSamples[0];
    let bestDistanceSquared = Infinity;

    for (const sample of this.centerlineSamples) {
      const dx = x - sample.point.x;
      const dz = z - sample.point.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= bestDistanceSquared) continue;
      bestDistanceSquared = distanceSquared;
      bestSample = sample;
    }

    const lateralVectorX = x - bestSample.point.x;
    const lateralVectorZ = z - bestSample.point.z;
    const signedLateralDistance = lateralVectorX * bestSample.normal.x + lateralVectorZ * bestSample.normal.z;

    return {
      ...bestSample,
      signedLateralDistance,
      lateralDistance: Math.abs(signedLateralDistance)
    };
  }

  private maybeLogWallContact(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    nearest: NearestTrackSample
  ): void {
    const nowSeconds = performance.now() / 1000;
    if (nowSeconds - this.lastWallContactLogSecond < TRACK_CONTACT_LOG_INTERVAL_SECONDS) return;
    this.lastWallContactLogSecond = nowSeconds;

    debugEvent("track.wallContact", "Player pressed into race track wall", {
      position: vectorPayload(position),
      speed: roundMetric(Math.hypot(velocity.x, velocity.z)),
      trackFraction: roundMetric(nearest.fraction),
      overshoot: roundMetric(nearest.lateralDistance - this.trackHalfWidthSceneUnits)
    }, "debug");
  }
}

const TRACK_CONTROL_POINTS: readonly (readonly [number, number])[] = [
  [0.38, -0.62],
  [0.66, -0.5],
  [0.8, -0.2],
  [0.76, 0.18],
  [0.55, 0.52],
  [0.2, 0.72],
  [-0.2, 0.72],
  [-0.56, 0.52],
  [-0.78, 0.18],
  [-0.74, -0.22],
  [-0.48, -0.55],
  [-0.08, -0.7]
];

function getTrackWidthMeters(arenaRadiusMeters: number): number {
  const arena01 = THREE.MathUtils.clamp((arenaRadiusMeters - 100) / 300, 0, 1);
  return THREE.MathUtils.lerp(TRACK_FULL_WIDTH_MIN_METERS, TRACK_FULL_WIDTH_MAX_METERS, arena01);
}

function createTrackWallGeometry(
  samples: readonly TrackSample[],
  halfWidth: number,
  side: 1 | -1
): THREE.BufferGeometry {
  const positions = new Float32Array(TRACK_WALL_SEGMENTS * 2 * 3);
  const uvs = new Float32Array(TRACK_WALL_SEGMENTS * 2 * 2);
  const indices: number[] = [];

  for (let index = 0; index < TRACK_WALL_SEGMENTS; index += 1) {
    const sample = samples[Math.round((index / TRACK_WALL_SEGMENTS) * samples.length) % samples.length];
    const edgeX = sample.point.x + sample.normal.x * halfWidth * side;
    const edgeZ = sample.point.z + sample.normal.z * halfWidth * side;
    const bottomOffset = index * 6;
    const topOffset = bottomOffset + 3;
    positions[bottomOffset] = edgeX;
    positions[bottomOffset + 1] = TRACK_WALL_BASE_Y;
    positions[bottomOffset + 2] = edgeZ;
    positions[topOffset] = edgeX;
    positions[topOffset + 1] = TRACK_WALL_BASE_Y + TRACK_WALL_HEIGHT;
    positions[topOffset + 2] = edgeZ;

    const uvOffset = index * 4;
    const u = index / TRACK_WALL_SEGMENTS;
    uvs[uvOffset] = u;
    uvs[uvOffset + 1] = 0;
    uvs[uvOffset + 2] = u;
    uvs[uvOffset + 3] = 1;

    const nextIndex = (index + 1) % TRACK_WALL_SEGMENTS;
    const bottomA = index * 2;
    const topA = bottomA + 1;
    const bottomB = nextIndex * 2;
    const topB = bottomB + 1;
    indices.push(bottomA, bottomB, topA, topA, bottomB, topB);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createTrackWallMaterial(uniforms: TrackWallUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        float height01 = vUv.y;
        float baseGlow = 1.0 - smoothstep(0.0, 0.34, height01);
        float crownGlow = smoothstep(0.36, 1.0, height01);
        float centerFade = smoothstep(0.02, 0.16, height01) * (1.0 - smoothstep(0.78, 1.0, height01));
        float currentBand = pow(0.5 + 0.5 * sin(vUv.x * 58.0 - uTime * 1.15), 3.0);
        float pulse = 0.92 + sin(uTime * 0.9 + vUv.x * 42.0) * 0.08;

        vec3 cyan = vec3(0.03, 1.0, 0.88);
        vec3 blue = vec3(0.02, 0.26, 0.58);
        vec3 violet = vec3(0.56, 0.48, 1.0);
        vec3 color = mix(cyan, blue, smoothstep(0.0, 0.7, height01));
        color = mix(color, violet, crownGlow * 0.38);
        color = mix(color, vec3(0.88, 1.0, 0.96), baseGlow * 0.22 + crownGlow * 0.16);

        float alpha = pulse * (baseGlow * 0.5 + centerFade * 0.08 + crownGlow * 0.22 + currentBand * centerFade * 0.06);
        gl_FragColor = vec4(color * (3.25 + baseGlow * 2.4 + crownGlow * 1.55 + currentBand * 0.55), alpha);
      }
    `
  });
}

function createEmptyTrackMaskTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.name = "No-op race track mask";
  texture.needsUpdate = true;
  return texture;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}
