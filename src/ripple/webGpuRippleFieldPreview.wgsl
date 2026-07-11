struct FieldParams {
  viewProjection: mat4x4f,
  timing: vec4f,
  player: vec4f,
  render: vec4f,
  medium: vec4f,
  shape: vec4f,
  echo: vec4f,
  track: vec4f,
};

struct FieldCell {
  positionPhase: vec4f,
  tint: vec4f,
};

struct RippleSourceData {
  wave: vec4f,
  metadata: vec4f,
};

struct EchoMarkerData {
  wave: vec4f,
  metadata: vec4f,
};

struct SceneLightParams {
  ambient: vec4f,
  keyDirection: vec4f,
  keyColor: vec4f,
  rimDirection: vec4f,
  rimColor: vec4f,
  counts: vec4f,
};

struct LocalLightData {
  positionRadius: vec4f,
  colorIntensity: vec4f,
};

struct SceneShadowParams {
  settings: vec4f,
  counts: vec4f,
};

struct ShadowCasterData {
  positionRadius: vec4f,
  params: vec4f,
};

struct ShadowMapParams {
  lightViewProjection: mat4x4f,
  light: vec4f,
  settings: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) local: vec2f,
  @location(2) energy: vec3f,
  @location(3) lighting: vec3f,
  @location(4) localLighting: vec3f,
  @location(5) contactShadow: f32,
  @location(6) shadowClip: vec4f,
  @location(7) trackSignal: vec4f,
};

@group(0) @binding(0) var<uniform> field: FieldParams;
@group(0) @binding(1) var<storage, read> cells: array<FieldCell>;
@group(0) @binding(2) var wakeTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> rippleSources: array<RippleSourceData>;
@group(0) @binding(4) var<storage, read> echoMarkers: array<EchoMarkerData>;
@group(0) @binding(5) var trackTexture: texture_2d<f32>;
@group(0) @binding(6) var trackSampler: sampler;
@group(1) @binding(0) var<uniform> sceneLights: SceneLightParams;
@group(1) @binding(1) var<storage, read> localLights: array<LocalLightData>;
@group(2) @binding(0) var<uniform> sceneShadows: SceneShadowParams;
@group(2) @binding(1) var<storage, read> shadowCasters: array<ShadowCasterData>;
@group(3) @binding(0) var<uniform> shadowMap: ShadowMapParams;
@group(3) @binding(1) var shadowSampler: sampler_comparison;
@group(3) @binding(2) var shadowTexture: texture_depth_2d;

const RIPPLE_WIDTH: f32 = 1.45;
const HEX_CORNER_Y: f32 = 0.8660254;
const ECHO_MARKER_LIMIT: u32 = 8u;
const ECHO_BURST_LIMIT: u32 = 8u;
const ECHO_BURST_OFFSET: u32 = 8u;
const LOCAL_LIGHT_LIMIT: u32 = 16u;
const SHADOW_CASTER_LIMIT: u32 = 16u;

fn loadWake(cellPosition: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(wakeTexture));
  let textureSize = vec2f(dimensions);
  let uv = clamp(cellPosition / max(0.001, field.timing.z * 2.0) + vec2f(0.5), vec2f(0.0), vec2f(0.9999));
  return textureLoad(wakeTexture, vec2i(uv * textureSize), 0);
}

fn trackSignalAt(cellPosition: vec2f) -> vec4f {
  let trackActive = clamp(field.track.x, 0.0, 1.0);
  if (trackActive <= 0.001) {
    return vec4f(1.0, 0.0, 0.0, 0.0);
  }

  let uv = clamp(cellPosition / max(0.001, field.track.y * 2.0) + vec2f(0.5), vec2f(0.0), vec2f(1.0));
  let sample = textureSampleLevel(trackTexture, trackSampler, uv, 0.0);
  return vec4f(sample.rgb, trackActive);
}

fn sourceWaveAt(cellPosition: vec2f) -> f32 {
  var sourceWave = 0.0;
  let sourceCount = min(u32(field.medium.w + 0.5), 32u);

  for (var index = 0u; index < 32u; index = index + 1u) {
    if (index >= sourceCount) {
      break;
    }

    let source = rippleSources[index];
    let origin = source.wave.xy;
    let startTime = source.wave.z;
    let strength = source.wave.w;
    let speedMultiplier = max(0.05, source.metadata.x);
    let widthMultiplier = max(0.2, source.metadata.y);
    let dampingMultiplier = max(0.05, source.metadata.z);
    let lifetime = max(0.2, source.metadata.w);
    let age = max(0.0, field.timing.x - startTime);
    let propagationSpeed = field.render.w * speedMultiplier;
    let distanceToCell = distance(origin, cellPosition);
    let front = age * propagationSpeed;
    let width = RIPPLE_WIDTH * widthMultiplier + age * field.medium.y * 0.16;
    let ring = exp(-pow((distanceToCell - front) / max(0.12, width), 2.0));
    let fade = max(0.0, 1.0 - age / lifetime);
    let damping = exp(-age * field.medium.x * dampingMultiplier) *
      exp(-distanceToCell * field.medium.x * dampingMultiplier * 0.018);

    sourceWave = sourceWave + ring * fade * damping * strength;
  }

  return sourceWave;
}

