import * as THREE from 'three'
import { isHelper } from '../models/helpers'
import { engineRef } from '../state/engineRef'
import { buildWowAsset, getAsset, releaseWowAsset, texturesReady, wowPath, type ModelAsset } from '../models/assets'
import { placementEuler } from '../world/placement'
import type { Prefab } from './prefabs'
import { fetchMesh, texturePreview } from './api'
import { SaveThumbnail } from '../../../wailsjs/go/main/App'
import { bytesToBase64 } from '../io/base64'
import { ThumbQueue } from './thumbQueue'

// Palette thumbnails. Models render into an offscreen target on the main
// WebGL context (sharing GPU textures with the scene), then get cached as PNG
// in the user's cache dir by the Go side, so later sessions load instantly.

const VERSION = 'v2'
const SIZE = 176
const SUPERSAMPLE = 2

// Only tiles on screen ask for thumbnails, nearest the grid's centre first, and the grids prefetch
// the rows just outside the view (ThumbQueue). Three run at once: each needs the main renderer.
// The last 512 results are kept; an older one's blob URL is revoked (a data URL ignores that), so
// scrolling through thousands of models does not hold every PNG for the session. A tile on screen
// asked recently, so it is among those kept.
const queue = new ThumbQueue<string>(produce, 3, 512, (url) => {
	if (url.startsWith('blob:')) URL.revokeObjectURL(url)
})

// --- disk cache via Go ------------------------------------------------------

const cacheUrl = (key: string) => `/wow/thumb?key=${encodeURIComponent(VERSION + '|' + key)}`

async function fromCache(key: string): Promise<string | null> {
	try {
		const r = await fetch(cacheUrl(key))
		if (!r.ok) return null
		return URL.createObjectURL(await r.blob())
	} catch {
		return null
	}
}

// Stored through a Go binding: request bodies on the custom scheme crash WebKitGTK.
function toCache(key: string, blob: Blob) {
	blob.arrayBuffer()
		.then((b) => SaveThumbnail(VERSION + '|' + key, bytesToBase64(new Uint8Array(b))))
		.catch((err) => console.warn('thumbnail cache write failed', key, err))
}

// --- model rendering --------------------------------------------------------

let rig: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget } | null = null

function getRig() {
	if (!rig) {
		const scene = new THREE.Scene()
		scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.6, 0.7), new THREE.Color(0.25, 0.22, 0.18), Math.PI))
		const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.95, 0.85), Math.PI)
		sun.position.set(4, 6, 3)
		scene.add(sun)
		const target = new THREE.WebGLRenderTarget(SIZE * SUPERSAMPLE, SIZE * SUPERSAMPLE)
		target.texture.colorSpace = THREE.SRGBColorSpace
		rig = { scene, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 10000), target }
	}
	return rig
}

async function loadAsset(type: string): Promise<ModelAsset> {
	const asset = isHelper(type) ? getAsset(type) : buildWowAsset(await fetchMesh(wowPath(type)))
	await texturesReady(asset.material)
	return asset
}

async function renderModel(type: string): Promise<Blob> {
	const asset = await loadAsset(type)
	const mesh = new THREE.Mesh(asset.geometry, asset.material)
	try {
		return await capture(mesh, asset.bbox)
	} finally {
		if (!isHelper(type)) releaseWowAsset(asset)
	}
}

// Prefabs (#170) are drawn as all their models in one frame. The Prefabs tab registers each prefab
// under a key made from its file's text, so an edited file gets a new thumbnail.
const prefabs = new Map<string, Prefab>()

/** Makes `key` ("prefab:<hash>") draw `p` when its thumbnail is asked for. */
export function registerPrefab(key: string, p: Prefab) {
	prefabs.set(key, p)
}

async function renderPrefab(p: Prefab): Promise<Blob> {
	const assets = new Map<string, ModelAsset>()
	for (const type of new Set(p.objects.map((o) => o.type))) assets.set(type, await loadAsset(type))
	const group = new THREE.Group()
	const world = new Map<number, THREE.Matrix4>()
	const euler = new THREE.Euler()
	const q = new THREE.Quaternion()
	// Parents come first in a clip made by copyObjects; a few passes cover any order.
	let pending = p.objects
	for (let pass = 0; pass < 8 && pending.length; pass++) {
		const next: typeof pending = []
		for (const o of pending) {
			const parent = o.cparent === undefined ? null : world.get(o.cparent)
			if (o.cparent !== undefined && !parent) {
				next.push(o)
				continue
			}
			q.setFromEuler(placementEuler(euler, o.rotY, o.tiltX, o.tiltZ))
			const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.yOff, o.z), q, new THREE.Vector3(o.scale, o.scale, o.scale))
			if (parent) m.premultiply(parent)
			world.set(o.cid, m)
			const asset = assets.get(o.type)!
			const mesh = new THREE.Mesh(asset.geometry, asset.material)
			mesh.matrixAutoUpdate = false
			mesh.matrix.copy(m)
			group.add(mesh)
		}
		if (next.length === pending.length) break
		pending = next
	}
	group.updateMatrixWorld(true)
	try {
		return await capture(group, new THREE.Box3().setFromObject(group))
	} finally {
		for (const [type, a] of assets) if (!isHelper(type)) releaseWowAsset(a)
	}
}

