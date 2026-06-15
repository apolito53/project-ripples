import * as THREE from "three";

export type PlayerRigOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly sampleHeight: (x: number, z: number) => number;
  readonly getBoundaryRadius: () => number;
  readonly onPulse: (position: THREE.Vector3) => void;
};

const WALK_SPEED = 8.4;
const SPRINT_MULTIPLIER = 1.65;
const MOVE_ACCELERATION = 16;
const MOVE_BRAKE = 22;
const STOP_EPSILON = 0.035;
const CAMERA_DISTANCE = 15;
const CAMERA_TARGET_HEIGHT = 0.58;
const CAMERA_PITCH_RANGE = { min: 0.18, max: 0.82 };
const CAMERA_SMOOTHING = 1 - Math.exp(-14 / 60);
// This is a visual hover height, not a collision capsule. Keeping the avatar
// above the fabric prevents nearby displaced blocks from swallowing the marker.
const PLAYER_HEIGHT = 1.75;
const PULSE_DISTANCE = 4.2;
const PULSE_COOLDOWN_SECONDS = 0.42;
const LOOK_SENSITIVITY_X = 0.002;
const LOOK_SENSITIVITY_Y = 0.00155;
const TOUCH_LOOK_RATE_X = 2.65;
const TOUCH_LOOK_RATE_Y = 2.05;


export class PlayerRig {
  readonly position = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
  readonly velocity = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sampleHeight: (x: number, z: number) => number;
  private readonly getBoundaryRadius: () => number;
  private readonly onPulse: (position: THREE.Vector3) => void;
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly movementIntent = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly mobileMoveIntent = new THREE.Vector2();
  private readonly mobileLookIntent = new THREE.Vector2();
  private lastPulseSecond = -Infinity;
  private yaw = Math.PI * 0.23;
  private pitch = 0.45;

  constructor(options: PlayerRigOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.sampleHeight = options.sampleHeight;
    this.getBoundaryRadius = options.getBoundaryRadius;
    this.onPulse = options.onPulse;

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
  }

  update(delta: number): void {
    this.applyMobileLook(delta);

    const forward = this.getPlanarForward();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const intent = this.movementIntent.set(0, 0, 0);

    if (this.keys.has("KeyW")) intent.add(forward);
    if (this.keys.has("KeyS")) intent.sub(forward);
    if (this.keys.has("KeyA")) intent.add(right);
    if (this.keys.has("KeyD")) intent.sub(right);
    if (this.mobileMoveIntent.y !== 0) intent.addScaledVector(forward, this.mobileMoveIntent.y);
    if (this.mobileMoveIntent.x !== 0) intent.addScaledVector(right, -this.mobileMoveIntent.x);

    const hasIntent = intent.lengthSq() > 0;
    if (hasIntent) intent.normalize();
    const speed = WALK_SPEED * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? SPRINT_MULTIPLIER : 1);
    const targetVelocity = intent.multiplyScalar(speed);
    const response = hasIntent ? MOVE_ACCELERATION : MOVE_BRAKE;
    this.velocity.lerp(targetVelocity, 1 - Math.exp(-delta * response));
    if (!hasIntent && this.velocity.lengthSq() < STOP_EPSILON * STOP_EPSILON) {
      this.velocity.set(0, 0, 0);
    }
    this.position.addScaledVector(this.velocity, delta);
    this.clampToArenaBoundary();

