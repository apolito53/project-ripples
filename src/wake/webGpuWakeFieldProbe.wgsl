struct WakeParams {
  sim: vec4f,
  playerPath: vec4f,
  playerMotion: vec4f,
  medium: vec4f,
  shape: vec4f,
  damping: vec4f,
};

@group(0) @binding(0) var<uniform> wake: WakeParams;
@group(0) @binding(1) var previousWake: texture_2d<f32>;
@group(0) @binding(2) var nextWake: texture_storage_2d<rgba16float, write>;
@group(1) @binding(0) var metricsWake: texture_2d<f32>;
@group(1) @binding(1) var<storage, read_write> metricSamples: array<vec4f>;

const WAKE_METRIC_GRID: u32 = 16u;

fn clampCoord(coord: vec2i, size: i32) -> vec2i {
  return clamp(coord, vec2i(0), vec2i(size - 1));
}

fn sampleWake(coord: vec2i, size: i32) -> vec4f {
  return textureLoad(previousWake, clampCoord(coord, size), 0);
}

fn segmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
  let segment = end - start;
  let segmentLengthSq = max(dot(segment, segment), 0.000001);
  let t = clamp(dot(point - start, segment) / segmentLengthSq, 0.0, 1.0);
  return length(point - (start + segment * t));
}

fn safeDirection(value: vec2f) -> vec2f {
  let magnitude = length(value);
  if (magnitude <= 0.0001) {
    return vec2f(1.0, 0.0);
  }
  return value / magnitude;
}

@compute @workgroup_size(8, 8)
fn resetMain(@builtin(global_invocation_id) globalId: vec3u) {
  let size = i32(wake.sim.w + 0.5);
  let coord = vec2i(globalId.xy);

  if (coord.x >= size || coord.y >= size) {
    return;
  }

  textureStore(nextWake, coord, vec4f(0.0));
}

