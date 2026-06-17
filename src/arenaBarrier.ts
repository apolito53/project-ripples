import * as THREE from "three";

const BARRIER_HEIGHT = 20;
const BARRIER_BASE_Y = -2.85;
const BARRIER_SEGMENTS = 256;
const WALL_RENDER_ORDER = 2;
const RING_RENDER_ORDER = 5;

type BarrierShaderUniforms = {
  readonly uTime: { value: number };
};

/**
 * Draws the visible "you are leaving the lab" edge around the circular arena.
 *
 * This is intentionally visual-only: PlayerRig still owns the real collision
 * clamp. Keeping the barrier out of gameplay logic means we can make it glow,
 * breathe, and drift without risking a mismatch between visuals and physics.
 */
export class ArenaBarrier {
  readonly object = new THREE.Group();
  private readonly wall: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly lowerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly middleRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly upperRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly wallUniforms: BarrierShaderUniforms;
  private radius = 1;

  constructor(scene: THREE.Scene) {
    this.object.name = "Glowing arena boundary barrier";
    this.wallUniforms = { uTime: { value: 0 } };

    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, BARRIER_SEGMENTS, 1, true),
      createBarrierWallMaterial(this.wallUniforms)
    );
    this.wall.name = "Volumetric arena edge curtain";
    this.wall.position.y = BARRIER_BASE_Y + BARRIER_HEIGHT * 0.5;
    this.wall.renderOrder = WALL_RENDER_ORDER;
    this.object.add(this.wall);

    this.lowerRing = createBarrierRing("Lower arena edge glow", 0x45fff0, 0.5);
    this.middleRing = createBarrierRing("Middle arena edge haze", 0x8aa8ff, 0.18);
    this.upperRing = createBarrierRing("Upper arena edge glint", 0xf9fcff, 0.24);
    this.object.add(this.lowerRing, this.middleRing, this.upperRing);

    scene.add(this.object);
    this.setRadius(1);
  }

  setRadius(radius: number): void {
    this.radius = Math.max(1, radius);

    // The wall geometry is built as a unit cylinder and scaled into place. That
    // lets arena-size slider changes reuse GPU buffers instead of rebuilding a
    // dense transparent mesh every time the radius changes.
    this.wall.scale.set(this.radius, BARRIER_HEIGHT, this.radius);
    this.placeRing(this.lowerRing, BARRIER_BASE_Y + 0.22, this.radius);
    this.placeRing(this.middleRing, BARRIER_BASE_Y + BARRIER_HEIGHT * 0.46, this.radius * 0.997);
    this.placeRing(this.upperRing, BARRIER_BASE_Y + BARRIER_HEIGHT - 0.35, this.radius * 0.992);
  }

  update(time: number): void {
    this.wallUniforms.uTime.value = time;

    // The rings breathe just enough to sell "energy field" without making the
    // boundary look like a target reticle. Tiny offsets also avoid z-fighting
    // if the camera grazes the wall at a shallow angle.
    const slowPulse = Math.sin(time * 0.9) * 0.5 + 0.5;
    this.lowerRing.material.opacity = 0.42 + slowPulse * 0.12;
    this.middleRing.material.opacity = 0.14 + slowPulse * 0.08;
    this.upperRing.material.opacity = 0.18 + slowPulse * 0.1;
    this.middleRing.rotation.z = time * 0.03;
    this.upperRing.rotation.z = -time * 0.05;
  }

  private placeRing(
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>,
    y: number,
    radius: number
  ): void {
    ring.position.y = y;
    ring.scale.set(radius, radius, 1);
  }
}

function createBarrierWallMaterial(uniforms: BarrierShaderUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vLocalPosition;

      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vLocalPosition;

      void main() {
        float angle = atan(vLocalPosition.z, vLocalPosition.x);
        float height01 = vLocalPosition.y + 0.5;
        float verticalFade = smoothstep(0.0, 0.12, height01) * (1.0 - smoothstep(0.82, 1.0, height01));
        float bottomMist = 1.0 - smoothstep(0.02, 0.32, height01);
        float crownMist = smoothstep(0.58, 0.94, height01);
        float wideWisp = sin(angle * 18.0 + uTime * 0.55 + height01 * 7.0) * 0.5 + 0.5;
        float fineWisp = sin(angle * 53.0 - uTime * 1.15 + height01 * 16.0) * 0.5 + 0.5;
        float wisp = smoothstep(0.46, 0.96, wideWisp * 0.68 + fineWisp * 0.32);
        float scanLine = pow(1.0 - abs(sin(height01 * 18.0 - uTime * 1.35 + angle * 1.8)), 5.0);
        float alpha = verticalFade * (0.018 + bottomMist * 0.055 + crownMist * 0.018 + wisp * 0.048 + scanLine * 0.024);
        vec3 deepCyan = vec3(0.08, 0.86, 0.95);
        vec3 violet = vec3(0.34, 0.33, 1.0);
        vec3 whiteHot = vec3(0.92, 1.0, 0.98);
        vec3 color = mix(deepCyan, violet, height01 * 0.42 + wisp * 0.24);
        color = mix(color, whiteHot, scanLine * 0.4 + crownMist * 0.18);

        gl_FragColor = vec4(color * (0.9 + wisp * 0.65 + scanLine * 0.7), alpha);
      }
    `
  });
}

function createBarrierRing(
  name: string,
  color: number,
  opacity: number
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.994, 1.006, BARRIER_SEGMENTS),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    })
  );
  ring.name = name;
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = RING_RENDER_ORDER;
  return ring;
}
