import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  buildAppUrl,
  createHarnessConfig,
  delay,
  ensureServersReady,
  fetchJson
} from "./ripple-smoke-harness.mjs";

const SCENARIOS = new Set([
  "webgl",
  "webgpu-capabilities",
  "webgpu",
  "webgpu-soak",
  "webgpu-readiness",
  "webgpu-default-soak",
  "webgpu-unavailable"
]);
const PRE_3D_FIELD_TRIANGLE_COUNT = 53706;
const WEBGPU_SOAK_MOVEMENT_MS = 22000;
const WEBGPU_READINESS_MOVEMENT_MS = 60000;
const WEBGPU_DEFAULT_SOAK_MOVEMENT_MS = readDurationEnv("RIPPLE_WEBGPU_DEFAULT_SOAK_MS", 120000, 120000);
const WEBGPU_SOAK_MAX_WAKE_MEAN_ABS_HEIGHT = 0.1;
const WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE = 0.24;
const WEBGPU_SOAK_MAX_WAKE_ABS_HEIGHT = 1.1;
const WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS = 90;
const WEBGPU_MAX_AVERAGE_BRIGHTNESS = 185;
const WEBGPU_MAX_GLARE_RATIO = 0.22;
const WEBGPU_MAX_CYAN_WASH_RATIO = 0.9;
const WEBGPU_MAX_BLUE_WASH_RATIO = 0.94;
const WEBGPU_READINESS_TIER = "diagnostic-core";
const WEBGPU_DEFAULT_ELIGIBLE = false;
const WEBGPU_SHADOW_GEOMETRY_MODE = "shape-proxy-casters";
const WEBGPU_AVATAR_MODE = "hover-pod";
const WEBGPU_AVATAR_ASSET_ID = "webgpu-hover-pod";
const WEBGPU_MOTE_AVATAR_ASSET_ID = "mote-core-orbit";
const WEBGPU_REQUIRED_REMAINING_GAPS = [];
const scenario = process.argv[2] ?? "";

if (!SCENARIOS.has(scenario)) {
  console.error(`Usage: node scripts/verify-render.mjs ${[...SCENARIOS].join("|")}`);
  process.exit(1);
}

const config = createHarnessConfig();
const serverScope = await ensureServersReady(config);
let browser;
const EXPECTED_INITIAL_ECHO_COUNT = 3;

try {
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });

  if (scenario === "webgpu-unavailable") {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, "gpu", {
          configurable: true,
          get: () => undefined
        });
      } catch {
        // Some browser builds expose navigator.gpu directly on the instance.
      }

      try {
        Object.defineProperty(window.navigator, "gpu", {
          configurable: true,
          get: () => undefined
        });
      } catch {
        // If this also fails, the verifier will fail on the observed behavior.
      }
    });
  }

  const page = await context.newPage();
  const pageProblems = collectPageProblems(page);

  if (scenario === "webgl") {
    await verifyWebGlRender(page, pageProblems);
  } else if (scenario === "webgpu-capabilities") {
    await verifyWebGpuCapabilities(page, pageProblems);
  } else if (scenario === "webgpu") {
    await verifyWebGpuRender(page, pageProblems);
  } else if (scenario === "webgpu-soak") {
    await verifyWebGpuSoak(page, pageProblems);
  } else if (scenario === "webgpu-readiness") {
    await verifyWebGpuReadiness(page, pageProblems);
  } else if (scenario === "webgpu-default-soak") {
    await verifyWebGpuDefaultSoak(page, pageProblems);
  } else {
    await verifyWebGpuUnavailable(page, pageProblems);
  }
} finally {
  await browser?.close();
  serverScope.shutdown();
}

async function verifyWebGlRender(page, pageProblems) {
  const smokeRun = createSmokeRun("webgl");
  const url = buildAppUrl(config, { renderer: "webgl", mode: "arena", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, "WebGL canvas");
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) =>
    record.entry.payload.activeBackend === "webgl" &&
    record.entry.payload.playMode === "arena" &&
    record.entry.payload.raceTrackEnabled === false &&
    record.entry.payload.trackMaskUploaded === false &&
    record.entry.payload.arenaBarrierEnabled === true &&
    record.entry.payload.fieldLayoutMode === "arena-full" &&
    record.entry.payload.culledHexCount === 0
  );
  await waitForRunEvent(page, smokeRun, "wake.init");
  await waitForRunEvent(page, smokeRun, "skybox.load", undefined, 25000);
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgl" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.arenaBarrierEnabled === true;
  });

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  pageProblems.assertNoErrors("WebGL render smoke");

  await verifyWebGlDefaultAutoRender(page, pageProblems);
  await verifyWebGlTrackRender(page, pageProblems);
  await verifyTrainingRender(page, pageProblems, "webgl");
  await verifyMenuTransitions(page, pageProblems, "webgl");

  console.log(`[ripple-field-lab:verify:webgl] visible WebGL scene OK at ${url}`);
}

async function verifyWebGlDefaultAutoRender(page, pageProblems) {
  const defaultSmokeRun = createSmokeRun("webgl-default");
  const defaultUrl = buildAppUrl(config, { mode: "arena", smokeRun: defaultSmokeRun });

  await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, "default auto WebGL canvas");
  await waitForRunEvent(page, defaultSmokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.requestedMode === "auto" &&
      payload.selectionSource === "default" &&
      payload.activeBackend === "webgl" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.arenaBarrierEnabled === true;
  });
  await waitForRunEvent(page, defaultSmokeRun, "renderer.frameSample", (record) =>
    record.entry.payload.backendId === "webgl" &&
    record.entry.payload.playMode === "arena"
  );
  assertNoDiagnosticErrors(await readRunEvents(defaultSmokeRun));

  const autoSmokeRun = createSmokeRun("webgl-auto");
  const autoUrl = buildAppUrl(config, { renderer: "auto", mode: "arena", smokeRun: autoSmokeRun });

  await page.goto(autoUrl, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, "explicit auto WebGL canvas");
  await waitForRunEvent(page, autoSmokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.requestedMode === "auto" &&
      payload.selectionSource === "query" &&
      payload.activeBackend === "webgl" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.arenaBarrierEnabled === true;
  });
  await waitForRunEvent(page, autoSmokeRun, "renderer.frameSample", (record) =>
    record.entry.payload.backendId === "webgl" &&
    record.entry.payload.playMode === "arena"
  );
  assertNoDiagnosticErrors(await readRunEvents(autoSmokeRun));
  pageProblems.assertNoErrors("default/auto WebGL smoke");
}

async function verifyWebGlTrackRender(page, pageProblems) {
  const smokeRun = createSmokeRun("webgl-track");
  const url = buildAppUrl(config, { renderer: "webgl", mode: "track", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, "WebGL Track canvas");
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgl" &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === false &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.culledHexCount > 0 &&
      payload.trackWallEnabled === true &&
      payload.trackWallSegments > 0;
  });
  await waitForRunEvent(page, smokeRun, "wake.init");
  await waitForRunEvent(page, smokeRun, "skybox.load", undefined, 25000);
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgl" &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === false &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.culledHexCount > 0 &&
      payload.trackWallEnabled === true;
  });

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  pageProblems.assertNoErrors("WebGL Track render smoke");

  console.log(`[ripple-field-lab:verify:webgl] visible WebGL Track scene OK at ${url}`);
}

async function verifyTrainingRender(page, pageProblems, backendId) {
  const smokeRun = createSmokeRun(`${backendId}-training`);
  const url = buildAppUrl(config, { renderer: backendId, mode: "training", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, `${backendId} Training canvas`, backendId);
  await page.locator("#training-hud:not([hidden])").waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Camera Orbit" }).waitFor({ timeout: 15000 });
  await page.getByText(/^1\/9 - Hold left mouse and drag/).waitFor({ timeout: 15000 });

  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === backendId &&
      payload.playMode === "training" &&
      payload.raceTrackEnabled === true &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.culledHexCount > 0 &&
      payload.trackWallEnabled === true &&
      payload.trackWallSegments > 0 &&
      payload.trainingEnabled === true &&
      payload.trainingActive === true &&
      payload.trainingComplete === false &&
      payload.trainingStepId === "camera-orbit" &&
      payload.trainingStepIndex === 1 &&
      payload.trainingStepCount === 9 &&
      payload.trainingMarkerVisible === true &&
      payload.deviceLost === false;
  });

  if (backendId === "webgpu") {
    await waitForRunEvent(page, smokeRun, "track.wall.webgpu.frame", (record) => {
      const payload = record.entry.payload;
      return payload.enabled === true &&
        payload.playMode === "training" &&
        payload.segmentCount > 0 &&
        payload.depthMode === "field-depth-read" &&
        payload.drawCalls === 1 &&
        payload.triangles > 0 &&
        payload.deviceLost === false;
    });
    await waitForRunEvent(page, smokeRun, "training.webgpu.frame", (record) => {
      const payload = record.entry.payload;
      return payload.enabled === true &&
        payload.playMode === "training" &&
        payload.stepId === "camera-orbit" &&
        payload.stepIndex === 1 &&
        payload.stepCount === 9 &&
        payload.depthMode === "field-depth-read" &&
        payload.drawCalls === 1 &&
        payload.triangles === 8 &&
        payload.deviceLost === false;
    });
  }

  const beforeDrag = await readRunEvents(smokeRun);
  const trainingEchoSpawns = beforeDrag.filter((record) => record.entry.channel === "echo.state.spawn");
  if (trainingEchoSpawns.length > 0) {
    throw new Error(`Training emitted random Echo spawns before its scripted pickup step:\n${formatRecords(trainingEchoSpawns)}`);
  }

  await performTrainingLeftDrag(page, backendId);
  await page.getByRole("heading", { name: "Steer Facing" }).waitFor({ timeout: 10000 });
  await page.getByText(/^2\/9 - Hold right mouse and drag/).waitFor({ timeout: 10000 });
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === backendId &&
      payload.playMode === "training" &&
      payload.trainingStepId === "steer-facing" &&
      payload.trainingStepIndex === 2 &&
      payload.trackWallEnabled === true &&
      payload.trainingMarkerVisible === true &&
      payload.deviceLost === false;
  }, 10000);

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  if (backendId === "webgpu") {
    assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU Training render");
  }
  pageProblems.assertNoErrors(`${backendId} Training smoke`);
  console.log(`[ripple-field-lab:verify:${backendId}] Training step one and marker/wall parity OK at ${url}`);
}

