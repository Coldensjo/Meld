import * as THREE from 'three'
import { loadTexture, type MeshGroup } from '../wow/api'
import { patchCascadeShadows } from '../engine/shadowCascades'
import { patchRoomGate } from '../world/roomGate'
import type { FarMerge } from './lod'

// Far WMOs drawn in a few calls (#691). A WMO's LOD (lod.ts) drawn small far away kept one group a
// texture, so a far city cost hundreds of draw calls. Here each texture a far LOD shows is drawn on the
// GPU, small, into a layer of one shared array texture, and the LOD's groups are merged by class (lit or
// not, blend, sides): a class's triangles sample their own layer through a per-vertex attribute, and
// draw in one call. The owner chose the array over flat colours (option A in #691's comments). A group
// whose texture or colour moves keeps its own material, and is drawn apart as before.

/** A layer's side in texels: a far LOD is drawn under `LOD_PX` (100 px) wide, so its textures are smaller still. */
export const FAR_SIZE = 64
/** The far LOD's attribute: each vertex's layer, or -1 less the layer on a cut-out (whose shadow tests its alpha). */
export const FAR_LAYER = 'farLayer'
/** The array starts with this many layers and doubles as more are used. */
const FIRST_DEPTH = 256
/** The most layers the array grows to (the GPU may allow fewer); past them a far LOD keeps its groups. */
const MAX_DEPTH = 2048
/** The most layers drawn in one frame, so a city's arrival spreads over a few frames. */
const PER_FRAME = 96
/** What a group without a texture, or whose texture failed, is drawn with (as `wowMaterial` draws it). */
const UNTEXTURED = 0x9a9a9a
/** An interior without baked colours is dimmed (as `wowMaterial` does). */
const DIM_INTERIOR = 0x707070

interface Layer {
	key: string
	layer: number
	refs: number
	path: string
	/** The texture's tint, linear. */
	tint: THREE.Color
	/** The client texture, once it has loaded; until then (or when it fails) the layer is a flat grey. */
	texture: THREE.Texture | null
}

const layers = new Map<string, Layer>()
const free: number[] = []
/** One past the highest layer handed out. */
let top = 0
/** The layers to draw at the next `drawFarLayers`. */
const queue = new Set<Layer>()
let renderer: THREE.WebGLRenderer | null = null
let maxDepth = 0
let target: THREE.WebGLArrayRenderTarget | null = null
/** How many client textures have been drawn into layers (a cut-out's shadow changes with one). */
let drawn = 0
/** Shared by every far material, so a bigger array reaches them all at once. */
const farUniform: { value: THREE.Texture | null } = { value: null }

/** Sets the renderer the layers are drawn with (the Engine's), or null: without one, far LODs keep their groups. */
export function setFarRenderer(r: THREE.WebGLRenderer | null) {
	renderer = r
	if (!r) return
	const gl = r.getContext() as WebGL2RenderingContext
	maxDepth = Math.min(MAX_DEPTH, (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) || 256)
}

/** How many layers are in use, how many the array holds and how many wait to be drawn (for tests and probes). */
export function farLayerCounts(): { layers: number; depth: number; queued: number; drawn: number } {
	return { layers: layers.size, depth: target?.depth ?? 0, queued: queue.size, drawn }
}

/** Bumped each time a client texture is drawn into a layer: a shadow map drawn before is redrawn. */
export function farLayersDrawn(): number {
	return drawn
}

function acquire(path: string, tint: number): Layer | null {
	const key = `${path.toLowerCase()}|${tint}`
	const have = layers.get(key)
	if (have) {
		have.refs++
		return have
	}
	const index = free.length ? free.pop()! : top < maxDepth ? top++ : -1
	if (index < 0) return null
	const l: Layer = { key, layer: index, refs: 1, path, tint: new THREE.Color(tint), texture: null }
	layers.set(key, l)
	queue.add(l)
	if (path)
		loadTexture(path, true).then(
			(t) => {
				if (layers.get(key) !== l) return
				l.texture = t
				queue.add(l)
			},
			() => {},
		)
	return l
}

/** Lets go of the layers a far LOD took (`farLod`'s `layers`); a layer no LOD uses is free again. */
export function releaseFarLayers(keys: readonly string[]) {
	for (const key of keys) {
		const l = layers.get(key)
		if (!l || --l.refs > 0) continue
		layers.delete(key)
		queue.delete(l)
		free.push(l.layer)
	}
}

