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
// The key light's (sun or moon) shadow alone. three's getShadowMask would also multiply in the
// point lights' shadows, which only darken their own light below.
float keyShadow() {
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow ds = directionalLightShadows[0];
    return getShadow(directionalShadowMap[0], ds.shadowMapSize, ds.shadowIntensity, ds.shadowBias, ds.shadowRadius, vDirectionalShadowCoord[0]);
  #else
    return 1.0;
  #endif
}
// The palette: one texture per layer. Each chunk names its four textures in slotTex, and each
// texel's weights for those four are in weightTex. Both are sampled nearest, so chunks keep hard edges.
uniform sampler2DArray palette;
uniform sampler2D slotTex;
uniform sampler2D weightTex;
uniform float chunksSide;
uniform float chunkWorld;
uniform float rockLayer;
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
// The width of a paint chunk in world units for the chunk lines; 0 hides them.
uniform float chunkLineWorld;
// The paint chunk under the cursor as world x0, z0, x1, z1; tinted so the Layers panel's chunk is visible.
uniform vec4 chunkHover;
// The width of a tile in world units when the map is a client region; 0 hides the tile borders.
uniform float tileWorld;
uniform sampler2D maskTex;
uniform float maskVisible;
uniform vec4 selRect;
uniform float selMode;
uniform float selTime;
varying vec3 vWorldPos;
varying vec3 vNormal;

// Two scales mixed together hide texture tiling at a distance.
vec3 tap(float layer, vec2 uv) {
  return mix(texture(palette, vec3(uv, layer)).rgb, texture(palette, vec3(uv * 0.23 + 0.37, layer)).rgb, 0.35);
}

// Blends the chunk's four textures by this texel's weights. Slot ids are 0-255 with 255 empty.
vec3 blend(vec4 ids, vec4 w, vec2 tuv) {
  vec3 c = vec3(0.0);
  if (w.r > 0.004 && ids.r < 254.5) c += tap(ids.r, tuv) * w.r;
  if (w.g > 0.004 && ids.g < 254.5) c += tap(ids.g, tuv) * w.g;
  if (w.b > 0.004 && ids.b < 254.5) c += tap(ids.b, tuv) * w.b;
  if (w.a > 0.004 && ids.a < 254.5) c += tap(ids.a, tuv) * w.a;
  return c;
}