async function performTrainingLeftDrag(page, backendId) {
  const canvas = await waitForVisibleCanvas(page, backendId);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Training canvas has no drag bounds.");

  const startX = bounds.x + bounds.width * 0.5;
  const startY = bounds.y + bounds.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: "left" });
  await delay(100);
  await page.mouse.move(startX + 180, startY + 25, { steps: 12 });
  await page.mouse.up({ button: "left" });
}

async function verifyMenuTransitions(page, pageProblems, backendId) {
  const smokeRun = createSmokeRun(`${backendId}-menu`);
  const url = buildAppUrl(config, { renderer: backendId, smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#main-menu:not([hidden])").waitFor({ timeout: 15000 });
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) =>
    record.entry.payload.activeBackend === backendId && record.entry.payload.playMode === "none"
  );
  await page.locator("#start-arena-button").click();
  await waitForRunEvent(page, smokeRun, "mode.select", (record) =>
    record.entry.payload.mode === "arena" && record.entry.payload.reason === "menu"
  );
  await assertNonBlankCanvas(page, `${backendId} menu-start Arena canvas`, backendId);
  await page.locator("#menu-toggle").click();
  await page.locator("#scene-menu-backdrop:not([hidden])").waitFor({ timeout: 5000 });
  await page.locator("#exit-to-main-menu-button").click();
  await waitForRunEvent(page, smokeRun, "mode.menu");
  await page.locator("#main-menu:not([hidden])").waitFor({ timeout: 5000 });
  const mode = await waitForRunEvent(page, smokeRun, "renderer.mode", (record) =>
    record.entry.payload.activeBackend === backendId && record.entry.payload.playMode === "none"
  );
  if (mode.entry.payload.arenaBarrierEnabled !== true) {
    throw new Error(`${backendId} main-menu renderer state did not restore Arena policy.`);
  }

  assertNoDiagnosticErrors(await readRunEvents(smokeRun));
  pageProblems.assertNoErrors(`${backendId} menu transition smoke`);
  console.log(`[ripple-field-lab:verify:${backendId}] main menu -> Arena -> pause -> main menu OK at ${url}`);
}

async function verifyWebGpuCapabilities(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-capabilities");
  const url = buildAppUrl(config, { renderer: "webgl", mode: "arena", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => record.entry.payload.activeBackend === "webgl");

  const capabilities = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (!gpu) return { ok: false, message: "navigator.gpu is unavailable." };

    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, message: "navigator.gpu.requestAdapter() returned null." };

    const device = await adapter.requestDevice();
    const preferredFormat = gpu.getPreferredCanvasFormat();
    const deviceLostPromise = device.lost.then(
      (info) => ({ reason: info.reason, message: info.message }),
      (error) => ({ reason: "rejected", message: String(error) })
    );

    const result = {
      ok: true,
      preferredFormat,
      adapterFeatures: [...adapter.features],
      deviceFeatures: [...device.features],
      maxTextureDimension2D: device.limits.maxTextureDimension2D,
      maxBindGroups: device.limits.maxBindGroups,
      deviceLostHandlerInstalled: Boolean(deviceLostPromise)
    };

    device.destroy();
    return result;
  });

  if (!capabilities.ok) {
    throw new Error(`WebGPU capabilities check failed: ${capabilities.message}`);
  }

  if (!capabilities.preferredFormat || capabilities.maxTextureDimension2D < 4096 || !capabilities.deviceLostHandlerInstalled) {
    throw new Error(`WebGPU capabilities were incomplete: ${JSON.stringify(capabilities)}`);
  }

  pageProblems.assertNoErrors("WebGPU capability smoke");

  console.log(
    `[ripple-field-lab:verify:webgpu:capabilities] navigator.gpu OK ` +
    `(format=${capabilities.preferredFormat}, maxTexture=${capabilities.maxTextureDimension2D})`
  );
}

