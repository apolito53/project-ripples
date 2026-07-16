import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  buildAppUrl,
  createHarnessConfig,
  delay,
  ensureServersReady,
  fetchJson
} from "./ripple-smoke-harness.mjs";

const GAMEPAD_BUTTON = Object.freeze({
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
const MOCK_CONTROLLER_ID = "Ripple Verification Pad";
const MOCK_BUTTON_COUNT = 17;
const BUTTON_SETTLE_MS = 55;
const WEBGPU_SUCCESS_FORBIDDEN_CHANNELS = Object.freeze([
  "webgpu.uncapturedError",
  "webgpu.deviceLost",
  "webgpu.runtimeFatal",
  "webgpu.fallback",
  "webgpu.unavailable",
  "wake.init",
  "skybox.load"
]);

const config = createHarnessConfig();
const serverScope = await ensureServersReady(config);
let browser;

try {
  browser = await launchBrowser();
  for (const backendId of ["webgl", "webgpu"]) {
    await verifyGamepadContract(browser, backendId);
  }
} finally {
  await browser?.close();
  serverScope.shutdown();
}

async function verifyGamepadContract(browserInstance, backendId) {
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });
  await context.addInitScript(installGamepadMock, {
    buttonCount: MOCK_BUTTON_COUNT,
    controllerId: MOCK_CONTROLLER_ID
  });

  const page = await context.newPage();
  const pageProblems = collectPageProblems(page);
  const smokeRun = createSmokeRun(`gamepad-${backendId}`);
  const url = buildAppUrl(config, {
    renderer: backendId,
    smokeRun,
    visualCapture: "1"
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(
      () => window.__rippleVisualCapture?.enabled === true,
      undefined,
      { timeout: 30000 }
    );
    await page.evaluate(() => window.__rippleVisualCapture.ready());
    await page.locator(`canvas[data-renderer-backend="${backendId}"]`).waitFor({
      state: "visible",
      timeout: 30000
    });

    const initialMode = await waitForRunEvent(page, smokeRun, "renderer.mode", (record) =>
      record.entry.payload?.activeBackend === backendId &&
      record.entry.payload?.playMode === "none"
    );
    const menuSnapshot = await captureState(page);
    assert.equal(menuSnapshot.backendId, backendId, `${backendId} capture selected the wrong backend.`);
    assert.equal(menuSnapshot.playMode, "none", `${backendId} did not start at the main menu.`);
    assert.equal(menuSnapshot.training, null, `${backendId} exposed Training state at the main menu.`);
    assertNear(menuSnapshot.player.speed, 0, 0.001, `${backendId} main-menu player speed`);

    if (backendId === "webgpu") {
      assert.equal(initialMode.entry.payload.trainingEnabled, false, "WebGPU main-menu Training state was enabled.");
      assert.equal(initialMode.entry.payload.trainingStepIndex, 0, "WebGPU main-menu Training step was not neutral.");
      assert.equal(initialMode.entry.payload.trainingMarkerVisible, false, "WebGPU main-menu marker was visible.");
    }

    await verifyControllerConnection(page, smokeRun);
    await tapGamepadButton(page, GAMEPAD_BUTTON.primary);
    await page.locator("#main-menu").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator("#training-hud:not([hidden])").waitFor({ timeout: 10000 });
    await waitForRunEvent(page, smokeRun, "mode.select", (record) =>
      record.entry.payload?.mode === "training" && record.entry.payload?.reason === "menu"
    );
    await assertHapticDuration(page, 62, `${backendId} main-menu A selection`);

    const neutralTraining = await advanceWithInput(page, {}, 1);
    assert.equal(neutralTraining.playMode, "training", `${backendId} A did not select Training.`);
    assert.equal(neutralTraining.training?.stepId, "camera-orbit", `${backendId} Training did not start at Camera Orbit.`);
    assert.equal(neutralTraining.training?.stepIndex, 1, `${backendId} Training step index was not one-based.`);
    assert.equal(neutralTraining.training?.markerVisible, true, `${backendId} initial Training marker was hidden.`);
    assertNear(neutralTraining.player.speed, 0, 0.001, `${backendId} neutral Training speed`);
    assertVectorNear(neutralTraining.player.velocity, { x: 0, y: 0, z: 0 }, 0.001, `${backendId} neutral velocity`);
    await assertTrainingUi(page, {
      title: "Camera Orbit",
      instruction: "Move the right stick to orbit the camera without turning the pod.",
      chips: ["Right stick"]
    });

    await verifyPauseUiContract(page);
    const completed = await verifyGameplayAndTrainingContract(page, backendId, neutralTraining);

    await assertHapticContract(page, backendId);

    await disconnectMockGamepad(page);
    await waitForStatusText(page, "Controller: press any button to connect");
    await waitForRunEvent(page, smokeRun, "gamepad.disconnected");
    const diagnostics = await readRunEventsAfterFlush(page, smokeRun);
    assertRuntimeDiagnostics(diagnostics, backendId);
    pageProblems.assertNoErrors(`${backendId} gamepad verification`);

    console.log(
      `[ripple-field-lab:verify:gamepad:${backendId}] controller UI, Training, and gameplay contract OK ` +
      `(tick=${completed.tick}, sources=${completed.activeSources}) at ${url}`
    );
  } finally {
    await context.close();
  }
}

async function verifyControllerConnection(page, smokeRun) {
  await waitForStatusText(page, "Controller: press any button to connect");
  const before = await readMockSnapshot(page);
  assert.equal(before.connected, false, "Mock controller unexpectedly started connected.");
  assert.deepEqual(before.hapticCalls, [], "Mock controller received haptics before connecting.");

  await connectMockGamepad(page);
  await waitForStatusText(page, `${MOCK_CONTROLLER_ID} ready - A select - Menu pause`);
  const connected = await waitForRunEvent(page, smokeRun, "gamepad.connected", (record) =>
    record.entry.payload?.id === MOCK_CONTROLLER_ID &&
    record.entry.payload?.mapping === "standard" &&
    record.entry.payload?.hapticsAvailable === true
  );
  assert.equal(connected.entry.payload.axes, 4, "Connected controller reported the wrong axis count.");
  assert.equal(connected.entry.payload.buttons, MOCK_BUTTON_COUNT, "Connected controller reported the wrong button count.");
}

async function verifyPauseUiContract(page) {
  // Menu must be a true toggle while gameplay owns input.
  await tapGamepadButton(page, GAMEPAD_BUTTON.menu);
  await assertPauseVisible(page, true);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id ?? ""),
    "resume-button",
    "Pause did not put the safe Resume action under controller focus."
  );
  await tapGamepadButton(page, GAMEPAD_BUTTON.primary);
  await assertPauseVisible(page, false);

  // View is global, including while the pause dialog owns controller focus.
  await tapGamepadButton(page, GAMEPAD_BUTTON.menu);
  await assertPauseVisible(page, true);
  await tapGamepadButton(page, GAMEPAD_BUTTON.view);
  await page.locator("#perf-overlay:not([hidden])").waitFor({ timeout: 5000 });
  assert.equal(await page.locator("#perf-overlay-toggle").getAttribute("aria-pressed"), "true");
  await tapGamepadButton(page, GAMEPAD_BUTTON.view);
  await page.locator("#perf-overlay").waitFor({ state: "hidden", timeout: 5000 });

  // B is conventional Back in overlays, but remains braking input in play.
  await tapGamepadButton(page, GAMEPAD_BUTTON.secondary);
  await assertPauseVisible(page, false);

  await tapGamepadButton(page, GAMEPAD_BUTTON.menu);
  await assertPauseVisible(page, true);
  await navigateDownTo(page, "#settings-tab-graphics");
  await tapGamepadButton(page, GAMEPAD_BUTTON.dpadRight);
  await page.locator("#settings-tab-field[aria-selected='true']").waitFor({ timeout: 5000 });
  await tapGamepadButton(page, GAMEPAD_BUTTON.dpadRight);
  await page.locator("#settings-tab-movement[aria-selected='true']").waitFor({ timeout: 5000 });
  await page.locator("#settings-panel-movement:not([hidden])").waitFor({ timeout: 5000 });

  await navigateDownTo(page, "#left-stick-sensitivity-slider");
  await verifySliderDirections(page, "#left-stick-sensitivity-slider", "#left-stick-sensitivity-value");
  await navigateDownTo(page, "#right-stick-sensitivity-slider");
  await verifySliderDirections(page, "#right-stick-sensitivity-slider", "#right-stick-sensitivity-value", true);

  await tapGamepadButton(page, GAMEPAD_BUTTON.menu);
  await assertPauseVisible(page, false);
}

