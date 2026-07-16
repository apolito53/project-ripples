struct TrainingMarkerParams {
  viewProjection: mat4x4f,
  marker: vec4f,
  dimensions: vec4f,
  beam: vec4f,
  glow: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) kind: f32,
};

@group(0) @binding(0) var<uniform> training: TrainingMarkerParams;

fn quadCorner(vertexIndex: u32) -> vec2f {
  switch vertexIndex % 6u {
    case 0u: { return vec2f(-0.5, -0.5); }
    case 1u: { return vec2f(0.5, -0.5); }
    case 2u: { return vec2f(0.5, 0.5); }
    case 3u: { return vec2f(-0.5, -0.5); }
    case 4u: { return vec2f(0.5, 0.5); }
    default: { return vec2f(-0.5, 0.5); }
  }
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corner = quadCorner(vertexIndex);
  let yaw = training.marker.w;
  let across = vec3f(cos(yaw), 0.0, -sin(yaw));
  let normal = vec3f(sin(yaw), 0.0, cos(yaw));
  let center = training.marker.xyz;
  var localCenter = vec2f(0.0);
  var size = vec2f(1.0);
  var normalOffset = 0.0;

  if (instanceIndex == 0u || instanceIndex == 1u) {
    let side = select(-1.0, 1.0, instanceIndex == 1u);
    localCenter = vec2f(side * training.dimensions.x, training.dimensions.y * 0.5);
    size = vec2f(training.dimensions.z, training.dimensions.y);
  } else if (instanceIndex == 2u) {
    localCenter = vec2f(0.0, training.beam.x);
    size = vec2f(training.dimensions.x * 2.0 - training.dimensions.z, training.beam.y);
    normalOffset = training.beam.z * 0.08;
  } else {
    localCenter = vec2f(0.0, training.glow.x * 0.5);
    size = vec2f(training.beam.w, training.glow.x);
    normalOffset = -0.04;
  }

  let local = localCenter + corner * size;
  let worldPosition = center + across * local.x + vec3f(0.0, local.y, 0.0) + normal * normalOffset;
  var output: VertexOutput;
  output.position = training.viewProjection * vec4f(worldPosition, 1.0);
  output.uv = corner + vec2f(0.5);
  output.kind = f32(instanceIndex);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let edgeX = 1.0 - smoothstep(0.34, 0.5, abs(input.uv.x - 0.5));
  let edgeY = 1.0 - smoothstep(0.34, 0.5, abs(input.uv.y - 0.5));
  let boxShape = edgeX * edgeY;
  let centerDistance = length(input.uv - vec2f(0.5));
  let centerGlow = 1.0 - smoothstep(0.05, 0.72, centerDistance);
  let pulse = 0.88 + sin(training.dimensions.w * 2.3 + input.kind * 1.7) * 0.12;

  if (input.kind == 2.0) {
    let magenta = vec3f(1.0, 0.2, 0.78);
    return vec4f(magenta * (3.0 + boxShape * 2.2) * pulse, boxShape * 0.34);
  }
  if (input.kind == 3.0) {
    let cyanGlow = mix(vec3f(0.02, 0.42, 0.5), vec3f(0.48, 1.0, 0.9), centerGlow);
    return vec4f(cyanGlow * (1.2 + centerGlow * 2.6) * pulse, centerGlow * 0.18);
  }

  let cyan = vec3f(0.16, 1.0, 0.84);
  return vec4f(cyan * (3.2 + boxShape * 2.4) * pulse, boxShape * 0.62);
}
