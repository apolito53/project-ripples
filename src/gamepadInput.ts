import { debugEvent, roundMetric } from "./debugLog";

/**
 * W3C standard-mapping button indices. Browsers expose Xbox-style ordering
 * even when the physical controller uses different glyphs.
 */
export const GAMEPAD_BUTTON = {
  primary: 0,
  secondary: 1,
  pulse: 2,
  north: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  view: 8,
  menu: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15
} as const;

export type GamepadNavigationDirection = "up" | "down" | "left" | "right";

export type GamepadStick = {
  readonly x: number;
  readonly y: number;
  readonly magnitude: number;
};

export type GamepadControlState = {
  readonly connected: boolean;
  readonly index: number | null;
  readonly id: string;
  readonly mapping: string;
  readonly leftStick: GamepadStick;
  readonly rightStick: GamepadStick;
  readonly leftTrigger: number;
  readonly rightTrigger: number;
  readonly hapticsAvailable: boolean;
  readonly lastInputAt: number;
};

export type GamepadHapticPulse = {
  readonly durationMs: number;
  readonly strongMagnitude: number;
  readonly weakMagnitude: number;
};

type MutableStick = {
  x: number;
  y: number;
  magnitude: number;
};

type MutableGamepadControlState = {
  connected: boolean;
  index: number | null;
  id: string;
  mapping: string;
  leftStick: MutableStick;
  rightStick: MutableStick;
  leftTrigger: number;
  rightTrigger: number;
  hapticsAvailable: boolean;
  lastInputAt: number;
};

type HapticActuator = {
  playEffect(
    type: "dual-rumble",
    parameters: {
      duration: number;
      startDelay: number;
      strongMagnitude: number;
      weakMagnitude: number;
    }
  ): Promise<string>;
  reset?(): Promise<string>;
};

type HapticGamepad = Gamepad & {
  readonly vibrationActuator?: HapticActuator | null;
};

const MAX_TRACKED_BUTTONS = 32;
const LEFT_STICK_DEAD_ZONE = 0.14;
const RIGHT_STICK_DEAD_ZONE = 0.12;
const NAVIGATION_PRESS_THRESHOLD = 0.64;
const NAVIGATION_RELEASE_THRESHOLD = 0.38;
// Menu controls should behave like a console UI: one deliberate step, then a
// steady repeat while held. This is especially important for long sliders.
const NAVIGATION_REPEAT_DELAY_MS = 310;
const NAVIGATION_REPEAT_INTERVAL_MS = 72;
const ACTIVE_AXIS_THRESHOLD = 0.18;
const ACTIVE_BUTTON_THRESHOLD = 0.12;
const HAPTIC_COOLDOWN_MS = 42;
const ACTIVE_INPUT_LOG_INTERVAL_MS = 1_000;
const POLL_ERROR_LOG_INTERVAL_MS = 5_000;

const NAVIGATION_BUTTONS: Record<GamepadNavigationDirection, number> = {
  up: GAMEPAD_BUTTON.dpadUp,
  down: GAMEPAD_BUTTON.dpadDown,
  left: GAMEPAD_BUTTON.dpadLeft,
  right: GAMEPAD_BUTTON.dpadRight
};

/**
 * Small frame-polled controller bridge shared by gameplay and menu code.
 *
 * Browser Gamepad objects are live views, so this class copies the values the
 * game needs into stable arrays every rendered frame. Button edges are
 * consumable: a fixed-step catch-up frame can run PlayerRig several times
 * without turning one physical press into several jumps.
 */
