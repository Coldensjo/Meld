import * as THREE from 'three'
import { LIQUID_CELLS, LIQUID_RECORD_BYTES, LIQUID_VERTS } from '../wow/format'

// Liquids as noggit3 edits them (liquid_chunk / liquid_layer), on the editor's grid. A map's cells
// are the client's: an 8x8-cell chunk is an MCNK, and each chunk holds liquid layers, at most one of
// each liquid type. A layer has the surface height and the depth (opacity) at the chunk's 9x9
// vertices, and says which of its 8x8 cells it covers. The 1.12 writer (internal/adt/water.go)
// stores each layer as an MCLQ entry.

/** Cells and vertices a side of a liquid chunk (an MCNK). */
export { LIQUID_CELLS, LIQUID_VERTS }
const NV = LIQUID_VERTS * LIQUID_VERTS
/** Cells in a liquid chunk. */
const NC = LIQUID_CELLS * LIQUID_CELLS

/** How a liquid draws and how deep it reads: noggit's liquid "type" column of LiquidType.dbc. */
export type LiquidClass = 'river' | 'ocean' | 'magma' | 'slime'

export interface LiquidType {
	/** The client's LiquidType.dbc ID. */
	id: number
	name: string
	kind: LiquidClass
	/** The animation's frames in the client, '%d' counting from 1. */
	texture: string
	frames: number
}

/** The animation each kind of liquid is drawn with, from the client's XTextures. */
const KIND_TEXTURES: Record<LiquidClass, { texture: string; frames: number }> = {
	river: { texture: 'XTextures\\river\\lake_a.%d.blp', frames: 30 },
	ocean: { texture: 'XTextures\\ocean\\ocean_h.%d.blp', frames: 30 },
	magma: { texture: 'XTextures\\lava\\lava.%d.blp', frames: 30 },
	slime: { texture: 'XTextures\\slime\\slime.%d.blp', frames: 30 },
}

/**
 * The client's liquids: LiquidType.dbc's rows. These four are the 1.12 client's base rows, which a
 * tile can hold (its chunks store the kind, not the ID); `setLiquidTypes` replaces the list with the
 * client's own table once it is read, which adds the rows only a building uses, such as Naxxramas's
 * slime. Painted with one of those, a chunk is written as its kind.
 */
export const LIQUID_TYPES: LiquidType[] = [
	{ id: 1, name: 'Water', kind: 'river', ...KIND_TEXTURES.river },
	{ id: 2, name: 'Ocean', kind: 'ocean', ...KIND_TEXTURES.ocean },
	{ id: 3, name: 'Magma', kind: 'magma', ...KIND_TEXTURES.magma },
	{ id: 4, name: 'Slime', kind: 'slime', ...KIND_TEXTURES.slime },
]

export const LIQUID_WATER = 1
export const LIQUID_OCEAN = 2
export const LIQUID_MAGMA = 3
export const LIQUID_SLIME = 4
/** The highest liquid ID the map file can hold (a byte a layer). */
const MAX_LIQUID_ID = 255

/** The kind a LiquidType.dbc row's type column names: 0 magma, 2 slime, 3 water; the ocean is water row 2. */
export function kindOfDbcType(id: number, type: number): LiquidClass {
	if (id === LIQUID_OCEAN) return 'ocean'
	switch (type) {
		case 0:
			return 'magma'
		case 2:
			return 'slime'
		default:
			return 'river'
	}
}

/**
 * Replaces the liquid list with the client's rows (kept in ID order, the base four first). A row past
 * ID 255 is left out: the map file keeps a layer's ID in one byte.
 */
export function setLiquidTypes(rows: ReadonlyArray<{ id: number; name: string; kind: number }>) {
	const list: LiquidType[] = rows
		.filter((r) => r.id > 0 && r.id <= MAX_LIQUID_ID && r.name)
		.map((r) => {
			const kind = kindOfDbcType(r.id, r.kind)
			return { id: r.id, name: r.name, kind, ...KIND_TEXTURES[kind] }
		})
		.sort((a, b) => a.id - b.id)
	if (list.length === 0) return
	LIQUID_TYPES.length = 0
	LIQUID_TYPES.push(...list)
}

/**
 * The kinds of the liquid IDs the client's table doesn't hold (yet), as the map files opened keep
 * them (the header's `liquidKinds`, #540): a layer of a building's row, opened before the table is
 * read or against a client without that row, still draws and exports as its kind, not as water.
 */
const fileKinds = new Map<number, LiquidType>()

function isLiquidClass(v: unknown): v is LiquidClass {
	return v === 'river' || v === 'ocean' || v === 'magma' || v === 'slime'
}

