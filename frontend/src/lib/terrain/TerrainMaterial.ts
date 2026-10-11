import * as THREE from 'three'

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normal;
  vec3 transformedNormal = normalMatrix * normal;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D splatA;
uniform sampler2D splatB;
uniform sampler2D tex0; uniform sampler2D tex1; uniform sampler2D tex2; uniform sampler2D tex3;
uniform sampler2D tex4; uniform sampler2D tex5; uniform sampler2D tex6; uniform sampler2D tex7;
uniform float worldSize;
uniform float texScale;
uniform float cellSize;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyAmbient;
uniform vec3 groundAmbient;
uniform float cliffAuto;
uniform float waterLevel;
uniform float waterEnabled;
uniform vec3 waterDeep;
uniform vec2 brushPos;
uniform float brushRadius;
uniform float brushSquare;
uniform float brushVisible;
uniform vec3 brushColor;
uniform float gridVisible;
uniform sampler2D maskTex;
uniform float maskVisible;
uniform vec4 selRect;
uniform float selMode;
uniform float selTime;
varying vec3 vWorldPos;
varying vec3 vNormal;

// Two scales mixed together hide texture tiling at a distance.
vec3 tap(sampler2D t, vec2 uv) {
  return mix(texture2D(t, uv).rgb, texture2D(t, uv * 0.23 + 0.37).rgb, 0.35);
}

