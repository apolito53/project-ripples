struct SkyboxParams {
  cameraQuaternion: vec4f,
  params: vec4f,
  clearColor: vec4f,
  repeatOffset: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) ndc: vec2f,
};

@group(0) @binding(0) var skySampler: sampler;
@group(0) @binding(1) var skyTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> sky: SkyboxParams;

fn rotateByQuaternion(vector: vec3f, quaternion: vec4f) -> vec3f {
  let qv = quaternion.xyz;
  let t = 2.0 * cross(qv, vector);
  return vector + quaternion.w * t + cross(qv, t);
}

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
  output.ndc = position;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let aspect = max(0.1, sky.params.y);
  let fovRadians = sky.params.z;
  let halfHeight = tan(fovRadians * 0.5);
  let cameraDirection = normalize(vec3f(input.ndc.x * aspect * halfHeight, input.ndc.y * halfHeight, -1.0));
  let worldDirection = normalize(rotateByQuaternion(cameraDirection, sky.cameraQuaternion));
  let longitude = atan2(worldDirection.z, worldDirection.x) / 6.2831853 + 0.5;
  let latitude = 0.5 - asin(clamp(worldDirection.y, -1.0, 1.0)) / 3.14159265;
  let uv = vec2f(longitude, clamp(latitude * sky.repeatOffset.x + sky.repeatOffset.y, 0.0, 0.999));
  let sampledColor = textureSample(skyTexture, skySampler, uv).rgb;
  let horizon = smoothstep(-0.22, 0.32, worldDirection.y);
  let fallbackGradient = mix(sky.clearColor.rgb * 0.55, sky.clearColor.rgb * 1.36 + vec3f(0.01, 0.04, 0.08), horizon);
  let textureReady = sky.params.w;
  let upperHemisphere = smoothstep(-0.08, 0.08, worldDirection.y);
  let color = mix(fallbackGradient, sampledColor, textureReady * upperHemisphere);
  return vec4f(color, 1.0);
}