/** A map file's `liquidKinds` as far as it reads right: IDs past the base four, up to 255, with a known kind. */
export function readLiquidKinds(raw: unknown): Record<number, LiquidClass> {
	const out: Record<number, LiquidClass> = {}
	if (!raw || typeof raw !== 'object') return out
	for (const [k, v] of Object.entries(raw)) {
		const id = Number(k)
		if (Number.isInteger(id) && id > LIQUID_SLIME && id <= MAX_LIQUID_ID && isLiquidClass(v)) out[id] = v
	}
	return out
}

/** Remembers the kinds a map file gives its liquid IDs, for the IDs the client's table lacks. */
export function rememberLiquidKinds(kinds: Readonly<Record<number, LiquidClass>> | undefined) {
	for (const [k, kind] of Object.entries(kinds ?? {})) {
		const id = Number(k)
		fileKinds.set(id, { id, name: `Liquid ${id}`, kind, ...KIND_TEXTURES[kind] })
	}
}

/** The liquid with this ID: the client's row, else the kind a map file gave it, else water. */
export function liquidType(id: number): LiquidType {
	return LIQUID_TYPES.find((t) => t.id === id) ?? fileKinds.get(id) ?? LIQUID_TYPES[0]
}

/**
 * The kinds of the liquid IDs past the base four that a map's layers use, for its file's
 * `liquidKinds`; an ID whose kind isn't known is left out rather than saved as water. Undefined when
 * there are none.
 */
export function liquidKindsOf(map: LiquidMap): Record<number, LiquidClass> | undefined {
	let out: Record<number, LiquidClass> | undefined
	for (const [, layers] of map.entries()) {
		for (const l of layers) {
			if (l.id <= LIQUID_SLIME || out?.[l.id]) continue
			const t = LIQUID_TYPES.find((x) => x.id === l.id) ?? fileKinds.get(l.id)
			if (t) (out ??= {})[l.id] = t.kind
		}
	}
	return out
}

/** The base row (1 to 4) a tile stores for a liquid: its kind's, since a chunk keeps the kind, not the ID. */
export function tileLiquidType(id: number): number {
	switch (liquidType(id).kind) {
		case 'ocean':
			return LIQUID_OCEAN
		case 'magma':
			return LIQUID_MAGMA
		case 'slime':
			return LIQUID_SLIME
		default:
			return LIQUID_WATER
	}
}

/** noggit's depth factors: a vertex's depth is (surface - ground + 1) times one, clamped to 0..1. */
export const RIVER_OPACITY = 0.0337
export const OCEAN_OPACITY = 0.007

/** The factor noggit's Auto opacity picks for a liquid: the ocean's for oceans, else the river's. */
export function autoOpacity(id: number): number {
	return liquidType(id).kind === 'ocean' ? OCEAN_OPACITY : RIVER_OPACITY
}

export interface LiquidLayer {
	/** LiquidType.dbc ID. */
	id: number
	/** Surface height at each of the chunk's 9x9 vertices, row-major. */
	heights: Float32Array
	/** Depth (0 at the shore to 1 deep) at each vertex: what the colour and opacity follow. */
	depth: Float32Array
	/** 1 where the layer covers the cell, 8x8 row-major. */
	cells: Uint8Array
}

export function newLayer(id: number, height: number): LiquidLayer {
	return { id, heights: new Float32Array(NV).fill(height), depth: new Float32Array(NV).fill(1), cells: new Uint8Array(NC) }
}

export function cloneLayer(l: LiquidLayer): LiquidLayer {
	return { id: l.id, heights: l.heights.slice(), depth: l.depth.slice(), cells: l.cells.slice() }
}

function layerEmpty(l: LiquidLayer): boolean {
	for (let i = 0; i < NC; i++) if (l.cells[i]) return false
	return true
}

/** The ground liquids lie over. Its vertices line up with the liquid chunks' (see Terrain). */
export interface LiquidGround {
	readonly size: number
	readonly verts: number
	readonly cellSize: number
	readonly heights: Float32Array
}

const NONE: readonly LiquidLayer[] = []

/**
 * A map's liquids: the layers of each chunk, chunks in rows of `side`. Edits replace a chunk's
 * layers through `set` (or change them and call `touch`), which marks the chunk for the renderer.
 */
export class LiquidMap {
	readonly side: number
	private chunks: Array<LiquidLayer[] | undefined>
	/** Lowest and highest surface of each chunk, for picking. */
	private bounds: Float32Array
	/** Chunks changed since the renderer last looked. */
	readonly dirty = new Set<number>()
	/** Counts changes, for readers that rebuild on any (the walkable-ground view). */
	version = 0

	constructor(cells: number) {
		this.side = cells / LIQUID_CELLS
		this.chunks = new Array(this.side * this.side)
		this.bounds = new Float32Array(this.side * this.side * 2)
	}

	layers(c: number): readonly LiquidLayer[] {
		return this.chunks[c] ?? NONE
	}

