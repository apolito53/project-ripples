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
  readonly columnRadius: number;
  readonly object: THREE.Group;
  readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly lowerRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly upperRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly core: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
};

const BEAM_COLOR = 0x54ffe1;
const RING_COLOR = 0x95a7ff;
const CORE_COLOR = 0xffd36a;
const MOTE_COLOR = 0x7dffd8;
const COLUMN_HEIGHT = 7.4;
const COLUMN_BASE_LIFT = 1.45;
const SPARK_MOTE_COUNT = 120;

export class EchoZoneField {
  private readonly scene: THREE.Scene;
  private readonly beamGeometry = new THREE.CylinderGeometry(1, 1, COLUMN_HEIGHT, 48, 1, true);
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
    const columnRadius = Math.max(0.85, options.radius * 0.34);

    const beam = new THREE.Mesh(
      this.beamGeometry,
      new THREE.MeshBasicMaterial({
        color: BEAM_COLOR,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    beam.name = "Echo hovering sparkle column";
    beam.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;
    beam.scale.set(columnRadius * 0.55, 1, columnRadius * 0.55);
    object.add(beam);

    const lowerRing = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    lowerRing.name = "Echo floating lower halo";
    lowerRing.position.y = COLUMN_BASE_LIFT;
    lowerRing.rotation.x = -Math.PI / 2;
    lowerRing.scale.setScalar(columnRadius);
    object.add(lowerRing);

    const upperRing = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: BEAM_COLOR,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    upperRing.name = "Echo floating upper halo";
    upperRing.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT;
    upperRing.rotation.x = -Math.PI / 2;
    upperRing.scale.setScalar(columnRadius * 0.58);
    object.add(upperRing);

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
    core.position.y = COLUMN_BASE_LIFT + COLUMN_HEIGHT * 0.5;
    object.add(core);

    const motes = createSparkColumnMotes(columnRadius, COLUMN_HEIGHT, COLUMN_BASE_LIFT);
    object.add(motes);

    this.scene.add(object);
    this.zones.push({
      ...options,
      id: this.nextId,
      position: position.clone(),
      spawnTime: startTime,
      // Every zone breathes slightly out of phase so a cluster feels alive
      // instead of looking like one copied mesh blinking in sync.
      phase: Math.random() * Math.PI * 2,
      columnRadius,
      object,
      beam,
      lowerRing,
      upperRing,
      core,
      motes
    });
    this.nextId += 1;
  }

  update(time: number): void {
    for (const zone of this.zones) {
      const age = time - zone.spawnTime;
      const pulse = Math.sin(age * 2.4 + zone.phase) * 0.5 + 0.5;
      const slowSpin = age * 0.45 + zone.phase;
      const radiusPulse = 1 + pulse * 0.08;

      // Echoes used to be floor discs, which looked like UI and clipped through
      // displaced cubes. The new marker hovers as a vertical sparkle column:
      // visible from a distance, but safely above the cube tops.
      zone.object.position.y = zone.position.y + Math.sin(age * 3 + zone.phase) * 0.045;
      zone.object.rotation.y = slowSpin * 0.55;
      zone.beam.scale.set(zone.columnRadius * (0.42 + pulse * 0.13), 1, zone.columnRadius * (0.42 + pulse * 0.13));
      zone.lowerRing.rotation.z = slowSpin * 0.9;
      zone.upperRing.rotation.z = -slowSpin * 1.25;
      zone.lowerRing.scale.setScalar(zone.columnRadius * radiusPulse);
      zone.upperRing.scale.setScalar(zone.columnRadius * (0.55 + pulse * 0.1));
      zone.core.scale.setScalar(0.78 + pulse * 0.28);
      zone.motes.rotation.y = -slowSpin * 1.35;
      zone.motes.position.y = Math.sin(age * 4.2 + zone.phase) * 0.05;
      zone.beam.material.opacity = 0.055 + pulse * 0.095;
      zone.lowerRing.material.opacity = 0.38 + pulse * 0.28;
      zone.upperRing.material.opacity = 0.2 + pulse * 0.18;
      zone.core.material.opacity = 0.38 + pulse * 0.34;
      zone.motes.material.opacity = 0.55 + pulse * 0.3;
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
    this.beamGeometry.dispose();
    this.ringGeometry.dispose();
    this.coreGeometry.dispose();
  }

  private removeAt(index: number): void {
    const [zone] = this.zones.splice(index, 1);
    zone.object.removeFromParent();
    zone.beam.material.dispose();
    zone.lowerRing.material.dispose();
    zone.upperRing.material.dispose();
    zone.core.material.dispose();
    zone.motes.geometry.dispose();
    zone.motes.material.dispose();
  }
}

function createSparkColumnMotes(radius: number, height: number, baseLift: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(SPARK_MOTE_COUNT * 3);
  const colors = new Float32Array(SPARK_MOTE_COUNT * 3);
  const turquoise = new THREE.Color(MOTE_COLOR);
  const violet = new THREE.Color(RING_COLOR);
  const gold = new THREE.Color(CORE_COLOR);
  const color = new THREE.Color();

  for (let index = 0; index < SPARK_MOTE_COUNT; index += 1) {
    const positionOffset = index * 3;
    const angle = index * 2.399963 + Math.random() * 0.65;
    const heightRatio = Math.random();
    const ringBias = Math.random() < 0.68
      ? Math.sqrt(Math.random()) * radius * 0.78
      : radius * (0.7 + Math.random() * 0.36);
    const colorSeed = Math.random();

    positions[positionOffset] = Math.cos(angle) * ringBias;
    positions[positionOffset + 1] = baseLift + heightRatio * height;
    positions[positionOffset + 2] = Math.sin(angle) * ringBias;

    // A little color scatter keeps the marker in the existing cyan/violet/gold
    // family without becoming another flat monochrome target reticle.
    if (colorSeed < 0.72) {
      color.copy(turquoise).lerp(violet, colorSeed * 0.9);
    } else {
      color.copy(turquoise).lerp(gold, (colorSeed - 0.72) / 0.28);
    }
    colors[positionOffset] = color.r;
    colors[positionOffset + 1] = color.g;
    colors[positionOffset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    color: MOTE_COLOR,
    vertexColors: true,
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.74,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const motes = new THREE.Points(geometry, material);
  motes.name = "Echo column sparkle motes";
  motes.frustumCulled = false;
  return motes;
}