void main() {
  // Seen from below (the camera under the ground, or inside a hill), the ground is a dark ceiling.
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec2 suv = vWorldPos.xz / worldSize;
  vec2 tuv = vWorldPos.xz / texScale;
  vec2 cell = floor(vWorldPos.xz / chunkWorld);
  vec4 ids = floor(texture2D(slotTex, (cell + 0.5) / chunksSide) * 255.0 + 0.5);
  // Bilinear within the chunk, as the game filters its alpha maps. The four weights name this chunk's
  // own slots, so texels of a neighbouring chunk (other slots) are never mixed in: every tap is clamped
  // to this chunk's texels.
  vec2 res = vec2(textureSize(weightTex, 0));
  float per = res.x / chunksSide;
  vec2 tp = suv * res - 0.5;
  vec2 f = fract(tp);
  vec2 lo = cell * per;
  vec2 hi = lo + (per - 1.0);
  vec2 a = clamp(floor(tp), lo, hi);
  vec2 b = clamp(floor(tp) + 1.0, lo, hi);
  vec4 w = mix(
    mix(texelFetch(weightTex, ivec2(a), 0), texelFetch(weightTex, ivec2(b.x, a.y), 0), f.x),
    mix(texelFetch(weightTex, ivec2(a.x, b.y), 0), texelFetch(weightTex, ivec2(b), 0), f.x),
    f.y);
  float total = max(dot(w, vec4(1.0)), 0.0001);

  vec3 col = blend(ids, w, tuv) / total;

  // Automatic rock on steep slopes, triplanar so cliffs don't stretch.
  float slope = 1.0 - n.y;
  float rockW = smoothstep(0.32, 0.55, slope) * cliffAuto;
  if (rockW > 0.001) {
    vec3 w3 = abs(n); w3 /= (w3.x + w3.y + w3.z);
    vec3 rx = texture(palette, vec3(vWorldPos.zy / texScale, rockLayer)).rgb;
    vec3 ry = texture(palette, vec3(tuv, rockLayer)).rgb;
    vec3 rz = texture(palette, vec3(vWorldPos.xy / texScale, rockLayer)).rgb;
    col = mix(col, rx * w3.x + ry * w3.y + rz * w3.z, rockW);
  }

  // Simple stylised lighting: hemisphere ambient + wrapped sun.
  // Wrapped diffuse, darkened where the key light (sun or moon) is shadowed.
  float diff = max(dot(n, sunDir) * 0.8 + 0.2, 0.0) * mix(0.25, 1.0, keyShadow());
  vec3 hemi = mix(groundAmbient, skyAmbient, n.y * 0.5 + 0.5);
  vec3 lit = col * (hemi + sunColor * diff);

  // Point lights from torches, braziers, lamps (same falloff as three's props).
  #if NUM_POINT_LIGHTS > 0
    vec3 vPos = (viewMatrix * vec4(vWorldPos, 1.0)).xyz;
    vec3 vN = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    // The nearest lights cast shadows (three sorts shadowed lights first), so walls block them.
    #pragma unroll_loop_start
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      // A block per light: the unrolled copies would otherwise share one scope.
      {
      vec3 L = pointLights[i].position - vPos;
      float d = max(length(L), 0.001);
      float cutoff = pointLights[i].distance;
      float att = cutoff > 0.0 ? pow(clamp(1.0 - pow(d / cutoff, 4.0), 0.0, 1.0), 2.0) / max(d * d, 0.01) : 0.0;
      #if defined(USE_SHADOWMAP) && (UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS) && (defined(SHADOWMAP_TYPE_PCF) || defined(SHADOWMAP_TYPE_BASIC))
        if (att > 0.0) {
          PointLightShadow ps = pointLightShadows[i];
          att *= getPointShadow(pointShadowMap[i], ps.shadowMapSize, ps.shadowIntensity, ps.shadowBias, ps.shadowRadius, vPointShadowCoord[i], ps.shadowCameraNear, ps.shadowCameraFar);
        }
      #endif
      lit += col * pointLights[i].color * att * max(dot(vN, L / d), 0.0) * RECIPROCAL_PI;
      }
    }
    #pragma unroll_loop_end
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

  if (chunkLineWorld > 0.0) {
    // One thin line at each paint chunk's edge, in a pale blue that stays visible on most ground.
    vec2 c = vWorldPos.xz / chunkLineWorld;
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    float edge = 1.0 - min(min(g.x, g.y), 1.0);
    lit = mix(lit, vec3(0.55, 0.8, 1.0), edge * 0.6);
  }

  if (chunkHover.z > chunkHover.x && vWorldPos.x >= chunkHover.x && vWorldPos.x < chunkHover.z && vWorldPos.z >= chunkHover.y && vWorldPos.z < chunkHover.w) {
    lit = mix(lit, vec3(1.0), 0.1);
  }

  if (tileWorld > 0.0) {
    // One line at each tile's edge, drawn about a pixel wide in amber so it reads on any ground.
    vec2 t = vWorldPos.xz / tileWorld;
    vec2 g = abs(fract(t - 0.5) - 0.5) / fwidth(t);
    float edge = 1.0 - min(min(g.x, g.y), 1.0);
    lit = mix(lit, vec3(1.0, 0.72, 0.2), edge * 0.85);
  }

  if (maskVisible > 0.0) {
    // Quick-mask style red overlay; maskVisible is its opacity.
    float m = texture2D(maskTex, suv).r;
    lit = mix(lit, vec3(0.95, 0.15, 0.2), m * maskVisible);
  }

  if (selMode > 0.5) {
    // Marching-ants outline around the selected area / floating paste.
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
  palette: THREE.DataArrayTexture,
  slots: THREE.Texture,
  weights: THREE.Texture,
  worldSize: number,
  cellSize: number,
  chunkWorld: number,
  chunksSide: number,
): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    palette: { value: palette },
    slotTex: { value: slots },
    weightTex: { value: weights },
    chunksSide: { value: chunksSide },
    chunkWorld: { value: chunkWorld },
    rockLayer: { value: 3 },
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
    chunkLineWorld: { value: 0 },
    chunkHover: { value: new THREE.Vector4() },
    tileWorld: { value: 0 },
    maskTex: { value: null },
    maskVisible: { value: 0 },
    selRect: { value: new THREE.Vector4() },
    selMode: { value: 0 },
    selTime: { value: 0 },
  }
  return new THREE.ShaderMaterial({
    // Double-sided, so going under the surface shows a ceiling rather than the world from below.
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: true,
    lights: true,
  })
}