async function verifyGameplayAndTrainingContract(page, backendId, neutralTraining) {
  const orbitSnapshot = await advanceUntil(
    page,
    { axes: [0, 0, 0.9, 0] },
    (snapshot) => snapshot.training?.stepId === "steer-facing",
    `${backendId} right-stick camera orbit`,
    { maxTicks: 120, chunkTicks: 8 }
  );
  assert.ok(
    vectorDistance(orbitSnapshot.camera.position, neutralTraining.camera.position) > 0.1,
    `${backendId} right stick did not move the camera.`
  );
  assert.ok(
    angleDistance(orbitSnapshot.player.facingYawRadians, neutralTraining.player.facingYawRadians) < 0.05,
    `${backendId} right-stick orbit unexpectedly turned the player.`
  );
  assert.notEqual(
    orbitSnapshot.training.markerDigest,
    neutralTraining.training.markerDigest,
    `${backendId} Training marker did not advance after Camera Orbit.`
  );
  await assertTrainingUi(page, {
    title: "Steer Facing",
    instruction: "Move the left stick left or right to turn the pod and its follow camera.",
    chips: ["Left stick"]
  });

  await advanceWithInput(page, {}, 1);
  const steeringBaseline = await captureState(page);
  const steeringSnapshot = await advanceUntil(
    page,
    { axes: [0.9, 0, 0, 0] },
    (snapshot) => snapshot.training?.stepId === "keyboard-movement",
    `${backendId} left-stick steering`,
    { maxTicks: 120, chunkTicks: 8 }
  );
  assert.ok(
    vectorDistance(steeringSnapshot.player.position, steeringBaseline.player.position) > 0.05,
    `${backendId} left stick did not move the player.`
  );
  assert.ok(
    angleDistance(steeringSnapshot.player.facingYawRadians, steeringBaseline.player.facingYawRadians) > 0.1,
    `${backendId} left stick did not steer player facing.`
  );
  await assertTrainingUi(page, {
    title: "Controller Movement",
    instruction: "Move the camera-relative left stick forward, back, and both ways, then tap LB or RB to strafe.",
    chips: ["Forward", "Reverse", "Steer", "LB/RB"]
  });

  await brakeToStop(page, `${backendId} pre-bumper stop`);
  const leftBumper = await advanceUntil(
    page,
    { buttons: { [GAMEPAD_BUTTON.leftBumper]: 1 } },
    (snapshot) => snapshot.player.speed > 1,
    `${backendId} LB strafe`,
    { maxTicks: 60, chunkTicks: 6 }
  );
  await brakeToStop(page, `${backendId} LB stop`);
  const rightBumper = await advanceUntil(
    page,
    { buttons: { [GAMEPAD_BUTTON.rightBumper]: 1 } },
    (snapshot) => snapshot.player.speed > 1,
    `${backendId} RB strafe`,
    { maxTicks: 60, chunkTicks: 6 }
  );
  assert.ok(
    normalizedPlanarDot(leftBumper.player.velocity, rightBumper.player.velocity) < -0.7,
    `${backendId} LB and RB did not produce opposite strafing velocities.`
  );
  await brakeToStop(page, `${backendId} post-bumper stop`);

  await advanceWithInput(page, { axes: [-0.9, 0, 0, 0] }, 8);
  await advanceWithInput(page, { axes: [0, -0.9, 0, 0] }, 8);
  const movementComplete = await advanceWithInput(page, { axes: [0, 0.9, 0, 0] }, 8);
  assert.equal(movementComplete.training?.stepId, "boost", `${backendId} controller movement alternatives did not complete.`);
  await assertTrainingUi(page, {
    title: "Boost",
    instruction: "Hold RT while moving to blend from base pace into full boost.",
    chips: ["Move", "RT"]
  });

  const boosted = await advanceUntil(
    page,
    {
      axes: [0, -1, 0, 0],
      buttons: { [GAMEPAD_BUTTON.rightTrigger]: 1 }
    },
    (snapshot) => snapshot.training?.stepId === "mouse-forward",
    `${backendId} RT boost`,
    { maxTicks: 240, chunkTicks: 10 }
  );
  assert.ok(boosted.player.speed >= 12, `${backendId} RT did not reach the Training boost threshold.`);
  await assertTrainingUi(page, {
    title: "Active Brake",
    instruction: "Build some speed, then hold B until the pod stops.",
    chips: ["B"]
  });

  const braked = await advanceUntil(
    page,
    { buttons: { [GAMEPAD_BUTTON.secondary]: 1 } },
    (snapshot) => snapshot.training?.stepId === "momentum-brake",
    `${backendId} B active brake`,
    { maxTicks: 180, chunkTicks: 6 }
  );
  assert.ok(braked.player.speed <= 0.45, `${backendId} B did not brake below the Training threshold.`);
  await assertTrainingUi(page, {
    title: "Carry Momentum",
    instruction: "Build speed, release the left stick, and feel the pod slide before it settles.",
    chips: ["Build speed", "Release"]
  });

  await advanceWithInput(page, {}, 1);
  await advanceUntil(
    page,
    { axes: [0, -1, 0, 0] },
    (snapshot) => snapshot.player.speed >= 8,
    `${backendId} momentum build`,
    { maxTicks: 180, chunkTicks: 8 }
  );
  const jumpReady = await advanceUntil(
    page,
    {},
    (snapshot) => snapshot.training?.stepId === "jump",
    `${backendId} momentum release`,
    { maxTicks: 30, chunkTicks: 1 }
  );
  await assertTrainingUi(page, {
    title: "Jump",
    instruction: "Press A and watch the surface response when you leave the field.",
    chips: ["A"]
  });

  const jumped = await advanceWithInput(page, { buttons: { [GAMEPAD_BUTTON.primary]: 1 } }, 6);
  assert.equal(jumped.training?.stepId, "echo-pickup", `${backendId} A did not complete the Jump lesson.`);
  assert.ok(
    jumped.player.position.y > jumpReady.player.position.y,
    `${backendId} A did not raise the player above the field.`
  );
  assert.equal(
    jumped.activeSources,
    jumpReady.activeSources + 1,
    `${backendId} held A repeated a one-shot jump source during fixed-step catch-up.`
  );
  await assertHapticDuration(page, 70, `${backendId} jump`);

  const jumpSourceCount = jumped.activeSources;
  const jumpSourceDigest = jumped.sourceState.digest;
  const pulsed = await advanceWithInput(page, { buttons: { [GAMEPAD_BUTTON.pulse]: 1 } }, 1);
  assert.ok(pulsed.activeSources > jumpSourceCount, `${backendId} X did not add a gameplay pulse.`);
  assert.notEqual(pulsed.sourceState.digest, jumpSourceDigest, `${backendId} X did not change pulse source state.`);
  const landed = await advanceUntil(
    page,
    {},
    (snapshot) => snapshot.player.groundContact >= 0.999 && snapshot.player.position.y < pulsed.player.position.y,
    `${backendId} jump landing`,
    { maxTicks: 180, chunkTicks: 4 }
  );
  await assertHapticDuration(page, 125, `${backendId} landing`);

  return verifyArenaEchoHaptic(page, backendId, landed);
}

