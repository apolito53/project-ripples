import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { PlayerRig } from "./controls";
import { cloneDefaultSettings, getQualityPreset } from "./labSettings";
import { ParticleVeil } from "./particleVeil";
import { PulseLightRig } from "./pulseLights";
import { ARENA_RADIUS, isQualityId, type QualityPreset } from "./qualityPresets";
import { RippleField } from "./rippleField";
import { RippleSourceStore, type RippleSourceOptions } from "./rippleSources";
import "./styles.css";
import { sampleFieldHeight } from "./terrain";
import { getBasePropagationSpeedMetersPerSecond } from "./waveMedium";

const app = requireElement<HTMLElement>("#app");
const statsLine = requireElement<HTMLElement>("#stats-line");
const mediumLine = requireElement<HTMLElement>("#medium-line");
const qualityBadge = requireElement<HTMLElement>("#quality-badge");
const qualitySelect = requireElement<HTMLSelectElement>("#quality-select");
const heightSlider = requireElement<HTMLInputElement>("#height-slider");
const radiusSlider = requireElement<HTMLInputElement>("#radius-slider");
const depthSlider = requireElement<HTMLInputElement>("#depth-slider");
const depthSpeedValue = requireElement<HTMLOutputElement>("#depth-speed-value");
const particleSlider = requireElement<HTMLInputElement>("#particle-slider");
const bloomSlider = requireElement<HTMLInputElement>("#bloom-slider");
const menuToggle = requireElement<HTMLButtonElement>("#menu-toggle");
const mobileControls = requireElement<HTMLDivElement>("#mobile-controls");
const pulseButton = requireElement<HTMLButtonElement>("#pulse-button");
const PLAYER_BOUNDARY_PADDING = 1.1;
const MOVEMENT_RIPPLE_MIN_SPEED = 2.2;
const MOVEMENT_RIPPLE_MIN_DISTANCE = 0.9;
const MOVEMENT_RIPPLE_INTERVAL_SECONDS = 0.22;
const MOVEMENT_RIPPLE_MIN_STRENGTH = 0.05;
const MOVEMENT_RIPPLE_MAX_STRENGTH = 0.12;
const MOVEMENT_RIPPLE_STERN_OFFSET = 0.9;
const MOVEMENT_RIPPLE_SHOULDER_OFFSET = 1.15;
const MOVEMENT_RIPPLE_SHOULDER_BACKSET = 1.95;
const MANUAL_PULSE_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 1,
  widthMultiplier: 1,
  dampingMultiplier: 0.92
};
const AMBIENT_PULSE_OPTIONS: RippleSourceOptions = {
  kind: "pulse",
  speedMultiplier: 0.72,
  widthMultiplier: 1.35,
  dampingMultiplier: 1.18
};

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.setClearColor(0x020409, 1);
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020409);
const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 450);
const clock = new THREE.Clock();
const settings = cloneDefaultSettings();
let preset = getQualityPreset(settings);
let frameCount = 0;
let fpsAccumulatorSeconds = 0;
let measuredFps = 60;
let nextAmbientPulseAt = 0.8;
let lastMovementRippleAt = -Infinity;
let movementWakeSide = 1;
const lastMovementRipplePosition = new THREE.Vector3(Infinity, 0, Infinity);
const movementDirection = new THREE.Vector3();
const movementShoulder = new THREE.Vector3();
const movementPerpendicular = new THREE.Vector3();
const mobileQuery = window.matchMedia("(pointer: coarse), (hover: none)");
const activeTouchSticks = new Map<number, TouchStickState>();
let menuVisible = true;

type TouchStickKind = "move" | "look";

type TouchStickState = {
  readonly element: HTMLElement;
  readonly knob: HTMLElement;
  readonly kind: TouchStickKind;
  readonly originX: number;
  readonly originY: number;
  lastX: number;
  lastY: number;
};

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.bloomStrength, 0.3, 0.95);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const rippleSources = new RippleSourceStore();
const rippleField = new RippleField(scene, preset);
let particles = new ParticleVeil(scene, preset.particleBudget, getPixelRatio());
let pulseLights = new PulseLightRig(scene, preset.pulseLightCount);

const avatar = createAvatar();
scene.add(avatar.object);

