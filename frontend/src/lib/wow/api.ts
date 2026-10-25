import * as THREE from 'three'
import { BrowseWowFolder, LiquidTypes, SetWowPath, WowStatus } from '../../../wailsjs/go/main/App'
import { setLiquidTypes } from '../water/liquids'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { hasBackend } from '../io/backend'
import { logFile, wow } from '../state/editor.svelte'
import { beginLoad, endLoad } from './loadProgress'
import { textureFrom } from './textureReply'
import { parseCollision, parseMesh, type CollisionReply } from './meshReply'

// Client for the Go side's /wow/* endpoints, which read assets live from the
// user's own WoW 1.x installation. Nothing is bundled with the app.

export interface MeshGroup {
	start: number
	count: number
	texture: string
	blend: number
	twoSided: boolean
	unlit: boolean
	/** A building's or cave's inside: lit by its baked vertex colours, not the sun and sky. */
	interior?: boolean
	/** The group's texture animation (an M2 texture transform, see world/uvAnim.ts). */
	uv?: { t?: AnimTrack; r?: AnimTrack; s?: AnimTrack }
	/** The group's colour and transparency (an M2 batch's colour and texture weight, see world/uvAnim.ts). */
	color?: { rgb?: AnimTrack; a?: AnimTrack; w?: AnimTrack }
}

export interface AnimTrack {
	t: number[]
	v: number[]
	loop: number
	step?: boolean
}

export interface AnimBone {
	parent: number
	pivot: [number, number, number]
	tr?: AnimTrack
	rot?: AnimTrack
	sc?: AnimTrack
}

/** Light source or flame in model space (editor coordinates). */
export interface MeshEffect {
	kind: 'fire' | 'light'
	pos: [number, number, number]
	color: [number, number, number]
	intensity: number
	radius: number
	size?: number
	/** Inside a WMO interior group: flames only, no dynamic light (it would shine through walls). */
	interior?: boolean
	/** An M2 light's colour times intensity as stored, unclamped: what the client adds to the ground. */
	raw?: [number, number, number]
}

/**
 * An M2 particle emitter (B-182), its tracks resolved for the model's loop (Go: internal/wow/particles.go;
 * simulated by world/particles.ts).
 */
export interface MeshEmitter {
	/** Spawn space (WoW axes, before the client's 90° turn) to model space: a column-major 4x4. */
	frame: number[]
	/** The animated bone it rides, or -1. */
	bone: number
	flags: number
	/** 1 plane, 2 sphere, 3 spline. */
	shape: number
	/** The M2 blend byte: 0 opaque, 1 alpha key, 2 alpha, 3 and 4 add, 5 and 6 mod. */
	blend: number
	texture: string
	rows: number
	cols: number
	/** 0 a camera-facing quad, 1 a streak along the velocity, 2 both. */
	headTail: number
	rate: AnimTrack | null
	on?: AnimTrack
	/** Speed, speed variation, vertical range, horizontal range, gravity, lifespan, area length, area width, z source. */
	params: (AnimTrack | null)[]
	drag: number
	tailTime: number
	spin: number
	/** Speed, percent, min, max. */
	twinkle: [number, number, number, number]
	mid: number
	colors: [number, number, number, number][]
	sizes: [number, number, number]
	headCells: [number, number, number, number]
	tailCells: [number, number, number, number]
	repeat: [number, number]
	spline?: number[]
	/** Flag 0x40: how much of the emitter's motion births inherit. */
	inherit?: number
	/** Flag 0x4000: two (emitter speed, fraction) samples of the follow response. */
	follow?: number[]
	/** The model each particle is drawn as instead of a quad, and its tumble range (rad/s per axis). */
	geometry?: string
	spinMin?: [number, number, number]
	spinMax?: [number, number, number]
	/** A recursion model's emitters, born at this emitter's live particles. */
	children?: MeshEmitter[]
}

