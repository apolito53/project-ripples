struct ShadowMapParams {
  lightViewProjection: mat4x4f,
  light: vec4f,
  settings: vec4f,
};

struct ShadowProxyData {
  positionRadius: vec4f,
  params: vec4f,
};

@group(0) @binding(0) var<uniform> shadowMap: ShadowMapParams;
@group(0) @binding(1) var<storage, read> shadowCasters: array<ShadowProxyData>;

fn quadLocal(vertexIndex: u32) -> vec2f {
  let corner = vertexIndex % 6u;
  if (corner == 0u) {
    return vec2f(-1.0, 0.0);
  }
  if (corner == 1u) {
    return vec2f(1.0, 0.0);
  }
  if (corner == 2u) {
    return vec2f(-1.0, 1.0);
  }
  if (corner == 3u) {
    return vec2f(-1.0, 1.0);
  }
  if (corner == 4u) {
    return vec2f(1.0, 0.0);
  }
  return vec2f(1.0, 1.0);
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
) -> @builtin(position) vec4f {
  let caster = shadowCasters[instanceIndex];
  let local = quadLocal(vertexIndex);
  let cardIndex = vertexIndex / 6u;
  let lightForward = safeNormalize(-shadowMap.light.xyz, vec3f(0.25, -0.82, -0.48));
  let planarRight = safeNormalize(cross(vec3f(0.0, 1.0, 0.0), lightForward), vec3f(1.0, 0.0, 0.0));
  let planarForward = safeNormalize(cross(lightForward, planarRight), vec3f(0.0, 0.0, 1.0));
  let diagonalA = safeNormalize(planarRight + planarForward, planarRight);
  let diagonalB = safeNormalize(planarRight - planarForward, planarForward);
  let casterStrength = clamp(caster.params.x, 0.0, 0.82);
  let proxyRadius = max(0.08, caster.positionRadius.w * (0.92 + casterStrength * 0.42));
  let proxyHeight = max(0.08, caster.params.y);
  let shapeId = u32(caster.params.z + 0.5);
  let basePosition = caster.positionRadius.xyz;
  var axisX = planarRight;
  var axisY = vec3f(0.0, 1.0, 0.0);
  var center = basePosition;
  var radiusScale = proxyRadius;
  var heightScale = proxyHeight;

  if (shapeId == 1u) {
    center = basePosition + vec3f(0.0, proxyHeight * 0.52, 0.0);
    heightScale = proxyHeight * 0.5;
    if (cardIndex == 1u) {
      axisX = planarForward;
    } else if (cardIndex == 2u) {
      axisX = diagonalA;
    }
    let worldPosition = center + axisX * local.x * radiusScale + axisY * (local.y - 0.5) * heightScale * 2.0;
    return shadowMap.lightViewProjection * vec4f(worldPosition, 1.0);
  }

  if (shapeId == 3u) {
    center = basePosition + vec3f(0.0, proxyHeight, 0.0);
    axisY = planarForward;
    if (cardIndex == 1u) {
      axisX = diagonalA;
      axisY = diagonalB;
    } else if (cardIndex == 2u) {
      axisX = diagonalB;
      axisY = diagonalA;
    }
    let worldPosition = center + axisX * local.x * radiusScale + axisY * (local.y - 0.5) * radiusScale;
    return shadowMap.lightViewProjection * vec4f(worldPosition, 1.0);
  }

  if (cardIndex == 1u) {
    axisX = planarForward;
  } else if (cardIndex == 2u) {
    axisX = diagonalA;
  }
  let worldPosition = basePosition + axisX * local.x * radiusScale + vec3f(0.0, local.y * heightScale, 0.0);

  return shadowMap.lightViewProjection * vec4f(worldPosition, 1.0);
}