const player = new PlayerRig({
  canvas: renderer.domElement,
  camera,
  sampleHeight: sampleFieldHeight,
  getBoundaryRadius: () => Math.max(0, preset.fieldRadius - PLAYER_BOUNDARY_PADDING),
  onPulse: (position) => spawnPulse(position, 0.45)
});

createLighting();
createStageFloor();
wireControls();
updateDepthSpeedValue();
applyQualityPreset(preset, true);
resize();
window.addEventListener("resize", resize);

// Seed a few pulses so the first rendered second already has motion and bloom.
spawnPulse(new THREE.Vector3(0, sampleFieldHeight(0, 0) + 0.45, 0), 0.28);
spawnPulse(new THREE.Vector3(9, sampleFieldHeight(9, -7) + 0.45, -7), 0.18);

renderer.setAnimationLoop(animate);

function animate(): void {
  const delta = Math.min(clock.getDelta(), 1 / 24);
  const time = clock.elapsedTime;
  player.update(delta);
  const playerSpeed = player.getSpeed();
  avatar.update(delta, player.position, playerSpeed);
  particles.spawnAura(player.position, delta, playerSpeed / 18);
  particles.spawnWake(player.position, playerSpeed / 18);
  maybeSpawnMovementRipple(time, playerSpeed);
  maybeSpawnAmbientPulse(time);
  particles.update(delta);
  rippleField.update(time, settings, preset, rippleSources, player.position, player.velocity, playerSpeed);
  pulseLights.update(
    rippleSources.getActiveLightSources(time),
    time,
    0.28 + settings.bloomStrength * 0.42,
    getBasePropagationSpeedMetersPerSecond(settings.waveMedium)
  );
  updateStats(delta, time);

  bloomPass.strength = settings.bloomStrength;
  if (settings.bloomStrength > 0.02) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function spawnPulse(
  position: THREE.Vector3,
  strength: number,
  options = MANUAL_PULSE_OPTIONS,
  startTime = clock.elapsedTime
): void {
  rippleSources.add(position, startTime, strength, options);

  // Particle density is intentionally decoupled from pulse brightness. A pulse
  // should read as a little cloud of tiny glitter motes, not as one bright blob.
  spawnPulseParticles(position, strength);
}

function spawnPulseParticles(position: THREE.Vector3, strength: number): void {
  const count = Math.max(0, Math.floor(
    preset.burstParticleCount * settings.particleDensity * (0.42 + strength * 1.7)
  ));
  particles.spawnBurst(position, count, strength);
}

function maybeSpawnMovementRipple(time: number, playerSpeed: number): void {
  if (playerSpeed < MOVEMENT_RIPPLE_MIN_SPEED) return;
  if (time - lastMovementRippleAt < MOVEMENT_RIPPLE_INTERVAL_SECONDS) return;

  const distanceFromLastWake = Math.hypot(
    player.position.x - lastMovementRipplePosition.x,
    player.position.z - lastMovementRipplePosition.z
  );
  if (distanceFromLastWake < MOVEMENT_RIPPLE_MIN_DISTANCE) return;

  const movementRatio = THREE.MathUtils.clamp(playerSpeed / 18, 0, 1);
  const strength = THREE.MathUtils.lerp(
    MOVEMENT_RIPPLE_MIN_STRENGTH,
    MOVEMENT_RIPPLE_MAX_STRENGTH,
    movementRatio
  );

  movementDirection.copy(player.velocity).setY(0).normalize();
  movementPerpendicular.set(-movementDirection.z, 0, movementDirection.x);

  // A moving body in water leaves more than one perfect circle. We drop a stern
  // source directly behind the avatar, plus an alternating shoulder source that
  // builds a soft V wake without doubling both sides every frame.
  const stern = player.position.clone().addScaledVector(
    movementDirection,
    -MOVEMENT_RIPPLE_STERN_OFFSET
  );
  addMovementWakeSource(stern, time, strength);

  movementShoulder.copy(player.position)
    .addScaledVector(movementDirection, -MOVEMENT_RIPPLE_SHOULDER_BACKSET)
    .addScaledVector(movementPerpendicular, MOVEMENT_RIPPLE_SHOULDER_OFFSET * movementWakeSide);
  addMovementWakeSource(movementShoulder, time, strength * 0.72);
  movementWakeSide *= -1;

  lastMovementRippleAt = time;
  lastMovementRipplePosition.copy(player.position);
}

function addMovementWakeSource(position: THREE.Vector3, time: number, strength: number): void {
  position.y = sampleFieldHeight(position.x, position.z) + 0.4;

  // Movement wakes feed the terrain shader only. No burst particles, no point
  // lights: just lingering displacement, like water remembering the body that
  // passed through it. These sources intentionally do not carry direction now:
  // once a wake is stamped into the field, it should stay put instead of aiming
  // around like a flashlight beam as the player changes direction.
  rippleSources.add(position, time, strength, {
    kind: "wake",
    speedMultiplier: settings.waveMedium.wakeSpeedMultiplier,
    widthMultiplier: 1.45,
    dampingMultiplier: 0.72
  });
}

function maybeSpawnAmbientPulse(time: number): void {
  if (time < nextAmbientPulseAt) return;

  const angle = Math.random() * Math.PI * 2;
  const radius = 8 + Math.random() * preset.fieldRadius * 0.62;
  const position = new THREE.Vector3(
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius
  );
  position.y = sampleFieldHeight(position.x, position.z) + 0.45;
  spawnPulse(position, 0.1 + Math.random() * 0.16, AMBIENT_PULSE_OPTIONS, time);
  nextAmbientPulseAt = time + 1.6 + Math.random() * 2.2;
}

function wireControls(): void {
  menuToggle.addEventListener("click", () => {
    setMenuVisible(!menuVisible);
  });

  mobileQuery.addEventListener("change", updateMobileControlsVisibility);
  updateMobileControlsVisibility();
  wireMobileControls();

  pulseButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    player.triggerPulse();
  });

  qualitySelect.addEventListener("change", () => {
    if (!isQualityId(qualitySelect.value)) return;
    settings.qualityId = qualitySelect.value;
    preset = getQualityPreset(settings);
    settings.bloomStrength = preset.bloomStrength;
    bloomSlider.value = String(settings.bloomStrength);
    applyQualityPreset(preset, false);
  });

  heightSlider.addEventListener("input", () => {
    settings.rippleHeight = Number(heightSlider.value);
  });
  radiusSlider.addEventListener("input", () => {
    settings.rippleRadius = Number(radiusSlider.value);
  });
  depthSlider.addEventListener("input", () => {
    settings.waveMedium.effectiveDepth = Number(depthSlider.value);
    updateDepthSpeedValue();
  });
  particleSlider.addEventListener("input", () => {
    settings.particleDensity = Number(particleSlider.value);
  });
  bloomSlider.addEventListener("input", () => {
    settings.bloomStrength = THREE.MathUtils.clamp(Number(bloomSlider.value), 0, 0.38);
  });
}

