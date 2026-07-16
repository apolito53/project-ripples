struct ArenaParams {
  viewProjection: mat4x4f,
  params: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) height01: f32,
  @location(1) angle01: f32,
};

@group(0) @binding(0) var<uniform> arena: ArenaParams;

const SEGMENTS: f32 = 256.0;
const PI2: f32 = 6.2831853;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corner = vertexIndex % 6u;
  let useNext = select(false, true, corner == 1u || corner == 2u || corner == 5u);
  let useTop = select(false, true, corner == 2u || corner == 4u || corner == 5u);
  let segment = f32(instanceIndex) + select(0.0, 1.0, useNext);
  let angle = segment / SEGMENTS * PI2;
  let height01 = select(0.0, 1.0, useTop);
  let radius = max(1.0, arena.params.y);
  let wallHeight = max(1.0, arena.params.z);
  let baseY = arena.params.w;
  let worldPosition = vec3f(cos(angle) * radius, baseY + height01 * wallHeight, sin(angle) * radius);

  var output: VertexOutput;
  output.position = arena.viewProjection * vec4f(worldPosition, 1.0);
  output.height01 = height01;
  output.angle01 = fract(segment / SEGMENTS);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let visibleBody = smoothstep(0.0, 0.1, input.height01) * (1.0 - smoothstep(0.94, 1.0, input.height01));
  let baseGlow = 1.0 - smoothstep(0.02, 0.24, input.height01);
  let crownGlow = smoothstep(0.56, 0.96, input.height01);
  let centerGlow = smoothstep(0.08, 0.42, input.height01) * (1.0 - smoothstep(0.72, 0.96, input.height01));
  let drift = sin(input.angle01 * 31.0 + arena.params.x * 0.9) * 0.5 + 0.5;
  let breath = 0.94 + sin(arena.params.x * 0.62) * 0.06;

  let baseCyan = vec3f(0.02, 0.95, 0.92);
  let deepBlue = vec3f(0.02, 0.17, 0.34);
  let upperViolet = vec3f(0.34, 0.42, 1.0);
  let whiteEdge = vec3f(0.86, 1.0, 0.96);
  var color = mix(baseCyan, deepBlue, smoothstep(0.0, 0.54, input.height01));
  color = mix(color, upperViolet, smoothstep(0.5, 1.0, input.height01) * 0.42);
  color = mix(color, whiteEdge, baseGlow * 0.26 + crownGlow * 0.18);

  let alpha = visibleBody * breath *
    (0.018 + baseGlow * 0.07 + centerGlow * 0.025 + crownGlow * 0.03 + drift * 0.01);
  return vec4f(color * (1.02 + baseGlow * 0.7 + crownGlow * 0.34), alpha);
}