fn echoSignalAt(cellPosition: vec2f) -> vec3f {
  var markerEnergy = 0.0;
  var ringEnergy = 0.0;
  var liftEnergy = 0.0;
  let echoCount = min(u32(field.echo.x + 0.5), ECHO_MARKER_LIMIT);
  let burstCount = min(u32(field.echo.y + 0.5), ECHO_BURST_LIMIT);

  for (var index = 0u; index < ECHO_MARKER_LIMIT; index = index + 1u) {
    if (index >= echoCount) {
      break;
    }

    let marker = echoMarkers[index];
    let origin = marker.wave.xy;
    let triggerRadius = max(0.2, marker.wave.z);
    let age = max(0.0, marker.wave.w);
    let radius = max(0.2, marker.metadata.x);
    let phase = marker.metadata.y;
    let distanceToCell = distance(origin, cellPosition);
    let body = exp(-pow(distanceToCell / max(0.25, triggerRadius * 0.74), 2.0));
    let triggerRing = exp(-pow((distanceToCell - triggerRadius) / max(0.22, radius * 0.18), 2.0));
    let shimmer = 0.72 + 0.28 * sin(field.timing.x * 5.2 + phase + age * 0.8);

    markerEnergy = markerEnergy + (body * 0.18 + triggerRing * 0.38) * shimmer;
    liftEnergy = liftEnergy + (body * 0.15 + triggerRing * 0.08) * shimmer;
  }

  for (var index = 0u; index < ECHO_BURST_LIMIT; index = index + 1u) {
    if (index >= burstCount) {
      break;
    }

    let marker = echoMarkers[ECHO_BURST_OFFSET + index];
    let origin = marker.wave.xy;
    let discRadius = max(0.5, marker.wave.z);
    let age = max(0.0, marker.wave.w);
    let strength = max(0.0, marker.metadata.x);
    let distanceToCell = distance(origin, cellPosition);
    let burstProgress = clamp(age / 1.06, 0.0, 1.0);
    let front = mix(0.4, discRadius, burstProgress);
    let width = max(0.45, 0.9 + burstProgress * 1.25);
    let fade = pow(max(0.0, 1.0 - burstProgress), 1.35);
    let ring = exp(-pow((distanceToCell - front) / width, 2.0)) * fade * strength;

    ringEnergy = ringEnergy + ring * 0.55;
    liftEnergy = liftEnergy + ring * 0.24;
  }

  return vec3f(
    clamp(markerEnergy, 0.0, 0.72),
    clamp(ringEnergy, 0.0, 0.88),
    clamp(liftEnergy, 0.0, 0.68)
  );
}

fn hexCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(1.0, 0.0),
    vec2f(0.5, HEX_CORNER_Y),
    vec2f(-0.5, HEX_CORNER_Y),
    vec2f(-1.0, 0.0),
    vec2f(-0.5, -HEX_CORNER_Y),
    vec2f(0.5, -HEX_CORNER_Y)
  );
  return corners[index % 6u];
}

fn hexLocal(vertexIndex: u32) -> vec2f {
  let triangle = vertexIndex / 3u;
  let corner = vertexIndex % 3u;

  if (corner == 0u) {
    return vec2f(0.0, 0.0);
  }
  if (corner == 1u) {
    return hexCorner(triangle);
  }
  return hexCorner(triangle + 1u);
}

fn localLightingAt(worldPosition: vec3f) -> vec3f {
  var lighting = vec3f(0.0);
  let lightCount = min(u32(sceneLights.counts.y + 0.5), LOCAL_LIGHT_LIMIT);

  for (var index = 0u; index < LOCAL_LIGHT_LIMIT; index = index + 1u) {
    if (index >= lightCount) {
      break;
    }

    let light = localLights[index];
    let offset = light.positionRadius.xyz - worldPosition;
    let radius = max(0.1, light.positionRadius.w);
    let distanceToLight = length(offset);
    let attenuation = pow(max(0.0, 1.0 - distanceToLight / radius), 2.0);
    lighting = lighting + light.colorIntensity.rgb * light.colorIntensity.w * attenuation;
  }

  return min(lighting, vec3f(1.35));
}

fn safeNormalize2(value: vec2f) -> vec2f {
  let magnitude = length(value);
  if (magnitude < 0.0001) {
    return vec2f(0.0, 1.0);
  }
  return value / magnitude;
}

