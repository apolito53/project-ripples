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
  readonly object: THREE.Group;
  readonly disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly core: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
};

const DISC_COLOR = 0x54ffe1;
const RING_COLOR = 0x9ba7ff;
const CORE_COLOR = 0xffd36a;

export class EchoZoneField {
  private readonly scene: THREE.Scene;
  private readonly discGeometry = new THREE.CircleGeometry(1, 80);
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

    const disc = new THREE.Mesh(
      this.discGeometry,
      new THREE.MeshBasicMaterial({
        color: DISC_COLOR,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    disc.name = "Echo collectible disc";
    disc.rotation.x = -Math.PI / 2;
    object.add(disc);

    const ring = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.64,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    ring.name = "Echo collectible rim";
    ring.rotation.x = -Math.PI / 2;
    object.add(ring);

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
    core.position.y = 0.58;
    object.add(core);

    this.scene.add(object);
    this.zones.push({
      ...options,
      id: this.nextId,
      position: position.clone(),
      spawnTime: startTime,
      // Every zone breathes slightly out of phase so a cluster feels alive
      // instead of looking like one copied mesh blinking in sync.
      phase: Math.random() * Math.PI * 2,
      object,
      disc,
      ring,
      core
    });
    this.nextId += 1;
  }

  update(time: number): void {
    for (const zone of this.zones) {
      const age = time - zone.spawnTime;
      const pulse = Math.sin(age * 2.4 + zone.phase) * 0.5 + 0.5;
      const slowSpin = age * 0.45 + zone.phase;
      const radiusPulse = 1 + pulse * 0.08;

      // The marker sits just above the field and breathes horizontally. The
      // trigger stays a stable radius, so the visual flourish never changes
      // the player's actual collection hit area.
      zone.object.position.y = zone.position.y + Math.sin(age * 3 + zone.phase) * 0.045;
      zone.object.rotation.y = slowSpin;
      zone.disc.scale.setScalar(zone.radius * (0.9 + pulse * 0.1));
      zone.ring.scale.setScalar(zone.radius * radiusPulse);
      zone.core.scale.setScalar(0.78 + pulse * 0.28);
      zone.disc.material.opacity = 0.08 + pulse * 0.1;
      zone.ring.material.opacity = 0.46 + pulse * 0.28;
      zone.core.material.opacity = 0.38 + pulse * 0.34;
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
    this.discGeometry.dispose();
    this.ringGeometry.dispose();
    this.coreGeometry.dispose();
  }

  private removeAt(index: number): void {
    const [zone] = this.zones.splice(index, 1);
    zone.object.removeFromParent();
    zone.disc.material.dispose();
    zone.ring.material.dispose();
    zone.core.material.dispose();
  }
}
