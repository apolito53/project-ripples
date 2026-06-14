import * as THREE from "three";

type Particle = {
  age: number;
  life: number;
  size: number;
  baseAlpha: number;
};

const TEMP_COLOR = new THREE.Color();
const TURQUOISE = new THREE.Color(0x7dffd8);
const VIOLET = new THREE.Color(0x7f7dff);
const GOLD = new THREE.Color(0xffd36a);

export class ParticleVeil {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly twinkles: Float32Array;
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

    for (let index = 0; index < budget; index += 1) {
      this.particles.push({ age: 999, life: 1, size: 0, baseAlpha: 0 });
      this.seedDormantParticle(index);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(this.twinkles, 1));

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
          gl_FragColor = vec4(vColor * (0.76 + pinCore * 1.45 + vTwinkle * 0.2), alpha);
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

  spawnBurst(center: THREE.Vector3, count: number, strength: number): void {
    for (let burstIndex = 0; burstIndex < count; burstIndex += 1) {
      this.emitCloudParticle(center, strength, 1, 1, 0.9);
    }

    this.markDirty();
  }

  spawnAura(center: THREE.Vector3, delta: number, movementStrength: number): void {
    // The avatar should feel wrapped in particulate light even while idle. The
    // accumulator makes the emission rate frame-rate independent, so a slow
    // machine does not get a thinner cloud just because fewer frames ran.
    const particlesPerSecond = 225 + movementStrength * 175;
    this.auraAccumulator += delta * particlesPerSecond;
    const count = Math.min(34, Math.floor(this.auraAccumulator));
    if (count <= 0) return;

    this.auraAccumulator -= count;
    for (let auraIndex = 0; auraIndex < count; auraIndex += 1) {
      this.emitCloudParticle(center, 0.12 + movementStrength * 0.16, 0.7, 0.92, 0.05);
    }

    this.markDirty();
  }

  spawnWake(center: THREE.Vector3, movementStrength: number): void {
    if (movementStrength <= 0.08 || Math.random() > movementStrength * 0.55) return;
    this.spawnBurst(center, 14 + Math.floor(movementStrength * 36), 0.12 + movementStrength * 0.16);
  }

  update(delta: number): void {
    this.elapsedSeconds += delta;
    this.material.uniforms.uTime.value = this.elapsedSeconds;

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (particle.age >= particle.life) continue;

      particle.age += delta;
      const offset = index * 3;
      const normalizedAge = Math.min(1, particle.age / particle.life);
      const drag = Math.exp(-delta * 0.9);
      const fadeIn = Math.sin(Math.min(1, normalizedAge * 3.2) * Math.PI * 0.5);
      const fadeOut = Math.pow(1 - normalizedAge, 1.28);

      this.velocities[offset] *= drag;
      this.velocities[offset + 1] = this.velocities[offset + 1] * drag - delta * 0.42;
      this.velocities[offset + 2] *= drag;
      this.positions[offset] += this.velocities[offset] * delta;
      this.positions[offset + 1] += this.velocities[offset + 1] * delta;
      this.positions[offset + 2] += this.velocities[offset + 2] * delta;
      this.alphas[index] = particle.baseAlpha * fadeIn * fadeOut;
      this.sizes[index] = particle.size * (0.92 + Math.sin(normalizedAge * Math.PI) * 0.08);
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
  }

  private emitCloudParticle(
    center: THREE.Vector3,
    strength: number,
    cloudScale: number,
    alphaScale: number,
    verticalLift: number
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.particles.length;

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
    this.alphas[index] = (0.11 + Math.random() * 0.12) * alphaScale;
    this.sizes[index] = (0.45 + Math.random() * (1.05 + strength * 0.58)) * cloudScale;
    this.twinkles[index] = Math.random();
    this.particles[index] = {
      age: 0,
      life: 0.9 + Math.random() * 1.85,
      size: this.sizes[index],
      baseAlpha: this.alphas[index]
    };
  }

  private markDirty(): void {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aTwinkle.needsUpdate = true;
  }
}

function pickParticleColor(seed: number): THREE.Color {
  if (seed < 0.5) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.4);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.5) * 1.2);
}