async function verifyArenaEchoHaptic(page, backendId, previousSnapshot) {
  await tapGamepadButton(page, GAMEPAD_BUTTON.menu);
  await assertPauseVisible(page, true);
  await navigateDownTo(page, "#exit-to-main-menu-button");
  await tapGamepadButton(page, GAMEPAD_BUTTON.primary);
  await page.locator("#main-menu:not([hidden])").waitFor({ timeout: 5000 });
  await navigateDownTo(page, "#start-arena-button");
  await tapGamepadButton(page, GAMEPAD_BUTTON.primary);
  await page.locator("#main-menu").waitFor({ state: "hidden", timeout: 5000 });

  const arenaStart = await advanceWithInput(page, {}, 1);
  assert.equal(arenaStart.playMode, "arena", `${backendId} controller did not start Arena.`);
  assert.ok(arenaStart.echoState.activeEchoes > 0, `${backendId} Arena did not seed Echoes.`);
  await advanceWithInput(page, { buttons: { [GAMEPAD_BUTTON.dpadUp]: 1 } }, 1);
  const zoomed = await advanceWithInput(page, {}, 20);
  const initialCameraDistance = vectorDistance(arenaStart.camera.position, arenaStart.player.position);
  const zoomedCameraDistance = vectorDistance(zoomed.camera.position, zoomed.player.position);
  assert.ok(
    zoomedCameraDistance < initialCameraDistance - 0.1,
    `${backendId} D-pad Up did not zoom the gameplay camera inward ` +
      `(${initialCameraDistance.toFixed(3)} -> ${zoomedCameraDistance.toFixed(3)}).`
  );
  const collected = await advanceUntil(
    page,
    { axes: [0, -1, 0, 0] },
    (snapshot) => snapshot.echoState.activeEchoes < arenaStart.echoState.activeEchoes &&
      snapshot.echoState.activeVisualBursts > 0,
    `${backendId} Arena Echo collection`,
    { maxTicks: 1_200, chunkTicks: 6 }
  );
  assert.ok(collected.tick !== previousSnapshot.tick || collected.playMode !== previousSnapshot.playMode);
  await assertHapticDuration(page, 240, `${backendId} Echo collection`);

  const freeLook = await advanceWithInput(page, { axes: [0, 0, 0.9, 0] }, 12);
  assert.ok(
    angleDistance(freeLook.player.facingYawRadians, collected.player.facingYawRadians) < 0.05,
    `${backendId} right-stick free look changed player facing before R3.`
  );
  const snapped = await advanceWithInput(page, { buttons: { [GAMEPAD_BUTTON.rightStick]: 1 } }, 1);
  await advanceWithInput(page, {}, 1);
  const cameraHeading = Math.atan2(
    snapped.player.position.x - snapped.camera.position.x,
    snapped.player.position.z - snapped.camera.position.z
  );
  assert.ok(
    angleDistance(snapped.player.facingYawRadians, freeLook.player.facingYawRadians) > 0.1,
    `${backendId} R3 did not change player facing.`
  );
  assert.ok(
    angleDistance(snapped.player.facingYawRadians, cameraHeading) < 0.15,
    `${backendId} R3 did not snap player facing to the camera heading.`
  );
  return snapped;
}