void main() {
  vec3 n = normalize(vNormal);
  vec2 suv = vWorldPos.xz / worldSize;
  vec2 tuv = vWorldPos.xz / texScale;
  vec4 a = texture2D(splatA, suv);
  vec4 b = texture2D(splatB, suv);
  float total = max(dot(a, vec4(1.0)) + dot(b, vec4(1.0)), 0.0001);

  vec3 col = vec3(0.0);
  if (a.r > 0.004) col += tap(tex0, tuv) * a.r;
  if (a.g > 0.004) col += tap(tex1, tuv) * a.g;
  if (a.b > 0.004) col += tap(tex2, tuv) * a.b;
  if (a.a > 0.004) col += tap(tex3, tuv) * a.a;
  if (b.r > 0.004) col += tap(tex4, tuv) * b.r;
  if (b.g > 0.004) col += tap(tex5, tuv) * b.g;
  if (b.b > 0.004) col += tap(tex6, tuv) * b.b;
  if (b.a > 0.004) col += tap(tex7, tuv) * b.a;
  col /= total;

  // Automatic rock on steep slopes, triplanar so cliffs don't stretch.
  float slope = 1.0 - n.y;
  float rockW = smoothstep(0.32, 0.55, slope) * cliffAuto;
  if (rockW > 0.001) {
    vec3 w = abs(n); w /= (w.x + w.y + w.z);
    vec3 rx = texture2D(tex3, vWorldPos.zy / texScale).rgb;
    vec3 ry = texture2D(tex3, tuv).rgb;
    vec3 rz = texture2D(tex3, vWorldPos.xy / texScale).rgb;
    col = mix(col, rx * w.x + ry * w.y + rz * w.z, rockW);
  }

  // Simple stylised lighting: hemisphere ambient + wrapped sun.
  // Wrapped diffuse, darkened where the key light (sun or moon) is shadowed.
  float diff = max(dot(n, sunDir) * 0.8 + 0.2, 0.0) * mix(0.25, 1.0, getShadowMask());
  vec3 hemi = mix(groundAmbient, skyAmbient, n.y * 0.5 + 0.5);
  vec3 lit = col * (hemi + sunColor * diff);

  // Point lights from torches, braziers, lamps (same falloff as three's props).
  #if NUM_POINT_LIGHTS > 0
    vec3 vPos = (viewMatrix * vec4(vWorldPos, 1.0)).xyz;
    vec3 vN = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      vec3 L = pointLights[i].position - vPos;
      float d = max(length(L), 0.001);
      float cutoff = pointLights[i].distance;
      float att = cutoff > 0.0 ? pow(clamp(1.0 - pow(d / cutoff, 4.0), 0.0, 1.0), 2.0) / max(d * d, 0.01) : 0.0;
      lit += col * pointLights[i].color * att * max(dot(vN, L / d), 0.0) * RECIPROCAL_PI;
    }
  #endif

  if (waterEnabled > 0.5) {
    float depth = waterLevel - vWorldPos.y;
    if (depth > 0.0) {
      lit = mix(lit, waterDeep, clamp(depth / 7.0, 0.0, 0.88));
    }
    float foam = 1.0 - smoothstep(0.0, 0.35, abs(depth));
    // Foam is lit like everything else, so it doesn't glow at night.
    vec3 foamColor = vec3(0.85, 0.92, 0.95) * clamp(skyAmbient * 1.4 + sunColor * 0.7, 0.0, 1.0);
    lit = mix(lit, foamColor, foam * 0.35);
  }

  if (gridVisible > 0.5) {
    vec2 g = abs(fract(vWorldPos.xz / (cellSize * 4.0) - 0.5) - 0.5) / fwidth(vWorldPos.xz / (cellSize * 4.0));
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    lit = mix(lit, vec3(0.0), line * 0.25);
  }

  if (maskVisible > 0.0) {
    // Quick-mask style red overlay; maskVisible is its opacity.
    float m = texture2D(maskTex, suv).r;
    lit = mix(lit, vec3(0.95, 0.15, 0.2), m * maskVisible);
  }

  if (selMode > 0.5) {
    // Marching-ants outline around the marquee selection / floating paste.
    vec2 p = vWorldPos.xz;
    vec2 lo = selRect.xy;
    vec2 hi = selRect.zw;
    float inside = step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y);
    float edge = min(min(p.x - lo.x, hi.x - p.x), min(p.y - lo.y, hi.y - p.y));
    float w = max(0.18, fwidth(p.x) * 1.5);
    float outline = inside * (1.0 - step(w, edge));
    float ants = step(0.5, fract((p.x + p.y) * 0.25 - selTime * 0.8));
    vec3 tint = selMode > 1.5 ? vec3(0.15, 0.5, 0.95) : vec3(0.6, 0.75, 1.0);
    lit = mix(lit, tint, inside * (selMode > 1.5 ? 0.22 : 0.08));
    lit = mix(lit, mix(vec3(0.05), vec3(1.0), ants), outline);
  }

  if (brushVisible > 0.5) {
    vec2 bd = abs(vWorldPos.xz - brushPos);
    float d = brushSquare > 0.5 ? max(bd.x, bd.y) : length(bd);
    float w = max(0.12, brushRadius * 0.035);
    float ring = smoothstep(brushRadius - w * 2.0, brushRadius - w, d) * (1.0 - smoothstep(brushRadius, brushRadius + w, d));
    float inner = (1.0 - smoothstep(0.0, brushRadius, d)) * 0.12;
    lit = mix(lit, brushColor, clamp(ring + inner, 0.0, 1.0));
  }

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function createTerrainMaterial(
  splatA: THREE.Texture,
  splatB: THREE.Texture,
  layers: THREE.Texture[],
  worldSize: number,
  cellSize: number,
): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    splatA: { value: splatA },
    splatB: { value: splatB },
    worldSize: { value: worldSize },
    cellSize: { value: cellSize },
    texScale: { value: 8 },
    sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
    skyAmbient: { value: new THREE.Color(0.45, 0.5, 0.6) },
    groundAmbient: { value: new THREE.Color(0.25, 0.22, 0.18) },
    cliffAuto: { value: 1 },
    waterLevel: { value: 0 },
    waterEnabled: { value: 1 },
    waterDeep: { value: new THREE.Color(0.03, 0.12, 0.18) },
    brushPos: { value: new THREE.Vector2() },
    brushRadius: { value: 8 },
    brushSquare: { value: 0 },
    brushVisible: { value: 0 },
    brushColor: { value: new THREE.Color(0.92, 0.95, 1.0) },
    gridVisible: { value: 0 },
    maskTex: { value: null },
    maskVisible: { value: 0 },
    selRect: { value: new THREE.Vector4() },
    selMode: { value: 0 },
    selTime: { value: 0 },
  }
  layers.forEach((t, i) => (uniforms['tex' + i] = { value: t }))
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    lights: true,
  })
}
