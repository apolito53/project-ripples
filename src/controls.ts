import * as THREE from "three";

export type PlayerRigOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly sampleHeight: (x: number, z: number) => number;
  readonly getBoundaryRadius: () => number;
  readonly onPulse: (position: THREE.Vector3) => void;
  readonly onJump?: (event: PlayerJumpEvent) => void;
  readonly onLand?: (event: PlayerJumpEvent) => void;
  readonly speedSettings?: PlayerSpeedSettings;
  readonly isInputEnabled?: () => boolean;
};

export type PlayerSpeedSettings = {
  readonly walkSpeedMetersPerSecond: number;
  readonly sprintSpeedMetersPerSecond: number;
};

export type PlayerJumpEvent = {
  readonly position: THREE.Vector3;
  readonly strength: number;
  readonly airtimeSeconds: number;
  readonly impactSpeed: number;
};

export const PLAYER_SPEED_LIMITS = {
  walk: { min: 1, max: 30, step: 0.5 },
  sprint: { min: 20, max: 50, step: 0.5, minimumGapFromWalk: 5 }
} as const;

export const DEFAULT_PLAYER_SPEED_SETTINGS: PlayerSpeedSettings = {
  walkSpeedMetersPerSecond: 10,
  sprintSpeedMetersPerSecond: 37
};

const MOVE_ACCELERATION = 7.5;
const MOVE_COUNTER_STEER_ACCELERATION = 10.5;
// This is an exponential response rate, so smaller values make released
// movement coast longer before settling to a stop.
const MOVE_BRAKE = 3.36;
const MENU_BRAKE = 18;
const STOP_EPSILON = 0.05;
const CAMERA_DEFAULT_DISTANCE = 15;
const CAMERA_DISTANCE_RANGE = { min: 7.5, max: 34 };
const CAMERA_TARGET_HEIGHT = 0.58;
const CAMERA_PITCH_RANGE = { min: 0.055, max: 0.82 };
const CAMERA_SMOOTHING = 1 - Math.exp(-14 / 60);
const CAMERA_ZOOM_STEP = 1.4;
const CAMERA_WHEEL_ZOOM_SPEED = 0.018;
// This is a visual hover height, not a collision capsule. Keeping the avatar
// above the fabric prevents nearby displaced blocks from swallowing the marker.
const PLAYER_HEIGHT = 1.75;
const PULSE_DISTANCE = 4.2;
const PULSE_COOLDOWN_SECONDS = 0.42;
const JUMP_INITIAL_SPEED = 7.6;
const JUMP_GRAVITY = 21.5;
const JUMP_SURFACE_CONTACT_FADE_HEIGHT = 1.25;
const JUMP_TAKEOFF_STRENGTH = 0.26;
const JUMP_LANDING_MIN_STRENGTH = 0.42;
const JUMP_LANDING_MAX_STRENGTH = 0.74;
const JUMP_LANDING_MIN_IMPACT_SPEED = 2.2;
const LOOK_SENSITIVITY_X = 0.002;
const LOOK_SENSITIVITY_Y = 0.00155;
const TOUCH_LOOK_RATE_X = 2.65;
const TOUCH_LOOK_RATE_Y = 2.05;


export function normalizePlayerSpeedSettings(settings: PlayerSpeedSettings): PlayerSpeedSettings {
  const walkSpeedMetersPerSecond = THREE.MathUtils.clamp(
    settings.walkSpeedMetersPerSecond,
    PLAYER_SPEED_LIMITS.walk.min,
    PLAYER_SPEED_LIMITS.walk.max
  );
  const minimumSprintSpeed = getMinimumSprintSpeedMetersPerSecond(walkSpeedMetersPerSecond);
  const sprintSpeedMetersPerSecond = THREE.MathUtils.clamp(
    settings.sprintSpeedMetersPerSecond,
    minimumSprintSpeed,
    PLAYER_SPEED_LIMITS.sprint.max
  );

  return {
    walkSpeedMetersPerSecond,
    sprintSpeedMetersPerSecond
  };
}

export function getMinimumSprintSpeedMetersPerSecond(walkSpeedMetersPerSecond: number): number {
  return Math.max(
    PLAYER_SPEED_LIMITS.sprint.min,
    walkSpeedMetersPerSecond + PLAYER_SPEED_LIMITS.sprint.minimumGapFromWalk
  );
}

