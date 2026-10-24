// Draws a cube world (#30): one group a layer holding its chunks' meshes (mesher.ts) merged into
// batches of BATCH x BATCH chunks, one mesh a part, to keep the draw calls few (#67), built a few
// chunks a frame so a large world opens without a stall, and the layer slice, which shows only a
// layer and those above it or below it, with the slice layer's cut faces capped so the builder looks
// into solid ground rather than through it. It also keeps where the lava's light hangs, one a chunk
// with lava as the client's scene.rs, which the mood's lights use (moodLights.ts, 3dgame #178).

import * as THREE from 'three'
import { CHUNK_SIZE, GROUND_LAYER, LAYER_COUNT, type CubeWorld } from './world'
import { CUBE_SIZE } from './shapes'
import type { CubeBox } from './clip'
import { ObjectMarks } from './ObjectMarks'
import { PropLayer } from './PropLayer'
import { MoodMarks } from './MoodMarks'
import { patchCascadeShadows } from '../engine/shadowCascades'
import { animateCubeAtlas, blendMask, cubeAtlas, cubeGlowAtlas } from './textures'
import { CAP_BOTTOM, CAP_NONE, CAP_TOP, PART_BLEND, PART_COUNT, PART_GLOW, PART_LIQUID, PART_OVERLAY, PART_SPRITE, layerBottom, meshChunk, type MeshPart } from './mesher'
import { spriteSheet } from './sprites'

/** The layer slice: off, or only `layer` and the layers above it (`above`) or below it (`below`). */
export interface CubeSlice {
	mode: 'off' | 'above' | 'below'
	layer: number
}

let materials: THREE.Material[] | null = null

/**
 * The materials of the parts, shared by every chunk of every world: lit cubes, see-through liquids and
 * glowing lava, each the texture atlas (textures.ts) tinted by the vertex colours, as the client's; the
 * lit cubes glow where the glow atlas does.
 */
function partMaterials(): THREE.Material[] {
	if (!materials) {
		const map = cubeAtlas()
		const m: THREE.Material[] = []
		// What of a texture glows (a lit window painted on a wall) shows at full strength, unlit.
		m[0] = new THREE.MeshLambertMaterial({ vertexColors: true, map, emissive: 0xffffff, emissiveMap: cubeGlowAtlas() })
		m[PART_LIQUID] = new THREE.MeshLambertMaterial({ vertexColors: true, map, transparent: true, depthWrite: false })
		m[PART_GLOW] = new THREE.MeshBasicMaterial({ vertexColors: true, map })
		// The blended edges' overlays (#84) are lit as the cubes they lie on, faded by the blend mask on
		// uv channel 1, drawn over the face without writing depth and pulled a little towards the eye so
		// they never fight it; they draw before the liquids (renderOrder 0), so water over them hides them.
		m[PART_BLEND] = new THREE.MeshLambertMaterial({
			vertexColors: true,
			map,
			emissive: 0xffffff,
			emissiveMap: cubeGlowAtlas(),
			alphaMap: blendMask(),
			transparent: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -4,
		})
		// The lit parts read the key light's shadow from both cascades (#158), and the cubes cast from
		// both faces: three casts from the back faces only, and a cut-open shape then lets the sun through.
		patchCascadeShadows(m[0])
		patchCascadeShadows(m[PART_LIQUID])
		patchCascadeShadows(m[PART_BLEND])
		m[0].shadowSide = THREE.DoubleSide
		materials = m
	}
	return materials
}

/** How bright the glowing parts of the lit cubes' textures are, their emissive strength: 1 under the work light, the mood's `glow` under a mood (3dgame #142). */
export function setCubeGlow(glow: number) {
	const m = partMaterials()
	;(m[0] as THREE.MeshLambertMaterial).emissiveIntensity = glow
	;(m[PART_BLEND] as THREE.MeshLambertMaterial).emissiveIntensity = glow
}

/** Chunks a batch spans along x and z: a batch is one mesh a part for up to BATCH x BATCH chunks of one layer (#67). */
export const BATCH = 4

/** How high the lava's light hangs over the middle of a chunk's lava, metres (scene.rs GLOW_HEIGHT). */
const GLOW_HEIGHT = 4

