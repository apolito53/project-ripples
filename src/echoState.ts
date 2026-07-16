import * as THREE from "three";
import { debugEvent, roundMetric, vectorPayload } from "./debugLog";

export const ECHO_COLUMN_HEIGHT = 7.4;
export const ECHO_COLUMN_BASE_LIFT = 1.45;
export const ECHO_COLLECTION_EVENT_SECONDS = 1.06;

const ECHO_STATE_FRAME_LOG_INTERVAL_SECONDS = 0.5;

export type EchoZoneOptions = {
  readonly radius: number;
  readonly triggerRadius: number;
  readonly burstStrength: number;
  readonly discBurstRadius: number;
};

export type EchoZoneState = EchoZoneOptions & {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly spawnTime: number;
  readonly phase: number;
  readonly columnRadius: number;
};

export type TriggeredEchoZone = {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly effectPosition: THREE.Vector3;
  readonly columnRadius: number;
  readonly burstStrength: number;
  readonly discBurstRadius: number;
  readonly collectedAt: number;
};

export type EchoCollectionEvent = TriggeredEchoZone;

export type EchoRenderSnapshot = {
  readonly id: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly triggerRadius: number;
  readonly radius: number;
  readonly columnRadius: number;
  readonly spawnTime: number;
  readonly phase: number;
  readonly age: number;
};

export type EchoCollectionRenderSnapshot = {
  readonly id: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly effectPositionY: number;
  readonly columnRadius: number;
  readonly collectedAt: number;
  readonly age: number;
  readonly burstStrength: number;
  readonly discBurstRadius: number;
};

export type EchoVisualStateSnapshot = {
  readonly activeEchoes: number;
  readonly activeVisualBursts: number;
  readonly echoes: readonly EchoRenderSnapshot[];
  readonly collectionEvents: readonly EchoCollectionRenderSnapshot[];
};

export type EchoZoneCollectOptions = {
  readonly activeBurstsBefore?: number;
};

export function createEmptyEchoVisualState(): EchoVisualStateSnapshot {
  return {
    activeEchoes: 0,
    activeVisualBursts: 0,
    echoes: [],
    collectionEvents: []
  };
}

export class EchoZoneStateStore {
  private readonly zones: EchoZoneState[] = [];
  private readonly collectionEvents: EchoCollectionEvent[] = [];
  private nextId = 1;
  private lastFrameLogAt = -Infinity;

  constructor(private readonly collectionEventSeconds = ECHO_COLLECTION_EVENT_SECONDS) {}

  add(position: THREE.Vector3, startTime: number, options: EchoZoneOptions): EchoZoneState {
    const zone: EchoZoneState = {
      ...options,
      id: this.nextId,
      position: position.clone(),
      spawnTime: startTime,
      // Visuals and WebGPU diagnostics both consume this phase so newly shared
      // Echo state still breathes with per-zone variation.
      phase: Math.random() * Math.PI * 2,
      columnRadius: Math.max(0.85, options.radius * 0.34)
    };

    this.nextId += 1;
    this.zones.push(zone);
    debugEvent("echo.state.spawn", "Echo state zone spawned", {
      id: zone.id,
      time: roundMetric(startTime),
      activeEchoes: this.zones.length,
      triggerRadius: roundMetric(zone.triggerRadius),
      radius: roundMetric(zone.radius),
      position: vectorPayload(zone.position)
    }, "debug");
    return zone;
  }

  update(time: number): void {
    for (let index = this.collectionEvents.length - 1; index >= 0; index -= 1) {
      if (time - this.collectionEvents[index].collectedAt >= this.collectionEventSeconds) {
        this.collectionEvents.splice(index, 1);
      }
    }
  }