async function verifyWebGpuRender(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "arena", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForRunEvent(page, smokeRun, "webgpu.support", (record) => record.entry.payload.available === true);
  await waitForRunEvent(page, smokeRun, "webgpu.ready");
  await waitForRunEvent(page, smokeRun, "webgpu.runtime.init");
  const echoInit = await waitForRunEvent(page, smokeRun, "echo.state.init", (record) => {
    const payload = record.entry.payload;
    return payload.activeEchoes === EXPECTED_INITIAL_ECHO_COUNT;
  });
  const initialActiveEchoes = echoInit.entry.payload.activeEchoes;
  const sceneInit = await waitForRunEvent(page, smokeRun, "webgpu.sceneState.init", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.stateMode === "playable" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.arenaBarrierEnabled === true &&
      payload.cameraMode === "playable" &&
      Boolean(payload.skybox) &&
      payload.arenaRadius > 0 &&
      payload.avatarMode === WEBGPU_AVATAR_MODE &&
      hasHoverPodAvatarPresentation(payload) &&
      payload.avatarCoreRadius > 0 &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      payload.bloomMode === "bright-downsample-separable-blur" &&
      payload.bloomPasses >= 3 &&
      payload.renderedLocalLights > 0 &&
      hasShapeProxyShadowMap(payload) &&
      payload.sourceLimit > 0 &&
      payload.activeEchoes === initialActiveEchoes &&
      payload.renderedEchoes === initialActiveEchoes;
  });
  const initialRenderedSources = sceneInit.entry.payload.renderedSources;
  const initialActiveLocalLights = sceneInit.entry.payload.activeLocalLights;
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.init", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.cameraMode === "playable" &&
      payload.particlesEnabled === true &&
      hasHoverPodAvatarPresentation(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.canvas.configure");
  await waitForRunEvent(page, smokeRun, "webgpu.firstFrame", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.playMode === "arena" &&
      payload.raceTrackEnabled === false &&
      payload.arenaBarrierEnabled === true &&
      payload.projectionMode === "perspective" &&
      payload.cameraMode === "playable" &&
      Boolean(payload.skybox) &&
      Boolean(payload.skyboxTextureTier) &&
      payload.arenaRadius > 0 &&
      payload.avatarMode === WEBGPU_AVATAR_MODE &&
      hasHoverPodAvatarPresentation(payload) &&
      payload.avatarCoreRadius > 0 &&
      payload.integrationSurface === "core-render-snapshot" &&
      payload.pulseGlowCount > 0 &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      payload.bloomMode === "bright-downsample-separable-blur" &&
      payload.bloomPasses >= 3 &&
      payload.renderedLocalLights > 0 &&
      hasShapeProxyShadowMap(payload) &&
      payload.depthFormat === "depth24plus" &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.activeEchoes === initialActiveEchoes &&
      payload.renderedEchoes === initialActiveEchoes &&
      payload.echoVisualRenderedEchoes === initialActiveEchoes &&
      payload.echoVisualBillboardInstances > 0 &&
      payload.echoVisualOrbInstances > 0 &&
      payload.activeParticles > 0 &&
      payload.renderedParticles > 0 &&
      payload.drawCalls >= 5 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT;
  });
  const first = await assertNonBlankCanvas(page, "WebGPU diagnostic canvas", "webgpu");
  assertWebGpuVisualBounds(first.analysis, "WebGPU diagnostic canvas");
  await delay(700);
  const second = await captureCanvasPng(page);
  const secondAnalysis = analyzePng(second);
  assertAnimatedPng(first.png, second, "WebGPU diagnostic canvas");
  assertWebGpuVisualBounds(secondAnalysis, "WebGPU diagnostic canvas after animation");
  await waitForRunEvent(page, smokeRun, "skybox.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-skybox" && payload.drawCalls === 1;
  });
  await waitForRunEvent(page, smokeRun, "skybox.webgpu.load", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-skybox" && Boolean(payload.skybox) && Boolean(payload.textureTier);
  }, 25000);
  await waitForRunEvent(page, smokeRun, "arena.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-arena-barrier" &&
      payload.depthMode === "field-depth-read" &&
      payload.triangles > 0;
  });
  await waitForRunEvent(page, smokeRun, "avatar.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-avatar-preview" &&
      payload.avatarMode === WEBGPU_AVATAR_MODE &&
      hasSavedMoteAvatarAsset(payload) &&
      payload.savedMoteAssetInstances > 0 &&
      payload.hoverPodInstances > 0 &&
      payload.depthMode === "field-depth-read";
  });
  await waitForRunEvent(page, smokeRun, "pulseLight.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-pulse-glow" &&
      payload.depthMode === "field-depth-read" &&
      payload.pulseGlowLimit > 0;
  });
  await waitForRunEvent(page, smokeRun, "echo.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-echo-visual" &&
      payload.depthMode === "field-depth-read" &&
      payload.activeVisualMode === "layered-orb-billboard" &&
      payload.echoLimit > 0 &&
      payload.collectionEventLimit > 0;
  });
  await waitForRunEvent(page, smokeRun, "lighting.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-light-buffer" &&
      payload.localLightLimit === 16;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-shadow-buffer" &&
      payload.shadowMode === "shadow-map-contact" &&
      payload.shadowCasterLimit === 16;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.map.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-shadow-map" &&
      payload.shadowMode === "shadow-map-contact" &&
      payload.shadowGeometryMode === WEBGPU_SHADOW_GEOMETRY_MODE &&
      payload.fieldReceiver === true &&
      payload.mapSize >= 512 &&
      payload.format === "depth32float" &&
      payload.pcfTaps >= 9 &&
      payload.trianglesPerCaster >= 6 &&
      payload.shadowCasterLimit === 16;
  });
  await waitForRunEvent(page, smokeRun, "bloom.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-bloom" &&
      payload.bloomMode === "bright-downsample-separable-blur" &&
      payload.bloomPasses >= 3 &&
      payload.drawCalls >= 3;
  });
  await waitForRunEvent(page, smokeRun, "particle.state.init", (record) => {
    const payload = record.entry.payload;
    return payload.particleBudget > 0;
  });
  await waitForRunEvent(page, smokeRun, "particle.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-particle-preview" &&
      payload.depthMode === "field-depth-read" &&
      payload.particleBudget > 0;
  });
  await waitForRunEvent(page, smokeRun, "wake.webgpu.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-compute" && payload.textureSize > 1;
  });
  await waitForRunEvent(page, smokeRun, "wake.webgpu.reset", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-compute" && payload.textureSize > 1;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.layout", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.projectionMode === "perspective" &&
      payload.depthFormat === "depth24plus" &&
      payload.instanceCount > 0 &&
      payload.sourceLimit > 0;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.init", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.projectionMode === "perspective" &&
      payload.depthFormat === "depth24plus" &&
      payload.drawCalls === 1 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.depth", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.projectionMode === "perspective" &&
      payload.depthFormat === "depth24plus" &&
      payload.presentationWidth > 1 &&
      payload.presentationHeight > 1;
  });
  await waitForRunEvent(page, smokeRun, "skybox.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-skybox" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.textureReady === true &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "arena.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-arena-barrier" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.arenaRadius > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "avatar.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-avatar-preview" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.avatarMode === WEBGPU_AVATAR_MODE &&
      hasHoverPodAvatarPresentation(payload) &&
      payload.avatarCoreRadius > 0 &&
      payload.savedMoteAssetInstances > 0 &&
      payload.hoverPodInstances > 0 &&
      payload.depthMode === "field-depth-read" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "pulseLight.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-pulse-glow" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.renderedGlows > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "echo.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-echo-visual" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.activeVisualMode === "layered-orb-billboard" &&
      payload.renderedEchoes === initialActiveEchoes &&
      payload.billboardInstances > 0 &&
      payload.orbInstances > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "lighting.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-light-buffer" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.renderedLocalLights > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-shadow-buffer" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.shadowMode === "shadow-map-contact" &&
      payload.renderedShadowCasters > 0 &&
      payload.shadowStrength > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.map.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-shadow-map" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      hasShapeProxyShadowMap(payload) &&
      payload.passMs >= 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "bloom.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-bloom" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.bloomMode === "bright-downsample-separable-blur" &&
      payload.bloomPasses >= 3 &&
      payload.bloomStrength >= 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "wake.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-compute" &&
      payload.textureSize > 1 &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.playerGroundContact === 1 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.projectionMode === "perspective" &&
      payload.cameraMode === "playable" &&
      payload.depthFormat === "depth24plus" &&
      payload.instanceCount > 0 &&
      payload.wakeTextureSize > 1 &&
      payload.activeEchoes === initialActiveEchoes &&
      payload.renderedEchoes === initialActiveEchoes &&
      payload.drawCalls === 1 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT &&
      payload.renderedLocalLights > 0 &&
      hasShapeProxyShadowReceiver(payload) &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "particle.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-particle-preview" &&
      payload.depthMode === "field-depth-read" &&
      payload.activeParticles > 0 &&
      payload.renderedParticles > 0 &&
      payload.drawCalls === 1 &&
      payload.triangles > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true;
  });
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.stateMode === "playable" &&
      payload.cameraMode === "playable" &&
      payload.drawCalls >= 5 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT &&
      hasHoverPodAvatarPresentation(payload) &&
      payload.avatarCoreRadius > 0 &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      payload.renderedLocalLights > 0 &&
      payload.bloomPasses >= 3 &&
      hasShapeProxyShadowMap(payload) &&
      payload.echoVisualRenderedEchoes > 0 &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.init", (record) => {
    const payload = record.entry.payload;
    return payload.integrationSurface === "core-render-snapshot" &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.cameraMode === "playable" &&
      hasDiagnosticCoreReadiness(payload) &&
      hasHoverPodAvatarPresentation(payload) &&
      hasShapeProxyShadowMap(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return payload.integrationSurface === "core-render-snapshot" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.activeBackend === "webgpu" &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });
  await focusSceneCanvas(page);
  await page.keyboard.down("w");
  try {
    await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
      const payload = record.entry.payload;
      return payload.scenePresentationMode === "webgpu-core-scene" &&
        payload.stateMode === "playable" &&
        payload.cameraMode === "playable" &&
        payload.playerSpeed > 0 &&
        payload.baseSpeed === 10 &&
        payload.surfaceGrip === 1 &&
        payload.deviceLost === false;
    }, 12000);
    await waitForRunEvent(page, smokeRun, "echo.state.collect", (record) => {
      const payload = record.entry.payload;
      return typeof payload.id === "number" &&
        payload.activeVisualBursts > 0 &&
        payload.burstStrength > 0;
    }, 20000);
  } finally {
    await page.keyboard.up("w");
  }
  await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.stateMode === "playable" &&
      payload.cameraMode === "playable" &&
      payload.renderedSources >= 1 &&
      payload.pulseGlowCount > 0 &&
      payload.activeLocalLights >= initialActiveLocalLights &&
      payload.renderedLocalLights > 0 &&
      hasShapeProxyShadowMap(payload, { requireDisc: true }) &&
      payload.activeEchoBursts > 0 &&
      payload.echoVisualRenderedCollectionEvents > 0 &&
      payload.activeParticles > 0 &&
      payload.renderedParticles > 0 &&
      payload.deviceLost === false;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "echo.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-echo-visual" &&
      payload.renderedCollectionEvents > 0 &&
      payload.depthMode === "field-depth-read" &&
      payload.deviceLost === false;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "echo.collect", (record) => {
    const payload = record.entry.payload;
    return payload.emittedParticleCount > 0;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.frame", (record) => {
    const payload = record.entry.payload;
    return payload.cameraMode === "playable" &&
      payload.renderedSources >= 1 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "particle.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.renderedParticles > 0 && payload.deviceLost === false;
  });
  await dispatchPointerDown(page, "#pulse-button");
  await waitForRunEvent(page, smokeRun, "webgpu.pulse.button", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.stateMode === "playable" &&
      payload.inputEnabled === true &&
      payload.triggered === true;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.stateMode === "playable" &&
      payload.activeSources >= 1 &&
      payload.renderedSources >= 1 &&
      payload.pulseGlowCount > 0 &&
      payload.renderedParticles > 0 &&
      payload.renderedLocalLights > 0 &&
      hasShapeProxyShadowMap(payload, { requireDisc: true }) &&
      payload.deviceLost === false;
  });

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU render");
  pageProblems.assertNoErrors("WebGPU render smoke");

  await verifyWebGpuTrackRender(page, pageProblems);
  await verifyTrainingRender(page, pageProblems, "webgpu");
  await verifyMenuTransitions(page, pageProblems, "webgpu");

  console.log(`[ripple-field-lab:verify:webgpu] visible WebGPU diagnostic runtime OK at ${url}`);
}

async function verifyWebGpuTrackRender(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-track");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "track", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForRunEvent(page, smokeRun, "webgpu.support", (record) => record.entry.payload.available === true);
  await waitForRunEvent(page, smokeRun, "webgpu.ready");
  await waitForRunEvent(page, smokeRun, "webgpu.runtime.init");
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === true &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.trackWallEnabled === true &&
      payload.trackWallSegments > 0;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.firstFrame", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === true &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.drawCalls >= 4 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.sceneState.init", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.stateMode === "playable" &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === true &&
      payload.arenaBarrierEnabled === false &&
      payload.trackWallEnabled === true &&
      payload.trackWallSegments > 0 &&
      payload.activeEchoes === EXPECTED_INITIAL_ECHO_COUNT &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "arena.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-arena-barrier" &&
      payload.playMode === "track" &&
      payload.arenaBarrierEnabled === false &&
      payload.drawCalls === 0 &&
      payload.triangles === 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.raceTrackMaskWidth > 1 &&
      payload.raceTrackMaskHeight > 1 &&
      payload.raceTrackMaskVersion > 0 &&
      payload.trackMaskUploaded === true &&
      payload.trackMaskBodyCoverage > 0 &&
      payload.trackMaskEdgeCoverage > 0 &&
      payload.trackMaskCenterCoverage > 0 &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.wakeTextureSize > 1 &&
      payload.drawCalls === 1 &&
      payload.triangles > PRE_3D_FIELD_TRIANGLE_COUNT &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.playMode === "track" &&
      payload.raceTrackEnabled === true &&
      payload.trackMaskUploaded === true &&
      payload.trackMaskBodyCoverage > 0 &&
      payload.trackMaskEdgeCoverage > 0 &&
      payload.trackMaskCenterCoverage > 0 &&
      payload.arenaBarrierEnabled === false &&
      payload.fieldLayoutMode === "track-clipped" &&
      payload.trackWallEnabled === true &&
      payload.trackWallSegments > 0 &&
      payload.deviceLost === false;
  });

  const first = await assertNonBlankCanvas(page, "WebGPU Track diagnostic canvas", "webgpu");
  assertWebGpuVisualBounds(first.analysis, "WebGPU Track diagnostic canvas");
  await delay(700);
  const second = await captureCanvasPng(page);
  assertAnimatedPng(first.png, second, "WebGPU Track diagnostic canvas");

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU Track render");
  pageProblems.assertNoErrors("WebGPU Track render smoke");

  console.log(`[ripple-field-lab:verify:webgpu] visible WebGPU Track snapshot OK at ${url}`);
}