/** One mesh of a part of a batch, from its chunks' parts placed at their corners in the batch. */
function partMesh(parts: { part: MeshPart; dx: number; dz: number }[], p: number, material: THREE.Material): THREE.Mesh {
	let verts = 0
	let idx = 0
	for (const { part } of parts) {
		verts += part.positions.length / 3
		idx += part.indices.length
	}
	const positions = new Float32Array(verts * 3)
	const normals = new Float32Array(verts * 3)
	const uvs = new Float32Array(verts * 2)
	// The blended edges' place on the blend mask (#84), on uv channel 1.
	const uvs1 = p === PART_BLEND ? new Float32Array(verts * 2) : null
	const colours = new Float32Array(verts * 4)
	const indices = new Uint32Array(idx)
	let v = 0
	let i = 0
	for (const { part, dx, dz } of parts) {
		if (uvs1 && part.uvs1) uvs1.set(part.uvs1, v * 2)
		const pos = part.positions
		for (let k = 0; k < pos.length; k += 3) {
			positions[v * 3 + k] = pos[k] + dx
			positions[v * 3 + k + 1] = pos[k + 1]
			positions[v * 3 + k + 2] = pos[k + 2] + dz
		}
		normals.set(part.normals, v * 3)
		uvs.set(part.uvs, v * 2)
		colours.set(part.colours, v * 4)
		for (let k = 0; k < part.indices.length; k++) indices[i + k] = part.indices[k] + v
		v += pos.length / 3
		i += part.indices.length
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
	g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
	if (uvs1) g.setAttribute('uv1', new THREE.BufferAttribute(uvs1, 2))
	g.setAttribute('color', new THREE.BufferAttribute(colours, 4))
	g.setIndex(new THREE.BufferAttribute(indices, 1))
	g.computeBoundingSphere()
	const mesh = new THREE.Mesh(g, material)
	// Liquids draw after the opaque cubes.
	if (p === PART_LIQUID) mesh.renderOrder = 1
	// The cubes cast and receive the key light's shadow (#158); a liquid and a blended edge's overlay only
	// receive it, and glowing lava, unlit, neither.
	mesh.castShadow = p !== PART_LIQUID && p !== PART_GLOW && p !== PART_BLEND && p !== PART_OVERLAY
	mesh.receiveShadow = p !== PART_GLOW
	mesh.matrixAutoUpdate = false
	return mesh
}

/** Takes meshes out of their group and frees their geometry. */
function dropMeshes(meshes: THREE.Mesh[] | undefined) {
	if (!meshes) return
	for (const m of meshes) {
		m.removeFromParent()
		m.geometry.dispose()
	}
}

/**
 * Chunks' meshes drawn in batches (#67): each chunk's parts are kept as the mesher gave them, and a
 * batch's meshes (one a part) are merged from its chunks' parts, so a change to a chunk re-meshes that
 * chunk alone and merges its batch again. One of these holds the world's meshes, another the slice's caps.
 */
class Batches {
	/** Each meshed chunk's parts, by chunk key. */
	private readonly parts = new Map<number, (MeshPart | null)[]>()
	/** Each batch's meshes, by batch key. */
	private readonly meshes = new Map<number, THREE.Mesh[]>()

	constructor(
		private readonly world: CubeWorld,
		/** The group a layer's batches go in. */
		private readonly into: (layer: number) => THREE.Group,
		/** The material of each part: the shared ones, and the world's own for its pictures (PART_SPRITE). */
		private readonly material: (part: number) => THREE.Material,
	) {}

	/** Meshes chunk (cx, cz, layer) again, with `cap` (mesher CAP_*), and gives its parts; its batch is merged by `merge`. */
	mesh(cx: number, cz: number, layer: number, cap: number): (MeshPart | null)[] {
		const parts = meshChunk(this.world, cx, cz, layer, cap)
		this.parts.set(this.world.chunkKey(cx, cz, layer), parts)
		return parts
	}

	/** Merges the batch holding chunk (cx, cz, layer) from its chunks' parts, in place of its meshes. */
	merge(cx: number, cz: number, layer: number) {
		const w = this.world
		const bx = Math.floor(cx / BATCH)
		const bz = Math.floor(cz / BATCH)
		const key = batchKey(w, bx, bz, layer)
		dropMeshes(this.meshes.get(key))
		const byPart: { part: MeshPart; dx: number; dz: number }[][] = Array.from({ length: PART_COUNT }, () => [])
		const side = CHUNK_SIZE * CUBE_SIZE
		for (let z = bz * BATCH; z < Math.min(w.chunksZ, (bz + 1) * BATCH); z++) {
			for (let x = bx * BATCH; x < Math.min(w.chunksX, (bx + 1) * BATCH); x++) {
				const parts = this.parts.get(w.chunkKey(x, z, layer))
				if (!parts) continue
				for (let p = 0; p < PART_COUNT; p++) {
					const part = parts[p]
					if (part) byPart[p].push({ part, dx: (x - bx * BATCH) * side, dz: (z - bz * BATCH) * side })
				}
			}
		}
		const made: THREE.Mesh[] = []
		for (let p = 0; p < PART_COUNT; p++) {
			if (byPart[p].length === 0) continue
			const mesh = partMesh(byPart[p], p, this.material(p))
			mesh.position.set(bx * BATCH * side, layerBottom(layer), bz * BATCH * side)
			mesh.updateMatrix()
			mesh.name = `batch ${bx},${bz}`
			this.into(layer).add(mesh)
			made.push(mesh)
		}
		this.meshes.set(key, made)
	}

	clear() {
		for (const m of this.meshes.values()) dropMeshes(m)
		this.meshes.clear()
		this.parts.clear()
	}
}

/** A batch's key: its place in the grid of batches, layer by layer. */
function batchKey(w: CubeWorld, bx: number, bz: number, layer: number) {
	const nx = Math.ceil(w.chunksX / BATCH)
	const nz = Math.ceil(w.chunksZ / BATCH)
	return (layer * nz + bz) * nx + bx
}

export class CubeLayer {
	readonly group = new THREE.Group()
	/** One group a layer, by layer index, holding its chunks' meshes. */
	private readonly layers: THREE.Group[] = []
	/** The slice layer's cut faces (mesher CAP_TOP or CAP_BOTTOM), rebuilt when the slice changes. */
	private readonly caps = new THREE.Group()
	/** The stored chunks' keys in the order they are built: the ground first, then outwards by layer, a batch's chunks together. */
	private queue: number[]
	private next = 0
	private shownMode: CubeSlice['mode'] | '' = ''
	private shownLayer = -1
	/** The world's meshes, batched (#67), so an edit can replace a chunk's (#31). */
	private readonly built: Batches
	/** The slice layer's caps, batched. */
	private readonly capsBuilt: Batches
	/** Counts the rebuilds after edits, so what is drawn from the cubes elsewhere (the minimap, #62) knows to redraw. */
	version = 0
	/** The box of cubes the Select tool selected in this world (#70), null for none; each world tab keeps its own. */
	selection: CubeBox | null = null
	/** The object the Cubes tool's Link mode selected (#32), whose links are drawn; null for none. */
	selectedObject: number | null = null
	/** The NPC the Cubes tool's NPC mode selected (#99; its index in CubeWorld.npcs), whose route is drawn yellow; null for none. */
	selectedNpc: number | null = null
	/** The world's attached objects, their links and the joined groups in the selection (#32). */
	readonly marks = new ObjectMarks()
	/** Whether the marks need drawing again: the objects or the cubes changed. */
	private marksStale = true
	private marksSelection: CubeBox | null = null
	private marksSelected: number | null = null
	private marksSelectedNpc: number | null = null
	/** The prop the Cubes tool's Prop mode selected (#133; its index in CubeWorld.props), outlined; null for none. */
	selectedProp: number | null = null
	/** The world's props, drawn with their models (#133). */
	readonly props = new PropLayer()
	/** Whether the props need drawing again: they, the slice or the selected one changed. */
	private propsStale = true
	private propsSelected: number | null = null
	/** The mood region the Cubes tool's Mood mode selected (3dgame #143; its index in CubeWorld.moods), outlined yellow; null for none. */
	selectedMood: number | null = null
	/** The world's mood regions, drawn while the Cubes tool's Mood mode is on (`moodsShown`). */
	readonly moodMarks = new MoodMarks()
	/** Whether the mood regions are drawn: the Cubes tool sets it each frame, on in Mood mode. */
	moodsShown = false
	private moodsStale = true
	private moodsSelected: number | null = null
	/** Where each chunk with lava hangs its light, by chunk key, in world metres (scene.rs: GLOW_HEIGHT over the middle of its lava's top faces). */
	private readonly glows = new Map<number, THREE.Vector3>()
	/** Counts the changes to the lava's lights and the lamps (`lights`). */
	private glowsVersion = 0
	/** The world's sprite sheet and the material of its pictured faces (PART_SPRITE, 3dgame #224), made when first drawn. */
	private sprites: { sheet: THREE.Texture | null; material: THREE.Material; overlay: THREE.Material } | null = null

	constructor(readonly world: CubeWorld) {
		this.group.name = 'cubes'
		for (let l = 0; l < LAYER_COUNT; l++) {
			const g = new THREE.Group()
			g.name = `layer ${l}`
			this.layers.push(g)
			this.group.add(g)
		}
		this.caps.name = 'slice caps'
		this.group.add(this.caps)
		this.group.add(this.marks.group)
		this.group.add(this.props.group)
		this.group.add(this.moodMarks.group)
		const material = (p: number) => (p === PART_SPRITE ? this.spriteMaterial() : p === PART_OVERLAY ? this.overlayMaterial() : partMaterials()[p])
		this.built = new Batches(world, (l) => this.layers[l], material)
		this.capsBuilt = new Batches(world, () => this.caps, material)
		this.queue = this.buildOrder()
	}

	/** The stored chunks' keys in the order they are built: the ground first, then outwards by layer, a batch's chunks together. */
	private buildOrder(): number[] {
		const perLayer = this.world.chunksX * this.world.chunksZ
		return [...this.world.chunks.keys()].sort((a, b) => Math.abs(Math.floor(a / perLayer) - GROUND_LAYER) - Math.abs(Math.floor(b / perLayer) - GROUND_LAYER) || this.batchOfKey(a) - this.batchOfKey(b) || a - b)
	}

	/** Chunks still to be built. */
	get pending() {
		return this.queue.length - this.next
	}

	/** The chunk (cx, cz, layer) of a key (CubeWorld.chunkKey). */
	private unkey(key: number): [number, number, number] {
		const w = this.world
		return [key % w.chunksX, Math.floor(key / w.chunksX) % w.chunksZ, Math.floor(key / (w.chunksX * w.chunksZ))]
	}

	/** The batch key of a chunk key. */
	private batchOfKey(key: number) {
		const [cx, cz, layer] = this.unkey(key)
		return batchKey(this.world, Math.floor(cx / BATCH), Math.floor(cz / BATCH), layer)
	}

	/** The cap the slice gives a layer now (mesher CAP_*), CAP_NONE where it caps nothing. */
	private capOf(layer: number) {
		if (this.shownMode === '' || this.shownMode === 'off' || layer !== this.shownLayer) return CAP_NONE
		if (this.shownMode === 'below') return layer === 0 ? CAP_NONE : CAP_TOP
		return layer === LAYER_COUNT - 1 ? CAP_NONE : CAP_BOTTOM
	}

	/**
	 * Rebuilds chunks now, after their cubes changed (#31): their meshes, and their caps where they are
	 * in the slice layer. `keys` are CubeWorld.chunkKey values (CubeChanges gives them).
	 */
	rebuild(keys: Iterable<number>) {
		this.version++
		// A door's place follows its opening's shape.
		this.marksStale = true
		// The batches to merge again, and the chunk in each that names it.
		const batches = new Map<number, number>()
		for (const key of keys) {
			const [cx, cz, layer] = this.unkey(key)
			this.noteGlow(key, cx, cz, layer, this.built.mesh(cx, cz, layer, CAP_NONE))
			const cap = this.capOf(layer)
			if (cap !== CAP_NONE) this.capsBuilt.mesh(cx, cz, layer, cap)
			batches.set(this.batchOfKey(key), key)
		}
		for (const key of batches.values()) {
			const [cx, cz, layer] = this.unkey(key)
			this.built.merge(cx, cz, layer)
			if (this.capOf(layer) !== CAP_NONE) this.capsBuilt.merge(cx, cz, layer)
		}
	}

	/**
	 * Called every frame: builds chunks for up to `budgetMs` while some are pending, shows the layers
	 * `slice` leaves (with its caps) when it changed, and steps the liquids' textures (#108). Allocates
	 * nothing once built and unchanged.
	 */
	update(slice: CubeSlice, budgetMs: number) {
		animateCubeAtlas(performance.now() / 1000)
		if (this.next < this.queue.length) {
			const until = performance.now() + budgetMs
			do {
				// Mesh the chunk, and merge its batch once the last of its chunks in the queue is meshed.
				const key = this.queue[this.next++]
				const [cx, cz, layer] = this.unkey(key)
				this.noteGlow(key, cx, cz, layer, this.built.mesh(cx, cz, layer, CAP_NONE))
				if (this.next === this.queue.length || this.batchOfKey(this.queue[this.next]) !== this.batchOfKey(key)) this.built.merge(cx, cz, layer)
			} while (this.next < this.queue.length && performance.now() < until)
		}
		if (slice.mode !== this.shownMode || (slice.mode !== 'off' && slice.layer !== this.shownLayer)) this.showSlice(slice)
		if (this.propsStale || this.props.stale || this.propsSelected !== this.selectedProp) this.drawProps()
		if (this.marksStale || this.marksSelection !== this.selection || this.marksSelected !== this.selectedObject || this.marksSelectedNpc !== this.selectedNpc) this.drawMarks()
		this.moodMarks.group.visible = this.moodsShown
		if (this.moodsShown && (this.moodsStale || this.moodsSelected !== this.selectedMood)) {
			this.moodsStale = false
			this.moodsSelected = this.selectedMood
			this.moodMarks.draw(this.world, this.shownLayers(), this.selectedMood)
		}
	}

	/** Keeps where chunk `key`'s lava hangs its light, from its meshed `parts`: the middle of the lava's faces that look up, GLOW_HEIGHT over it; none without. */
	private noteGlow(key: number, cx: number, cz: number, layer: number, parts: (MeshPart | null)[]) {
		const part = parts[PART_GLOW]
		let x = 0
		let y = 0
		let z = 0
		let n = 0
		if (part) {
			const p = part.positions
			const nor = part.normals
			for (let k = 0; k < p.length; k += 3) {
				if (nor[k + 1] <= 0.5) continue
				x += p[k]
				y += p[k + 1]
				z += p[k + 2]
				n++
			}
		}
		if (n === 0) {
			if (this.glows.delete(key)) this.glowsVersion++
			return
		}
		const side = CHUNK_SIZE * CUBE_SIZE
		this.glows.set(key, new THREE.Vector3(cx * side + x / n, layerBottom(layer) + y / n + GLOW_HEIGHT, cz * side + z / n))
		this.glowsVersion++
	}

	/**
	 * The lights the mood shows on the layers the slice leaves (3dgame #178): calls `each` with each
	 * lava light's place (`lava` true) and each shown lamp's (false). `version` changes when they may have.
	 */
	lights(each: (at: THREE.Vector3, lava: boolean) => void) {
		for (const [key, at] of this.glows) if (this.layers[Math.floor(key / (this.world.chunksX * this.world.chunksZ))].visible) each(at, true)
		for (const at of this.props.lamps) each(at, false)
	}

	/** Changes whenever `lights` may give other lights: a chunk's lava, the lamps or the layers shown. */
	get lightsVersion(): number {
		// Both only grow, so their sum changes whenever either does.
		return this.glowsVersion + this.props.lampsVersion
	}

	/** Says the world's objects or groups changed (#32), so they are drawn again. */
	objectsChanged() {
		this.marksStale = true
		this.version++
	}

	/** Says the world's props changed (#133), so they are drawn again. */
	propsChanged() {
		this.propsStale = true
		this.version++
	}

	/** Says the world's mood regions changed (3dgame #143), so they are drawn again. */
	moodsChanged() {
		this.moodsStale = true
		this.version++
	}

	/** Whether the props changed since they were last drawn, so the drawn meshes may not match CubeWorld.props. */
	get propsPending(): boolean {
		return this.propsStale
	}

	/** Draws the props again, now, on the layers the slice shows. */
	drawProps() {
		this.propsStale = false
		this.propsSelected = this.selectedProp
		this.props.draw(this.world, this.shownLayers(), this.selectedProp)
	}

	/** Whether the slice shows a layer now. */
	private shownLayers(): (layer: number) => boolean {
		const mode = this.shownMode
		const n = this.shownLayer
		return mode === '' || mode === 'off' ? () => true : mode === 'below' ? (l: number) => l >= n : (l: number) => l <= n
	}

	/** Draws the objects, the selected one's links and the selection's groups again, now. */
	drawMarks() {
		this.marksStale = false
		this.marksSelection = this.selection
		this.marksSelected = this.selectedObject
		this.marksSelectedNpc = this.selectedNpc
		const mode = this.shownMode
		const n = this.shownLayer
		const shown = mode === '' || mode === 'off' ? () => true : mode === 'below' ? (l: number) => l >= n : (l: number) => l <= n
		this.marks.draw(this.world, shown, this.selectedObject, this.selection, this.selectedNpc)
	}

	/** Builds every pending chunk now (the probes and tests). */
	buildAll() {
		this.update({ mode: (this.shownMode || 'off') as CubeSlice['mode'], layer: this.shownLayer }, Infinity)
	}

	private showSlice(slice: CubeSlice) {
		const n = Math.max(0, Math.min(LAYER_COUNT - 1, Math.round(slice.layer)))
		this.shownMode = slice.mode
		this.shownLayer = n
		this.glowsVersion++
		this.marksStale = true
		this.propsStale = true
		this.moodsStale = true
		for (let l = 0; l < LAYER_COUNT; l++) this.layers[l].visible = slice.mode === 'off' || (slice.mode === 'below' ? l >= n : l <= n)
		this.clearCaps()
		const cap = this.capOf(n)
		if (cap === CAP_NONE) return
		// Layer n's faces against the hidden side were left out, covered by the cubes there: draw them.
		for (let cz = 0; cz < this.world.chunksZ; cz++) {
			for (let cx = 0; cx < this.world.chunksX; cx++) this.capsBuilt.mesh(cx, cz, n, cap)
		}
		for (let cz = 0; cz < this.world.chunksZ; cz += BATCH) {
			for (let cx = 0; cx < this.world.chunksX; cx += BATCH) this.capsBuilt.merge(cx, cz, n)
		}
	}

	private clearCaps() {
		this.capsBuilt.clear()
	}

	/** The meshes drawn now and their triangles (the probes). */
	drawn(): { meshes: number; triangles: number; caps: number } {
		let meshes = 0
		let triangles = 0
		const count = (g: THREE.Group) => {
			for (const m of g.children) {
				meshes++
				triangles += ((m as THREE.Mesh).geometry.index?.count ?? 0) / 3
			}
		}
		for (const g of this.layers) if (g.visible) count(g)
		const before = triangles
		count(this.caps)
		return { meshes, triangles, caps: triangles - before }
	}

	/** The world's size in metres along x and z. */
	get extent() {
		return Math.max(this.world.sizeX, this.world.sizeZ) * CUBE_SIZE
	}

	/** The material of the faces showing the world's pictures: lit as the cubes, from its sprite sheet. */
	private spriteMaterial(): THREE.Material {
		if (!this.sprites) {
			const sheet = spriteSheet(this.world)
			const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: sheet })
			patchCascadeShadows(material)
			material.shadowSide = THREE.DoubleSide
			// The overlays (#226): the same sheet, cut out where a border's picture is clear, drawn over the
			// face below it without fighting it, as the blended edges' overlays are.
			const overlay = new THREE.MeshLambertMaterial({ vertexColors: true, map: sheet, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
			patchCascadeShadows(overlay)
			this.sprites = { sheet, material, overlay }
		}
		return this.sprites.material
	}

	/** The material of the overlays over the cubes' tops: the world's sprite sheet, cut out by its alpha. */
	private overlayMaterial(): THREE.Material {
		this.spriteMaterial()
		return this.sprites!.overlay
	}

	/**
	 * The world's pictures changed (CubeWorld.setImages, 3dgame #224): a new sprite sheet, and every chunk
	 * meshed again a few a frame, as on opening (a big world would stall if done at once), since a face may
	 * now show a picture or no longer; the slice's caps are made again too.
	 */
	spritesChanged() {
		this.dropSprites()
		this.queue = this.buildOrder()
		this.next = 0
		this.shownMode = ''
		this.version++
	}

	private dropSprites() {
		if (!this.sprites) return
		this.sprites.sheet?.dispose()
		this.sprites.material.dispose()
		this.sprites.overlay.dispose()
		this.sprites = null
	}

	dispose() {
		this.dropSprites()
		this.marks.dispose()
		this.props.dispose()
		this.moodMarks.dispose()
		this.built.clear()
		this.clearCaps()
		this.group.removeFromParent()
	}
}
