import * as THREE from 'three'
import { BAND, type LightAt } from '../wow/clientLight'
import { loadTexture } from '../wow/api'
import { LIQUID_TYPES, OCEAN_OPACITY, type LiquidClass } from './liquids'
import { TILE_YARDS } from '../terrain/Terrain'
import { patchRoomGate } from '../world/roomGate'

// How liquids draw, as the client draws a tile's water (B-174, Benilla's liquid.wgsl and liquid.rs,
// MIT/Apache, after the client's ocean0_s pixel program): a depth swatch between the light's
// shallow and deep water colours and alphas, built as the client builds it (64 rows in byte steps,
// the ocean's last row darker and opaque), lit by the light's ambient and sun on a surface facing up,
// plus the liquid's animated frame, whose alpha is the ripple: it adds the sun's sheen and a quarter
// of white. The swatch's alpha is the water's opacity. Magma and slime are just their frame, opaque
// and unlit. The colours are the client light where the camera is (Lighting › Client Lighting) or else
// Azeroth's default light (Light.dbc 1: LightParams 12), by time of day.
//
// A WMO's liquids (its groups' MLIQ, #287) draw with the same shader under WMO, as the client's WMO
// kernels do (Benilla's liquid.wgsl): magma and slime their frame, scrolling for type 6 and 7 (the lava
// of Blackrock Depths); an interior pool unlit, its material's diffuse colour plus the frame; an
// exterior one (Stormwind's canals) the lit deep river colour plus the frame and the sun's sheen. Their
// opacity is the vertex's byte between the light's shallow and deep alphas. They are instanced with
// their WMO (ObjectLayer) and carry its room gate.

/** The client flips a liquid's frames 24 times a second (0x68aac0). */
const FRAME_RATE = 24
/** A river's or lake's depth byte at which the swatch reaches its deep row, about 5 yd (the LUT 0xc81768); the ocean's is 255. */
const RIVER_DEPTH_FULL = 42
/** Water's own shininess for the sun's sheen. */
const WATER_SHININESS = 6
/** Yards past the map's edge over which the sea's ground falls from the edge's height to deep (#748), about a tile. */
const SEA_FADE = 533
/** How many depth-buffer steps above the ground the sea starts to show (#767): the GPU's depth wobbles by more than one as the camera moves. */
const SEA_DEPTH_STEPS = 4
/** A texture repeats every four cells, as noggit's liquid uv (vertex index / 4). */
const UV_SCALE = 1 / (4 * (TILE_YARDS / 128))

const KINDS: LiquidClass[] = ['river', 'ocean', 'magma', 'slime']
/** The shader's number for a liquid class. */
export const KIND_INDEX: Record<LiquidClass, number> = { river: 0, ocean: 1, magma: 2, slime: 3 }

// LightIntBand: [hour, colour] keys, from LightParams 12 (Azeroth's global light).
type Band = Array<[number, number]>
const OCEAN_LIGHT: Band = [
	[0, 0x213e2f],
	[3, 0x213e2f],
	[6, 0x5b4842],
	[12, 0x114b59],
	[21, 0x5a4846],
	[22, 0x213e2f],
]
const OCEAN_DARK: Band = [
	[0, 0x000c18],
	[3, 0x000c18],
	[6, 0x14302f],
	[12, 0x001d29],
	[21, 0x152235],
	[22, 0x000c18],
]
const RIVER_LIGHT: Band = [
	[0, 0x1a3c1e],
	[3, 0x27423c],
	[6, 0x2f3a37],
	[12, 0x4f5d14],
	[21, 0x27423c],
	[22, 0x1a3c1e],
]
const RIVER_DARK: Band = [
	[0, 0x27372f],
	[3, 0x243a3c],
	[6, 0x2e4b4d],
	[12, 0x335255],
	[21, 0x243a3c],
	[22, 0x27372f],
]
// Bands 0 (the sun's diffuse light), 1 (ambient) and 9 (the sun, the sheen's colour) of the same light.
const DIFFUSE: Band = [
	[0, 0x6182a2],
	[3, 0x6182a2],
	[6, 0xff6700],
	[12, 0xff8800],
	[21, 0xff6d00],
	[22, 0x6182a2],
]
const AMBIENT: Band = [
	[0, 0x1d3c54],
	[3, 0x1d3c54],
	[6, 0x5d7d9c],
	[12, 0x68829a],
	[21, 0x665c77],
	[22, 0x1d3c54],
]
const SUN: Band = [
	[0, 0xe8f1ff],
	[3, 0xe8f1ff],
	[6, 0xffd296],
	[12, 0xfff7de],
	[21, 0xffe2a9],
	[22, 0xe8f1ff],
]

