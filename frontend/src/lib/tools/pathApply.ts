// Applying a path (#167, terrain/paths.ts) to the map: what each kind writes into the ground, recorded
// for undo by what it touched only. A path can run diagonally across a whole region, so the stroke
// recorders of brush.ts, which keep the rect around everything touched, would hold most of the map's
// paint; here the heights are kept vertex by vertex and the paint chunk by chunk. What an apply
// replaced is its record (pathRecord.ts), which the map file keeps too (#395), and its undo step is
// made from the record alone, so a record read back from the file takes the apply back as well.
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import { compactChunk, SLOTS } from '../terrain/chunkPaint'
import { paintPixel } from './brush'
import { PATH_KINDS, crossWeight, downhill, fencePieces, limitGrade, pathField, riverBed, samplePath, type MapPath, type PathSamples } from '../terrain/paths'
import { LIQUID_CELLS, LIQUID_VERTS, autoOpacity, cloneLayer, newLayer, type LiquidLayer, type LiquidMap } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'
import { recordBytes, type PathRecord } from './pathRecord'

/** The heights a path changed, vertex by vertex, before and after. */
class HeightEdit {
	private index: number[] = []
	private before: number[] = []
	private seen = new Set<number>()

	constructor(private t: Terrain) {}

	/** Saves vertex i's height before it is first written. */
	reserve(i: number) {
		if (this.seen.has(i)) return
		this.seen.add(i)
		this.index.push(i)
		this.before.push(this.t.heights[i])
	}

	/** The vertices written and their heights before, once the mesh and the models standing there follow the new ones. */
	finish(objects: ObjectLayer): PathRecord['heights'] {
		if (!this.index.length) return null
		const index = Int32Array.from(this.index)
		markHeights(this.t, objects, index)
		return { index, before: Float32Array.from(this.before) }
	}
}

/** The vertex rect holding the vertices `index` of a grid `V` wide. */
function vertexRect(V: number, index: Int32Array): { x0: number; z0: number; x1: number; z1: number } {
	let x0 = Infinity,
		z0 = Infinity,
		x1 = -Infinity,
		z1 = -Infinity
	for (const i of index) {
		const x = i % V
		const z = (i - x) / V
		if (x < x0) x0 = x
		if (x > x1) x1 = x
		if (z < z0) z0 = z
		if (z > z1) z1 = z
	}
	return { x0, z0, x1, z1 }
}

/** Redraws the ground at vertices `index`, and stands the models there on it again. */
function markHeights(t: Terrain, objects: ObjectLayer, index: Int32Array) {
	if (!index.length) return
	const r = vertexRect(t.verts, index)
	const cs = t.cellSize
	t.markDirty(r.x0, r.z0, r.x1, r.z1)
	objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
}

type ChunkPaint = { weights: Uint8Array; slots: Uint8Array }

/** Paint chunk c's weights (its texels row-major) and slots. */
function readChunk(t: Terrain, c: number): ChunkPaint {
	const per = t.splatRes / t.paintChunksPerSide
	const R = t.splatRes
	const side = t.paintChunksPerSide
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	const weights = new Uint8Array(per * per * SLOTS)
	for (let z = 0; z < per; z++) {
		const s = ((z0 + z) * R + x0) * SLOTS
		weights.set(t.weights.subarray(s, s + per * SLOTS), z * per * SLOTS)
	}
	return { weights, slots: t.chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS) }
}

function writeChunk(t: Terrain, c: number, v: ChunkPaint) {
	const per = t.splatRes / t.paintChunksPerSide
	const R = t.splatRes
	const side = t.paintChunksPerSide
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	for (let z = 0; z < per; z++) t.weights.set(v.weights.subarray(z * per * SLOTS, (z + 1) * per * SLOTS), ((z0 + z) * R + x0) * SLOTS)
	t.chunkSlots.set(v.slots, c * SLOTS)
}

