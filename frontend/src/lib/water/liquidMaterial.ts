import * as THREE from 'three'
import { BAND, type LightAt } from '../wow/clientLight'
import { loadTexture } from '../wow/api'
import { LIQUID_TYPES, OCEAN_OPACITY, type LiquidClass } from './liquids'
import { TILE_YARDS } from '../terrain/Terrain'

// How liquids draw, after noggit3's liquid shader (liquid_frag.glsl): each liquid's animated texture
// from the client, plus a colour between the light's "light" (shallow) and "dark" (deep) water
// colour by the vertex's depth, at an opacity between the light's shallow and deep alphas. Magma and
// slime are just their texture, opaque. The colours and alphas are the 1.12 client's for Azeroth's
// default light (Light.dbc 1: LightParams 12, LightIntBand colours 14 to 17), by time of day.

/** The client's frames change every 60 ms (noggit sends animtime / 60). */
const FRAME_MS = 60
/** A texture repeats every four cells, as noggit's liquid uv (vertex index / 4). */
const UV_SCALE = 1 / (4 * (TILE_YARDS / 128))

const KINDS: LiquidClass[] = ['river', 'ocean', 'magma', 'slime']
/** The shader's number for a liquid class. */
export const KIND_INDEX: Record<LiquidClass, number> = { river: 0, ocean: 1, magma: 2, slime: 3 }

// LightIntBand: [hour, colour] keys, from LightParams 12 (Azeroth's global light).
type Band = Array<[number, number]>
const OCEAN_LIGHT: Band = [[0, 0x213e2f], [3, 0x213e2f], [6, 0x5b4842], [12, 0x114b59], [21, 0x5a4846], [22, 0x213e2f]]
const OCEAN_DARK: Band = [[0, 0x000c18], [3, 0x000c18], [6, 0x14302f], [12, 0x001d29], [21, 0x152235], [22, 0x000c18]]
const RIVER_LIGHT: Band = [[0, 0x1a3c1e], [3, 0x27423c], [6, 0x2f3a37], [12, 0x4f5d14], [21, 0x27423c], [22, 0x1a3c1e]]
const RIVER_DARK: Band = [[0, 0x27372f], [3, 0x243a3c], [6, 0x2e4b4d], [12, 0x335255], [21, 0x243a3c], [22, 0x27372f]]

/** A band's colour at `hour`, interpolated between its keys and wrapping at midnight, as raw sRGB. */
function bandColor(band: Band, hour: number, out: THREE.Vector3) {
  let i = band.length - 1
  while (i > 0 && band[i][0] > hour) i--
  const [h0, c0] = band[i]
  const [h1, c1] = i + 1 < band.length ? band[i + 1] : [band[0][0] + 24, band[0][1]]
  const t = h1 > h0 ? (hour - h0) / (h1 - h0) : 0
  const ch = (c: number, s: number) => ((c >> s) & 255) / 255
  out.set(
    THREE.MathUtils.lerp(ch(c0, 16), ch(c1, 16), t),
    THREE.MathUtils.lerp(ch(c0, 8), ch(c1, 8), t),
    THREE.MathUtils.lerp(ch(c0, 0), ch(c1, 0), t),
  )
}

const vertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float depth;
attribute float kind;
varying vec3 vWorldPos;
varying float vDepth;
varying float vKind;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
#ifdef SEA
  vDepth = 0.0;
  vKind = 1.0;
#else
  vDepth = depth;
  vKind = kind;
#endif
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D riverTex;
uniform sampler2D oceanTex;
uniform sampler2D magmaTex;
uniform sampler2D slimeTex;
uniform vec3 riverLight;
uniform vec3 riverDark;
uniform vec3 oceanLight;
uniform vec3 oceanDark;
uniform vec2 riverAlpha;
uniform vec2 oceanAlpha;
uniform float uvScale;
uniform vec3 cursorPos;
uniform float cursorRadius;
uniform vec3 cursorColor;
#ifdef SEA
uniform sampler2D groundTex;
uniform float groundCell;
uniform float groundVerts;
uniform float seaOpacity;
#endif
varying vec3 vWorldPos;
varying float vDepth;
varying float vKind;

