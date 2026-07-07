import * as THREE from "three";
import type { PlayerControlTelemetry } from "./controls";
import { debugEvent, roundMetric, vectorPayload } from "./debugLog";
import type { RaceTrack } from "./raceTrack";

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

export type TrainingRunOptions = {
  readonly sampleHeight: (x: number, z: number) => number;
  readonly spawnEchoAtTrackFraction: (fraction: number, lateralOffsetMeters: number, time: number) => boolean;
  readonly spawnCelebrationPulse: (position: THREE.Vector3, time: number) => void;
};

type TrainingRunUpdate = {
  readonly time: number;
  readonly playerPosition: THREE.Vector3;
  readonly telemetry: PlayerControlTelemetry;
  readonly raceTrack: RaceTrack;
};

type TrainingStep = {
  readonly id: TrainingStepId;
  readonly title: string;
  readonly instruction: string;
  readonly fraction: number;
  readonly lateralOffsetMeters: number;
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
const MOMENTUM_SPEED_GOAL = 7.5;
const MOMENTUM_SLIDE_SPEED_GOAL = 2;

export class TrainingRun {
  readonly object = new THREE.Group();
  private readonly options: TrainingRunOptions;
  private readonly marker = createTrainingMarker();
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
  private baseline: TrainingStepBaseline = {
    cameraYawTravel: 0,
    playerYawTravel: 0,
    jumpCount: 0,
    wallContactCount: 0
  };
  private lastPlayerPosition = new THREE.Vector3();

  constructor(scene: THREE.Scene, options: TrainingRunOptions) {
    this.options = options;
    this.object.name = "Training Run director";
    this.object.visible = false;
    this.object.add(this.marker);
    scene.add(this.object);
  }

  start(time: number, playerPosition: THREE.Vector3, telemetry: PlayerControlTelemetry, raceTrack: RaceTrack): void {
    this.active = true;
    this.complete = false;
    this.stepIndex = 0;
    this.startedAt = time;
    this.lastPlayerPosition.copy(playerPosition);
    this.object.visible = true;
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
    this.resetKeyboardProgress();
    this.object.visible = false;
  }

  update(input: TrainingRunUpdate): void {
    if (!this.active || this.complete) return;

    this.lastPlayerPosition.copy(input.playerPosition);
    this.positionMarker(input.raceTrack, this.currentStep());
    this.updateStepProgress(input);
  }

  handleEchoCollected(time: number, telemetry: PlayerControlTelemetry, raceTrack: RaceTrack): void {
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
    return {
      visible: true,
      complete: false,
      stepIndex: this.stepIndex,
      stepCount: TRAINING_STEPS.length,
      title: step.title,
      instruction: step.instruction,
      chips: this.getProgressChips(step)
    };
  }

  private updateStepProgress(input: TrainingRunUpdate): void {
    const step = this.currentStep();
    const telemetry = input.telemetry;

    switch (step.id) {
      case "camera-orbit":
        if (telemetry.cameraDragMode === "camera" && telemetry.cameraYawTravel - this.baseline.cameraYawTravel >= CAMERA_YAW_GOAL) {
          this.completeCurrentStep(input.time, "camera-orbit", telemetry, input.raceTrack);
        }
        return;
      case "steer-facing":
        if (telemetry.cameraDragMode === "steer" && telemetry.playerYawTravel - this.baseline.playerYawTravel >= PLAYER_YAW_GOAL) {
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
        if (telemetry.mouseForwardMoveActive && telemetry.speed >= MOUSE_FORWARD_SPEED_GOAL) {
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
    raceTrack: RaceTrack
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
    this.object.visible = false;
    const burstPosition = this.lastPlayerPosition.clone();
    burstPosition.y = this.options.sampleHeight(burstPosition.x, burstPosition.z) + 0.45;
    this.options.spawnCelebrationPulse(burstPosition, time);

    debugEvent("training.finish", "Finished Training Run tutorial", {
      durationSeconds: roundMetric(time - this.startedAt),
      playerPosition: vectorPayload(this.lastPlayerPosition)
    }, "info");
  }

  private enterStep(time: number, telemetry: PlayerControlTelemetry, raceTrack: RaceTrack): void {
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

  private positionMarker(raceTrack: RaceTrack, step: TrainingStep): void {
    const position = raceTrack.samplePointAt(step.fraction, step.lateralOffsetMeters);
    position.y = this.options.sampleHeight(position.x, position.z) + 0.24;
    this.object.position.copy(position);
    this.object.rotation.y = raceTrack.getFacingYawAt(step.fraction);
  }

  private currentStep(): TrainingStep {
    return TRAINING_STEPS[this.stepIndex] ?? TRAINING_STEPS[TRAINING_STEPS.length - 1];
  }

  private getProgressChips(step: TrainingStep): readonly TrainingProgressChip[] {
    switch (step.id) {
      case "keyboard-movement":
        return [
          { label: "W", complete: this.keyboardProgress.forward },
          { label: "S", complete: this.keyboardProgress.backward },
          { label: "A/D", complete: this.keyboardProgress.turn },
          { label: "Q/E", complete: this.keyboardProgress.strafe }
        ];
      case "camera-orbit":
        return [{ label: "Left drag", complete: false }];
      case "steer-facing":
        return [{ label: "Right drag", complete: false }];
      case "mouse-forward":
        return [{ label: "Both buttons", complete: false }];
      case "boost":
        return [
          { label: "Move", complete: this.boostMoved },
          { label: "Shift", complete: this.boostHeld }
        ];
      case "momentum-brake":
        return [
          { label: "Build speed", complete: this.carriedMomentum },
          { label: "Release", complete: false }
        ];
      case "jump":
        return [{ label: "Space", complete: false }];
      case "echo-pickup":
        return [{ label: this.echoSpawned ? "Echo placed" : "Echo pending", complete: this.echoSpawned }];
      case "wall-slide":
        return [{ label: "Wall touch", complete: false }];
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

  const postGeometry = new THREE.BoxGeometry(0.22, 3.4, 0.22);
  const beamGeometry = new THREE.BoxGeometry(5.2, 0.16, 0.18);
  const glowGeometry = new THREE.PlaneGeometry(5.8, 3.8);

  const leftPost = new THREE.Mesh(postGeometry, postMaterial);
  leftPost.position.set(-2.7, 1.7, 0);
  const rightPost = new THREE.Mesh(postGeometry, postMaterial);
  rightPost.position.set(2.7, 1.7, 0);
  const topBeam = new THREE.Mesh(beamGeometry, beamMaterial);
  topBeam.position.set(0, 3.38, 0);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, 1.9, -0.04);

  marker.add(glow, leftPost, rightPost, topBeam);
  return marker;
}