async function exerciseWebGpuSettings(page, smokeRun) {
  await clickControl(page, "#particle-toggle");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "particlesEnabled" &&
      payload.value === false &&
      payload.particlesEnabled === false;
  });
  await waitForRunEvent(page, smokeRun, "particle.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-particle-preview" &&
      payload.activeParticles === 0 &&
      payload.renderedParticles === 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.particlesEnabled === false &&
      payload.activeParticles === 0 &&
      payload.renderedParticles === 0 &&
      payload.deviceLost === false;
  });

  await clickControl(page, "#particle-toggle");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "particlesEnabled" &&
      payload.value === true &&
      payload.particlesEnabled === true;
  });
  await setControlValue(page, "#particle-slider", "0.35", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "particleDensity" &&
      payload.value === 0.35 &&
      payload.particleDensity === 0.35;
  });
  await setControlValue(page, "#particle-slider", "0.9", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "particleDensity" &&
      payload.value === 0.9 &&
      payload.particleDensity === 0.9;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.particlesEnabled === true &&
      payload.particleDensity === 0.9 &&
      payload.renderedParticles > 0 &&
      payload.deviceLost === false;
  });

  await clickControl(page, "#bloom-toggle");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "bloomEnabled" &&
      payload.value === false &&
      payload.bloomEnabled === false &&
      payload.bloomStrength === 0;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.bloomEnabled === false &&
      payload.bloomStrength === 0 &&
      payload.deviceLost === false;
  });

  await clickControl(page, "#bloom-toggle");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "bloomEnabled" &&
      payload.value === true &&
      payload.bloomEnabled === true &&
      payload.bloomStrength <= 0.32;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.bloomEnabled === true &&
      payload.bloomStrength > 0 &&
      payload.bloomStrength <= 0.32 &&
      payload.deviceLost === false;
  });

  await setControlValue(page, "#skybox-select", "aurora", "change");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "skybox" &&
      payload.value === "aurora" &&
      payload.skybox === "aurora";
  });
  await waitForRunEvent(page, smokeRun, "skybox.webgpu.load", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-skybox" &&
      payload.skybox === "aurora" &&
      Boolean(payload.textureTier);
  }, 25000);

  await setControlValue(page, "#quality-select", "showoff", "change");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "quality" &&
      payload.value === "showoff" &&
      payload.quality === "showoff";
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.quality === "showoff" &&
      payload.skybox === "aurora" &&
      payload.particlesEnabled === true &&
      payload.particleDensity === 0.9 &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE &&
      payload.deviceLost === false;
  }, 20000);

  await setControlValue(page, "#voxel-size-slider", "1.2", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "voxelSizeMeters" &&
      payload.value === 1.2 &&
      payload.voxelSizeMeters === 1.2 &&
      payload.fieldScaleChangedControl === "voxel-size" &&
      typeof payload.fieldInstanceEstimate === "number" &&
      payload.wakeTextureSize > 1;
  });
  const voxelLayout = await waitForRunEvent(page, smokeRun, "ripple.webgpu.layout", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.reason === "field-scale" &&
      payload.quality === "showoff" &&
      payload.instanceCount > 0;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "wake.webgpu.reset", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-compute" &&
      payload.reason === "field-scale" &&
      payload.quality === "showoff" &&
      payload.textureSize > 1;
  }, 20000);

  await setControlValue(page, "#arena-radius-slider", "180", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "arenaRadiusMeters" &&
      payload.value === 180 &&
      payload.arenaRadiusMeters === 180 &&
      payload.fieldScaleChangedControl === "arena-radius" &&
      typeof payload.fieldInstanceEstimate === "number" &&
      payload.wakeTextureSize > 1;
  });
  const arenaLayout = await waitForRunEvent(page, smokeRun, "ripple.webgpu.layout", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.reason === "field-scale" &&
      payload.quality === "showoff" &&
      payload.instanceCount > 0 &&
      payload.instanceCount !== voxelLayout.entry.payload.instanceCount;
  }, 20000);

  await setControlValue(page, "#base-speed-slider", "12", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "baseSpeed" &&
      payload.baseSpeed === 12 &&
      payload.boostSpeed >= 12;
  });
  await setControlValue(page, "#boost-speed-slider", "42", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "boostSpeed" &&
      payload.baseSpeed === 12 &&
      payload.boostSpeed === 42;
  });
  await setControlValue(page, "#surface-grip-slider", "1.35", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "surfaceGrip" &&
      payload.surfaceGrip === 1.35;
  });
  await setControlValue(page, "#height-slider", "1.8", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "rippleHeight" &&
      payload.rippleHeight === 1.8;
  });
  await setControlValue(page, "#radius-slider", "12", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "rippleRadius" &&
      payload.rippleRadius === 12;
  });
  await setControlValue(page, "#depth-slider", "12", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "waveDepth" &&
      payload.waveDepth === 12 &&
      payload.waveSpeed > 0;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.quality === "showoff" &&
      payload.voxelSizeMeters === 1.2 &&
      payload.arenaRadiusMeters === 180 &&
      payload.baseSpeed === 12 &&
      payload.boostSpeed === 42 &&
      payload.surfaceGrip === 1.35 &&
      payload.rippleHeight === 1.8 &&
      payload.rippleRadius === 12 &&
      payload.waveDepth === 12 &&
      payload.waveSpeed > 0 &&
      payload.fieldInstanceCount === arenaLayout.entry.payload.instanceCount &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE &&
      payload.deviceLost === false;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.voxelSizeMeters === 1.2 &&
      payload.arenaRadiusMeters === 180 &&
      payload.baseSpeed === 12 &&
      payload.boostSpeed === 42 &&
      payload.surfaceGrip === 1.35 &&
      payload.rippleHeight === 1.8 &&
      payload.rippleRadius === 12 &&
      payload.waveDepth === 12 &&
      payload.waveSpeed > 0 &&
      payload.deviceLost === false;
  }, 20000);
}

async function exerciseViewportAndFocusChurn(page, smokeRun) {
  await page.setViewportSize({ width: 960, height: 540 });
  await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDefaultReadinessPayload(payload) &&
      payload.viewportWidth === 960 &&
      payload.viewportHeight === 540 &&
      payload.deviceLost === false;
  }, 12000);

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await delay(500);
  await page.bringToFront();
  await focusSceneCanvas(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDefaultReadinessPayload(payload) &&
      payload.viewportWidth === 1280 &&
      payload.viewportHeight === 720 &&
      payload.deviceLost === false;
  }, 12000);
}

async function verifyWebGpuSoak(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-soak");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "arena", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const first = await assertNonBlankCanvas(page, "WebGPU soak canvas", "webgpu");
  assertWebGpuVisualBounds(first.analysis, "WebGPU soak canvas");
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgpu" && hasDiagnosticCoreReadiness(payload);
  });
  const echoInit = await waitForRunEvent(page, smokeRun, "echo.state.init", (record) => {
    const payload = record.entry.payload;
    return payload.activeEchoes === EXPECTED_INITIAL_ECHO_COUNT;
  });
  const initialActiveEchoes = echoInit.entry.payload.activeEchoes;
  await waitForRunEvent(page, smokeRun, "renderer.frameSample", (record) => {
    const payload = record.entry.payload;
    return payload.backendId === "webgpu" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.echoVisualRenderedEchoes > 0 &&
      typeof payload.wakeEnergyEstimate === "number" &&
      hasShapeProxyShadowMap(payload) &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return payload.integrationSurface === "core-render-snapshot" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });

  await focusSceneCanvas(page);
  await page.keyboard.down("w");
  await waitForRunEvent(page, smokeRun, "echo.state.collect", (record) => {
    const payload = record.entry.payload;
    return typeof payload.id === "number" &&
      payload.activeVisualBursts > 0 &&
      payload.burstStrength > 0;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "echo.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-echo-visual" &&
      payload.renderedCollectionEvents > 0 &&
      payload.depthMode === "field-depth-read" &&
      payload.deviceLost === false;
  }, 20000);
  await dispatchPointerDown(page, "#pulse-button");
  await delay(1000);
  await setControlValue(page, "#quality-select", "showoff", "change");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "quality" &&
      payload.value === "showoff" &&
      payload.quality === "showoff";
  });
  await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
    const payload = record.entry.payload;
    return payload.quality === "showoff" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.deviceLost === false;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return payload.quality === "showoff" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.deviceLost === false;
  }, 20000);
  await setControlValue(page, "#voxel-size-slider", "1.15", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "voxelSizeMeters" &&
      payload.voxelSizeMeters === 1.15 &&
      payload.fieldScaleChangedControl === "voxel-size";
  }, 20000);
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.layout", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.reason === "field-scale" &&
      payload.quality === "showoff" &&
      payload.instanceCount > 0;
  }, 20000);
  await setControlValue(page, "#depth-slider", "10", "input");
  await waitForRunEvent(page, smokeRun, "webgpu.settings.change", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.setting === "waveDepth" &&
      payload.waveDepth === 10 &&
      payload.waveSpeed > 0;
  }, 20000);
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.frame", (record) => {
    const payload = record.entry.payload;
    return payload.quality === "showoff" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.voxelSizeMeters === 1.15 &&
      payload.waveDepth === 10 &&
      payload.waveSpeed > 0 &&
      payload.deviceLost === false;
  }, 20000);
  await delay(WEBGPU_SOAK_MOVEMENT_MS);
  await page.keyboard.up("w");

  const second = await captureCanvasPng(page);
  assertAnimatedPng(first.png, second, "WebGPU soak canvas");
  assertWebGpuVisualBounds(analyzePng(second), "WebGPU soak canvas after movement");

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU soak");
  assertWebGpuSoakEvents(events);
  pageProblems.assertNoErrors("WebGPU soak smoke");

  console.log(`[ripple-field-lab:verify:webgpu:soak] forced WebGPU soak OK at ${url}`);
}

