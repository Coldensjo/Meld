// Applying a path (#167, terrain/paths.ts) to the map: what each kind writes into the ground, recorded
// for undo by what it touched only. A path can run diagonally across a whole region, so the stroke
// recorders of brush.ts, which keep the rect around everything touched, would hold most of the map's
// paint; here the heights are kept vertex by vertex and the paint chunk by chunk.
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import { addedCommand } from '../world/objectCommands'
import { compactChunk, SLOTS } from '../terrain/chunkPaint'
import { paintPixel } from './brush'
import { PATH_KINDS, crossWeight, downhill, fencePieces, limitGrade, pathField, riverBed, samplePath, type MapPath, type PathSamples } from '../terrain/paths'
import { LIQUID_CELLS, LIQUID_VERTS, autoOpacity, cloneLayer, newLayer, type LiquidLayer, type LiquidMap } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'

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

	/** The vertex rect the edit covers, or null when it has none. */
	rect(): { x0: number; z0: number; x1: number; z1: number } | null {
		if (!this.index.length) return null
		const V = this.t.verts
		let x0 = Infinity,
			z0 = Infinity,
			x1 = -Infinity,
			z1 = -Infinity
		for (const i of this.index) {
			const x = i % V
			const z = (i - x) / V
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			if (z > z1) z1 = z
		}
		return { x0, z0, x1, z1 }
	}

	finish(objects: ObjectLayer): { undo(): void; redo(): void; bytes: number } | null {
		const r = this.rect()
		if (!r) return null
		const t = this.t
		const index = Int32Array.from(this.index)
		const before = Float32Array.from(this.before)
		const after = Float32Array.from(index, (i) => t.heights[i])
		const cs = t.cellSize
		const write = (v: Float32Array) => {
			for (let k = 0; k < index.length; k++) t.heights[index[k]] = v[k]
			t.markDirty(r.x0, r.z0, r.x1, r.z1)
			objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		}
		// The apply wrote them already: the mesh and the models standing there follow now.
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		return { bytes: index.byteLength + before.byteLength + after.byteLength, undo: () => write(before), redo: () => write(after) }
	}
}

/** The paint a path changed, a whole paint chunk at a time (painting may reorder a chunk's slots). */
class PaintEdit {
	private chunks = new Map<number, { weights: Uint8Array; slots: Uint8Array }>()

	constructor(private t: Terrain) {}

	private get per() {
		return this.t.splatRes / this.t.paintChunksPerSide
	}

	private read(c: number): { weights: Uint8Array; slots: Uint8Array } {
		const t = this.t
		const per = this.per
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

	private write(c: number, v: { weights: Uint8Array; slots: Uint8Array }) {
		const t = this.t
		const per = this.per
		const R = t.splatRes
		const side = t.paintChunksPerSide
		const x0 = (c % side) * per
		const z0 = Math.floor(c / side) * per
		for (let z = 0; z < per; z++) t.weights.set(v.weights.subarray(z * per * SLOTS, (z + 1) * per * SLOTS), ((z0 + z) * R + x0) * SLOTS)
		t.chunkSlots.set(v.slots, c * SLOTS)
	}

	/** Saves the chunk holding texel (x, z) before it is first painted. */
	reserveTexel(x: number, z: number) {
		const per = this.per
		const c = Math.floor(z / per) * this.t.paintChunksPerSide + Math.floor(x / per)
		if (!this.chunks.has(c)) this.chunks.set(c, this.read(c))
	}

	finish(): { undo(): void; redo(): void; bytes: number } | null {
		if (!this.chunks.size) return null
		const t = this.t
		const side = t.paintChunksPerSide
		const per = this.per
		const before = new Map(this.chunks)
		const after = new Map<number, { weights: Uint8Array; slots: Uint8Array }>()
		let x0 = Infinity,
			z0 = Infinity,
			x1 = -Infinity,
			z1 = -Infinity
		for (const c of before.keys()) {
			// Frees the slots painting emptied, as a brush stroke's end does.
			compactChunk(side, t.splatRes, t.chunkSlots, t.weights, c)
			after.set(c, this.read(c))
			const cx = c % side
			const cz = Math.floor(c / side)
			x0 = Math.min(x0, cx * per)
			z0 = Math.min(z0, cz * per)
			x1 = Math.max(x1, cx * per + per - 1)
			z1 = Math.max(z1, cz * per + per - 1)
		}
		const rect = { x0, z0, x1, z1 }
		t.markSplatDirty(rect)
		const apply = (m: Map<number, { weights: Uint8Array; slots: Uint8Array }>) => {
			for (const [c, v] of m) this.write(c, v)
			t.markSplatDirty(rect)
		}
		let bytes = 0
		for (const m of [before, after]) for (const v of m.values()) bytes += v.weights.byteLength + v.slots.byteLength
		return { bytes, undo: () => apply(before), redo: () => apply(after) }
	}
}

/** Sample spacing along a path, yards: well under a cell, so the field is smooth. */
const SAMPLE_STEP = 0.5

/** What an apply wrote, as one undo step, and what the author should hear about it. */
export interface PathApplied {
	cmd: Command | null
	/** A sentence for the status bar: what was done, or why part of it wasn't. */
	message: string
}

/** The maps an apply writes into. */
export interface PathTargets {
	terrain: Terrain
	objects: ObjectLayer
	liquids: LiquidMap
}

type Part = { undo(): void; redo(): void; bytes?: number }

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
	if (path.points.length < 2) return { cmd: null, message: `A ${kind.toLowerCase()} needs two points at least: click the ground to add them.` }
	const t = m.terrain
	const sm = samplePath(path.points, SAMPLE_STEP)
	if (path.kind === 'fence') return placeFence(m.objects, sm, path, piece)
	const parts: Part[] = []
	const heights = new HeightEdit(t)
	let note = ''
	if (path.kind === 'river') {
		downhill(sm)
		carveRiver(t, sm, path, heights)
		const liquid = fillRiver(m, sm, path)
		if (liquid.cmd) parts.push(liquid.cmd)
		if (!liquid.cells) note = ' It holds no liquid: the curve is narrower than a cell.'
	} else {
		limitGrade(sm, path.grade)
		levelRoad(t, sm, path, heights)
	}
	const paint = new PaintEdit(t)
	const refused = tex >= 0 ? paintAlong(t, sm, path, tex, paint) : 0
	parts.unshift(...[heights.finish(m.objects), paint.finish()].filter((p) => p !== null))
	const message = refused
		? `${kind} applied, but part of its paint was refused: those chunks already hold four other textures (the 1.12 limit).`
		: tex < 0 && path.texture
			? `${kind} applied without its paint: pick its texture in the asset browser first, so the map has it.`
			: `${kind} applied: ${Math.round(sm.length)} yd.`
	return { cmd: combine(`Apply ${path.name}`, parts), message: message + note }
}

