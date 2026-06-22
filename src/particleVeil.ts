import * as THREE from "three";

const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(0x7dffd8);
const VIOLET = new THREE.Color(0x7f7dff);
const GOLD = new THREE.Color(0xffd36a);
const PALE_CYAN = new THREE.Color(0xdffcff);
const PARTICLE_ALPHA_MIN = 0.44;
const PARTICLE_ALPHA_VARIANCE = 0.38;
const PARTICLE_SHADER_ENERGY_GAIN = 1.24;
const DISC_CLOUD_PARTICLE_RATIO = 0.012;
const DISC_CLOUD_PARTICLE_MAX = 720;
const DISC_GLITTER_PARTICLE_RATIO = 0.06;
const DISC_GLITTER_PARTICLE_MAX = 3200;
const PULSE_VERTICAL_LIFT = 0.18;
const PULSE_VERTICAL_JITTER = 0.56;
const PULSE_LIFETIME_BASE = 0.42;
const PULSE_LIFETIME_VARIANCE = 0.66;
const WAKE_PARTICLE_COUNT_BASE = 36;
const WAKE_PARTICLE_COUNT_MOVEMENT_BONUS = 96;
const WAKE_VERTICAL_LIFT = 0.08;
const WAKE_VERTICAL_JITTER_BASE = 0.1;
const WAKE_VERTICAL_JITTER_MOVEMENT_BONUS = 0.14;
const CONTINUOUS_EMISSION_THROTTLE_START = 0.58;
const CONTINUOUS_EMISSION_THROTTLE_END = 0.94;
const CONTINUOUS_EMISSION_MIN_SCALE = 0.2;
const TEMP_WAKE_DIRECTION = new THREE.Vector2();
const TEMP_WAKE_RIGHT = new THREE.Vector2();

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
  private readonly cloudinesses: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly baseAlphas: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly alphaAttribute: THREE.BufferAttribute;
  private readonly sizeAttribute: THREE.BufferAttribute;
  private readonly twinkleAttribute: THREE.BufferAttribute;
  private readonly cloudinessAttribute: THREE.BufferAttribute;
  private activeCount = 0;
  private readonly capacity: number;
  // Live particles stay packed into [0, activeCount). When the buffer is full,
  // cursor rotates through that packed range and replaces older motes.
  private cursor = 0;
  private elapsedSeconds = 0;
  private auraAccumulator = 0;
  private staticDirtyMinIndex = Number.POSITIVE_INFINITY;
  private staticDirtyMaxIndex = -1;

  constructor(scene: THREE.Scene, budget: number, pixelRatio: number) {
    this.capacity = budget;
    this.positions = new Float32Array(budget * 3);
    this.velocities = new Float32Array(budget * 3);
    this.colors = new Float32Array(budget * 3);
    this.alphas = new Float32Array(budget);
    this.sizes = new Float32Array(budget);
    this.twinkles = new Float32Array(budget);
    this.cloudinesses = new Float32Array(budget);
    this.ages = new Float32Array(budget);
    this.lifetimes = new Float32Array(budget);
    this.baseSizes = new Float32Array(budget);
    this.baseAlphas = new Float32Array(budget);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = createDynamicAttribute(this.positions, 3);
    this.colorAttribute = createDynamicAttribute(this.colors, 3);
    this.alphaAttribute = createDynamicAttribute(this.alphas, 1);
    this.sizeAttribute = createDynamicAttribute(this.sizes, 1);
    this.twinkleAttribute = createDynamicAttribute(this.twinkles, 1);
    this.cloudinessAttribute = createDynamicAttribute(this.cloudinesses, 1);
    this.geometry.setAttribute("position", this.positionAttribute);
    this.geometry.setAttribute("color", this.colorAttribute);
    this.geometry.setAttribute("aAlpha", this.alphaAttribute);
    this.geometry.setAttribute("aSize", this.sizeAttribute);
    this.geometry.setAttribute("aTwinkle", this.twinkleAttribute);
    this.geometry.setAttribute("aCloudiness", this.cloudinessAttribute);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      // These motes are decorative light in the air, not physical debris.
      // Disabling depth testing keeps the cloud readable instead of letting
      // nearby animated field cells swallow most of the tiny particles.
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
        attribute float aCloudiness;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vTwinkle;
        varying float vCloudiness;

        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vTwinkle = 0.62 + 0.38 * sin(uTime * 9.5 + aTwinkle * 6.2831853);
          vCloudiness = aCloudiness;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uPixelRatio * (102.0 / max(9.0, -mvPosition.z));
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vTwinkle;
        varying float vCloudiness;

        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          float pinCore = smoothstep(0.075, 0.0, dist);
          float softMote = smoothstep(0.24, 0.035, dist);
          float glitterShape = pinCore * 0.86 + softMote * 0.14;
          float cloudBody = smoothstep(0.52, 0.0, dist);
          float cloudCore = smoothstep(0.32, 0.0, dist);
          float cloudShape = cloudBody * (0.44 + cloudCore * 0.56);
          float shape = mix(glitterShape, cloudShape, vCloudiness);
          float twinkle = mix(vTwinkle, 0.88 + vTwinkle * 0.12, vCloudiness);
          float alpha = min(shape * vAlpha * twinkle, 1.0);
          if (alpha < 0.004) discard;
          // Keep the shape crisp and make the light hotter. Size stays CPU-side,
          // while this energy gain lets particles compete with bright crest glow.
          float glitterEnergy = 2.2 + pinCore * 4.6 + vTwinkle * 1.05;
          float cloudEnergy = 1.28 + cloudCore * 2.0 + cloudBody * 0.72;
          gl_FragColor = vec4(vColor * mix(glitterEnergy, cloudEnergy, vCloudiness) * ${PARTICLE_SHADER_ENERGY_GAIN.toFixed(2)}, alpha);
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

  setEnabled(enabled: boolean): void {
    this.points.visible = enabled;
    if (enabled) return;

    this.activeCount = 0;
    this.cursor = 0;
    this.auraAccumulator = 0;
    this.geometry.setDrawRange(0, 0);
  }

  spawnBurst(center: THREE.Vector3, count: number, strength: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitCloudParticle(center, strength, 1, 1, 0.9);
    }

    this.markDirty(true);
  }

  spawnPulseBurst(center: THREE.Vector3, count: number, strength: number): void {
    // Manual touch pulses, jump impacts, and Echo detonations are gameplay
    // punctuation, not lingering fog. Emit a flatter, faster cloud so the burst
    // diffuses across the field before it can stack into a vertical cylinder.
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitPulseParticle(center, strength);
    }

    this.markDirty(true);
  }

  spawnDiscBurst(center: THREE.Vector3, count: number, strength: number, radius: number): number {
    const intensityBudget = Math.max(0, Math.floor(count));
    if (intensityBudget <= 0) return 0;

    // Echo detonations now spend their budget on a layered pressure poof:
    // broad low-alpha cloud motes sell the disc shape, then a smaller glitter
    // layer gives the burst texture without flooding the particle buffer.
    const cloudCount = Math.min(
      DISC_CLOUD_PARTICLE_MAX,
      Math.max(18, Math.floor(intensityBudget * DISC_CLOUD_PARTICLE_RATIO))
    );
    const glitterCount = Math.min(
      DISC_GLITTER_PARTICLE_MAX,
      Math.max(48, Math.floor(intensityBudget * DISC_GLITTER_PARTICLE_RATIO))
    );

    for (let burstIndex = 0; burstIndex < cloudCount; burstIndex += 1) {
      this.emitDiscCloudParticle(center, strength, radius);
    }

    for (let burstIndex = 0; burstIndex < glitterCount; burstIndex += 1) {
      this.emitDiscParticle(center, strength, radius);
    }

    this.markDirty(true);
    return cloudCount + glitterCount;
  }

  spawnAura(center: THREE.Vector3, delta: number, movementStrength: number): void {
    // The avatar should feel wrapped in particulate light even while idle. The
    // accumulator makes the emission rate frame-rate independent, so a slow
    // machine does not get a thinner cloud just because fewer frames ran.
    const emissionScale = this.getContinuousEmissionScale();
    const particlesPerSecond = (2250 + movementStrength * 1750) * emissionScale;
    this.auraAccumulator += delta * particlesPerSecond;
    const frameCap = Math.max(42, Math.floor(340 * emissionScale));
    const count = Math.min(frameCap, Math.floor(this.auraAccumulator));
    if (count <= 0) return;

    this.auraAccumulator -= count;
    for (let auraIndex = 0; auraIndex < count; auraIndex += 1) {
      this.emitCloudParticle(center, 0.12 + movementStrength * 0.16, 0.7, 0.92, 0.05);
    }

    this.markDirty(true);
  }

  spawnWake(center: THREE.Vector3, movementStrength: number, movementVelocity: THREE.Vector3): void {
    const emissionScale = this.getContinuousEmissionScale();
    if (movementStrength <= 0.08 || Math.random() > movementStrength * 0.55 * emissionScale) return;

    TEMP_WAKE_DIRECTION.set(movementVelocity.x, movementVelocity.z);
    if (TEMP_WAKE_DIRECTION.lengthSq() <= 0.0001) return;
    TEMP_WAKE_DIRECTION.normalize();
    TEMP_WAKE_RIGHT.set(-TEMP_WAKE_DIRECTION.y, TEMP_WAKE_DIRECTION.x);

    // Movement wakes are emitted constantly while the player runs. Keep them as
    // a directional tail instead of a loose glitter shed: fewer motes, narrower
    // lateral scatter, and a spawn bias behind the current velocity vector.
    const rawCount = WAKE_PARTICLE_COUNT_BASE + Math.floor(movementStrength * WAKE_PARTICLE_COUNT_MOVEMENT_BONUS);
    const count = Math.max(6, Math.floor(rawCount * emissionScale));
    const strength = 0.12 + movementStrength * 0.16;
    for (let wakeIndex = 0; wakeIndex < count; wakeIndex += 1) {
      this.emitWakeParticle(center, strength, movementStrength, TEMP_WAKE_DIRECTION, TEMP_WAKE_RIGHT);
    }

    this.markDirty(true);
  }

  update(delta: number): void {
    this.elapsedSeconds += delta;
    this.material.uniforms.uTime.value = this.elapsedSeconds;
    let compactedParticleData = false;

    for (let index = this.activeCount - 1; index >= 0; index -= 1) {
      const age = this.ages[index] + delta;
      this.ages[index] = age;

      if (age >= this.lifetimes[index]) {
        this.deactivateParticle(index);
        compactedParticleData = true;
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

    this.markDirty(compactedParticleData);
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
    this.cloudinesses[index] = 0;
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
    const index = this.allocateParticleSlot();

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
    this.cloudinesses[index] = 0;
  }

  private emitPulseParticle(center: THREE.Vector3, strength: number): void {
    const index = this.allocateParticleSlot();

    const angle = Math.random() * Math.PI * 2;
    // Start close to the field surface and spend most of the motion budget
    // horizontally. That makes a pulse read as an expanding sparkle puff rather
    // than a column that hangs over the click point.
    const startRadius = Math.sqrt(Math.random()) * (0.45 + strength * 1.35);
    const outward = 2.2 + Math.random() * (3.8 + strength * 5.2);
    const tangent = (Math.random() - 0.5) * (0.55 + strength * 1.1);
    const upward = (Math.random() - 0.58) * (0.12 + strength * 0.28);
    const positionOffset = index * 3;
    const color = pickParticleColor(Math.random());

    this.positions[positionOffset] = center.x + Math.cos(angle) * startRadius;
    this.positions[positionOffset + 1] = center.y + PULSE_VERTICAL_LIFT +
      (Math.random() - 0.5) * PULSE_VERTICAL_JITTER;
    this.positions[positionOffset + 2] = center.z + Math.sin(angle) * startRadius;
    this.velocities[positionOffset] = Math.cos(angle) * outward - Math.sin(angle) * tangent;
    this.velocities[positionOffset + 1] = upward;
    this.velocities[positionOffset + 2] = Math.sin(angle) * outward + Math.cos(angle) * tangent;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = PULSE_LIFETIME_BASE + Math.random() * PULSE_LIFETIME_VARIANCE;
    this.baseAlphas[index] = (PARTICLE_ALPHA_MIN + Math.random() * PARTICLE_ALPHA_VARIANCE) * 0.92;
    this.baseSizes[index] = 0.48 + Math.random() * (1.15 + strength * 0.52);
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
    this.cloudinesses[index] = 0;
  }

  private emitWakeParticle(
    center: THREE.Vector3,
    strength: number,
    movementStrength: number,
    direction: THREE.Vector2,
    right: THREE.Vector2
  ): void {
    const index = this.allocateParticleSlot();

    // A true tail wants anisotropy: long behind the avatar, tight sideways, and
    // almost no vertical throw. The field wake texture handles the broad water
    // disturbance; these motes are just the glowing core shedding light.
    const tailT = Math.random();
    const tailDistance = 0.22 + tailT * tailT * (1.1 + movementStrength * 3.1);
    const lateralSpread = 0.08 + tailT * (0.18 + movementStrength * 0.28);
    const lateral = (Math.random() - 0.5) * lateralSpread;
    const heightJitter = (Math.random() - 0.5) *
      (WAKE_VERTICAL_JITTER_BASE + movementStrength * WAKE_VERTICAL_JITTER_MOVEMENT_BONUS);
    const backwardDrift = 0.1 + Math.random() * (0.22 + movementStrength * 0.34);
    const lateralDrift = (Math.random() - 0.5) * (0.06 + movementStrength * 0.16);
    const upward = (Math.random() - 0.56) * (0.05 + movementStrength * 0.09);
    const positionOffset = index * 3;
    const color = pickParticleColor(Math.random());

    this.positions[positionOffset] = center.x - direction.x * tailDistance + right.x * lateral;
    this.positions[positionOffset + 1] = center.y + WAKE_VERTICAL_LIFT + heightJitter;
    this.positions[positionOffset + 2] = center.z - direction.y * tailDistance + right.y * lateral;
    this.velocities[positionOffset] = -direction.x * backwardDrift + right.x * lateralDrift;
    this.velocities[positionOffset + 1] = upward;
    this.velocities[positionOffset + 2] = -direction.y * backwardDrift + right.y * lateralDrift;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = 0.42 + Math.random() * 0.76;
    this.baseAlphas[index] = (PARTICLE_ALPHA_MIN + Math.random() * PARTICLE_ALPHA_VARIANCE) * 0.98;
    this.baseSizes[index] = 0.36 + Math.random() * (0.72 + strength * 0.3);
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
    this.cloudinesses[index] = 0;
  }

  private emitDiscCloudParticle(center: THREE.Vector3, strength: number, discRadius: number): void {
    const index = this.allocateParticleSlot();

    const angle = Math.random() * Math.PI * 2;
    const normalizedRadius = Math.sqrt(Math.random());
    const radius = normalizedRadius * discRadius * (0.36 + Math.random() * 0.74);
    const outward = (1.8 + Math.random() * 3.8 + strength * 2.2) * (0.45 + normalizedRadius * 0.7);
    const tangent = (Math.random() - 0.5) * (1.2 + strength * 1.1);
    const lift = (Math.random() - 0.32) * (0.12 + strength * 0.2);
    const positionOffset = index * 3;
    const color = pickDiscCloudColor(Math.random());

    this.positions[positionOffset] = center.x + Math.cos(angle) * radius;
    this.positions[positionOffset + 1] = center.y + (Math.random() - 0.48) * 0.7;
    this.positions[positionOffset + 2] = center.z + Math.sin(angle) * radius;
    this.velocities[positionOffset] = Math.cos(angle) * outward - Math.sin(angle) * tangent;
    this.velocities[positionOffset + 1] = lift;
    this.velocities[positionOffset + 2] = Math.sin(angle) * outward + Math.cos(angle) * tangent;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = 0.52 + Math.random() * 0.78;
    this.baseAlphas[index] = 0.052 + Math.random() * 0.082;
    this.baseSizes[index] = 6.8 + Math.random() * (9.4 + strength * 4.2);
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
    this.cloudinesses[index] = 1;
  }

  private emitDiscParticle(center: THREE.Vector3, strength: number, discRadius: number): void {
    const index = this.allocateParticleSlot();

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
    this.positions[positionOffset + 1] = center.y + (Math.random() - 0.48) * 0.62;
    this.positions[positionOffset + 2] = center.z + Math.sin(angle) * radius;
    this.velocities[positionOffset] = Math.cos(angle) * outward - Math.sin(angle) * tangent;
    this.velocities[positionOffset + 1] = lift;
    this.velocities[positionOffset + 2] = Math.sin(angle) * outward + Math.cos(angle) * tangent;
    this.colors[positionOffset] = color.r;
    this.colors[positionOffset + 1] = color.g;
    this.colors[positionOffset + 2] = color.b;
    this.ages[index] = 0;
    this.lifetimes[index] = 0.58 + Math.random() * 0.88;
    this.baseAlphas[index] = PARTICLE_ALPHA_MIN + 0.3 + Math.random() * (PARTICLE_ALPHA_VARIANCE + 0.22);
    this.baseSizes[index] = 1.1 + Math.random() * (2.2 + strength * 1.15);
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
    this.cloudinesses[index] = 0;
  }

  private markDirty(includeStaticParticleData: boolean): void {
    this.geometry.setDrawRange(0, this.activeCount);
    markAttributeRange(this.positionAttribute, 0, this.activeCount * 3);
    markAttributeRange(this.alphaAttribute, 0, this.activeCount);
    markAttributeRange(this.sizeAttribute, 0, this.activeCount);

    if (!includeStaticParticleData) return;
    if (this.staticDirtyMaxIndex < this.staticDirtyMinIndex) return;

    const dirtyStart = Math.max(0, this.staticDirtyMinIndex);
    const dirtyEnd = Math.min(this.activeCount - 1, this.staticDirtyMaxIndex);
    const dirtyCount = dirtyEnd - dirtyStart + 1;
    if (dirtyCount > 0) {
      markAttributeRange(this.colorAttribute, dirtyStart * 3, dirtyCount * 3);
      markAttributeRange(this.twinkleAttribute, dirtyStart, dirtyCount);
      markAttributeRange(this.cloudinessAttribute, dirtyStart, dirtyCount);
    }
    this.clearStaticDirtyRange();
  }

  private allocateParticleSlot(): number {
    if (this.activeCount < this.capacity) {
      const index = this.activeCount;
      this.activeCount += 1;
      this.markParticleStaticDataDirty(index);
      return index;
    }

    const index = this.cursor;
    this.cursor = (this.cursor + 1) % Math.max(1, this.activeCount);
    this.markParticleStaticDataDirty(index);
    return index;
  }

  private deactivateParticle(index: number): void {
    const lastIndex = this.activeCount - 1;
    if (index !== lastIndex) {
      this.copyParticleSlot(lastIndex, index);
    }

    this.seedDormantParticle(lastIndex);
    this.activeCount -= 1;
    this.cursor = this.activeCount > 0 ? this.cursor % this.activeCount : 0;
    this.geometry.setDrawRange(0, this.activeCount);
  }

  private copyParticleSlot(fromIndex: number, toIndex: number): void {
    copyVec3(this.positions, fromIndex, toIndex);
    copyVec3(this.velocities, fromIndex, toIndex);
    copyVec3(this.colors, fromIndex, toIndex);
    this.alphas[toIndex] = this.alphas[fromIndex];
    this.sizes[toIndex] = this.sizes[fromIndex];
    this.twinkles[toIndex] = this.twinkles[fromIndex];
    this.cloudinesses[toIndex] = this.cloudinesses[fromIndex];
    this.ages[toIndex] = this.ages[fromIndex];
    this.lifetimes[toIndex] = this.lifetimes[fromIndex];
    this.baseSizes[toIndex] = this.baseSizes[fromIndex];
    this.baseAlphas[toIndex] = this.baseAlphas[fromIndex];
    this.markParticleStaticDataDirty(toIndex);
  }

  private getContinuousEmissionScale(): number {
    if (this.capacity <= 0) return 0;

    const pressure = this.activeCount / this.capacity;
    const throttle = smoothstep(
      CONTINUOUS_EMISSION_THROTTLE_START,
      CONTINUOUS_EMISSION_THROTTLE_END,
      pressure
    );
    return THREE.MathUtils.lerp(1, CONTINUOUS_EMISSION_MIN_SCALE, throttle);
  }

  private markParticleStaticDataDirty(index: number): void {
    this.staticDirtyMinIndex = Math.min(this.staticDirtyMinIndex, index);
    this.staticDirtyMaxIndex = Math.max(this.staticDirtyMaxIndex, index);
  }

  private clearStaticDirtyRange(): void {
    this.staticDirtyMinIndex = Number.POSITIVE_INFINITY;
    this.staticDirtyMaxIndex = -1;
  }
}

function pickParticleColor(seed: number): THREE.Color {
  if (seed < 0.5) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.4);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.5) * 1.2);
}

function pickDiscCloudColor(seed: number): THREE.Color {
  if (seed < 0.58) return TEMP_COLOR.copy(TURQUOISE).lerp(PALE_CYAN, seed * 0.92);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.58) * 1.08);
}

function createDynamicAttribute(array: Float32Array, itemSize: number): THREE.BufferAttribute {
  // Higher particle caps keep the GPU vertex budget high, while this hint tells
  // Three these buffers are expected to be rewritten as particles move.
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}

function markAttributeRange(attribute: THREE.BufferAttribute, componentOffset: number, componentCount: number): void {
  attribute.clearUpdateRanges();
  if (componentCount <= 0) return;
  attribute.addUpdateRange(componentOffset, componentCount);
  attribute.needsUpdate = true;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function copyVec3(array: Float32Array, fromIndex: number, toIndex: number): void {
  const fromOffset = fromIndex * 3;
  const toOffset = toIndex * 3;
  array[toOffset] = array[fromOffset];
  array[toOffset + 1] = array[fromOffset + 1];
  array[toOffset + 2] = array[fromOffset + 2];
}
