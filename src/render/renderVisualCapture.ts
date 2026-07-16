import type { EchoVisualStateSnapshot } from "../echoState";
import type { RippleRenderSourceSnapshot } from "../rippleSources";

export type RenderVisualCaptureDescription = Readonly<Record<string, unknown>>;

export type RippleVisualCaptureApi = {
  readonly version: 1;
  readonly enabled: true;
  ready(): Promise<void>;
  advanceToTick(targetTick: number): Promise<void>;
  freezeAndDescribe(): Promise<RenderVisualCaptureDescription>;
  getTick(): number;
};

declare global {
  interface Window {
    __rippleVisualCapture?: RippleVisualCaptureApi;
  }
}

export type RenderVisualCaptureController = {
  readonly enabled: boolean;
  resolveFrameDelta(rawDeltaSeconds: number): number;
  recordSimulation(simulatedDeltaSeconds: number): void;
  afterRender(): void;
  destroy(): void;
};

type CreateRenderVisualCaptureControllerOptions = {
  readonly fixedStepSeconds: number;
  readonly describe: (tick: number) => RenderVisualCaptureDescription;
  readonly waitForGpuIdle: () => Promise<void>;
};

type TickWaiter = {
  readonly targetTick: number;
  readonly requiredFrozenFrames: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};

const REQUIRED_PRESENTATION_FRAMES = 2;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Installs a capture-only fixed-tick controller. It is deliberately inert in
 * normal sessions, so gameplay timing and benchmark timing remain untouched.
 */
export function createRenderVisualCaptureController(
  options: CreateRenderVisualCaptureControllerOptions
): RenderVisualCaptureController {
  const enabled = readVisualCaptureEnabled();
  if (!enabled) return createDisabledController();

  let currentTick = 0;
  let targetTick = 0;
  let frozenPresentationFrames = 0;
  let firstFrameRendered = false;
  let readyResolve: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const waiters: TickWaiter[] = [];

  const api: RippleVisualCaptureApi = {
    version: 1,
    enabled: true,
    ready: () => readyPromise,
    advanceToTick: (requestedTick) => {
      const nextTick = normalizeTick(requestedTick);
      if (nextTick < currentTick) {
        return Promise.reject(new Error(
          `Visual capture cannot rewind from tick ${currentTick} to ${nextTick}. Reload the fixture instead.`
        ));
      }
      targetTick = nextTick;
      frozenPresentationFrames = 0;
      return waitForTick(nextTick, 1);
    },
    freezeAndDescribe: async () => {
      targetTick = currentTick;
      frozenPresentationFrames = 0;
      await waitForTick(currentTick, REQUIRED_PRESENTATION_FRAMES);
      await options.waitForGpuIdle();
      return Object.freeze({
        ...options.describe(currentTick),
        visualCaptureVersion: 1,
        tick: currentTick,
        fixedStepSeconds: options.fixedStepSeconds
      });
    },
    getTick: () => currentTick
  };
  window.__rippleVisualCapture = api;

  function waitForTick(requestedTick: number, requiredFrozenFrames: number): Promise<void> {
    if (currentTick === requestedTick && frozenPresentationFrames >= requiredFrozenFrames) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      waiters.push({
        targetTick: requestedTick,
        requiredFrozenFrames,
        resolve,
        reject
      });
    });
  }

  function resolveWaiters(): void {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (currentTick !== waiter.targetTick || frozenPresentationFrames < waiter.requiredFrozenFrames) continue;
      waiters.splice(index, 1);
      waiter.resolve();
    }
  }

  return {
    enabled: true,
    resolveFrameDelta(rawDeltaSeconds) {
      void rawDeltaSeconds;
      return currentTick < targetTick ? options.fixedStepSeconds : 0;
    },
    recordSimulation(simulatedDeltaSeconds) {
      if (simulatedDeltaSeconds <= 0) return;
      const simulatedSteps = Math.round(simulatedDeltaSeconds / options.fixedStepSeconds);
      if (simulatedSteps !== 1) {
        throw new Error(`Visual capture expected one fixed step, observed ${simulatedSteps}.`);
      }
      currentTick += 1;
      if (currentTick > targetTick) {
        throw new Error(`Visual capture advanced past target tick ${targetTick}.`);
      }
      frozenPresentationFrames = 0;
    },
    afterRender() {
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        readyResolve?.();
        readyResolve = null;
      }
      if (currentTick === targetTick) frozenPresentationFrames += 1;
      else frozenPresentationFrames = 0;
      resolveWaiters();
    },
    destroy() {
      delete window.__rippleVisualCapture;
      const error = new Error("Visual capture controller was destroyed.");
      for (const waiter of waiters.splice(0)) waiter.reject(error);
    }
  };
}

function createDisabledController(): RenderVisualCaptureController {
  return {
    enabled: false,
    resolveFrameDelta: (rawDeltaSeconds) => rawDeltaSeconds,
    recordSimulation: () => {},
    afterRender: () => {},
    destroy: () => {}
  };
}

function readVisualCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("visualCapture") === "1";
}

