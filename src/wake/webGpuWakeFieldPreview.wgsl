struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var wakeTexture: texture_2d<f32>;

fn loadWake(coord: vec2i, dimensions: vec2i) -> vec4f {
  return textureLoad(wakeTexture, clamp(coord, vec2i(0), dimensions - vec2i(1)), 0);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + vec2f(0.5);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(wakeTexture));
  let textureSize = vec2f(dimensions);
  let uv = clamp(input.uv, vec2f(0.0), vec2f(0.9999));
  // The synthetic diagnostic path lives near the arena center. Preview a
  // zoomed window so the computed wake is large enough to inspect in browser
  // smoke screenshots instead of becoming a tiny full-arena hairline.
  let sampleUv = clamp((uv - vec2f(0.5)) * 0.48 + vec2f(0.5), vec2f(0.0), vec2f(0.9999));
  let coord = vec2i(sampleUv * textureSize);
  let wake = loadWake(coord, dimensions);
  var signedHeight = wake.x;
  var heightEnergy = abs(wake.x);
  var velocityEnergy = abs(wake.y);
  var crestEnergy = max(wake.z, 0.0);

  // The real wake occupies a small portion of the diagnostic texture. A tiny
  // display-only dilation makes the compute output obvious without changing the
  // simulation texture that future scene passes will sample.
  for (var offsetY = -2; offsetY <= 2; offsetY = offsetY + 1) {
    for (var offsetX = -2; offsetX <= 2; offsetX = offsetX + 1) {
      let offset = vec2i(offsetX, offsetY);
      let falloff = max(0.0, 1.0 - length(vec2f(offset)) / 3.2);
      let neighbor = loadWake(coord + offset, dimensions);
      let weightedHeight = neighbor.x * falloff;

      if (abs(weightedHeight) > heightEnergy) {
        signedHeight = weightedHeight;
        heightEnergy = abs(weightedHeight);
      }

      velocityEnergy = max(velocityEnergy, abs(neighbor.y) * falloff);
      crestEnergy = max(crestEnergy, max(neighbor.z, 0.0) * falloff);
    }
  }

  let height = clamp(signedHeight * 34.0, -1.0, 1.0);
  let velocity = clamp(velocityEnergy * 24.0, 0.0, 1.0);
  let crest = clamp(crestEnergy * 3.8, 0.0, 1.0);
  let cell = abs(fract(sampleUv * textureSize / 24.0) - vec2f(0.5));
  let grid = 1.0 - smoothstep(0.46, 0.5, max(cell.x, cell.y));

  var color = vec3f(0.012, 0.018, 0.028);
  color = color + vec3f(0.01, 0.025, 0.045) * (uv.y + 0.25);
  color = color + max(height, 0.0) * vec3f(0.08, 0.82, 1.0);
  color = color + max(-height, 0.0) * vec3f(0.68, 0.18, 0.92);
  color = color + velocity * vec3f(0.08, 0.54, 0.18);
  color = color + crest * vec3f(1.0, 0.82, 0.42);
  color = color + grid * 0.018;

  return vec4f(pow(color, vec3f(0.9)), 1.0);
}
