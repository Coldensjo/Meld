import * as THREE from 'three'
import { fetchMesh, loadTexture, releaseTexture, type MeshEffect, type MeshEmitter, type MeshGroup, type MeshRibbon, type WowLiquid, type WowMesh } from '../wow/api'
import { colorAt, colorFades, colorIsStatic, uvMatrix, type ColorAnimSpec, type UVAnimSpec } from '../world/uvAnim'
import { ModelAnimation } from '../world/Animator'
import { patchCascadeShadows } from '../engine/shadowCascades'
import { patchRoomGate, ROOM_ATTRIBUTE } from '../world/roomGate'
import { buildBoundsTree } from '../world/bvh'
import { markShadowMoving } from '../world/shadowReach'
import { adoptModel, buildModel } from './modelBuild'
import { farLayersDrawn, farLod, farPlan, releaseFarLayers } from './farLayers'
import { helperGeometry, helperMaterial, helperName, isHelper } from './helpers'
import { RETRY_MS } from '../wow/loadCache'
import type { LiquidClass } from '../water/liquids'

/**
 * A placeable model: one geometry (with groups) and one material per group.
 * Object types are WoW client paths prefixed with "m2:" or "wmo:", loaded
 * asynchronously from the Go backend.
 */
export interface ModelAsset {
	geometry: THREE.BufferGeometry
	material: THREE.Material | THREE.Material[]
	bbox: THREE.Box3
	/** False for the placeholder shown while loading or when loading failed. */
	ready: boolean
	/** Idle animation, if the model moves: poses `skeleton` each frame. */
	anim?: ModelAnimation
	/** The bones every mesh of an animated model is skinned with (see world/Animator.ts). */
	skeleton?: THREE.Skeleton
	/** Lights and flames in model space. */
	effects: MeshEffect[]
	/** Particle emitters in model space (world/particles.ts). */
	emitters: MeshEmitter[]
	/** Ribbon emitters in model space (world/ribbons.ts). */
	ribbons: MeshRibbon[]
	/**
	 * A simplified model for instances far away (see lod.ts): sharing the geometry's vertices, or, for a
	 * WMO, its groups merged by class with vertices of its own (farLayers.ts, #691).
	 */
	lod?: THREE.BufferGeometry
	/** The materials `lod` draws with, when not `material`: a far WMO's (the model's, then its classes'). */
	lodMaterial?: THREE.Material[]
	/** The texture layers a far WMO's `lod` took, let go of with it. */
	farLayers?: string[]
	/**
	 * A WMO's lava and water (its groups' MLIQ, #287), drawn by ObjectLayer with `wmoLiquidMaterial`
	 * as a mesh of its own: never picked and casting no shadow.
	 */
	liquid?: THREE.BufferGeometry
	/**
	 * A model the client draws nothing of (a collision blocker, an invisible trigger; #333): drawn
	 * as a see-through wireframe of its collision hull (or a small diamond without one), so it can be
	 * found, picked and deleted, and casting no shadow, as in the game.
	 */
	marker?: boolean
}

export type ModelKind = 'm2' | 'wmo'

export const isWowType = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')
export const wowPath = (type: string) => type.slice(type.indexOf(':') + 1)

export function displayName(type: string): string {
	if (isHelper(type)) return helperName(type)
	const p = isWowType(type) ? wowPath(type) : type
	const q = p.indexOf('?')
	const path = q < 0 ? p : p.slice(0, q)
	return path.slice(path.lastIndexOf('\\') + 1).replace(/\.(m2|wmo|mdx)$/i, '')
}

const assets = new Map<string, ModelAsset>()
const pending = new Map<string, Promise<ModelAsset>>()
/** Kept assets built and waiting for their bounds tree and LOD, not yet in `assets`: their shared materials are in use. */
const building = new Set<ModelAsset>()
/** Assets built outside the registry (thumbnails, previews) and not yet released: their shared materials are in use. */
const loose = new Set<ModelAsset>()
/** Types released while they loaded (`releaseAssets`): let go of on arrival unless asked for again. */
const dropOnArrival = new Set<string>()
const listeners = new Set<(type: string) => void>()

