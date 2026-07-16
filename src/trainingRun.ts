import * as THREE from "three";
import type { PlayerControlTelemetry } from "./controls";
import { debugEvent, roundMetric, vectorPayload } from "./debugLog";

export type TrainingCourse = {
  samplePointAt(fraction: number, lateralOffsetMeters?: number): THREE.Vector3;
  getFacingYawAt(fraction: number): number;
};

type TrainingStepId =
  | "camera-orbit"
  | "steer-facing"
  | "keyboard-movement"
  | "boost"
  | "mouse-forward"
  | "momentum-brake"
  | "jump"
  | "echo-pickup"
  | "wall-slide";

export type TrainingProgressChip = {
  readonly label: string;
  readonly complete: boolean;
};

export type TrainingHudState = {
  readonly visible: boolean;
  readonly complete: boolean;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly title: string;
  readonly instruction: string;
  readonly chips: readonly TrainingProgressChip[];
};

export type TrainingMarkerPresentationSnapshot = {
  readonly visible: boolean;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly facingYawRadians: number;
  readonly halfWidth: number;
  readonly postHeight: number;
  readonly postWidth: number;
  readonly beamY: number;
  readonly beamThickness: number;
  readonly beamDepth: number;
  readonly glowWidth: number;
  readonly glowHeight: number;
};

export type TrainingPresentationSnapshot = {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly complete: boolean;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly marker: TrainingMarkerPresentationSnapshot;
};

export type TrainingRunOptions = {
  readonly sampleHeight: (x: number, z: number) => number;
  readonly spawnEchoAtTrackFraction: (fraction: number, lateralOffsetMeters: number, time: number) => boolean;
  readonly spawnCelebrationPulse: (position: THREE.Vector3, time: number) => void;
};

type TrainingRunUpdate = {
  readonly time: number;
  readonly playerPosition: THREE.Vector3;
  readonly telemetry: PlayerControlTelemetry;
  readonly raceTrack: TrainingCourse;
};

type TrainingStep = {
  readonly id: TrainingStepId;
  readonly title: string;
  readonly instruction: string;
  readonly fraction: number;
  readonly lateralOffsetMeters: number;
};

type TrainingStepPresentation = {
  readonly title: string;
  readonly instruction: string;
};

type TrainingStepBaseline = {
  readonly cameraYawTravel: number;
  readonly playerYawTravel: number;
  readonly jumpCount: number;
  readonly wallContactCount: number;
};

type KeyboardStepProgress = {
  forward: boolean;
  backward: boolean;
  turn: boolean;
  strafe: boolean;
};

const TRAINING_STEPS: readonly TrainingStep[] = [
  {
    id: "camera-orbit",
    title: "Camera Orbit",
    instruction: "Hold left mouse and drag to look around without turning the pod.",
    fraction: 0.02,
    lateralOffsetMeters: 0
  },
  {
    id: "steer-facing",
    title: "Steer Facing",
    instruction: "Hold right mouse and drag to turn the camera and pod together.",
    fraction: 0.08,
    lateralOffsetMeters: 0
  },
  {
    id: "keyboard-movement",
    title: "Keyboard Movement",
    instruction: "Tap W, S, A or D, and Q or E so the whole movement set is in your hands.",
    fraction: 0.15,
    lateralOffsetMeters: -5
  },
  {
    id: "boost",
    title: "Boost",
    instruction: "Hold Shift while moving to kick from base pace into boost.",
    fraction: 0.2,
    lateralOffsetMeters: -2
  },
  {
    id: "mouse-forward",
    title: "Mouse Run",
    instruction: "Hold left and right mouse together to move forward toward the camera heading.",
    fraction: 0.27,
    lateralOffsetMeters: 0
  },
  {
    id: "momentum-brake",
    title: "Carry Momentum",
    instruction: "Build speed, release movement, and feel the pod slide before it settles.",
    fraction: 0.36,
    lateralOffsetMeters: 4
  },
  {
    id: "jump",
    title: "Jump",
    instruction: "Press Space and watch the surface response when you leave the field.",
    fraction: 0.45,
    lateralOffsetMeters: 0
  },
  {
    id: "echo-pickup",
    title: "Collect Echo",
    instruction: "Run through the scripted Echo column and let it detonate.",
    fraction: 0.57,
    lateralOffsetMeters: -4
  },
  {
    id: "wall-slide",
    title: "Wall Slide",
    instruction: "Scrape a glowing track wall and recover without killing your speed.",
    fraction: 0.68,
    lateralOffsetMeters: 16
  }
];