	/** Replaces chunk c's layers (dropping empty ones). */
	set(c: number, layers: readonly LiquidLayer[]) {
		const kept = layers.filter((l) => !layerEmpty(l))
		this.chunks[c] = kept.length ? kept : undefined
		this.touch(c)
	}

	/** Marks chunk c changed. */
	touch(c: number) {
		this.dirty.add(c)
		this.version++
		let lo = Infinity
		let hi = -Infinity
		for (const l of this.layers(c)) {
			for (let i = 0; i < NV; i++) {
				lo = Math.min(lo, l.heights[i])
				hi = Math.max(hi, l.heights[i])
			}
		}
		this.bounds[c * 2] = lo
		this.bounds[c * 2 + 1] = hi
	}

	/** Every chunk that has a layer, with its layers. */
	*entries(): Generator<[number, readonly LiquidLayer[]]> {
		for (let c = 0; c < this.chunks.length; c++) {
			const l = this.chunks[c]
			if (l) yield [c, l]
		}
	}

	get empty(): boolean {
		for (const _ of this.entries()) return false
		return true
	}

	/** The chunks a circle at (x, z) reaches, as noggit's for_all_chunks_in_range. */
	chunksInRange(x: number, z: number, radius: number, cellSize: number, out: number[] = []): number[] {
		const span = LIQUID_CELLS * cellSize
		out.length = 0
		const c0 = Math.max(0, Math.floor((x - radius) / span))
		const c1 = Math.min(this.side - 1, Math.floor((x + radius) / span))
		const r0 = Math.max(0, Math.floor((z - radius) / span))
		const r1 = Math.min(this.side - 1, Math.floor((z + radius) / span))
		for (let r = r0; r <= r1; r++) {
			for (let c = c0; c <= c1; c++) {
				if (shortestDist(x, z, c * span, r * span, span) <= radius) out.push(r * this.side + c)
			}
		}
		return out
	}

	/**
	 * Whether a layer covers the cell at world (x, z) with its surface above `ground` there (a layer
	 * painted under the ground shows nothing). The surface is the cell's highest corner.
	 */
	covers(x: number, z: number, cellSize: number, ground: number): boolean {
		const gx = Math.floor(x / cellSize)
		const gz = Math.floor(z / cellSize)
		const n = this.side * LIQUID_CELLS
		if (gx < 0 || gz < 0 || gx >= n || gz >= n) return false
		const c = Math.floor(gz / LIQUID_CELLS) * this.side + Math.floor(gx / LIQUID_CELLS)
		const lx = gx % LIQUID_CELLS
		const lz = gz % LIQUID_CELLS
		const row = LIQUID_CELLS + 1
		for (const l of this.layers(c)) {
			if (!l.cells[lz * LIQUID_CELLS + lx]) continue
			const v = lz * row + lx
			const top = Math.max(l.heights[v], l.heights[v + 1], l.heights[v + row], l.heights[v + row + 1])
			if (top > ground) return true
		}
		return false
	}

	/** Lowest and highest surface of chunk c (Infinity, -Infinity when it has none). */
	heightRange(c: number): [number, number] {
		return [this.bounds[c * 2], this.bounds[c * 2 + 1]]
	}
}

/** The distance from (x, z) to the square at (sx, sz) of side `size`; 0 inside it. */
function shortestDist(x: number, z: number, sx: number, sz: number, size: number): number {
	const px = x >= sx && x < sx + size ? x : sx < x ? sx + size : sx
	const pz = z >= sz && z < sz + size ? z : sz < z ? sz + size : sz
	return Math.hypot(x - px, z - pz)
}

/** A water brush dab: noggit's Water tool settings at the cursor. */
export interface LiquidBrush {
	/** The cursor. */
	x: number
	y: number
	z: number
	radius: number
	/** The liquid to paint (LiquidType.dbc ID). */
	id: number
	/** Add liquid, or remove it. */
	add: boolean
	/** Angled mode: the surface rises at `angle` radians toward `orientation` radians (0 is +x, π/2 is +z). */
	angle: number
	orientation: number
	/** Lock: heights come from `origin` rather than the cursor. */
	lock: boolean
	origin: { x: number; y: number; z: number }
	/** Override height: cells already covered take the brush's height too. */
	overrideHeight: boolean
	/** Override liquid ID: painting replaces other liquids under the brush; off, it adds to whichever is there. */
	overrideId: boolean
	/** The depth factor (see RIVER_OPACITY). */
	opacity: number
}

/** A remove-everything brush at the origin, for a tool to keep and fill in each tick (paintLiquid's argument, #452). */
export function newLiquidBrush(): LiquidBrush {
	return { x: 0, y: 0, z: 0, radius: 1, id: 1, add: false, angle: 0, orientation: 0, lock: false, origin: { x: 0, y: 0, z: 0 }, overrideHeight: false, overrideId: false, opacity: RIVER_OPACITY }
}