/** Subscribe to "asset finished loading" notifications. */
export function onAssetLoaded(fn: (type: string) => void): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

let placeholder: ModelAsset | null = null
function placeholderMaterial() {
	const m = new THREE.MeshLambertMaterial({ color: 0xcc44cc, transparent: true, opacity: 0.6 })
	patchCascadeShadows(m)
	return m
}
function getPlaceholder(): ModelAsset {
	if (!placeholder) {
		const g = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0)
		g.computeBoundingBox()
		placeholder = {
			geometry: g,
			material: placeholderMaterial(),
			bbox: g.boundingBox!.clone(),
			ready: false,
			effects: [],
			emitters: [],
			ribbons: [],
		}
	}
	return placeholder
}

/** When each model that failed to load last failed: the loader tries it again after RETRY_MS. */
const failedAt = new Map<string, number>()

/**
 * Returns the asset if loaded, otherwise a placeholder (and starts loading).
 * Listen with `onAssetLoaded` to swap the placeholder out.
 */

export function getAsset(type: string): ModelAsset {
	const a = assets.get(type)
	if (a) return a
	if (isHelper(type)) {
		// A helper is generated at once, never loaded (models/helpers.ts).
		const g = helperGeometry(type)
		if (g) {
			g.computeBoundingBox()
			buildBoundsTree(g)
			const helper: ModelAsset = { geometry: g, material: helperMaterial(), bbox: g.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [] }
			assets.set(type, helper)
			return helper
		}
	}
	if (pending.has(type)) dropOnArrival.delete(type)
	else if (isWowType(type) && retryDue(type)) void loadAsset(type)
	return getPlaceholder()
}

function retryDue(type: string): boolean {
	const t = failedAt.get(type)
	return t === undefined || performance.now() - t >= RETRY_MS
}

export function loadAsset(type: string): Promise<ModelAsset> {
	const have = assets.get(type)
	if (have) return Promise.resolve(have)
	if (!isWowType(type)) return Promise.resolve(getPlaceholder())
	dropOnArrival.delete(type)
	let p = pending.get(type)
	if (!p) {
		p = fetchMesh(wowPath(type))
			.then(async (m) => {
				// Built first, so its textures load while the worker builds the rest.
				const asset = buildWowAsset(m, type)
				if (asset.marker) {
					buildBoundsTree(asset.geometry)
					return asset
				}
				building.add(asset)
				try {
					// The bounds tree, the LOD and the WMO group cull, off the main thread (#507); a WMO's LOD
					// with its groups merged by class too (#691).
					const plan = type.startsWith('wmo:') ? farPlan(m.groups, !!m.colors, !!m.rooms) : undefined
					const data = await buildModel(asset.geometry, plan?.classes)
					const lod = adoptModel(asset.geometry, data)
					const far = lod && data.far && plan ? farLod(asset.geometry, data.far, plan, asset.material as THREE.Material[]) : undefined
					if (far) {
						asset.lod = far.geometry
						asset.lodMaterial = far.material
						asset.farLayers = far.layers
					} else asset.lod = lod
				} finally {
					building.delete(asset)
				}
				return asset
			})
			.catch((err) => {
				// Not cached: the next request after RETRY_MS tries the model again.
				console.warn('model load failed', type, err)
				failedAt.set(type, performance.now())
				return getPlaceholder()
			})
			.then((asset) => {
				pending.delete(type)
				if (dropOnArrival.delete(type)) {
					// Its map closed while it loaded, and nothing asked for it since.
					animatedAssets.delete(type)
					if (asset.ready) evict([asset])
					return asset
				}
				if (asset.ready) assets.set(type, asset)
				listeners.forEach((fn) => fn(type))
				return asset
			})
		pending.set(type, p)
	}
	return p
}

