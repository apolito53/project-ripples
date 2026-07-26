import * as THREE from "three";
import {
  GAMEPAD_BUTTON,
  type GamepadControlState,
  type GamepadInput
} from "./gamepadInput";

export type PlayerRigOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly sampleHeight: (x: number, z: number) => number;
  readonly getBoundaryRadius: () => number;
  readonly playAreaConstraint?: PlayAreaConstraint | null;
  readonly onPulse: (position: THREE.Vector3) => void;
  readonly onQuietPointerUnlock?: () => void;
  readonly onJump?: (event: PlayerJumpEvent) => void;
  readonly onLand?: (event: PlayerJumpEvent) => void;
  readonly gamepad?: GamepadInput | null;
  readonly speedSettings?: PlayerSpeedSettings;
  readonly surfaceGrip?: number;
  readonly gamepadSensitivity?: GamepadSensitivitySettings;
  readonly isInputEnabled?: () => boolean;
};

export type PlayerSpeedSettings = {
  readonly baseSpeedMetersPerSecond: number;
  readonly boostSpeedMetersPerSecond: number;
};

export type GamepadSensitivitySettings = {
  readonly leftStick: number;
  readonly rightStick: number;
};

export type PlayAreaConstraint = {
  /**
   * Correct a moving player into the playable area and update velocity so wall
   * contact feels physical. Returns true when it changed the position.
   */
  constrain(position: THREE.Vector3, velocity: THREE.Vector3): boolean;
  /**
   * Correct a gameplay point, such as a pulse origin, without touching velocity.
   */
  clampPoint(point: THREE.Vector3): boolean;
};

export type PlayerJumpEvent = {
  readonly position: THREE.Vector3;
  readonly strength: number;
  readonly airtimeSeconds: number;
  readonly impactSpeed: number;
};

export type CameraDragMode = "camera" | "steer";

export type PlayerControlTelemetry = {
  readonly cameraDragMode: CameraDragMode | null;
  readonly leftMouseHeld: boolean;
  readonly rightMouseHeld: boolean;
  readonly gamepadConnected: boolean;
  readonly gamepadLookActive: boolean;
  readonly gamepadTurnInput: boolean;
  readonly gamepadBrakeInput: boolean;
  readonly mouseForwardMoveActive: boolean;
  readonly cameraYawTravel: number;
  readonly playerYawTravel: number;
  readonly forwardInput: boolean;
  readonly backwardInput: boolean;
  readonly turnLeftInput: boolean;
  readonly turnRightInput: boolean;
  readonly strafeLeftInput: boolean;
  readonly strafeRightInput: boolean;
  readonly boostInput: boolean;
  readonly movementInputActive: boolean;
  readonly braking: boolean;
  readonly grounded: boolean;
  readonly speed: number;
  readonly jumpCount: number;
  readonly landCount: number;
  readonly wallContactCount: number;
  readonly lastWallContactSecond: number;
};

export const PLAYER_SPEED_LIMITS = {
  base: { min: 1, max: 30, step: 0.5 },
  boost: { min: 20, max: 50, step: 0.5, minimumGapFromBase: 5 }
} as const;

export const DEFAULT_PLAYER_SPEED_SETTINGS: PlayerSpeedSettings = {
  baseSpeedMetersPerSecond: 10,
  boostSpeedMetersPerSecond: 37
};

export const SURFACE_GRIP_LIMITS = {
  min: 0.25,
  max: 2,
  step: 0.05,
  default: 1
} as const;

export const GAMEPAD_SENSITIVITY_LIMITS = {
  min: 0.5,
  max: 2,
  step: 0.05,
  default: 1
} as const;

export const DEFAULT_GAMEPAD_SENSITIVITY: GamepadSensitivitySettings = {
  leftStick: GAMEPAD_SENSITIVITY_LIMITS.default,
  rightStick: GAMEPAD_SENSITIVITY_LIMITS.default
};

