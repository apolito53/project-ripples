struct AvatarParams {
  viewProjection: mat4x4f,
  presentation: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  params: vec4f,
  shape: vec4f,
  primaryColor: vec4f,
  secondaryColor: vec4f,
  accentColor: vec4f,
  podShape: vec4f,
  podEffects: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
  @location(3) shape: f32,
};

@group(0) @binding(0) var<uniform> avatar: AvatarParams;

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
  let magnitude = length(value);
  if (magnitude < 0.0001) {
    return fallback;
  }
  return value / magnitude;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let local = quadCorner(vertexIndex);
  let yaw = avatar.params.z;
  let facing = safeNormalize(vec3f(sin(yaw), 0.0, cos(yaw)), vec3f(0.0, 0.0, 1.0));
  let podRight = safeNormalize(vec3f(cos(yaw), 0.0, -sin(yaw)), vec3f(1.0, 0.0, 0.0));
  let cameraRight = safeNormalize(avatar.cameraRight.xyz, vec3f(1.0, 0.0, 0.0));
  let cameraUp = safeNormalize(avatar.cameraUp.xyz, vec3f(0.0, 1.0, 0.0));
  let movement = clamp(avatar.presentation.w / 18.0, 0.0, 1.0);
  let playerPosition = avatar.presentation.xyz;
  let coreRadius = max(0.1, avatar.shape.x);
  let glowRadius = max(coreRadius, avatar.shape.y);
  let glowStrength = max(0.0, avatar.shape.z);
  let bodyLength = max(0.55, avatar.podShape.x);
  let bodyWidth = max(0.35, avatar.podShape.y);
  let bodyHeight = max(0.18, avatar.podShape.z);
  let noseLength = max(0.18, avatar.podShape.w);
  let tailLength = max(0.2, avatar.podEffects.x);
  let thrusterGlow = max(0.0, avatar.podEffects.y);
  let finGlow = max(0.0, avatar.podEffects.z);
  var center = playerPosition + vec3f(0.0, 0.38, 0.0);
  var size = vec2f(coreRadius, coreRadius);
  var axisX = cameraRight;
  var axisY = cameraUp;
  var color = avatar.primaryColor.xyz;
  var alpha = glowStrength;
  var shape = 0.0;

  // Instances 0-8 are the saved mote-core avatar asset. Keep this first block
  // intentionally close to the original diagnostic avatar so it remains a
  // reusable component instead of being swallowed by the pod proxy work.
  if (instanceIndex == 1u) {
    size = vec2f(glowRadius, glowRadius);
    color = avatar.secondaryColor.xyz;
    alpha = 0.16 + glowStrength * 0.18;
    shape = 1.0;
  } else if (instanceIndex == 2u) {
    center = playerPosition + facing * (coreRadius + 0.02) + vec3f(0.0, 0.32, 0.0);
    size = vec2f(coreRadius * 0.25, coreRadius * 0.25);
    color = avatar.accentColor.xyz;
    alpha = 0.22 + glowStrength * 0.14;
    shape = 2.0;
  } else if (instanceIndex >= 3u && instanceIndex < 9u) {
    let moteIndex = f32(instanceIndex - 3u);
    let phase = moteIndex * 2.399963 + avatar.params.x * (1.8 + moteIndex * 0.07);
    let orbitRadius = coreRadius + 0.12 * sin(avatar.params.x * 2.1 + moteIndex);
    let orbit = vec3f(cos(phase) * orbitRadius, 0.18 + sin(phase * 1.7) * 0.32, sin(phase) * orbitRadius * 0.7);
    center = playerPosition + orbit + vec3f(0.0, 0.32, 0.0);
    size = vec2f(0.22 + movement * 0.08, 0.22 + movement * 0.08);
    color = mix(avatar.primaryColor.xyz, avatar.secondaryColor.xyz, fract(moteIndex * 0.37));
    alpha = 0.34 + glowStrength * 0.4;
    shape = 3.0;
  } else if (instanceIndex == 9u) {
    center = playerPosition + vec3f(0.0, 0.37, 0.0);
    size = vec2f(bodyWidth * 0.58, bodyHeight * 1.1);
    color = avatar.primaryColor.xyz;
    alpha = 0.42 + glowStrength * 0.14;
    shape = 4.0;
  } else if (instanceIndex == 10u) {
    center = playerPosition + vec3f(0.0, 0.22, 0.0);
    axisX = podRight;
    axisY = facing;
    size = vec2f(bodyWidth * 0.76, bodyLength * 0.72);
    color = mix(avatar.primaryColor.xyz, avatar.secondaryColor.xyz, 0.28);
    alpha = 0.22 + movement * 0.08;
    shape = 5.0;
  } else if (instanceIndex == 11u) {
    center = playerPosition + facing * (bodyLength * 0.58 + noseLength * 0.22) + vec3f(0.0, 0.36, 0.0);
    size = vec2f(0.18 + movement * 0.03, 0.18 + movement * 0.03);
    color = avatar.accentColor.xyz;
    alpha = 0.58 + glowStrength * 0.18;
    shape = 6.0;
  } else if (instanceIndex == 12u) {
    center = playerPosition + facing * 0.18 + vec3f(0.0, 0.43, 0.0);
    axisX = podRight;
    axisY = facing;
    size = vec2f(0.04, bodyLength * 0.55);
    color = avatar.accentColor.xyz;
    alpha = 0.5 + glowStrength * 0.12;
    shape = 7.0;
  } else if (instanceIndex == 13u) {
    center = playerPosition - facing * (bodyLength * 0.38 + tailLength * 0.22) + vec3f(0.0, 0.25, 0.0);
    axisX = podRight;
    axisY = facing;
    size = vec2f(bodyWidth * (0.42 + movement * 0.08), tailLength * 0.48);
    color = avatar.secondaryColor.xyz;
    alpha = 0.24 + movement * 0.22;
    shape = 8.0;
  } else if (instanceIndex == 14u || instanceIndex == 15u) {
    let side = select(-1.0, 1.0, instanceIndex == 15u);
    center = playerPosition - facing * (bodyLength * 0.5) + podRight * side * bodyWidth * 0.28 + vec3f(0.0, 0.28, 0.0);
    size = vec2f(0.13 + movement * 0.04, 0.13 + movement * 0.04);
    color = mix(avatar.primaryColor.xyz, avatar.accentColor.xyz, 0.35);
    alpha = thrusterGlow;
    shape = 9.0;
  } else if (instanceIndex == 16u || instanceIndex == 17u) {
    let side = select(-1.0, 1.0, instanceIndex == 17u);
    center = playerPosition - facing * 0.22 + podRight * side * bodyWidth * 0.52 + vec3f(0.0, 0.24, 0.0);
    axisX = podRight;
    axisY = facing;
    size = vec2f(bodyWidth * 0.28, bodyLength * 0.28);
    color = mix(avatar.secondaryColor.xyz, avatar.accentColor.xyz, 0.44);
    alpha = finGlow;
    shape = 10.0;
  } else {
    center = playerPosition - facing * (bodyLength * 0.44) + vec3f(0.0, 0.34, 0.0);
    size = vec2f(0.14 + movement * 0.03, 0.14 + movement * 0.03);
    color = avatar.secondaryColor.xyz;
    alpha = 0.45 + movement * 0.22;
    shape = 9.0;
  }

  let worldPosition = center + axisX * local.x * size.x + axisY * local.y * size.y;
  var output: VertexOutput;
  output.position = avatar.viewProjection * vec4f(worldPosition, 1.0);
  output.local = local;
  output.color = color;
  output.alpha = alpha;
  output.shape = shape;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dist = length(input.local);
  var alphaShape = smoothstep(1.0, 0.0, dist);
  var energy = 2.2;

  if (input.shape == 0.0) {
    let core = smoothstep(0.28, 0.0, dist);
    alphaShape = core * 0.88 + alphaShape * 0.22;
    energy = 4.4 + core * 5.2;
  } else if (input.shape == 1.0) {
    alphaShape = smoothstep(1.0, 0.24, dist) * 0.55;
    energy = 1.6;
  } else if (input.shape == 2.0) {
    let pin = smoothstep(0.58, 0.0, dist);
    alphaShape = pin * 0.55;
    energy = 2.6;
  } else if (input.shape == 3.0) {
    let pin = smoothstep(0.18, 0.0, dist);
    alphaShape = pin * 0.82 + smoothstep(0.55, 0.08, dist) * 0.2;
    energy = 3.8 + pin * 4.4;
  } else if (input.shape == 4.0) {
    let body = smoothstep(1.0, 0.18, dist);
    let glint = smoothstep(0.38, 0.0, length(input.local - vec2f(0.18, 0.22)));
    alphaShape = body * 0.44 + glint * 0.18;
    energy = 2.4 + glint * 3.2;
  } else if (input.shape == 5.0) {
    let pointed = 1.0 - abs(input.local.x) * (0.62 + max(0.0, -input.local.y) * 0.44) - abs(input.local.y) * 0.38;
    alphaShape = smoothstep(0.0, 0.52, pointed) * smoothstep(1.0, 0.15, dist);
    energy = 1.75;
  } else if (input.shape == 6.0) {
    let pin = smoothstep(0.5, 0.0, dist);
    alphaShape = pin * 0.8 + smoothstep(0.92, 0.22, dist) * 0.16;
    energy = 4.4 + pin * 5.4;
  } else if (input.shape == 7.0) {
    let stripe = smoothstep(0.9, 0.0, abs(input.local.x)) * smoothstep(1.0, 0.0, abs(input.local.y));
    alphaShape = stripe * 0.72;
    energy = 3.2;
  } else if (input.shape == 8.0) {
    let cone = smoothstep(0.0, 0.75, 1.0 - abs(input.local.x) - max(0.0, input.local.y) * 0.38);
    alphaShape = cone * smoothstep(1.0, 0.0, abs(input.local.y));
    energy = 2.6 + max(0.0, -input.local.y) * 1.4;
  } else if (input.shape == 9.0) {
    let pin = smoothstep(0.42, 0.0, dist);
    alphaShape = pin * 0.78 + smoothstep(0.92, 0.18, dist) * 0.13;
    energy = 3.8 + pin * 4.2;
  } else if (input.shape == 10.0) {
    let fin = smoothstep(0.0, 0.58, 1.0 - abs(input.local.x) * 0.9 - abs(input.local.y + 0.2) * 0.46);
    alphaShape = fin * 0.58;
    energy = 2.1;
  }

  let alpha = alphaShape * input.alpha;
  if (alpha < 0.004) {
    discard;
  }

  return vec4f(input.color * energy, alpha);
}