/** An M2 ribbon emitter (B-183): a trail laid behind a moving bone (Go: internal/wow/ribbons.go; world/ribbons.ts). */
export interface MeshRibbon {
	/** The ribbon's own space (WoW axes; an edge spans its +Y) to model space: a column-major 4x4. */
	frame: number[]
	/** The animated bone it rides, or -1. */
	bone: number
	texture: string
	/** The M2 blend of its material. */
	blend: number
	color?: AnimTrack
	alpha?: AnimTrack
	above?: AnimTrack
	below?: AnimTrack
	on?: AnimTrack
	edgesPerSecond: number
	edgeLifetime: number
	gravity: number
	rows: number
	cols: number
	slot: number
}

export interface WowMesh {
	positions: Float32Array
	normals: Float32Array
	uvs: Float32Array
	colors: Uint8Array | null
	indices: Uint32Array
	groups: MeshGroup[]
	bbox: number[]
	/** Idle animation: bones plus 4 bone indices/weights per vertex. */
	bones?: AnimBone[]
	boneIdx?: Uint8Array
	boneW?: Uint8Array
	effects: MeshEffect[]
	emitters: MeshEmitter[]
	ribbons: MeshRibbon[]
	/** Two a vertex: a WMO vertex's groups plus one (0 for none), for the room gate (`world/roomGate.ts`). */
	rooms?: Uint16Array
	/** A WMO's liquid surfaces (its groups' MLIQ, Go's `LiquidMesh`), drawn by the liquid shader. */
	liquid?: WowLiquid
}

/** A WMO's lava and water, in model space. */
export interface WowLiquid {
	positions: Float32Array
	/** One texture repeat a grid cell. */
	uvs: Float32Array
	/** Four a vertex: the class (`KIND_INDEX`), the path (1 exterior, 2 interior), 1 for a scrolling magma or slime, the opacity byte. */
	info: Uint8Array
	/** An interior pool's body colour, rgba a vertex. */
	body: Uint8Array
	/** Two a vertex: the WMO group plus one, as `rooms`. */
	rooms: Uint16Array
	indices: Uint32Array
}

type StatusLike = { path: string; loaded: boolean; error: string; files: number; archives: number }

export function applyStatus(s: StatusLike) {
	wow.path = s.path
	wow.loaded = s.loaded
	wow.error = s.error
	wow.files = s.files
	wow.loading = false
	lists.clear()
	wow.revision++
	if (s.loaded) void loadLiquidTypes()
}

/** Reads the client's LiquidType.dbc into the Water tool's list of liquids. */
async function loadLiquidTypes() {
	try {
		setLiquidTypes(await LiquidTypes())
		wow.liquidsRevision++
	} catch (e) {
		console.warn('liquid types', e)
	}
}

export async function initWow() {
	if (!hasBackend()) return
	EventsOn('wow:status', (s: StatusLike) => applyStatus(s))
	const s = await WowStatus()
	applyStatus(s)
	// Startup load may still be running in Go; the event will update us.
	if (s.path && !s.loaded && !s.error) wow.loading = true
}

export async function chooseWowFolder(): Promise<void> {
	if (!hasBackend()) return
	const dir = await BrowseWowFolder()
	if (!dir) return
	wow.loading = true
	try {
		applyStatus(await SetWowPath(dir))
	} catch (e) {
		wow.loading = false
		wow.error = String(e)
	}
}

export async function clearWowFolder(): Promise<void> {
	if (!hasBackend()) return
	applyStatus(await SetWowPath(''))
}

const lists = new Map<string, Promise<string[]>>()

/** The client's paths of a kind, read once a client (`sheen`: the tilesets' `_s` twins, #336). */
export function listAssets(kind: 'm2' | 'wmo' | 'tileset' | 'sheen'): Promise<string[]> {
	let p = lists.get(kind)
	if (!p) {
		p = fetch(`/wow/list?kind=${kind}`)
			.then((r) => (r.ok ? r.json() : []))
			.catch(() => [])
		lists.set(kind, p)
	}
	return p
}

