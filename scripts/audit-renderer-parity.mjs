import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import {
  analyzeCanvasPng,
  evaluateVisualBounds
} from "./benchmark-stock-acceptance.mjs";
import {
  buildAppUrl,
  isOk,
  waitForOk
} from "./ripple-smoke-harness.mjs";
import {
  compareRendererCaptures,
  createRendererParityStrip
} from "./render-parity-analysis.mjs";
import {
  GAMEPAD_BUTTON,
  advanceUntilVisualState,
  advanceWithGamepadInput,
  captureVisualState,
  connectMockGamepad,
  installDeterministicGamepad
} from "./gamepad-fixture-harness.mjs";
import { getRendererParityScenes } from "./renderer-parity-fixtures.mjs";

const FIXED_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const FIXED_DEVICE_SCALE_FACTOR = 1;
const BENCHMARK_SEED = 1_337;
const PULSE_PHASE_TICKS = Object.freeze({
  "pulse-early": readIntegerEnv("RIPPLE_PARITY_PULSE_EARLY_TICKS", 36, 12, 600),
  "pulse-middle": readIntegerEnv("RIPPLE_PARITY_PULSE_MIDDLE_TICKS", 225, 24, 600),
  "pulse-late": readIntegerEnv("RIPPLE_PARITY_PULSE_LATE_TICKS", 390, 36, 600),
  "pulse-expired": readIntegerEnv("RIPPLE_PARITY_PULSE_EXPIRED_TICKS", 480, 48, 600)
});
const PAGE_TIMEOUT_MS = readIntegerEnv("RIPPLE_PARITY_TIMEOUT_MS", 60_000, 15_000, 180_000);
const WEBGPU_PRESENTATION_PROFILE = readWebGpuPresentationProfile();
const PARITY_SUITE = readParitySuite();
const WEBGL_PRESENTATION_PROFILE = "webgl-reference";
const DEFAULT_AUDIT_APP_URL = "http://127.0.0.1:4184/";
const SCENES = getRendererParityScenes(PARITY_SUITE);

const appServer = await ensureAuditAppReady();
const config = {
  appUrl: appServer.appUrl,
  logServerQueryValue: "0"
};
const runId = `${WEBGPU_PRESENTATION_PROFILE}-${PARITY_SUITE}-${createRunId()}`;
const outputDirectory = path.resolve(
  process.env.RIPPLE_PARITY_OUTPUT_DIR || "parity-results",
  runId
);
const capturesDirectory = path.join(outputDirectory, "captures");
const comparisonsDirectory = path.join(outputDirectory, "comparisons");
let browser;
let auditResult = null;
let auditError = null;
let auditReport = null;

try {
  await mkdir(capturesDirectory, { recursive: true });
  await mkdir(comparisonsDirectory, { recursive: true });
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: FIXED_VIEWPORT,
    deviceScaleFactor: FIXED_DEVICE_SCALE_FACTOR
  });
  if (PARITY_SUITE === "closure") await installDeterministicGamepad(context);
  const captures = [];
  const buffers = new Map();

  for (const scene of SCENES) {
    for (const backendId of ["webgl", "webgpu"]) {
      const result = await captureScene(context, scene, backendId);
      captures.push(...result.captures);
      for (const [key, buffer] of result.buffers) buffers.set(key, buffer);
    }
  }

  const comparisons = [];
  for (const scene of SCENES) {
    for (const state of scene.states) {
      const pairId = `${scene.id}--${state}`;
      const webGlBuffer = requireBuffer(buffers, `${pairId}--webgl`);
      const webGpuBuffer = requireBuffer(buffers, `${pairId}--webgpu`);
      const stripPath = path.join(comparisonsDirectory, `${pairId}.png`);
      await writeFile(stripPath, createRendererParityStrip(webGlBuffer, webGpuBuffer));
      comparisons.push({
        id: pairId,
        sceneId: scene.id,
        mode: scene.mode,
        state,
        referenceProfile: WEBGL_PRESENTATION_PROFILE,
        candidateProfile: WEBGPU_PRESENTATION_PROFILE,
        reviewStrip: toPortableRelativePath(outputDirectory, stripPath),
        metrics: compareRendererCaptures(webGlBuffer, webGpuBuffer),
        stateParity: compareFixtureStates(
          requireCapture(captures, `${pairId}--webgl`).fixtureState,
          requireCapture(captures, `${pairId}--webgpu`).fixtureState
        ),
        disposition: "review-required"
      });
    }
  }

  const pulseLifecycle = createPulseLifecycleEvidence(captures, buffers);

  const stateFailures = comparisons.filter((comparison) => !comparison.stateParity.passed);
  const reportPassed = stateFailures.length === 0;
  const report = {
    schemaVersion: 4,
    passed: reportPassed,
    failureReasons: stateFailures.map((comparison) => `semantic-state-mismatch:${comparison.id}`),
    generatedAt: new Date().toISOString(),
    runId,
    fixtureSuite: PARITY_SUITE,
    source: readSourceState(appServer),
    viewport: FIXED_VIEWPORT,
    deviceScaleFactor: FIXED_DEVICE_SCALE_FACTOR,
    benchmarkSeed: BENCHMARK_SEED,
    captureTicks: Object.fromEntries(SCENES.map((scene) => [scene.id, scene.captureTick ?? null])),
    pulsePhaseTicks: PULSE_PHASE_TICKS,
    referenceProfile: WEBGL_PRESENTATION_PROFILE,
    candidateProfile: WEBGPU_PRESENTATION_PROFILE,
    automationDecision: reportPassed ? "review-required" : "failed",
    automationPolicy: "Runtime and visual-bound failures are fatal; renderer similarity metrics are evidence, not a pixel-parity gate.",
    captures,
    comparisons,
    pulseLifecycle
  };
  auditReport = report;
  await withAuditDeadline(context.close(), "browser context cleanup", 10_000);
  if (stateFailures.length > 0) {
    throw new Error(
      `Renderer fixture state diverged for ${stateFailures.map((item) => item.id).join(", ")}. ` +
      `Review ${path.join(outputDirectory, "report.json")}.`
    );
  }
  auditResult = { outputDirectory, sourceProvenance: report.source.provenance };
} catch (error) {
  auditError = error;
} finally {
  try {
    await withAuditDeadline(Promise.resolve(browser?.close()), "browser cleanup", 10_000);
  } catch (error) {
    auditError = combineAuditErrors(auditError, error, "browser cleanup failed");
  }
  try {
    await appServer.shutdown();
  } catch (error) {
    auditError = combineAuditErrors(auditError, error, "preview cleanup failed");
  }
}