const materialCache = new Map<string, THREE.Material>()

/** The textures that move (M2 texture transforms): each animated group's own copy of its texture, and its animation. */
const uvAnimated: Array<{ material: THREE.Material; texture: THREE.Texture; spec: UVAnimSpec; cutout: boolean }> = []
/** The materials whose colour or transparency changes (M2 colours and weights), with their colour before the tint. */
const colorAnimated: Array<{ material: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial; base: THREE.Color; spec: ColorAnimSpec }> = []
const uvRows = [0, 0, 0, 0, 0, 0]
const rgba = [1, 1, 1, 1]
let animatedAt = -1
/** How many textures have been bound to model materials, so a shadow map drawn before one arrived is redrawn. */
let texturesBound = 0

/** Bumped each time a model material, or a far WMO's layer (farLayers.ts), gets its texture (an alpha-tested one casts a different shadow with it). */
export function texturesBoundCount(): number {
	return texturesBound + farLayersDrawn()
}

/**
 * Tints `m` from its `base` colour and sets its opacity, as the client draws an M2 colour; at 0 or less
 * it is not drawn. Returns whether it was shown or hidden by this.
 */
function applyColor(m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, base: THREE.Color, c: number[]): boolean {
	// The client tints in its own (sRGB) colour space; a product there is the product of the linear values.
	m.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).multiply(base)
	m.opacity = Math.min(1, Math.max(0, c[3]))
	const shown = c[3] > 0
	if (m.visible === shown) return false
	m.visible = shown
	return true
}

/**
 * Moves every animated texture and colour to time `ms`, as the client does (world/uvAnim.ts). All
 * instances of a model share the material, so they move in sync, as the bones do. Returns whether a
 * shadow changed with them: a material shown or hidden, or a moving texture on an alpha-tested one
 * (whose cut-out shape the shadow maps take).
 */
export function updateMaterialAnimations(ms: number): boolean {
	const moved = ms !== animatedAt
	animatedAt = ms
	let shadows = false
	for (const a of uvAnimated) {
		const m = uvMatrix(a.spec, ms, uvRows)
		a.texture.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1)
		if (moved && a.cutout) shadows = true
	}
	for (const a of colorAnimated) if (applyColor(a.material, a.base, colorAt(a.spec, ms, rgba))) shadows = true
	return shadows
}

