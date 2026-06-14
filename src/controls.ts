import * as THREE from "three";

export type PlayerRigOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly sampleHeight: (x: number, z: number) => number;
  readonly onPulse: (position: THREE.Vector3) => void;
};

const WALK_SPEED = 10;
const SPRINT_MULTIPLIER = 1.8;
const CAMERA_DISTANCE = 13;
const CAMERA_BASE_HEIGHT = 7;
const CAMERA_PITCH_RANGE = { min: -0.62, max: 0.38 };
const CAMERA_SMOOTHING = 1 - Math.exp(-12 / 60);
const PLAYER_HEIGHT = 1.05;
const PULSE_DISTANCE = 4.2;

export class PlayerRig {
  readonly position = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
  readonly velocity = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sampleHeight: (x: number, z: number) => number;
  private readonly onPulse: (position: THREE.Vector3) => void;
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private yaw = Math.PI * 0.23;
  private pitch = -0.18;

  constructor(options: PlayerRigOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.sampleHeight = options.sampleHeight;
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
    const forward = this.getPlanarForward();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const intent = new THREE.Vector3();

    if (this.keys.has("KeyW")) intent.add(forward);
    if (this.keys.has("KeyS")) intent.sub(forward);
    if (this.keys.has("KeyD")) intent.add(right);
    if (this.keys.has("KeyA")) intent.sub(right);

    if (intent.lengthSq() > 0) intent.normalize();
    const speed = WALK_SPEED * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? SPRINT_MULTIPLIER : 1);
    const targetVelocity = intent.multiplyScalar(speed);
    this.velocity.lerp(targetVelocity, 1 - Math.exp(-delta * 11));
    this.position.addScaledVector(this.velocity, delta);

    const groundY = this.sampleHeight(this.position.x, this.position.z) + PLAYER_HEIGHT;
    this.position.y = THREE.MathUtils.lerp(this.position.y, groundY, 1 - Math.exp(-delta * 14));
    this.updateCamera(delta);
  }

  createPulsePosition(): THREE.Vector3 {
    const pulse = this.position.clone().addScaledVector(this.getPlanarForward(), PULSE_DISTANCE);
    pulse.y = this.sampleHeight(pulse.x, pulse.z) + 0.4;
    return pulse;
  }

  getSpeed(): number {
    return this.velocity.length();
  }

  private updateCamera(delta: number): void {
    const behind = this.getPlanarForward().multiplyScalar(-CAMERA_DISTANCE);
    const height = CAMERA_BASE_HEIGHT + this.pitch * 8;
    this.desiredCameraPosition.set(
      this.position.x + behind.x,
      this.position.y + height,
      this.position.z + behind.z
    );

    // Smoothly dragging the camera gives the field motion a heavier, more
    // cinematic feel than a rigidly attached debug camera.
    const smoothing = 1 - Math.pow(1 - CAMERA_SMOOTHING, Math.max(1, delta * 60));
    this.camera.position.lerp(this.desiredCameraPosition, smoothing);
    this.lookTarget.set(this.position.x, this.position.y + 0.25, this.position.z);
    this.camera.lookAt(this.lookTarget);
  }

  private getPlanarForward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      this.onPulse(this.createPulsePosition());
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target !== this.canvas) return;
    void this.canvas.requestPointerLock();
    this.onPulse(this.createPulsePosition());
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * 0.0018,
      CAMERA_PITCH_RANGE.min,
      CAMERA_PITCH_RANGE.max
    );
  };
}