if (auditReport) {
  if (auditError) {
    auditReport.passed = false;
    auditReport.automationDecision = "failed";
    auditReport.failureReasons = [...new Set([
      ...auditReport.failureReasons,
      "audit-lifecycle-failure"
    ])];
    auditReport.failure = formatError(auditError);
  }
  try {
    await writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(auditReport, null, 2)}\n`);
    await writeFile(path.join(outputDirectory, "summary.md"), renderSummary(auditReport));
  } catch (error) {
    auditError = combineAuditErrors(auditError, error, "audit report write failed");
  }
}

if (auditError) {
  console.error(`[ripple-field-lab:parity] ${formatError(auditError)}`);
  process.exitCode = 1;
} else {
  console.log(`[ripple-field-lab:parity] PASS - audit evidence written to ${auditResult.outputDirectory}`);
  if (auditResult.sourceProvenance === "external-unverified") {
    console.log("[ripple-field-lab:parity] External server provenance is unverified; the report does not attribute it to the workspace commit.");
  }
  console.log("[ripple-field-lab:parity] Visual disposition remains review-required; no pixel-parity claim was made.");
}

async function captureScene(context, scene, backendId) {
  if (scene.driver !== "pulse-lifecycle") {
    return captureClosureScene(context, scene, backendId);
  }

  const page = await context.newPage();
  const problems = collectPageProblems(page);
  const pageUrl = createSceneUrl(scene, backendId);
  const captures = [];
  const buffers = new Map();

  try {
    await page.addInitScript((seed) => {
      let randomState = seed >>> 0;
      Math.random = () => {
        randomState = (randomState + 0x6d2b79f5) >>> 0;
        let value = randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    }, BENCHMARK_SEED);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await waitForSceneReady(page, scene, backendId);
    await hideCaptureChrome(page);
    let fixtureState = await advanceAndFreeze(page, scene.captureTick);
    let pulseStartTick = null;
    let pulseStartSimulationTime = null;

    for (const state of scene.states) {
      if (Object.hasOwn(PULSE_PHASE_TICKS, state)) {
        if (pulseStartTick === null) {
          pulseStartTick = fixtureState.tick;
          pulseStartSimulationTime = fixtureState.simulationTimeSeconds;
          await triggerPulse(page);
        }
        fixtureState = await advanceAndFreeze(page, pulseStartTick + PULSE_PHASE_TICKS[state]);
        assertPulseLifecycleFixture(state, fixtureState, pulseStartSimulationTime);
      }

      const captured = await captureCurrentFixture(page, scene, state, backendId, fixtureState, []);
      captures.push(captured.metadata);
      buffers.set(captured.metadata.id, captured.buffer);
    }

    problems.assertNone(`${scene.id}/${backendId}`);
    return { captures, buffers };
  } finally {
    await withAuditDeadline(page.close(), `${scene.id}/${backendId} page cleanup`, 10_000);
  }
}

async function captureClosureScene(context, scene, backendId) {
  const page = await context.newPage();
  const problems = collectPageProblems(page);
  const captures = [];
  const buffers = new Map();
  const inputTranscript = [];

  const capture = async (state, fixtureState) => {
    assertClosureFixtureState(scene, state, fixtureState);
    const captured = await captureCurrentFixture(
      page,
      scene,
      state,
      backendId,
      fixtureState,
      inputTranscript
    );
    captures.push(captured.metadata);
    buffers.set(captured.metadata.id, captured.buffer);
  };

  try {
    await installGlobalRandomSeed(page);
    await page.goto(createSceneUrl(scene, backendId), {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS
    });
    await waitForSceneReady(page, scene, backendId);
    await hideCaptureChrome(page);
    await connectMockGamepad(page);
    inputTranscript.push("connect-standard-gamepad");
    await applyClosureSceneSettings(page, scene, backendId, inputTranscript);
    await runClosureFixture(page, scene, capture, inputTranscript);
    problems.assertNone(`${scene.id}/${backendId}`);
    return { captures, buffers };
  } finally {
    await withAuditDeadline(page.close(), `${scene.id}/${backendId} page cleanup`, 10_000);
  }
}

async function captureCurrentFixture(page, scene, state, backendId, fixtureState, inputTranscript) {
  const captureId = `${scene.id}--${state}--${backendId}`;
  const capturePath = path.join(capturesDirectory, `${captureId}.png`);
  const canvas = page.locator(`canvas[data-renderer-backend="${backendId}"]`);
  const buffer = await canvas.screenshot({ type: "png", path: capturePath });
  const visualMetrics = analyzeCanvasPng(buffer);
  const visualBounds = evaluateVisualBounds(visualMetrics);
  if (!visualBounds.passed) {
    throw new Error(`${captureId} failed visual bounds: ${visualBounds.reasons.join(", ")}`);
  }

  const repeatedFixtureState = await freezeCurrent(page);
  const repeatedBuffer = await canvas.screenshot({ type: "png" });
  const repeatability = compareRendererCaptures(buffer, repeatedBuffer);
  const repeatedStateParity = compareFixtureStates(fixtureState, repeatedFixtureState);
  const repeatabilityPassed = repeatedStateParity.passed &&
    repeatability.changedPixelRatio <= 0.001 &&
    repeatability.meanAbsoluteRgbDelta <= 0.5;
  if (!repeatabilityPassed) {
    throw new Error(
      `${captureId} was not stable while frozen: ` +
      `${JSON.stringify({ repeatability, repeatedStateParity })}`
    );
  }

  const diagnostics = await readRuntimeDiagnostics(page, backendId, scene.mode);
  return {
    buffer,
    metadata: {
      id: captureId,
      sceneId: scene.id,
      fixtureSuite: scene.suite,
      fixtureDriver: scene.driver,
      mode: scene.mode,
      state,
      backendId,
      presentationProfile: diagnostics.presentationProfile,
      inputTranscript: [...inputTranscript],
      path: toPortableRelativePath(outputDirectory, capturePath),
      visualBounds,
      visualMetrics,
      repeatability: {
        passed: repeatabilityPassed,
        metrics: repeatability
      },
      fixtureState,
      runtime: diagnostics
    }
  };
}

async function runClosureFixture(page, scene, capture, inputTranscript) {
  if (scene.driver === "clean-events") {
    await runCleanEventFixture(page, capture, inputTranscript);
    return;
  }
  if (scene.driver === "training-lifecycle") {
    await runTrainingLifecycleFixture(page, capture, inputTranscript);
    return;
  }
  if (scene.driver === "meltdown-grazing") {
    await runMeltdownGrazingFixture(page, capture, inputTranscript);
    return;
  }
  if (scene.driver === "skybox-views") {
    await runSkyboxFixture(page, scene, capture, inputTranscript);
    return;
  }
  if (scene.driver === "track-wake") {
    await runTrackWakeFixture(page, capture, inputTranscript);
    return;
  }
  throw new Error(`Unsupported closure fixture driver ${JSON.stringify(scene.driver)}.`);
}

async function runCleanEventFixture(page, capture, inputTranscript) {
  const initial = await advanceWithGamepadInput(page, {}, 1);
  const initialEchoes = initial.activeEchoes;
  const auditedEcho = getNearestEcho(initial);
  if (!auditedEcho) throw new Error("Clean Arena fixture has no initial Echo target.");
  const auditedEchoPosition = {
    x: auditedEcho.positionX,
    y: auditedEcho.positionY,
    z: auditedEcho.positionZ
  };
  await driveTowardTargetUntil(
    page,
    () => auditedEchoPosition,
    (snapshot) => getPlanarDistance(snapshot.player.position, auditedEchoPosition) <= 7.5,
    "Clean Echo approach",
    {
      maxTicks: 1_200,
      chunkTicks: 1,
      failWhen: (snapshot) => snapshot.activeEchoes < initialEchoes
    }
  );
  const nearby = await advanceUntilVisualState(
    page,
    { buttons: { [GAMEPAD_BUTTON.secondary]: 1 } },
    (snapshot) => snapshot.player.speed <= 0.2,
    "Clean pre-jump brake",
    { maxTicks: 180, chunkTicks: 1 }
  );
  if (nearby.activeEchoes !== initialEchoes || nearby.echoState.activeVisualBursts !== 0) {
    throw new Error("Clean pre-jump approach collected its Echo before the jump fixtures.");
  }
  inputTranscript.push(
    "camera-relative-steer-until-echo-distance<=7.5",
    "gamepad-B-until-speed<=0.2"
  );
  await capture("echo-nearby", nearby);

  const takeoff = await advanceWithGamepadInput(page, {
    buttons: { [GAMEPAD_BUTTON.primary]: 1 }
  }, 1);
  inputTranscript.push("gamepad-A-jump");
  await capture("jump-takeoff", takeoff);

  const airborne = await advanceUntilVisualState(
    page,
    {},
    (snapshot) => snapshot.player.groundContact <= 0.05,
    "Clean airborne state",
    { maxTicks: 90, chunkTicks: 2 }
  );
  inputTranscript.push("neutral-until-ground-contact<=0.05");
  await capture("jump-airborne", airborne);

  const landed = await advanceUntilVisualState(
    page,
    {},
    (snapshot) => snapshot.player.groundContact >= 0.999 && snapshot.player.position.y < airborne.player.position.y,
    "Clean landing state",
    { maxTicks: 180, chunkTicks: 2 }
  );
  inputTranscript.push("neutral-until-landed");
  await capture("jump-landed", landed);

  const collected = await driveTowardTargetUntil(
    page,
    () => auditedEchoPosition,
    (snapshot) => !snapshot.echoState.echoes.some((echo) => echo.id === auditedEcho.id) &&
      snapshot.echoState.activeVisualBursts > 0,
    "Clean Echo collection",
    { maxTicks: 1_200, chunkTicks: 2 }
  );
  inputTranscript.push("camera-relative-steer-until-echo-collected");
  await capture("echo-collected", collected);
}

async function runTrainingLifecycleFixture(page, capture, inputTranscript) {
  const initial = await advanceWithGamepadInput(page, {}, 1);
  inputTranscript.push("training-neutral-initial");
  await capture("initial", initial);

  await advanceUntilVisualState(
    page,
    { axes: [0, 0, 0.9, 0] },
    (snapshot) => snapshot.training?.stepId === "steer-facing",
    "Training camera orbit",
    { maxTicks: 120, chunkTicks: 8 }
  );
  const advanced = await advanceUntilVisualState(
    page,
    { axes: [0.9, 0, 0, 0] },
    (snapshot) => snapshot.training?.stepId === "keyboard-movement",
    "Training steer-facing",
    { maxTicks: 120, chunkTicks: 8 }
  );
  inputTranscript.push("right-stick-orbit", "left-stick-steer-facing");
  await capture("advanced", advanced);

  await completeTrainingMovementSet(page, inputTranscript);
  await advanceUntilVisualState(
    page,
    {
      axes: [0, -1, 0, 0],
      buttons: { [GAMEPAD_BUTTON.rightTrigger]: 1 }
    },
    (snapshot) => snapshot.training?.stepId === "mouse-forward",
    "Training boost",
    { maxTicks: 240, chunkTicks: 8 }
  );
  inputTranscript.push("left-stick-forward-plus-RT-until-boost-complete");
  await advanceUntilVisualState(
    page,
    { buttons: { [GAMEPAD_BUTTON.secondary]: 1 } },
    (snapshot) => snapshot.training?.stepId === "momentum-brake",
    "Training active brake",
    { maxTicks: 180, chunkTicks: 4 }
  );
  inputTranscript.push("gamepad-B-until-active-brake-complete");
  await advanceUntilVisualState(
    page,
    { axes: [0, -1, 0, 0] },
    (snapshot) => snapshot.player.speed >= 8,
    "Training momentum build",
    { maxTicks: 180, chunkTicks: 6 }
  );
  await advanceUntilVisualState(
    page,
    {},
    (snapshot) => snapshot.training?.stepId === "jump",
    "Training momentum release",
    { maxTicks: 60, chunkTicks: 1 }
  );
  inputTranscript.push("left-stick-forward-build-momentum", "neutral-release-momentum");
  await advanceUntilVisualState(
    page,
    { buttons: { [GAMEPAD_BUTTON.primary]: 1 } },
    (snapshot) => snapshot.training?.stepId === "echo-pickup",
    "Training jump",
    { maxTicks: 12, chunkTicks: 1 }
  );
  inputTranscript.push("gamepad-A-jump");
  await driveTowardTargetUntil(
    page,
    getNearestEchoPosition,
    (snapshot) => snapshot.training?.stepId === "wall-slide",
    "Training Echo pickup",
    { maxTicks: 1_800, chunkTicks: 2, followCourse: true }
  );
  inputTranscript.push("camera-relative-steer-until-training-echo-collected");
  const complete = await completeTrainingWallSlide(page);
  inputTranscript.push("camera-relative-steer-to-wall-marker");
  await capture("complete", complete);
}

async function completeTrainingMovementSet(page, inputTranscript) {
  const inputs = [
    { label: "left-bumper-strafe", value: { buttons: { [GAMEPAD_BUTTON.leftBumper]: 1 } } },
    { label: "left-stick-turn", value: { axes: [-0.9, 0, 0, 0] } },
    { label: "left-stick-forward", value: { axes: [0, -0.9, 0, 0] } },
    { label: "left-stick-reverse", value: { axes: [0, 0.9, 0, 0] } }
  ];
  let snapshot = await captureVisualState(page);
  for (const input of inputs) {
    if (snapshot.training?.stepId !== "keyboard-movement") break;
    snapshot = await advanceWithGamepadInput(page, input.value, 10);
    inputTranscript.push(input.label);
  }
  if (snapshot.training?.stepId !== "boost") {
    throw new Error(`Training movement set stopped at ${JSON.stringify(snapshot.training?.stepId)}.`);
  }
}

async function completeTrainingWallSlide(page) {
  return driveTowardTargetUntil(
    page,
    (snapshot) => snapshot.training?.markerPosition ?? null,
    (snapshot) => snapshot.training?.complete === true,
    "Training wall-slide",
    {
      maxTicks: 1_200,
      chunkTicks: 2,
      followCourse: true,
      pushBeyondCourseTarget: true
    }
  );
}

async function runMeltdownGrazingFixture(page, capture, inputTranscript) {
  await advanceWithGamepadInput(page, {}, 65);
  const grazing = await advanceWithGamepadInput(page, { axes: [0, 0, 0, -1] }, 22);
  inputTranscript.push("neutral-settle-65", "right-stick-down-grazing-camera-22");
  await capture("grazing", grazing);
}

async function runSkyboxFixture(page, scene, capture, inputTranscript) {
  await setSkybox(page, scene.skyboxId);
  inputTranscript.push(`select-skybox:${scene.skyboxId}`);
  let snapshot = await advanceWithGamepadInput(page, {}, 65);
  await capture("yaw-0", snapshot);

  for (const state of ["yaw-90", "yaw-180", "yaw-270"]) {
    snapshot = await rotateCameraByYaw(page, snapshot, Math.PI * 0.5, state);
    inputTranscript.push(`right-stick-quarter-turn:${state}`);
    await capture(state, snapshot);
  }

  snapshot = await advanceWithGamepadInput(page, { axes: [0, 0, 0, -1] }, 42);
  inputTranscript.push("right-stick-down-below-horizon-42");
  await capture("below-horizon", snapshot);
}

async function rotateCameraByYaw(page, initialSnapshot, targetRadians, label) {
  const toleranceRadians = 0.75 * Math.PI / 180;
  let snapshot = initialSnapshot;
  let previousYaw = getCameraOrbitYaw(snapshot);
  let traveledRadians = 0;

  for (let tick = 0; tick < 180; tick += 1) {
    const remainingRadians = targetRadians - traveledRadians;
    if (remainingRadians <= toleranceRadians) return snapshot;

    // Ease the final few controller ticks so each fixture lands on a measured
    // quarter-turn instead of assuming camera smoothing maps to a fixed count.
    const lookMagnitude = Math.min(1, Math.max(0.24, remainingRadians / 0.04));
    snapshot = await advanceWithGamepadInput(
      page,
      { axes: [0, 0, -lookMagnitude, 0] },
      1
    );
    const currentYaw = getCameraOrbitYaw(snapshot);
    traveledRadians += Math.max(0, shortestAngleDelta(previousYaw, currentYaw));
    previousYaw = currentYaw;
  }

  throw new Error(
    `${label} camera turn reached ${(traveledRadians * 180 / Math.PI).toFixed(2)} degrees; expected 90.`
  );
}

function getCameraOrbitYaw(snapshot) {
  return Math.atan2(
    snapshot.camera.position.x - snapshot.player.position.x,
    snapshot.camera.position.z - snapshot.player.position.z
  );
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

async function runTrackWakeFixture(page, capture, inputTranscript) {
  const boost = await advanceUntilVisualState(
    page,
    {
      axes: [0, -1, 0, 0],
      buttons: { [GAMEPAD_BUTTON.rightTrigger]: 1 }
    },
    (snapshot) => snapshot.player.speed >= 20,
    "Track boost state",
    { maxTicks: 360, chunkTicks: 4 }
  );
  inputTranscript.push("left-stick-forward-plus-RT-until-speed>=20");
  await capture("boost", boost);

  const coast = await advanceUntilVisualState(
    page,
    {},
    (snapshot) => snapshot.player.speed <= 8 && snapshot.player.speed >= 2,
    "Track coast state",
    { maxTicks: 180, chunkTicks: 2 }
  );
  inputTranscript.push("neutral-until-speed-between-2-and-8");
  await capture("coast", coast);

  const stop = await advanceUntilVisualState(
    page,
    {},
    (snapshot) => snapshot.player.speed <= 0.35,
    "Track stop state",
    { maxTicks: 360, chunkTicks: 4 }
  );
  inputTranscript.push("neutral-until-speed<=0.35");
  await capture("stop", stop);

  const settled = await advanceWithGamepadInput(page, {}, 240);
  inputTranscript.push("neutral-wake-settle-240");
  await capture("settled", settled);
}

async function applyClosureSceneSettings(page, scene, backendId, inputTranscript) {
  if (scene.qualityId) {
    await setControlValue(page, "#quality-select", scene.qualityId, "change");
    inputTranscript.push(`quality:${scene.qualityId}`);
  }
  if (typeof scene.voxelSizeMeters === "number") {
    await setControlValue(page, "#arena-radius-slider", 400, "input");
    await setControlValue(page, "#voxel-size-slider", scene.voxelSizeMeters, "input");
    inputTranscript.push("arena-radius:400", `voxel-size:${scene.voxelSizeMeters}`);
  }

  await page.waitForTimeout(typeof scene.voxelSizeMeters === "number" ? 1_200 : 350);
  await page.waitForFunction(({ expectedBackendId, qualityId }) => {
    const entries = window.__rippleDebugDump?.() ?? [];
    return entries.some((entry) =>
      entry.channel === "renderer.frameSample" &&
      entry.payload?.backendId === expectedBackendId &&
      entry.payload?.quality === qualityId
    ) || document.querySelector("#quality-select")?.value === qualityId;
  }, { expectedBackendId: backendId, qualityId: scene.qualityId }, { timeout: 15_000 });
}

async function setControlValue(page, selector, value, eventType) {
  await page.evaluate(({ controlSelector, nextValue, type }) => {
    const control = document.querySelector(controlSelector);
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
      throw new Error(`Missing parity fixture control ${controlSelector}.`);
    }
    control.value = String(nextValue);
    control.dispatchEvent(new Event(type, { bubbles: true }));
  }, { controlSelector: selector, nextValue: value, type: eventType });
}

async function setSkybox(page, skyboxId) {
  await setControlValue(page, "#skybox-select", skyboxId, "change");
  await page.waitForFunction((expectedSkybox) => {
    const entries = window.__rippleDebugDump?.() ?? [];
    return entries.some((entry) =>
      (entry.channel === "skybox.load" || entry.channel === "skybox.webgpu.load") &&
      entry.payload?.skybox === expectedSkybox
    );
  }, skyboxId, { timeout: PAGE_TIMEOUT_MS });
}

async function driveTowardTargetUntil(page, selectTarget, predicate, label, options = {}) {
  const maxTicks = options.maxTicks ?? 1_200;
  const chunkTicks = options.chunkTicks ?? 2;
  let advancedTicks = 0;
  let snapshot = await captureVisualState(page);

  while (advancedTicks < maxTicks) {
    if (predicate(snapshot)) return snapshot;
    if (options.failWhen?.(snapshot)) {
      throw new Error(`${label} entered a forbidden state before reaching its target.`);
    }
    const target = selectTarget(snapshot);
    if (!target) {
      throw new Error(`${label} has no renderer-neutral target position.`);
    }
    const movementTarget = options.followCourse
      ? selectCourseNavigationTarget(snapshot, target, options.pushBeyondCourseTarget === true)
      : target;
    const axes = createCameraRelativeMovementAxes(snapshot, movementTarget);
    const ticks = Math.min(chunkTicks, maxTicks - advancedTicks);
    snapshot = await advanceWithGamepadInput(page, { axes }, ticks);
    advancedTicks += ticks;
  }

  throw new Error(
    `${label} did not satisfy its contract within ${maxTicks} ticks: ` +
    JSON.stringify({
      tick: snapshot.tick,
      player: snapshot.player,
      training: snapshot.training,
      activeEchoes: snapshot.activeEchoes,
      nearestEchoDistance: getNearestEchoDistance(snapshot)
    })
  );
}

function selectCourseNavigationTarget(snapshot, finalTarget, pushBeyondTarget = false) {
  const samples = snapshot.course?.centerlineSamples ?? [];
  if (samples.length < 3) return finalTarget;

  const player = snapshot.player.position;
  const playerSampleIndex = findNearestCourseSampleIndex(samples, player);
  const targetSampleIndex = findNearestCourseSampleIndex(samples, finalTarget);
  const forwardDistance = positiveModulo(targetSampleIndex - playerSampleIndex, samples.length);
  const backwardDistance = positiveModulo(playerSampleIndex - targetSampleIndex, samples.length);
  const direction = forwardDistance <= backwardDistance ? 1 : -1;
  const remainingSegments = Math.min(forwardDistance, backwardDistance);

  // Aim several segments ahead so analog steering follows the ribbon smoothly.
  // Once the target is nearby, steering directly lets collection and wall-slide
  // triggers use their real collision radii instead of stopping at centerline.
  if (remainingSegments <= 4) {
    return pushBeyondTarget
      ? extendCourseTargetPastWall(samples, targetSampleIndex, finalTarget)
      : finalTarget;
  }
  const lookAheadSegments = Math.min(6, remainingSegments);
  const waypointIndex = positiveModulo(
    playerSampleIndex + direction * lookAheadSegments,
    samples.length
  );
  return samples[waypointIndex];
}

function extendCourseTargetPastWall(samples, targetSampleIndex, finalTarget) {
  const centerline = samples[targetSampleIndex];
  const outwardX = finalTarget.x - centerline.x;
  const outwardZ = finalTarget.z - centerline.z;
  const outwardLength = Math.hypot(outwardX, outwardZ);
  if (outwardLength <= 0.0001) return finalTarget;

  // Training places its last gate on the outside edge. Steering beyond that
  // gate makes the real play-area constraint register wall contact instead of
  // allowing the fixture to hover politely at the marker forever.
  const pushDistance = 8;
  return {
    x: finalTarget.x + (outwardX / outwardLength) * pushDistance,
    y: finalTarget.y,
    z: finalTarget.z + (outwardZ / outwardLength) * pushDistance
  };
}

function findNearestCourseSampleIndex(samples, position) {
  let nearestIndex = 0;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const deltaX = samples[index].x - position.x;
    const deltaZ = samples[index].z - position.z;
    const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
    if (distanceSquared >= nearestDistanceSquared) continue;
    nearestDistanceSquared = distanceSquared;
    nearestIndex = index;
  }
  return nearestIndex;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function createCameraRelativeMovementAxes(snapshot, target) {
  const player = snapshot.player.position;
  const camera = snapshot.camera.position;
  const desiredX = target.x - player.x;
  const desiredZ = target.z - player.z;
  const desiredLength = Math.hypot(desiredX, desiredZ);
  if (desiredLength <= 0.0001) return [0, 0, 0, 0];

  const cameraForwardX = player.x - camera.x;
  const cameraForwardZ = player.z - camera.z;
  const cameraForwardLength = Math.max(0.0001, Math.hypot(cameraForwardX, cameraForwardZ));
  const forwardX = cameraForwardX / cameraForwardLength;
  const forwardZ = cameraForwardZ / cameraForwardLength;
  const directionX = desiredX / desiredLength;
  const directionZ = desiredZ / desiredLength;
  const forwardAmount = directionX * forwardX + directionZ * forwardZ;
  const rightAmount = directionX * -forwardZ + directionZ * forwardX;
  return [rightAmount, -forwardAmount, 0, 0];
}

function getNearestEchoPosition(snapshot) {
  const echo = getNearestEcho(snapshot);
  return echo
    ? { x: echo.positionX, y: echo.positionY, z: echo.positionZ }
    : null;
}

function getNearestEcho(snapshot) {
  const echoes = snapshot.echoState?.echoes ?? [];
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const echo of echoes) {
    const distance = Math.hypot(
      echo.positionX - snapshot.player.position.x,
      echo.positionY - snapshot.player.position.y,
      echo.positionZ - snapshot.player.position.z
    );
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = echo;
  }
  return nearest;
}

function getNearestEchoDistance(snapshot) {
  const echoes = snapshot.echoState?.echoes ?? [];
  let nearest = Number.POSITIVE_INFINITY;
  for (const echo of echoes) {
    nearest = Math.min(nearest, Math.hypot(
      echo.positionX - snapshot.player.position.x,
      echo.positionY - snapshot.player.position.y,
      echo.positionZ - snapshot.player.position.z
    ));
  }
  return nearest;
}

function getPlanarDistance(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function assertClosureFixtureState(scene, state, snapshot) {
  if (snapshot.playMode !== scene.mode) {
    throw new Error(`${scene.id}/${state} reported playMode=${JSON.stringify(snapshot.playMode)}.`);
  }
  if (scene.qualityId && snapshot.qualityId !== scene.qualityId) {
    throw new Error(`${scene.id}/${state} reported qualityId=${JSON.stringify(snapshot.qualityId)}.`);
  }
  if (scene.skyboxId && snapshot.skyboxId !== scene.skyboxId) {
    throw new Error(`${scene.id}/${state} reported skyboxId=${JSON.stringify(snapshot.skyboxId)}.`);
  }
  if (state === "jump-airborne" && snapshot.player.groundContact > 0.05) {
    throw new Error(`${scene.id}/${state} was not airborne.`);
  }
  if (state === "jump-landed" && snapshot.player.groundContact < 0.999) {
    throw new Error(`${scene.id}/${state} was not grounded.`);
  }
  if (["echo-nearby", "jump-takeoff", "jump-airborne", "jump-landed"].includes(state) &&
    snapshot.echoState.activeVisualBursts !== 0) {
    throw new Error(`${scene.id}/${state} collected its Echo too early.`);
  }
  if (state === "echo-collected" && snapshot.echoState.activeVisualBursts <= 0) {
    throw new Error(`${scene.id}/${state} did not retain an Echo collection burst.`);
  }
  if (state === "complete" && (!snapshot.training?.complete || snapshot.training?.markerVisible)) {
    throw new Error(`${scene.id}/${state} did not report completed Training with a hidden marker.`);
  }
}

async function installGlobalRandomSeed(page) {
  await page.addInitScript((seed) => {
    let randomState = seed >>> 0;
    Math.random = () => {
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, BENCHMARK_SEED);
}

function createSceneUrl(scene, backendId) {
  const usesBenchmarkMotion = scene.driver === "pulse-lifecycle";
  return buildAppUrl(config, {
    // Keep local diagnostics retained in-page while disabling network posts.
    debug: "1",
    logServer: "0",
    renderer: backendId,
    presentation: backendId === "webgpu" ? WEBGPU_PRESENTATION_PROFILE : undefined,
    mode: scene.mode,
    benchmark: usesBenchmarkMotion ? "1" : undefined,
    benchmarkScenario: usesBenchmarkMotion ? scene.benchmarkScenario : undefined,
    benchmarkTier: usesBenchmarkMotion ? scene.benchmarkTier : undefined,
    benchmarkSeed: usesBenchmarkMotion ? BENCHMARK_SEED : undefined,
    stress: "1",
    visualCapture: "1",
    visualCaptureSeed: BENCHMARK_SEED,
    parityAudit: runId
  });
}

async function waitForSceneReady(page, scene, backendId) {
  await page.waitForFunction(({ expectedBackendId, expectedMode, benchmarkRequired }) => {
    const benchmarkReady = !benchmarkRequired || window.__rippleBenchmark?.version === 1;
    const visualCaptureReady = window.__rippleVisualCapture?.version === 1;
    const canvas = document.querySelector(`canvas[data-renderer-backend="${expectedBackendId}"]`);
    const entries = window.__rippleDebugDump?.() ?? [];
    const rendererReady = entries.some((entry) =>
      entry.channel === "renderer.mode" &&
      entry.payload?.activeBackend === expectedBackendId &&
      entry.payload?.playMode === expectedMode
    );
    const skyboxReady = entries.some((entry) =>
      entry.channel === (expectedBackendId === "webgpu" ? "skybox.webgpu.load" : "skybox.load")
    );
    return benchmarkReady && visualCaptureReady && canvas instanceof HTMLCanvasElement && rendererReady && skyboxReady;
  }, {
    expectedBackendId: backendId,
    expectedMode: scene.mode,
    benchmarkRequired: scene.driver === "pulse-lifecycle"
  }, { timeout: PAGE_TIMEOUT_MS });
}

async function hideCaptureChrome(page) {
  await page.addStyleTag({
    content: `
      #hud,
      #menu-toggle,
      #perf-overlay,
      #mobile-controls,
      #training-hud,
      #main-menu,
      #scene-menu-backdrop,
      #changelog-backdrop { visibility: hidden !important; }
      canvas { cursor: none !important; }
    `
  });
}

async function advanceAndFreeze(page, targetTick) {
  return withAuditDeadline(page.evaluate(async (target) => {
    const capture = window.__rippleVisualCapture;
    if (!capture) throw new Error("Visual capture API is unavailable.");
    await capture.ready();
    await capture.advanceToTick(target);
    return capture.freezeAndDescribe();
  }, targetTick), `advance and freeze at tick ${targetTick}`);
}

async function freezeCurrent(page) {
  return withAuditDeadline(page.evaluate(async () => {
    const capture = window.__rippleVisualCapture;
    if (!capture) throw new Error("Visual capture API is unavailable.");
    return capture.freezeAndDescribe();
  }), "repeat frozen capture");
}

async function triggerPulse(page) {
  await page.evaluate(() => {
    const button = document.querySelector("#pulse-button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Pulse button is unavailable.");
    button.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1
    }));
  });
}

function assertPulseLifecycleFixture(state, fixtureState, pulseStartSimulationTime) {
  if (typeof pulseStartSimulationTime !== "number") {
    throw new Error(`${state} capture is missing its pulse start time.`);
  }
  const sources = fixtureState.sourceState?.sources;
  if (!Array.isArray(sources)) {
    throw new Error(`${state} capture did not expose source lifecycle diagnostics.`);
  }

  const manualPulse = sources.find((source) =>
    typeof source?.startTime === "number" &&
    Math.abs(source.startTime - pulseStartSimulationTime) <= 0.001
  );
  const shouldRemainActive = state !== "pulse-expired";
  if (shouldRemainActive && !manualPulse) {
    throw new Error(`${state} pruned the audited manual pulse before its lifetime ended.`);
  }
  if (!shouldRemainActive && manualPulse) {
    throw new Error(`${state} retained the audited manual pulse after its lifetime ended.`);
  }

  if (manualPulse) {
    const ageSeconds = fixtureState.simulationTimeSeconds - manualPulse.startTime;
    const expectedAgeSeconds = PULSE_PHASE_TICKS[state] / 60;
    if (Math.abs(ageSeconds - expectedAgeSeconds) > 0.02) {
      throw new Error(
        `${state} source age was ${ageSeconds.toFixed(3)}s; expected ${expectedAgeSeconds.toFixed(3)}s.`
      );
    }
    if (ageSeconds >= manualPulse.lifetimeSeconds) {
      throw new Error(`${state} retained a source whose lifetime had already elapsed.`);
    }
  }
}

async function readRuntimeDiagnostics(page, backendId, mode) {
  const evidence = await page.evaluate(() => ({
    entries: window.__rippleDebugDump?.() ?? [],
    benchmark: window.__rippleBenchmark?.getSnapshot() ?? null
  }));
  const errors = evidence.entries.filter((entry) => entry.level === "error");
  if (errors.length > 0) {
    throw new Error(`${backendId}/${mode} emitted diagnostic errors: ${JSON.stringify(errors.slice(0, 4))}`);
  }
  if (evidence.entries.some((entry) => entry.channel === "webgpu.uncapturedError")) {
    throw new Error(`${backendId}/${mode} emitted webgpu.uncapturedError.`);
  }

  const frameSample = [...evidence.entries].reverse().find((entry) =>
    entry.channel === "renderer.frameSample" &&
    entry.payload?.backendId === backendId &&
    entry.payload?.playMode === mode
  );
  if (!frameSample) throw new Error(`${backendId}/${mode} did not emit renderer.frameSample.`);
  if (frameSample.payload?.deviceLost === true) throw new Error(`${backendId}/${mode} reported device loss.`);

  const expectedProfile = backendId === "webgpu"
    ? WEBGPU_PRESENTATION_PROFILE
    : WEBGL_PRESENTATION_PROFILE;
  if (frameSample.payload?.presentationProfile !== expectedProfile) {
    throw new Error(
      `${backendId}/${mode} reported presentationProfile=${JSON.stringify(frameSample.payload?.presentationProfile)}; ` +
      `expected ${JSON.stringify(expectedProfile)}.`
    );
  }
  if (backendId === "webgpu") assertWebGpuPresentationGeometry(frameSample.payload);

  return {
    presentationProfile: frameSample.payload.presentationProfile,
    waveDynamicsMode: frameSample.payload.waveDynamicsMode ?? null,
    fieldGeometryMode: frameSample.payload.fieldGeometryMode ?? null,
    fieldVerticesPerInstance: frameSample.payload.fieldVerticesPerInstance ?? null,
    fieldTrianglesPerInstance: frameSample.payload.fieldTrianglesPerInstance ?? null,
    visibleSideFaceCount: frameSample.payload.visibleSideFaceCount ?? null,
    bottomFaceIncluded: frameSample.payload.bottomFaceIncluded ?? null,
    tileHeightMode: frameSample.payload.tileHeightMode ?? null,
    quality: frameSample.payload.quality ?? evidence.benchmark?.samples?.at(-1)?.semantic?.qualityId ?? "unknown",
    drawCalls: frameSample.payload.drawCalls ?? null,
    triangles: frameSample.payload.triangles ?? null,
    fieldInstances: frameSample.payload.fieldInstanceCount ??
      evidence.benchmark?.samples?.at(-1)?.semantic?.fieldInstances ?? null,
    activeParticles: frameSample.payload.activeParticles ??
      evidence.benchmark?.samples?.at(-1)?.semantic?.activeParticles ?? null,
    activeEchoes: frameSample.payload.activeEchoes ??
      evidence.benchmark?.samples?.at(-1)?.semantic?.activeEchoes ?? null,
    bloomEnabled: frameSample.payload.bloomEnabled ??
      evidence.benchmark?.samples?.at(-1)?.semantic?.bloomEnabled ?? null,
    shadowMode: frameSample.payload.shadowMode ??
      evidence.benchmark?.samples?.at(-1)?.semantic?.shadowMode ?? "unknown",
    deviceLost: frameSample.payload.deviceLost ?? false
  };
}

function collectPageProblems(page) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.stack || error.message}`));
  page.on("crash", () => problems.push("crash: renderer process crashed"));
  return {
    assertNone(label) {
      if (problems.length > 0) {
        throw new Error(`${label} emitted browser problems:\n${problems.join("\n")}`);
      }
    }
  };
}

