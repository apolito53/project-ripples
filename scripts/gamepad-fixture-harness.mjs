import assert from "node:assert/strict";
import { delay } from "./ripple-smoke-harness.mjs";

export const GAMEPAD_BUTTON = Object.freeze({
  primary: 0,
  secondary: 1,
  pulse: 2,
  leftBumper: 4,
  rightBumper: 5,
  rightTrigger: 7,
  view: 8,
  menu: 9,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15
});

export const MOCK_CONTROLLER_ID = "Ripple Verification Pad";
export const MOCK_BUTTON_COUNT = 17;
const BUTTON_SETTLE_MS = 55;

export async function installDeterministicGamepad(context) {
  await context.addInitScript(installGamepadMock, {
    buttonCount: MOCK_BUTTON_COUNT,
    controllerId: MOCK_CONTROLLER_ID
  });
}

export async function advanceWithGamepadInput(page, input, ticks) {
  assert.ok(Number.isInteger(ticks) && ticks > 0, `Visual-capture ticks must be a positive integer; received ${ticks}.`);
  return page.evaluate(async ({ nextInput, tickCount }) => {
    const gamepadMock = window.__rippleGamepadMock;
    const visualCapture = window.__rippleVisualCapture;
    if (!gamepadMock) throw new Error("Gamepad mock is unavailable.");
    if (!visualCapture) throw new Error("Visual capture API is unavailable.");

    gamepadMock.applyInput(nextInput);
    const targetTick = visualCapture.getTick() + tickCount;
    await visualCapture.advanceToTick(targetTick);
    return visualCapture.freezeAndDescribe();
  }, { nextInput: input, tickCount: ticks });
}

export async function captureVisualState(page) {
  return page.evaluate(() => {
    if (!window.__rippleVisualCapture) throw new Error("Visual capture API is unavailable.");
    return window.__rippleVisualCapture.freezeAndDescribe();
  });
}

export async function advanceUntilVisualState(page, input, predicate, label, options = {}) {
  const maxTicks = options.maxTicks ?? 180;
  const chunkTicks = options.chunkTicks ?? 6;
  let advancedTicks = 0;
  let snapshot = await captureVisualState(page);

  while (advancedTicks < maxTicks) {
    const ticks = Math.min(chunkTicks, maxTicks - advancedTicks);
    snapshot = await advanceWithGamepadInput(page, input, ticks);
    advancedTicks += ticks;
    if (predicate(snapshot)) return snapshot;
  }

  throw new Error(
    `${label} did not satisfy its contract within ${maxTicks} ticks: ` +
    JSON.stringify(summarizeSnapshot(snapshot))
  );
}

export async function connectMockGamepad(page) {
  const baselineReads = await page.evaluate(() => {
    const mock = window.__rippleGamepadMock;
    if (!mock) throw new Error("Gamepad mock is unavailable.");
    const reads = mock.getReadCount();
    mock.connect();
    return reads;
  });
  await waitForMockPoll(page, baselineReads);
}

export async function disconnectMockGamepad(page) {
  const baselineReads = await page.evaluate(() => {
    const mock = window.__rippleGamepadMock;
    if (!mock) throw new Error("Gamepad mock is unavailable.");
    const reads = mock.getReadCount();
    mock.disconnect();
    return reads;
  });
  await waitForMockPoll(page, baselineReads);
}

export async function tapGamepadButton(page, buttonIndex) {
  await setMockButtonAndWait(page, buttonIndex, 1);
  await setMockButtonAndWait(page, buttonIndex, 0);
  await delay(BUTTON_SETTLE_MS);
}

export async function readMockSnapshot(page) {
  return page.evaluate(() => {
    if (!window.__rippleGamepadMock) throw new Error("Gamepad mock is unavailable.");
    return window.__rippleGamepadMock.snapshot();
  });
}

async function setMockButtonAndWait(page, buttonIndex, value) {
  const baselineReads = await page.evaluate(({ index, nextValue }) => {
    const mock = window.__rippleGamepadMock;
    if (!mock) throw new Error("Gamepad mock is unavailable.");
    const reads = mock.getReadCount();
    mock.setButton(index, nextValue);
    return reads;
  }, { index: buttonIndex, nextValue: value });
  await waitForMockPoll(page, baselineReads);
}