/** Draws every layer again (after the WebGL context was lost: the array's texels went with it). */
export function farLayersLost() {
	for (const l of layers.values()) queue.add(l)
}

let copyScene: THREE.Scene | null = null
let copyCamera: THREE.Camera | null = null
let copyMaterial: THREE.ShaderMaterial | null = null

function copySetup() {
	copyMaterial = new THREE.ShaderMaterial({
		uniforms: { map: { value: null }, useMap: { value: 0 }, tint: { value: new THREE.Color() } },
		vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
		// The client texture is sampled linear (its sRGB format decodes it) and the layer's sRGB format
		// encodes it again; its mipmaps filter it down to the layer's size.
		fragmentShader: /* glsl */ `
uniform sampler2D map;
uniform float useMap;
uniform vec3 tint;
varying vec2 vUv;
void main() {
	vec4 c = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
	gl_FragColor = vec4(c.rgb * tint, c.a);
}`,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
	})
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial)
	quad.frustumCulled = false
	copyScene = new THREE.Scene()
	copyScene.add(quad)
	copyCamera = new THREE.Camera()
}

/** Whether `scene` is the one the layers are drawn with (the Engine's shadow timing leaves it out). */
export function isFarLayerScene(scene: THREE.Object3D): boolean {
	return scene === copyScene
}

/** A new array of `depth` layers, made ready to sample (mipmapped, repeating, sRGB). */
function makeTarget(r: THREE.WebGLRenderer, depth: number): THREE.WebGLArrayRenderTarget {
	const t = new THREE.WebGLArrayRenderTarget(FAR_SIZE, FAR_SIZE, depth, { depthBuffer: false })
	const tex = t.texture
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.magFilter = THREE.LinearFilter
	tex.minFilter = THREE.LinearMipmapLinearFilter
	tex.colorSpace = THREE.SRGBColorSpace
	tex.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy())
	tex.flipY = false
	// Set when the array is made, so its mipmap levels are made with it; `drawFarLayers` turns it off
	// while drawing and on again for its last layer, so they are worked out once a frame.
	tex.generateMipmaps = true
	return t
}

function drawLayer(r: THREE.WebGLRenderer, l: Layer) {
	const u = copyMaterial!.uniforms
	u.map.value = l.texture
	u.useMap.value = l.texture ? 1 : 0
	const tint = u.tint.value as THREE.Color
	if (l.texture) tint.copy(l.tint)
	else tint.setHex(UNTEXTURED)
	r.setRenderTarget(target, l.layer)
	r.render(copyScene!, copyCamera!)
}

/**
 * Draws the layers waiting (a texture that arrived, a layer just taken), up to `PER_FRAME` a frame;
 * a bigger array first, when the layers in use outgrew it, with every layer drawn into it at once.
 * The Engine calls it before drawing the frame.
 */
export function drawFarLayers() {
	const r = renderer
	if (!r || !queue.size) return
	if (!copyScene) copySetup()
	let all = false
	if (!target || top > target.depth) {
		let depth = target?.depth ?? FIRST_DEPTH
		while (depth < top) depth *= 2
		const old = target
		target = makeTarget(r, Math.min(depth, maxDepth))
		farUniform.value = target.texture
		old?.dispose()
		for (const l of layers.values()) queue.add(l)
		all = true
	}
	const prev = r.getRenderTarget()
	const face = r.getActiveCubeFace()
	const level = r.getActiveMipmapLevel()
	const tex = target.texture
	let last: Layer | null = null
	let n = 0
	for (const l of queue) {
		if (!all && n >= PER_FRAME) break
		queue.delete(l)
		// Its mipmaps are worked out once, after the last layer.
		tex.generateMipmaps = false
		drawLayer(r, l)
		if (l.texture) drawn++
		last = l
		n++
	}
	if (last) {
		tex.generateMipmaps = true
		drawLayer(r, last)
	}
	r.setRenderTarget(prev, face, level)
}

/** The parameters a far class's material is made from. */
interface FarClass {
	lit: boolean
	blend: number
	twoSided: boolean
	vertexColors: boolean
	rooms: boolean
}

const classMaterials = new Map<string, THREE.Material>()