/** The height the surface takes at (x, z): the reference's, tilted by the angle (noggit's angledHeight). */
function angledHeight(ref: { x: number; y: number; z: number }, x: number, z: number, angle: number, orientation: number) {
	return ref.y + ((x - ref.x) * Math.cos(orientation) + (z - ref.z) * Math.sin(orientation)) * Math.tan(angle)
}

/** Chunk c's corner in world units, and the index of its first vertex in the ground's heights. */
function chunkOrigin(map: LiquidMap, ground: LiquidGround, c: number) {
	const cx = c % map.side
	const cz = Math.floor(c / map.side)
	return { x: cx * LIQUID_CELLS * ground.cellSize, z: cz * LIQUID_CELLS * ground.cellSize, v: cz * LIQUID_CELLS * ground.verts + cx * LIQUID_CELLS }
}

/** The ground under liquid vertex (vx, vz) of the chunk whose first ground vertex is `base`. */
function groundAt(ground: LiquidGround, base: number, vx: number, vz: number) {
	return ground.heights[base + vz * ground.verts + vx]
}

/** Sets vertex i's depth from the ground under it (noggit's update_vertex_opacity). */
function updateVertexOpacity(l: LiquidLayer, i: number, ground: LiquidGround, base: number, factor: number) {
	const diff = l.heights[i] - groundAt(ground, base, i % LIQUID_VERTS, Math.floor(i / LIQUID_VERTS))
	l.depth[i] = Math.min(1, Math.max(0, (diff + 1) * factor))
}

/** The four vertices of the cell whose first vertex is `id`, filled by fillCorners (a scratch: use it before the next call). */
const corners = new Int32Array(4)

function fillCorners(id: number): Int32Array {
	corners[0] = id
	corners[1] = id + 1
	corners[2] = id + LIQUID_VERTS
	corners[3] = id + LIQUID_VERTS + 1
	return corners
}

/** noggit's liquid_layer::paintLiquid: one layer under a dab. */
function paintLayer(l: LiquidLayer, b: LiquidBrush, add: boolean, ground: LiquidGround, base: number, ox: number, oz: number) {
	const cs = ground.cellSize
	const ref = b.lock ? b.origin : b
	for (let z = 0; z < LIQUID_CELLS; z++) {
		for (let x = 0; x < LIQUID_CELLS; x++) {
			if (shortestDist(b.x, b.z, ox + x * cs, oz + z * cs, cs) > b.radius) continue
			if (add) {
				const id = z * LIQUID_VERTS + x
				const empty = !l.cells[z * LIQUID_CELLS + x]
				const cs4 = fillCorners(id)
				for (let k = 0; k < 4; k++) {
					const i = cs4[k]
					const vx = ox + (i % LIQUID_VERTS) * cs
					const vz = oz + Math.floor(i / LIQUID_VERTS) * cs
					const inRange = Math.hypot(b.x - vx, b.z - vz) <= b.radius
					if (empty || (inRange && b.overrideHeight)) l.heights[i] = angledHeight(ref, vx, vz, b.angle, b.orientation)
					if (empty || inRange) updateVertexOpacity(l, i, ground, base, b.opacity)
				}
			}
			l.cells[z * LIQUID_CELLS + x] = add ? 1 : 0
		}
	}
}

/**
 * Copies onto `target` the heights of the cells under the dab that other layers cover, and covers
 * them (noggit's copy_height_to_layer): changing a liquid's type keeps its surface.
 */
function copyHeightToLayer(layers: readonly LiquidLayer[], target: LiquidLayer, b: LiquidBrush, cs: number, ox: number, oz: number) {
	for (const l of layers) {
		if (l.id === target.id) continue
		for (let z = 0; z < LIQUID_CELLS; z++) {
			for (let x = 0; x < LIQUID_CELLS; x++) {
				if (!l.cells[z * LIQUID_CELLS + x] || shortestDist(b.x, b.z, ox + x * cs, oz + z * cs, cs) > b.radius) continue
				const id = z * LIQUID_VERTS + x
				const cs4 = fillCorners(id)
				for (let k = 0; k < 4; k++) target.heights[cs4[k]] = l.heights[cs4[k]]
				target.cells[z * LIQUID_CELLS + x] = 1
			}
		}
	}
}