async function launchBrowser() {
  const options = {
    headless: process.env.RIPPLE_BROWSER_HEADLESS !== "0",
    args: [
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding"
    ]
  };
  if (process.env.RIPPLE_CHROME_CHANNEL) options.channel = process.env.RIPPLE_CHROME_CHANNEL;
  else if (process.platform === "win32") options.channel = "chrome";
  return chromium.launch(options);
}

async function ensureAuditAppReady() {
  const configuredUrl = process.env.RIPPLE_PARITY_APP_URL;
  if (configuredUrl) {
    const appUrl = new URL(configuredUrl).toString();
    await waitForOk(appUrl, "configured renderer parity app");
    return { appUrl, owned: false, shutdown: async () => {} };
  }

  if (await isOk(DEFAULT_AUDIT_APP_URL)) {
    throw new Error(
      `Strict renderer parity preview port is already occupied at ${DEFAULT_AUDIT_APP_URL}. ` +
      "Stop that listener or set RIPPLE_PARITY_APP_URL explicitly."
    );
  }

  const viteCli = path.resolve("node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [
    viteCli,
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4184",
    "--strictPort"
  ], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => writePreviewOutput(chunk));
  child.stderr.on("data", (chunk) => writePreviewOutput(chunk));

  try {
    await waitForOk(DEFAULT_AUDIT_APP_URL, "strict renderer parity preview");
  } catch (error) {
    if (child.pid) killProcessTree(child.pid);
    await waitForTcpPortRelease(DEFAULT_AUDIT_APP_URL);
    throw error;
  }

  return {
    appUrl: DEFAULT_AUDIT_APP_URL,
    owned: true,
    shutdown: async () => {
      if (child.pid) killProcessTree(child.pid);
      await waitForTcpPortRelease(DEFAULT_AUDIT_APP_URL);
    }
  };
}