function wowMaterial(g: MeshGroup, vertexColors: boolean, rooms: boolean): THREE.Material {
	// A WMO's materials carry the room gate, so they are never shared with an M2's.
	const key = `${g.texture.toLowerCase()}|${g.blend}|${g.twoSided}|${g.unlit}|${!!g.interior}|${vertexColors}|${rooms}`
	// A group whose texture moves gets a material of its own, so its texture's matrix moves only it, and
	// so does one with a colour of its own.
	const moving = !!g.uv && !!g.texture
	const own = moving || !!g.color
	let m = own ? undefined : materialCache.get(key)
	if (m) return m
	// An interior without baked colours would be full bright unlit, so it gets a dim grey instead.
	const interior = !!g.interior && !g.unlit
	const params: THREE.MeshLambertMaterialParameters = {
		vertexColors,
		side: g.twoSided ? THREE.DoubleSide : THREE.FrontSide,
		color: !g.texture ? 0x9a9a9a : interior && !vertexColors ? 0x707070 : 0xffffff,
	}
	switch (g.blend) {
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
		case 4:
			params.transparent = true
			params.depthWrite = false
			params.blending = THREE.AdditiveBlending
			break
		default: // 5, 6: modulate
			params.transparent = true
			params.depthWrite = false
			params.blending = THREE.MultiplyBlending
			params.premultipliedAlpha = true
	}
	// A colour that can fade blends, even on an opaque batch, as the client draws it.
	if (g.color && colorFades(g.color)) params.transparent = true
	// Interiors are lit by their baked colours alone, as in the game: no sun, sky or shadows reach them.
	m = g.unlit || interior ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params)
	if (g.color) {
		const tinted = m as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial
		const base = tinted.color.clone()
		applyColor(tinted, base, colorAt(g.color, 0, rgba))
		if (!colorIsStatic(g.color)) colorAnimated.push({ material: tinted, base, spec: g.color })
	}
	// A moving cut-out or a colour that can fade out changes the shadow as it animates: the near shadow
	// map draws batches with one apart from the still ones (#346).
	if ((moving && params.alphaTest) || (g.color && !colorIsStatic(g.color) && colorFades(g.color))) markShadowMoving(m)
	// Cast shadows from both faces: three's default casts from the back faces only, and a building's
	// single-sided walls then let the sun through onto the walls behind them.
	m.shadowSide = THREE.DoubleSide
	if (m instanceof THREE.MeshLambertMaterial) patchCascadeShadows(m)
	if (rooms) patchRoomGate(m)
	// Not cached, so an asset that is not kept lets go of it (releaseWowAsset).
	if (own) m.userData.own = true
	else m.userData.cacheKey = key
	// The client texture it maps, which `releaseAssets` lets go of with the last material mapping it.
	if (g.texture) m.userData.texture = g.texture.toLowerCase()
	const mat = m as THREE.MeshLambertMaterial
	// userData.ready resolves once the texture is bound (or failed).
	mat.userData.ready = g.texture
		? loadTexture(g.texture, true)
				.then((t) => {
					// Released before its texture came (a preview moved on): nothing to bind or animate.
					if (mat.userData.released) return
					if (moving) {
						// A copy shares the image (three keeps one GPU texture for both) but has its own matrix.
						t = t.clone()
						t.matrixAutoUpdate = false
						uvAnimated.push({ material: mat, texture: t, spec: g.uv as UVAnimSpec, cutout: mat.alphaTest > 0 })
					}
					mat.map = t
					mat.needsUpdate = true
					texturesBound++
				})
				.catch(() => mat.color.set(0x9a9a9a))
		: Promise.resolve()
	if (!own) materialCache.set(key, m)
	return m
}

/** How many textures and colours `updateMaterialAnimations` moves each frame (for tests and probes). */
export function animatedCount(): number {
	return uvAnimated.length + colorAnimated.length
}

/**
 * Lets go of an asset that is not kept (a thumbnail, a preview; #506): its geometry, and the materials
 * `buildWowAsset` made for it alone (a moving texture or colour), which stop being animated each frame
 * and are disposed with their texture copies. The shared materials and textures stay. Works on a
 * helper's asset too, whose shared material it leaves alone.
 */
export function releaseWowAsset(asset: ModelAsset) {
	loose.delete(asset)
	asset.geometry.dispose()
	asset.lod?.dispose()
	if (asset.farLayers) releaseFarLayers(asset.farLayers)
	asset.farLayers = undefined
	asset.liquid?.dispose()
	asset.skeleton?.dispose()
	const own = new Set<THREE.Material>()
	for (const m of Array.isArray(asset.material) ? asset.material : [asset.material]) {
		if (!m.userData.own || m.userData.released) continue
		m.userData.released = true
		own.add(m)
	}
	if (!own.size) return
	let j = 0
	for (const a of uvAnimated) {
		// The copy shares its image with the cached texture: three frees the GPU texture with the last user.
		if (own.has(a.material)) a.texture.dispose()
		else uvAnimated[j++] = a
	}
	uvAnimated.length = j
	j = 0
	for (const a of colorAnimated) if (!own.has(a.material)) colorAnimated[j++] = a
	colorAnimated.length = j
	for (const m of own) m.dispose()
}

function materialsOf(a: ModelAsset): THREE.Material[] {
	return Array.isArray(a.material) ? a.material : [a.material]
}