/**
 * The server URL for a client path. A model path may carry a query after '?' (a spawn's look, see
 * `spawnType`), which goes to the server as it is.
 */
const url = (endpoint: string, path: string) => {
	const q = path.indexOf('?')
	if (q < 0) return `/wow/${endpoint}?path=${encodeURIComponent(path)}`
	return `/wow/${endpoint}?path=${encodeURIComponent(path.slice(0, q))}&${path.slice(q + 1)}`
}

async function fetchBinary(endpoint: string, path: string): Promise<ArrayBuffer> {
	const t0 = performance.now()
	beginLoad(endpoint, path, t0)
	try {
		const r = await fetch(url(endpoint, path))
		if (!r.ok) throw new Error(`${path}: ${(await r.text()).trim() || r.status}`)
		const buf = await r.arrayBuffer()
		endLoad(false)
		logFile(endpoint, path, performance.now() - t0)
		return buf
	} catch (err) {
		endLoad(true)
		logFile(endpoint, path, performance.now() - t0, err)
		throw err
	}
}

/** A WMO's room data (groups, portals, collision faces, fogs), decoded by `world/wmoRoom.ts`. */
export function fetchWmoNav(path: string): Promise<ArrayBuffer> {
	return fetchBinary('wmonav', path)
}

/**
 * A model's collision faces for the walkable-ground preview (#175), nine floats a triangle in the
 * model's frame: an M2's hull, a WMO's collision faces and its doodads' hulls as the server's vmap
 * extractor takes them (#283); and each group's triangle count in turn (the hull, each WMO group
 * and each doodad; #282). A WMO's liquids come with them (#281): every vertex of its kept groups'
 * MLIQ grids, three indices a wet tile's triangle, and each triangle's liquid type as the server's
 * vmaps hold it (null for none). `path` may carry a WMO's `?set=<n>` as a model type does.
 */
export async function fetchCollision(path: string): Promise<CollisionReply> {
	return parseCollision(await fetchBinary('collision', path))
}

/**
 * Client tile (x, y) of the server's movement maps for map `mapId` (#240, `vmangos.NavTile`): the
 * map's navmesh origin and tile size, then the tile's Detour data (world/nav/navServer.ts reads it).
 * Null when the server has no tile there; throws when no VMaNGOS folder is set or the file is bad.
 */
export async function fetchNavTile(mapId: number, x: number, y: number): Promise<ArrayBuffer | null> {
	const r = await fetch(`/wow/navtile?map=${mapId}&x=${x}&y=${y}`)
	if (r.status === 404) return null
	if (!r.ok) throw new Error((await r.text()).trim() || `${r.status}`)
	return r.arrayBuffer()
}

export interface RawImage {
	width: number
	height: number
	pixels: Uint8Array
}

export async function fetchImage(path: string): Promise<RawImage> {
	const buf = await fetchBinary('texture', path)
	const dv = new DataView(buf)
	return { width: dv.getUint32(4, true), height: dv.getUint32(8, true), pixels: new Uint8Array(buf, 12) }
}

const textureCache = new Map<string, Promise<THREE.Texture>>()
let maxAnisotropy = 8
let compressedTextures = false

export function setMaxAnisotropy(n: number) {
	maxAnisotropy = n
}

/** The anisotropy the client's textures are sampled with: the GPU's most, up to 8. */
export function textureAnisotropy(): number {
	return Math.min(8, maxAnisotropy)
}

/**
 * Whether the renderer samples S3TC, with its sRGB forms (#178): then a DXT BLP goes to the GPU as the
 * client stores it, its own mips included, at an eighth to a quarter of the RGBA's size.
 */
export function setCompressedTextures(on: boolean) {
	compressedTextures = on
}

/** Whether DXT textures go to the GPU compressed (`setCompressedTextures`). */
export function compressedTexturesOn(): boolean {
	return compressedTextures
}