const CAMERA_YAW_GOAL = 0.2;
const PLAYER_YAW_GOAL = 0.2;
const BOOST_SPEED_GOAL = 12;
const MOUSE_FORWARD_SPEED_GOAL = 2;
const GAMEPAD_BRAKE_ARM_SPEED = 4;
const GAMEPAD_BRAKE_STOP_SPEED = 0.45;
const MOMENTUM_SPEED_GOAL = 7.5;
const MOMENTUM_SLIDE_SPEED_GOAL = 2;
const MARKER_HALF_WIDTH = 2.7;
const MARKER_POST_HEIGHT = 3.4;
const MARKER_POST_WIDTH = 0.22;
const MARKER_BEAM_Y = 3.38;
const MARKER_BEAM_THICKNESS = 0.16;
const MARKER_BEAM_DEPTH = 0.18;
const MARKER_GLOW_WIDTH = 5.8;
const MARKER_GLOW_HEIGHT = 3.8;

export class TrainingRun {
  private readonly object: THREE.Group | null;
  private readonly options: TrainingRunOptions;
  private readonly marker: THREE.Group | null;
  private readonly keyboardProgress: KeyboardStepProgress = {
    forward: false,
    backward: false,
    turn: false,
    strafe: false
  };
  private active = false;
  private complete = false;
  private stepIndex = 0;
  private startedAt = 0;
  private stepStartedAt = 0;
  private echoSpawned = false;
  private carriedMomentum = false;
  private boostMoved = false;
  private boostHeld = false;
  private gamepadBrakeArmed = false;
  private gamepadConnected = false;
  private baseline: TrainingStepBaseline = {
    cameraYawTravel: 0,
    playerYawTravel: 0,
    jumpCount: 0,
    wallContactCount: 0
  };
  private lastPlayerPosition = new THREE.Vector3();
  private readonly markerPosition = new THREE.Vector3();
  private markerFacingYaw = 0;

  constructor(scene: THREE.Scene | null, options: TrainingRunOptions) {
    this.options = options;
    if (scene) {
      this.object = new THREE.Group();
      this.object.name = "Training Run director";
      this.object.visible = false;
      this.marker = createTrainingMarker();
      this.object.add(this.marker);
      scene.add(this.object);
    } else {
      // The WebGPU lane consumes the neutral marker snapshot and must not
      // allocate an unused Three marker hierarchy.
      this.object = null;
      this.marker = null;
    }
  }

  start(time: number, playerPosition: THREE.Vector3, telemetry: PlayerControlTelemetry, raceTrack: TrainingCourse): void {
    this.active = true;
    this.complete = false;
    this.stepIndex = 0;
    this.startedAt = time;
    this.gamepadConnected = telemetry.gamepadConnected;
    this.lastPlayerPosition.copy(playerPosition);
    if (this.object) this.object.visible = true;
    this.enterStep(time, telemetry, raceTrack);

    debugEvent("training.start", "Started Training Run tutorial", {
      stepCount: TRAINING_STEPS.length,
      playerPosition: vectorPayload(playerPosition)
    }, "info");
  }

  reset(reason: string): void {
    if (this.active || this.complete) {
      debugEvent("training.reset", "Reset Training Run tutorial", {
        reason,
        stepIndex: this.stepIndex,
        complete: this.complete
      }, "info");
    }

    this.active = false;
    this.complete = false;
    this.stepIndex = 0;
    this.startedAt = 0;
    this.echoSpawned = false;
    this.carriedMomentum = false;
    this.boostMoved = false;
    this.boostHeld = false;
    this.gamepadBrakeArmed = false;
    this.gamepadConnected = false;
    this.resetKeyboardProgress();
    if (this.object) this.object.visible = false;
  }

  update(input: TrainingRunUpdate): void {
    if (!this.active || this.complete) return;

    this.gamepadConnected = input.telemetry.gamepadConnected;
    this.lastPlayerPosition.copy(input.playerPosition);
    this.positionMarker(input.raceTrack, this.currentStep());
    this.updateStepProgress(input);
  }

  handleEchoCollected(time: number, telemetry: PlayerControlTelemetry, raceTrack: TrainingCourse): void {
    if (!this.active || this.complete) return;
    if (this.currentStep().id !== "echo-pickup") return;
    this.completeCurrentStep(time, "echo-collected", telemetry, raceTrack);
  }

