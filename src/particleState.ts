import * as THREE from "three";
import { debugEvent } from "./debugLog";

const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(0x7dffd8);
const VIOLET = new THREE.Color(0x7f7dff);
const GOLD = new THREE.Color(0xffd36a);
const PALE_CYAN = new THREE.Color(0xdffcff);
const PARTICLE_ALPHA_MIN = 0.44;
const PARTICLE_ALPHA_VARIANCE = 0.38;
export const PARTICLE_SHADER_ENERGY_GAIN = 1.24;
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
const EMPTY_FLOATS = new Float32Array(0);

export type ParticleStateSnapshot = {
  readonly activeParticles: number;
  readonly particleBudget: number;
  readonly elapsedSeconds: number;
  readonly version: number;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
  readonly sizes: Float32Array;
  readonly twinkles: Float32Array;
  readonly cloudinesses: Float32Array;
  readonly dynamicDirtyStart: number;
  readonly dynamicDirtyCount: number;
  readonly staticDirtyStart: number;
  readonly staticDirtyCount: number;
};

export function createEmptyParticleStateSnapshot(): ParticleStateSnapshot {
  return {
    activeParticles: 0,
    particleBudget: 0,
    elapsedSeconds: 0,
    version: 0,
    positions: EMPTY_FLOATS,
    colors: EMPTY_FLOATS,
    alphas: EMPTY_FLOATS,
    sizes: EMPTY_FLOATS,
    twinkles: EMPTY_FLOATS,
    cloudinesses: EMPTY_FLOATS,
    dynamicDirtyStart: 0,
    dynamicDirtyCount: 0,
    staticDirtyStart: 0,
    staticDirtyCount: 0
  };
}

export class ParticleVeilState {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
  readonly sizes: Float32Array;
  readonly twinkles: Float32Array;
  readonly cloudinesses: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  readonly baseSizes: Float32Array;
  readonly baseAlphas: Float32Array;

  private activeCount = 0;
  private readonly capacity: number;
  private cursor = 0;
  private elapsedSeconds = 0;
  private auraAccumulator = 0;
  private wakeAccumulator = 0;
  private version = 0;
  private dynamicDirtyStart = 0;
  private dynamicDirtyCount = 0;
  private staticDirtyMinIndex = Number.POSITIVE_INFINITY;
  private staticDirtyMaxIndex = -1;

  constructor(budget: number) {
    this.capacity = Math.max(0, Math.floor(budget));
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.alphas = new Float32Array(this.capacity);
    this.sizes = new Float32Array(this.capacity);
    this.twinkles = new Float32Array(this.capacity);
    this.cloudinesses = new Float32Array(this.capacity);
    this.ages = new Float32Array(this.capacity);
    this.lifetimes = new Float32Array(this.capacity);
    this.baseSizes = new Float32Array(this.capacity);
    this.baseAlphas = new Float32Array(this.capacity);

    debugEvent("particle.state.init", "Particle state initialized", {
      particleBudget: this.capacity,
      activeParticles: this.activeCount
    }, "debug");
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getBudget(): number {
    return this.capacity;
  }

  getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  getSnapshot(): ParticleStateSnapshot {
    const staticDirtyCount = this.staticDirtyMaxIndex >= this.staticDirtyMinIndex
      ? this.staticDirtyMaxIndex - this.staticDirtyMinIndex + 1
      : 0;

    return {
      activeParticles: this.activeCount,
      particleBudget: this.capacity,
      elapsedSeconds: this.elapsedSeconds,
      version: this.version,
      positions: this.positions,
      colors: this.colors,
      alphas: this.alphas,
      sizes: this.sizes,
      twinkles: this.twinkles,
      cloudinesses: this.cloudinesses,
      dynamicDirtyStart: this.dynamicDirtyStart,
      dynamicDirtyCount: this.dynamicDirtyCount,
      staticDirtyStart: staticDirtyCount > 0 ? this.staticDirtyMinIndex : 0,
      staticDirtyCount
    };
  }

  clearStaticDirtyRange(): void {
    this.staticDirtyMinIndex = Number.POSITIVE_INFINITY;
    this.staticDirtyMaxIndex = -1;
  }

  clear(): void {
    // A new mode/session must not inherit motes from the previous play space.
    // Keep the resident arrays allocated so both renderers retain their budget.
    this.activeCount = 0;
    this.cursor = 0;
    this.auraAccumulator = 0;
    this.wakeAccumulator = 0;
    this.clearStaticDirtyRange();
    this.markDirty(false);
  }

  setEnabled(enabled: boolean): void {
    if (enabled) return;
    this.clear();
  }

  spawnBurst(center: THREE.Vector3, count: number, strength: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitCloudParticle(center, strength, 1, 1, 0.9);
    }

    this.markDirty(true);
  }