/** Redraws the paint of chunks `chunks`. */
function markPaint(t: Terrain, chunks: Int32Array) {
	if (!chunks.length) return
	const side = t.paintChunksPerSide
	const per = t.splatRes / side
	let x0 = Infinity,
		z0 = Infinity,
		x1 = -Infinity,
		z1 = -Infinity
	for (const c of chunks) {
		const cx = c % side
		const cz = Math.floor(c / side)
		x0 = Math.min(x0, cx * per)
		z0 = Math.min(z0, cz * per)
		x1 = Math.max(x1, cx * per + per - 1)
		z1 = Math.max(z1, cz * per + per - 1)
	}
	t.markSplatDirty({ x0, z0, x1, z1 })
}

/** The paint a path changed, a whole paint chunk at a time (painting may reorder a chunk's slots). */
class PaintEdit {
	private chunks = new Map<number, ChunkPaint>()

	constructor(private t: Terrain) {}

	/** Saves the chunk holding texel (x, z) before it is first painted. */
	reserveTexel(x: number, z: number) {
		const per = this.t.splatRes / this.t.paintChunksPerSide
		const c = Math.floor(z / per) * this.t.paintChunksPerSide + Math.floor(x / per)
		if (!this.chunks.has(c)) this.chunks.set(c, readChunk(this.t, c))
	}

	/** The chunks painted and their paint before, once the slots painting emptied are freed and the chunks redrawn. */
	finish(): PathRecord['paint'] {
		if (!this.chunks.size) return null
		const t = this.t
		const chunks = Int32Array.from(this.chunks.keys())
		const weights = new Uint8Array(chunks.length * (t.splatRes / t.paintChunksPerSide) ** 2 * SLOTS)
		const slots = new Uint8Array(chunks.length * SLOTS)
		let k = 0
		for (const [c, v] of this.chunks) {
			// Frees the slots painting emptied, as a brush stroke's end does.
			compactChunk(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c)
			weights.set(v.weights, k * v.weights.length)
			slots.set(v.slots, k * SLOTS)
			k++
		}
		markPaint(t, chunks)
		return { chunks, weights, slots }
	}
}

/** Sample spacing along a path, yards: well under a cell, so the field is smooth. */
const SAMPLE_STEP = 0.5

/** What an apply wrote, as one undo step, what it replaced, and what the author should hear about it. */
export interface PathApplied {
	cmd: Command | null
	/** What the apply replaced (null when it wrote nothing), which `cmd` is made from. */
	record: PathRecord | null
	/** A sentence for the status bar: what was done, or why part of it wasn't. */
	message: string
}

/** The maps an apply writes into. */
export interface PathTargets {
	terrain: Terrain
	objects: ObjectLayer
	liquids: LiquidMap
	/** The sea's level, or null without one: a River's apply never raises ground lying below it, so its banks don't dam the mouth (#774). */
	sea?: number | null
}

/** A fence's model as the apply needs it: its length along the curve, and whether that is its local Z. */
export interface FencePiece {
	length: number
	alongZ: boolean
}

/**
 * Applies `path` by its kind, with its texture at palette index `tex` (-1 for none) and a fence's
 * model measured in `piece`. The map is written straight away; the result's command undoes it.
 */
export function applyPath(m: PathTargets, path: MapPath, tex: number, piece?: FencePiece): PathApplied {
	const kind = PATH_KINDS.find((k) => k.id === path.kind)?.name ?? 'Path'
	if (path.points.length < 2) return { cmd: null, record: null, message: `A ${kind.toLowerCase()} needs two points at least: click the ground to add them.` }
	const t = m.terrain
	const sm = samplePath(path.points, SAMPLE_STEP)
	const label = `Apply ${path.name}`
	if (path.kind === 'fence') {
		const fence = placeFence(m.objects, sm, path, piece)
		return { ...fence, cmd: fence.record && recordCommand(m, fence.record, label) }
	}
	const heights = new HeightEdit(t)
	let note = ''
	let liquids: PathRecord['liquids'] = null
	if (path.kind === 'river') {
		downhill(sm)
		const sea = m.sea ?? null
		carveRiver(t, sm, path, heights, sea === null ? undefined : (v) => (t.heights[v] < sea ? 0 : Infinity))
		const liquid = fillRiver(m, sm, path)
		liquids = liquid.liquids
		if (!liquid.cells) note = ' It holds no liquid: the curve is narrower than a cell.'
	} else {
		limitGrade(sm, path.grade)
		levelRoad(t, sm, path, heights)
	}
	const paint = new PaintEdit(t)
	const refused = tex >= 0 ? paintAlong(t, sm, path, tex, paint) : 0
	const record: PathRecord = { heights: heights.finish(m.objects), paint: paint.finish(), liquids, models: null }
	const wrote = !!(record.heights || record.paint || record.liquids)
	const message = refused
		? `${kind} applied, but part of its paint was refused: those chunks already hold four other textures (the 1.12 limit).`
		: tex < 0 && path.texture
			? `${kind} applied without its paint: pick its texture in the asset browser first, so the map has it.`
			: `${kind} applied: ${Math.round(sm.length)} yd.`
	return { cmd: wrote ? recordCommand(m, record, label) : null, record: wrote ? record : null, message: message + note }
}