/** Samples the layer array where three samples `map`, through the far LOD's layer attribute. */
function patchFarLayers(m: THREE.Material) {
	const prev = m.onBeforeCompile
	const prevKey = m.customProgramCacheKey
	m.onBeforeCompile = (shader, r) => {
		prev.call(m, shader, r)
		shader.uniforms.farLayers = farUniform
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\nattribute float ${FAR_LAYER};\nvarying vec3 vFarUv;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>\nvFarUv = vec3(uv, ${FAR_LAYER} < 0.0 ? -1.0 - ${FAR_LAYER} : ${FAR_LAYER});`)
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform sampler2DArray farLayers;\nvarying vec3 vFarUv;')
			.replace('#include <map_fragment>', 'diffuseColor *= texture(farLayers, vFarUv);')
	}
	m.customProgramCacheKey = () => prevKey.call(m) + '|far'
}

/** The material a far class draws with, shared by every far LOD: as `wowMaterial` makes a group's, sampling the layers. */
function classMaterial(c: FarClass): THREE.Material {
	const key = `${c.lit}|${c.blend}|${c.twoSided}|${c.vertexColors}|${c.rooms}`
	let m = classMaterials.get(key)
	if (m) return m
	const params: THREE.MeshLambertMaterialParameters = { vertexColors: c.vertexColors, side: c.twoSided ? THREE.DoubleSide : THREE.FrontSide }
	switch (c.blend) {
		case 0:
			break
		case 1:
			params.alphaTest = 0.5
			break
		case 2:
			params.transparent = true
			params.depthWrite = false
			break
		case 3:
			params.transparent = true
			params.depthWrite = false
			params.blending = THREE.AdditiveBlending
			break
		default:
			params.transparent = true
			params.depthWrite = false
			params.blending = THREE.MultiplyBlending
			params.premultipliedAlpha = true
	}
	m = c.lit ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params)
	m.shadowSide = THREE.DoubleSide
	if (m instanceof THREE.MeshLambertMaterial) patchCascadeShadows(m)
	patchFarLayers(m)
	if (c.rooms) patchRoomGate(m)
	m.name = `far:${key}`
	m.userData.far = true
	classMaterials.set(key, m)
	return m
}

/** How many far class materials there are (for tests and probes): they are shared, and never let go of. */
export function farClassCount(): number {
	return classMaterials.size
}

/** How a WMO's far LOD merges its groups: a class for each material (or -1), the classes' materials, and each material's layer. */
export interface FarPlan {
	/** Each material's class, or -1 to keep its groups apart (a moving texture or colour). */
	classes: Int32Array
	/** The material of each class. */
	materials: THREE.Material[]
	/** Each material's texture and tint (its colour, which `wowMaterial` multiplies the texture by). */
	textures: { path: string; tint: number; cut: boolean }[]
}

/** The far plan of a WMO's groups (`MeshGroup`s, one a material), made as `wowMaterial` makes their materials. */
export function farPlan(groups: readonly MeshGroup[], vertexColors: boolean, rooms: boolean): FarPlan {
	const classes = new Int32Array(groups.length)
	const keys = new Map<string, number>()
	const materials: THREE.Material[] = []
	const textures: FarPlan['textures'] = []
	groups.forEach((g, i) => {
		const interior = !!g.interior && !g.unlit
		const blend = g.blend <= 2 ? g.blend : g.blend <= 4 ? 3 : 5
		textures.push({ path: g.texture, tint: !g.texture ? UNTEXTURED : interior && !vertexColors ? DIM_INTERIOR : 0xffffff, cut: blend === 1 })
		if ((g.uv && g.texture) || g.color) {
			classes[i] = -1
			return
		}
		const c: FarClass = { lit: !(g.unlit || interior), blend, twoSided: g.twoSided, vertexColors, rooms }
		const key = `${c.lit}|${blend}|${c.twoSided}`
		let k = keys.get(key)
		if (k === undefined) {
			k = materials.length
			keys.set(key, k)
			materials.push(classMaterial(c))
		}
		classes[i] = k
	})
	return { classes, materials, textures }
}

/** A far LOD made by `farLod`: its geometry, its materials (the model's, then the classes') and the layers it took. */
export interface FarLod {
	geometry: THREE.BufferGeometry
	material: THREE.Material[]
	layers: string[]
}

type Typed = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array

/**
 * The far LOD of a WMO's `geometry` from the worker's `far` merge and its `plan`, with `materials`
 * the model's own: its vertices copied out of the model's, each with its layer, taking a layer for each
 * texture. Undefined without a renderer, or when the array has no layers left: the LOD then keeps
 * its groups. Picking still hits the full model, through its bounds tree, whose materials come first.
 */
export function farLod(geometry: THREE.BufferGeometry, far: FarMerge, plan: FarPlan, materials: readonly THREE.Material[]): FarLod | undefined {
	if (!renderer) return
	for (const attr of Object.values(geometry.attributes)) if (!(attr instanceof THREE.BufferAttribute)) return
	const keys: string[] = []
	const layerOf = new Float32Array(plan.textures.length)
	for (let m = 0; m < plan.textures.length; m++) {
		if (plan.classes[m] < 0) continue
		const t = plan.textures[m]
		const l = acquire(t.path, t.tint)
		if (!l) {
			releaseFarLayers(keys)
			return
		}
		keys.push(l.key)
		layerOf[m] = t.cut ? -1 - l.layer : l.layer
	}
	const n = far.src.length
	const src = far.src
	const out = new THREE.BufferGeometry()
	for (const [name, attr] of Object.entries(geometry.attributes) as [string, THREE.BufferAttribute][]) {
		const size = attr.itemSize
		const from = attr.array as Typed
		const to = new (from.constructor as new (n: number) => Typed)(n * size)
		for (let i = 0, d = 0; i < n; i++) {
			const s = src[i] * size
			for (let c = 0; c < size; c++) to[d++] = from[s + c]
		}
		out.setAttribute(name, new THREE.BufferAttribute(to, size, attr.normalized))
	}
	const layer = new Float32Array(n)
	for (let r = 0; r < far.runs.length; r += 3) layer.fill(layerOf[far.runs[r + 2]] ?? 0, far.runs[r], far.runs[r] + far.runs[r + 1])
	out.setAttribute(FAR_LAYER, new THREE.BufferAttribute(layer, 1))
	out.setIndex(new THREE.BufferAttribute(far.index, 1))
	for (const g of far.groups) out.addGroup(g.start, g.count, g.materialIndex)
	if (!geometry.boundingSphere) geometry.computeBoundingSphere()
	out.boundingSphere = geometry.boundingSphere!.clone()
	if (geometry.boundingBox) out.boundingBox = geometry.boundingBox.clone()
	out.boundsTree = geometry.boundsTree
	out.userData.farLayers = true
	// For the model-worker probe, which merges a main-thread LOD the same way to compare.
	out.userData.farClasses = plan.classes
	return { geometry: out, material: [...materials, ...plan.materials], layers: keys }
}

let depthMaterial: THREE.MeshDepthMaterial | null = null

/**
 * The shadow depth material of every far LOD: a cut-out's triangles (a negative layer) test their
 * layer's alpha, the rest cast whole. three sets a depth material's `alphaTest` and `map` from each
 * group's own material; this one keeps both off, so it never changes program between groups.
 */
export function farDepthMaterial(): THREE.MeshDepthMaterial {
	if (depthMaterial) return depthMaterial
	const m = new THREE.MeshDepthMaterial()
	for (const prop of ['alphaTest', 'map'] as const) Object.defineProperty(m, prop, { get: () => (prop === 'alphaTest' ? 0 : null), set: () => {} })
	m.onBeforeCompile = (shader) => {
		shader.uniforms.farLayers = farUniform
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\nattribute float ${FAR_LAYER};\nvarying vec3 vFarUv;\nvarying float vFarCut;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>\nvFarCut = ${FAR_LAYER} < 0.0 ? 1.0 : 0.0;\nvFarUv = vec3(uv, ${FAR_LAYER} < 0.0 ? -1.0 - ${FAR_LAYER} : ${FAR_LAYER});`)
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform sampler2DArray farLayers;\nvarying vec3 vFarUv;\nvarying float vFarCut;')
			.replace('#include <alphatest_fragment>', 'if (vFarCut > 0.5 && texture(farLayers, vFarUv).a < 0.5) discard;')
	}
	m.customProgramCacheKey = () => 'far-depth'
	depthMaterial = m
	return m
}