/**
 * A fence: the path's model stood on the ground in the middle of each span along the curve, turned
 * along it (`fencePieces`), spans of the spacing or of the model's own length.
 */
function placeFence(objects: ObjectLayer, sm: PathSamples, path: MapPath, piece?: FencePiece): PathApplied {
	if (!path.model) return { cmd: null, message: `Pick the fence's model first: click one in the asset browser while the path is picked.` }
	const span = path.spacing > 0 ? path.spacing : (piece?.length ?? 0)
	if (span < 0.25) return { cmd: null, message: `The fence's model has no length to lay end to end: set a Spacing.` }
	const pieces = fencePieces(sm, span, !!piece?.alongZ, path.turn)
	if (pieces.length > MAX_FENCE_MODELS) return { cmd: null, message: `That would stand ${pieces.length} models: more than ${MAX_FENCE_MODELS}. Raise the spacing or shorten the path.` }
	const added = pieces.map((p) => objects.add({ type: path.model, x: p.x, z: p.z, yOff: 0, rotY: p.rotY, scale: 1 }))
	const cmd = addedCommand(objects, added, `Apply ${path.name}`)
	return { cmd, message: `Fence applied: ${added.length} models over ${Math.round(sm.length)} yd.` }
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
 * beyond them it blends back over the falloff from the bank's height.
 */
function carveRiver(t: Terrain, sm: PathSamples, path: MapPath, heights: HeightEdit) {
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
			h[v] += (riverBed(d, half, field.height[k], path.depth) - h[v]) * w
		}
	}
}

/**
 * Fills a river with its liquid: every cell whose centre is within half the width gets a layer of the
 * path's liquid (the chunk's other liquids leave that cell), its four corners at the surface of the
 * curve's nearest point. Neighbouring chunks take the same height at a shared corner, so the surface
 * slopes down the river without steps. Returns the undo of what changed and the cells covered.
 */
function fillRiver(m: PathTargets, sm: PathSamples, path: MapPath): { cmd: Command | null; cells: number } {
	const t = m.terrain
	const cs = t.cellSize
	const half = path.width / 2
	const cells = pathField(sm, cs, cs / 2, half, t.size - 1)
	// The surface at every corner of those cells, from the curve's height nearest the corner.
	const corners = pathField(sm, cs, 0, half + cs * 1.5, t.size)
	if (!cells || !corners) return { cmd: null, cells: 0 }
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
	const cmd = stroke.finish()
	return { cmd, cells: covered }
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

/** One command doing `parts` in order, undoing them in reverse, holding the bytes they hold. */
export function combine(label: string, parts: ReadonlyArray<{ undo(): void; redo(): void; bytes?: number }>): Command | null {
	if (!parts.length) return null
	return {
		label,
		bytes: parts.reduce((n, p) => n + (p.bytes ?? 0), 0),
		undo: () => {
			for (let i = parts.length - 1; i >= 0; i--) parts[i].undo()
		},
		redo: () => parts.forEach((p) => p.redo()),
	}
}