function setMenuVisible(visible: boolean): void {
  menuVisible = visible;
  document.body.classList.toggle("menu-hidden", !visible);
  menuToggle.setAttribute("aria-expanded", String(visible));
  menuToggle.setAttribute("aria-label", visible ? "Hide menu" : "Show menu");
}

function updateMobileControlsVisibility(): void {
  mobileControls.hidden = !mobileQuery.matches;
}

function wireMobileControls(): void {
  for (const stick of mobileControls.querySelectorAll<HTMLElement>(".touch-stick")) {
    const knob = requireChild<HTMLElement>(stick, ".touch-stick__knob");
    const kind = stick.dataset.stick === "look" ? "look" : "move";
    stick.addEventListener("pointerdown", (event) => beginTouchStick(event, stick, knob, kind));
    stick.addEventListener("pointermove", updateTouchStick);
    stick.addEventListener("pointerup", endTouchStick);
    stick.addEventListener("pointercancel", endTouchStick);
  }
}

function beginTouchStick(event: PointerEvent, element: HTMLElement, knob: HTMLElement, kind: TouchStickKind): void {
  event.preventDefault();
  element.setPointerCapture(event.pointerId);
  const rect = element.getBoundingClientRect();
  const state: TouchStickState = {
    element,
    knob,
    kind,
    originX: rect.left + rect.width / 2,
    originY: rect.top + rect.height / 2,
    lastX: event.clientX,
    lastY: event.clientY
  };
  activeTouchSticks.set(event.pointerId, state);
  applyTouchStick(state, event.clientX, event.clientY);
}

