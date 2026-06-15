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
import { RippleSourceStore } from "./rippleSources";
import "./styles.css";
import { sampleFieldHeight } from "./terrain";

const app = requireElement<HTMLElement>("#app");
const statsLine = requireElement<HTMLElement>("#stats-line");
const qualityBadge = requireElement<HTMLElement>("#quality-badge");
const qualitySelect = requireElement<HTMLSelectElement>("#quality-select");
const heightSlider = requireElement<HTMLInputElement>("#height-slider");
const radiusSlider = requireElement<HTMLInputElement>("#radius-slider");
const speedSlider = requireElement<HTMLInputElement>("#speed-slider");
const particleSlider = requireElement<HTMLInputElement>("#particle-slider");
const bloomSlider = requireElement<HTMLInputElement>("#bloom-slider");
const PLAYER_BOUNDARY_PADDING = 1.1;
const MOVEMENT_RIPPLE_MIN_SPEED = 2.2;
const MOVEMENT_RIPPLE_MIN_DISTANCE = 0.9;
const MOVEMENT_RIPPLE_INTERVAL_SECONDS = 0.22;
const MOVEMENT_RIPPLE_MIN_STRENGTH = 0.05;
const MOVEMENT_RIPPLE_MAX_STRENGTH = 0.12;
const MOVEMENT_RIPPLE_STERN_OFFSET = 0.9;
const MOVEMENT_RIPPLE_SHOULDER_OFFSET = 1.15;
const MOVEMENT_RIPPLE_SHOULDER_BACKSET = 1.95;

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
  avatar.update(delta, player.position);

  const playerSpeed = player.getSpeed();
  particles.spawnAura(player.position, delta, playerSpeed / 18);
  particles.spawnWake(player.position, playerSpeed / 18);
  maybeSpawnMovementRipple(time, playerSpeed);
  maybeSpawnAmbientPulse(time);
  particles.update(delta);
  rippleField.update(time, settings, preset, rippleSources, player.position, player.velocity, playerSpeed);
  pulseLights.update(rippleSources.getActiveLightSources(time), time, 0.28 + settings.bloomStrength * 0.42);
  updateStats(delta);

  bloomPass.strength = settings.bloomStrength;
  if (settings.bloomStrength > 0.02) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function spawnPulse(position: THREE.Vector3, strength: number): void {
  rippleSources.add(position, clock.elapsedTime, strength);
  // Particle density is intentionally decoupled from pulse brightness. A pulse
  // should read as a little cloud of tiny glitter motes, not as one bright blob.
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
  // passed through it.
  rippleSources.add(position, time, strength, "wake");
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
  spawnPulse(position, 0.1 + Math.random() * 0.16);
  nextAmbientPulseAt = time + 1.6 + Math.random() * 2.2;
}

function wireControls(): void {
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
  speedSlider.addEventListener("input", () => {
    settings.waveSpeed = Number(speedSlider.value);
  });
  particleSlider.addEventListener("input", () => {
    settings.particleDensity = Number(particleSlider.value);
  });
  bloomSlider.addEventListener("input", () => {
    settings.bloomStrength = THREE.MathUtils.clamp(Number(bloomSlider.value), 0, 0.38);
  });
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

function createAvatar(): { readonly object: THREE.Group; update(delta: number, position: THREE.Vector3): void } {
  const object = new THREE.Group();
  object.name = "Player glow avatar";

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 2),
    new THREE.MeshStandardMaterial({
      color: 0x39ffd7,
      emissive: 0x0c8f88,
      emissiveIntensity: 0.75,
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
      emissiveIntensity: 0.28,
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

  const light = new THREE.PointLight(0x7dffd8, 1.7, 8, 2.4);
  light.name = "Player restrained glow light";
  object.add(light);

  return {
    object,
    update(delta, position) {
      object.position.copy(position);
      core.rotation.x += delta * 1.3;
      core.rotation.y += delta * 1.9;
      shell.rotation.x -= delta * 0.55;
      shell.rotation.y += delta * 0.7;
      equatorRing.rotation.z += delta * 1.6;
      tiltedRing.rotation.z -= delta * 1.15;
      light.intensity = 1.25 + Math.sin(clock.elapsedTime * 4) * 0.25;
    }
  };
}

function updateStats(delta: number): void {
  frameCount += 1;
  fpsAccumulatorSeconds += delta;
  if (fpsAccumulatorSeconds < 0.35) return;

  measuredFps = frameCount / fpsAccumulatorSeconds;
  frameCount = 0;
  fpsAccumulatorSeconds = 0;
  statsLine.textContent = `${Math.round(measuredFps)} fps | ${rippleField.getInstanceCount().toLocaleString()} cubes | ${preset.particleBudget.toLocaleString()} particles`;
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