  getHudState(): TrainingHudState {
    if (!this.active && !this.complete) {
      return {
        visible: false,
        complete: false,
        stepIndex: 0,
        stepCount: TRAINING_STEPS.length,
        title: "",
        instruction: "",
        chips: []
      };
    }

    if (this.complete) {
      return {
        visible: true,
        complete: true,
        stepIndex: TRAINING_STEPS.length,
        stepCount: TRAINING_STEPS.length,
        title: "Training Complete",
        instruction: "You have the core handling kit. Go make the track behave.",
        chips: TRAINING_STEPS.map((step) => ({ label: step.title, complete: true }))
      };
    }

    const step = this.currentStep();
    const presentation = this.getStepPresentation(step);
    return {
      visible: true,
      complete: false,
      stepIndex: this.stepIndex,
      stepCount: TRAINING_STEPS.length,
      title: presentation.title,
      instruction: presentation.instruction,
      chips: this.getProgressChips(step)
    };
  }

  getPresentationSnapshot(): TrainingPresentationSnapshot {
    const enabled = this.active || this.complete;
    const step = this.currentStep();

    return {
      enabled,
      active: this.active,
      complete: this.complete,
      stepId: enabled ? step.id : "",
      stepIndex: enabled ? Math.min(this.stepIndex + 1, TRAINING_STEPS.length) : 0,
      stepCount: TRAINING_STEPS.length,
      marker: {
        visible: this.active && !this.complete,
        position: {
          x: this.markerPosition.x,
          y: this.markerPosition.y,
          z: this.markerPosition.z
        },
        facingYawRadians: this.markerFacingYaw,
        halfWidth: MARKER_HALF_WIDTH,
        postHeight: MARKER_POST_HEIGHT,
        postWidth: MARKER_POST_WIDTH,
        beamY: MARKER_BEAM_Y,
        beamThickness: MARKER_BEAM_THICKNESS,
        beamDepth: MARKER_BEAM_DEPTH,
        glowWidth: MARKER_GLOW_WIDTH,
        glowHeight: MARKER_GLOW_HEIGHT
      }
    };
  }

  private updateStepProgress(input: TrainingRunUpdate): void {
    const step = this.currentStep();
    const telemetry = input.telemetry;

    switch (step.id) {
      case "camera-orbit":
        if (
          (telemetry.gamepadConnected ? telemetry.gamepadLookActive : telemetry.cameraDragMode === "camera")
          && telemetry.cameraYawTravel - this.baseline.cameraYawTravel >= CAMERA_YAW_GOAL
        ) {
          this.completeCurrentStep(input.time, "camera-orbit", telemetry, input.raceTrack);
        }
        return;
      case "steer-facing":
        if (
          (telemetry.gamepadConnected ? telemetry.gamepadTurnInput : telemetry.cameraDragMode === "steer")
          && telemetry.playerYawTravel - this.baseline.playerYawTravel >= PLAYER_YAW_GOAL
        ) {
          this.completeCurrentStep(input.time, "steer-facing", telemetry, input.raceTrack);
        }
        return;
      case "keyboard-movement":
        this.keyboardProgress.forward ||= telemetry.forwardInput;
        this.keyboardProgress.backward ||= telemetry.backwardInput;
        this.keyboardProgress.turn ||= telemetry.turnLeftInput || telemetry.turnRightInput;
        this.keyboardProgress.strafe ||= telemetry.strafeLeftInput || telemetry.strafeRightInput;
        if (this.keyboardProgress.forward && this.keyboardProgress.backward && this.keyboardProgress.turn && this.keyboardProgress.strafe) {
          this.completeCurrentStep(input.time, "keyboard-set", telemetry, input.raceTrack);
        }
        return;
      case "boost":
        this.boostMoved ||= telemetry.movementInputActive;
        this.boostHeld ||= telemetry.boostInput;
        if (this.boostMoved && this.boostHeld && telemetry.speed >= BOOST_SPEED_GOAL) {
          this.completeCurrentStep(input.time, "boost", telemetry, input.raceTrack);
        }
        return;
      case "mouse-forward":
        if (telemetry.gamepadConnected) {
          // Require a real moving brake test so pulling back while already
          // parked cannot accidentally skip the lesson.
          this.gamepadBrakeArmed ||= telemetry.gamepadBrakeInput
            && telemetry.speed >= GAMEPAD_BRAKE_ARM_SPEED;
          if (
            this.gamepadBrakeArmed
            && telemetry.gamepadBrakeInput
            && telemetry.speed <= GAMEPAD_BRAKE_STOP_SPEED
          ) {
            this.completeCurrentStep(input.time, "gamepad-brake", telemetry, input.raceTrack);
          }
        } else if (telemetry.mouseForwardMoveActive && telemetry.speed >= MOUSE_FORWARD_SPEED_GOAL) {
          this.completeCurrentStep(input.time, "mouse-forward", telemetry, input.raceTrack);
        }
        return;
      case "momentum-brake":
        this.carriedMomentum ||= telemetry.speed >= MOMENTUM_SPEED_GOAL && telemetry.movementInputActive;
        if (this.carriedMomentum && telemetry.braking && telemetry.speed >= MOMENTUM_SLIDE_SPEED_GOAL) {
          this.completeCurrentStep(input.time, "momentum-slide", telemetry, input.raceTrack);
        }
        return;
      case "jump":
        if (telemetry.jumpCount > this.baseline.jumpCount) {
          this.completeCurrentStep(input.time, "jump", telemetry, input.raceTrack);
        }
        return;
      case "echo-pickup":
        return;
      case "wall-slide":
        if (telemetry.wallContactCount > this.baseline.wallContactCount) {
          this.completeCurrentStep(input.time, "wall-contact", telemetry, input.raceTrack);
        }
        return;
    }
  }