fn contactShadowAt(worldPosition: vec3f) -> f32 {
  var shadow = 0.0;
  let casterCount = min(u32(sceneShadows.counts.y + 0.5), SHADOW_CASTER_LIMIT);
  let globalStrength = clamp(sceneShadows.settings.x, 0.0, 0.55);
  let globalSoftness = max(0.1, sceneShadows.settings.y);
  let keyPlanar = safeNormalize2(-sceneLights.keyDirection.xz);

  for (var index = 0u; index < SHADOW_CASTER_LIMIT; index = index + 1u) {
    if (index >= casterCount) {
      break;
    }

    let caster = shadowCasters[index];
    let radius = max(0.1, caster.positionRadius.w);
    let casterStrength = clamp(caster.params.x, 0.0, 0.65);
    let casterSoftness = max(0.1, caster.params.y) * globalSoftness;
    let heightOffset = max(0.0, caster.positionRadius.y - worldPosition.y);
    let shiftedCenter = caster.positionRadius.xz + keyPlanar * clamp(heightOffset * 0.2, 0.0, radius * 0.42);
    let distanceToCaster = length(worldPosition.xz - shiftedCenter);
    let contact = exp(-pow(distanceToCaster / max(0.12, radius * casterSoftness), 2.0));
    let edgeFade = 1.0 - smoothstep(radius * 0.72, radius * 1.28, distanceToCaster);
    let heightFade = 1.0 - smoothstep(radius * 0.12, radius * 0.95, heightOffset);

    shadow = shadow + contact * edgeFade * heightFade * casterStrength;
  }

  return clamp(shadow * globalStrength, 0.0, 0.32);
}