async function waitForMockPoll(page, baselineReads) {
  await page.waitForFunction(
    (reads) => window.__rippleGamepadMock?.getReadCount() > reads,
    baselineReads,
    { timeout: 5000 }
  );
}

function summarizeSnapshot(snapshot) {
  return {
    tick: snapshot.tick,
    playMode: snapshot.playMode,
    trainingStep: snapshot.training?.stepId ?? null,
    speed: snapshot.player?.speed,
    position: snapshot.player?.position,
    velocity: snapshot.player?.velocity,
    activeSources: snapshot.activeSources,
    activeEchoes: snapshot.activeEchoes
  };
}

function installGamepadMock({ buttonCount, controllerId }) {
  const buttons = Array.from({ length: buttonCount }, () => ({
    pressed: false,
    touched: false,
    value: 0
  }));
  const state = {
    axes: [0, 0, 0, 0],
    connected: false,
    hapticCalls: [],
    readCount: 0,
    resetCalls: 0,
    timestamp: 0
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const touch = () => {
    state.timestamp += 1;
  };
  const setButton = (index, value) => {
    const button = buttons[index];
    if (!button) throw new Error(`Mock gamepad has no button ${index}.`);
    const nextValue = clamp(Number(value) || 0, 0, 1);
    button.value = nextValue;
    button.pressed = nextValue >= 0.5;
    button.touched = nextValue > 0;
    touch();
  };
  const resetInput = () => {
    state.axes.fill(0);
    for (let index = 0; index < buttons.length; index += 1) setButton(index, 0);
  };

  const actuator = {
    type: "dual-rumble",
    effects: ["dual-rumble"],
    async playEffect(type, parameters) {
      state.hapticCalls.push({
        type,
        parameters: {
          duration: parameters.duration,
          startDelay: parameters.startDelay,
          strongMagnitude: parameters.strongMagnitude,
          weakMagnitude: parameters.weakMagnitude
        }
      });
      return "complete";
    },
    async reset() {
      state.resetCalls += 1;
      return "complete";
    }
  };
  const pad = {
    id: controllerId,
    index: 0,
    mapping: "standard",
    hand: "",
    buttons,
    vibrationActuator: actuator,
    hapticActuators: [actuator],
    get axes() {
      return state.axes;
    },
    get connected() {
      return state.connected;
    },
    get timestamp() {
      return state.timestamp;
    }
  };
  const getGamepads = () => {
    state.readCount += 1;
    return state.connected ? [pad] : [null];
  };

  let installed = false;
  for (const target of [window.navigator, Navigator.prototype]) {
    try {
      Object.defineProperty(target, "getGamepads", {
        configurable: true,
        value: getGamepads
      });
      installed = true;
    } catch {
      // One of the instance/prototype locations is sufficient.
    }
  }
  if (!installed) throw new Error("Could not install deterministic navigator.getGamepads mock.");

  window.__rippleGamepadMock = {
    applyInput(input = {}) {
      resetInput();
      const axes = Array.isArray(input.axes) ? input.axes : [];
      for (let index = 0; index < state.axes.length; index += 1) {
        state.axes[index] = clamp(Number(axes[index]) || 0, -1, 1);
      }
      for (const [index, value] of Object.entries(input.buttons ?? {})) {
        setButton(Number(index), value);
      }
      touch();
    },
    connect() {
      state.connected = true;
      touch();
    },
    disconnect() {
      state.connected = false;
      resetInput();
      touch();
    },
    getReadCount() {
      return state.readCount;
    },
    setButton,
    snapshot() {
      return {
        axes: [...state.axes],
        buttons: buttons.map((button) => ({ ...button })),
        connected: state.connected,
        hapticCalls: state.hapticCalls.map((call) => ({
          type: call.type,
          parameters: { ...call.parameters }
        })),
        readCount: state.readCount,
        resetCalls: state.resetCalls,
        timestamp: state.timestamp
      };
    }
  };
}