// These are exponential velocity response rates, not raw meters/second forces.
// Halving them roughly doubles how long the avatar carries momentum during
// grounded movement, which gives the lab the slide-y feel without changing the
// visible base/boost top speeds.
const MOVE_ACCELERATION = 3.75;
const MOVE_COUNTER_STEER_ACCELERATION = 5.25;
const MOVE_BRAKE = 1.68;
const MENU_BRAKE = 18;
const STOP_EPSILON = 0.05;
const CAMERA_DEFAULT_DISTANCE = 15;
const CAMERA_DISTANCE_RANGE = { min: 7.5, max: 34 };
const CAMERA_TARGET_HEIGHT = 0.58;
// Full vertical half-orbit: straight below the avatar through straight overhead.
// Yaw naturally becomes visually ambiguous at the poles, but returns as soon as
// the camera moves off that exact vertical line.
const CAMERA_PITCH_RANGE = { min: -Math.PI / 2, max: Math.PI / 2 };
const CAMERA_SMOOTHING_RATE = 14;
const CAMERA_ZOOM_STEP = 1.4;
const CAMERA_WHEEL_ZOOM_SPEED = 0.018;
// This is a visual hover height, not a collision capsule. Keeping the avatar
// above the fabric prevents nearby displaced blocks from swallowing the marker.
const PLAYER_HEIGHT = 1.75;
const PULSE_DISTANCE = 4.2;
const PULSE_COOLDOWN_SECONDS = 0.42;
// Jump height scales with velocity squared. 10.75m/s is roughly sqrt(2) times
// the first jump tune, which doubles apex height without making gravity feel
// syrupy or turning the avatar into a slow floating balloon.
const JUMP_INITIAL_SPEED = 10.75;
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
const GAMEPAD_LOOK_RATE_X = 2.45;
const GAMEPAD_LOOK_RATE_Y = 1.85;
// Camera-relative stick movement turns the pod toward its requested travel
// vector. Facing stays responsive, while the follow camera now returns at only
// 25% of its original 8.5 rate so right-stick framing has room to breathe.
const GAMEPAD_MOVEMENT_FACING_RATE = 10;
const GAMEPAD_CAMERA_RECENTER_RATE = 2.125;
// Explicit controller braking should be much more decisive than passive drag,
// while surface grip still decides how much stopping authority the ground has.
const GAMEPAD_BRAKE_RESPONSE = 5.4;
const GAMEPAD_INPUT_EPSILON = 0.035;
const KEYBOARD_TURN_RATE = 2.35;
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_RIGHT = 2;
const MOUSE_BUTTON_LEFT_MASK = 1;
const MOUSE_BUTTON_RIGHT_MASK = 2;


export function normalizePlayerSpeedSettings(settings: PlayerSpeedSettings): PlayerSpeedSettings {
  const baseSpeedMetersPerSecond = THREE.MathUtils.clamp(
    settings.baseSpeedMetersPerSecond,
    PLAYER_SPEED_LIMITS.base.min,
    PLAYER_SPEED_LIMITS.base.max
  );
  const minimumBoostSpeed = getMinimumBoostSpeedMetersPerSecond(baseSpeedMetersPerSecond);
  const boostSpeedMetersPerSecond = THREE.MathUtils.clamp(
    settings.boostSpeedMetersPerSecond,
    minimumBoostSpeed,
    PLAYER_SPEED_LIMITS.boost.max
  );

  return {
    baseSpeedMetersPerSecond,
    boostSpeedMetersPerSecond
  };
}