/** noggit's liquid_chunk::paintLiquid: a dab on chunk c. */
function paintChunk(map: LiquidMap, ground: LiquidGround, c: number, b: LiquidBrush) {
	const o = chunkOrigin(map, ground, c)
	const layers = map.layers(c).map(cloneLayer)
	if (b.overrideId && !b.overrideHeight) {
		let target = layers.find((l) => l.id === b.id)
		if (!target) {
			target = newLayer(b.id, b.y)
			layers.push(target)
		}
		copyHeightToLayer(layers, target, b, ground.cellSize, o.x, o.z)
	}
	let painted = false
	for (const l of layers) {
		// Removing clears every layer; adding paints the brush's liquid and clears the others.
		if (!b.add || l.id === b.id || !b.overrideId) {
			paintLayer(l, b, b.add, ground, o.v, o.x, o.z)
			painted = true
		} else {
			paintLayer(l, b, false, ground, o.v, o.x, o.z)
		}
	}
	if (b.add && !painted) {
		// A new layer of this liquid: at the first layer's surface where there is one, else at the brush.
		const first = layers.find((l) => !layerEmpty(l))
		const l = first ? { ...cloneLayer(first), id: b.id, cells: new Uint8Array(NC) } : newLayer(b.id, b.y)
		paintLayer(l, b, true, ground, o.v, o.x, o.z)
		layers.push(l)
	}
	map.set(c, layers)
}

/** Paints (or removes) liquid under a dab. `reserve` is told each chunk before it changes. */
export function paintLiquid(map: LiquidMap, ground: LiquidGround, b: LiquidBrush, reserve?: (c: number) => void) {
	for (const c of map.chunksInRange(b.x, b.z, b.radius, ground.cellSize, chunkScratch)) {
		reserve?.(c)
		paintChunk(map, ground, c, b)
	}
}

/** The chunks of a cell rect (inclusive), or every chunk. */
function chunksOf(map: LiquidMap, rect?: { x0: number; z0: number; x1: number; z1: number }, keep?: (c: number) => boolean): number[] {
	const out: number[] = []
	const lo = (v: number) => Math.max(0, Math.floor(v / LIQUID_CELLS))
	const hi = (v: number) => Math.min(map.side - 1, Math.floor(v / LIQUID_CELLS))
	const [c0, r0, c1, r1] = rect ? [lo(rect.x0), lo(rect.z0), hi(rect.x1), hi(rect.z1)] : [0, 0, map.side - 1, map.side - 1]
	for (let r = r0; r <= r1; r++) {
		for (let c = c0; c <= c1; c++) if (map.layers(r * map.side + c).length && (!keep || keep(r * map.side + c))) out.push(r * map.side + c)
	}
	return out
}

/**
 * noggit's Crop water: drops each cell whose four surface corners all lie below the ground, and a
 * layer whose top lies below the chunk's lowest ground. Works on the chunks a cell rect touches (those
 * of them `keep` takes, for a free-form area), or the whole map. Returns the chunks it changed, after
 * telling `reserve` each one first.
 */
export function cropLiquids(map: LiquidMap, ground: LiquidGround, rect?: { x0: number; z0: number; x1: number; z1: number }, reserve?: (c: number) => void, keep?: (c: number) => boolean): number[] {
	const changed: number[] = []
	for (const c of chunksOf(map, rect, keep)) {
		const o = chunkOrigin(map, ground, c)
		let minGround = Infinity
		for (let i = 0; i < NV; i++) minGround = Math.min(minGround, groundAt(ground, o.v, i % LIQUID_VERTS, Math.floor(i / LIQUID_VERTS)))
		let touched = false
		const layers = map.layers(c).map((src) => {
			const l = cloneLayer(src)
			const top = Math.max(...l.heights)
			for (let z = 0; z < LIQUID_CELLS; z++) {
				for (let x = 0; x < LIQUID_CELLS; x++) {
					const cell = z * LIQUID_CELLS + x
					if (!l.cells[cell]) continue
					const id = z * LIQUID_VERTS + x
					const cs4 = fillCorners(id)
					let under = true
					for (let k = 0; k < 4 && under; k++) {
						const i = cs4[k]
						under = l.heights[i] < groundAt(ground, o.v, i % LIQUID_VERTS, Math.floor(i / LIQUID_VERTS))
					}
					if (top < minGround || under) {
						l.cells[cell] = 0
						touched = true
					}
				}
			}
			return l
		})
		if (!touched) continue
		reserve?.(c)
		map.set(c, layers)
		changed.push(c)
	}
	return changed
}

/**
 * noggit's Regen ADT opacity: every vertex's depth again from the ground, at `factor`, or with Auto
 * (null), at each liquid's own factor. Works on a cell rect's chunks, or the whole map.
 */
export function regenOpacity(map: LiquidMap, ground: LiquidGround, factor: number | null, rect?: { x0: number; z0: number; x1: number; z1: number }, reserve?: (c: number) => void, keep?: (c: number) => boolean): number[] {
	const changed = chunksOf(map, rect, keep)
	for (const c of changed) {
		reserve?.(c)
		const o = chunkOrigin(map, ground, c)
		const layers = map.layers(c).map((src) => {
			const l = cloneLayer(src)
			for (let i = 0; i < NV; i++) updateVertexOpacity(l, i, ground, o.v, factor ?? autoOpacity(l.id))
			return l
		})
		map.set(c, layers)
	}
	return changed
}

