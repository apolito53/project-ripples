struct EchoParams {
  viewProjection: mat4x4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  params: vec4f,
};

struct EchoData {
  positionAge: vec4f,
  shape: vec4f,
};

struct EchoBurstData {
  positionAge: vec4f,
  effect: vec4f,
};

struct BillboardVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
  @location(3) shape: f32,
  @location(4) shimmer: f32,
};

@group(0) @binding(0) var<uniform> echoParams: EchoParams;
@group(0) @binding(1) var<storage, read> echoes: array<EchoData>;
@group(0) @binding(2) var<storage, read> bursts: array<EchoBurstData>;

const ECHO_BILLBOARD_COMPONENTS_PER_ECHO: u32 = 31u;
const ECHO_ORB_COMPONENTS_PER_ECHO: u32 = 3u;
const ECHO_MOTE_COUNT: u32 = 14u;
const ECHO_TRAIL_COUNT: u32 = 14u;
const ECHO_MOTE_COMPONENT_OFFSET: u32 = ECHO_ORB_COMPONENTS_PER_ECHO;
const ECHO_TRAIL_COMPONENT_OFFSET: u32 = ECHO_MOTE_COMPONENT_OFFSET + ECHO_MOTE_COUNT;
const ECHO_BURST_COMPONENTS: u32 = 2u;
const ECHO_COLUMN_HEIGHT: f32 = 7.4;
const ECHO_COLUMN_BASE_LIFT: f32 = 1.45;
const ECHO_COLLECTION_SECONDS: f32 = 1.06;

fn quadCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return corners[index % 6u];
}

fn safeNormalize(value: vec3f, fallback: vec3f) -> vec3f {
  let valueLength = length(value);
  if (valueLength <= 0.0001) {
    return fallback;
  }
  return value / valueLength;
}

fn orbitPosition(basePosition: vec3f, columnRadius: f32, phase: f32, moteIndex: f32, time: f32) -> vec3f {
  let angle = phase + moteIndex * 2.399963 + time * (1.95 + moteIndex * 0.085);
  let radius = columnRadius * (3.1 + 0.62 * sin(time * 1.9 + moteIndex));
  let height = ECHO_COLUMN_BASE_LIFT + ECHO_COLUMN_HEIGHT * 0.5 + sin(moteIndex * 1.72 + phase) * columnRadius * 0.2;
  let verticalArc = sin(angle * 1.55 + phase) * columnRadius * 1.12 + sin(time * 2.7 + phase) * 0.16;
  return basePosition + vec3f(cos(angle) * radius, height + verticalArc, sin(angle) * radius * 0.72);
}