  spawnPulseBurst(center: THREE.Vector3, count: number, strength: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitPulseParticle(center, strength);
    }

    this.markDirty(true);
  }

  spawnDiscBurst(center: THREE.Vector3, count: number, strength: number, radius: number): number {
    const intensityBudget = Math.max(0, Math.floor(count));
    if (intensityBudget <= 0) return 0;

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

  spawnWake(center: THREE.Vector3, delta: number, movementStrength: number, movementVelocity: THREE.Vector3): void {
    const emissionScale = this.getContinuousEmissionScale();
    if (movementStrength <= 0.08 || delta <= 0 || emissionScale <= 0) return;

    TEMP_WAKE_DIRECTION.set(movementVelocity.x, movementVelocity.z);
    if (TEMP_WAKE_DIRECTION.lengthSq() <= 0.0001) return;
    TEMP_WAKE_DIRECTION.normalize();
    TEMP_WAKE_RIGHT.set(-TEMP_WAKE_DIRECTION.y, TEMP_WAKE_DIRECTION.x);

    const rawCount = WAKE_PARTICLE_COUNT_BASE + Math.floor(movementStrength * WAKE_PARTICLE_COUNT_MOVEMENT_BONUS);
    const particlesPerSecond = rawCount * movementStrength * 0.55 * emissionScale * emissionScale * 60;
    this.wakeAccumulator += delta * particlesPerSecond;
    const frameCap = Math.max(18, Math.floor(rawCount * emissionScale * 4));
    const count = Math.min(frameCap, Math.floor(this.wakeAccumulator));
    if (count <= 0) return;

    this.wakeAccumulator -= count;
    const strength = 0.12 + movementStrength * 0.16;
    for (let wakeIndex = 0; wakeIndex < count; wakeIndex += 1) {
      this.emitWakeParticle(center, strength, movementStrength, TEMP_WAKE_DIRECTION, TEMP_WAKE_RIGHT);
    }

    this.markDirty(true);
  }

  update(delta: number): void {
    this.elapsedSeconds += delta;
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

    if (this.activeCount > 0 || compactedParticleData) {
      this.markDirty(compactedParticleData);
    }
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
    if (index < 0) return;

    const angle = Math.random() * Math.PI * 2;
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
    this.baseAlphas[index] = (PARTICLE_ALPHA_MIN + Math.random() * PARTICLE_ALPHA_VARIANCE) * alphaScale;
    this.baseSizes[index] = (0.45 + Math.random() * (1.05 + strength * 0.58)) * cloudScale;
    this.alphas[index] = this.baseAlphas[index];
    this.sizes[index] = this.baseSizes[index];
    this.twinkles[index] = Math.random();
    this.cloudinesses[index] = 0;
  }

  private emitPulseParticle(center: THREE.Vector3, strength: number): void {
    const index = this.allocateParticleSlot();
    if (index < 0) return;

    const angle = Math.random() * Math.PI * 2;
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
    if (index < 0) return;

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
    if (index < 0) return;

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
    if (index < 0) return;

    const angle = Math.random() * Math.PI * 2;
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
    this.version += 1;
    this.dynamicDirtyStart = 0;
    this.dynamicDirtyCount = this.activeCount;
    if (includeStaticParticleData && this.staticDirtyMaxIndex >= this.staticDirtyMinIndex) {
      return;
    }
  }

  private allocateParticleSlot(): number {
    if (this.capacity <= 0) return -1;

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
}

function pickParticleColor(seed: number): THREE.Color {
  if (seed < 0.5) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.4);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.5) * 1.2);
}

function pickDiscCloudColor(seed: number): THREE.Color {
  if (seed < 0.58) return TEMP_COLOR.copy(TURQUOISE).lerp(PALE_CYAN, seed * 0.92);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.58) * 1.08);
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