function updateTouchStick(event: PointerEvent): void {
  const state = activeTouchSticks.get(event.pointerId);
  if (!state) return;
  event.preventDefault();
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  applyTouchStick(state, event.clientX, event.clientY);
}

function endTouchStick(event: PointerEvent): void {
  const state = activeTouchSticks.get(event.pointerId);
  if (!state) return;
  activeTouchSticks.delete(event.pointerId);
  state.knob.style.transform = "translate3d(-50%, -50%, 0)";
  if (state.kind === "move") player.setMobileMoveIntent(0, 0);
  if (state.kind === "look") player.setMobileLookIntent(0, 0);
}

function applyTouchStick(state: TouchStickState, clientX: number, clientY: number): void {
  const maxDistance = state.element.clientWidth * 0.32;
  const rawX = clientX - state.originX;
  const rawY = clientY - state.originY;
  const distance = Math.min(maxDistance, Math.hypot(rawX, rawY));
  const angle = Math.atan2(rawY, rawX);
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  state.knob.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0)`;
  if (state.kind === "move") player.setMobileMoveIntent(x / maxDistance, -y / maxDistance);
  if (state.kind === "look") player.setMobileLookIntent(x / maxDistance, y / maxDistance);
}

function requireChild<T extends HTMLElement>(parent: HTMLElement, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required child: ${selector}`);
  return element;
}

function updateDepthSpeedValue(): void {
  // The slider controls effective depth, but the user-facing consequence is
  // propagation speed. Show the derived value right where the tuning happens.
  depthSpeedValue.textContent = `${getBasePropagationSpeedMetersPerSecond(settings.waveMedium).toFixed(1)} m/s`;
}

function applyQualityPreset(nextPreset: QualityPreset, initial: boolean): void {
  qualityBadge.textContent = nextPreset.label;
  renderer.shadowMap.enabled = nextPreset.shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.FogExp2(0x020815, nextPreset.fogDensity);
  bloomPass.strength = settings.bloomStrength;

  if (!initial) {
    rippleField.rebuild(nextPreset);
    particles = particles.resizeBudget(scene, nextPreset.particleBudget, getPixelRatio());
    pulseLights = pulseLights.resize(scene, nextPreset.pulseLightCount);
  }

  updateShadowResolution(nextPreset.shadowMapSize);
  resize();
}

function updateShadowResolution(size: number): void {
  const shadowBounds = ARENA_RADIUS + 8;
  for (const child of scene.children) {
    if (!(child instanceof THREE.DirectionalLight)) continue;
    child.castShadow = size > 0;
    child.shadow.mapSize.set(Math.max(1, size), Math.max(1, size));
    child.shadow.camera.near = 1;
    child.shadow.camera.far = 180;
    child.shadow.camera.left = -shadowBounds;
    child.shadow.camera.right = shadowBounds;
    child.shadow.camera.top = shadowBounds;
    child.shadow.camera.bottom = -shadowBounds;
    child.shadow.needsUpdate = true;
  }
}

function createLighting(): void {
  const ambient = new THREE.HemisphereLight(0x87ccff, 0x06111a, 0.82);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xbcecff, 2.2);
  key.name = "Soft cyan key light";
  key.position.set(-24, 38, 18);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xff7de7, 1.1);
  rim.name = "Magenta rim light";
  rim.position.set(30, 18, -24);
  scene.add(rim);
}

