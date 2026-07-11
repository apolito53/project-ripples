struct BloomParams {
  sizes: vec4f,
  effect: vec4f,
  direction: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var bloomSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> bloom: BloomParams;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0)
  );
  let position = positions[vertexIndex];

  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn brightPass(uv: vec2f) -> vec3f {
  let enabled = bloom.effect.z;
  let threshold = bloom.effect.x;
  let color = textureSample(sourceTexture, bloomSampler, uv).rgb;
  let brightness = max(max(color.r, max(color.g, color.b)), luminance(color) * 1.12);
  let mask = smoothstep(threshold, threshold + 0.32, brightness);
  return color * mask * enabled;
}

fn blurPass(uv: vec2f) -> vec3f {
  let targetSize = max(bloom.sizes.zw, vec2f(1.0, 1.0));
  let texel = bloom.direction.xy / targetSize;
  var color = textureSample(sourceTexture, bloomSampler, uv).rgb * 0.34;
  color = color + textureSample(sourceTexture, bloomSampler, uv + texel * 1.25).rgb * 0.24;
  color = color + textureSample(sourceTexture, bloomSampler, uv - texel * 1.25).rgb * 0.24;
  color = color + textureSample(sourceTexture, bloomSampler, uv + texel * 2.7).rgb * 0.09;
  color = color + textureSample(sourceTexture, bloomSampler, uv - texel * 2.7).rgb * 0.09;
  return color;
}

fn compositePass(uv: vec2f) -> vec3f {
  let sceneColor = textureSample(sourceTexture, bloomSampler, uv).rgb;
  let bloomColor = textureSample(bloomTexture, bloomSampler, uv).rgb;
  let strength = min(max(0.0, bloom.effect.y) * bloom.effect.z, 0.32);
  let vignette = smoothstep(0.86, 0.18, distance(uv, vec2f(0.5, 0.5)));
  let localGlow = bloomColor * (0.22 + strength * 0.92);
  return sceneColor + localGlow + vec3f(0.003, 0.011, 0.02) * vignette;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let mode = bloom.effect.w;
  var color: vec3f;

  if (mode < 0.5) {
    color = brightPass(input.uv);
  } else if (mode < 1.5) {
    color = blurPass(input.uv);
  } else {
    color = compositePass(input.uv);
  }

  return vec4f(pow(max(color, vec3f(0.0)), vec3f(0.94)), 1.0);
}