#ifdef SEA
// The ground under the sea, bilinear between the four vertices around the point.
float groundAt(vec2 p) {
  vec2 g = p / groundCell;
  if (g.x < 0.0 || g.y < 0.0 || g.x > groundVerts - 1.0 || g.y > groundVerts - 1.0) return -1e4;
  vec2 i = min(floor(g), vec2(groundVerts - 2.0));
  vec2 f = g - i;
  float a = texelFetch(groundTex, ivec2(i), 0).r;
  float b = texelFetch(groundTex, ivec2(i) + ivec2(1, 0), 0).r;
  float c = texelFetch(groundTex, ivec2(i) + ivec2(0, 1), 0).r;
  float d = texelFetch(groundTex, ivec2(i) + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
#endif

void main() {
  vec2 uv = vWorldPos.xz * uvScale;
  float depth = vDepth;
#ifdef SEA
  depth = clamp((vWorldPos.y - groundAt(vWorldPos.xz) + 1.0) * seaOpacity, 0.0, 1.0);
#endif
  vec3 col;
  float alpha;
  int k = int(vKind + 0.5);
  if (k >= 2) {
    col = k == 2 ? texture2D(magmaTex, uv).rgb : texture2D(slimeTex, uv).rgb;
    alpha = 1.0;
  } else {
    // noggit adds the texel to the depth colour in the client's (gamma) space.
    vec3 texel = pow(k == 1 ? texture2D(oceanTex, uv).rgb : texture2D(riverTex, uv).rgb, vec3(1.0 / 2.2));
    vec3 lerpCol = k == 1 ? mix(oceanLight, oceanDark, depth) : mix(riverLight, riverDark, depth);
    alpha = k == 1 ? mix(oceanAlpha.x, oceanAlpha.y, depth) : mix(riverAlpha.x, riverAlpha.y, depth);
    col = pow(clamp(texel + lerpCol, 0.0, 1.0), vec3(2.2));
  }
  if (cursorRadius > 0.0) {
    float fw = length(fwidth(vWorldPos.xz));
    float ring = smoothstep(0.0, fw * 1.5, abs(length(vWorldPos.xz - cursorPos.xz) - cursorRadius));
    col = mix(cursorColor, col, ring);
    alpha = mix(1.0, alpha, ring);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/** Black, until a liquid's frames load (or when there's no client). */
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
blank.needsUpdate = true

/** Uniforms every liquid material shares, so one update per frame reaches them all. */
const shared = {
  riverTex: { value: blank as THREE.Texture },
  oceanTex: { value: blank as THREE.Texture },
  magmaTex: { value: blank as THREE.Texture },
  slimeTex: { value: blank as THREE.Texture },
  riverLight: { value: new THREE.Vector3() },
  riverDark: { value: new THREE.Vector3() },
  oceanLight: { value: new THREE.Vector3() },
  oceanDark: { value: new THREE.Vector3() },
  // LightParams 12: water shallow and deep alpha, ocean shallow and deep alpha.
  riverAlpha: { value: new THREE.Vector2(0.5, 1) },
  oceanAlpha: { value: new THREE.Vector2(0.75, 1) },
  uvScale: { value: UV_SCALE },
  cursorPos: { value: new THREE.Vector3() },
  cursorRadius: { value: 0 },
  cursorColor: { value: new THREE.Color(1, 1, 1) },
}

/** A liquid's frames: loaded once the client is there, each frame a texture as the client has it. */
const frames: Record<LiquidClass, THREE.Texture[]> = { river: [], ocean: [], magma: [], slime: [] }
const requested = new Set<LiquidClass>()

function requestFrames(kind: LiquidClass) {
  if (requested.has(kind)) return
  requested.add(kind)
  const t = LIQUID_TYPES.find((l) => l.kind === kind)!
  const loaded: Array<THREE.Texture | null> = new Array(t.frames).fill(null)
  for (let i = 0; i < t.frames; i++) {
    loadTexture(t.texture.replace('%d', String(i + 1)))
      .then((tex) => {
        loaded[i] = tex
        frames[kind] = loaded.filter((f): f is THREE.Texture => f !== null)
      })
      .catch(() => {})
  }
}

/** Liquid classes that something drew since the client's frames were last asked for. */
const wanted = new Set<LiquidClass>()

/** Says a liquid class is drawn, so its frames load. */
export function wantLiquid(kind: LiquidClass) {
  wanted.add(kind)
}

/** Lets the liquids load their frames again (after the client folder changed). */
export function resetLiquidFrames() {
  requested.clear()
  for (const k of KINDS) frames[k] = []
}

/**
 * Per frame: the animation's frame, the time of day's colours, and the brush ring. `clientReady`
 * says the client's files can be read, which the frames wait for.
 */
export function updateLiquids(ms: number, hour: number, clientReady: boolean, cursor: { x: number; y: number; z: number; radius: number } | null) {
  if (clientReady) for (const k of wanted) requestFrames(k)
  const f = Math.floor(ms / FRAME_MS)
  for (const k of KINDS) {
    const list = frames[k]
    shared[`${k}Tex`].value = list.length ? list[f % list.length] : blank
  }
  const c = clientLight
  if (c) {
    // The client's own light where the camera is (View › Client Lighting, wow/clientLight.ts).
    fromBand(shared.riverLight.value, c, BAND.riverLight)
    fromBand(shared.riverDark.value, c, BAND.riverDark)
    fromBand(shared.oceanLight.value, c, BAND.oceanLight)
    fromBand(shared.oceanDark.value, c, BAND.oceanDark)
    shared.riverAlpha.value.set(c.waterAlpha[0], c.waterAlpha[1])
    shared.oceanAlpha.value.set(c.oceanAlpha[0], c.oceanAlpha[1])
  } else {
    bandColor(RIVER_LIGHT, hour, shared.riverLight.value)
    bandColor(RIVER_DARK, hour, shared.riverDark.value)
    bandColor(OCEAN_LIGHT, hour, shared.oceanLight.value)
    bandColor(OCEAN_DARK, hour, shared.oceanDark.value)
    shared.riverAlpha.value.set(0.5, 1)
    shared.oceanAlpha.value.set(0.75, 1)
  }
  if (cursor) {
    shared.cursorPos.value.set(cursor.x, cursor.y, cursor.z)
    shared.cursorRadius.value = cursor.radius
  } else {
    shared.cursorRadius.value = 0
  }
}

/** The client's light at the camera, which the water's colours follow instead of Azeroth's default; null for the default. */
let clientLight: LightAt | null = null

/** A colour band of the client light into `v`, as the raw sRGB the shader takes. */
function fromBand(v: THREE.Vector3, c: LightAt, band: number) {
  v.set(c.colors[band * 3], c.colors[band * 3 + 1], c.colors[band * 3 + 2])
}

/** Sets (or with null clears) the client light the water's colours and alphas follow. */
export function setLiquidLight(light: LightAt | null) {
  clientLight = light
}

/** The material painted liquids draw with: one for every map. */
let layerMaterial: THREE.ShaderMaterial | null = null

export function liquidLayerMaterial(): THREE.ShaderMaterial {
  if (!layerMaterial) {
    layerMaterial = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    })
  }
  return layerMaterial
}

/**
 * A material for a map's sea: ocean everywhere at the sea level, its depth read per pixel from the
 * ground's heights (one texel a vertex, `cell` yards apart).
 */
export function seaMaterial(ground: THREE.Texture, verts: number, cell: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { SEA: '' },
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared,
      groundTex: { value: ground },
      groundVerts: { value: verts },
      groundCell: { value: cell },
      seaOpacity: { value: OCEAN_OPACITY },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
}
