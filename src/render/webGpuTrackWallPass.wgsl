struct TrackWallParams {
  viewProjection: mat4x4f,
  params: vec4f,
  metadata: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) height01: f32,
  @location(1) course01: f32,
  @location(2) side01: f32,
};

@group(0) @binding(0) var<uniform> wall: TrackWallParams;
@group(0) @binding(1) var<storage, read> segments: array<vec4f>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let sideIndex = vertexIndex / 6u;
  let corner = vertexIndex % 6u;
  let segmentCount = max(2u, u32(wall.params.w));
  let nextIndex = (instanceIndex + 1u) % segmentCount;
  let useNext = corner == 1u || corner == 2u || corner == 5u;
  let useTop = corner == 2u || corner == 4u || corner == 5u;
  let segmentIndex = select(instanceIndex, nextIndex, useNext);
  let packed = segments[segmentIndex];
  let edge = select(packed.xy, packed.zw, sideIndex == 1u);
  let height01 = select(0.0, 1.0, useTop);
  let worldPosition = vec3f(edge.x, wall.params.y + height01 * wall.params.z, edge.y);

  var output: VertexOutput;
  output.position = wall.viewProjection * vec4f(worldPosition, 1.0);
  output.height01 = height01;
  output.course01 = f32(segmentIndex) / f32(segmentCount);
  output.side01 = f32(sideIndex);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseGlow = 1.0 - smoothstep(0.0, 0.34, input.height01);
  let crownGlow = smoothstep(0.36, 1.0, input.height01);
  let centerFade = smoothstep(0.02, 0.16, input.height01) *
    (1.0 - smoothstep(0.78, 1.0, input.height01));
  let currentBand = pow(0.5 + 0.5 * sin(input.course01 * 58.0 - wall.params.x * 1.15), 3.0);
  let pulse = 0.92 + sin(wall.params.x * 0.9 + input.course01 * 42.0 + input.side01 * 1.4) * 0.08;

  let cyan = vec3f(0.03, 1.0, 0.88);
  let blue = vec3f(0.02, 0.26, 0.58);
  let violet = vec3f(0.56, 0.48, 1.0);
  var color = mix(cyan, blue, smoothstep(0.0, 0.7, input.height01));
  color = mix(color, violet, crownGlow * 0.38 + input.side01 * 0.04);
  color = mix(color, vec3f(0.88, 1.0, 0.96), baseGlow * 0.22 + crownGlow * 0.16);

  let alpha = pulse *
    (baseGlow * 0.5 + centerFade * 0.08 + crownGlow * 0.22 + currentBand * centerFade * 0.06);
  return vec4f(color * (3.25 + baseGlow * 2.4 + crownGlow * 1.55 + currentBand * 0.55), alpha);
}