function createStageFloor(): void {
  const geometry = new THREE.CircleGeometry(ARENA_RADIUS, 192);
  const material = new THREE.MeshStandardMaterial({
    color: 0x06101b,
    metalness: 0.38,
    roughness: 0.48,
    emissive: 0x02070d,
    emissiveIntensity: 0.65
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.name = "Dark reflective stage floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.2;
  floor.receiveShadow = true;
  scene.add(floor);
}

function createAvatar(): {
  readonly object: THREE.Group;
  update(delta: number, position: THREE.Vector3, movementSpeed: number): void;
} {
  const object = new THREE.Group();
  object.name = "Player glow avatar";

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 2),
    new THREE.MeshStandardMaterial({
      color: 0x39ffd7,
      emissive: 0x0c8f88,
      emissiveIntensity: 1.05,
      metalness: 0.18,
      roughness: 0.28
    })
  );
  core.castShadow = true;
  object.add(core);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.54, 1),
    new THREE.MeshPhysicalMaterial({
      color: 0x7dffd8,
      emissive: 0x0b4c57,
      emissiveIntensity: 0.38,
      metalness: 0.06,
      roughness: 0.16,
      transparent: true,
      opacity: 0.26,
      depthWrite: false
    })
  );
  shell.name = "Player readable glass shell";
  object.add(shell);

  const equatorRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.012, 10, 96),
    new THREE.MeshBasicMaterial({
      color: 0x7dffd8,
      transparent: true,
      opacity: 0.54,
      blending: THREE.AdditiveBlending
    })
  );
  equatorRing.name = "Player equator ring";
  equatorRing.rotation.x = Math.PI / 2;
  object.add(equatorRing);

  const tiltedRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.64, 0.01, 10, 96),
    new THREE.MeshBasicMaterial({
      color: 0x8ea2ff,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending
    })
  );
  tiltedRing.name = "Player tilted ring";
  tiltedRing.rotation.set(Math.PI / 2.8, 0, Math.PI / 5);
  object.add(tiltedRing);

  const coreLight = new THREE.PointLight(0x8fffe0, 4.4, 19, 1.65);
  coreLight.name = "Player bright local cube light";
  coreLight.position.y = 0.35;
  object.add(coreLight);

  const floorLight = new THREE.PointLight(0x55cfff, 2.1, 14, 1.45);
  floorLight.name = "Player low cyan block fill";
  floorLight.position.y = -1.05;
  object.add(floorLight);

  return {
    object,
    update(delta, position, movementSpeed) {
      object.position.copy(position);
      core.rotation.x += delta * 1.3;
      core.rotation.y += delta * 1.9;
      shell.rotation.x -= delta * 0.55;
      shell.rotation.y += delta * 0.7;
      equatorRing.rotation.z += delta * 1.6;
      tiltedRing.rotation.z -= delta * 1.15;
      const breathingGlow = Math.sin(clock.elapsedTime * 4) * 0.5 + 0.5;
      const movementGlow = THREE.MathUtils.clamp(movementSpeed / 18, 0, 1);

      // The player should now behave like an actual local light source for the
      // cube field. Keep shadows off for this moving light pair; point-light
      // shadows would be expensive with tens of thousands of instanced cubes.
      coreLight.intensity = 3.8 + breathingGlow * 0.9 + movementGlow * 1.4;
      coreLight.distance = 17 + movementGlow * 5;
      floorLight.intensity = 1.65 + breathingGlow * 0.42 + movementGlow * 0.9;
      floorLight.distance = 12 + movementGlow * 4;
    }
  };
}

function updateStats(delta: number, time: number): void {
  frameCount += 1;
  fpsAccumulatorSeconds += delta;
  if (fpsAccumulatorSeconds < 0.35) return;

  const basePropagationSpeed = getBasePropagationSpeedMetersPerSecond(settings.waveMedium);
  const activeSources = rippleSources.getActiveSources(time);
  const newestSource = activeSources[0];
  const rawNewestStartTime = newestSource?.startTime;
  const rawNewestSpeedMultiplier = newestSource?.speedMultiplier;
  const newestStartTime = typeof rawNewestStartTime === "number" && Number.isFinite(rawNewestStartTime)
    ? rawNewestStartTime
    : time;
  const newestSpeedMultiplier =
    typeof rawNewestSpeedMultiplier === "number" && Number.isFinite(rawNewestSpeedMultiplier)
      ? rawNewestSpeedMultiplier
      : 1;
  const newestRingRadius = newestSource
    ? Math.max(0, time - newestStartTime) * basePropagationSpeed * newestSpeedMultiplier
    : 0;

  measuredFps = frameCount / fpsAccumulatorSeconds;
  frameCount = 0;
  fpsAccumulatorSeconds = 0;
  statsLine.textContent = `${Math.round(measuredFps)} fps | ${rippleField.getInstanceCount().toLocaleString()} cubes | ${preset.particleBudget.toLocaleString()} particles`;
  mediumLine.textContent = `${basePropagationSpeed.toFixed(1)} m/s | ${settings.waveMedium.effectiveDepth.toFixed(1)}m depth | ${activeSources.length} sources | newest ${newestRingRadius.toFixed(1)}m`;
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = getPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
  particles.setPixelRatio(pixelRatio);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function getPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, settings.qualityId === "meltdown" ? 2.5 : 2);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