const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const box = new THREE.Box3()
const hitScratch = new THREE.Vector3()
/** The two triangles of a cell as indices into `tri`. */
const CELL_TRIS = [0, 2, 1, 1, 2, 3]
const chunkScratch: number[] = []

/**
 * The nearest liquid surface along a ray, within maxDist, into `out` (noggit's liquid intersect, for
 * "Cursor intersects liquids"). Returns false when the ray meets none.
 */
export function raycastLiquids(map: LiquidMap, cellSize: number, ray: THREE.Ray, out: THREE.Vector3, maxDist = Infinity): boolean {
	let best = maxDist
	const span = LIQUID_CELLS * cellSize
	for (const [c, layers] of map.entries()) {
		const [lo, hi] = map.heightRange(c)
		const ox = (c % map.side) * span
		const oz = Math.floor(c / map.side) * span
		box.min.set(ox, lo - 0.01, oz)
		box.max.set(ox + span, hi + 0.01, oz + span)
		if (!ray.intersectBox(box, hitScratch) || hitScratch.distanceTo(ray.origin) >= best) continue
		for (const l of layers) {
			for (let z = 0; z < LIQUID_CELLS; z++) {
				for (let x = 0; x < LIQUID_CELLS; x++) {
					if (!l.cells[z * LIQUID_CELLS + x]) continue
					const id = z * LIQUID_VERTS + x
					const x0 = ox + x * cellSize
					const z0 = oz + z * cellSize
					tri[0].set(x0, l.heights[id], z0)
					tri[1].set(x0 + cellSize, l.heights[id + 1], z0)
					tri[2].set(x0, l.heights[id + LIQUID_VERTS], z0 + cellSize)
					tri[3].set(x0 + cellSize, l.heights[id + LIQUID_VERTS + 1], z0 + cellSize)
					for (let k = 0; k < 6; k += 3) {
						if (!ray.intersectTriangle(tri[CELL_TRIS[k]], tri[CELL_TRIS[k + 1]], tri[CELL_TRIS[k + 2]], false, hitScratch)) continue
						const t = hitScratch.distanceTo(ray.origin)
						if (t < best) {
							best = t
							out.copy(hitScratch)
						}
					}
				}
			}
		}
	}
	return best < maxDist
}

// --- the map file's liquids blob (internal/mapfile): a layer count, then each layer as chunk index
// (uint32), type (uint8), cell mask (uint64, bit z*8+x), 81 float32 heights and 81 depth bytes.

const RECORD = LIQUID_RECORD_BYTES

export function encodeLiquids(map: LiquidMap): Uint8Array {
	const all: Array<[number, LiquidLayer]> = []
	for (const [c, layers] of map.entries()) for (const l of layers) all.push([c, l])
	const out = new Uint8Array(4 + all.length * RECORD)
	const dv = new DataView(out.buffer)
	dv.setUint32(0, all.length, true)
	all.forEach(([c, l], k) => {
		const o = 4 + k * RECORD
		dv.setUint32(o, c, true)
		dv.setUint8(o + 4, l.id)
		for (let i = 0; i < NC; i++) if (l.cells[i]) out[o + 5 + (i >> 3)] |= 1 << (i & 7)
		for (let i = 0; i < NV; i++) dv.setFloat32(o + 13 + i * 4, l.heights[i], true)
		for (let i = 0; i < NV; i++) out[o + 13 + NV * 4 + i] = Math.round(l.depth[i] * 255)
	})
	return out
}

/** Fills `map` from a liquids blob. Layers in chunks off the map are skipped. */
export function decodeLiquids(map: LiquidMap, blob: Uint8Array) {
	if (blob.length < 4) return
	const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
	const n = dv.getUint32(0, true)
	const by = new Map<number, LiquidLayer[]>()
	for (let k = 0; k < n && 4 + (k + 1) * RECORD <= blob.length; k++) {
		const o = 4 + k * RECORD
		const c = dv.getUint32(o, true)
		if (c >= map.side * map.side) continue
		const l = newLayer(blob[o + 4], 0)
		for (let i = 0; i < NC; i++) l.cells[i] = (blob[o + 5 + (i >> 3)] >> (i & 7)) & 1
		for (let i = 0; i < NV; i++) l.heights[i] = dv.getFloat32(o + 13 + i * 4, true)
		for (let i = 0; i < NV; i++) l.depth[i] = blob[o + 13 + NV * 4 + i] / 255
		by.set(c, [...(by.get(c) ?? []), l])
	}
	for (const [c, layers] of by) map.set(c, layers)
}

/** A layer as the Go side's adt.Liquid has it: placed by its chunk in a grid, depth as bytes. */
export interface AdtLiquid {
	indexX: number
	indexY: number
	type: number
	heights: number[]
	depth: number[]
	cells: boolean[]
}