/**
 * Lets go of the kept models of `types` (#505: the models of a closed map nothing else uses), as
 * `releaseWowAsset` does a preview's, with their bounds trees, LODs and WMO group cull twins (which go
 * with the geometry's dispose event); then of the shared materials no other asset (kept, loading, a
 * thumbnail or a preview) uses, and of the textures no remaining material maps. A type still loading
 * is let go of when it arrives, unless something asks for it before. The caller makes sure no drawn
 * mesh still uses them; a later `getAsset` loads the model again. Returns how many were let go of.
 */
export function releaseAssets(types: Iterable<string>): number {
	const gone: ModelAsset[] = []
	for (const t of types) {
		if (isHelper(t)) continue
		const a = assets.get(t)
		if (!a) {
			if (pending.has(t)) dropOnArrival.add(t)
			continue
		}
		assets.delete(t)
		animatedAssets.delete(t)
		gone.push(a)
	}
	if (gone.length) evict(gone)
	return gone.length
}

function evict(gone: ModelAsset[]) {
	const textures = new Set<string>()
	for (const a of gone) {
		for (const m of materialsOf(a)) if (m.userData.texture) textures.add(m.userData.texture as string)
		a.geometry.disposeBoundsTree?.()
		// A marker's material is shared by every marker, and stays.
		if (a.marker) a.geometry.dispose()
		else releaseWowAsset(a)
	}
	// The materials and textures the remaining assets use.
	const used = new Set<THREE.Material>()
	const mapped = new Set<string>()
	const use = (a: ModelAsset) => {
		for (const m of materialsOf(a)) {
			used.add(m)
			if (m.userData.texture) mapped.add(m.userData.texture as string)
		}
	}
	for (const a of assets.values()) use(a)
	for (const a of building) use(a)
	for (const a of loose) use(a)
	for (const a of gone)
		for (const m of materialsOf(a)) {
			const key = m.userData.cacheKey as string | undefined
			if (key === undefined || used.has(m) || materialCache.get(key) !== m) continue
			materialCache.delete(key)
			// A texture still on its way is not bound to it.
			m.userData.released = true
			m.dispose()
		}
	for (const t of textures) if (!mapped.has(t)) releaseTexture(t)
}

/** Whether the registry keeps the model `type`, loaded (for tests and probes; unlike `getAsset`, never starts a load). */
export function isKept(type: string): boolean {
	return assets.has(type)
}

/** How many models the registry keeps, shared materials it caches and animated models it poses (for tests and probes). */
export function keptCounts(): { models: number; materials: number; animated: number } {
	return { models: assets.size, materials: materialCache.size, animated: animatedAssets.size }
}

/**
 * Adds to `types` the models the particles of its loaded models are drawn as (an emitter's
 * `geometry`), so they are kept or let go of with them.
 */
export function withParticleModels(types: Set<string>): Set<string> {
	const add = (list: MeshEmitter[]) => {
		for (const e of list) {
			if (e.geometry) types.add(`m2:${e.geometry}`)
			if (e.children) add(e.children)
		}
	}
	for (const t of [...types]) {
		const a = assets.get(t)
		if (a) add(a.emitters)
	}
	return types
}

const LIQUID_CLASSES: LiquidClass[] = ['river', 'ocean', 'magma', 'slime']

/**
 * A WMO's liquid surfaces as a geometry for `wmoLiquidMaterial`, the kinds it holds in
 * `userData.liquidKinds` (whose frames ObjectLayer asks for: importing the material here would loop
 * back through the terrain).
 */