async function verifySliderDirections(page, sliderSelector, outputSelector, startWithLeft = false) {
  const slider = page.locator(sliderSelector);
  const initialValue = Number(await slider.inputValue());
  const step = Number(await slider.getAttribute("step"));
  const firstButton = startWithLeft ? GAMEPAD_BUTTON.dpadLeft : GAMEPAD_BUTTON.dpadRight;
  const secondButton = startWithLeft ? GAMEPAD_BUTTON.dpadRight : GAMEPAD_BUTTON.dpadLeft;
  const direction = startWithLeft ? -1 : 1;

  await tapGamepadButton(page, firstButton);
  assertNear(
    Number(await slider.inputValue()),
    initialValue + direction * step,
    0.0001,
    `${sliderSelector} first controller adjustment`
  );
  await tapGamepadButton(page, secondButton);
  assertNear(Number(await slider.inputValue()), initialValue, 0.0001, `${sliderSelector} reverse adjustment`);
  assert.equal(await page.locator(outputSelector).textContent(), `${Math.round(initialValue * 100)}%`);
}

async function navigateDownTo(page, selector) {
  const targetId = selector.startsWith("#") ? selector.slice(1) : null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const activeId = await page.evaluate(() => document.activeElement?.id ?? "");
    if (targetId && activeId === targetId) return;
    await tapGamepadButton(page, GAMEPAD_BUTTON.dpadDown);
  }

  const activeId = await page.evaluate(() => document.activeElement?.id ?? "");
  throw new Error(`Controller navigation did not reach ${selector}; active element is #${activeId || "unknown"}.`);
}