@vertex
fn billboardVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> BillboardVertexOutput {
  let local = quadCorner(vertexIndex);
  let time = echoParams.params.x;
  let echoCount = u32(echoParams.params.y + 0.5);
  let echoBillboardInstanceCount = echoCount * ECHO_BILLBOARD_COMPONENTS_PER_ECHO;
  let right = safeNormalize(echoParams.cameraRight.xyz, vec3f(1.0, 0.0, 0.0));
  let up = safeNormalize(echoParams.cameraUp.xyz, vec3f(0.0, 1.0, 0.0));
  let forward = safeNormalize(cross(right, up), vec3f(0.0, 0.0, 1.0));

  var center = vec3f(0.0);
  var basisX = right;
  var basisY = up;
  var size = vec2f(1.0);
  var color = vec3f(0.36, 1.0, 0.78);
  var alpha = 0.0;
  var shape = 3.0;
  var shimmer = 1.0;

  if (instanceIndex < echoBillboardInstanceCount) {
    let echoIndex = instanceIndex / ECHO_BILLBOARD_COMPONENTS_PER_ECHO;
    let component = instanceIndex % ECHO_BILLBOARD_COMPONENTS_PER_ECHO;
    let echo = echoes[echoIndex];
    let basePosition = echo.positionAge.xyz;
    let age = echo.positionAge.w;
    let radius = max(0.2, echo.shape.y);
    let columnRadius = max(0.25, echo.shape.z);
    let phase = echo.shape.w;
    let pulse = 0.5 + 0.5 * sin(age * 2.4 + phase);

    let coreHeight = ECHO_COLUMN_BASE_LIFT + ECHO_COLUMN_HEIGHT * 0.5;
    let bob = sin(age * 3.0 + phase) * 0.045;

    if (component == 0u) {
      center = basePosition + vec3f(0.0, coreHeight + bob, 0.0);
      size = vec2f(columnRadius * (3.65 + pulse * 0.72));
      color = vec3f(1.0, 0.82, 0.46);
      alpha = 0.72 + pulse * 0.18;
      shape = 7.0;
      shimmer = 3.35 + pulse * 1.25;
    } else if (component == 1u) {
      center = basePosition + vec3f(0.0, coreHeight + bob, 0.0);
      size = vec2f(columnRadius * (5.6 + pulse * 1.05));
      color = vec3f(0.42, 1.0, 0.82);
      alpha = 0.18 + pulse * 0.075;
      shape = 8.0;
      shimmer = 1.65 + pulse * 0.42;
    } else if (component == 2u) {
      center = basePosition + vec3f(0.0, coreHeight + bob, 0.0);
      size = vec2f(columnRadius * (7.4 + pulse * 1.35));
      color = vec3f(0.28, 0.8, 1.0);
      alpha = 0.07 + pulse * 0.032;
      shape = 9.0;
      shimmer = 0.92 + pulse * 0.28;
    } else if (component < ECHO_TRAIL_COMPONENT_OFFSET) {
      let moteIndex = f32(component - ECHO_MOTE_COMPONENT_OFFSET);
      center = orbitPosition(basePosition, columnRadius, phase, moteIndex, time);
      size = vec2f(columnRadius * (0.42 + pulse * 0.09));
      color = mix(vec3f(0.52, 1.0, 0.78), vec3f(0.82, 0.72, 1.0), fract(moteIndex * 0.37));
      alpha = (0.48 + pulse * 0.22) * (0.92 + radius * 0.015);
      shape = 3.0;
      shimmer = 2.85 + sin(time * 5.1 + moteIndex) * 0.58;
    } else {
      let trailIndex = f32(component - ECHO_TRAIL_COMPONENT_OFFSET);
      let current = orbitPosition(basePosition, columnRadius, phase, trailIndex, time);
      let previous = orbitPosition(basePosition, columnRadius, phase, trailIndex, time - 0.11);
      let axis = safeNormalize(current - previous, right);
      let side = safeNormalize(cross(axis, forward), up);
      center = (current + previous) * 0.5;
      basisX = axis;
      basisY = side;
      size = vec2f(max(columnRadius * 0.56, length(current - previous) * 0.86), columnRadius * 0.08);
      color = mix(vec3f(0.42, 1.0, 0.78), vec3f(0.65, 0.58, 1.0), fract(trailIndex * 0.37));
      alpha = (0.28 + pulse * 0.12) * (0.92 + radius * 0.015);
      shape = 4.0;
      shimmer = 1.55;
    }
  } else {
    let burstIndex = (instanceIndex - echoBillboardInstanceCount) / ECHO_BURST_COMPONENTS;
    let component = (instanceIndex - echoBillboardInstanceCount) % ECHO_BURST_COMPONENTS;
    let burst = bursts[burstIndex];
    let age = max(0.0, burst.positionAge.w);
    let progress = clamp(age / ECHO_COLLECTION_SECONDS, 0.0, 1.0);
    let fade = max(0.0, 1.0 - progress);
    let easeOut = 1.0 - pow(1.0 - progress, 3.0);
    let columnRadius = max(0.25, burst.effect.w);
    let basePosition = burst.positionAge.xyz;
    let coreY = burst.effect.x;

    if (component == 0u) {
      center = vec3f(basePosition.x, coreY + easeOut * 0.62, basePosition.z);
      size = vec2f(columnRadius * (1.34 + easeOut * 1.1), columnRadius * (2.8 + easeOut * 2.4));
      color = vec3f(1.0, 0.86, 0.5);
      alpha = 0.22 * pow(fade, 1.08) * max(0.35, burst.effect.y);
      shape = 5.0;
      shimmer = 2.4 + fade * 2.8;
    } else {
      center = vec3f(basePosition.x, coreY, basePosition.z);
      size = vec2f(columnRadius * (2.35 + easeOut * 2.75), columnRadius * (3.15 + easeOut * 3.25));
      color = vec3f(0.5, 1.0, 0.86);
      alpha = 0.17 * pow(fade, 0.9) * max(0.35, burst.effect.y);
      shape = 6.0;
      shimmer = 1.3 + fade * 0.8;
    }
  }

  let worldPosition = center + basisX * local.x * size.x + basisY * local.y * size.y;
  var output: BillboardVertexOutput;
  output.position = echoParams.viewProjection * vec4f(worldPosition, 1.0);
  output.local = local;
  output.color = color;
  output.alpha = alpha;
  output.shape = shape;
  output.shimmer = shimmer;
  return output;
}

@fragment
fn billboardFragmentMain(input: BillboardVertexOutput) -> @location(0) vec4f {
  let dist = length(input.local);
  var alphaShape = smoothstep(1.0, 0.0, dist);
  var energy = input.shimmer;

  if (input.shape < 3.5) {
    let pin = smoothstep(0.28, 0.0, dist);
    alphaShape = pin * 0.9 + smoothstep(0.72, 0.08, dist) * 0.14;
    energy = energy + pin * 4.1;
  } else if (input.shape < 4.5) {
    let along = smoothstep(1.0, 0.0, abs(input.local.x));
    let across = smoothstep(1.0, 0.0, abs(input.local.y));
    alphaShape = along * across * across;
    energy = energy * 1.45;
  } else if (input.shape < 5.5) {
    let diamond = abs(input.local.x) * 0.68 + abs(input.local.y) * 0.34;
    alphaShape = smoothstep(1.0, 0.16, diamond);
    energy = energy + alphaShape * 3.2;
  } else {
    let diamond = abs(input.local.x) * 0.5 + abs(input.local.y) * 0.28;
    alphaShape = smoothstep(1.0, 0.1, diamond) * smoothstep(1.1, 0.0, dist);
    energy = energy * 0.9;
  }

  if (input.shape > 6.5 && input.shape < 7.5) {
    let innerSun = smoothstep(0.18, 0.0, dist);
    let core = smoothstep(0.42, 0.0, dist);
    let halo = smoothstep(1.0, 0.1, dist);
    alphaShape = innerSun * 0.95 + core * 0.46 + halo * 0.16;
    energy = energy + innerSun * 8.4 + core * 3.6 + halo * 0.8;
  } else if (input.shape > 7.5 && input.shape < 8.5) {
    let core = smoothstep(0.24, 0.0, dist);
    let body = smoothstep(0.86, 0.0, dist);
    alphaShape = body * 0.44 + core * 0.18;
    energy = energy + core * 2.2 + body * 0.5;
  } else if (input.shape > 8.5) {
    let outer = smoothstep(1.0, 0.0, dist);
    let rim = smoothstep(0.92, 0.38, dist) * smoothstep(0.04, 0.42, dist);
    alphaShape = outer * 0.18 + rim * 0.22;
    energy = energy * 0.88 + rim * 0.7;
  }

  let alpha = alphaShape * input.alpha;
  if (alpha < 0.004) {
    discard;
  }

  return vec4f(input.color * energy, alpha);
}