function writePreviewOutput(chunk) {
  for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
    console.log(`[ripple-field-lab:parity:preview] ${line}`);
  }
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The preview may already have stopped after a failed audit.
  }
}

async function waitForTcpPortRelease(urlValue, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isTcpPortOpen(urlValue)) return;
    await delay(100);
  }
  throw new Error(`Owned renderer parity preview did not release ${new URL(urlValue).host}.`);
}

function isTcpPortOpen(urlValue) {
  const url = new URL(urlValue);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function renderSummary(report) {
  const lines = [
    "# Renderer Parity Audit",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Workspace source: \`${report.source.workspace.commit}\`${report.source.workspace.dirty ? " (dirty)" : " (clean)"}`,
    `- Served app: \`${report.source.servedAppUrl}\` (${report.source.provenance})`,
    `- Audit status: **${report.passed ? "passed" : "failed"}**`,
    `- Reference: \`${report.referenceProfile}\``,
    `- Candidate: \`${report.candidateProfile}\``,
    `- Automated disposition: **${report.automationDecision}**`,
    "",
    "The command fails on blank/unsafe captures, browser errors, diagnostic errors, fallback, or device loss. " +
      "Similarity numbers are review evidence only; independent WebGL and WebGPU rasterization is not expected to be pixel-identical.",
    "",
    "## Capture Pairs",
    "",
    "| Scene | State | RGB delta | Changed pixels | Luma histogram overlap | Coarse luma correlation | Edge delta | Review strip |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const comparison of report.comparisons) {
    const metrics = comparison.metrics;
    lines.push(
      `| ${comparison.id} | ${comparison.stateParity.passed ? "match" : "**mismatch**"} | ` +
      `${metrics.meanAbsoluteRgbDelta} | ${formatPercent(metrics.changedPixelRatio)} | ` +
      `${metrics.lumaHistogramIntersection} | ${metrics.coarseLumaCorrelation} | ${metrics.edgeDensityDelta} | ` +
      `[WebGL / WebGPU / diff](${comparison.reviewStrip.replaceAll("\\", "/")}) |`
    );
  }

  lines.push(
    "",
    "## Pulse Lifecycle",
    "",
    "Each row follows one pulse from early response through expiry. Deltas are evidence for held middle phases or abrupt end-phase cliffs; they remain review-guided rather than universal pixel gates.",
    "",
    "| Scene / backend | Phase | Source age | Active sources | RGB delta vs settled | RGB delta vs previous phase | Edge delta vs settled |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const phase of report.pulseLifecycle) {
    lines.push(
      `| ${phase.sceneId} / ${phase.backendId} | ${phase.state} | ${phase.sourceAgeSeconds}s | ` +
      `${phase.activeSources} | ${phase.fromSettled.meanAbsoluteRgbDelta} | ` +
      `${phase.fromPrevious.meanAbsoluteRgbDelta} | ${phase.fromSettled.edgeDensityDelta} |`
    );
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    `- The left image in each review strip is WebGL, the center is the ${WEBGPU_PRESENTATION_PROFILE === "classic" ? "Classic 3D" : "Core (Minimal)"} WebGPU profile, and the right is an amplified absolute difference.`,
    "- Histogram overlap and coarse luma correlation help distinguish broad composition drift from expected shader-level differences.",
    "- No metric in this report automatically declares artistic parity. Update the tracked parity matrix after visual review.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function createPulseLifecycleEvidence(captures, buffers) {
  const evidence = [];
  for (const scene of SCENES) {
    const pulseStates = scene.states.filter((state) => Object.hasOwn(PULSE_PHASE_TICKS, state));
    if (pulseStates.length === 0) continue;

    for (const backendId of ["webgl", "webgpu"]) {
      const settledId = `${scene.id}--settled--${backendId}`;
      const settledBuffer = requireBuffer(buffers, settledId);
      let previousBuffer = settledBuffer;
      for (const state of pulseStates) {
        const captureId = `${scene.id}--${state}--${backendId}`;
        const capture = requireCapture(captures, captureId);
        const buffer = requireBuffer(buffers, captureId);
        evidence.push({
          sceneId: scene.id,
          backendId,
          state,
          sourceAgeSeconds: roundNumber(PULSE_PHASE_TICKS[state] / 60, 3),
          activeSources: capture.fixtureState.activeSources,
          renderedSources: capture.fixtureState.sourceState?.renderedCount ?? null,
          fromSettled: compareRendererCaptures(settledBuffer, buffer),
          fromPrevious: compareRendererCaptures(previousBuffer, buffer)
        });
        previousBuffer = buffer;
      }
    }
  }
  return evidence;
}

function compareFixtureStates(reference, candidate) {
  const differences = [];
  const exactPaths = [
    "playMode",
    "tick",
    "qualityId",
    "skyboxId",
    "bloomEnabled",
    "fieldPalette",
    "fieldInstances",
    "activeSources",
    "activeEchoes",
    "activeParticles",
    "sourceState.activeCount",
    "sourceState.renderedCount",
    "sourceState.digest",
    "echoState.activeEchoes",
    "echoState.activeVisualBursts",
    "echoState.digest",
    "particleState.activeParticles",
    "particleState.particleBudget",
    "particleState.streamName",
    "particleState.randomBaseSeed",
    "particleState.randomSeedMode",
    "particleState.dynamicPrecisionDecimals",
    "particleState.dynamicDigest",
    "particleState.staticDigest",
    "field.mode",
    "field.fullHexCount",
    "field.culledHexCount",
    "field.instanceCount",
    "course.enabled",
    "course.maskWidth",
    "course.maskHeight",
    "course.maskDigest",
    "course.wallSegmentCount",
    "course.wallBaseY",
    "course.wallHeight",
    "course.wallDigest",
    "training.active",
    "training.complete",
    "training.stepId",
    "training.stepIndex",
    "training.markerVisible",
    "training.markerDigest",
    "viewport.width",
    "viewport.height",
    "viewport.pixelRatio"
  ];
  const numericPaths = [
    "simulationTimeSeconds",
    "particleState.elapsedSeconds",
    "player.position.x",
    "player.position.y",
    "player.position.z",
    "player.velocity.x",
    "player.velocity.y",
    "player.velocity.z",
    "player.speed",
    "player.groundContact",
    "player.facingYawRadians",
    "camera.position.x",
    "camera.position.y",
    "camera.position.z",
    "camera.quaternion.x",
    "camera.quaternion.y",
    "camera.quaternion.z",
    "camera.quaternion.w"
  ];

  for (const valuePath of exactPaths) {
    const referenceValue = readPath(reference, valuePath);
    const candidateValue = readPath(candidate, valuePath);
    const invalidNumericValue = (typeof referenceValue === "number" && !Number.isFinite(referenceValue)) ||
      (typeof candidateValue === "number" && !Number.isFinite(candidateValue));
    if (invalidNumericValue || !Object.is(referenceValue, candidateValue)) {
      differences.push({ path: valuePath, reference: referenceValue, candidate: candidateValue });
    }
  }
  for (const valuePath of numericPaths) {
    compareNumericValue(differences, valuePath, readPath(reference, valuePath), readPath(candidate, valuePath), 0.0001);
  }
  if (reference.training || candidate.training) {
    for (const valuePath of [
      "training.markerPosition.x",
      "training.markerPosition.y",
      "training.markerPosition.z",
      "training.markerFacingYawRadians"
    ]) {
      compareNumericValue(differences, valuePath, readPath(reference, valuePath), readPath(candidate, valuePath), 0.0001);
    }
  }
  const referenceMatrix = reference.camera?.viewProjectionMatrix ?? [];
  const candidateMatrix = candidate.camera?.viewProjectionMatrix ?? [];
  if (referenceMatrix.length !== candidateMatrix.length) {
    differences.push({ path: "camera.viewProjectionMatrix.length", reference: referenceMatrix.length, candidate: candidateMatrix.length });
  } else {
    for (let index = 0; index < referenceMatrix.length; index += 1) {
      compareNumericValue(
        differences,
        `camera.viewProjectionMatrix[${index}]`,
        referenceMatrix[index],
        candidateMatrix[index],
        0.0001
      );
    }
  }
  return {
    passed: differences.length === 0,
    differences,
    visualStateObservations: {
      referenceResolvedFieldPalette: reference.resolvedFieldPalette,
      candidateResolvedFieldPalette: candidate.resolvedFieldPalette,
      referenceActiveParticles: reference.activeParticles,
      candidateActiveParticles: candidate.activeParticles,
      activeParticleDelta: (candidate.activeParticles ?? 0) - (reference.activeParticles ?? 0)
    }
  };
}

function compareNumericValue(differences, valuePath, reference, candidate, tolerance) {
  if (typeof reference !== "number" || typeof candidate !== "number" ||
    !Number.isFinite(reference) || !Number.isFinite(candidate) ||
    Math.abs(reference - candidate) > tolerance) {
    differences.push({ path: valuePath, reference, candidate, tolerance });
  }
}

function readPath(value, valuePath) {
  return valuePath.split(".").reduce((current, key) => current?.[key], value);
}

function readSourceState(appServer) {
  return {
    provenance: appServer.owned ? "owned-current-build" : "external-unverified",
    servedAppUrl: appServer.appUrl,
    workspace: {
      commit: runGit(["rev-parse", "HEAD"]),
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: runGit(["status", "--porcelain"]).length > 0
    }
  };
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}

function requireBuffer(buffers, key) {
  const buffer = buffers.get(key);
  if (!buffer) throw new Error(`Missing renderer capture buffer ${key}.`);
  return buffer;
}

function requireCapture(captures, id) {
  const capture = captures.find((item) => item.id === id);
  if (!capture) throw new Error(`Missing renderer capture metadata ${id}.`);
  return capture;
}

function toPortableRelativePath(root, value) {
  return path.relative(root, value).replaceAll("\\", "/");
}

function createRunId() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function readWebGpuPresentationProfile() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--presentation="));
  const value = argument?.slice("--presentation=".length) ||
    process.env.RIPPLE_PARITY_WEBGPU_PROFILE ||
    "classic";
  if (value !== "classic" && value !== "core") {
    throw new Error(`Unsupported WebGPU parity presentation profile ${JSON.stringify(value)}; expected classic or core.`);
  }
  return value;
}

function readParitySuite() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--suite="));
  const value = argument?.slice("--suite=".length) ||
    process.env.RIPPLE_PARITY_SUITE ||
    "baseline";
  if (value !== "baseline" && value !== "closure") {
    throw new Error(`Unsupported renderer parity suite ${JSON.stringify(value)}; expected baseline or closure.`);
  }
  return value;
}