export function getMinimumBoostSpeedMetersPerSecond(baseSpeedMetersPerSecond: number): number {
  return Math.max(
    PLAYER_SPEED_LIMITS.boost.min,
    baseSpeedMetersPerSecond + PLAYER_SPEED_LIMITS.boost.minimumGapFromBase
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
  private playAreaConstraint: PlayAreaConstraint | null = null;
  private readonly onPulse: (position: THREE.Vector3) => void;
  private readonly onQuietPointerUnlock: () => void;
  private readonly onJump: (event: PlayerJumpEvent) => void;
  private readonly onLand: (event: PlayerJumpEvent) => void;
  private readonly gamepad: GamepadInput | null;
  private readonly isInputEnabled: () => boolean;
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly movementIntent = new THREE.Vector3();
  private readonly gamepadMovementIntent = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly mobileMoveIntent = new THREE.Vector2();
  private readonly mobileLookIntent = new THREE.Vector2();
  private timeSeconds = 0;
  private cameraDistance = CAMERA_DEFAULT_DISTANCE;
  private targetCameraDistance = CAMERA_DEFAULT_DISTANCE;
  private lastPulseSecond = -Infinity;
  private speedSettings = DEFAULT_PLAYER_SPEED_SETTINGS;
  private surfaceGrip: number = SURFACE_GRIP_LIMITS.default;
  private gamepadSensitivity = DEFAULT_GAMEPAD_SENSITIVITY;
  private jumpOffset = 0;
  private verticalVelocity = 0;
  private grounded = true;
  private jumpStartedAt = -Infinity;
  private cameraDragPointerId: number | null = null;
  private cameraDragMode: CameraDragMode | null = null;
  private isLeftMouseHeld = false;
  private isRightMouseHeld = false;
  private cameraYaw = Math.PI * 0.23;
  private playerYaw = Math.PI * 0.23;
  private pitch = 0.45;
  private cameraYawTravel = 0;
  private playerYawTravel = 0;
  private jumpCount = 0;
  private landCount = 0;
  private wallContactCount = 0;
  private lastWallContactSecond = -Infinity;
  private telemetry: PlayerControlTelemetry = this.createTelemetrySnapshot(false, false, false, false, false, false, false, false, false, false);

  constructor(options: PlayerRigOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.sampleHeight = options.sampleHeight;
    this.getBoundaryRadius = options.getBoundaryRadius;
    this.playAreaConstraint = options.playAreaConstraint ?? null;
    this.onPulse = options.onPulse;
    this.onQuietPointerUnlock = options.onQuietPointerUnlock ?? (() => undefined);
    this.onJump = options.onJump ?? (() => undefined);
    this.onLand = options.onLand ?? (() => undefined);
    this.gamepad = options.gamepad ?? null;
    this.isInputEnabled = options.isInputEnabled ?? (() => true);
    this.setSpeedSettings(options.speedSettings ?? DEFAULT_PLAYER_SPEED_SETTINGS);
    this.setSurfaceGrip(options.surfaceGrip ?? SURFACE_GRIP_LIMITS.default);
    this.setGamepadSensitivity(options.gamepadSensitivity ?? DEFAULT_GAMEPAD_SENSITIVITY);

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("pointerup", this.handlePointerUp);
    document.addEventListener("pointercancel", this.handlePointerCancel);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerUp);
    document.removeEventListener("pointercancel", this.handlePointerCancel);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.releaseCameraDrag();
  }

  update(delta: number, timeSeconds: number): void {
    this.timeSeconds = timeSeconds;
    const inputEnabled = this.isInputEnabled();
    const gamepadState = this.gamepad?.getState() ?? null;
    if (!inputEnabled) {
      // UI overlays should feel modal. Clearing held inputs every frame avoids
      // the classic browser-game bug where opening a menu preserves W/A/S/D or
      // a touch-stick vector until the user taps back into the scene.
      this.keys.clear();
      this.mobileMoveIntent.set(0, 0);
      this.mobileLookIntent.set(0, 0);
      this.gamepadMovementIntent.set(0, 0, 0);
      this.releaseCameraDrag();
    }

    if (inputEnabled) this.handleGamepadButtonActions();
    if (inputEnabled) this.applyGamepadLook(delta, gamepadState);
    if (inputEnabled) this.applyMobileLook(delta);
    if (inputEnabled) this.applyTurnInput(delta);
    if (inputEnabled) this.updateGamepadMovementFacing(delta, gamepadState);

    const forward = this.getPlanarForward();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const intent = this.movementIntent.set(0, 0, 0);
    const hasMovementAuthority = this.grounded;
    const gamepadConnected = inputEnabled && gamepadState?.connected === true;
    // The entire left stick is a camera-relative travel vector. B owns braking;
    // pulling the stick backward means travel toward camera-back again.
    const gamepadBrakeInput = gamepadConnected
      && this.gamepad?.isPressed(GAMEPAD_BUTTON.secondary) === true;
    const gamepadStrafeLeft = gamepadConnected && this.gamepad?.isPressed(GAMEPAD_BUTTON.leftBumper) === true;
    const gamepadStrafeRight = gamepadConnected && this.gamepad?.isPressed(GAMEPAD_BUTTON.rightBumper) === true;

    if (this.isMouseForwardMoveActive()) {
      // Holding both mouse buttons is the familiar MMO autorun-ish gesture: move
      // in the direction the camera is looking, and keep player facing glued to
      // that camera heading while the gesture is active. The facing snap stays
      // available in the air, but the actual velocity change below is grounded
      // only so jumps keep their takeoff trajectory instead of gaining midair
      // side-thrust.
      this.playerYaw = this.cameraYaw;
    }

    if (hasMovementAuthority && this.keys.has("KeyW")) intent.add(forward);
    if (hasMovementAuthority && this.keys.has("KeyS")) intent.sub(forward);
    if (hasMovementAuthority && (this.keys.has("KeyQ") || (this.isRightMouseHeld && this.keys.has("KeyA")))) {
      intent.add(right);
    }
    if (hasMovementAuthority && (this.keys.has("KeyE") || (this.isRightMouseHeld && this.keys.has("KeyD")))) {
      intent.sub(right);
    }
    if (hasMovementAuthority && this.isMouseForwardMoveActive()) {
      intent.add(this.getCameraPlanarForward());
    }
    if (hasMovementAuthority && gamepadConnected) {
      intent.add(this.gamepadMovementIntent);
    }
    // Bumpers are independent strafe controls. Pressing both simply cancels the
    // lateral request; it no longer borrows the mouse-only camera-drive gesture.
    if (hasMovementAuthority && gamepadStrafeLeft) intent.add(right);
    if (hasMovementAuthority && gamepadStrafeRight) intent.sub(right);
    if (hasMovementAuthority) {
      if (this.mobileMoveIntent.y !== 0) intent.addScaledVector(forward, this.mobileMoveIntent.y);
      if (this.mobileMoveIntent.x !== 0) intent.addScaledVector(right, -this.mobileMoveIntent.x);
    }

    const hasIntent = !gamepadBrakeInput && intent.lengthSq() > 0;
    // Preserve analog stick strength before normalizing direction. Keyboard
    // input still lands at one, while a half-tilted stick requests half speed.
    const intentStrength = hasIntent ? Math.min(1, intent.length()) : 0;
    if (hasIntent) {
      intent.normalize();
    } else {
      // Brake wins over any simultaneous controller movement input. Clearing
      // the vector makes the target unambiguously stationary.
      intent.set(0, 0, 0);
    }
    const keyboardBoosting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const gamepadBoostAmount = gamepadConnected ? gamepadState.rightTrigger : 0;
    const boostAmount = Math.max(keyboardBoosting ? 1 : 0, gamepadBoostAmount);
    const isBoosting = boostAmount > GAMEPAD_INPUT_EPSILON;
    const targetSpeed = THREE.MathUtils.lerp(
      this.speedSettings.baseSpeedMetersPerSecond,
      this.speedSettings.boostSpeedMetersPerSecond,
      boostAmount
    ) * intentStrength;
    const targetVelocity = intent.multiplyScalar(targetSpeed);
    const hasPlanarVelocity = this.velocity.lengthSq() > STOP_EPSILON * STOP_EPSILON;
    const isCounterSteering = hasIntent && hasPlanarVelocity && targetVelocity.dot(this.velocity) < 0;
    const baseResponse = gamepadBrakeInput
      ? GAMEPAD_BRAKE_RESPONSE
      : hasIntent
        ? (isCounterSteering ? MOVE_COUNTER_STEER_ACCELERATION : MOVE_ACCELERATION)
        : (inputEnabled ? MOVE_BRAKE : MENU_BRAKE);
    const response = inputEnabled ? baseResponse * this.surfaceGrip : baseResponse;

    if (hasMovementAuthority) {
      // Movement is intentionally inertial now: input defines the velocity we are
      // trying to reach, while acceleration/brake response decides how much of
      // that change happens this frame. Surface grip scales only the active
      // ground response rates, leaving top speeds and menu-open braking alone.
      this.velocity.lerp(targetVelocity, 1 - Math.exp(-delta * response));
      if (!hasIntent && this.velocity.lengthSq() < STOP_EPSILON * STOP_EPSILON) {
        this.velocity.set(0, 0, 0);
      }
    }
    this.telemetry = this.createTelemetrySnapshot(
      this.keys.has("KeyW") || (gamepadConnected && gamepadState.leftStick.y < -GAMEPAD_INPUT_EPSILON),
      this.keys.has("KeyS") || (gamepadConnected && gamepadState.leftStick.y > GAMEPAD_INPUT_EPSILON),
      (!this.isRightMouseHeld && this.keys.has("KeyA")) || (gamepadConnected && gamepadState.leftStick.x < -GAMEPAD_INPUT_EPSILON),
      (!this.isRightMouseHeld && this.keys.has("KeyD")) || (gamepadConnected && gamepadState.leftStick.x > GAMEPAD_INPUT_EPSILON),
      this.keys.has("KeyQ") || (this.isRightMouseHeld && this.keys.has("KeyA")) || gamepadStrafeLeft,
      this.keys.has("KeyE") || (this.isRightMouseHeld && this.keys.has("KeyD")) || gamepadStrafeRight,
      isBoosting,
      hasIntent,
      inputEnabled && hasPlanarVelocity && this.grounded && (gamepadBrakeInput || !hasIntent),
      inputEnabled
    );
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
    this.clampVectorToPlayArea(pulse);
    pulse.y = this.sampleHeight(pulse.x, pulse.z) + 0.4;
    return pulse;
  }

  getSpeed(): number {
    return this.velocity.length();
  }

  getFacingYaw(): number {
    // Rendering systems should not reach into the rig's private yaw state, but
    // the avatar needs the true facing direction even while standing still.
    return this.playerYaw;
  }

  getTelemetry(): PlayerControlTelemetry {
    return { ...this.telemetry };
  }

  setFacingYaw(yaw: number, alignCamera = false): void {
    this.playerYaw = yaw;
    if (alignCamera) this.cameraYaw = yaw;
  }

  /**
   * Applies an externally scripted pose for deterministic renderer benchmarks.
   * Ordinary gameplay never calls this; controls remain authoritative there.
   */
  applyScriptedPose(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    facingYaw: number,
    delta: number,
    timeSeconds: number
  ): void {
    this.timeSeconds = timeSeconds;
    this.keys.clear();
    this.mobileMoveIntent.set(0, 0);
    this.position.copy(position);
    this.velocity.copy(velocity);
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.setFacingYaw(facingYaw, true);
    this.telemetry = this.createTelemetrySnapshot(
      false, false, false, false, false, false, false, true, false, true
    );
    this.updateCamera(Math.max(1 / 120, delta));
  }

  setPlayAreaConstraint(playAreaConstraint: PlayAreaConstraint | null): void {
    // The lab now has separate Arena and Track modes. Keep the movement rig
    // ignorant of mode names; it only needs to know whether an external
    // constraint owns collision, or whether it should use the circular fallback.
    this.playAreaConstraint = playAreaConstraint;
  }

  resetForSession(position: THREE.Vector3, facingYaw: number): void {
    // A mode switch is a fresh run, not a teleport with old acceleration,
    // button holds, jump state, or pointer lock baggage attached.
    this.keys.clear();
    this.mobileMoveIntent.set(0, 0);
    this.mobileLookIntent.set(0, 0);
    this.releaseCameraDrag();
    this.velocity.set(0, 0, 0);
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpStartedAt = -Infinity;
    this.position.copy(position);
    this.setFacingYaw(facingYaw, true);
    this.cameraYawTravel = 0;
    this.playerYawTravel = 0;
    this.jumpCount = 0;
    this.landCount = 0;
    this.wallContactCount = 0;
    this.lastWallContactSecond = -Infinity;
    this.telemetry = this.createTelemetrySnapshot(false, false, false, false, false, false, false, false, false, true);
    this.updateCamera(1);
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
    // Keep the speed controls and any programmatic callers honest: boost should
    // remain meaningfully faster than the selected base speed.
    this.speedSettings = normalizePlayerSpeedSettings(settings);
  }

  setSurfaceGrip(surfaceGrip: number): void {
    // Think of this as traction, not speed. Lower values make the avatar keep
    // sliding after input changes; higher values make the same top speeds bite
    // into the surface faster.
    this.surfaceGrip = THREE.MathUtils.clamp(
      surfaceGrip,
      SURFACE_GRIP_LIMITS.min,
      SURFACE_GRIP_LIMITS.max
    );
  }

  setGamepadSensitivity(settings: GamepadSensitivitySettings): void {
    // Sensitivity changes how strongly partial stick deflection responds, not
    // the maximum movement or camera speed reached at full deflection.
    this.gamepadSensitivity = normalizeGamepadSensitivitySettings(settings);
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

  private handleGamepadButtonActions(): void {
    if (!this.gamepad?.getState().connected) return;

    // One-shot actions consume their edge so fixed-step catch-up cannot repeat
    // them. Menu buttons are consumed by main.ts before PlayerRig runs.
    if (this.gamepad.consumePress(GAMEPAD_BUTTON.primary)) this.tryJump();
    if (this.gamepad.consumePress(GAMEPAD_BUTTON.pulse)) this.tryCreatePulse();
    if (this.gamepad.consumePress(GAMEPAD_BUTTON.dpadUp)) this.adjustZoom(-CAMERA_ZOOM_STEP);
    if (this.gamepad.consumePress(GAMEPAD_BUTTON.dpadDown)) this.adjustZoom(CAMERA_ZOOM_STEP);
    if (this.gamepad.consumePress(GAMEPAD_BUTTON.rightStick)) {
      // R3 converts the current free-look heading into player facing without
      // moving the camera. Track the angular travel so Training Run and future
      // telemetry still see this as a real facing change.
      const yawDelta = shortestAngleDelta(this.playerYaw, this.cameraYaw);
      this.playerYaw += yawDelta;
      this.playerYawTravel += Math.abs(yawDelta);
    }
  }

  private applyGamepadLook(delta: number, gamepadState: GamepadControlState | null): void {
    if (!gamepadState?.connected || gamepadState.rightStick.magnitude <= GAMEPAD_INPUT_EPSILON) return;

    // The right stick is the controller equivalent of left-mouse free look: it
    // orbits the camera without silently changing pod facing or jump momentum.
    this.applyLookDelta(
      -gamepadState.rightStick.x * GAMEPAD_LOOK_RATE_X * this.gamepadSensitivity.rightStick * delta,
      gamepadState.rightStick.y * GAMEPAD_LOOK_RATE_Y * this.gamepadSensitivity.rightStick * delta,
      false
    );
  }

  private applyMobileLook(delta: number): void {
    if (this.mobileLookIntent.lengthSq() <= 0) return;

    // Touch has one look stick rather than separate left/right mouse gestures,
    // so it keeps the old steering behavior: the camera and player facing move
    // together.
    this.applyLookDelta(
      -this.mobileLookIntent.x * TOUCH_LOOK_RATE_X * delta,
      this.mobileLookIntent.y * TOUCH_LOOK_RATE_Y * delta,
      true
    );
  }

  private applyLookDelta(yawDelta: number, pitchDelta: number, steersPlayer: boolean): void {
    const previousCameraYaw = this.cameraYaw;
    const previousPlayerYaw = this.playerYaw;
    this.cameraYaw += yawDelta;
    if (steersPlayer) this.playerYaw = this.cameraYaw;
    this.cameraYawTravel += Math.abs(this.cameraYaw - previousCameraYaw);
    this.playerYawTravel += Math.abs(this.playerYaw - previousPlayerYaw);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + pitchDelta,
      CAMERA_PITCH_RANGE.min,
      CAMERA_PITCH_RANGE.max
    );
  }

  private applyTurnInput(delta: number): void {
    // WoW-style keyboard movement treats A/D as turn keys until the right mouse
    // button is steering. While right-drag is held, those same keys become
    // strafe keys in the movement-intent block below. This method intentionally
    // stays keyboard-only so controller camera rules cannot leak into M+K feel.
    const keyboardTurnDirection = this.isRightMouseHeld
      ? 0
      : (this.keys.has("KeyA") ? 1 : 0) - (this.keys.has("KeyD") ? 1 : 0);
    if (Math.abs(keyboardTurnDirection) <= GAMEPAD_INPUT_EPSILON) return;

    const yawDelta = keyboardTurnDirection * KEYBOARD_TURN_RATE * delta;
    const previousPlayerYaw = this.playerYaw;
    const previousCameraYaw = this.cameraYaw;
    this.playerYaw += yawDelta;
    if (!this.isLeftMouseHeld) this.cameraYaw += yawDelta;
    this.playerYawTravel += Math.abs(this.playerYaw - previousPlayerYaw);
    this.cameraYawTravel += Math.abs(this.cameraYaw - previousCameraYaw);
  }

  private updateGamepadMovementFacing(delta: number, gamepadState: GamepadControlState | null): void {
    this.gamepadMovementIntent.set(0, 0, 0);
    if (!gamepadState?.connected || gamepadState.leftStick.magnitude <= GAMEPAD_INPUT_EPSILON) return;

    // Translate the 2D stick through the camera basis. Holding the same stick
    // angle while orbiting the camera therefore changes world travel direction;
    // the player must rotate the stick to preserve an old world-space heading.
    const cameraForward = this.getCameraPlanarForward();
    const stickX = gamepadState.leftStick.x;
    const stickY = gamepadState.leftStick.y;
    this.gamepadMovementIntent.set(
      cameraForward.x * -stickY + cameraForward.z * -stickX,
      0,
      cameraForward.z * -stickY + cameraForward.x * stickX
    );

    // Curve only the analog magnitude. Direction remains the exact
    // camera-relative stick heading, and full deflection still reaches full
    // movement speed at every sensitivity setting.
    const rawMagnitude = this.gamepadMovementIntent.length();
    const responseMagnitude = Math.pow(rawMagnitude, 1 / this.gamepadSensitivity.leftStick);
    if (rawMagnitude > 0) {
      this.gamepadMovementIntent.multiplyScalar(responseMagnitude / rawMagnitude);
    }

    const desiredYaw = Math.atan2(this.gamepadMovementIntent.x, this.gamepadMovementIntent.z);
    const previousPlayerYaw = this.playerYaw;
    const previousCameraYaw = this.cameraYaw;
    const facingAmount = 1 - Math.exp(
      -GAMEPAD_MOVEMENT_FACING_RATE * this.gamepadSensitivity.leftStick * delta
    );
    this.playerYaw += shortestAngleDelta(this.playerYaw, desiredYaw) * facingAmount;

    const gamepadFreeLookActive = gamepadState.rightStick.magnitude > GAMEPAD_INPUT_EPSILON;
    if (!gamepadFreeLookActive) {
      const recenterAmount = 1 - Math.exp(-GAMEPAD_CAMERA_RECENTER_RATE * delta);
      this.cameraYaw += shortestAngleDelta(this.cameraYaw, this.playerYaw) * recenterAmount;
    }
    this.playerYawTravel += Math.abs(this.playerYaw - previousPlayerYaw);
    this.cameraYawTravel += Math.abs(this.cameraYaw - previousCameraYaw);
  }

  private updateCamera(delta: number): void {
    const smoothing = 1 - Math.exp(-CAMERA_SMOOTHING_RATE * Math.max(0, delta));
    this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, smoothing);

    const behind = this.getCameraPlanarForward().multiplyScalar(-Math.cos(this.pitch) * this.cameraDistance);
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
    return new THREE.Vector3(Math.sin(this.playerYaw), 0, Math.cos(this.playerYaw)).normalize();
  }

  private getCameraPlanarForward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw)).normalize();
  }

  private clampToArenaBoundary(): void {
    if (this.playAreaConstraint) {
      const constrained = this.playAreaConstraint.constrain(this.position, this.velocity);
      if (constrained) {
        this.wallContactCount += 1;
        this.lastWallContactSecond = this.timeSeconds;
      }
      return;
    }

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

  private clampVectorToPlayArea(vector: THREE.Vector3): boolean {
    return this.playAreaConstraint
      ? this.playAreaConstraint.clampPoint(vector)
      : this.clampVectorToArenaBoundary(vector);
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
    if (event.button !== MOUSE_BUTTON_LEFT && event.button !== MOUSE_BUTTON_RIGHT) return;
    if (event.target !== this.canvas) return;
    event.preventDefault();
    this.cameraDragPointerId = event.pointerId;
    this.syncMouseButtonsFromEvent(event, event.button);
    // Desktop camera look follows the familiar third-person RPG split:
    // left-drag only orbits the camera, right-drag steers both camera and player
    // facing, and both buttons together also feed forward movement. Click still
    // does not double as a pulse action, because that made normal camera work
    // feel like accidental spell casting with extra steps.
    void this.canvas.requestPointerLock();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.isInputEnabled()) return;
    if (document.pointerLockElement !== this.canvas) return;
    if (this.cameraDragPointerId === null) return;
    this.syncMouseButtonsFromEvent(event);
    if (!this.hasMouseButtonHeld()) {
      this.releaseCameraDrag();
      return;
    }

    this.applyLookDelta(
      -event.movementX * LOOK_SENSITIVITY_X,
      event.movementY * LOOK_SENSITIVITY_Y,
      this.cameraDragMode === "steer"
    );
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.button !== MOUSE_BUTTON_LEFT && event.button !== MOUSE_BUTTON_RIGHT) return;
    if (this.cameraDragPointerId !== null && event.pointerId !== this.cameraDragPointerId) return;
    event.preventDefault();
    this.syncMouseButtonsFromEvent(event);
    if (this.hasMouseButtonHeld()) return;
    this.releaseCameraDrag();
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.cameraDragPointerId !== null && event.pointerId !== this.cameraDragPointerId) return;
    this.releaseCameraDrag();
  };

  private handlePointerLockChange = (): void => {
    const lockedToCanvas = document.pointerLockElement === this.canvas;
    if (lockedToCanvas && this.cameraDragPointerId === null) {
      // Pointer lock can be granted after a very quick click-release. If the
      // button is no longer held by the time the lock arrives, immediately give
      // the cursor back and mark it as a quiet camera release.
      this.releaseCameraDrag();
      return;
    }

    if (!lockedToCanvas) {
      this.cameraDragPointerId = null;
      this.cameraDragMode = null;
      this.isLeftMouseHeld = false;
      this.isRightMouseHeld = false;
    }
  };

  private handleWindowBlur = (): void => {
    this.releaseCameraDrag();
  };

  private handleContextMenu = (event: MouseEvent): void => {
    // Right-drag is a steering gesture inside the scene, not a browser menu.
    event.preventDefault();
  };

  private handleWheel = (event: WheelEvent): void => {
    if (!this.isInputEnabled()) return;
    event.preventDefault();
    this.adjustZoom(event.deltaY * CAMERA_WHEEL_ZOOM_SPEED);
  };

  private tryCreatePulse(): void {
    const now = this.timeSeconds;
    if (now - this.lastPulseSecond < PULSE_COOLDOWN_SECONDS) return;
    this.lastPulseSecond = now;
    this.onPulse(this.createPulsePosition());
  }

  private releaseCameraDrag(): void {
    this.cameraDragPointerId = null;
    this.cameraDragMode = null;
    this.isLeftMouseHeld = false;
    this.isRightMouseHeld = false;
    if (document.pointerLockElement !== this.canvas) return;

    // Main still opens the pause menu for an Esc-style unlock. This callback
    // tells it that a normal mouse-button release is expected camera behavior,
    // so it should not treat the unlock as a pause request.
    this.onQuietPointerUnlock();
    document.exitPointerLock();
  }

  private setMouseButtonHeld(button: number, held: boolean): void {
    if (button === MOUSE_BUTTON_LEFT) this.isLeftMouseHeld = held;
    if (button === MOUSE_BUTTON_RIGHT) this.isRightMouseHeld = held;
    this.syncCameraDragModeFromHeldButtons();
  }

  private syncMouseButtonsFromEvent(event: PointerEvent, pressedFallbackButton?: number): void {
    if (event.buttons === 0 && pressedFallbackButton !== undefined) {
      // Some pointer-lock transitions can hand us a down event before the
      // aggregate bitmask has caught up. Keep the pressed button as a fallback,
      // but use the browser-owned bitmask everywhere else so a missed/downgraded
      // release cannot leave the both-button forward gesture stuck on one side.
      this.setMouseButtonHeld(pressedFallbackButton, true);
      return;
    }

    this.isLeftMouseHeld = (event.buttons & MOUSE_BUTTON_LEFT_MASK) !== 0;
    this.isRightMouseHeld = (event.buttons & MOUSE_BUTTON_RIGHT_MASK) !== 0;
    this.syncCameraDragModeFromHeldButtons();
  }

  private syncCameraDragModeFromHeldButtons(): void {
    if (this.isRightMouseHeld) {
      this.cameraDragMode = "steer";
      this.playerYaw = this.cameraYaw;
      return;
    }

    this.cameraDragMode = this.isLeftMouseHeld ? "camera" : null;
  }

  private hasMouseButtonHeld(): boolean {
    return this.isLeftMouseHeld || this.isRightMouseHeld;
  }

  private isMouseForwardMoveActive(): boolean {
    return this.isLeftMouseHeld && this.isRightMouseHeld && this.cameraDragMode === "steer";
  }

  private tryJump(): void {
    if (!this.grounded) return;

    this.grounded = false;
    this.verticalVelocity = JUMP_INITIAL_SPEED;
    this.jumpOffset = Math.max(this.jumpOffset, 0.02);
    this.jumpStartedAt = this.timeSeconds;
    this.jumpCount += 1;
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
      ? Math.max(0, this.timeSeconds - this.jumpStartedAt)
      : 0;
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpStartedAt = -Infinity;
    this.landCount += 1;
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

  private createTelemetrySnapshot(
    forwardInput: boolean,
    backwardInput: boolean,
    turnLeftInput: boolean,
    turnRightInput: boolean,
    strafeLeftInput: boolean,
    strafeRightInput: boolean,
    boostInput: boolean,
    movementInputActive: boolean,
    braking: boolean,
    inputEnabled: boolean
  ): PlayerControlTelemetry {
    const gamepadState = this.gamepad?.getState() ?? null;
    const gamepadConnected = inputEnabled && gamepadState?.connected === true;
    return {
      cameraDragMode: inputEnabled ? this.cameraDragMode : null,
      leftMouseHeld: inputEnabled && this.isLeftMouseHeld,
      rightMouseHeld: inputEnabled && this.isRightMouseHeld,
      gamepadConnected,
      gamepadLookActive: gamepadConnected && gamepadState.rightStick.magnitude > GAMEPAD_INPUT_EPSILON,
      gamepadTurnInput: gamepadConnected && Math.abs(gamepadState.leftStick.x) > GAMEPAD_INPUT_EPSILON,
      gamepadBrakeInput: gamepadConnected
        && this.gamepad?.isPressed(GAMEPAD_BUTTON.secondary) === true,
      mouseForwardMoveActive: inputEnabled && this.isMouseForwardMoveActive(),
      cameraYawTravel: this.cameraYawTravel,
      playerYawTravel: this.playerYawTravel,
      forwardInput: inputEnabled && forwardInput,
      backwardInput: inputEnabled && backwardInput,
      turnLeftInput: inputEnabled && turnLeftInput,
      turnRightInput: inputEnabled && turnRightInput,
      strafeLeftInput: inputEnabled && strafeLeftInput,
      strafeRightInput: inputEnabled && strafeRightInput,
      boostInput: inputEnabled && boostInput,
      movementInputActive: inputEnabled && movementInputActive,
      braking,
      grounded: this.grounded,
      speed: this.getSpeed(),
      jumpCount: this.jumpCount,
      landCount: this.landCount,
      wallContactCount: this.wallContactCount,
      lastWallContactSecond: this.lastWallContactSecond
    };
  }
}

/** Return the signed, wrapped turn from one yaw angle to another. */
function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function normalizeGamepadSensitivitySettings(
  settings: GamepadSensitivitySettings
): GamepadSensitivitySettings {
  return {
    leftStick: THREE.MathUtils.clamp(
      settings.leftStick,
      GAMEPAD_SENSITIVITY_LIMITS.min,
      GAMEPAD_SENSITIVITY_LIMITS.max
    ),
    rightStick: THREE.MathUtils.clamp(
      settings.rightStick,
      GAMEPAD_SENSITIVITY_LIMITS.min,
      GAMEPAD_SENSITIVITY_LIMITS.max
    )
  };
}