/**
 * The undo step of an apply that replaced `r`: undo keeps what is in the map there now and writes back
 * what the apply replaced (the heights and paint, the liquid chunks, and no fence models), and redo
 * writes what undo kept. Made from the record alone, so one read back from the map file (#395) takes
 * its apply back as one made just now does.
 */
export function recordCommand(m: Pick<PathTargets, 'terrain' | 'objects' | 'liquids'>, r: PathRecord, label: string): Command {
	const t = m.terrain
	let kept: { heights: Float32Array | null; paint: ChunkPaint[] | null; liquids: LiquidLayer[][] | null; models: WorldObject[] } | null = null
	const writeHeights = (v: Float32Array) => {
		const index = r.heights!.index
		for (let k = 0; k < index.length; k++) t.heights[index[k]] = v[k]
		markHeights(t, m.objects, index)
	}
	const writePaint = (chunks: Int32Array, v: (k: number) => ChunkPaint) => {
		chunks.forEach((c, k) => writeChunk(t, c, v(k)))
		markPaint(t, chunks)
	}
	return {
		label,
		bytes: recordBytes(r) * 2,
		undo: () => {
			const p = r.paint
			const models: WorldObject[] = []
			if (r.models) {
				for (const id of r.models.ids) {
					const o = m.objects.objects.get(id)
					if (o?.type !== r.models.type) continue
					models.push({ ...o })
					m.objects.remove(id)
				}
			}
			kept = {
				heights: r.heights ? Float32Array.from(r.heights.index, (i) => t.heights[i]) : null,
				paint: p ? Array.from(p.chunks, (c) => readChunk(t, c)) : null,
				liquids: r.liquids ? Array.from(r.liquids.chunks, (c) => m.liquids.layers(c).map(cloneLayer)) : null,
				models,
			}
			if (r.heights) writeHeights(r.heights.before)
			if (p) {
				const n = p.weights.length / p.chunks.length
				writePaint(p.chunks, (k) => ({ weights: p.weights.subarray(k * n, (k + 1) * n), slots: p.slots.subarray(k * SLOTS, (k + 1) * SLOTS) }))
			}
			if (r.liquids) r.liquids.chunks.forEach((c, k) => m.liquids.set(c, r.liquids!.layers[k].map(cloneLayer)))
		},
		redo: () => {
			const k = kept
			if (!k) return
			if (k.heights) writeHeights(k.heights)
			if (k.paint && r.paint) writePaint(r.paint.chunks, (i) => k.paint![i])
			if (k.liquids && r.liquids) r.liquids.chunks.forEach((c, i) => m.liquids.set(c, k.liquids![i].map(cloneLayer)))
			for (const o of k.models) m.objects.add({ ...o })
		},
	}
}

/**
 * A fence: the path's model stood on the ground in the middle of each span along the curve, turned
 * along it (`fencePieces`), spans of the spacing or of the model's own length.
 */