    const groundY = this.sampleHeight(this.position.x, this.position.z) + PLAYER_HEIGHT;
    this.position.y = THREE.MathUtils.lerp(this.position.y, groundY, 1 - Math.exp(-delta * 14));
    this.updateCamera(delta);
  }

  createPulsePosition(): THREE.Vector3 {
    const pulse = this.position.clone().addScaledVector(this.getPlanarForward(), PULSE_DISTANCE);
    this.clampVectorToArenaBoundary(pulse);
    pulse.y = this.sampleHeight(pulse.x, pulse.z) + 0.4;
    return pulse;
  }

  getSpeed(): number {
    return this.velocity.length();
  }

  setMobileMoveIntent(x: number, y: number): void {
    this.mobileMoveIntent.set(
      THREE.MathUtils.clamp(x, -1, 1),
      THREE.MathUtils.clamp(y, -1, 1)
    );
  }

  setMobileLookIntent(x: number, y: number): void {
    this.mobileLookIntent.set(
      THREE.MathUtils.clamp(x, -1, 1),
      THREE.MathUtils.clamp(y, -1, 1)
    );
  }

  triggerPulse(): void {
    this.tryCreatePulse();
  }

  private applyMobileLook(delta: number): void {
    if (this.mobileLookIntent.lengthSq() <= 0) return;

    this.yaw -= this.mobileLookIntent.x * TOUCH_LOOK_RATE_X * delta;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + this.mobileLookIntent.y * TOUCH_LOOK_RATE_Y * delta,
      CAMERA_PITCH_RANGE.min,
      CAMERA_PITCH_RANGE.max
    );
  }

  private updateCamera(delta: number): void {
    const behind = this.getPlanarForward().multiplyScalar(-Math.cos(this.pitch) * CAMERA_DISTANCE);
    const height = Math.sin(this.pitch) * CAMERA_DISTANCE;
    this.desiredCameraPosition.set(
      this.position.x + behind.x,
      this.position.y + height,
      this.position.z + behind.z
    );

    // Smoothly dragging the camera gives the field motion a heavier, more
    // cinematic feel than a rigidly attached debug camera. Pitch now changes
    // the actual orbit arc instead of just hoisting the camera vertically, so
    // mouse look feels like orbiting a subject rather than dragging a crane.
    const smoothing = 1 - Math.pow(1 - CAMERA_SMOOTHING, Math.max(1, delta * 60));
    this.camera.position.lerp(this.desiredCameraPosition, smoothing);
    this.lookTarget.set(this.position.x, this.position.y + CAMERA_TARGET_HEIGHT, this.position.z);
    this.camera.lookAt(this.lookTarget);
  }

  private getPlanarForward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  private clampToArenaBoundary(): void {
    const wasClamped = this.clampVectorToArenaBoundary(this.position);
    if (!wasClamped) return;

    // When the player presses into the circular wall, remove only the outward
    // velocity component. Tangential velocity stays intact, so the avatar slides
    // along the rim instead of sticking to it.
    const planarDistance = Math.hypot(this.position.x, this.position.z);
    if (planarDistance <= 0) return;

    const normalX = this.position.x / planarDistance;
    const normalZ = this.position.z / planarDistance;
    const outwardSpeed = this.velocity.x * normalX + this.velocity.z * normalZ;
    if (outwardSpeed <= 0) return;

    this.velocity.x -= normalX * outwardSpeed;
    this.velocity.z -= normalZ * outwardSpeed;
  }

  private clampVectorToArenaBoundary(vector: THREE.Vector3): boolean {
    const boundaryRadius = Math.max(0, this.getBoundaryRadius());
    const planarDistance = Math.hypot(vector.x, vector.z);
    if (planarDistance <= boundaryRadius || planarDistance <= 0) return false;

    const scale = boundaryRadius / planarDistance;
    vector.x *= scale;
    vector.z *= scale;
    return true;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      // Holding Space fires repeated keydown events in most browsers. The shared
      // cooldown turns that into a deliberate pulse cadence instead of a flood.
      this.tryCreatePulse();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.delete(event.code);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target !== this.canvas) return;
    void this.canvas.requestPointerLock();
    this.tryCreatePulse();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * LOOK_SENSITIVITY_X;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + event.movementY * LOOK_SENSITIVITY_Y,
      CAMERA_PITCH_RANGE.min,
      CAMERA_PITCH_RANGE.max
    );
  };

  private tryCreatePulse(): void {
    const now = performance.now() / 1000;
    if (now - this.lastPulseSecond < PULSE_COOLDOWN_SECONDS) return;
    this.lastPulseSecond = now;
    this.onPulse(this.createPulsePosition());
  }
}
