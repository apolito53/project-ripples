import {
  GAMEPAD_SENSITIVITY_LIMITS,
  SURFACE_GRIP_LIMITS,
  normalizePlayerSpeedSettings
} from "../controls";
import { debugEvent, roundMetric } from "../debugLog";
import { isFieldPaletteId } from "../fieldPalette";
import { cloneDefaultSettings, type LabSettings } from "../labSettings";
import {
  ARENA_RADIUS_MAX_METERS,
  ARENA_RADIUS_MIN_METERS,
  VOXEL_SIZE_MAX_METERS,
  VOXEL_SIZE_MIN_METERS,
  isQualityId
} from "../qualityPresets";
import { isSkyboxId } from "../skybox";
import type { RendererBackendId } from "./types";

export type RendererTransitionPlayMode = "arena" | "track" | "training";

export type RendererTransitionHandoff = {
  readonly version: 1;
  readonly transitionId: string;
  readonly sourceBackend: RendererBackendId;
  readonly targetBackend: RendererBackendId;
  readonly playMode: RendererTransitionPlayMode;
  readonly restorePaused: true;
  readonly perfOverlayVisible: boolean;
  readonly settings: LabSettings;
  readonly requestedAtMs: number;
};

export type RendererSwitchOptions = {
  readonly activeBackend: RendererBackendId;
  readonly getPlayMode: () => RendererTransitionPlayMode | null;
  readonly getSettings: () => LabSettings;
  readonly getPerfOverlayVisible: () => boolean;
  readonly signal?: AbortSignal;
};

const RENDERER_TRANSITION_STORAGE_KEY = "rippleRendererTransition.v1";
const RENDERER_TRANSITION_QUERY_KEY = "rendererTransition";
const RENDERER_TRANSITION_MAX_AGE_MS = 2 * 60 * 1000;
const RENDERER_TRANSITION_NAVIGATION_DELAY_MS = 80;

/**
 * Consumes a one-shot handoff only when its URL marker, target backend, and age
 * all match. The marker is removed immediately so a later refresh is ordinary.
 */
export function consumeRendererTransition(
  activeBackend: RendererBackendId,
  location: Location = window.location,
  history: History = window.history,
  storage: Storage | null = getSessionStorage()
): RendererTransitionHandoff | null {
  const transitionId = new URLSearchParams(location.search).get(RENDERER_TRANSITION_QUERY_KEY);
  if (!transitionId) return null;

  removeTransitionMarker(location, history);
  const rawHandoff = readAndRemoveHandoff(storage);
  if (!rawHandoff) return null;

  try {
    const parsed = JSON.parse(rawHandoff) as unknown;
    return normalizeHandoff(parsed, transitionId, activeBackend);
  } catch {
    return null;
  }
}

/**
 * Applies the validated, deeply cloned settings snapshot before either renderer
 * allocates quality-sized resources.
 */
export function applyRendererTransitionSettings(
  target: LabSettings,
  handoff: RendererTransitionHandoff | null
): void {
  if (!handoff) return;
  const source = handoff.settings;
  Object.assign(target, source, {
    playerSpeed: { ...source.playerSpeed },
    gamepadSensitivity: { ...source.gamepadSensitivity },
    waveMedium: { ...source.waveMedium }
  });
}

/**
 * Wires the shared pause-menu renderer selector. A backend switch deliberately
 * reloads the document because WebGL and WebGPU own incompatible canvas and GPU
 * resource lifecycles.
 */