function normalizeTick(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Visual capture tick must be finite; received ${value}.`);
  return Math.max(0, Math.trunc(value));
}

export function hashVisualCaptureBytes(values: ArrayLike<number>): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < values.length; index += 1) {
    hash = Math.imul(hash ^ (values[index] & 0xff), FNV_PRIME);
  }
  return toCaptureHash(hash);
}

export function hashVisualCaptureNumbers(values: Iterable<number>): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  let hash = FNV_OFFSET_BASIS;
  let index = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error(`Visual capture digest value ${index} must be finite; received ${value}.`);
    }
    const canonicalValue = Math.round(value * 1_000_000) / 1_000_000 || 0;
    view.setFloat64(0, canonicalValue, true);
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      hash = Math.imul(hash ^ view.getUint8(byteIndex), FNV_PRIME);
    }
    index += 1;
  }
  return toCaptureHash(hash);
}

export function createVisualCaptureSourceState(snapshot: RippleRenderSourceSnapshot): Readonly<Record<string, unknown>> {
  const values: number[] = [];
  for (const source of snapshot.sources) {
    values.push(
      source.positionX,
      source.positionZ,
      source.startTime,
      source.strength,
      source.speedMultiplier,
      source.widthMultiplier,
      source.dampingMultiplier,
      source.lifetimeSeconds,
      source.hue
    );
  }
  return {
    activeCount: snapshot.activeCount,
    renderedCount: snapshot.renderedCount,
    sources: snapshot.sources.map((source) => ({
      startTime: source.startTime,
      lifetimeSeconds: source.lifetimeSeconds,
      strength: source.strength
    })),
    digest: hashVisualCaptureNumbers(values)
  };
}

export function createVisualCaptureEchoState(snapshot: EchoVisualStateSnapshot): Readonly<Record<string, unknown>> {
  const values: number[] = [];
  const echoes = snapshot.echoes.map((echo) => ({
    id: echo.id,
    positionX: echo.positionX,
    positionY: echo.positionY,
    positionZ: echo.positionZ,
    triggerRadius: echo.triggerRadius,
    radius: echo.radius,
    columnRadius: echo.columnRadius,
    spawnTime: echo.spawnTime
  }));
  const collectionEvents = snapshot.collectionEvents.map((event) => ({
    id: event.id,
    positionX: event.positionX,
    positionY: event.positionY,
    positionZ: event.positionZ,
    effectPositionY: event.effectPositionY,
    columnRadius: event.columnRadius,
    collectedAt: event.collectedAt,
    burstStrength: event.burstStrength,
    discBurstRadius: event.discBurstRadius
  }));
  for (const echo of echoes) {
    // Per-renderer visual initialization currently shifts the random phase
    // stream. Gameplay identity is position/scale/timing, so phase remains a
    // presentation observation until particle/Echo RNG streams are named.
    values.push(
      echo.id,
      echo.positionX,
      echo.positionY,
      echo.positionZ,
      echo.triggerRadius,
      echo.radius,
      echo.columnRadius,
      echo.spawnTime
    );
  }
  for (const event of collectionEvents) {
    values.push(
      event.id,
      event.positionX,
      event.positionY,
      event.positionZ,
      event.effectPositionY,
      event.columnRadius,
      event.collectedAt,
      event.burstStrength,
      event.discBurstRadius
    );
  }
  return {
    activeEchoes: snapshot.activeEchoes,
    activeVisualBursts: snapshot.activeVisualBursts,
    digest: hashVisualCaptureNumbers(values),
    echoes,
    collectionEvents
  };
}

type VisualCaptureCourseMask = {
  readonly width: number;
  readonly height: number;
  readonly version: number;
  readonly rgba: Uint8Array;
};

type VisualCaptureCourseWalls = {
  readonly version: number;
  readonly segmentCount: number;
  readonly baseY: number;
  readonly height: number;
  readonly packedSegments: Float32Array;
};

export function createVisualCaptureCourseState(
  enabled: boolean,
  mask: VisualCaptureCourseMask | null,
  walls: VisualCaptureCourseWalls | null
): Readonly<Record<string, unknown>> {
  if (!enabled || !mask || !walls) {
    return {
      enabled: false,
      maskWidth: 0,
      maskHeight: 0,
      maskVersion: 0,
      maskDigest: "none",
      wallVersion: 0,
      wallSegmentCount: 0,
      wallDigest: "none"
    };
  }
  const wallBytes = new Uint8Array(
    walls.packedSegments.buffer,
    walls.packedSegments.byteOffset,
    walls.packedSegments.byteLength
  );
  return {
    enabled: true,
    maskWidth: mask.width,
    maskHeight: mask.height,
    maskVersion: mask.version,
    maskDigest: hashVisualCaptureBytes(mask.rgba),
    wallVersion: walls.version,
    wallSegmentCount: walls.segmentCount,
    wallBaseY: walls.baseY,
    wallHeight: walls.height,
    wallDigest: hashVisualCaptureBytes(wallBytes)
  };
}

function toCaptureHash(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