function liquidGeometry(l: WowLiquid): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(l.positions, 3))
	g.setAttribute('uv', new THREE.BufferAttribute(l.uvs, 2))
	g.setAttribute('liquid', new THREE.BufferAttribute(l.info, 4))
	g.setAttribute('body', new THREE.BufferAttribute(l.body, 4, true))
	g.setAttribute(ROOM_ATTRIBUTE, new THREE.BufferAttribute(l.rooms, 2))
	g.setIndex(new THREE.BufferAttribute(l.indices, 1))
	g.computeBoundingBox()
	g.computeBoundingSphere()
	const kinds = new Set<LiquidClass>()
	for (let i = 0; i < l.info.length; i += 4) if (LIQUID_CLASSES[l.info[i]]) kinds.add(LIQUID_CLASSES[l.info[i]])
	g.userData.liquidKinds = [...kinds]
	return g
}

/** Resolves when every texture used by the given material(s) has loaded. */
export function texturesReady(material: THREE.Material | THREE.Material[]): Promise<unknown> {
	const list = Array.isArray(material) ? material : [material]
	return Promise.allSettled(list.map((m) => m.userData.ready as Promise<void> | undefined))
}

/** Whether the client draws nothing of a model: Go then sends its collision hull and no groups (#333). */
export function nothingToDraw(m: WowMesh): boolean {
	return m.groups.length === 0 && m.effects.length === 0 && m.emitters.length === 0 && m.ribbons.length === 0 && !m.liquid
}

let markerMaterial: THREE.Material | null = null

/** A model with nothing to draw, as a marker (ModelAsset.marker): its hull's wireframe, or a diamond. */
function markerAsset(m: WowMesh): ModelAsset {
	let geo: THREE.BufferGeometry
	if (m.indices.length >= 3) {
		geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
		geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
	} else {
		geo = new THREE.OctahedronGeometry(0.8).translate(0, 1, 0)
	}
	geo.computeBoundingBox()
	geo.computeBoundingSphere()
	markerMaterial ??= new THREE.MeshBasicMaterial({ color: 0xb0b0b0, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false })
	return { geometry: geo, material: markerMaterial, bbox: geo.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [], marker: true }
}

/** Every animated model loaded so far, by type (the Engine drives the ones in view each frame). */
export const animatedAssets = new Map<string, ModelAsset>()

/**
 * Builds geometry + materials. `animateAs` is the type to register the idle animation under, for a
 * kept asset only (thumbnails and previews pass nothing and show the bind pose). Callers that don't
 * keep the asset pass it to `releaseWowAsset` when done with it, which frees the geometry and the
 * materials of its own: until then its moving textures and colours animate with the scene's.
 */
export function buildWowAsset(m: WowMesh, animateAs?: string): ModelAsset {
	if (nothingToDraw(m)) return markerAsset(m)
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
	geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
	geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
	const vc = !!m.colors
	if (m.colors) geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 4, true))
	if (m.rooms) geo.setAttribute(ROOM_ATTRIBUTE, new THREE.BufferAttribute(m.rooms, 2))
	const nVerts = m.positions.length / 3
	geo.setIndex(new THREE.BufferAttribute(nVerts < 65535 ? Uint16Array.from(m.indices) : m.indices, 1))
	const materials = m.groups.map((g, i) => {
		geo.addGroup(g.start, g.count, i)
		return wowMaterial(g, vc, !!m.rooms)
	})
	geo.computeBoundingSphere()
	const b = m.bbox
	const bbox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))
	geo.boundingBox = bbox.clone()
	const asset: ModelAsset = { geometry: geo, material: materials, bbox, ready: true, effects: m.effects, emitters: m.emitters, ribbons: m.ribbons }
	if (m.liquid && m.liquid.indices.length) asset.liquid = liquidGeometry(m.liquid)
	if (animateAs !== undefined && m.bones && m.boneIdx && m.boneW) {
		asset.anim = new ModelAnimation(geo, m.bones, m.boneIdx, m.boneW)
		asset.skeleton = asset.anim.skeleton
		animatedAssets.set(animateAs, asset)
	}
	// Not kept: its shared materials count as used until `releaseWowAsset`.
	if (animateAs === undefined) loose.add(asset)
	return asset
}