export class GamepadInput {
  private readonly buttonValues = new Float32Array(MAX_TRACKED_BUTTONS);
  private readonly buttonPressed = new Uint8Array(MAX_TRACKED_BUTTONS);
  private readonly previousButtonPressed = new Uint8Array(MAX_TRACKED_BUTTONS);
  private readonly justPressed = new Uint8Array(MAX_TRACKED_BUTTONS);
  private readonly justReleased = new Uint8Array(MAX_TRACKED_BUTTONS);
  private readonly navigationHeld: Record<GamepadNavigationDirection, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false
  };
  private readonly navigationPressed: Record<GamepadNavigationDirection, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false
  };
  private readonly navigationNextRepeatAt: Record<GamepadNavigationDirection, number> = {
    up: Infinity,
    down: Infinity,
    left: Infinity,
    right: Infinity
  };
  private readonly state: MutableGamepadControlState = {
    connected: false,
    index: null,
    id: "",
    mapping: "",
    leftStick: { x: 0, y: 0, magnitude: 0 },
    rightStick: { x: 0, y: 0, magnitude: 0 },
    leftTrigger: 0,
    rightTrigger: 0,
    hapticsAvailable: false,
    lastInputAt: -Infinity
  };
  private controllerKey: string | null = null;
  private hasButtonBaseline = false;
  private lastHapticAt = -Infinity;
  private lastActiveInputLogAt = -Infinity;
  private lastPollErrorLogAt = -Infinity;

  poll(now = performance.now()): void {
    this.justPressed.fill(0);
    this.justReleased.fill(0);
    this.clearNavigationEdges();

    const pad = this.findActiveGamepad();
    const nextKey = pad ? `${pad.index}:${pad.id}` : null;
    if (nextKey !== this.controllerKey) {
      this.handleControllerChange(pad, nextKey);
    }

    if (!pad) {
      this.clearState();
      return;
    }

    this.state.connected = true;
    this.state.index = pad.index;
    this.state.id = pad.id;
    this.state.mapping = pad.mapping;
    this.state.hapticsAvailable = Boolean((pad as HapticGamepad).vibrationActuator);

    applyRadialDeadZone(
      pad.axes[0] ?? 0,
      pad.axes[1] ?? 0,
      LEFT_STICK_DEAD_ZONE,
      this.state.leftStick
    );
    applyRadialDeadZone(
      pad.axes[2] ?? 0,
      pad.axes[3] ?? 0,
      RIGHT_STICK_DEAD_ZONE,
      this.state.rightStick
    );

    this.copyButtons(pad);
    this.state.leftTrigger = this.getButtonValue(GAMEPAD_BUTTON.leftTrigger);
    this.state.rightTrigger = this.getButtonValue(GAMEPAD_BUTTON.rightTrigger);
    this.updateNavigationEdges(now);

    if (this.hasActiveInput()) {
      this.state.lastInputAt = now;
      if (now - this.lastActiveInputLogAt >= ACTIVE_INPUT_LOG_INTERVAL_MS) {
        this.lastActiveInputLogAt = now;
        debugEvent("gamepad.frame", "Sampled active controller input", {
          index: pad.index,
          leftStick: {
            x: roundMetric(this.state.leftStick.x),
            y: roundMetric(this.state.leftStick.y),
            magnitude: roundMetric(this.state.leftStick.magnitude)
          },
          rightStick: {
            x: roundMetric(this.state.rightStick.x),
            y: roundMetric(this.state.rightStick.y),
            magnitude: roundMetric(this.state.rightStick.magnitude)
          },
          leftTrigger: roundMetric(this.state.leftTrigger),
          rightTrigger: roundMetric(this.state.rightTrigger),
          pressedButtons: this.getPressedButtonIndices()
        }, "debug");
      }
    }
  }

  getState(): GamepadControlState {
    return this.state;
  }

  isPressed(button: number): boolean {
    return this.buttonPressed[button] === 1;
  }

  getButtonValue(button: number): number {
    return this.buttonValues[button] ?? 0;
  }

  consumePress(button: number): boolean {
    if (this.justPressed[button] !== 1) return false;
    this.justPressed[button] = 0;
    return true;
  }

  consumeRelease(button: number): boolean {
    if (this.justReleased[button] !== 1) return false;
    this.justReleased[button] = 0;
    return true;
  }

  consumeNavigation(direction: GamepadNavigationDirection): boolean {
    // Consume the raw D-pad edge as well as the repeat pulse. The raw edge is
    // still useful to gameplay for one-shot zoom when no menu is active.
    const dpadPressed = this.consumePress(NAVIGATION_BUTTONS[direction]);
    const navigationPressed = this.navigationPressed[direction];
    this.navigationPressed[direction] = false;
    return dpadPressed || navigationPressed;
  }

  playHaptic(pulse: GamepadHapticPulse): void {
    const now = performance.now();
    if (now - this.lastHapticAt < HAPTIC_COOLDOWN_MS) return;

    const pad = this.getSelectedGamepad() as HapticGamepad | null;
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;

    this.lastHapticAt = now;
    const duration = clamp(pulse.durationMs, 0, 1_000);
    const strongMagnitude = clamp(pulse.strongMagnitude, 0, 1);
    const weakMagnitude = clamp(pulse.weakMagnitude, 0, 1);
    void actuator.playEffect("dual-rumble", {
      duration,
      startDelay: 0,
      strongMagnitude,
      weakMagnitude
    }).catch((error: unknown) => {
      debugEvent("gamepad.haptics", "Controller haptic pulse failed", {
        controllerIndex: pad.index,
        durationMs: roundMetric(duration),
        error: describeError(error)
      }, "warn");
    });
  }

  private findActiveGamepad(): Gamepad | null {
    try {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(
        (pad): pad is Gamepad => pad !== null && pad.connected
      );
      if (pads.length === 0) return null;

      // Keep the same slot while it exists. If it disappears, prefer a
      // standards-mapped replacement before falling back to an unusual pad.
      const selectedIndex = this.state.index;
      return pads.find((pad) => pad.index === selectedIndex)
        ?? pads.find((pad) => pad.mapping === "standard")
        ?? pads[0]
        ?? null;
    } catch (error) {
      const now = performance.now();
      if (now - this.lastPollErrorLogAt >= POLL_ERROR_LOG_INTERVAL_MS) {
        this.lastPollErrorLogAt = now;
        debugEvent("gamepad.poll", "Gamepad API polling failed", {
          error: describeError(error)
        }, "warn");
      }
      return null;
    }
  }

  private getSelectedGamepad(): Gamepad | null {
    const selectedIndex = this.state.index;
    if (selectedIndex === null) return null;
    try {
      return navigator.getGamepads?.()[selectedIndex] ?? null;
    } catch {
      return null;
    }
  }

  private handleControllerChange(pad: Gamepad | null, nextKey: string | null): void {
    if (this.controllerKey) {
      debugEvent("gamepad.disconnected", "Controller left the active input slot", {
        controller: this.controllerKey
      }, "info");
    }

    this.controllerKey = nextKey;
    this.hasButtonBaseline = false;
    this.buttonPressed.fill(0);
    this.previousButtonPressed.fill(0);
    this.justPressed.fill(0);
    this.justReleased.fill(0);
    this.resetNavigationState();

    if (pad) {
      debugEvent("gamepad.connected", "Controller became the active input device", {
        index: pad.index,
        id: pad.id,
        mapping: pad.mapping,
        axes: pad.axes.length,
        buttons: pad.buttons.length,
        hapticsAvailable: Boolean((pad as HapticGamepad).vibrationActuator)
      }, "info");
    }
  }

  private copyButtons(pad: Gamepad): void {
    this.previousButtonPressed.set(this.buttonPressed);
    this.buttonPressed.fill(0);
    this.buttonValues.fill(0);

    const buttonCount = Math.min(pad.buttons.length, MAX_TRACKED_BUTTONS);
    for (let index = 0; index < buttonCount; index += 1) {
      const button = pad.buttons[index];
      const value = clamp(button?.value ?? 0, 0, 1);
      const pressed = Boolean(button?.pressed) || value >= 0.5;
      this.buttonValues[index] = value;
      this.buttonPressed[index] = pressed ? 1 : 0;

      if (!this.hasButtonBaseline) continue;
      if (pressed && this.previousButtonPressed[index] === 0) this.justPressed[index] = 1;
      if (!pressed && this.previousButtonPressed[index] === 1) this.justReleased[index] = 1;
    }

    this.hasButtonBaseline = true;
  }

  private updateNavigationEdges(now: number): void {
    const x = this.state.leftStick.x;
    const y = this.state.leftStick.y;
    this.updateNavigationDirection(
      "up",
      this.isPressed(GAMEPAD_BUTTON.dpadUp) || y <= -NAVIGATION_PRESS_THRESHOLD,
      !this.isPressed(GAMEPAD_BUTTON.dpadUp) && y > -NAVIGATION_RELEASE_THRESHOLD,
      now
    );
    this.updateNavigationDirection(
      "down",
      this.isPressed(GAMEPAD_BUTTON.dpadDown) || y >= NAVIGATION_PRESS_THRESHOLD,
      !this.isPressed(GAMEPAD_BUTTON.dpadDown) && y < NAVIGATION_RELEASE_THRESHOLD,
      now
    );
    this.updateNavigationDirection(
      "left",
      this.isPressed(GAMEPAD_BUTTON.dpadLeft) || x <= -NAVIGATION_PRESS_THRESHOLD,
      !this.isPressed(GAMEPAD_BUTTON.dpadLeft) && x > -NAVIGATION_RELEASE_THRESHOLD,
      now
    );
    this.updateNavigationDirection(
      "right",
      this.isPressed(GAMEPAD_BUTTON.dpadRight) || x >= NAVIGATION_PRESS_THRESHOLD,
      !this.isPressed(GAMEPAD_BUTTON.dpadRight) && x < NAVIGATION_RELEASE_THRESHOLD,
      now
    );
  }

  private updateNavigationDirection(
    direction: GamepadNavigationDirection,
    pressed: boolean,
    released: boolean,
    now: number
  ): void {
    if (!this.navigationHeld[direction] && pressed) {
      this.navigationHeld[direction] = true;
      this.navigationPressed[direction] = true;
      this.navigationNextRepeatAt[direction] = now + NAVIGATION_REPEAT_DELAY_MS;
      return;
    }
    if (this.navigationHeld[direction] && released) {
      this.navigationHeld[direction] = false;
      this.navigationNextRepeatAt[direction] = Infinity;
      return;
    }
    if (this.navigationHeld[direction] && now >= this.navigationNextRepeatAt[direction]) {
      this.navigationPressed[direction] = true;
      // Scheduling from `now` avoids a burst of catch-up ticks after a sleeping
      // tab or debugger pause; UI repetition should stay human-paced.
      this.navigationNextRepeatAt[direction] = now + NAVIGATION_REPEAT_INTERVAL_MS;
    }
  }

  private clearNavigationEdges(): void {
    this.navigationPressed.up = false;
    this.navigationPressed.down = false;
    this.navigationPressed.left = false;
    this.navigationPressed.right = false;
  }

  private resetNavigationState(): void {
    this.clearNavigationEdges();
    this.navigationHeld.up = false;
    this.navigationHeld.down = false;
    this.navigationHeld.left = false;
    this.navigationHeld.right = false;
    this.navigationNextRepeatAt.up = Infinity;
    this.navigationNextRepeatAt.down = Infinity;
    this.navigationNextRepeatAt.left = Infinity;
    this.navigationNextRepeatAt.right = Infinity;
  }

  private hasActiveInput(): boolean {
    if (this.state.leftStick.magnitude >= ACTIVE_AXIS_THRESHOLD) return true;
    if (this.state.rightStick.magnitude >= ACTIVE_AXIS_THRESHOLD) return true;
    for (let index = 0; index < this.buttonValues.length; index += 1) {
      if (this.buttonValues[index] >= ACTIVE_BUTTON_THRESHOLD) return true;
    }
    return false;
  }

  private getPressedButtonIndices(): number[] {
    const pressedButtons: number[] = [];
    for (let index = 0; index < this.buttonPressed.length; index += 1) {
      if (this.buttonPressed[index] === 1) pressedButtons.push(index);
    }
    return pressedButtons;
  }

  private clearState(): void {
    this.state.connected = false;
    this.state.index = null;
    this.state.id = "";
    this.state.mapping = "";
    this.state.leftStick.x = 0;
    this.state.leftStick.y = 0;
    this.state.leftStick.magnitude = 0;
    this.state.rightStick.x = 0;
    this.state.rightStick.y = 0;
    this.state.rightStick.magnitude = 0;
    this.state.leftTrigger = 0;
    this.state.rightTrigger = 0;
    this.state.hapticsAvailable = false;
    this.buttonValues.fill(0);
    this.buttonPressed.fill(0);
    this.previousButtonPressed.fill(0);
    this.hasButtonBaseline = false;
    this.resetNavigationState();
  }
}

/** Apply a circular dead zone while preserving stick direction and full range. */
export function applyRadialDeadZone(
  x: number,
  y: number,
  deadZone: number,
  output: MutableStick = { x: 0, y: 0, magnitude: 0 }
): GamepadStick {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const safeDeadZone = clamp(deadZone, 0, 0.95);
  const rawMagnitude = Math.hypot(safeX, safeY);

  if (rawMagnitude <= safeDeadZone) {
    output.x = 0;
    output.y = 0;
    output.magnitude = 0;
    return output;
  }

  const clampedMagnitude = Math.min(rawMagnitude, 1);
  const adjustedMagnitude = (clampedMagnitude - safeDeadZone) / (1 - safeDeadZone);
  output.x = (safeX / rawMagnitude) * adjustedMagnitude;
  output.y = (safeY / rawMagnitude) * adjustedMagnitude;
  output.magnitude = adjustedMagnitude;
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
