struct ParticleParams {
  viewProjection: mat4x4f,
  params: vec4f,
};

struct ParticleData {
  positionAlpha: vec4f,
  colorSize: vec4f,
  extra: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) alpha: f32,
  @location(2) local: vec2f,
  @location(3) twinkle: f32,
  @location(4) cloudiness: f32,
};

@group(0) @binding(0) var<uniform> particleParams: ParticleParams;
@group(0) @binding(1) var<storage, read> particles: array<ParticleData>;

const PARTICLE_ENERGY_GAIN: f32 = 1.24;

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
  let particle = particles[instanceIndex];
  let local = quadCorner(vertexIndex);
  let worldPosition = vec4f(particle.positionAlpha.xyz, 1.0);
  var clipPosition = particleParams.viewProjection * worldPosition;
  let viewport = max(particleParams.params.zw, vec2f(1.0, 1.0));
  let pixelRatio = max(0.25, particleParams.params.y);
  let pointSize = clamp(particle.colorSize.w * pixelRatio * (102.0 / max(9.0, clipPosition.w)), 1.0, 11.0);
  let ndcOffset = local * pointSize / viewport;
  clipPosition = vec4f(clipPosition.xy + ndcOffset * clipPosition.w, clipPosition.zw);

  var output: VertexOutput;
  output.position = clipPosition;
  output.color = particle.colorSize.rgb;
  output.alpha = particle.positionAlpha.w;
  output.local = local;
  output.twinkle = 0.62 + 0.38 * sin(particleParams.params.x * 9.5 + particle.extra.x * 6.2831853);
  output.cloudiness = particle.extra.y;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let center = input.local * 0.5;
  let dist = length(center);
  let pinCore = smoothstep(0.075, 0.0, dist);
  let softMote = smoothstep(0.24, 0.035, dist);
  let glitterShape = pinCore * 0.86 + softMote * 0.14;
  let cloudBody = smoothstep(0.52, 0.0, dist);
  let cloudCore = smoothstep(0.32, 0.0, dist);
  let cloudShape = cloudBody * (0.44 + cloudCore * 0.56);
  let shape = mix(glitterShape, cloudShape, input.cloudiness);
  let twinkle = mix(input.twinkle, 0.88 + input.twinkle * 0.12, input.cloudiness);
  let alpha = min(shape * input.alpha * twinkle, 1.0);

  if (alpha < 0.004) {
    discard;
  }

  let glitterEnergy = 2.2 + pinCore * 4.6 + input.twinkle * 1.05;
  let cloudEnergy = 1.28 + cloudCore * 2.0 + cloudBody * 0.72;
  let color = input.color * mix(glitterEnergy, cloudEnergy, input.cloudiness) * PARTICLE_ENERGY_GAIN;
  return vec4f(color, alpha);
}