  private completeCurrentStep(
    time: number,
    completion: string,
    telemetry: PlayerControlTelemetry,
    raceTrack: TrainingCourse
  ): void {
    const completedStep = this.currentStep();
    debugEvent("training.step", "Completed Training Run step", {
      step: completedStep.id,
      stepIndex: this.stepIndex + 1,
      stepCount: TRAINING_STEPS.length,
      completion,
      elapsedSeconds: roundMetric(time - this.stepStartedAt),
      speed: roundMetric(telemetry.speed)
    }, "info");

    if (this.stepIndex >= TRAINING_STEPS.length - 1) {
      this.finish(time);
      return;
    }

    this.stepIndex += 1;
    this.enterStep(time, telemetry, raceTrack);
  }

  private finish(time: number): void {
    this.complete = true;
    this.active = false;
    if (this.object) this.object.visible = false;
    const burstPosition = this.lastPlayerPosition.clone();
    burstPosition.y = this.options.sampleHeight(burstPosition.x, burstPosition.z) + 0.45;
    this.options.spawnCelebrationPulse(burstPosition, time);

    debugEvent("training.finish", "Finished Training Run tutorial", {
      durationSeconds: roundMetric(time - this.startedAt),
      playerPosition: vectorPayload(this.lastPlayerPosition)
    }, "info");
  }

  private enterStep(time: number, telemetry: PlayerControlTelemetry, raceTrack: TrainingCourse): void {
    this.stepStartedAt = time;
    this.baseline = {
      cameraYawTravel: telemetry.cameraYawTravel,
      playerYawTravel: telemetry.playerYawTravel,
      jumpCount: telemetry.jumpCount,
      wallContactCount: telemetry.wallContactCount
    };
    this.echoSpawned = false;
    this.carriedMomentum = false;
    this.boostMoved = false;
    this.boostHeld = false;
    this.gamepadBrakeArmed = false;
    this.resetKeyboardProgress();

    const step = this.currentStep();
    this.positionMarker(raceTrack, step);
    if (step.id === "echo-pickup") {
      this.echoSpawned = this.options.spawnEchoAtTrackFraction(step.fraction, step.lateralOffsetMeters, time);
      if (!this.echoSpawned) {
        debugEvent("training.echo", "Failed to place scripted Training Run Echo", {
          step: step.id,
          fraction: step.fraction,
          lateralOffsetMeters: step.lateralOffsetMeters
        }, "warn");
      }
    }
  }

  private positionMarker(raceTrack: TrainingCourse, step: TrainingStep): void {
    const position = raceTrack.samplePointAt(step.fraction, step.lateralOffsetMeters);
    position.y = this.options.sampleHeight(position.x, position.z) + 0.24;
    this.markerPosition.copy(position);
    this.markerFacingYaw = raceTrack.getFacingYawAt(step.fraction);
    if (this.object) {
      this.object.position.copy(this.markerPosition);
      this.object.rotation.y = this.markerFacingYaw;
    }
  }

  private currentStep(): TrainingStep {
    return TRAINING_STEPS[this.stepIndex] ?? TRAINING_STEPS[TRAINING_STEPS.length - 1];
  }