async function verifyWebGpuReadiness(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-readiness");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "arena", smokeRun });
  const startedAt = Date.now();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const first = await assertNonBlankCanvas(page, "WebGPU readiness canvas", "webgpu");
  assertWebGpuVisualBounds(first.analysis, "WebGPU readiness canvas");
  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgpu" &&
      payload.integrationSurface === "core-render-snapshot" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.init", (record) => {
    const payload = record.entry.payload;
    return payload.integrationSurface === "core-render-snapshot" &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.cameraMode === "playable" &&
      hasHoverPodAvatarPresentation(payload) &&
      hasShapeProxyShadowMap(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return payload.integrationSurface === "core-render-snapshot" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.activeBackend === "webgpu" &&
      typeof payload.wakeEnergyEstimate === "number" &&
      hasShapeProxyShadowMap(payload) &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.map.frame", (record) => {
    const payload = record.entry.payload;
    return hasShapeProxyShadowMap(payload) &&
      payload.deviceLost === false;
  });

  await focusSceneCanvas(page);
  await page.keyboard.down("w");
  try {
    await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
      const payload = record.entry.payload;
      return hasDiagnosticCoreReadiness(payload) &&
        payload.scenePresentationMode === "webgpu-core-scene" &&
        payload.cameraMode === "playable" &&
        payload.playerSpeed > 0 &&
        payload.deviceLost === false;
    }, 12000);
    await dispatchPointerDown(page, "#pulse-button");
    await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
      const payload = record.entry.payload;
      return hasDiagnosticCoreReadiness(payload) &&
        payload.activeSources >= 1 &&
        payload.renderedSources >= 1 &&
        payload.pulseGlowCount > 0 &&
        hasShapeProxyShadowMap(payload, { requireDisc: true }) &&
        payload.deviceLost === false;
    }, 12000);
    await waitForRunEvent(page, smokeRun, "shadow.webgpu.map.frame", (record) => {
      const payload = record.entry.payload;
      return hasShapeProxyShadowMap(payload, { requireDisc: true }) &&
        payload.deviceLost === false;
    }, 12000);
    await waitForRunEvent(page, smokeRun, "echo.state.collect", (record) => {
      const payload = record.entry.payload;
      return typeof payload.id === "number" &&
        payload.activeVisualBursts > 0 &&
        payload.burstStrength > 0;
    }, 22000);
    await waitForRunEvent(page, smokeRun, "echo.webgpu.frame", (record) => {
      const payload = record.entry.payload;
      return payload.renderedCollectionEvents > 0 &&
        payload.depthMode === "field-depth-read" &&
        payload.deviceLost === false;
    }, 20000);

    await exerciseWebGpuSettings(page, smokeRun);
    await waitForRunEvent(page, smokeRun, "webgpu.integrationReadiness.frame", (record) => {
      const payload = record.entry.payload;
      return payload.integrationSurface === "core-render-snapshot" &&
        hasDiagnosticCoreReadiness(payload) &&
        payload.quality === "showoff" &&
        payload.skybox === "aurora" &&
        payload.voxelSizeMeters === 1.2 &&
        payload.arenaRadiusMeters === 180 &&
        payload.baseSpeed === 12 &&
        payload.boostSpeed === 42 &&
        payload.surfaceGrip === 1.35 &&
        payload.rippleHeight === 1.8 &&
        payload.rippleRadius === 12 &&
        payload.waveDepth === 12 &&
        payload.waveSpeed > 0 &&
        payload.particlesEnabled === true &&
        payload.particleDensity === 0.9 &&
        payload.bloomEnabled === true &&
        payload.bloomStrength <= 0.32 &&
        hasShapeProxyShadowMap(payload) &&
        typeof payload.wakeEnergyEstimate === "number" &&
        payload.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE &&
        payload.deviceLost === false;
    }, 20000);

    const remainingMs = Math.max(0, WEBGPU_READINESS_MOVEMENT_MS - (Date.now() - startedAt));
    await delay(remainingMs);
  } finally {
    await page.keyboard.up("w");
  }

  const second = await captureCanvasPng(page);
  assertAnimatedPng(first.png, second, "WebGPU readiness canvas");
  assertWebGpuVisualBounds(analyzePng(second), "WebGPU readiness canvas after readiness run");

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU readiness");
  assertWebGpuReadinessEvents(events);
  pageProblems.assertNoErrors("WebGPU readiness smoke");

  console.log(`[ripple-field-lab:verify:webgpu:readiness] forced WebGPU readiness run OK at ${url}`);
}

async function verifyWebGpuDefaultSoak(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-default-soak");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "arena", smokeRun });
  const startedAt = Date.now();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const first = await assertNonBlankCanvas(page, "WebGPU default-readiness canvas", "webgpu");
  assertWebGpuVisualBounds(first.analysis, "WebGPU default-readiness canvas");

  await waitForRunEvent(page, smokeRun, "renderer.mode", (record) => {
    const payload = record.entry.payload;
    return payload.activeBackend === "webgpu" &&
      payload.integrationSurface === "core-render-snapshot" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.defaultEligible === false;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.init", (record) => {
    const payload = record.entry.payload;
    return hasDefaultReadinessPayload(payload) &&
      payload.activeBackend === "webgpu" &&
      payload.stateMode === "playable" &&
      payload.defaultRolloutSoakGapClosed === true;
  });
  await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.frame", (record) => {
    const payload = record.entry.payload;
    return hasDefaultReadinessPayload(payload) &&
      payload.supportsBloom === true &&
      payload.supportsLocalLights === true &&
      hasShapeProxyShadowMap(payload) &&
      typeof payload.wakeEnergyEstimate === "number" &&
      payload.deviceLost === false;
  });

  await focusSceneCanvas(page);
  await page.keyboard.down("w");
  try {
    await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
      const payload = record.entry.payload;
      return hasDiagnosticCoreReadiness(payload) &&
        payload.playerSpeed > 0 &&
        payload.deviceLost === false;
    }, 12000);

    await page.keyboard.press("Space");
    await dispatchPointerDown(page, "#pulse-button");
    await waitForRunEvent(page, smokeRun, "webgpu.sceneState.frame", (record) => {
      const payload = record.entry.payload;
      return hasDiagnosticCoreReadiness(payload) &&
        payload.renderedSources >= 1 &&
        payload.pulseGlowCount > 0 &&
        hasShapeProxyShadowMap(payload, { requireDisc: true }) &&
        payload.deviceLost === false;
    }, 12000);

    await waitForRunEvent(page, smokeRun, "echo.state.collect", (record) => {
      const payload = record.entry.payload;
      return typeof payload.id === "number" &&
        payload.activeVisualBursts > 0 &&
        payload.burstStrength > 0;
    }, 24000);

    await exerciseWebGpuSettings(page, smokeRun);
    await exerciseViewportAndFocusChurn(page, smokeRun);

    await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.frame", (record) => {
      const payload = record.entry.payload;
      return hasDefaultReadinessPayload(payload) &&
        payload.quality === "showoff" &&
        payload.skybox === "aurora" &&
        payload.voxelSizeMeters === 1.2 &&
        payload.arenaRadiusMeters === 180 &&
        payload.waveDepth === 12 &&
        payload.waveSpeed > 0 &&
        payload.particlesEnabled === true &&
        payload.particleDensity === 0.9 &&
        payload.bloomEnabled === true &&
        payload.bloomStrength <= 0.32 &&
        payload.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE &&
        payload.deviceLost === false;
    }, 20000);

    const remainingMs = Math.max(0, WEBGPU_DEFAULT_SOAK_MOVEMENT_MS - (Date.now() - startedAt));
    await delay(remainingMs);
  } finally {
    await page.keyboard.up("w");
  }

  const second = await captureCanvasPng(page);
  assertAnimatedPng(first.png, second, "WebGPU default-readiness canvas");
  assertWebGpuVisualBounds(analyzePng(second), "WebGPU default-readiness canvas after default soak");

  await waitForRunEvent(page, smokeRun, "webgpu.defaultReadiness.summary", (record) => {
    const payload = record.entry.payload;
    return hasDefaultReadinessPayload(payload) &&
      payload.stabilityWindowSeconds >= WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS &&
      payload.defaultRolloutSoakGapClosed === true &&
      payload.deviceLost === false;
  }, 5000);
  await flushDebugLog(page);

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, ["webgpu.uncapturedError", "wake.init", "skybox.load"], "forced WebGPU default readiness soak");
  assertWebGpuReadinessEvents(events);
  assertWebGpuDefaultSoakEvents(events);
  pageProblems.assertNoErrors("WebGPU default readiness soak");

  console.log(`[ripple-field-lab:verify:webgpu:default-soak] forced WebGPU default-readiness soak OK at ${url}`);
}

