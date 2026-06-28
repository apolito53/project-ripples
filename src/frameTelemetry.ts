import { roundMetric, type RippleDebugPayload } from "./debugLog";
import type { WakeFieldMetrics } from "./wakeField";

const GLOBAL_FRAME_HITCH_COMPONENT_MS = 24;
const GLOBAL_FRAME_HITCH_DOMINANCE_RATIO = 1.2;

export type GlobalFrameHitchKind = "render" | "update" | "mixed" | "clock-gap";

export type GlobalFrameHitchSnapshot = {
  readonly time: number;
  readonly frameMs: number;
  readonly updateMs: number;
  readonly renderMs: number;
  readonly rawClockDeltaMs: number;
  readonly cappedClockDeltaMs: number;
  readonly thresholdMs: number;
  readonly echoWatchActive: boolean;
  readonly activeEchoes: number;
  readonly activeVisualBursts: number;
  readonly activeParticles: number;
  readonly particleBudget: number;
  readonly activeRippleSources: number;
  readonly renderedRippleSources: number;
  readonly renderedRippleSourceLimit: number;
  readonly wakeMetrics: WakeFieldMetrics;
  readonly playMode: string;
  readonly fullHexCount: number;
  readonly culledHexCount: number;
  readonly quality: string;
  readonly hexDiameterMeters: number;
  readonly arenaRadiusMeters: number;
  readonly bloomStrength: number;
  readonly particleDensity: number;
  readonly particlesEnabled: boolean;
  readonly bloomEnabled: boolean;
  readonly rendererPixelRatio: number;
  readonly visibilityState: DocumentVisibilityState;
};

export type GlobalFrameHitchEvent = {
  readonly channel: string;
  readonly message: string;
  readonly payload: RippleDebugPayload;
};

export function createGlobalFrameHitchEvent(snapshot: GlobalFrameHitchSnapshot): GlobalFrameHitchEvent {
  const hitchKind = classifyGlobalFrameHitch(
    snapshot.frameMs,
    snapshot.updateMs,
    snapshot.renderMs,
    snapshot.rawClockDeltaMs,
    snapshot.thresholdMs
  );
  const wakeMetrics = snapshot.wakeMetrics;

  return {
    channel: getGlobalFrameHitchChannel(hitchKind),
    message: getGlobalFrameHitchMessage(hitchKind),
    payload: {
      hitchKind,
      time: roundMetric(snapshot.time),
      frameMs: roundMetric(snapshot.frameMs),
      updateMs: roundMetric(snapshot.updateMs),
      renderMs: roundMetric(snapshot.renderMs),
      rawClockDeltaMs: roundMetric(snapshot.rawClockDeltaMs),
      cappedClockDeltaMs: roundMetric(snapshot.cappedClockDeltaMs),
      echoWatchActive: snapshot.echoWatchActive,
      activeEchoes: snapshot.activeEchoes,
      activeVisualBursts: snapshot.activeVisualBursts,
      activeParticles: snapshot.activeParticles,
      particleBudget: snapshot.particleBudget,
      activeRippleSources: snapshot.activeRippleSources,
      renderedRippleSources: snapshot.renderedRippleSources,
      renderedRippleSourceLimit: snapshot.renderedRippleSourceLimit,
      wakeMode: wakeMetrics.mode,
      wakePassMs: roundMetric(wakeMetrics.passMs),
      wakeTextureSize: wakeMetrics.textureSize,
      wakeFallbackReason: wakeMetrics.fallbackReason,
      movementWakeSourceAddsSinceLastHitch: wakeMetrics.movementSourceAddsSinceLastFrame,
      playMode: snapshot.playMode,
      fullHexCount: snapshot.fullHexCount,
      culledHexCount: snapshot.culledHexCount,
      quality: snapshot.quality,
      hexDiameterMeters: roundMetric(snapshot.hexDiameterMeters),
      arenaRadiusMeters: roundMetric(snapshot.arenaRadiusMeters),
      bloomStrength: roundMetric(snapshot.bloomStrength),
      particleDensity: roundMetric(snapshot.particleDensity),
      particlesEnabled: snapshot.particlesEnabled,
      bloomEnabled: snapshot.bloomEnabled,
      rendererPixelRatio: roundMetric(snapshot.rendererPixelRatio),
      visibilityState: snapshot.visibilityState
    }
  };
}

export function formatVoxelSize(sizeMeters: number): string {
  return sizeMeters < 1
    ? `${Math.round(sizeMeters * 100)}cm`
    : `${sizeMeters.toFixed(2)}m`;
}

export function formatCompactCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

function classifyGlobalFrameHitch(
  frameMs: number,
  updateMs: number,
  renderMs: number,
  rawClockDeltaMs: number,
  thresholdMs: number
): GlobalFrameHitchKind {
  // Keep browser wall-clock gaps separate from actual frame work. A sleeping tab
  // or automation pause can create a huge raw delta while this frame itself is
  // cheap, and that should not send us hunting through render code.
  if (frameMs < thresholdMs && rawClockDeltaMs >= thresholdMs) {
    return "clock-gap";
  }

  if (renderMs >= GLOBAL_FRAME_HITCH_COMPONENT_MS && renderMs >= updateMs * GLOBAL_FRAME_HITCH_DOMINANCE_RATIO) {
    return "render";
  }

  if (updateMs >= GLOBAL_FRAME_HITCH_COMPONENT_MS && updateMs >= renderMs * GLOBAL_FRAME_HITCH_DOMINANCE_RATIO) {
    return "update";
  }

  return "mixed";
}

function getGlobalFrameHitchChannel(kind: GlobalFrameHitchKind): string {
  if (kind === "render") return "frame.renderHitch";
  if (kind === "update") return "frame.updateHitch";
  if (kind === "clock-gap") return "frame.clockGap";
  return "frame.mixedHitch";
}

function getGlobalFrameHitchMessage(kind: GlobalFrameHitchKind): string {
  if (kind === "render") return "Render-dominated frame hitch";
  if (kind === "update") return "Update-dominated frame hitch";
  if (kind === "clock-gap") return "Raw browser clock gap";
  return "Mixed frame hitch";
}