  private getProgressChips(step: TrainingStep): readonly TrainingProgressChip[] {
    switch (step.id) {
      case "keyboard-movement":
        return [
          { label: this.gamepadConnected ? "Forward" : "W", complete: this.keyboardProgress.forward },
          { label: this.gamepadConnected ? "Reverse" : "S", complete: this.keyboardProgress.backward },
          { label: this.gamepadConnected ? "Steer" : "A/D", complete: this.keyboardProgress.turn },
          { label: this.gamepadConnected ? "LB/RB" : "Q/E", complete: this.keyboardProgress.strafe }
        ];
      case "camera-orbit":
        return [{ label: this.gamepadConnected ? "Right stick" : "Left drag", complete: false }];
      case "steer-facing":
        return [{ label: this.gamepadConnected ? "Left stick" : "Right drag", complete: false }];
      case "mouse-forward":
        return [{
          label: this.gamepadConnected ? "B" : "Both buttons",
          complete: this.gamepadConnected ? this.gamepadBrakeArmed : false
        }];
      case "boost":
        return [
          { label: "Move", complete: this.boostMoved },
          { label: this.gamepadConnected ? "RT" : "Shift", complete: this.boostHeld }
        ];
      case "momentum-brake":
        return [
          { label: "Build speed", complete: this.carriedMomentum },
          { label: "Release", complete: false }
        ];
      case "jump":
        return [{ label: this.gamepadConnected ? "A" : "Space", complete: false }];
      case "echo-pickup":
        return [{ label: this.echoSpawned ? "Echo placed" : "Echo pending", complete: this.echoSpawned }];
      case "wall-slide":
        return [{ label: "Wall touch", complete: false }];
    }
  }

  private getStepPresentation(step: TrainingStep): TrainingStepPresentation {
    if (!this.gamepadConnected) {
      return { title: step.title, instruction: step.instruction };
    }

    switch (step.id) {
      case "camera-orbit":
        return {
          title: "Camera Orbit",
          instruction: "Move the right stick to orbit the camera without turning the pod."
        };
      case "steer-facing":
        return {
          title: "Steer Facing",
          instruction: "Move the left stick left or right to turn the pod and its follow camera."
        };
      case "keyboard-movement":
        return {
          title: "Controller Movement",
          instruction: "Move the camera-relative left stick forward, back, and both ways, then tap LB or RB to strafe."
        };
      case "boost":
        return {
          title: "Boost",
          instruction: "Hold RT while moving to blend from base pace into full boost."
        };
      case "mouse-forward":
        return {
          title: "Active Brake",
          instruction: "Build some speed, then hold B until the pod stops."
        };
      case "momentum-brake":
        return {
          title: "Carry Momentum",
          instruction: "Build speed, release the left stick, and feel the pod slide before it settles."
        };
      case "jump":
        return {
          title: "Jump",
          instruction: "Press A and watch the surface response when you leave the field."
        };
      case "echo-pickup":
      case "wall-slide":
        return { title: step.title, instruction: step.instruction };
    }
  }

  private resetKeyboardProgress(): void {
    this.keyboardProgress.forward = false;
    this.keyboardProgress.backward = false;
    this.keyboardProgress.turn = false;
    this.keyboardProgress.strafe = false;
  }
}

function createTrainingMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "Training objective gate";

  const postMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dffd8,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7de7,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dffd8,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const postGeometry = new THREE.BoxGeometry(MARKER_POST_WIDTH, MARKER_POST_HEIGHT, MARKER_POST_WIDTH);
  const beamGeometry = new THREE.BoxGeometry(MARKER_HALF_WIDTH * 2 - MARKER_POST_WIDTH, MARKER_BEAM_THICKNESS, MARKER_BEAM_DEPTH);
  const glowGeometry = new THREE.PlaneGeometry(MARKER_GLOW_WIDTH, MARKER_GLOW_HEIGHT);

  const leftPost = new THREE.Mesh(postGeometry, postMaterial);
  leftPost.position.set(-MARKER_HALF_WIDTH, MARKER_POST_HEIGHT * 0.5, 0);
  const rightPost = new THREE.Mesh(postGeometry, postMaterial);
  rightPost.position.set(MARKER_HALF_WIDTH, MARKER_POST_HEIGHT * 0.5, 0);
  const topBeam = new THREE.Mesh(beamGeometry, beamMaterial);
  topBeam.position.set(0, MARKER_BEAM_Y, 0);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, MARKER_GLOW_HEIGHT * 0.5, -0.04);

  marker.add(glow, leftPost, rightPost, topBeam);
  return marker;
}