/** Fills `map` from the client's layers, placed in the map's chunk grid. */
export function liquidsFromAdt(map: LiquidMap, liquids: readonly AdtLiquid[]) {
	const by = new Map<number, LiquidLayer[]>()
	for (const a of liquids) {
		if (a.indexX >= map.side || a.indexY >= map.side) continue
		const c = a.indexY * map.side + a.indexX
		const l = newLayer(a.type, 0)
		l.heights.set(a.heights)
		for (let i = 0; i < NV; i++) l.depth[i] = (a.depth?.[i] ?? 255) / 255
		for (let i = 0; i < NC; i++) l.cells[i] = a.cells[i] ? 1 : 0
		by.set(c, [...(by.get(c) ?? []), l])
	}
	for (const [c, layers] of by) map.set(c, layers)
}

/**
 * The layers of the chunks in a block of `chunks` a side starting at chunk (cx0, cz0), placed in that
 * block, as the Go side takes them.
 */
export function liquidsToAdt(map: LiquidMap, cx0 = 0, cz0 = 0, chunks = map.side): AdtLiquid[] {
	const out: AdtLiquid[] = []
	for (let r = 0; r < chunks; r++) {
		for (let c = 0; c < chunks; c++) {
			for (const l of map.layers((cz0 + r) * map.side + cx0 + c)) {
				out.push({
					indexX: c,
					indexY: r,
					type: tileLiquidType(l.id),
					heights: Array.from(l.heights),
					depth: Array.from(l.depth, (d) => Math.round(d * 255)),
					cells: Array.from(l.cells, (v) => v === 1),
				})
			}
		}
	}
	return out
}

// ---- clipboard ------------------------------------------------------------------------------------

/** One liquid cell of a copied area: its place in the clip, its liquid and its four corners' surface and depth (x then x+1, then the next row). */
export interface LiquidClipCell {
	x: number
	z: number
	id: number
	heights: [number, number, number, number]
	depth: [number, number, number, number]
}

/** The painted liquid of a copied area, cell by cell, so a paste can land anywhere, not just on a chunk. */
export interface LiquidClip {
	w: number
	h: number
	cells: LiquidClipCell[]
}

/** The corner vertex indices of cell (lx, lz) in a chunk's 9x9 surface. */
function cornersOf(lx: number, lz: number): [number, number, number, number] {
	const i = lz * LIQUID_VERTS + lx
	return [i, i + 1, i + LIQUID_VERTS, i + LIQUID_VERTS + 1]
}

/** Copies the liquid cells of the cell rect (x0..x1, z0..z1 exclusive at the far side). */
export function copyLiquidCells(map: LiquidMap, r: { x0: number; z0: number; x1: number; z1: number }): LiquidClip {
	const cells: LiquidClipCell[] = []
	for (let z = r.z0; z < r.z1; z++) {
		for (let x = r.x0; x < r.x1; x++) {
			const c = Math.floor(z / LIQUID_CELLS) * map.side + Math.floor(x / LIQUID_CELLS)
			if (c < 0 || c >= map.side * map.side) continue
			const lx = x % LIQUID_CELLS
			const lz = z % LIQUID_CELLS
			for (const l of map.layers(c)) {
				if (!l.cells[lz * LIQUID_CELLS + lx]) continue
				const k = cornersOf(lx, lz)
				cells.push({ x: x - r.x0, z: z - r.z0, id: l.id, heights: [l.heights[k[0]], l.heights[k[1]], l.heights[k[2]], l.heights[k[3]]], depth: [l.depth[k[0]], l.depth[k[1]], l.depth[k[2]], l.depth[k[3]]] })
			}
		}
	}
	return { w: r.x1 - r.x0, h: r.z1 - r.z0, cells }
}

/**
 * Lays `cells` (map cell coordinates) into the map, each taking its cell from every other layer there:
 * the cells not listed keep their liquid. `reserve` is told each chunk before it changes (for undo).
 * Returns the chunks changed.
 */
export function layLiquidCells(map: LiquidMap, cells: readonly LiquidClipCell[], reserve?: (c: number) => void): number[] {
	const side = map.side
	const n = side * LIQUID_CELLS
	const work = new Map<number, LiquidLayer[]>()
	for (const cell of cells) {
		if (cell.x < 0 || cell.z < 0 || cell.x >= n || cell.z >= n) continue
		const c = Math.floor(cell.z / LIQUID_CELLS) * side + Math.floor(cell.x / LIQUID_CELLS)
		let layers = work.get(c)
		if (!layers) {
			reserve?.(c)
			layers = map.layers(c).map(cloneLayer)
			work.set(c, layers)
		}
		const lx = cell.x % LIQUID_CELLS
		const lz = cell.z % LIQUID_CELLS
		const i = lz * LIQUID_CELLS + lx
		for (const l of layers) l.cells[i] = 0
		let l = layers.find((t) => t.id === cell.id)
		if (!l) {
			l = newLayer(cell.id, cell.heights[0])
			layers.push(l)
		}
		l.cells[i] = 1
		const k = cornersOf(lx, lz)
		for (let j = 0; j < 4; j++) {
			l.heights[k[j]] = cell.heights[j]
			l.depth[k[j]] = cell.depth[j]
		}
	}
	for (const [c, layers] of work)
		map.set(
			c,
			layers.filter((l) => !layerEmpty(l)),
		)
	return [...work.keys()]
}

