import * as THREE from "three";
import {
  PARTICLE_SHADER_ENERGY_GAIN,
  ParticleVeilState,
  type ParticleStateSnapshot
} from "./particleState";

export class ParticleVeil {
  readonly points: THREE.Points;
  private readonly state: ParticleVeilState;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly alphaAttribute: THREE.BufferAttribute;
  private readonly sizeAttribute: THREE.BufferAttribute;
  private readonly twinkleAttribute: THREE.BufferAttribute;
  private readonly cloudinessAttribute: THREE.BufferAttribute;
  private lastSyncedVersion = -1;

  constructor(scene: THREE.Scene, budget: number, pixelRatio: number, state = new ParticleVeilState(budget)) {
    this.state = state;
    const snapshot = this.state.getSnapshot();

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = createDynamicAttribute(snapshot.positions, 3);
    this.colorAttribute = createDynamicAttribute(snapshot.colors, 3);
    this.alphaAttribute = createDynamicAttribute(snapshot.alphas, 1);
    this.sizeAttribute = createDynamicAttribute(snapshot.sizes, 1);
    this.twinkleAttribute = createDynamicAttribute(snapshot.twinkles, 1);
    this.cloudinessAttribute = createDynamicAttribute(snapshot.cloudinesses, 1);
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
    this.syncGeometry();
  }

  resizeBudget(scene: THREE.Scene, budget: number, pixelRatio: number): ParticleVeil {
    this.dispose();
    return new ParticleVeil(scene, budget, pixelRatio);
  }

  setPixelRatio(pixelRatio: number): void {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  getActiveCount(): number {
    return this.state.getActiveCount();
  }

  getSnapshot(): ParticleStateSnapshot {
    return this.state.getSnapshot();
  }

  clear(): void {
    this.state.clear();
    this.syncGeometry();
  }

  setEnabled(enabled: boolean): void {
    this.points.visible = enabled;
    this.state.setEnabled(enabled);
    this.syncGeometry();
  }

  spawnBurst(center: THREE.Vector3, count: number, strength: number): void {
    this.state.spawnBurst(center, count, strength);
    this.syncGeometry();
  }

  spawnPulseBurst(center: THREE.Vector3, count: number, strength: number): void {
    this.state.spawnPulseBurst(center, count, strength);
    this.syncGeometry();
  }

  spawnDiscBurst(center: THREE.Vector3, count: number, strength: number, radius: number): number {
    const emittedParticleCount = this.state.spawnDiscBurst(center, count, strength, radius);
    this.syncGeometry();
    return emittedParticleCount;
  }

  spawnAura(center: THREE.Vector3, delta: number, movementStrength: number): void {
    this.state.spawnAura(center, delta, movementStrength);
    this.syncGeometry();
  }

  spawnWake(center: THREE.Vector3, delta: number, movementStrength: number, movementVelocity: THREE.Vector3): void {
    this.state.spawnWake(center, delta, movementStrength, movementVelocity);
    this.syncGeometry();
  }

  update(delta: number): void {
    this.state.update(delta);
    this.material.uniforms.uTime.value = this.state.getElapsedSeconds();
    this.syncGeometry();
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private syncGeometry(): void {
    const snapshot = this.state.getSnapshot();
    this.geometry.setDrawRange(0, snapshot.activeParticles);
    if (snapshot.version === this.lastSyncedVersion) return;

    markAttributeRange(this.positionAttribute, snapshot.dynamicDirtyStart * 3, snapshot.dynamicDirtyCount * 3);
    markAttributeRange(this.alphaAttribute, snapshot.dynamicDirtyStart, snapshot.dynamicDirtyCount);
    markAttributeRange(this.sizeAttribute, snapshot.dynamicDirtyStart, snapshot.dynamicDirtyCount);

    if (snapshot.staticDirtyCount > 0) {
      markAttributeRange(this.colorAttribute, snapshot.staticDirtyStart * 3, snapshot.staticDirtyCount * 3);
      markAttributeRange(this.twinkleAttribute, snapshot.staticDirtyStart, snapshot.staticDirtyCount);
      markAttributeRange(this.cloudinessAttribute, snapshot.staticDirtyStart, snapshot.staticDirtyCount);
      this.state.clearStaticDirtyRange();
    }

    this.lastSyncedVersion = snapshot.version;
  }
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