async function assertPauseVisible(page, visible) {
  if (visible) {
    await page.locator("#scene-menu-backdrop:not([hidden])").waitFor({ timeout: 5000 });
  } else {
    await page.locator("#scene-menu-backdrop").waitFor({ state: "hidden", timeout: 5000 });
  }
  assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), String(visible));
}

async function assertTrainingUi(page, expected) {
  await page.waitForFunction(
    ({ title, instruction }) => {
      const titleElement = document.querySelector("#training-title");
      const instructionElement = document.querySelector("#training-instruction");
      return titleElement?.textContent?.trim() === title &&
        instructionElement?.textContent?.includes(instruction);
    },
    expected,
    { timeout: 10000 }
  );

  const actual = await page.evaluate(() => ({
    title: document.querySelector("#training-title")?.textContent?.trim() ?? "",
    instruction: document.querySelector("#training-instruction")?.textContent?.trim() ?? "",
    chips: [...document.querySelectorAll("#training-progress .training-progress__chip")]
      .map((element) => element.textContent?.trim() ?? "")
  }));
  assert.equal(actual.title, expected.title);
  assert.ok(actual.instruction.includes(expected.instruction));
  for (const chip of expected.chips) {
    assert.ok(actual.chips.includes(chip), `${expected.title} did not expose controller alternative ${chip}.`);
  }
}

