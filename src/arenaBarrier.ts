import * as THREE from "three";

const BARRIER_HEIGHT = 20;
const BARRIER_BASE_Y = -2.85;
const BARRIER_SEGMENTS = 256;
const WALL_RENDER_ORDER = 2;

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

    scene.add(this.object);
    this.setRadius(1);
  }

  setRadius(radius: number): void {
    this.radius = Math.max(1, radius);

    // The wall geometry is built as a unit cylinder and scaled into place. That
    // lets arena-size slider changes reuse GPU buffers instead of rebuilding a
    // dense transparent mesh every time the radius changes.
    this.wall.scale.set(this.radius, BARRIER_HEIGHT, this.radius);
  }

  update(time: number): void {
    this.wallUniforms.uTime.value = time;
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
        float height01 = vLocalPosition.y + 0.5;
        float visibleBody = smoothstep(0.0, 0.1, height01) * (1.0 - smoothstep(0.94, 1.0, height01));
        float baseGlow = 1.0 - smoothstep(0.02, 0.24, height01);
        float crownGlow = smoothstep(0.56, 0.96, height01);
        float centerGlow = smoothstep(0.08, 0.42, height01) * (1.0 - smoothstep(0.72, 0.96, height01));
        float breath = 0.94 + sin(uTime * 0.62) * 0.06;

        // Keep the boundary as a clean energy gradient. The old scan-line and
        // angle wisps looked like a tiled wall texture once the camera got low.
        vec3 baseCyan = vec3(0.02, 0.95, 0.92);
        vec3 deepBlue = vec3(0.02, 0.17, 0.34);
        vec3 upperViolet = vec3(0.34, 0.42, 1.0);
        vec3 whiteEdge = vec3(0.86, 1.0, 0.96);
        vec3 color = mix(baseCyan, deepBlue, smoothstep(0.0, 0.54, height01));
        color = mix(color, upperViolet, smoothstep(0.5, 1.0, height01) * 0.42);
        color = mix(color, whiteEdge, baseGlow * 0.26 + crownGlow * 0.18);

        float alpha = visibleBody * breath * (0.018 + baseGlow * 0.07 + centerGlow * 0.025 + crownGlow * 0.03);
        gl_FragColor = vec4(color * (1.02 + baseGlow * 0.7 + crownGlow * 0.34), alpha);
      }
    `
  });
}