export class PlayerRig {
  readonly position = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
  readonly velocity = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sampleHeight: (x: number, z: number) => number;
  private readonly getBoundaryRadius: () => number;
  private readonly onPulse: (position: THREE.Vector3) => void;
  private readonly onJump: (event: PlayerJumpEvent) => void;
  private readonly onLand: (event: PlayerJumpEvent) => void;
  private readonly isInputEnabled: () => boolean;
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly movementIntent = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly mobileMoveIntent = new THREE.Vector2();
  private readonly mobileLookIntent = new THREE.Vector2();
  private cameraDistance = CAMERA_DEFAULT_DISTANCE;
  private targetCameraDistance = CAMERA_DEFAULT_DISTANCE;
  private lastPulseSecond = -Infinity;
  private speedSettings = DEFAULT_PLAYER_SPEED_SETTINGS;
  private jumpOffset = 0;
  private verticalVelocity = 0;
  private grounded = true;
  private jumpStartedAt = -Infinity;
  private yaw = Math.PI * 0.23;
  private pitch = 0.45;

  constructor(options: PlayerRigOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.sampleHeight = options.sampleHeight;
    this.getBoundaryRadius = options.getBoundaryRadius;
    this.onPulse = options.onPulse;
    this.onJump = options.onJump ?? (() => undefined);
    this.onLand = options.onLand ?? (() => undefined);
    this.isInputEnabled = options.isInputEnabled ?? (() => true);
    this.setSpeedSettings(options.speedSettings ?? DEFAULT_PLAYER_SPEED_SETTINGS);

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("wheel", this.handleWheel);
  }

  update(delta: number): void {
    const inputEnabled = this.isInputEnabled();
    if (!inputEnabled) {
      // UI overlays should feel modal. Clearing held inputs every frame avoids
      // the classic browser-game bug where opening a menu preserves W/A/S/D or
      // a touch-stick vector until the user taps back into the scene.
      this.keys.clear();
      this.mobileMoveIntent.set(0, 0);
      this.mobileLookIntent.set(0, 0);
    }

    if (inputEnabled) this.applyMobileLook(delta);

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
    const isSprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const targetSpeed = isSprinting
      ? this.speedSettings.sprintSpeedMetersPerSecond
      : this.speedSettings.walkSpeedMetersPerSecond;
    const targetVelocity = intent.multiplyScalar(targetSpeed);
    const hasPlanarVelocity = this.velocity.lengthSq() > STOP_EPSILON * STOP_EPSILON;
    const isCounterSteering = hasIntent && hasPlanarVelocity && targetVelocity.dot(this.velocity) < 0;
    const response = hasIntent
      ? (isCounterSteering ? MOVE_COUNTER_STEER_ACCELERATION : MOVE_ACCELERATION)
      : (inputEnabled ? MOVE_BRAKE : MENU_BRAKE);

    // Movement is intentionally inertial now: input defines the velocity we are
    // trying to reach, while acceleration/brake response decides how much of
    // that change happens this frame. Counter-steering stays a little snappier
    // so the avatar feels weighty without becoming a runaway sled.
    this.velocity.lerp(targetVelocity, 1 - Math.exp(-delta * response));
    if (!hasIntent && this.velocity.lengthSq() < STOP_EPSILON * STOP_EPSILON) {
      this.velocity.set(0, 0, 0);
    }
    this.position.addScaledVector(this.velocity, delta);
    this.clampToArenaBoundary();
    this.updateJump(delta);

    const groundY = this.sampleHeight(this.position.x, this.position.z) + PLAYER_HEIGHT;
    const targetY = groundY + this.jumpOffset;
    const verticalResponse = this.grounded ? 14 : 24;
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, 1 - Math.exp(-delta * verticalResponse));
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

  getGroundContactStrength(): number {
    // A small fade band keeps takeoff and touchdown from hard-switching the
    // surface response, while still fully lifting pressure once the avatar is
    // visibly airborne.
    return THREE.MathUtils.clamp(1 - this.jumpOffset / JUMP_SURFACE_CONTACT_FADE_HEIGHT, 0, 1);
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  setSpeedSettings(settings: PlayerSpeedSettings): void {
    // Keep the hidden speed controls and any future callers honest: sprint
    // should remain meaningfully faster even while the visible UI is simplified.
    this.speedSettings = normalizePlayerSpeedSettings(settings);
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
    if (!this.isInputEnabled()) return;
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
    const smoothing = 1 - Math.pow(1 - CAMERA_SMOOTHING, Math.max(1, delta * 60));
    this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, smoothing);

    const behind = this.getPlanarForward().multiplyScalar(-Math.cos(this.pitch) * this.cameraDistance);
    const height = Math.sin(this.pitch) * this.cameraDistance;
    this.desiredCameraPosition.set(
      this.position.x + behind.x,
      this.position.y + height,
      this.position.z + behind.z
    );

    // Smoothly dragging the camera gives the field motion a heavier, more
    // cinematic feel than a rigidly attached debug camera. Pitch now changes
    // the actual orbit arc instead of just hoisting the camera vertically, so
    // mouse look feels like orbiting a subject rather than dragging a crane.
    this.camera.position.lerp(this.desiredCameraPosition, smoothing);
    this.lookTarget.set(this.position.x, this.position.y + CAMERA_TARGET_HEIGHT, this.position.z);
    this.camera.lookAt(this.lookTarget);
  }

