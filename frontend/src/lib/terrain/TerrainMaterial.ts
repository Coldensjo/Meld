import * as THREE from 'three'
import { CASCADE_SHADOW_GLSL } from '../engine/shadowCascades'
import { BAKED_SHADOW_LIGHT } from './bakedShadows'
import { LIGHT_POOL } from '../world/PropEffects'

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vNormal;
// Client Lighting's ground (Benilla's terrain.wgsl, MIT/Apache-2.0, after the client's fixed-function
// terrain): the light's rows in the client's gamma space, summed and clamped per vertex, then
// interpolated. clientLit is 0 under the editor's own lighting.
uniform float clientLit;
uniform vec3 sunDir;
uniform vec3 clientAmbient;
uniform vec3 clientDiffuse;
uniform vec3 clientSpecular;
// The pooled M2 lights' world positions and raw colours (PropEffects), and the paint chunk's width.
uniform int clientPointCount;
uniform vec3 clientPointPos[${LIGHT_POOL}];
uniform vec3 clientPointColor[${LIGHT_POOL}];
uniform float chunkWorld;
// The client adds a chunk's three nearest point lights, within this reach of its centre across the
// ground, to the ground's per-vertex light (Benilla's terrain.wgsl point_light_sum).
const float POINT_REACH = 33.570166;
vec3 pointLightSum(vec3 p, vec3 n) {
  vec2 anchor = (floor(p.xz / chunkWorld) + 0.5) * chunkWorld;
  int sel0 = -1, sel1 = -1, sel2 = -1;
  float d0 = 1e30, d1 = 1e30, d2 = 1e30;
  for (int i = 0; i < ${LIGHT_POOL}; i++) {
    if (i >= clientPointCount) break;
    vec3 dv = clientPointPos[i] - vec3(anchor.x, p.y, anchor.y);
    if (max(abs(dv.x), abs(dv.z)) > POINT_REACH) continue;
    float dd = dot(dv, dv);
    if (dd < d0) { d2 = d1; sel2 = sel1; d1 = d0; sel1 = sel0; d0 = dd; sel0 = i; }
    else if (dd < d1) { d2 = d1; sel2 = sel1; d1 = dd; sel1 = i; }
    else if (dd < d2) { d2 = dd; sel2 = i; }
  }
  vec3 sum = vec3(0.0);
  for (int s = 0; s < 3; s++) {
    int i = s == 0 ? sel0 : s == 1 ? sel1 : sel2;
    if (i < 0) break;
    vec3 toLight = clientPointPos[i] - p;
    float d = length(toLight);
    // Diffuse only, 1 / (0.7 d + 0.03 d^2), no cut-off.
    sum += clientPointColor[i] * max(dot(n, toLight / max(d, 1e-4)), 0.0) / max(0.7 * d + 0.03 * d * d, 1e-4);
  }
  return sum;
}
varying vec3 vPrimaryLit;
varying vec3 vPrimaryDark;
varying vec3 vSpecular;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormal = normal;
  if (clientLit > 0.5) {
    // Ambient (row 1) plus the sun's diffuse (row 0) times N.L, clamped; and without the sun, for a
    // vertex the sun's shadow covers. The sun's specular (row 9) with shininess 20, local viewer.
    vec3 n = normalize(normal);
    vec3 v = normalize(cameraPosition - worldPosition.xyz);
    vec3 h = normalize(sunDir + v);
    vec3 points = pointLightSum(worldPosition.xyz, n);
    vPrimaryLit = clamp(clientAmbient + clientDiffuse * max(dot(n, sunDir), 0.0) + points, 0.0, 1.0);
    vPrimaryDark = clamp(clientAmbient + points, 0.0, 1.0);
    vSpecular = clamp(clientSpecular * pow(max(dot(n, h), 0.0), 20.0), 0.0, 1.0);
  } else {
    vPrimaryLit = vPrimaryDark = vSpecular = vec3(0.0);
  }
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
${CASCADE_SHADOW_GLSL}
// The key light's (sun or moon) shadow alone, from its cascades. three's getShadowMask would also
// multiply in the point lights' shadows, which only darken their own light below.
float keyShadow() {
  return cascadeShadow(0);
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
// Where the paint's texel (0, 0) lies in the world: 0 for a region's terrain, the tile's corner for a
// world view's painted tile (world/worldPaint.ts).
uniform vec2 paintOrigin;
// The texture looks (world/textureLooks.ts) per palette entry, 256 wide: r is 0 for still or the speed
// plus one, g the scroll's direction (0 to 7), b 255 for overbright. lookTime is in seconds.
uniform sampler2D lookTex;
uniform float lookTime;
uniform float cellSize;
uniform vec3 sunDir;
uniform float clientLit;
varying vec3 vPrimaryLit;
varying vec3 vPrimaryDark;
varying vec3 vSpecular;
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
// The image brush under the ring (brushImage.ts): its grey levels, on or off, and its turn's cos and sin.
uniform sampler2D brushImg;
uniform float brushImgOn;
uniform vec2 brushImgRot;
uniform float gridVisible;
// Paint's "Show unpaintable chunks": the paint texture's palette index, or -1 for off.
uniform float unpaintable;
// The climb view: the cosine of the steepest walkable slope, or 0 for off.
uniform float climbCos;
// View › Height contours (#22): yards between contour lines, or 0 for off.
uniform float contourStep;
// The width of a paint chunk in world units for the chunk lines; 0 hides them.
uniform float chunkLineWorld;
// The paint chunk under the cursor as world x0, z0, x1, z1; tinted so the Layers panel's chunk is visible.
uniform vec4 chunkHover;
// The width of a tile in world units when the map is a client region; 0 hides the tile borders.
uniform float tileWorld;
uniform sampler2D maskTex;
// The client's baked shadows (MCSH) of a region, 255 in shadow; bakedShadowOn 0 when there are none or they are hidden.
uniform sampler2D bakedShadowTex;
uniform float bakedShadowOn;
uniform float maskVisible;
// The Map data overlay: 0 off, 1 zones, 2 impassable, 3 no tufts (see Terrain.setMapDataOverlay).
uniform float mapDataMode;
uniform vec3 mapDataZone;
uniform sampler2D chunkDataTex;
// A texel per cell of the map (Terrain.cellTex), two overlays in one sampler (#394): red the cells
// that grow no tufts (Map data's mode 3), green a free-form area (selMode 3), set inside (#183).
uniform sampler2D cellTex;
uniform vec4 selRect;
uniform float selMode;
uniform float selTime;
// The reference image (View › Reference Image, terrain/referenceImage.ts): its picture, drawn at
// refOpacity (0 off) over the rectangle centred on refCentre, refHalf its half width and height,
// turned by refRot (cos, sin); refEdit is the corner handles' half size while it is being placed (0
// for no outline). With the shadow maps the shader samples 15 textures, and WebGL2 guarantees only
// 16 (ANGLE on Windows gives no more): an overlay past the next must share a texture, as cellTex does.
uniform sampler2D refTex;
uniform float refOpacity;
uniform vec2 refCentre;
uniform vec2 refHalf;
uniform vec2 refRot;
uniform float refEdit;
varying vec3 vWorldPos;
varying vec3 vNormal;

// The sRGB transfer both ways, for the client's gamma-space light.
vec3 srgbOf(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 linearOf(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// Noggit Red's scroll directions (animUVOffset): the 45-degree step's offset per texture repeat.
const vec2 SCROLL[8] = vec2[8](vec2(0.0, 1.0), vec2(-1.0, 1.0), vec2(-1.0, 0.0), vec2(-1.0, -1.0), vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 0.0), vec2(1.0, 1.0));

// A texture the map scrolls moves a repeat every 1.6 s at speed 7, slower in proportion below, as
// Noggit Red draws it; an overbright one is drawn brighter.
// The alpha is the layer's sheen mask (paletteArray.ts): 8 bits in the RGBA array, 4 in the DXT3 one.
// The palette is mipmapped (#225) and sampled inside branches, where implicit derivatives are
// undefined, so every palette read takes its uv's derivatives from the top of main (textureGrad).
// The scroll's offset is the same over the draw, so it leaves them as they are.
vec4 tap(float layer, vec2 uv, vec2 dx, vec2 dy) {
  vec4 look = floor(texture2D(lookTex, vec2((layer + 0.5) / 256.0, 0.5)) * 255.0 + 0.5);
  if (look.r > 0.5) uv += SCROLL[int(look.g) & 7] * fract(lookTime * (look.r - 1.0) / (7.0 * 1.6));
  vec4 c = textureGrad(palette, vec3(uv, layer), dx, dy);
  return look.b > 127.5 ? vec4(c.rgb * 1.5, c.a) : c;
}

// Blends the chunk's four textures, and their sheen masks, by this texel's weights. Slot ids are
// 0-255 with 255 empty.
vec4 blend(vec4 ids, vec4 w, vec2 tuv, vec2 dx, vec2 dy) {
  vec4 c = vec4(0.0);
  if (w.r > 0.004 && ids.r < 254.5) c += tap(ids.r, tuv, dx, dy) * w.r;
  if (w.g > 0.004 && ids.g < 254.5) c += tap(ids.g, tuv, dx, dy) * w.g;
  if (w.b > 0.004 && ids.b < 254.5) c += tap(ids.b, tuv, dx, dy) * w.b;
  if (w.a > 0.004 && ids.a < 254.5) c += tap(ids.a, tuv, dx, dy) * w.a;
  return c;
}

void main() {
  // Seen from below (the camera under the ground, or inside a hill), the ground is a dark ceiling.
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec2 pp = vWorldPos.xz - paintOrigin;
  vec2 suv = pp / worldSize;
  // One repeat a cell, eight a chunk, as the client tiles its ground textures (Benilla's
  // TERRAIN_LAYER_TILES, terrain.rs; MIT/Apache-2.0): fixed, not a setting.
  vec2 tuv = vWorldPos.xz / cellSize;
  // The palette's uvs (tuv and the rock's triplanar ones) are all the world position over cellSize,
  // so one pair of derivatives serves them all, taken here outside any branch.
  vec3 pdx = dFdx(vWorldPos) / cellSize;
  vec3 pdy = dFdy(vWorldPos) / cellSize;
  // Clamped, so the far edge (and a world tile's skirt, hung from it) reads the last chunk.
  vec2 cell = clamp(floor(pp / chunkWorld), 0.0, chunksSide - 1.0);
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

  vec4 layers = blend(ids, w, tuv, pdx.xz, pdy.xz) / total;
  vec3 col = layers.rgb;
  float sheen = layers.a;

  // Automatic rock on steep slopes, triplanar so cliffs don't stretch.
  float slope = 1.0 - n.y;
  float rockW = smoothstep(0.32, 0.55, slope) * cliffAuto;
  if (rockW > 0.001) {
    vec3 w3 = abs(n); w3 /= (w3.x + w3.y + w3.z);
    vec3 rx = textureGrad(palette, vec3(vWorldPos.zy / cellSize, rockLayer), pdx.zy, pdy.zy).rgb;
    vec4 ryA = textureGrad(palette, vec3(tuv, rockLayer), pdx.xz, pdy.xz);
    vec3 ry = ryA.rgb;
    sheen = mix(sheen, ryA.a, rockW);
    vec3 rz = textureGrad(palette, vec3(vWorldPos.xy / cellSize, rockLayer), pdx.xy, pdy.xy).rgb;
    col = mix(col, rx * w3.x + ry * w3.y + rz * w3.z, rockW);
  }

  // Hemisphere ambient plus the key light (sun or moon) as plain Lambert, the same as the props, so a
  // prop and the ground it stands on agree. Where the key light is shadowed only the sky light is left.
  vec3 lit;
  if (clientLit > 0.5) {
    // Client Lighting: the client's terrainp_s combine in its gamma space, texture times the
    // interpolated per-vertex light, 70% of it in baked shadow, plus the sheen (the specular times
    // the layers' blended mask), none in shadow; clamped, then back to linear.
    float ks = keyShadow();
    float baked = bakedShadowOn > 0.5 ? texture2D(bakedShadowTex, suv).r : 0.0;
    float shadowLit = 1.0 - baked;
    vec3 primary = mix(vPrimaryDark, vPrimaryLit, ks);
    vec3 g = clamp(srgbOf(col) * primary * (${(1 - BAKED_SHADOW_LIGHT).toFixed(2)} * shadowLit + ${BAKED_SHADOW_LIGHT.toFixed(2)}) + vSpecular * sheen * shadowLit * ks, 0.0, 1.0);
    lit = linearOf(g);
  } else {
    float diff = max(dot(n, sunDir), 0.0) * keyShadow();
    vec3 hemi = mix(groundAmbient, skyAmbient, n.y * 0.5 + 0.5);
    lit = col * (hemi + sunColor * diff);
    // The client's baked shadow keeps 70% of the light (terrain/bakedShadows.ts).
    if (bakedShadowOn > 0.5) lit *= 1.0 - ${(1 - BAKED_SHADOW_LIGHT).toFixed(2)} * texture2D(bakedShadowTex, suv).r;
  }

  // Point lights from torches, braziers, lamps (same falloff as three's props). Under Client Lighting
  // they are in the per-vertex light instead.
  #if NUM_POINT_LIGHTS > 0
  if (clientLit < 0.5) {
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
  }
  #endif

  if (waterEnabled > 0.5) {
    float depth = waterLevel - vWorldPos.y;
    if (depth > 0.0) {
      lit = mix(lit, waterDeep, clamp(depth / 7.0, 0.0, 0.88));
    }
    // The foam line is 0.35 yd either side of the waterline. Where a pixel spans more height than that
    // (far off, or on a steep shore) the line is widened to the pixel and dimmed to match, so it stays
    // a steady line instead of a thinner-than-a-pixel one that sparkles as the camera moves (#747).
    float band = max(0.35, fwidth(depth) * 1.5);
    float foam = (1.0 - smoothstep(0.0, band, abs(depth))) * (0.35 / band);
    // Foam is lit like everything else, so it doesn't glow at night.
    vec3 foamColor = vec3(0.85, 0.92, 0.95) * clamp(skyAmbient * 1.4 + sunColor * 0.7, 0.0, 1.0);
    lit = mix(lit, foamColor, foam * 0.35);
  }

  if (unpaintable >= 0.0) {
    // A chunk with four other textures can't take the paint texture (Noggit Red's paintability overlay).
    bool full = all(lessThan(ids, vec4(254.5)));
    bool has = any(equal(ids, vec4(unpaintable)));
    if (full && !has) lit *= vec3(1.0, 0.22, 0.22);
  }

  if (climbCos > 0.0) {
    // Ground too steep to walk up, by its triangle's own slope (as Noggit Red's climb view does by
    // default), so a steep triangle shows even where the smoothed normals lean less.
    vec3 face = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (abs(face.y) < climbCos) lit.r = mix(lit.r, 1.0, 0.5);
  }

  if (contourStep > 0.0) {
    // Noggit Red's contours (terrain_frag.glsl, contour_alpha): the ground darkened along each
    // height that is a multiple of the step, the line a screen pixel or so wide at any distance.
    float f = abs(fract((vWorldPos.y + contourStep * 0.5) / contourStep) - 0.5);
    float df = abs(fwidth(vWorldPos.y) / contourStep);
    lit *= smoothstep(0.0, df, f);
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

  if (mapDataMode > 0.5) {
    vec2 cc = clamp(floor(vWorldPos.xz / chunkWorld), 0.0, chunksSide - 1.0);
    vec4 cd = texture2D(chunkDataTex, (cc + 0.5) / chunksSide);
    float stripes = step(0.5, fract((vWorldPos.x + vWorldPos.z) / (cellSize * 2.0)));
    if (mapDataMode < 1.5) {
      // Each zone in its own colour; a chunk with none is left as it is. The chunks of the zone being
      // painted (mapDataZone) are striped and stronger, and every chunk's edge is drawn, so a stroke shows
      // which chunks it reached.
      float zoned = dot(cd.rgb, vec3(1.0)) > 0.0 ? 1.0 : 0.0;
      float mine = zoned * step(dot(abs(cd.rgb - mapDataZone), vec3(1.0)), 0.01) * step(0.001, dot(mapDataZone, vec3(1.0)));
      lit = mix(lit, cd.rgb, zoned * (0.4 + mine * (0.1 + 0.2 * stripes)));
      vec2 ce = vWorldPos.xz / chunkWorld;
      vec2 cg = abs(fract(ce - 0.5) - 0.5) / fwidth(ce);
      lit = mix(lit, vec3(1.0), zoned * (1.0 - min(min(cg.x, cg.y), 1.0)) * 0.45);
    } else if (mapDataMode < 2.5) {
      lit = mix(lit, vec3(0.9, 0.1, 0.1), cd.a > 0.5 ? 0.25 + 0.25 * stripes : 0.0);
    } else if (mapDataMode < 3.5) {
      float cells = worldSize / cellSize;
      vec2 cell = clamp(floor(vWorldPos.xz / cellSize), 0.0, cells - 1.0);
      float n = texture2D(cellTex, (cell + 0.5) / cells).r;
      lit = mix(lit, vec3(1.0, 0.6, 0.1), n > 0.002 ? 0.25 + 0.2 * stripes : 0.0);
    } else if (bakedShadowOn > 0.5) {
      // Shadow mode: the baked shadows tinted violet, so the painted texels read at a glance.
      lit = mix(lit, vec3(0.35, 0.2, 0.85), 0.45 * texture2D(bakedShadowTex, suv).r);
    }
  }

  if (refOpacity > 0.0 || refEdit > 0.0) {
    // The image's own frame (refUV): x along its width, y down its height, row 0 at the top. Flat,
    // over the lit ground, so its colours read as drawn.
    vec2 o = vWorldPos.xz - refCentre;
    vec2 l = vec2(o.x * refRot.x + o.y * refRot.y, -o.x * refRot.y + o.y * refRot.x);
    vec2 ruv = l / (2.0 * refHalf) + 0.5;
    if (refOpacity > 0.0 && ruv.x >= 0.0 && ruv.y >= 0.0 && ruv.x <= 1.0 && ruv.y <= 1.0) {
      vec4 rc = texture2D(refTex, ruv);
      lit = mix(lit, rc.rgb, rc.a * refOpacity);
    }
    if (refEdit > 0.0) {
      // Placing it: its outline and a square at each corner, in amber.
      float px = max(fwidth(vWorldPos.x), fwidth(vWorldPos.z));
      vec2 d = abs(l) - refHalf;
      float line = 1.0 - smoothstep(px, 2.0 * px, abs(max(d.x, d.y)));
      vec2 cd = abs(d);
      float handle = max(cd.x, cd.y) <= refEdit ? 1.0 : 0.0;
      lit = mix(lit, vec3(1.0, 0.8, 0.15), max(line, handle * 0.85));
    }
  }

  if (selMode > 0.5) {
    // Marching-ants outline around the selected area / floating paste.
    vec2 p = vWorldPos.xz;
    vec2 lo = selRect.xy;
    vec2 hi = selRect.zw;
    float inside = step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y);
    float edge = min(min(p.x - lo.x, hi.x - p.x), min(p.y - lo.y, hi.y - p.y));
    float w = max(0.18, fwidth(p.x) * 1.5);
    if (selMode > 2.5 && inside > 0.5) {
      // A shape: its cells, outlined where a neighbouring cell is not in it.
      float n = worldSize / cellSize;
      vec2 c = floor(p / cellSize);
      inside = texture2D(cellTex, (c + 0.5) / n).g > 0.5 ? 1.0 : 0.0;
      vec2 f = p - c * cellSize;
      edge = 1e6;
      if (c.x < 0.5 || texture2D(cellTex, (c + vec2(-0.5, 0.5)) / n).g < 0.5) edge = min(edge, f.x);
      if (c.x > n - 1.5 || texture2D(cellTex, (c + vec2(1.5, 0.5)) / n).g < 0.5) edge = min(edge, cellSize - f.x);
      if (c.y < 0.5 || texture2D(cellTex, (c + vec2(0.5, -0.5)) / n).g < 0.5) edge = min(edge, f.y);
      if (c.y > n - 1.5 || texture2D(cellTex, (c + vec2(0.5, 1.5)) / n).g < 0.5) edge = min(edge, cellSize - f.y);
    }
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
    if (brushImgOn > 0.5) {
      // The image over the brush's square, turned as the stroke turns it (imageWeight's frame).
      vec2 o = vWorldPos.xz - brushPos;
      vec2 uv = vec2(o.x * brushImgRot.x + o.y * brushImgRot.y, -o.x * brushImgRot.y + o.y * brushImgRot.x) / brushRadius;
      inner = 0.0;
      if (abs(uv.x) <= 1.0 && abs(uv.y) <= 1.0) inner = texture2D(brushImg, uv * 0.5 + 0.5).r * 0.35;
    }
    lit = mix(lit, brushColor, clamp(ring + inner, 0.0, 1.0));
  }

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function createTerrainMaterial(palette: THREE.Texture, slots: THREE.Texture, weights: THREE.Texture, worldSize: number, cellSize: number, chunkWorld: number, chunksSide: number): THREE.ShaderMaterial {
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
		paintOrigin: { value: new THREE.Vector2() },
		cellSize: { value: cellSize },
		lookTex: { value: null },
		lookTime: { value: 0 },
		sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
		sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
		clientLit: { value: 0 },
		clientAmbient: { value: new THREE.Vector3() },
		clientDiffuse: { value: new THREE.Vector3() },
		clientSpecular: { value: new THREE.Vector3() },
		clientPointCount: { value: 0 },
		clientPointPos: { value: Array.from({ length: LIGHT_POOL }, () => new THREE.Vector3()) },
		clientPointColor: { value: Array.from({ length: LIGHT_POOL }, () => new THREE.Vector3()) },
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
		brushImg: { value: null },
		brushImgOn: { value: 0 },
		brushImgRot: { value: new THREE.Vector2(1, 0) },
		gridVisible: { value: 0 },
		climbCos: { value: 0 },
		contourStep: { value: 0 },
		unpaintable: { value: -1 },
		chunkLineWorld: { value: 0 },
		chunkHover: { value: new THREE.Vector4() },
		tileWorld: { value: 0 },
		maskTex: { value: null },
		bakedShadowTex: { value: null },
		bakedShadowOn: { value: 0 },
		maskVisible: { value: 0 },
		mapDataMode: { value: 0 },
		mapDataZone: { value: new THREE.Vector3() },
		chunkDataTex: { value: null },
		selRect: { value: new THREE.Vector4() },
		cellTex: { value: null },
		selMode: { value: 0 },
		selTime: { value: 0 },
		refTex: { value: null },
		refOpacity: { value: 0 },
		refCentre: { value: new THREE.Vector2() },
		refHalf: { value: new THREE.Vector2(1, 1) },
		refRot: { value: new THREE.Vector2(1, 0) },
		refEdit: { value: 0 },
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