/**
 * Pastes a liquid clip with its corner at cell (px, pz): the cells of the pasted rect lose the liquid
 * they had, then the clip's cells are laid in, a layer per liquid ID in each chunk. `reserve` is
 * told each chunk before it changes (for undo). Returns the chunks changed.
 * With `inside` (clip.w by clip.h, 1 in), only the cells of that shape are laid or cleared.
 */
export function pasteLiquidCells(map: LiquidMap, clip: LiquidClip, px: number, pz: number, reserve?: (c: number) => void, inside?: Uint8Array): number[] {
	const side = map.side
	const n = side * LIQUID_CELLS
	// The chunks the pasted rect touches, with their cloned layers to work on.
	const work = new Map<number, LiquidLayer[]>()
	const chunkAt = (x: number, z: number): number | null => {
		if (x < 0 || z < 0 || x >= n || z >= n) return null
		const c = Math.floor(z / LIQUID_CELLS) * side + Math.floor(x / LIQUID_CELLS)
		if (!work.has(c)) {
			reserve?.(c)
			work.set(c, map.layers(c).map(cloneLayer))
		}
		return c
	}
	for (let z = 0; z < clip.h; z++) {
		for (let x = 0; x < clip.w; x++) {
			// A free-form clip (#183) leaves the cells outside its shape as they are.
			if (inside && !inside[z * clip.w + x]) continue
			const c = chunkAt(px + x, pz + z)
			if (c === null) continue
			const i = ((pz + z) % LIQUID_CELLS) * LIQUID_CELLS + ((px + x) % LIQUID_CELLS)
			for (const l of work.get(c)!) l.cells[i] = 0
		}
	}
	for (const cell of clip.cells) {
		const x = px + cell.x
		const z = pz + cell.z
		const c = chunkAt(x, z)
		if (c === null) continue
		const layers = work.get(c)!
		let l = layers.find((t) => t.id === cell.id)
		if (!l) {
			l = newLayer(cell.id, cell.heights[0])
			layers.push(l)
		}
		const lx = x % LIQUID_CELLS
		const lz = z % LIQUID_CELLS
		l.cells[lz * LIQUID_CELLS + lx] = 1
		const k = cornersOf(lx, lz)
		for (let j = 0; j < 4; j++) {
			l.heights[k[j]] = cell.heights[j]
			l.depth[k[j]] = cell.depth[j]
		}
	}
	const changed: number[] = []
	for (const [c, layers] of work) {
		map.set(
			c,
			layers.filter((l) => !layerEmpty(l)),
		)
		changed.push(c)
	}
	return changed
}

/** The clip mirrored, the way `mirrorClip` mirrors the area: across x, cell (x, z) goes to (w - 1 - x, z); across z, to (x, h - 1 - z). */
export function mirrorLiquidClip(clip: LiquidClip, axis: 'x' | 'z'): LiquidClip {
	return {
		w: clip.w,
		h: clip.h,
		cells: clip.cells.map((c) =>
			axis === 'x'
				? { x: clip.w - 1 - c.x, z: c.z, id: c.id, heights: [c.heights[1], c.heights[0], c.heights[3], c.heights[2]], depth: [c.depth[1], c.depth[0], c.depth[3], c.depth[2]] }
				: { x: c.x, z: clip.h - 1 - c.z, id: c.id, heights: [c.heights[2], c.heights[3], c.heights[0], c.heights[1]], depth: [c.depth[2], c.depth[3], c.depth[0], c.depth[1]] },
		),
	}
}

/** The clip turned a quarter turn, the way `rotateClip` turns the area: cell (x, z) goes to (z, w - 1 - x). */
export function rotateLiquidClip(clip: LiquidClip): LiquidClip {
	return {
		w: clip.h,
		h: clip.w,
		cells: clip.cells.map((c) => ({
			x: c.z,
			z: clip.w - 1 - c.x,
			id: c.id,
			// The corners turn with the cell: (0,0) lands at (0,1), (1,0) at (0,0), (0,1) at (1,1), (1,1) at (1,0).
			heights: [c.heights[1], c.heights[3], c.heights[0], c.heights[2]],
			depth: [c.depth[1], c.depth[3], c.depth[0], c.depth[2]],
		})),
	}
}