export function wireRendererSwitch(options: RendererSwitchOptions): void {
  const root = requireElement<HTMLElement>("#renderer-switch");
  const webGlButton = requireElement<HTMLButtonElement>("[data-renderer-target='webgl']", root);
  const webGpuButton = requireElement<HTMLButtonElement>("[data-renderer-target='webgpu']", root);
  const buttons = [webGlButton, webGpuButton] as const;
  const webGpuAvailable = Boolean(navigator.gpu);

  root.dataset.activeBackend = options.activeBackend;
  for (const button of buttons) {
    const target = readButtonTarget(button);
    const active = target === options.activeBackend;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
    button.classList.toggle("renderer-switch__option--active", active);
  }

  if (!webGpuAvailable && options.activeBackend !== "webgpu") {
    webGpuButton.disabled = true;
    webGpuButton.title = "WebGPU is unavailable in this browser.";
  }

  const requestSwitch = (event: Event): void => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    const targetBackend = readButtonTarget(button);
    if (targetBackend === options.activeBackend || button.disabled) return;

    const playMode = options.getPlayMode();
    if (!playMode) return;

    const transitionId = createTransitionId();
    const handoff: RendererTransitionHandoff = {
      version: 1,
      transitionId,
      sourceBackend: options.activeBackend,
      targetBackend,
      playMode,
      restorePaused: true,
      perfOverlayVisible: options.getPerfOverlayVisible(),
      settings: cloneSettings(options.getSettings()),
      requestedAtMs: Date.now()
    };
    const handoffStored = writeHandoff(handoff);
    const targetUrl = createTransitionUrl(window.location, transitionId, targetBackend, playMode);

    root.setAttribute("aria-busy", "true");
    root.dataset.pendingBackend = targetBackend;
    for (const option of buttons) option.disabled = true;

    debugEvent("renderer.transition.request", "Requested renderer backend transition", {
      transitionId,
      sourceBackend: options.activeBackend,
      targetBackend,
      playMode,
      restorePaused: true,
      handoffStored,
      quality: handoff.settings.qualityId,
      skybox: handoff.settings.skyboxId,
      fieldPalette: handoff.settings.fieldPaletteId,
      particlesEnabled: handoff.settings.particlesEnabled,
      bloomEnabled: handoff.settings.bloomEnabled,
      perfOverlayVisible: handoff.perfOverlayVisible
    }, "info");

    // Give the local diagnostic queue one short keepalive-friendly window
    // before ownership moves to the newly loaded backend.
    window.__rippleDebugFlush?.();
    window.setTimeout(() => window.location.assign(targetUrl), RENDERER_TRANSITION_NAVIGATION_DELAY_MS);
  };

  webGlButton.addEventListener("click", requestSwitch, { signal: options.signal });
  webGpuButton.addEventListener("click", requestSwitch, { signal: options.signal });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.key === "ArrowLeft" ? webGlButton : webGpuButton;
    if (target.disabled || target.getAttribute("aria-checked") === "true") return;
    event.preventDefault();
    target.click();
  }, { signal: options.signal });
}

export function reportRendererTransitionRestored(
  handoff: RendererTransitionHandoff | null,
  activeBackend: RendererBackendId
): void {
  if (!handoff) return;
  debugEvent("renderer.transition.restore", "Restored renderer-neutral session after backend transition", {
    transitionId: handoff.transitionId,
    sourceBackend: handoff.sourceBackend,
    targetBackend: handoff.targetBackend,
    activeBackend,
    playMode: handoff.playMode,
    paused: handoff.restorePaused,
    ageMs: roundMetric(Math.max(0, Date.now() - handoff.requestedAtMs)),
    quality: handoff.settings.qualityId,
    skybox: handoff.settings.skyboxId,
    fieldPalette: handoff.settings.fieldPaletteId,
    particlesEnabled: handoff.settings.particlesEnabled,
    particleDensity: roundMetric(handoff.settings.particleDensity),
    bloomEnabled: handoff.settings.bloomEnabled,
    bloomStrength: roundMetric(handoff.settings.bloomStrength),
    perfOverlayVisible: handoff.perfOverlayVisible
  }, "info");
}

function normalizeHandoff(
  value: unknown,
  transitionId: string,
  activeBackend: RendererBackendId
): RendererTransitionHandoff | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.transitionId !== transitionId) return null;
  if (!isRendererBackendId(value.sourceBackend) || value.sourceBackend === activeBackend) return null;
  if (value.targetBackend !== activeBackend) return null;
  if (!isPlayMode(value.playMode) || value.restorePaused !== true) return null;
  if (typeof value.requestedAtMs !== "number" || !Number.isFinite(value.requestedAtMs)) return null;
  const ageMs = Date.now() - value.requestedAtMs;
  if (ageMs < 0 || ageMs > RENDERER_TRANSITION_MAX_AGE_MS) return null;

  return {
    version: 1,
    transitionId,
    sourceBackend: value.sourceBackend,
    targetBackend: activeBackend,
    playMode: value.playMode,
    restorePaused: true,
    perfOverlayVisible: value.perfOverlayVisible === true,
    settings: normalizeSettings(value.settings),
    requestedAtMs: value.requestedAtMs
  };
}