function placeFence(objects: ObjectLayer, sm: PathSamples, path: MapPath, piece?: FencePiece): { record: PathRecord | null; message: string } {
	if (!path.model) return { record: null, message: `Pick the fence's model first: click one in the asset browser while the path is picked.` }
	const span = path.spacing > 0 ? path.spacing : (piece?.length ?? 0)
	if (span < 0.25) return { record: null, message: `The fence's model has no length to lay end to end: set a Spacing.` }
	const pieces = fencePieces(sm, span, !!piece?.alongZ, path.turn)
	if (pieces.length > MAX_FENCE_MODELS) return { record: null, message: `That would stand ${pieces.length} models: more than ${MAX_FENCE_MODELS}. Raise the spacing or shorten the path.` }
	if (!pieces.length) return { record: null, message: `The fence is shorter than one model: lengthen the path or lower the spacing.` }
	const added = pieces.map((p) => objects.add({ type: path.model, x: p.x, z: p.z, yOff: 0, rotY: p.rotY, scale: 1 }))
	const record: PathRecord = { heights: null, paint: null, liquids: null, models: { ids: Int32Array.from(added, (o) => o.id), type: path.model } }
	return { record, message: `Fence applied: ${added.length} models over ${Math.round(sm.length)} yd.` }
}

/** The most models one fence apply stands, so a tiny spacing over a long curve can't hang the editor. */
const MAX_FENCE_MODELS = 5000

/** A road: the ground within half the width takes the curve's (graded) height, blending back over the falloff. */
function levelRoad(t: Terrain, sm: PathSamples, path: MapPath, heights: HeightEdit) {
	const half = path.width / 2
	const field = pathField(sm, t.cellSize, 0, half + path.falloff, t.size)
	if (!field) return
	const V = t.verts
	const h = t.heights
	for (let j = 0; j < field.h; j++) {
		for (let i = 0; i < field.w; i++) {
			const k = j * field.w + i
			const w = crossWeight(field.dist[k], half, path.falloff)
			if (w <= 0) continue
			const v = (field.z0 + j) * V + field.x0 + i
			heights.reserve(v)
			h[v] += (field.height[k] - h[v]) * w
		}
	}
}

/**
 * A river's bed: within half the width the ground takes `riverBed`'s profile under the curve's
 * (downhill) surface, `depth` deep in the middle and a little above the surface at the banks, and
 * beyond them it blends back over the falloff from the bank's height. With `raise`, no vertex v rises
 * more than `raise(v)` yards (a new world's rivers, `layRiver`).
 */
function carveRiver(t: Terrain, sm: PathSamples, path: MapPath, heights: HeightEdit, raise?: (v: number) => number) {
	const half = path.width / 2
	const field = pathField(sm, t.cellSize, 0, half + path.falloff, t.size)
	if (!field) return
	const V = t.verts
	const h = t.heights
	for (let j = 0; j < field.h; j++) {
		for (let i = 0; i < field.w; i++) {
			const k = j * field.w + i
			const d = field.dist[k]
			const w = crossWeight(d, half, path.falloff)
			if (w <= 0) continue
			const v = (field.z0 + j) * V + field.x0 + i
			heights.reserve(v)
			let to = (riverBed(d, half, field.height[k], path.depth) - h[v]) * w
			if (raise && to > 0) to = Math.min(to, raise(v))
			h[v] += to
		}
	}
}

/**
 * Lays a new world's river (#763, water/rivers.ts) along `path` as `applyPath` lays a River, without
 * an undo step: no ground is raised more than `raise(v)` yards (0 under the sea or a lake, so the
 * banks don't dam the mouth). Returns its samples, whose heights are the surface, the cells filled,
 * and its record (null if it wrote nothing), so the Path tool's Apply on it takes the carve back first (#395).
 */
export function layRiver(m: PathTargets, path: MapPath, raise: (v: number) => number): { sm: PathSamples; cells: number; record: PathRecord | null } {
	const sm = samplePath(path.points, SAMPLE_STEP)
	downhill(sm)
	const heights = new HeightEdit(m.terrain)
	carveRiver(m.terrain, sm, path, heights, raise)
	const liquid = fillRiver(m, sm, path)
	const record: PathRecord = { heights: heights.finish(m.objects), paint: null, liquids: liquid.liquids, models: null }
	return { sm, cells: liquid.cells, record: record.heights || record.liquids ? record : null }
}