/** Draws `object` (whose bounds are `bbox`) from the side its shape suits and gives the PNG. */
async function capture(object: THREE.Object3D, bbox: THREE.Box3): Promise<Blob> {
	const engine = engineRef.current
	if (!engine) throw new Error('renderer not ready')
	// While the viewport's context is lost (#209) a render gives blank pixels, which would be cached.
	await engine.contextReady()
	const { scene, camera, target } = getRig()
	scene.add(object)
	const s = bbox.getBoundingSphere(new THREE.Sphere())
	const r = Math.max(s.radius, 0.3)
	const d = (r / Math.sin(THREE.MathUtils.degToRad(15))) * 0.96
	// Tall things (trees, towers) are seen from lower down, flat things (rugs, platforms) from above.
	const size = bbox.getSize(new THREE.Vector3())
	const flat = Math.max(size.x, size.z)
	const dir = size.y > flat * 1.5 ? new THREE.Vector3(0.8, 0.3, 0.6) : size.y < flat * 0.3 ? new THREE.Vector3(0.5, 0.95, 0.4) : new THREE.Vector3(0.75, 0.5, 0.65)
	dir.normalize()
	camera.position.copy(s.center).addScaledVector(dir, d)
	camera.near = d / 50
	camera.far = d * 3
	camera.updateProjectionMatrix()
	camera.lookAt(s.center)

	const renderer = engine.renderer
	const px = SIZE * SUPERSAMPLE
	const buf = new Uint8Array(px * px * 4)
	const prevTarget = renderer.getRenderTarget()
	const prevAlpha = renderer.getClearAlpha()
	renderer.setRenderTarget(target)
	renderer.setClearAlpha(0)
	renderer.clear()
	renderer.render(scene, camera)
	renderer.readRenderTargetPixels(target, 0, 0, px, px, buf)
	renderer.setRenderTarget(prevTarget)
	renderer.setClearAlpha(prevAlpha)
	scene.remove(object)
	if (renderer.getContext().isContextLost()) throw new Error('the viewport lost its WebGL context')

	// Flip (GL rows are bottom-up) and downsample for smooth edges.
	const big = document.createElement('canvas')
	big.width = big.height = px
	const img = new ImageData(px, px)
	for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4)
	big.getContext('2d')!.putImageData(img, 0, 0)
	const small = document.createElement('canvas')
	small.width = small.height = SIZE
	const ctx = small.getContext('2d')!
	ctx.imageSmoothingQuality = 'high'
	ctx.drawImage(big, 0, 0, SIZE, SIZE)
	return new Promise((res, rej) => small.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

async function produce(key: string): Promise<string> {
	if (key.startsWith('tex:')) return texturePreview(key.slice(4), SIZE)
	const cached = await fromCache(key)
	if (cached) return cached
	const prefab = key.startsWith('prefab:') ? prefabs.get(key) : null
	if (key.startsWith('prefab:') && !prefab) throw new Error('unknown prefab')
	const blob = prefab ? await renderPrefab(prefab) : await renderModel(key)
	toCache(key, blob)
	return URL.createObjectURL(blob)
}

/**
 * Request a thumbnail for a model type ("m2:..."/"wmo:...") or texture ("tex:<path>"). `onReady`
 * gets an image URL. Lower `priority` values are made first (a tile's distance from its grid's
 * centre). Returns a cancel function (cancels only if the work hasn't started yet).
 */
export function requestThumb(key: string, onReady: (url: string) => void, onError?: () => void, priority = 0): () => void {
	return queue.request(key, priority, onReady, () => onError?.())
}

/**
 * The thumbnails to make once the ones on screen are done: the rows just outside the view, so
 * scrolling finds them ready. Replaces the previous set; `priority` orders them (nearest first).
 */
export function prefetchThumbs(wanted: { key: string; priority: number }[]) {
	queue.prefetch(wanted)
}

/** How many rows beyond each edge of the view a grid prepares. */
export const PREFETCH_ROWS = 3

/**
 * Prefetches the rows just outside a virtualised grid's rendered rows `first..last` (exclusive),
 * the nearest first and those below before those above; `key(i)` names item i's thumbnail. Rows
 * beyond the view count less than every tile on screen (priorities from 1e4 up).
 */
export function prefetchAround(count: number, cols: number, first: number, last: number, key: (i: number) => string) {
	const wanted: { key: string; priority: number }[] = []
	const rows = Math.ceil(count / cols)
	for (let d = 0; d < PREFETCH_ROWS; d++) {
		for (const row of [last + d, first - 1 - d]) {
			if (row < 0 || row >= rows) continue
			for (let i = row * cols; i < Math.min(count, (row + 1) * cols); i++) {
				const k = key(i)
				if (k) wanted.push({ key: k, priority: 1e4 + wanted.length })
			}
		}
	}
	prefetchThumbs(wanted)
}