  collectAt(playerPosition: THREE.Vector3, time: number, options: EchoZoneCollectOptions = {}): TriggeredEchoZone[] {
    const triggered: TriggeredEchoZone[] = [];

    for (let index = this.zones.length - 1; index >= 0; index -= 1) {
      const zone = this.zones[index];
      const distance = Math.hypot(playerPosition.x - zone.position.x, playerPosition.z - zone.position.z);
      if (distance > zone.triggerRadius) continue;

      debugEvent("echo.collect", "Echo zone entered trigger radius", {
        id: zone.id,
        time: roundMetric(time),
        distance: roundMetric(distance),
        triggerRadius: zone.triggerRadius,
        activeZonesBefore: this.zones.length,
        activeBurstsBefore: options.activeBurstsBefore ?? this.collectionEvents.length,
        position: vectorPayload(zone.position)
      });

      const event: TriggeredEchoZone = {
        id: zone.id,
        position: zone.position.clone(),
        effectPosition: zone.position.clone().setY(zone.position.y + ECHO_COLUMN_BASE_LIFT + ECHO_COLUMN_HEIGHT * 0.5),
        columnRadius: zone.columnRadius,
        burstStrength: zone.burstStrength,
        discBurstRadius: zone.discBurstRadius,
        collectedAt: time
      };
      triggered.push(event);
      this.collectionEvents.push(event);
      this.zones.splice(index, 1);

      debugEvent("echo.state.collect", "Echo state zone collected", {
        id: zone.id,
        time: roundMetric(time),
        distance: roundMetric(distance),
        activeEchoes: this.zones.length,
        activeVisualBursts: this.collectionEvents.length,
        burstStrength: roundMetric(zone.burstStrength),
        discBurstRadius: roundMetric(zone.discBurstRadius),
        playerPosition: vectorPayload(playerPosition),
        position: vectorPayload(zone.position)
      });
    }

    return triggered;
  }

  getActiveCount(): number {
    return this.zones.length;
  }

  getCollectBurstCount(): number {
    return this.collectionEvents.length;
  }

  getZones(): readonly EchoZoneState[] {
    return this.zones;
  }

  getCollectionEvents(): readonly EchoCollectionEvent[] {
    return this.collectionEvents;
  }

  isPositionClear(position: THREE.Vector3, clearance: number): boolean {
    return !this.zones.some((zone) => {
      const distance = Math.hypot(position.x - zone.position.x, position.z - zone.position.z);
      return distance < clearance;
    });
  }

  getRenderSnapshot(time: number, limit = Number.POSITIVE_INFINITY): EchoVisualStateSnapshot {
    const maxEchoes = Math.max(0, Math.min(this.zones.length, Math.floor(limit)));
    const maxEvents = Math.max(0, Math.min(this.collectionEvents.length, Math.floor(limit)));
    const echoes = this.zones.slice(0, maxEchoes).map((zone) => ({
      id: zone.id,
      positionX: zone.position.x,
      positionY: zone.position.y,
      positionZ: zone.position.z,
      triggerRadius: zone.triggerRadius,
      radius: zone.radius,
      columnRadius: zone.columnRadius,
      spawnTime: zone.spawnTime,
      phase: zone.phase,
      age: Math.max(0, time - zone.spawnTime)
    }));
    const collectionEvents = this.collectionEvents.slice(0, maxEvents).map((event) => ({
      id: event.id,
      positionX: event.position.x,
      positionY: event.position.y,
      positionZ: event.position.z,
      effectPositionY: event.effectPosition.y,
      columnRadius: event.columnRadius,
      collectedAt: event.collectedAt,
      age: Math.max(0, time - event.collectedAt),
      burstStrength: event.burstStrength,
      discBurstRadius: event.discBurstRadius
    }));

    return {
      activeEchoes: this.zones.length,
      activeVisualBursts: this.collectionEvents.length,
      echoes,
      collectionEvents
    };
  }

  logInit(time: number): void {
    debugEvent("echo.state.init", "Echo state initialized", {
      time: roundMetric(time),
      activeEchoes: this.zones.length,
      activeVisualBursts: this.collectionEvents.length,
      collectionEventSeconds: this.collectionEventSeconds
    });
  }

  maybeLogFrame(time: number): void {
    if (time - this.lastFrameLogAt < ECHO_STATE_FRAME_LOG_INTERVAL_SECONDS) return;

    this.lastFrameLogAt = time;
    debugEvent("echo.state.frame", "Echo state frame sample", {
      time: roundMetric(time),
      activeEchoes: this.zones.length,
      activeVisualBursts: this.collectionEvents.length
    }, "debug");
  }

  clear(): void {
    this.zones.splice(0, this.zones.length);
    this.collectionEvents.splice(0, this.collectionEvents.length);
  }
}