/**
 * Fills a river with its liquid: every cell whose centre is within half the width gets a layer of the
 * path's liquid (the chunk's other liquids leave that cell), its four corners at the surface of the
 * curve's nearest point. Neighbouring chunks take the same height at a shared corner, so the surface
 * slopes down the river without steps. Returns the chunks changed with their layers before, and the cells covered.
 */
function fillRiver(m: PathTargets, sm: PathSamples, path: MapPath): { liquids: PathRecord['liquids']; cells: number } {
	const t = m.terrain
	const cs = t.cellSize
	const half = path.width / 2
	const cells = pathField(sm, cs, cs / 2, half, t.size - 1)
	// The surface at every corner of those cells, from the curve's height nearest the corner.
	const corners = pathField(sm, cs, 0, half + cs * 1.5, t.size)
	if (!cells || !corners) return { liquids: null, cells: 0 }
	const map = m.liquids
	const stroke = new LiquidStroke(map, 'river')
	const work = new Map<number, LiquidLayer[]>()
	const factor = autoOpacity(path.liquid)
	const V = t.verts
	let covered = 0
	for (let j = 0; j < cells.h; j++) {
		for (let i = 0; i < cells.w; i++) {
			if (cells.dist[j * cells.w + i] > half) continue
			const gx = cells.x0 + i
			const gz = cells.z0 + j
			const c = Math.floor(gz / LIQUID_CELLS) * map.side + Math.floor(gx / LIQUID_CELLS)
			let layers = work.get(c)
			if (!layers) {
				stroke.reserve(c)
				layers = map.layers(c).map(cloneLayer)
				work.set(c, layers)
			}
			let layer = layers.find((l) => l.id === path.liquid)
			if (!layer) {
				layer = newLayer(path.liquid, 0)
				layers.push(layer)
			}
			const lx = gx % LIQUID_CELLS
			const lz = gz % LIQUID_CELLS
			for (const l of layers) l.cells[lz * LIQUID_CELLS + lx] = l === layer ? 1 : 0
			for (let dz = 0; dz <= 1; dz++) {
				for (let dx = 0; dx <= 1; dx++) {
					const vx = gx + dx
					const vz = gz + dz
					const k = (vz - corners.z0) * corners.w + (vx - corners.x0)
					const surface = corners.height[k]
					const n = (lz + dz) * LIQUID_VERTS + lx + dx
					layer.heights[n] = surface
					// The colour and opacity follow the depth over the carved ground (the water brush's rule).
					layer.depth[n] = Math.min(1, Math.max(0, (surface - t.heights[vz * V + vx] + 1) * factor))
				}
			}
			covered++
		}
	}
	for (const [c, layers] of work) map.set(c, layers)
	const changed = stroke.changed()
	return { liquids: changed.size ? { chunks: Int32Array.from(changed.keys()), layers: [...changed.values()] } : null, cells: covered }
}

/**
 * Paints palette texture `tex` over the width, fading over the path's edge (a hard edge still blends
 * across one texel, so it isn't stair-stepped). Returns the texels a full chunk refused.
 */
function paintAlong(t: Terrain, sm: PathSamples, path: MapPath, tex: number, paint: PaintEdit): number {
	const half = path.width / 2
	const R = t.splatRes
	const ts = t.worldSize / R
	const edge = Math.max(path.edge, 0)
	const tf = pathField(sm, ts, ts / 2, half + Math.max(edge, ts), R - 1)
	if (!tf) return 0
	let refused = 0
	for (let j = 0; j < tf.h; j++) {
		for (let i = 0; i < tf.w; i++) {
			const d = tf.dist[j * tf.w + i]
			const w = edge > 0 ? crossWeight(d, half, edge) : Math.min(1, Math.max(0, (half + ts / 2 - d) / ts))
			if (w <= 0) continue
			const x = tf.x0 + i
			const z = tf.z0 + j
			paint.reserveTexel(x, z)
			if (!paintPixel(t, z * R + x, tex, w)) refused++
		}
	}
	return refused
}