@compute @workgroup_size(8, 8)
fn simulateMain(@builtin(global_invocation_id) globalId: vec3u) {
  let size = i32(wake.sim.w + 0.5);
  let coord = vec2i(globalId.xy);

  if (coord.x >= size || coord.y >= size) {
    return;
  }

  let center = sampleWake(coord, size);
  let left = sampleWake(coord + vec2i(-1, 0), size).x;
  let right = sampleWake(coord + vec2i(1, 0), size).x;
  let down = sampleWake(coord + vec2i(0, -1), size).x;
  let up = sampleWake(coord + vec2i(0, 1), size).x;

  var height = center.x;
  var velocity = center.y;
  var crest = center.z;

  let safeDelta = min(max(wake.sim.x, 0.0), 0.03333);
  let fieldRadius = max(wake.sim.z, 0.001);
  let textureSize = max(wake.sim.w, 1.0);
  let uv = (vec2f(globalId.xy) + vec2f(0.5)) / textureSize;
  let worldPosition = (uv - vec2f(0.5)) * fieldRadius * 2.0;
  let cellMeters = max(0.25, fieldRadius * 2.0 / textureSize);
  let cfl = min(0.42, safeDelta * wake.medium.x / cellMeters);
  let laplacian = left + right + down + up - height * 4.0;

  velocity = velocity + laplacian * cfl * 0.42;
  velocity = velocity * max(0.0, 1.0 - wake.medium.y * safeDelta * 1.65);
  height = height + velocity * cfl * 1.45;
  height = height * max(0.0, 1.0 - wake.medium.y * safeDelta * 0.42);

  let neighborAverage = (left + right + down + up) * 0.25;
  let viscosity = min(0.045, safeDelta * (0.18 + wake.medium.y * 0.75));
  height = mix(height, neighborAverage, viscosity);
  velocity = mix(velocity, 0.0, viscosity * 0.42);

  let residualEnergy = abs(height) + abs(velocity);
  let microDamping = 1.0 - smoothstep(wake.damping.y, wake.damping.z, residualEnergy);
  height = height * max(0.0, 1.0 - microDamping * safeDelta * 1.35);
  velocity = velocity * max(0.0, 1.0 - microDamping * safeDelta * 1.7);

  let playerPrevious = wake.playerPath.xy;
  let playerCurrent = wake.playerPath.zw;
  let movement = playerCurrent - playerPrevious;
  let direction = safeDirection(wake.playerMotion.xy);
  let motionDistance = length(movement);
  let playerContact = clamp(wake.playerMotion.w, 0.0, 1.0);
  let moving = smoothstep(wake.shape.y, 8.0, wake.playerMotion.z) *
    smoothstep(0.015, 0.12, motionDistance) *
    playerContact;

  let centerDistance = segmentDistance(worldPosition, playerPrevious, playerCurrent);
  let centerBrush = exp(-pow(centerDistance / max(0.2, wake.medium.w), 2.0));
  let alongMotion = dot(worldPosition - playerCurrent, direction);
  let lateral = abs((worldPosition.x - playerCurrent.x) * direction.y -
    (worldPosition.y - playerCurrent.y) * direction.x);
  let shoulder = exp(-pow((lateral - wake.shape.x) / max(0.14, wake.medium.w * 0.22), 2.0)) *
    exp(-pow(centerDistance / max(0.35, wake.medium.w * 1.65), 2.0));
  let sternDistance = max(0.0, -alongMotion);
  let freshWake = 1.0 - smoothstep(wake.medium.w * 1.25, wake.medium.w * 3.8, sternDistance);
  let stern = smoothstep(0.2, 1.0, sternDistance) * freshWake;
  let bowRidge = exp(-pow((alongMotion - wake.medium.w * 0.58) / max(0.18, wake.medium.w * 0.32), 2.0)) *
    exp(-pow(lateral / max(0.24, wake.medium.w * 0.62), 2.0));
  let injection = moving * wake.medium.z;

  let shoulderCrest = shoulder * stern;
  let crestBrush = shoulderCrest * 1.0 + bowRidge * 0.62;
  let heightBrush = shoulderCrest * 0.34 + bowRidge * 0.2;
  let troughBrush = centerBrush * 0.22;
  height = height + injection * (heightBrush - troughBrush);
  velocity = velocity + injection * (crestBrush * 0.7 - troughBrush * 0.32);
  crest = max(
    crest * max(0.0, 1.0 - safeDelta * 2.05),
    moving * (crestBrush * 1.4 + centerBrush * 0.04)
  );

  let globalSettle = max(0.0, 1.0 - safeDelta * (0.16 + wake.medium.y * 0.95));
  height = height * globalSettle;
  velocity = velocity * globalSettle;

  let radialDistance = length(worldPosition);
  let edgeSponge = smoothstep(fieldRadius * wake.shape.z, fieldRadius * wake.shape.w, radialDistance);
  let spongeDamping = max(0.0, 1.0 - edgeSponge * safeDelta * (2.8 + wake.medium.x * 0.04));
  height = height * spongeDamping;
  velocity = velocity * spongeDamping * spongeDamping;
  crest = crest * max(0.0, 1.0 - edgeSponge * safeDelta * 3.2);

  let arenaMask = 1.0 - smoothstep(fieldRadius * wake.damping.x, fieldRadius, radialDistance);
  height = height * arenaMask;
  velocity = velocity * arenaMask;
  crest = crest * arenaMask;

  textureStore(nextWake, coord, vec4f(height, velocity, crest, 0.0));
}

@compute @workgroup_size(16, 16)
fn metricsMain(@builtin(global_invocation_id) globalId: vec3u) {
  if (globalId.x >= WAKE_METRIC_GRID || globalId.y >= WAKE_METRIC_GRID) {
    return;
  }

  let sampleIndex = globalId.y * WAKE_METRIC_GRID + globalId.x;
  let dimensions = textureDimensions(metricsWake);
  let textureSize = max(vec2f(dimensions), vec2f(1.0, 1.0));
  let sampleUv = (vec2f(globalId.xy) + vec2f(0.5, 0.5)) / vec2f(f32(WAKE_METRIC_GRID));
  let sampleCoord = vec2u(clamp(floor(sampleUv * textureSize), vec2f(0.0, 0.0), textureSize - vec2f(1.0, 1.0)));
  let sample = textureLoad(metricsWake, sampleCoord, 0);
  let absHeight = abs(sample.x);
  let absVelocity = abs(sample.y);
  let crest = max(sample.z, 0.0);
  let energy = absHeight + absVelocity * 0.5 + crest;
  metricSamples[sampleIndex] = vec4f(absHeight, absHeight, crest, energy);
}