/** A band's colour at `hour`, interpolated between its keys and wrapping at midnight, as raw sRGB. */
function bandColor(band: Band, hour: number, out: THREE.Vector3) {
	let i = band.length - 1
	while (i > 0 && band[i][0] > hour) i--
	const [h0, c0] = band[i]
	const [h1, c1] = i + 1 < band.length ? band[i + 1] : [band[0][0] + 24, band[0][1]]
	const t = h1 > h0 ? (hour - h0) / (h1 - h0) : 0
	const ch = (c: number, s: number) => ((c >> s) & 255) / 255
	out.set(THREE.MathUtils.lerp(ch(c0, 16), ch(c1, 16), t), THREE.MathUtils.lerp(ch(c0, 8), ch(c1, 8), t), THREE.MathUtils.lerp(ch(c0, 0), ch(c1, 0), t))
}

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
varying float vDepth;
varying float vKind;
#ifdef WMO
attribute vec4 liquid;
attribute vec4 body;
varying vec2 vUv;
varying float vPath;
varying float vScroll;
varying vec3 vBody;
#else
attribute float depth;
attribute float kind;
#endif
#ifdef SEA
varying float vNear;
#endif
void main() {
#ifdef WMO
  vec4 lp = vec4(position, 1.0);
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
#endif
  vec4 wp = modelMatrix * lp;
  vUv = uv;
  vKind = liquid.x;
  vPath = liquid.y;
  vScroll = liquid.z;
  vDepth = liquid.w / 255.0;
  vBody = body.rgb;
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#ifdef SEA
  vDepth = 0.0;
  vKind = 1.0;
  // The camera's near plane, read back from a perspective projection; 0 for the top-down view's orthographic one.
  vNear = isOrthographic ? 0.0 : projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
#else
  vDepth = depth;
  vKind = kind;
#endif
#endif
  vWorldPos = wp.xyz;
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
uniform vec3 waterLit;
uniform vec3 sheenColor;
uniform vec3 sunDir;
uniform float uvScale;
uniform vec3 cursorPos;
uniform float cursorRadius;
uniform vec3 cursorColor;
uniform float liquidTime;
#ifdef WMO
varying vec2 vUv;
varying float vPath;
varying float vScroll;
varying vec3 vBody;
#endif
#ifdef SEA
uniform sampler2D groundTex;
uniform float groundCell;
uniform float groundVerts;
uniform float seaOpacity;
uniform float depthSteps;
varying float vNear;
#endif
varying vec3 vWorldPos;
varying float vDepth;
varying float vKind;

#ifdef SEA
// The ground under the sea, on the terrain's own triangles: each cell is cut along a diagonal that
// alternates with the cell's x+z (writeCellIndex, terrain/holes.ts), so the waterline the sea finds is
// the one drawn (#767). Past the map it carries on from the edge's height and falls to deep, where the
// swatch is at its last row, over ${SEA_FADE} yd (#748): a step straight to deep at the edge drew the
// map's square as a pale rectangle in a dark sea.
float groundAt(vec2 p, float deep) {
  vec2 g = p / groundCell;
  vec2 gc = clamp(g, vec2(0.0), vec2(groundVerts - 1.0));
  vec2 i = min(floor(gc), vec2(groundVerts - 2.0));
  vec2 f = gc - i;
  float a = texelFetch(groundTex, ivec2(i), 0).r;
  float b = texelFetch(groundTex, ivec2(i) + ivec2(1, 0), 0).r;
  float c = texelFetch(groundTex, ivec2(i) + ivec2(0, 1), 0).r;
  float d = texelFetch(groundTex, ivec2(i) + ivec2(1, 1), 0).r;
  float h;
  if (mod(i.x + i.y, 2.0) > 0.5) {
    // Cut from (1, 0) to (0, 1).
    h = f.x + f.y < 1.0 ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
  } else {
    // Cut from (0, 0) to (1, 1).
    h = f.x > f.y ? a + (b - a) * f.x + (d - b) * f.y : a + (c - a) * f.y + (d - c) * f.x;
  }
  float past = length(g - gc) * groundCell;
  return past > 0.0 ? mix(h, min(h, deep), smoothstep(0.0, ${SEA_FADE}.0, past)) : h;
}
#endif

// One row of the client's depth swatch (0x68a830): byte steps from the shallow end, the ocean's last
// row darkened to 0.9 and opaque.
vec4 swatchRow(vec4 c0, vec4 c1, float i, bool ocean) {
  vec4 row = c0 + floor(i * (c1 - c0) / 64.0);
  if (ocean && i >= 63.0) return vec4(floor(row.rgb * 0.9), 255.0) / 255.0;
  return row / 255.0;
}

// The swatch at depth v (0 to 1), linear between the two rows it falls between, as the client samples it.
vec4 swatch(vec3 light, vec3 dark, vec2 alphas, float v, bool ocean) {
  vec4 c0 = vec4(floor(light * 255.0 + 0.5), floor(alphas.x * 255.0));
  vec4 c1 = vec4(floor(dark * 255.0 + 0.5), floor(alphas.y * 255.0));
  float t = clamp(v * 64.0 - 0.5, 0.0, 63.0);
  float i0 = floor(t);
  return mix(swatchRow(c0, c1, i0, ocean), swatchRow(c0, c1, min(i0 + 1.0, 63.0), ocean), t - i0);
}

void main() {
#ifdef WMO
  // A WMO's liquid, by its kind and the path the client draws its group's liquid with.
  vec3 col;
  float alpha;
  int k = int(vKind + 0.5);
  if (k >= 2) {
    // Types 6 and 7 scroll v by a tenth a second, wrapping every 10 s (the client's 0x6b68f0).
    vec2 uv = vec2(vUv.x, vUv.y + vScroll * fract(liquidTime / 10.0));
    col = k == 2 ? texture2D(magmaTex, uv).rgb : texture2D(slimeTex, uv).rgb;
    alpha = 1.0;
  } else {
    bool ocean = k == 1;
    vec4 frame = ocean ? texture2D(oceanTex, vUv) : texture2D(riverTex, vUv);
    vec3 detail = pow(frame.rgb, vec3(1.0 / 2.2));
    vec2 alphas = ocean ? oceanAlpha : riverAlpha;
    float a = mix(alphas.x, alphas.y, vDepth);
    if (vPath > 1.5) {
      // Interior (0x6b6420): unlit, the material's diffuse colour plus the frame, the ripple adding to the opacity.
      col = pow(clamp(vBody + detail, 0.0, 1.0), vec3(2.2));
      alpha = clamp(a + frame.a, 0.0, 1.0);
    } else {
      // Exterior (0x6b6630, MapObjExtWater0): the lit deep colour plus the frame and the sun's sheen.
      vec3 deep = ocean ? oceanDark : riverDark;
      vec3 h = normalize(sunDir + normalize(cameraPosition - vWorldPos));
      vec3 sheen = sheenColor * pow(max(h.y, 0.0), ${WATER_SHININESS}.0);
      col = pow(clamp(waterLit * deep + detail + sheen * frame.a, 0.0, 1.0), vec3(2.2));
      alpha = a;
    }
  }
#else
  vec2 uv = vWorldPos.xz * uvScale;
  float depth = vDepth;
#ifdef SEA
  float under = vWorldPos.y - groundAt(vWorldPos.xz, vWorldPos.y + 1.0 - 1.0 / seaOpacity);
  depth = clamp((under + 1.0) * seaOpacity, 0.0, 1.0);
  // Where the ground lies within the depth buffer's error of the surface, the depth test can't tell
  // which is in front, and on a real GPU the answer changes as the camera moves: the beach and the sea
  // took turns along the whole coast seen from far off (#767). The sea fades out there, so either
  // answer looks the same. A 24-bit depth step at view depth z is z^2 / (near * 2^24); depthSteps
  // of them, then a pixel's worth of fade.
  float vz = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
  float fuzz = vNear > 0.0 ? depthSteps * vz * vz / (vNear * 16777216.0) : 0.0;
  float shore = smoothstep(fuzz, fuzz + max(fwidth(under) * 1.5, 0.05), under);
#endif
  vec3 col;
  float alpha;
  int k = int(vKind + 0.5);
  if (k >= 2) {
    col = k == 2 ? texture2D(magmaTex, uv).rgb : texture2D(slimeTex, uv).rgb;
    alpha = 1.0;
  } else {
    // In the client's (gamma) space: rgb = lit · swatch + frame + (sheen + 0.25) · ripple.
    bool ocean = k == 1;
    vec4 frame = ocean ? texture2D(oceanTex, uv) : texture2D(riverTex, uv);
    vec3 detail = pow(frame.rgb, vec3(1.0 / 2.2));
    // A river's depth byte reaches the deep row at 42, the ocean's at 255.
    float v = ocean ? depth : clamp(depth * (255.0 / ${RIVER_DEPTH_FULL}.0), 0.0, 1.0);
    vec4 sw = ocean ? swatch(oceanLight, oceanDark, oceanAlpha, v, true) : swatch(riverLight, riverDark, riverAlpha, v, false);
    // The sun's Blinn sheen on the flat surface, seen from the camera.
    vec3 h = normalize(sunDir + normalize(cameraPosition - vWorldPos));
    vec3 sheen = sheenColor * pow(max(h.y, 0.0), ${WATER_SHININESS}.0);
    col = pow(clamp(waterLit * sw.rgb + detail + (sheen + 0.25) * frame.a, 0.0, 1.0), vec3(2.2));
    alpha = sw.a;
  }
#ifdef SEA
  alpha *= shore;
#endif
  if (cursorRadius > 0.0) {
    float fw = length(fwidth(vWorldPos.xz));
    float ring = smoothstep(0.0, fw * 1.5, abs(length(vWorldPos.xz - cursorPos.xz) - cursorRadius));
    col = mix(cursorColor, col, ring);
    alpha = mix(1.0, alpha, ring);
  }
#endif
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
	// The light's ambient plus its diffuse sun on a surface facing up, clamped; the sun's colour for
	// the sheen; the way to the sun. All in the client's (gamma) space.
	waterLit: { value: new THREE.Vector3(1, 1, 1) },
	sheenColor: { value: new THREE.Vector3() },
	sunDir: { value: new THREE.Vector3(0, 1, 0) },
	uvScale: { value: UV_SCALE },
	cursorPos: { value: new THREE.Vector3() },
	cursorRadius: { value: 0 },
	cursorColor: { value: new THREE.Color(1, 1, 1) },
	/** Seconds, for the scrolling WMO magma and slime. */
	liquidTime: { value: 0 },
}

/** A liquid's frames: loaded once the client is there, each frame a texture as the client has it. */
const frames: Record<LiquidClass, THREE.Texture[]> = { river: [], ocean: [], magma: [], slime: [] }
const requested = new Set<LiquidClass>()

let failHandler: ((path: string, err: unknown) => void) | null = null
/** Frame paths already reported, so a failing frame is said once until the frames are asked for again (#726). */
const reported = new Set<string>()

/** Called once for each liquid frame that fails to load (the Engine says so in the status line and the log). */
export function setLiquidFailHandler(fn: ((path: string, err: unknown) => void) | null) {
	failHandler = fn
}

function reportFailed(path: string, err: unknown) {
	if (reported.has(path)) return
	reported.add(path)
	failHandler?.(path, err)
}

function requestFrames(kind: LiquidClass) {
	if (requested.has(kind)) return
	requested.add(kind)
	const t = LIQUID_TYPES.find((l) => l.kind === kind)!
	const loaded: Array<THREE.Texture | null> = new Array(t.frames).fill(null)
	for (let i = 0; i < t.frames; i++) {
		const path = t.texture.replace('%d', String(i + 1))
		loadTexture(path)
			.then((tex) => {
				loaded[i] = tex
				frames[kind] = loaded.filter((f): f is THREE.Texture => f !== null)
			})
			.catch((err) => reportFailed(path, err))
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
	reported.clear()
	for (const k of KINDS) frames[k] = []
}

const diffuse = new THREE.Vector3()

/**
 * Per frame: the animation's frame, the time of day's colours, and the brush ring. `clientReady`
 * says the client's files can be read, which the frames wait for; `sun` is the way to the sun.
 */
export function updateLiquids(ms: number, hour: number, clientReady: boolean, cursor: { x: number; y: number; z: number; radius: number } | null, sun: THREE.Vector3) {
	if (clientReady) for (const k of wanted) requestFrames(k)
	const f = Math.floor((ms * FRAME_RATE) / 1000)
	shared.liquidTime.value = ms / 1000
	for (const k of KINDS) {
		const list = frames[k]
		shared[`${k}Tex`].value = list.length ? list[f % list.length] : blank
	}
	const c = clientLight
	if (c) {
		// The client's own light where the camera is (Lighting › Client Lighting, wow/clientLight.ts).
		fromBand(shared.riverLight.value, c, BAND.riverLight)
		fromBand(shared.riverDark.value, c, BAND.riverDark)
		fromBand(shared.oceanLight.value, c, BAND.oceanLight)
		fromBand(shared.oceanDark.value, c, BAND.oceanDark)
		shared.riverAlpha.value.set(c.waterAlpha[0], c.waterAlpha[1])
		shared.oceanAlpha.value.set(c.oceanAlpha[0], c.oceanAlpha[1])
		fromBand(shared.waterLit.value, c, BAND.ambient)
		fromBand(diffuse, c, BAND.diffuse)
		fromBand(shared.sheenColor.value, c, BAND.sun)
	} else {
		bandColor(RIVER_LIGHT, hour, shared.riverLight.value)
		bandColor(RIVER_DARK, hour, shared.riverDark.value)
		bandColor(OCEAN_LIGHT, hour, shared.oceanLight.value)
		bandColor(OCEAN_DARK, hour, shared.oceanDark.value)
		shared.riverAlpha.value.set(0.5, 1)
		shared.oceanAlpha.value.set(0.75, 1)
		bandColor(AMBIENT, hour, shared.waterLit.value)
		bandColor(DIFFUSE, hour, diffuse)
		bandColor(SUN, hour, shared.sheenColor.value)
	}
	shared.sunDir.value.copy(sun).normalize()
	const lit = shared.waterLit.value.addScaledVector(diffuse, Math.max(0, shared.sunDir.value.y))
	lit.set(Math.min(1, lit.x), Math.min(1, lit.y), Math.min(1, lit.z))
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

/** The material WMO liquids draw with: one for every WMO, instanced, with the room gate. */
let wmoMaterial: THREE.ShaderMaterial | null = null

export function wmoLiquidMaterial(): THREE.ShaderMaterial {
	if (!wmoMaterial) {
		wmoMaterial = new THREE.ShaderMaterial({
			defines: { WMO: '' },
			uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
			vertexShader: vertex,
			fragmentShader: fragment,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			fog: true,
		})
		patchRoomGate(wmoMaterial)
	}
	return wmoMaterial
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
			depthSteps: { value: SEA_DEPTH_STEPS },
		},
		vertexShader: vertex,
		fragmentShader: fragment,
		transparent: true,
		depthWrite: false,
		// The client draws every liquid with culling off.
		side: THREE.DoubleSide,
		fog: true,
	})
}
