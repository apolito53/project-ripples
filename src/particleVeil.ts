import * as THREE from "three";

type Particle = {
  age: number;
  life: number;
  size: number;
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
  private cursor = 0;

  constructor(scene: THREE.Scene, budget: number, pixelRatio: number) {
    this.positions = new Float32Array(budget * 3);
    this.velocities = new Float32Array(budget * 3);
    this.colors = new Float32Array(budget * 3);
    this.alphas = new Float32Array(budget);
    this.sizes = new Float32Array(budget);

    for (let index = 0; index < budget; index += 1) {
      this.particles.push({ age: 999, life: 1, size: 0 });
      this.seedDormantParticle(index);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uPixelRatio: { value: pixelRatio }
      },
      vertexShader: `
        uniform float uPixelRatio;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uPixelRatio * (280.0 / max(8.0, -mvPosition.z));
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          float softDisc = smoothstep(0.5, 0.05, dist);
          float hotCore = smoothstep(0.18, 0.0, dist);
          gl_FragColor = vec4(vColor * (0.65 + hotCore * 1.8), softDisc * vAlpha);
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
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.particles.length;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 1.4;
      const upward = 1.5 + Math.random() * 4.2 * strength;
      const outward = 1.2 + Math.random() * 7.5 * strength;
      const positionOffset = index * 3;
      const color = pickParticleColor(Math.random());

      this.positions[positionOffset] = center.x + Math.cos(angle) * radius;
      this.positions[positionOffset + 1] = center.y + Math.random() * 1.2;
      this.positions[positionOffset + 2] = center.z + Math.sin(angle) * radius;
      this.velocities[positionOffset] = Math.cos(angle) * outward;
      this.velocities[positionOffset + 1] = upward;
      this.velocities[positionOffset + 2] = Math.sin(angle) * outward;
      this.colors[positionOffset] = color.r;
      this.colors[positionOffset + 1] = color.g;
      this.colors[positionOffset + 2] = color.b;
      this.alphas[index] = 0.95;
      this.sizes[index] = 15 + Math.random() * 42 * strength;
      this.particles[index] = {
        age: 0,
        life: 1.1 + Math.random() * 1.9,
        size: this.sizes[index]
      };
    }

    this.markDirty();
  }

  spawnWake(center: THREE.Vector3, movementStrength: number): void {
    if (movementStrength <= 0.08 || Math.random() > movementStrength * 0.55) return;
    this.spawnBurst(center, 3 + Math.floor(movementStrength * 9), 0.28 + movementStrength * 0.35);
  }

  update(delta: number): void {
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (particle.age >= particle.life) continue;

      particle.age += delta;
      const offset = index * 3;
      const normalizedAge = Math.min(1, particle.age / particle.life);
      const drag = Math.exp(-delta * 0.65);

      this.velocities[offset] *= drag;
      this.velocities[offset + 1] = this.velocities[offset + 1] * drag - delta * 2.2;
      this.velocities[offset + 2] *= drag;
      this.positions[offset] += this.velocities[offset] * delta;
      this.positions[offset + 1] += this.velocities[offset + 1] * delta;
      this.positions[offset + 2] += this.velocities[offset + 2] * delta;
      this.alphas[index] = Math.pow(1 - normalizedAge, 1.65);
      this.sizes[index] = particle.size * (1 + normalizedAge * 1.15);
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

  private markDirty(): void {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }
}

function pickParticleColor(seed: number): THREE.Color {
  if (seed < 0.5) return TEMP_COLOR.copy(TURQUOISE).lerp(VIOLET, seed * 1.4);
  return TEMP_COLOR.copy(TURQUOISE).lerp(GOLD, (seed - 0.5) * 1.2);
}
