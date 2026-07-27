export type SceneSpotLightFixtureConfig = {
  readonly sourcePosition: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly colorHex: number;
  readonly visualScale: number;
  readonly heightScale: number;
  readonly intensity: number;
  readonly distanceScale: number;
};

export type ResolvedSceneSpotLightFixture = {
  readonly position: SceneLightingVector3;
  readonly target: SceneLightingVector3;
  readonly direction: SceneLightingVector3;
  readonly colorHex: number;
  readonly intensity: number;
  readonly range: number;
  readonly angleRadians: number;
  readonly penumbra: number;
  readonly decay: number;
};

type SceneLightingVector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export const SCENE_SPOT_LIGHT_ANGLE_RADIANS = 1.08;
export const SCENE_SPOT_LIGHT_PENUMBRA = 0.74;
export const SCENE_SPOT_LIGHT_DECAY = 1.18;
const SCENE_SPOT_LIGHT_HORIZON_SCALE = 0.72;
const SCENE_SPOT_LIGHT_MIN_HEIGHT = 18;
const SCENE_SPOT_LIGHT_MAX_HEIGHT = 56;
const SCENE_SPOT_LIGHT_MIN_RANGE = 150;
const SCENE_SPOT_LIGHT_TARGET: SceneLightingVector3 = { x: 0, y: 0.35, z: 0 };

export const KEY_LIGHT_FIXTURE: SceneSpotLightFixtureConfig = {
  sourcePosition: { x: -24, y: 38, z: 18 },
  colorHex: 0xbcecff,
  visualScale: 1.25,
  heightScale: 0.34,
  intensity: 330,
  distanceScale: 2.75
};

export const RIM_LIGHT_FIXTURE: SceneSpotLightFixtureConfig = {
  sourcePosition: { x: 30, y: 18, z: -24 },
  colorHex: 0xff7de7,
  visualScale: 0.92,
  heightScale: 0.27,
  intensity: 150,
  distanceScale: 2.25
};

/**
 * Resolve one fixture against the active field radius without depending on
 * Three or WebGPU. Both backends consume this result so quality/arena changes
 * cannot move the visible WebGL source away from its WebGPU reflection pool.
 */
export function resolveSceneSpotLightFixture(
  fixture: SceneSpotLightFixtureConfig,
  fieldRadius: number
): ResolvedSceneSpotLightFixture {
  const horizontalLength = Math.hypot(
    fixture.sourcePosition.x,
    fixture.sourcePosition.z
  ) || 1;
  const horizonRadius = fieldRadius * SCENE_SPOT_LIGHT_HORIZON_SCALE;
  const position = {
    x: fixture.sourcePosition.x / horizontalLength * horizonRadius,
    y: clamp(
      fieldRadius * fixture.heightScale,
      SCENE_SPOT_LIGHT_MIN_HEIGHT,
      SCENE_SPOT_LIGHT_MAX_HEIGHT
    ),
    z: fixture.sourcePosition.z / horizontalLength * horizonRadius
  };

  return {
    position,
    target: SCENE_SPOT_LIGHT_TARGET,
    direction: normalize({
      x: SCENE_SPOT_LIGHT_TARGET.x - position.x,
      y: SCENE_SPOT_LIGHT_TARGET.y - position.y,
      z: SCENE_SPOT_LIGHT_TARGET.z - position.z
    }),
    colorHex: fixture.colorHex,
    intensity: fixture.intensity,
    range: Math.max(SCENE_SPOT_LIGHT_MIN_RANGE, fieldRadius * fixture.distanceScale),
    angleRadians: SCENE_SPOT_LIGHT_ANGLE_RADIANS,
    penumbra: SCENE_SPOT_LIGHT_PENUMBRA,
    decay: SCENE_SPOT_LIGHT_DECAY
  };
}

function normalize(vector: SceneLightingVector3): SceneLightingVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