async function verifyWebGpuDemoHarness(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-demo");
  const url = buildAppUrl(config, { renderer: "webgpu", webgpuDemo: "1", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await assertNonBlankCanvas(page, "WebGPU diagnostic demo canvas", "webgpu");
  await waitForRunEvent(page, smokeRun, "webgpu.sceneState.init", (record) => {
    const payload = record.entry.payload;
    return payload.scenePresentationMode === "webgpu-core-scene" &&
      hasDiagnosticCoreReadiness(payload) &&
      payload.stateMode === "diagnostic-demo" &&
      payload.cameraMode === "diagnostic-orbit" &&
      payload.avatarMode === WEBGPU_AVATAR_MODE &&
      hasHoverPodAvatarPresentation(payload);
  });
  await waitForRunEvent(page, smokeRun, "webgpu.readiness.init", (record) => {
    const payload = record.entry.payload;
    return hasDiagnosticCoreReadiness(payload) &&
      payload.stateMode === "diagnostic-demo" &&
      payload.cameraMode === "diagnostic-orbit" &&
      payload.activeBackend === "webgpu";
  });
  await waitForRunEvent(page, smokeRun, "skybox.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-skybox" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "arena.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-arena-barrier" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "avatar.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-avatar-preview" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "pulseLight.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-pulse-glow" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.renderedGlows > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "echo.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-echo-visual" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.depthMode === "field-depth-read" &&
      payload.activeEchoes === 0 &&
      payload.renderedEchoes === 0 &&
      payload.renderedCollectionEvents === 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "lighting.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-light-buffer" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.renderedLocalLights > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-scene-shadow-buffer" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.shadowMode === "shadow-map-contact" &&
      payload.renderedShadowCasters > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "shadow.webgpu.map.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-shadow-map" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.shadowMode === "shadow-map-contact" &&
      payload.shadowGeometryMode === WEBGPU_SHADOW_GEOMETRY_MODE &&
      payload.fieldReceiver === true &&
      payload.mapSize >= 512 &&
      payload.format === "depth32float" &&
      payload.renderedShadowCasters > 0 &&
      getShadowMapPayloadProxyTriangles(payload) > 0 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "bloom.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-bloom" &&
      payload.scenePresentationMode === "webgpu-core-scene" &&
      payload.bloomPasses >= 3 &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "ripple.webgpu.preview.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-field-preview" &&
      payload.cameraMode === "diagnostic-orbit" &&
      payload.shadowGeometryMode === WEBGPU_SHADOW_GEOMETRY_MODE &&
      payload.fieldReceiver === true &&
      payload.deviceLost === false;
  });
  await waitForRunEvent(page, smokeRun, "particle.webgpu.frame", (record) => {
    const payload = record.entry.payload;
    return payload.mode === "webgpu-particle-preview" &&
      payload.depthMode === "field-depth-read" &&
      payload.renderedParticles > 0 &&
      payload.deviceLost === false;
  });

  const events = await readRunEvents(smokeRun);
  assertNoDiagnosticErrors(events);
  assertNoChannels(events, [
    "webgpu.uncapturedError",
    "wake.init",
    "skybox.load",
    "echo.state.init",
    "echo.state.spawn",
    "echo.state.collect",
    "echo.state.frame"
  ], "forced WebGPU demo render");
  pageProblems.assertNoErrors("WebGPU demo render smoke");
}

async function verifyWebGpuUnavailable(page, pageProblems) {
  const smokeRun = createSmokeRun("webgpu-unavailable");
  const url = buildAppUrl(config, { renderer: "webgpu", mode: "arena", smokeRun });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "WebGPU unavailable" }).waitFor({ timeout: 15000 });
  await page.getByRole("paragraph").filter({ hasText: "No WebGL fallback was used for this forced renderer mode." }).waitFor({ timeout: 15000 });

  await waitForRunEvent(page, smokeRun, "webgpu.unavailable");
  await waitForRunEvent(page, smokeRun, "webgpu.fallback", (record) => record.entry.payload.activeBackend === "none");

  const events = await readRunEvents(smokeRun);
  assertNoChannels(events, ["renderer.mode", "wake.init", "skybox.load"], "forced WebGPU unavailable");
  pageProblems.assertNoPageErrors("WebGPU unavailable smoke");

  console.log(`[ripple-field-lab:verify:webgpu:unavailable] forced WebGPU failure path OK at ${url}`);
}

async function assertNonBlankCanvas(page, label, backendId) {
  const canvas = await waitForVisibleCanvas(page, backendId);
  const deadline = Date.now() + 15000;
  let lastPng;
  let lastAnalysis;

  while (Date.now() < deadline) {
    const png = await canvas.screenshot({ type: "png" });
    const analysis = analyzePng(png);
    lastPng = png;
    lastAnalysis = analysis;

    if (analysis.averageBrightness > 2 && analysis.nonBlackRatio > 0.01) {
      return { canvas, png, analysis };
    }

    await delay(150);
  }

  throw new Error(`${label} looked blank: ${JSON.stringify(lastAnalysis)}`);
}

async function waitForVisibleCanvas(page, backendId) {
  await page.waitForFunction((expectedBackendId) => {
    const canvases = [...document.querySelectorAll("canvas")];
    if (canvases.length !== 1) return false;

    const canvas = canvases[0];
    const bounds = canvas.getBoundingClientRect();
    const backendMatches = !expectedBackendId || canvas.dataset.rendererBackend === expectedBackendId;
    return backendMatches && canvas.width > 0 && canvas.height > 0 && bounds.width > 0 && bounds.height > 0;
  }, backendId ?? null, { timeout: 15000 });

  const count = await page.locator("canvas").count();
  if (count !== 1) throw new Error(`Expected exactly one canvas, found ${count}.`);

  return page.locator("canvas").first();
}

async function captureCanvasPng(page) {
  const canvas = await waitForVisibleCanvas(page, "webgpu");
  return canvas.screenshot({ type: "png" });
}

async function waitForRunEvent(page, smokeRun, channel, predicate = () => true, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastChannels = [];

  while (Date.now() < deadline) {
    await flushDebugLog(page);
    const records = await readRunEvents(smokeRun);
    const found = [...records].reverse().find((record) => record.entry.channel === channel && predicate(record));
    if (found) return found;

    lastChannels = [...new Set(records.map((record) => record.entry.channel))].slice(-12);
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${channel} in smokeRun=${smokeRun}. Seen channels: ${lastChannels.join(", ") || "none"}`);
}

async function readRunEvents(smokeRun) {
  const eventPayload = await fetchJson(config.logEventsUrl);
  const records = Array.isArray(eventPayload.entries) ? eventPayload.entries : [];
  return records
    .filter((record) => getSmokeRun(record.context?.href) === smokeRun)
    .map((record) => ({
      ...record,
      entry: record.entry ?? { channel: "unknown", level: "info", payload: {} }
    }));
}

async function flushDebugLog(page) {
  await page.evaluate(() => window.__rippleDebugFlush?.()).catch(() => undefined);
}

async function clickControl(page, selector) {
  await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Expected ${targetSelector} to be a button.`);
    }
    if (element.disabled) throw new Error(`${targetSelector} is disabled.`);
    element.click();
    element.blur();
    window.focus();
  }, selector);
}

