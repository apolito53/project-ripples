import * as THREE from "three";

const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(0x7dffd8);
const VIOLET = new THREE.Color(0x7f7dff);
const GOLD = new THREE.Color(0xffd36a);
const PARTICLE_ALPHA_MIN = 0.34;
const PARTICLE_ALPHA_VARIANCE = 0.32;

export class ParticleVeil {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly twinkles: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly baseAlphas: Float32Array;
  private readonly activeIndices: Int32Array;
  private readonly activeSlots: Int32Array;
  private activeCount = 0;
  private cursor = 0;
  private elapsedSeconds = 0;
  private auraAccumulator = 0;

  constructor(scene: THREE.Scene, budget: number, pixelRatio: number) {
    this.positions = new Float32Array(budget * 3);
    this.velocities = new Float32Array(budget * 3);
    this.colors = new Float32Array(budget * 3);
    this.alphas = new Float32Array(budget);
    this.sizes = new Float32Array(budget);
    this.twinkles = new Float32Array(budget);
    this.ages = new Float32Array(budget);
    this.lifetimes = new Float32Array(budget);
    this.baseSizes = new Float32Array(budget);
    this.baseAlphas = new Float32Array(budget);
    this.activeIndices = new Int32Array(budget);
    this.activeSlots = new Int32Array(budget);
    this.activeSlots.fill(-1);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", createDynamicAttribute(this.positions, 3));
    this.geometry.setAttribute("color", createDynamicAttribute(this.colors, 3));
    this.geometry.setAttribute("aAlpha", createDynamicAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", createDynamicAttribute(this.sizes, 1));
    this.geometry.setAttribute("aTwinkle", createDynamicAttribute(this.twinkles, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      // These motes are decorative light in the air, not physical debris.
      // Disabling depth testing keeps the cloud readable instead of letting
      // nearby cube columns swallow most of the tiny particles.
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uPixelRatio: { value: pixelRatio },
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

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "Additive ripple particles";
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  resizeBudget(scene: THREE.Scene, budget: number, pixelRatio: number): ParticleVeil {
    this.dispose();
    return new ParticleVeil(scene, budget, pixelRatio);
  }

  setPixelRatio(pixelRatio: number): void {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  spawnBurst(center: THREE.Vector3, count: number, strength: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitCloudParticle(center, strength, 1, 1, 0.9);
    }

    this.markDirty();
  }

  spawnDiscBurst(center: THREE.Vector3, count: number, strength: number, radius: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitDiscParticle(center, strength, radius);
    }

    this.markDirty();
  }

  spawnAura(center: THREE.Vector3, delta: number, movementStrength: number): void {
    // The avatar should feel wrapped in particulate light even while idle. The
    // accumulator makes the emission rate frame-rate independent, so a slow
    // machine does not get a thinner cloud just because fewer frames ran.
    const particlesPerSecond = 2250 + movementStrength * 1750;
    this.auraAccumulator += delta * particlesPerSecond;
    const count = Math.min(340, Math.floor(this.auraAccumulator));
    if (count <= 0) return;

    this.auraAccumulator -= count;
    for (let auraIndex = 0; auraIndex < count; auraIndex += 1) {
      this.emitCloudParticle(center, 0.12 + movementStrength * 0.16, 0.7, 0.92, 0.05);
    }

    this.markDirty();
  }

  spawnWake(center: THREE.Vector3, movementStrength: number): void {
    if (movementStrength <= 0.08 || Math.random() > movementStrength * 0.55) return;
    this.spawnBurst(center, 140 + Math.floor(movementStrength * 360), 0.12 + movementStrength * 0.16);
  }

  update(delta: number): void {
    this.elapsedSeconds += delta;
    this.material.uniforms.uTime.value = this.elapsedSeconds;

    for (let activeSlot = this.activeCount - 1; activeSlot >= 0; activeSlot -= 1) {
      const index = this.activeIndices[activeSlot];
      const age = this.ages[index] + delta;
      this.ages[index] = age;

      if (age >= this.lifetimes[index]) {
        this.seedDormantParticle(index);
        this.deactivateParticle(activeSlot);
        continue;
      }

      const offset = index * 3;
      const normalizedAge = Math.min(1, age / this.lifetimes[index]);
      const drag = Math.exp(-delta * 0.9);
      const fadeIn = Math.sin(Math.min(1, normalizedAge * 3.2) * Math.PI * 0.5);
      const fadeOut = Math.pow(1 - normalizedAge, 1.28);

      this.velocities[offset] *= drag;
      this.velocities[offset + 1] = this.velocities[offset + 1] * drag - delta * 0.42;
      this.velocities[offset + 2] *= drag;
      this.positions[offset] += this.velocities[offset] * delta;
      this.positions[offset + 1] += this.velocities[offset + 1] * delta;
      this.positions[offset + 2] += this.velocities[offset + 2] * delta;
      this.alphas[index] = this.baseAlphas[index] * fadeIn * fadeOut;
      this.sizes[index] = this.baseSizes[index] * (0.92 + Math.sin(normalizedAge * Math.PI) * 0.08);
    }

    this.markDirty();
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private seedDormantParticle(index: number): void {
    const offset = index * 3;
    this.positions[offset] = 0;
    this.positions[offset + 1] = -999;
    this.positions[offset + 2] = 0;
    this.alphas[index] = 0;
    this.sizes[index] = 0;
    this.ages[index] = 0;
    this.lifetimes[index] = 0;
    this.baseSizes[index] = 0;
    this.baseAlphas[index] = 0;
  }

  private emitCloudParticle(
    center: THREE.Vector3,
    strength: number,
    cloudScale: number,
    alphaScale: number,
    verticalLift: number
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.alphas.length;
    this.activateParticle(index);

    const angle = Math.random() * Math.PI * 2;
    // Keep bursts cloud-like: many tiny motes suspended near the source,
    // rather than a few billboard sprites exploding outward.
    const cloudRadius = (0.8 + strength * 3.1) * cloudScale;
    const radius = Math.sqrt(Math.random()) * cloudRadius;
    const heightJitter = (Math.random() - 0.42) * (1.25 + strength * 1.7) * cloudScale;
    const outward = (0.28 + Math.random() * (0.85 + strength * 1.6)) * cloudScale;
    const tangent = (Math.random() - 0.5) * (0.55 + strength * 1.4) * cloudScale;
    const upward = (Math.random() - 0.18) * (0.28 + strength * 0.72) * cloudScale;
    const positionOffset = index * 3;
    const color = pickParticleColor(Math.random());

    this.positions[positionOffset] = center.x + Math.cos(angle) * radius;
    this.positions[positionOffset + 1] = center.y + verticalLift + heightJitter;
    this.positions[positionOffset + 2] = center.z + Math.sin(angle) * radius;
    this.velocities[positionOffset] = Math.cos(angle) * outward - Math.sin(angle) * tangent;
    this.velocities[positionOffset + 1] = upward;
    this.velocities[positionOffset + 2] = Math.sin(angle) * outward + Math.cos(angle) * tangent;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = 0.9 + Math.random() * 1.85;
    // Brightness lives mostly in alpha and shader energy, not mote size. That
    // keeps the sparkle cloud crisp instead of sliding back into soft blobs.
    this.baseAlphas[index] = (PARTICLE_ALPHA_MIN + Math.random() * PARTICLE_ALPHA_VARIANCE) * alphaScale;
    this.baseSizes[index] = (0.45 + Math.random() * (1.05 + strength * 0.58)) * cloudScale;
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
  }

  private emitDiscParticle(center: THREE.Vector3, strength: number, discRadius: number): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.alphas.length;
    this.activateParticle(index);

    const angle = Math.random() * Math.PI * 2;
    // Echo detonations should read like a flat pressure disc racing across the
    // field, not another spherical cloud. Square-root radius gives an even disc
    // fill while the velocity still pushes the motes outward from the center.
    const normalizedRadius = Math.sqrt(Math.random());
    const radius = normalizedRadius * discRadius;
    const outward = (4.2 + Math.random() * 7.6 + strength * 5.4) * (0.54 + normalizedRadius * 0.6);
    const tangent = (Math.random() - 0.5) * (0.9 + strength * 1.3);
    const lift = (Math.random() - 0.38) * (0.24 + strength * 0.34);
    const positionOffset = index * 3;
    const color = pickParticleColor(Math.random());

    this.positions[positionOffset] = center.x + Math.cos(angle) * radius;
    this.positions[positionOffset + 1] = center.y + 0.34 + (Math.random() - 0.5) * 0.22;
    this.positions[positionOffset + 2] = center.z + Math.sin(angle) * radius;
    this.velocities[positionOffset] = Math.cos(angle) * outward - Math.sin(angle) * tangent;
    this.velocities[positionOffset + 1] = lift;
    this.velocities[positionOffset + 2] = Math.sin(angle) * outward + Math.cos(angle) * tangent;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = 0.7 + Math.random() * 1.15;
    this.baseAlphas[index] = PARTICLE_ALPHA_MIN + 0.18 + Math.random() * (PARTICLE_ALPHA_VARIANCE + 0.2);
    this.baseSizes[index] = 0.55 + Math.random() * (1.3 + strength * 0.85);
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
  }

  private markDirty(): void {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aTwinkle.needsUpdate = true;
  }

  private activateParticle(index: number): void {
    if (this.activeSlots[index] !== -1) return;
    this.activeSlots[index] = this.activeCount;
    this.activeIndices[this.activeCount] = index;
    this.activeCount += 1;
  }

  private deactivateParticle(activeSlot: number): void {
    const index = this.activeIndices[activeSlot];
    this.activeCount -= 1;
    const movedIndex = this.activeIndices[this.activeCount];
    this.activeSlots[index] = -1;

    if (activeSlot >= this.activeCount) return;
    this.activeIndices[activeSlot] = movedIndex;
    this.activeSlots[movedIndex] = activeSlot;
  }
}

function pickParticleColor(seed: number): THREE.Color {
  if (seed < 0.5) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.4);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.5) * 1.2);
}

function createDynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  // Higher particle caps keep the GPU vertex budget high, while this hint tells
  // Three these buffers are expected to be rewritten as particles move.
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}