fn shadowMapOcclusion(shadowClip: vec4f, interior: f32) -> f32 {
  let safeW = select(1.0, shadowClip.w, shadowClip.w > 0.0001);
  let ndc = shadowClip.xyz / safeW;
  let uv = ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  let sampleUv = clamp(uv, vec2f(0.001), vec2f(0.999));
  let validSample = select(
    0.0,
    1.0,
    shadowMap.settings.y >= 0.5 &&
      shadowClip.w > 0.0001 &&
      uv.x > 0.001 &&
      uv.x < 0.999 &&
      uv.y > 0.001 &&
      uv.y < 0.999 &&
      ndc.z > 0.0 &&
      ndc.z < 1.0
  );
  let texel = 1.0 / max(1.0, shadowMap.settings.x);
  let compareDepth = clamp(ndc.z - shadowMap.settings.z, 0.0, 1.0);
  var visibility = 0.0;
  for (var x: i32 = -1; x <= 1; x = x + 1) {
    for (var y: i32 = -1; y <= 1; y = y + 1) {
      let offset = vec2f(f32(x), f32(y)) * texel * 1.35;
      visibility = visibility + textureSampleCompare(shadowTexture, shadowSampler, sampleUv + offset, compareDepth);
    }
  }

  visibility = visibility / 9.0;
  let edgeFade =
    smoothstep(0.02, 0.12, uv.x) *
    smoothstep(0.02, 0.12, uv.y) *
    smoothstep(0.02, 0.12, 1.0 - uv.x) *
    smoothstep(0.02, 0.12, 1.0 - uv.y);
  let strength = clamp(shadowMap.settings.w, 0.0, 0.38);
  return clamp((1.0 - visibility) * edgeFade * interior * validSample * strength, 0.0, 0.28);
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let cell = cells[instanceIndex];
  let cellPosition = cell.positionPhase.xz;
  let local = hexLocal(vertexIndex);
  let wake = loadWake(cellPosition);
  let trackSignal = trackSignalAt(cellPosition);
  let sourceWave = sourceWaveAt(cellPosition);
  let echoSignal = echoSignalAt(cellPosition);
  let heightEnergy = clamp(wake.x * 10.0 + sourceWave * 0.88, -1.0, 1.0);
  let crestEnergy = clamp(max(wake.z, 0.0) * 2.2 + max(sourceWave, 0.0) * 0.64, 0.0, 1.0);
  let velocityEnergy = clamp(abs(wake.y) * 10.0, 0.0, 1.0);
  let shimmer = 0.5 + 0.5 * sin(field.timing.x * 3.7 + cell.positionPhase.w);
  // `hexLocal` uses a unit circumradius while Three's cap uses 0.5. Convert the
  // shared point-to-point diameter to a radius here so both backends occupy the
  // same flat-top honeycomb instead of WebGPU masking a sheared grid by overlap.
  let footprintDiameter = field.shape.z + crestEnergy * 0.05 + echoSignal.x * 0.012;
  let footprint = footprintDiameter * field.render.z * 0.5;
  let worldOffset = local * footprint;
  let lift = clamp(heightEnergy * field.render.x + sourceWave * 0.36 + echoSignal.z * 0.72, -1.6, 2.5);
  let worldPosition = vec3f(
    cellPosition.x + worldOffset.x,
    cell.positionPhase.y + lift,
    cellPosition.y + worldOffset.y
  );
  let terrainWhiteness = smoothstep(-0.75, 3.05, cell.positionPhase.y + heightEnergy * field.render.x);
  let keyLight = max(dot(vec3f(0.0, 1.0, 0.0), normalize(vec3f(-0.26, 0.82, 0.48))), 0.0);
  let rim = 0.2 + 0.16 * smoothstep(0.1, 0.98, abs(local.x)) + shimmer * 0.04;
  let crestLight = crestEnergy * (0.28 + shimmer * 0.12);

  var output: VertexOutput;
  output.position = field.viewProjection * vec4f(worldPosition, 1.0);
  output.local = local;
  output.energy = vec3f(heightEnergy, velocityEnergy, max(crestEnergy, echoSignal.y * 0.34));
  output.lighting = vec3f(keyLight, rim, crestLight);
  output.localLighting = localLightingAt(worldPosition);
  output.contactShadow = contactShadowAt(worldPosition);
  output.shadowClip = shadowMap.lightViewProjection * vec4f(worldPosition + vec3f(0.0, 0.04, 0.0), 1.0);
  output.trackSignal = trackSignal;
  output.color = cell.tint.rgb * (0.48 + terrainWhiteness * 0.34 + shimmer * 0.05);
  output.color = output.color + max(heightEnergy, 0.0) * vec3f(0.04, 0.42, 0.5);
  output.color = output.color + max(-heightEnergy, 0.0) * vec3f(0.34, 0.09, 0.44);
  output.color = output.color + velocityEnergy * vec3f(0.03, 0.2, 0.11);
  output.color = output.color + crestEnergy * vec3f(0.62, 0.52, 0.2);
  output.color = output.color + echoSignal.x * vec3f(0.18, 0.36, 0.3);
  output.color = output.color + echoSignal.y * vec3f(0.42, 0.28, 0.1);
  let trackBody = mix(1.0, trackSignal.r, trackSignal.w);
  let trackEdge = trackSignal.g * trackSignal.w;
  let trackCenter = trackSignal.b * trackSignal.w;
  let offTrackDim = mix(0.035, 1.1, smoothstep(0.08, 0.78, trackBody));
  output.color = output.color * offTrackDim;
  output.color = mix(output.color, vec3f(0.1, 0.82, 0.9), trackSignal.r * trackSignal.w * 0.36);
  output.color = mix(output.color, vec3f(0.82, 1.0, 0.94), trackEdge * 0.74 + trackCenter * 0.16);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let radial = length(input.local);
  let interior = 1.0 - smoothstep(0.9, 1.02, radial);
  let gridLine = smoothstep(0.76, 1.0, radial) * 0.22;
  let ambient = sceneLights.ambient.rgb * sceneLights.ambient.w;
  let key = sceneLights.keyColor.rgb * input.lighting.x * sceneLights.keyDirection.w * 0.36;
  let rim = sceneLights.rimColor.rgb * input.lighting.y * sceneLights.rimDirection.w * 0.22;
  let globalLight = vec3f(0.32) + ambient + key + rim;
  let localLight = input.localLighting * interior * (0.18 + input.energy.z * 0.16);
  let contactShadow = input.contactShadow * interior;
  let directionalShadow = shadowMapOcclusion(input.shadowClip, interior);
  let combinedShadow = min(contactShadow + directionalShadow, 0.44);
  var color = input.color * globalLight * (0.78 + interior * 0.22);
  color = color * (1.0 - combinedShadow);
  color = color + gridLine * vec3f(0.015, 0.07, 0.075);
  color = color + input.energy.z * interior * vec3f(0.16, 0.22, 0.09);
  color = color + input.lighting.z * vec3f(0.18, 0.16, 0.06);
  color = color + localLight;
  let trackGlowBody = input.trackSignal.r * input.trackSignal.w;
  let trackGlowEdge = input.trackSignal.g * input.trackSignal.w;
  let trackGlowCenter = input.trackSignal.b * input.trackSignal.w;
  color = color + vec3f(0.06, 0.74, 0.72) * trackGlowBody * (0.04 + field.render.z * 0.08) * interior;
  color = color + vec3f(0.62, 1.0, 0.92) * (trackGlowEdge * 0.68 + trackGlowCenter * 0.08) * (0.44 + field.render.z) * interior;
  return vec4f(pow(max(color, vec3f(0.0)), vec3f(0.92)), 1.0);
}