function assertWebGpuPresentationGeometry(payload) {
  const classic = WEBGPU_PRESENTATION_PROFILE === "classic";
  const expected = classic
    ? {
        fieldGeometryMode: "hex-prism",
        fieldVerticesPerInstance: 72,
        fieldTrianglesPerInstance: 24,
        visibleSideFaceCount: 6,
        bottomFaceIncluded: true,
        tileHeightMode: "animated-prism",
        waveDynamicsMode: "classic-parity"
      }
    : {
        fieldGeometryMode: "hex-cap",
        fieldVerticesPerInstance: 18,
        fieldTrianglesPerInstance: 6,
        visibleSideFaceCount: 0,
        bottomFaceIncluded: false,
        tileHeightMode: "flat-cap",
        waveDynamicsMode: "classic-parity"
      };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (payload?.[key] !== expectedValue) {
      throw new Error(
        `WebGPU ${WEBGPU_PRESENTATION_PROFILE} parity capture reported ${key}=${JSON.stringify(payload?.[key])}; ` +
        `expected ${JSON.stringify(expectedValue)}.`
      );
    }
  }
}

function readIntegerEnv(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? `${fallback}`, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function withAuditDeadline(promise, label, timeoutMs = PAGE_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function combineAuditErrors(existing, next, label) {
  const labeled = new Error(`${label}: ${formatError(next)}`);
  return existing ? new AggregateError([existing, labeled], "Renderer parity audit and cleanup both failed.") : labeled;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function roundNumber(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatError(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}
