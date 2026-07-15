struct PulseParams {
  viewProjection: mat4x4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  params: vec4f,
};

struct PulseData {
  wave: vec4f,
  metadata: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
  @location(3) ring: vec2f,
};

@group(0) @binding(0) var<uniform> pulseParams: PulseParams;
@group(0) @binding(1) var<storage, read> pulses: array<PulseData>;

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

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let pulse = pulses[instanceIndex];
  let local = quadCorner(vertexIndex);
  let time = pulseParams.params.x;
  let baseSpeed = pulseParams.params.y;
  let age = max(0.0, time - pulse.wave.z);
  let speedMultiplier = max(0.05, pulse.metadata.x);
  let strength = max(0.0, pulse.wave.w);
  let rippleRadius = age * baseSpeed * speedMultiplier;
  let shimmer = 0.5 + 0.5 * sin(time * 6.2 + pulse.wave.x * 0.37 + pulse.wave.y * 0.29);
  let size = clamp(0.86 + strength * 0.18 + pulse.metadata.y * 0.16 + shimmer * 0.1, 0.72, 1.55);
  let center = vec3f(pulse.wave.x, 0.52 + strength * 0.18, pulse.wave.y);
  let right = normalize(pulseParams.cameraRight.xyz);
  let up = normalize(pulseParams.cameraUp.xyz);
  let worldPosition = center + right * local.x * size + up * local.y * size;
  let hue = pulse.metadata.w;
  let colorA = vec3f(0.14, 0.92, 0.94);
  let colorB = vec3f(1.0, 0.62, 0.24);

  var output: VertexOutput;
  output.position = pulseParams.viewProjection * vec4f(worldPosition, 1.0);
  output.local = local;
  output.color = mix(colorA, colorB, clamp(hue, 0.0, 1.0));
  output.alpha = strength * max(0.0, 1.0 - age / max(0.4, pulse.metadata.z)) * 0.13;
  output.ring = vec2f(clamp(rippleRadius * 0.018, 0.16, 0.82), 0.18 + pulse.metadata.y * 0.02);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dist = length(input.local);
  let body = smoothstep(1.0, 0.0, dist) * 0.05;
  let ring = exp(-pow((dist - input.ring.x) / max(0.025, input.ring.y), 2.0));
  let core = smoothstep(0.12, 0.0, dist);
  let alpha = (body + ring * 0.18 + core * 0.08) * input.alpha;
  if (alpha < 0.004) {
    discard;
  }

  let color = input.color * (1.05 + ring * 0.82 + core * 1.4);
  return vec4f(color, alpha);
}