/** A BLP as the texture endpoint's DXT reply: its own blocks where it is DXT, else RGBA (`textureReply.ts`). */
export function fetchTextureDXT(path: string): Promise<ArrayBuffer> {
	return fetchBinary('texture', `${path}?fmt=dxt`)
}

/** The textures a caller other than a model's material asked for (liquids, particles, weather): never released. */
const pinnedTextures = new Set<string>()
/** The cache's textures once loaded, so a probe can tell them from the renderer's other textures (`isCachedTexture`). */
const cachedTextures = new WeakSet<THREE.Texture>()

/**
 * Load a BLP from the client as a mipmapped, repeating texture (cached). `model` marks a request
 * from a model's material, which `releaseTexture` may let go of once no model maps it (#505).
 */
export function loadTexture(path: string, model = false): Promise<THREE.Texture> {
	const key = path.toLowerCase()
	if (!model) pinnedTextures.add(key)
	let p = textureCache.get(key)
	if (!p) {
		p = fetchBinary('texture', compressedTextures ? `${path}?fmt=dxt` : path).then((buf) => {
			const t = textureFrom(buf)
			t.wrapS = t.wrapT = THREE.RepeatWrapping
			t.magFilter = THREE.LinearFilter
			t.minFilter = THREE.LinearMipmapLinearFilter
			t.anisotropy = textureAnisotropy()
			t.colorSpace = THREE.SRGBColorSpace
			t.flipY = false // BLP rows are top-down, matching WoW UVs
			t.needsUpdate = true
			t.name = path
			cachedTextures.add(t)
			return t
		})
		p.catch(() => textureCache.delete(key))
		textureCache.set(key, p)
	}
	return p
}

/**
 * Forgets a texture only models asked for and frees it on the GPU (#505), once the materials that
 * mapped it are gone; a texture something else asked for stays. Returns whether it was let go of.
 */
export function releaseTexture(path: string): boolean {
	const key = path.toLowerCase()
	const p = textureCache.get(key)
	if (!p || pinnedTextures.has(key)) return false
	textureCache.delete(key)
	p.then(
		(t) => {
			cachedTextures.delete(t)
			t.dispose()
		},
		() => {},
	)
	return true
}

/** How many client textures are cached for models alone, and how many for anything else (for tests and probes). */
export function cachedTextureCounts(): { models: number; pinned: number } {
	let pinned = 0
	for (const k of textureCache.keys()) if (pinnedTextures.has(k)) pinned++
	return { models: textureCache.size - pinned, pinned }
}

/**
 * Whether a texture is one of the cache's client textures (not a copy of one; for tests and probes):
 * the renderer's other textures are the ones a map, a layer or the engine made itself (#658).
 */
export function isCachedTexture(t: THREE.Texture): boolean {
	return cachedTextures.has(t)
}

/**
 * Small data-URL preview of a texture for UI lists. Both canvases are CPU-backed
 * (`willReadFrequently`): a GPU-backed one makes `toDataURL` wait for the GPU process, which in the
 * headless probe page (SwiftShader) took about 1 s an icon behind the viewport's frames, and only
 * 6 ms on the CPU (#233). The image is the same to within resampling (a mean of 2 levels in 255).
 */
export async function texturePreview(path: string, size = 64): Promise<string> {
	const img = await fetchImage(path)
	const src = document.createElement('canvas')
	src.width = img.width
	src.height = img.height
	const ctx = src.getContext('2d', { willReadFrequently: true })!
	const data = new ImageData(img.width, img.height)
	data.data.set(img.pixels)
	// Previews ignore alpha (tilesets often store specular there).
	for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255
	ctx.putImageData(data, 0, 0)
	const out = document.createElement('canvas')
	out.width = out.height = size
	out.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0, size, size)
	return out.toDataURL('image/jpeg', 0.85)
}

export async function fetchMesh(path: string): Promise<WowMesh> {
	return parseMesh(await fetchBinary('model', path))
}