  private adjustZoom(deltaDistance: number): void {
    // Zoom changes the orbit radius instead of the camera FOV. That preserves
    // the lens feel while still letting the user pull back to inspect more of
    // the field or tuck in close to the avatar.
    this.targetCameraDistance = THREE.MathUtils.clamp(
      this.targetCameraDistance + deltaDistance,
      CAMERA_DISTANCE_RANGE.min,
      CAMERA_DISTANCE_RANGE.max
    );
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
    if (!this.isInputEnabled()) return;
    if (event.code === "Equal" || event.code === "NumpadAdd") {
      event.preventDefault();
      this.adjustZoom(-CAMERA_ZOOM_STEP);
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      this.adjustZoom(CAMERA_ZOOM_STEP);
      return;
    }
    if (event.code === "Digit0" || event.code === "Numpad0") {
      event.preventDefault();
      this.targetCameraDistance = CAMERA_DEFAULT_DISTANCE;
      return;
    }

    this.keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) this.tryJump();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.delete(event.code);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.isInputEnabled()) return;
    if (event.button !== 0) return;
    if (event.target !== this.canvas) return;
    void this.canvas.requestPointerLock();
    this.tryCreatePulse();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.isInputEnabled()) return;
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * LOOK_SENSITIVITY_X;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + event.movementY * LOOK_SENSITIVITY_Y,
      CAMERA_PITCH_RANGE.min,
      CAMERA_PITCH_RANGE.max
    );
  };

  private handleWheel = (event: WheelEvent): void => {
    if (!this.isInputEnabled()) return;
    event.preventDefault();
    this.adjustZoom(event.deltaY * CAMERA_WHEEL_ZOOM_SPEED);
  };

  private tryCreatePulse(): void {
    const now = performance.now() / 1000;
    if (now - this.lastPulseSecond < PULSE_COOLDOWN_SECONDS) return;
    this.lastPulseSecond = now;
    this.onPulse(this.createPulsePosition());
  }

  private tryJump(): void {
    if (!this.grounded) return;

    this.grounded = false;
    this.verticalVelocity = JUMP_INITIAL_SPEED;
    this.jumpOffset = Math.max(this.jumpOffset, 0.02);
    this.jumpStartedAt = performance.now() / 1000;
    this.onJump({
      position: this.createSurfaceEventPosition(),
      strength: JUMP_TAKEOFF_STRENGTH,
      airtimeSeconds: 0,
      impactSpeed: 0
    });
  }

  private updateJump(delta: number): void {
    if (this.grounded) {
      this.jumpOffset = 0;
      this.verticalVelocity = 0;
      return;
    }

    this.verticalVelocity -= JUMP_GRAVITY * delta;
    this.jumpOffset += this.verticalVelocity * delta;
    if (this.jumpOffset > 0) return;

    const impactSpeed = Math.max(0, -this.verticalVelocity);
    const airtimeSeconds = Number.isFinite(this.jumpStartedAt)
      ? Math.max(0, performance.now() / 1000 - this.jumpStartedAt)
      : 0;
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpStartedAt = -Infinity;
    if (impactSpeed < JUMP_LANDING_MIN_IMPACT_SPEED) return;

    const impact01 = THREE.MathUtils.clamp((impactSpeed - JUMP_LANDING_MIN_IMPACT_SPEED) / 6.8, 0, 1);
    this.onLand({
      position: this.createSurfaceEventPosition(),
      strength: THREE.MathUtils.lerp(JUMP_LANDING_MIN_STRENGTH, JUMP_LANDING_MAX_STRENGTH, impact01),
      airtimeSeconds,
      impactSpeed
    });
  }

  private createSurfaceEventPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.sampleHeight(this.position.x, this.position.z) + 0.45,
      this.position.z
    );
  }
}