function normalizeSettings(value: unknown): LabSettings {
  const settings = cloneDefaultSettings();
  if (!isRecord(value)) return settings;

  if (typeof value.qualityId === "string" && isQualityId(value.qualityId)) settings.qualityId = value.qualityId;
  if (typeof value.skyboxId === "string" && isSkyboxId(value.skyboxId)) settings.skyboxId = value.skyboxId;
  if (typeof value.fieldPaletteId === "string" && isFieldPaletteId(value.fieldPaletteId)) {
    settings.fieldPaletteId = value.fieldPaletteId;
  }

  if (isRecord(value.playerSpeed)) {
    settings.playerSpeed = normalizePlayerSpeedSettings({
      baseSpeedMetersPerSecond: finiteOr(
        value.playerSpeed.baseSpeedMetersPerSecond,
        settings.playerSpeed.baseSpeedMetersPerSecond
      ),
      boostSpeedMetersPerSecond: finiteOr(
        value.playerSpeed.boostSpeedMetersPerSecond,
        settings.playerSpeed.boostSpeedMetersPerSecond
      )
    });
  }
  settings.surfaceGrip = clamp(
    finiteOr(value.surfaceGrip, settings.surfaceGrip),
    SURFACE_GRIP_LIMITS.min,
    SURFACE_GRIP_LIMITS.max
  );

  if (isRecord(value.gamepadSensitivity)) {
    settings.gamepadSensitivity = {
      leftStick: clamp(
        finiteOr(value.gamepadSensitivity.leftStick, settings.gamepadSensitivity.leftStick),
        GAMEPAD_SENSITIVITY_LIMITS.min,
        GAMEPAD_SENSITIVITY_LIMITS.max
      ),
      rightStick: clamp(
        finiteOr(value.gamepadSensitivity.rightStick, settings.gamepadSensitivity.rightStick),
        GAMEPAD_SENSITIVITY_LIMITS.min,
        GAMEPAD_SENSITIVITY_LIMITS.max
      )
    };
  }

  settings.rippleHeight = finiteOr(value.rippleHeight, settings.rippleHeight);
  settings.rippleRadius = finiteOr(value.rippleRadius, settings.rippleRadius);
  settings.voxelSizeMeters = clamp(
    finiteOr(value.voxelSizeMeters, settings.voxelSizeMeters),
    VOXEL_SIZE_MIN_METERS,
    VOXEL_SIZE_MAX_METERS
  );
  settings.arenaRadiusMeters = clamp(
    finiteOr(value.arenaRadiusMeters, settings.arenaRadiusMeters),
    ARENA_RADIUS_MIN_METERS,
    ARENA_RADIUS_MAX_METERS
  );

  if (isRecord(value.waveMedium)) {
    settings.waveMedium = {
      gravity: finiteOr(value.waveMedium.gravity, settings.waveMedium.gravity),
      effectiveDepth: finiteOr(value.waveMedium.effectiveDepth, settings.waveMedium.effectiveDepth),
      damping: finiteOr(value.waveMedium.damping, settings.waveMedium.damping),
      dispersion: finiteOr(value.waveMedium.dispersion, settings.waveMedium.dispersion),
      wakeSpeedMultiplier: finiteOr(
        value.waveMedium.wakeSpeedMultiplier,
        settings.waveMedium.wakeSpeedMultiplier
      )
    };
  }

  settings.particleDensity = clamp(finiteOr(value.particleDensity, settings.particleDensity), 0, 1);
  settings.particlesEnabled = booleanOr(value.particlesEnabled, settings.particlesEnabled);
  settings.bloomStrength = clamp(finiteOr(value.bloomStrength, settings.bloomStrength), 0, 0.38);
  settings.bloomEnabled = booleanOr(value.bloomEnabled, settings.bloomEnabled);
  return settings;
}

function cloneSettings(settings: LabSettings): LabSettings {
  return {
    ...settings,
    playerSpeed: { ...settings.playerSpeed },
    gamepadSensitivity: { ...settings.gamepadSensitivity },
    waveMedium: { ...settings.waveMedium }
  };
}

function createTransitionUrl(
  location: Location,
  transitionId: string,
  targetBackend: RendererBackendId,
  playMode: RendererTransitionPlayMode
): string {
  const url = new URL(location.href);
  url.searchParams.set("renderer", targetBackend);
  url.searchParams.set("mode", playMode);
  url.searchParams.set(RENDERER_TRANSITION_QUERY_KEY, transitionId);
  url.searchParams.delete("webgpuDemo");
  return url.toString();
}

function removeTransitionMarker(location: Location, history: History): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete(RENDERER_TRANSITION_QUERY_KEY);
    history.replaceState(history.state, "", url);
  } catch {
    // A failed cosmetic cleanup should never invalidate a valid handoff.
  }
}

function writeHandoff(handoff: RendererTransitionHandoff): boolean {
  const storage = getSessionStorage();
  try {
    storage?.setItem(RENDERER_TRANSITION_STORAGE_KEY, JSON.stringify(handoff));
    return storage !== null;
  } catch {
    return false;
  }
}

function readAndRemoveHandoff(storage: Storage | null): string | null {
  try {
    const raw = storage?.getItem(RENDERER_TRANSITION_STORAGE_KEY) ?? null;
    storage?.removeItem(RENDERER_TRANSITION_STORAGE_KEY);
    return raw;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function createTransitionId(): string {
  try {
    return `renderer-${crypto.randomUUID()}`;
  } catch {
    return `renderer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function readButtonTarget(button: HTMLButtonElement): RendererBackendId {
  return button.dataset.rendererTarget === "webgpu" ? "webgpu" : "webgl";
}

function isRendererBackendId(value: unknown): value is RendererBackendId {
  return value === "webgl" || value === "webgpu";
}

function isPlayMode(value: unknown): value is RendererTransitionPlayMode {
  return value === "arena" || value === "track" || value === "training";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireElement<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