async function brakeToStop(page, label) {
  const stopped = await advanceUntil(
    page,
    { buttons: { [GAMEPAD_BUTTON.secondary]: 1 } },
    (snapshot) => snapshot.player.speed <= 0.08,
    label,
    { maxTicks: 120, chunkTicks: 6 }
  );
  await advanceWithInput(page, {}, 1);
  return stopped;
}

async function advanceUntil(page, input, predicate, label, options = {}) {
  const maxTicks = options.maxTicks ?? 180;
  const chunkTicks = options.chunkTicks ?? 6;
  let advancedTicks = 0;
  let snapshot = await captureState(page);

  while (advancedTicks < maxTicks) {
    const ticks = Math.min(chunkTicks, maxTicks - advancedTicks);
    snapshot = await advanceWithInput(page, input, ticks);
    advancedTicks += ticks;
    if (predicate(snapshot)) return snapshot;
  }

  throw new Error(
    `${label} did not satisfy its contract within ${maxTicks} ticks: ` +
    JSON.stringify(summarizeSnapshot(snapshot))
  );
}

async function advanceWithInput(page, input, ticks) {
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

async function captureState(page) {
  return page.evaluate(() => {
    if (!window.__rippleVisualCapture) throw new Error("Visual capture API is unavailable.");
    return window.__rippleVisualCapture.freezeAndDescribe();
  });
}

async function connectMockGamepad(page) {
  const baselineReads = await page.evaluate(() => {
    const mock = window.__rippleGamepadMock;
    if (!mock) throw new Error("Gamepad mock is unavailable.");
    const reads = mock.getReadCount();
    mock.connect();
    return reads;
  });
  await waitForMockPoll(page, baselineReads);
}

async function disconnectMockGamepad(page) {
  const baselineReads = await page.evaluate(() => {
    const mock = window.__rippleGamepadMock;
    if (!mock) throw new Error("Gamepad mock is unavailable.");
    const reads = mock.getReadCount();
    mock.disconnect();
    return reads;
  });
  await waitForMockPoll(page, baselineReads);
}

async function tapGamepadButton(page, buttonIndex) {
  await setMockButtonAndWait(page, buttonIndex, 1);
  await setMockButtonAndWait(page, buttonIndex, 0);
  // The app intentionally throttles haptics. Keeping taps just outside that
  // window makes every expected UI pulse observable without timing races.
  await delay(BUTTON_SETTLE_MS);
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

async function readMockSnapshot(page) {
  return page.evaluate(() => {
    if (!window.__rippleGamepadMock) throw new Error("Gamepad mock is unavailable.");
    return window.__rippleGamepadMock.snapshot();
  });
}

async function assertHapticDuration(page, duration, label) {
  await page.waitForFunction(
    (expectedDuration) => window.__rippleGamepadMock?.snapshot().hapticCalls
      .some((call) => call.parameters.duration === expectedDuration),
    duration,
    { timeout: 5000 }
  );
  const mock = await readMockSnapshot(page);
  assert.ok(
    mock.hapticCalls.some((call) => call.parameters.duration === duration),
    `${label} did not request its ${duration}ms haptic pulse.`
  );
}

async function assertHapticContract(page, backendId) {
  const mock = await readMockSnapshot(page);
  for (const duration of [48, 54, 62, 70, 125, 240]) {
    assert.ok(
      mock.hapticCalls.some((call) => call.parameters.duration === duration),
      `${backendId} did not request the expected ${duration}ms dual-rumble pulse.`
    );
  }
  assert.ok(mock.hapticCalls.length >= 6, `${backendId} produced too few haptic calls.`);
  for (const call of mock.hapticCalls) {
    assert.equal(call.type, "dual-rumble", `${backendId} requested a non-rumble effect.`);
    assert.equal(call.parameters.startDelay, 0, `${backendId} requested a delayed haptic effect.`);
    assert.ok(call.parameters.duration >= 0 && call.parameters.duration <= 1000);
    assert.ok(call.parameters.strongMagnitude >= 0 && call.parameters.strongMagnitude <= 1);
    assert.ok(call.parameters.weakMagnitude >= 0 && call.parameters.weakMagnitude <= 1);
  }
}

async function waitForStatusText(page, expectedText) {
  await page.waitForFunction(
    (expected) => document.querySelector("#gamepad-status")?.textContent?.trim() === expected,
    expectedText,
    { timeout: 5000 }
  );
}

async function waitForRunEvent(page, smokeRun, channel, predicate = () => true, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastChannels = [];

  while (Date.now() < deadline) {
    const records = await readRunEventsAfterFlush(page, smokeRun);
    const found = [...records].reverse().find((record) =>
      record.entry.channel === channel && predicate(record)
    );
    if (found) return found;

    lastChannels = [...new Set(records.map((record) => record.entry.channel))].slice(-12);
    await delay(200);
  }

  throw new Error(
    `Timed out waiting for ${channel} in smokeRun=${smokeRun}. ` +
    `Seen channels: ${lastChannels.join(", ") || "none"}`
  );
}

async function readRunEventsAfterFlush(page, smokeRun) {
  await page.evaluate(() => window.__rippleDebugFlush?.()).catch(() => undefined);
  const eventPayload = await fetchJson(config.logEventsUrl);
  const records = Array.isArray(eventPayload.entries) ? eventPayload.entries : [];
  return records
    .filter((record) => getSmokeRun(record.context?.href) === smokeRun)
    .map((record) => ({
      ...record,
      entry: record.entry ?? { channel: "unknown", level: "info", payload: {} }
    }));
}

function assertRuntimeDiagnostics(records, backendId) {
  const errors = records.filter((record) => record.entry.level === "error");
  assert.equal(errors.length, 0, `${backendId} emitted diagnostic errors:\n${formatRecords(errors)}`);

  const connectedFrames = records.filter((record) =>
    record.entry.channel === "renderer.frameSample" &&
    record.entry.payload?.backendId === backendId &&
    record.entry.payload?.gamepadConnected === true &&
    record.entry.payload?.gamepadHapticsAvailable === true
  );
  assert.ok(connectedFrames.length > 0, `${backendId} never reported a connected haptic gamepad frame.`);
  assert.ok(
    records.some((record) => record.entry.channel === "player.jump"),
    `${backendId} did not emit a player.jump diagnostic for A.`
  );

  if (backendId === "webgpu") {
    const forbidden = new Set(WEBGPU_SUCCESS_FORBIDDEN_CHANNELS);
    const failures = records.filter((record) => forbidden.has(record.entry.channel));
    assert.equal(
      failures.length,
      0,
      `Forced WebGPU gamepad run emitted forbidden diagnostics:\n${formatRecords(failures)}`
    );
    assert.ok(
      records.some((record) =>
        record.entry.channel === "webgpu.sceneState.frame" &&
        record.entry.payload?.stateMode === "playable" &&
        record.entry.payload?.trainingEnabled === true &&
        record.entry.payload?.trainingMarkerVisible === true &&
        record.entry.payload?.deviceLost === false
      ),
      "Forced WebGPU did not report a healthy playable Training marker state."
    );
  }
}

function collectPageProblems(page) {
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  return {
    assertNoErrors(label) {
      if (pageErrors.length > 0) {
        throw new Error(`${label} emitted page errors:\n${pageErrors.join("\n")}`);
      }
      if (consoleErrors.length > 0) {
        throw new Error(`${label} emitted console errors:\n${consoleErrors.join("\n")}`);
      }
    }
  };
}

async function launchBrowser() {
  const launchOptions = {
    headless: process.env.RIPPLE_BROWSER_HEADLESS !== "0",
    args: [
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist"
    ]
  };

  if (process.env.RIPPLE_CHROME_CHANNEL) {
    launchOptions.channel = process.env.RIPPLE_CHROME_CHANNEL;
  } else if (process.platform === "win32") {
    launchOptions.channel = "chrome";
  }

  return chromium.launch(launchOptions);
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

function normalizedPlanarDot(left, right) {
  const leftMagnitude = Math.hypot(left.x, left.z);
  const rightMagnitude = Math.hypot(right.x, right.z);
  if (leftMagnitude === 0 || rightMagnitude === 0) return 1;
  return (left.x * right.x + left.z * right.z) / (leftMagnitude * rightMagnitude);
}

function vectorDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function angleDistance(left, right) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} +/- ${tolerance}, received ${actual}.`
  );
}

function assertVectorNear(actual, expected, tolerance, label) {
  assert.ok(
    vectorDistance(actual, expected) <= tolerance,
    `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`
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
    activeSources: snapshot.activeSources
  };
}

function formatRecords(records) {
  return records
    .slice(0, 8)
    .map((record) => `${record.entry.level}:${record.entry.channel} ${JSON.stringify(record.entry.payload ?? {})}`)
    .join("\n");
}

function createSmokeRun(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSmokeRun(href) {
  if (typeof href !== "string" || href.length === 0) return "";
  try {
    return new URL(href).searchParams.get("smokeRun") ?? "";
  } catch {
    return "";
  }
}