async function dispatchPointerDown(page, selector) {
  await page.evaluate((targetSelector) => {
    for (const backdropSelector of ["#scene-menu-backdrop", "#changelog-backdrop"]) {
      const backdrop = document.querySelector(backdropSelector);
      if (backdrop instanceof HTMLElement) backdrop.hidden = true;
    }
    document.querySelector("#menu-toggle")?.setAttribute("aria-expanded", "false");

    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Expected ${targetSelector} to be an interactive element.`);
    }
    if ("disabled" in element && element.disabled === true) {
      throw new Error(`${targetSelector} is disabled.`);
    }
    element.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1
    }));
  }, selector);
}

async function setControlValue(page, selector, value, eventName) {
  await page.evaluate(({ targetSelector, targetValue, targetEventName }) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
      throw new Error(`Expected ${targetSelector} to be an input/select control.`);
    }
    if (element.disabled) throw new Error(`${targetSelector} is disabled.`);
    element.value = targetValue;
    element.dispatchEvent(new Event(targetEventName, { bubbles: true }));
    element.blur();
    window.focus();
  }, {
    targetSelector: selector,
    targetValue: value,
    targetEventName: eventName
  });
}

async function focusSceneCanvas(page) {
  await page.evaluate(() => {
    for (const backdropSelector of ["#scene-menu-backdrop", "#changelog-backdrop"]) {
      const backdrop = document.querySelector(backdropSelector);
      if (backdrop instanceof HTMLElement) backdrop.hidden = true;
    }
    document.querySelector("#menu-toggle")?.setAttribute("aria-expanded", "false");

    const canvas = document.querySelector("canvas");
    if (canvas instanceof HTMLCanvasElement) {
      canvas.tabIndex = 0;
      canvas.focus({ preventScroll: true });
      return;
    }

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.focus();
  });
}

function hasDiagnosticCoreReadiness(payload) {
  if (!Array.isArray(payload?.remainingGaps)) return false;
  const remainingGaps = payload.remainingGaps;
  return payload?.readinessTier === WEBGPU_READINESS_TIER &&
    payload.defaultEligible === WEBGPU_DEFAULT_ELIGIBLE &&
    remainingGaps.length === WEBGPU_REQUIRED_REMAINING_GAPS.length &&
    WEBGPU_REQUIRED_REMAINING_GAPS.every((gap) => remainingGaps.includes(gap));
}

function hasDefaultReadinessPayload(payload) {
  return payload?.defaultReadinessSurface === "forced-webgpu-core" &&
    hasDiagnosticCoreReadiness(payload) &&
    payload?.defaultRolloutSoakGapClosed === true &&
    payload?.remainingGapCount === WEBGPU_REQUIRED_REMAINING_GAPS.length &&
    payload?.scenePresentationMode === "webgpu-core-scene" &&
    payload?.stateMode === "playable" &&
    payload?.cameraMode === "playable" &&
    hasHoverPodAvatarPresentation(payload);
}

function hasHoverPodAvatarPresentation(payload) {
  return payload?.avatarPresentationMode === WEBGPU_AVATAR_MODE &&
    payload?.avatarAssetId === WEBGPU_AVATAR_ASSET_ID &&
    payload?.moteAvatarAssetId === WEBGPU_MOTE_AVATAR_ASSET_ID;
}

function hasSavedMoteAvatarAsset(payload) {
  return payload?.moteAvatarAssetId === WEBGPU_MOTE_AVATAR_ASSET_ID ||
    payload?.moteAssetId === WEBGPU_MOTE_AVATAR_ASSET_ID;
}

function hasShapeProxyCasterCounts(payload, { requireDisc = false } = {}) {
  return payload?.renderedOrbCasters > 0 &&
    payload?.renderedColumnCasters > 0 &&
    (!requireDisc || payload?.renderedDiscCasters > 0);
}

function getShadowMapPayloadSize(payload) {
  return payload?.shadowMapSize ?? payload?.mapSize ?? 0;
}

function getShadowMapPayloadFormat(payload) {
  return payload?.shadowMapFormat ?? payload?.format ?? "";
}

function getShadowMapPayloadPcfTaps(payload) {
  return payload?.shadowMapPcfTaps ?? payload?.pcfTaps ?? 0;
}

function getShadowMapPayloadProxyTriangles(payload) {
  return payload?.shadowMapProxyTriangles ?? payload?.proxyTriangles ?? 0;
}

function hasShapeProxyShadowReceiver(payload, options = {}) {
  return payload?.shadowMode === "shadow-map-contact" &&
    payload?.shadowGeometryMode === WEBGPU_SHADOW_GEOMETRY_MODE &&
    payload?.fieldReceiver === true &&
    payload?.renderedShadowCasters > 0 &&
    getShadowMapPayloadProxyTriangles(payload) > 0 &&
    hasShapeProxyCasterCounts(payload, options);
}

function hasShapeProxyShadowMap(payload, options = {}) {
  return hasShapeProxyShadowReceiver(payload, options) &&
    getShadowMapPayloadSize(payload) >= 512 &&
    getShadowMapPayloadFormat(payload) === "depth32float" &&
    getShadowMapPayloadPcfTaps(payload) >= 9;
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
      this.assertNoPageErrors(label);
      if (consoleErrors.length > 0) {
        throw new Error(`${label} emitted console errors:\n${consoleErrors.join("\n")}`);
      }
    },
    assertNoPageErrors(label) {
      if (pageErrors.length > 0) {
        throw new Error(`${label} emitted page errors:\n${pageErrors.join("\n")}`);
      }
    }
  };
}

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  const totalPixels = png.width * png.height;
  let nonBlackPixels = 0;
  let glarePixels = 0;
  let cyanWashPixels = 0;
  let blueWashPixels = 0;
  let brightnessTotal = 0;
  let maxBrightness = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    const brightness = (red + green + blue) / 3;

    if (alpha > 0 && brightness > 4) nonBlackPixels += 1;
    if (brightness > 246) glarePixels += 1;
    if (green > 88 && blue > 88 && red < 90 && brightness > 75) cyanWashPixels += 1;
    if (blue > 90 && red < 95 && brightness > 70) blueWashPixels += 1;
    brightnessTotal += brightness;
    maxBrightness = Math.max(maxBrightness, brightness);
  }

  return {
    width: png.width,
    height: png.height,
    maxBrightness: round(maxBrightness),
    averageBrightness: round(brightnessTotal / Math.max(1, totalPixels)),
    nonBlackRatio: round(nonBlackPixels / Math.max(1, totalPixels)),
    glareRatio: round(glarePixels / Math.max(1, totalPixels)),
    cyanWashRatio: round(cyanWashPixels / Math.max(1, totalPixels)),
    blueWashRatio: round(blueWashPixels / Math.max(1, totalPixels))
  };
}

function assertWebGpuVisualBounds(analysis, label) {
  if (analysis.averageBrightness > WEBGPU_MAX_AVERAGE_BRIGHTNESS) {
    throw new Error(`${label} exceeded average brightness bounds: ${JSON.stringify(analysis)}`);
  }
  if (analysis.glareRatio > WEBGPU_MAX_GLARE_RATIO) {
    throw new Error(`${label} exceeded bloom/glare coverage bounds: ${JSON.stringify(analysis)}`);
  }
  if (analysis.cyanWashRatio > WEBGPU_MAX_CYAN_WASH_RATIO) {
    throw new Error(`${label} exceeded cyan wash coverage bounds: ${JSON.stringify(analysis)}`);
  }
  if (analysis.blueWashRatio > WEBGPU_MAX_BLUE_WASH_RATIO) {
    throw new Error(`${label} exceeded blue wash coverage bounds: ${JSON.stringify(analysis)}`);
  }
}

function assertAnimatedPng(firstBuffer, secondBuffer, label) {
  const first = PNG.sync.read(firstBuffer);
  const second = PNG.sync.read(secondBuffer);

  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(`${label} screenshot dimensions changed from ${first.width}x${first.height} to ${second.width}x${second.height}.`);
  }

  let changedPixels = 0;
  let diffTotal = 0;
  const totalPixels = first.width * first.height;

  for (let index = 0; index < first.data.length; index += 4) {
    const diff =
      Math.abs(first.data[index] - second.data[index]) +
      Math.abs(first.data[index + 1] - second.data[index + 1]) +
      Math.abs(first.data[index + 2] - second.data[index + 2]);

    if (diff > 3) changedPixels += 1;
    diffTotal += diff / 3;
  }

  const changedRatio = changedPixels / Math.max(1, totalPixels);
  const averageDiff = diffTotal / Math.max(1, totalPixels);

  if (changedRatio <= 0.02 || averageDiff <= 1) {
    throw new Error(`${label} did not visibly animate: changedRatio=${round(changedRatio)} averageDiff=${round(averageDiff)}`);
  }
}

function assertNoDiagnosticErrors(records, allowedChannels = []) {
  const allowed = new Set(allowedChannels);
  const errors = records.filter((record) => record.entry.level === "error" && !allowed.has(record.entry.channel));
  if (errors.length > 0) {
    throw new Error(`Unexpected diagnostic errors:\n${formatRecords(errors)}`);
  }
}

function assertNoChannels(records, channels, label) {
  const forbidden = new Set(channels);
  const matches = records.filter((record) => forbidden.has(record.entry.channel));
  if (matches.length > 0) {
    throw new Error(`${label} emitted forbidden diagnostics:\n${formatRecords(matches)}`);
  }
}

function assertWebGpuSoakEvents(records) {
  const frameSamples = records.filter((record) =>
    record.entry.channel === "renderer.frameSample" &&
    record.entry.payload?.backendId === "webgpu"
  );
  if (frameSamples.length < 6) {
    throw new Error(`WebGPU soak produced too few renderer.frameSample events: ${frameSamples.length}`);
  }
  if (frameSamples.some((record) => record.entry.payload?.deviceLost !== false)) {
    throw new Error(`WebGPU soak reported device loss:\n${formatRecords(frameSamples)}`);
  }
  if (!frameSamples.some((record) =>
    hasDiagnosticCoreReadiness(record.entry.payload) &&
    record.entry.payload?.supportsBloom === true &&
    record.entry.payload?.supportsLocalLights === true &&
    record.entry.payload?.renderedLocalLights > 0 &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    record.entry.payload?.bloomPasses >= 3
  )) {
    throw new Error("WebGPU soak did not observe bloom/local-light/shadow-map renderer frame samples.");
  }

  const sceneFrames = records.filter((record) =>
    record.entry.channel === "webgpu.sceneState.frame" &&
    record.entry.payload?.scenePresentationMode === "webgpu-core-scene" &&
    hasDiagnosticCoreReadiness(record.entry.payload)
  );
  if (!sceneFrames.some((record) => record.entry.payload?.quality === "showoff")) {
    throw new Error("WebGPU soak did not observe the showoff quality switch.");
  }
  if (!sceneFrames.some((record) =>
    record.entry.payload?.voxelSizeMeters === 1.15 &&
    record.entry.payload?.waveDepth === 10 &&
    record.entry.payload?.waveSpeed > 0
  )) {
    throw new Error("WebGPU soak did not observe deep tuning readiness values after slider changes.");
  }
  const readinessFrames = records.filter((record) =>
    record.entry.channel === "webgpu.readiness.frame" &&
    hasDiagnosticCoreReadiness(record.entry.payload)
  );
  if (readinessFrames.length < 4) {
    throw new Error(`WebGPU soak produced too few readiness frames: ${readinessFrames.length}`);
  }
  if (!readinessFrames.some((record) =>
    record.entry.payload?.activeBackend === "webgpu" &&
    record.entry.payload?.stateMode === "playable" &&
    record.entry.payload?.scenePresentationMode === "webgpu-core-scene" &&
    record.entry.payload?.supportsBloom === true &&
    record.entry.payload?.supportsLocalLights === true &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number" &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe diagnostic-core readiness frame diagnostics.");
  }
  const integrationReadinessFrames = records.filter((record) =>
    record.entry.channel === "webgpu.integrationReadiness.frame" &&
    record.entry.payload?.integrationSurface === "core-render-snapshot" &&
    hasDiagnosticCoreReadiness(record.entry.payload)
  );
  if (integrationReadinessFrames.length < 2) {
    throw new Error(`WebGPU soak produced too few integration readiness frames: ${integrationReadinessFrames.length}`);
  }
  if (!integrationReadinessFrames.some((record) =>
    record.entry.payload?.activeBackend === "webgpu" &&
    record.entry.payload?.stateMode === "playable" &&
    record.entry.payload?.scenePresentationMode === "webgpu-core-scene" &&
    hasHoverPodAvatarPresentation(record.entry.payload) &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number" &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe integration readiness frame diagnostics.");
  }
  if (!records.some((record) =>
    record.entry.channel === "lighting.webgpu.frame" &&
    record.entry.payload?.renderedLocalLights > 0 &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe scene lighting frame diagnostics.");
  }
  if (!records.some((record) =>
    record.entry.channel === "shadow.webgpu.frame" &&
    record.entry.payload?.shadowMode === "shadow-map-contact" &&
    record.entry.payload?.renderedShadowCasters > 0 &&
    record.entry.payload?.shadowStrength > 0 &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe contact shadow frame diagnostics.");
  }
  if (!records.some((record) =>
    record.entry.channel === "shadow.webgpu.map.frame" &&
    hasShapeProxyShadowMap(record.entry.payload, { requireDisc: true }) &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe directional shadow-map frame diagnostics.");
  }
  if (!records.some((record) =>
    record.entry.channel === "echo.webgpu.frame" &&
    record.entry.payload?.renderedEchoes > 0 &&
    record.entry.payload?.depthMode === "field-depth-read" &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU soak did not observe active Echo visual frames.");
  }
  const bloomFrames = records.filter((record) =>
    record.entry.channel === "bloom.webgpu.frame" &&
    record.entry.payload?.deviceLost === false
  );
  if (!bloomFrames.some((record) =>
    record.entry.payload?.bloomMode === "bright-downsample-separable-blur" &&
    record.entry.payload?.bloomPasses >= 3 &&
    record.entry.payload?.bloomStrength <= 0.32
  )) {
    throw new Error("WebGPU soak did not observe bounded bloom frame diagnostics.");
  }

  for (const channel of ["arena.webgpu.frame", "avatar.webgpu.frame", "pulseLight.webgpu.frame", "echo.webgpu.frame", "particle.webgpu.frame"]) {
    const depthRecord = records.find((record) =>
      record.entry.channel === channel &&
      record.entry.payload?.depthMode === "field-depth-read" &&
      record.entry.payload?.deviceLost === false
    );
    if (!depthRecord) throw new Error(`WebGPU soak did not observe shared-depth frame diagnostics for ${channel}.`);
  }

  const wakeFrames = records.filter((record) =>
    record.entry.channel === "wake.webgpu.frame" &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number"
  );
  if (wakeFrames.length < 2) {
    throw new Error(`WebGPU soak produced too few wake metric frames: ${wakeFrames.length}`);
  }

  const maxAbsHeight = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeMaxAbsHeight ?? 0));
  const maxMeanAbsHeight = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeMeanAbsHeight ?? 0));
  const maxEnergyEstimate = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeEnergyEstimate ?? 0));
  if (
    maxAbsHeight > WEBGPU_SOAK_MAX_WAKE_ABS_HEIGHT ||
    maxMeanAbsHeight > WEBGPU_SOAK_MAX_WAKE_MEAN_ABS_HEIGHT ||
    maxEnergyEstimate > WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE
  ) {
    throw new Error(
      `WebGPU wake energy exceeded soak thresholds: ` +
      `maxAbsHeight=${round(maxAbsHeight)} ` +
      `maxMeanAbsHeight=${round(maxMeanAbsHeight)} ` +
      `maxEnergyEstimate=${round(maxEnergyEstimate)}`
    );
  }
}

function assertWebGpuReadinessEvents(records) {
  const frameSamples = records.filter((record) =>
    record.entry.channel === "renderer.frameSample" &&
    record.entry.payload?.backendId === "webgpu"
  );
  if (frameSamples.length < 8) {
    throw new Error(`WebGPU readiness run produced too few renderer.frameSample events: ${frameSamples.length}`);
  }
  if (frameSamples.some((record) => record.entry.payload?.deviceLost !== false)) {
    throw new Error(`WebGPU readiness run reported device loss:\n${formatRecords(frameSamples)}`);
  }
  if (!frameSamples.some((record) =>
    hasDiagnosticCoreReadiness(record.entry.payload) &&
    record.entry.payload?.scenePresentationMode === "webgpu-core-scene" &&
    hasHoverPodAvatarPresentation(record.entry.payload) &&
    record.entry.payload?.supportsBloom === true &&
    record.entry.payload?.supportsLocalLights === true &&
    record.entry.payload?.renderedLocalLights > 0 &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    record.entry.payload?.bloomPasses >= 3 &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number"
  )) {
    throw new Error("WebGPU readiness run did not observe renderer frame samples with readiness, bloom, lighting, and shadow-map fields.");
  }

  const integrationReadinessFrames = records.filter((record) =>
    record.entry.channel === "webgpu.integrationReadiness.frame" &&
    record.entry.payload?.integrationSurface === "core-render-snapshot" &&
    hasDiagnosticCoreReadiness(record.entry.payload)
  );
  if (integrationReadinessFrames.length < 4) {
    throw new Error(`WebGPU readiness run produced too few integration readiness frames: ${integrationReadinessFrames.length}`);
  }
  if (!integrationReadinessFrames.some((record) =>
    record.entry.payload?.activeBackend === "webgpu" &&
    record.entry.payload?.stateMode === "playable" &&
    record.entry.payload?.scenePresentationMode === "webgpu-core-scene" &&
    record.entry.payload?.quality === "showoff" &&
    record.entry.payload?.skybox === "aurora" &&
    record.entry.payload?.particlesEnabled === true &&
    record.entry.payload?.particleDensity === 0.9 &&
    record.entry.payload?.bloomEnabled === true &&
    record.entry.payload?.bloomStrength <= 0.32 &&
    record.entry.payload?.supportsBloom === true &&
    record.entry.payload?.supportsLocalLights === true &&
    record.entry.payload?.renderedLocalLights > 0 &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number" &&
    record.entry.payload?.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error("WebGPU readiness run did not observe steady integration readiness diagnostics after settings churn.");
  }

  for (const channel of [
    "shadow.webgpu.map.frame",
    "shadow.webgpu.frame",
    "lighting.webgpu.frame",
    "bloom.webgpu.frame",
    "wake.webgpu.frame",
    "ripple.webgpu.preview.frame",
    "particle.webgpu.frame",
    "echo.webgpu.frame"
  ]) {
    if (!records.some((record) => record.entry.channel === channel && record.entry.payload?.deviceLost === false)) {
      throw new Error(`WebGPU readiness run did not observe stable ${channel} diagnostics.`);
    }
  }

  const wakeFrames = records.filter((record) =>
    record.entry.channel === "wake.webgpu.frame" &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number"
  );
  if (wakeFrames.length < 3) {
    throw new Error(`WebGPU readiness run produced too few wake metric frames: ${wakeFrames.length}`);
  }
  const maxAbsHeight = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeMaxAbsHeight ?? 0));
  const maxMeanAbsHeight = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeMeanAbsHeight ?? 0));
  const maxEnergyEstimate = Math.max(...wakeFrames.map((record) => record.entry.payload.wakeEnergyEstimate ?? 0));
  if (
    maxAbsHeight > WEBGPU_SOAK_MAX_WAKE_ABS_HEIGHT ||
    maxMeanAbsHeight > WEBGPU_SOAK_MAX_WAKE_MEAN_ABS_HEIGHT ||
    maxEnergyEstimate > WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE
  ) {
    throw new Error(
      `WebGPU readiness wake energy exceeded thresholds: ` +
      `maxAbsHeight=${round(maxAbsHeight)} ` +
      `maxMeanAbsHeight=${round(maxMeanAbsHeight)} ` +
      `maxEnergyEstimate=${round(maxEnergyEstimate)}`
    );
  }

  const bloomFrames = records.filter((record) =>
    record.entry.channel === "bloom.webgpu.frame" &&
    record.entry.payload?.deviceLost === false
  );
  if (!bloomFrames.some((record) =>
    record.entry.payload?.bloomMode === "bright-downsample-separable-blur" &&
    record.entry.payload?.bloomPasses >= 3 &&
    record.entry.payload?.bloomStrength <= 0.32
  )) {
    throw new Error("WebGPU readiness run did not observe bounded bloom frame diagnostics.");
  }
}

function assertWebGpuDefaultSoakEvents(records) {
  const defaultFrames = records.filter((record) =>
    record.entry.channel === "webgpu.defaultReadiness.frame" &&
    hasDefaultReadinessPayload(record.entry.payload)
  );
  if (defaultFrames.length < 8) {
    throw new Error(`WebGPU default soak produced too few default-readiness frames: ${defaultFrames.length}`);
  }
  if (defaultFrames.some((record) => record.entry.payload?.deviceLost !== false)) {
    throw new Error(`WebGPU default soak reported device loss:\n${formatRecords(defaultFrames)}`);
  }
  if (!defaultFrames.some((record) =>
    record.entry.payload?.quality === "showoff" &&
    record.entry.payload?.skybox === "aurora" &&
    record.entry.payload?.particlesEnabled === true &&
    record.entry.payload?.particleDensity === 0.9 &&
    record.entry.payload?.bloomEnabled === true &&
    record.entry.payload?.bloomStrength <= 0.32 &&
    record.entry.payload?.supportsBloom === true &&
    record.entry.payload?.supportsLocalLights === true &&
    record.entry.payload?.renderedLocalLights > 0 &&
    hasShapeProxyShadowMap(record.entry.payload) &&
    typeof record.entry.payload?.wakeEnergyEstimate === "number" &&
    record.entry.payload?.wakeEnergyEstimate <= WEBGPU_SOAK_MAX_WAKE_ENERGY_ESTIMATE
  )) {
    throw new Error("WebGPU default soak did not observe stable default-readiness settings/bounds after churn.");
  }
  const summaries = records.filter((record) =>
    record.entry.channel === "webgpu.defaultReadiness.summary" &&
    hasDefaultReadinessPayload(record.entry.payload)
  );
  if (summaries.length < 1) {
    throw new Error("WebGPU default soak did not emit a default-readiness summary.");
  }
  if (!summaries.some((record) =>
    record.entry.payload?.stabilityWindowSeconds >= WEBGPU_DEFAULT_READINESS_SUMMARY_SECONDS &&
    record.entry.payload?.defaultEligible === false &&
    record.entry.payload?.defaultRolloutSoakGapClosed === true &&
    Array.isArray(record.entry.payload?.remainingGaps) &&
    record.entry.payload.remainingGaps.length === 0 &&
    !record.entry.payload.remainingGaps.includes("default-rollout-soak") &&
    record.entry.payload?.deviceLost === false
  )) {
    throw new Error(`WebGPU default soak summary did not report the expected closed gap state:\n${formatRecords(summaries)}`);
  }
}

function formatRecords(records) {
  return records
    .slice(0, 8)
    .map((record) => `${record.entry.level}:${record.entry.channel} ${JSON.stringify(record.entry.payload ?? {})}`)
    .join("\n");
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

function createSmokeRun(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readDurationEnv(name, fallbackMs, minimumMs) {
  const value = Number.parseInt(process.env[name] ?? `${fallbackMs}`, 10);
  if (!Number.isFinite(value)) return fallbackMs;
  return Math.max(minimumMs, value);
}

function getSmokeRun(href) {
  if (typeof href !== "string" || href.length === 0) return "";

  try {
    return new URL(href).searchParams.get("smokeRun") ?? "";
  } catch {
    return "";
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
