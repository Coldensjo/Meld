// The walkable-ground workers' copy of what a tile's triangles are gathered from (#633): the ground's
// heights, holes and inner heights, the liquids and the sea, and every placed model. NavPreview keeps
// the workers' copies up to date with `SceneUpdate`s (the whole ground and liquids on a full rebuild,
// the rows a sculpt or hole stroke changed, a placement added, moved or dropped) and posts each tile as
// a `GatherJob`, its box and height span only, so the gathering (TileGatherer, the cut under the
// models) runs in the worker beside Recast's build. A placement is its model type, matrix and box only
// (#849) and its groups' boxes (#866): the main thread works out the boxes (it needs them for the
// height spans and the changed tiles), sends a model type's groups' faces once each, before the first
// job whose reach meets a placed group of them, and each side places a model's groups (`PlacedModels`)
// only once a gathered box meets them, so a far model that only sets a tile's height span (Stormwind's
// WMO, seen from Northshire) is never placed or copied, and one whose box meets a tile's reach only for
// the groups near it. The main thread gathers itself where the workers can't run.

import { heightAt } from '../../terrain/heightField'
import type { LiquidLayer } from '../../water/liquids'
import type { TileInput } from './navBuild'
import { TileGatherer, groupMeets, groupStarts, placeGroups, type ModelLiquid, type NavGround, type PlacedBox, type PlacedCollision } from './navGeometry'
import { NavLiquids, type NavLiquidSource } from './navLiquids'

/** One change to the workers' copy of the gather's inputs, applied in the order sent. */
export type SceneUpdate =
	/** The whole ground; the liquids' chunks are worked out again over it. */
	| { kind: 'ground'; ground: NavGround }
	/** Ground rows that changed: `heights`' vertex rows from row `hz`, `holes`' cell rows from row `cz`, whole rows each. */
	| { kind: 'rows'; hz: number; heights: Float32Array; cz: number; holes: Uint8Array }
	/** The liquids (every chunk that has a layer) and the sea's level (null for none): the liquids start over. */
	| { kind: 'liquids'; side: number; chunks: [number, LiquidLayer[]][]; sea: number | null }
	/** The liquid chunks over cells gx0..gx1, gz0..gz1 (inclusive) to work out again (NavLiquids.forget). */
	| { kind: 'forget'; gx0: number; gz0: number; gx1: number; gz1: number }
	/**
	 * Some of a model type's groups' faces in its own frame (#866): `parts` the groups' indices, their
	 * faces one after another in `tris`, sent before the first job whose reach meets those groups, with
	 * every group's size and, the first time, its liquids; kept across a `models`.
	 */
	| { kind: 'type'; type: string; groups: Uint32Array; liquid: ModelLiquid | null; parts: Uint32Array; tris: Float32Array }
	/** Every placement, in the main thread's order, replacing those held. */
	| { kind: 'models'; list: ScenePlacement[] }
	/** A model placed, or moved (keeping its place in the order). */
	| { kind: 'place'; placement: ScenePlacement }
	| { kind: 'drop'; id: number }

/** A model type's collision faces in its own frame (nine floats a triangle), its groups' sizes and its liquids, as /wow/collision sends them. */
export interface LocalFaces {
	tris: Float32Array
	groups: Uint32Array
	liquid: ModelLiquid | null
}

/**
 * A model type's faces as one side holds them: a worker's copy (#866) has every group's room in `tris`
 * but only the groups flagged in `have` filled in, those it was sent; the main thread's has them all.
 */
export interface HeldFaces extends LocalFaces {
	have?: Uint8Array
}

/**
 * A placed model: its type, its column-major matrix (the Engine's doubles, so each side places the
 * same faces), how many groups its type has, the box `placeFaces` gives it, and each group's box, a
 * little wider than its faces (`placedBoxes`, #866), by which each side places and sends only the
 * groups a gather's reach meets.
 */
export interface ScenePlacement {
	id: number
	type: string
	matrix: Float64Array
	groups: number
	box: PlacedBox
	groupBoxes: Float64Array
}

/** A tile for a worker to gather and build from its copy: the box gathered (its border too) and the voxels' height span. */
export interface GatherJob {
	continent: boolean
	tx: number
	tz: number
	x0: number
	z0: number
	x1: number
	z1: number
	floorY: number
	ceilY: number
}

/** The whole ground, its arrays the terrain's own until `sceneCopy` copies them for each worker. */
export function groundUpdate(g: NavGround): SceneUpdate {
	return { kind: 'ground', ground: { size: g.size, verts: g.verts, cellSize: g.cellSize, heights: g.heights, holes: g.holes, innerLift: g.innerLift ?? null, innerBase: g.innerBase ?? null } }
}

/** Ground vertex rows vz0..vz1 (inclusive) and the cell rows beside them, whole rows, as views of the terrain's arrays. */
export function rowsUpdate(g: NavGround, vz0: number, vz1: number): SceneUpdate {
	const hz = Math.max(0, vz0)
	const hz1 = Math.min(g.verts - 1, vz1)
	const cz = Math.max(0, vz0 - 1)
	const cz1 = Math.min(g.size - 1, vz1)
	return { kind: 'rows', hz, heights: g.heights.subarray(hz * g.verts, (hz1 + 1) * g.verts), cz, holes: g.holes.subarray(cz * g.size, (cz1 + 1) * g.size) }
}

/** The liquids: every chunk's layers, the map's own until `sceneCopy`. */
export function liquidsUpdate(map: NavLiquidSource | null, sea: number | null): SceneUpdate {
	const chunks: [number, LiquidLayer[]][] = []
	const side = map?.side ?? 0
	for (let c = 0; c < side * side; c++) {
		const layers = map!.layers(c)
		if (layers.length) chunks.push([c, [...layers]])
	}
	return { kind: 'liquids', side, chunks, sea }
}

/**
 * A copy of `updates` for one worker, every array its own, and their buffers to hand over: copying
 * and handing over costs a memcpy, where postMessage's structured clone of the abbey scene's 16 MB of
 * placed faces took 14 to 18 ms. A view's copy holds only its range (a WMO's liquid indices are a view
 * onto its whole collision reply).
 */
export function sceneCopy(updates: readonly SceneUpdate[]): { updates: SceneUpdate[]; transfer: ArrayBuffer[] } {
	const transfer: ArrayBuffer[] = []
	const c = <T extends Float32Array | Uint32Array | Uint8Array>(a: T): T => {
		const b = a.slice() as T
		transfer.push(b.buffer as ArrayBuffer)
		return b
	}
	// A placement is small: the structured clone copies it; its matrix is made its own here too.
	const placement = (p: ScenePlacement): ScenePlacement => ({ ...p, matrix: p.matrix.slice() })
	const out = updates.map((u): SceneUpdate => {
		switch (u.kind) {
			case 'ground': {
				const g = u.ground
				return {
					kind: 'ground',
					ground: { size: g.size, verts: g.verts, cellSize: g.cellSize, heights: c(g.heights), holes: c(g.holes), innerLift: g.innerLift ? c(g.innerLift) : null, innerBase: g.innerBase ? c(g.innerBase) : null },
				}
			}
			case 'rows':
				return { kind: 'rows', hz: u.hz, heights: c(u.heights), cz: u.cz, holes: c(u.holes) }
			case 'liquids':
				return { kind: 'liquids', side: u.side, sea: u.sea, chunks: u.chunks.map(([k, layers]) => [k, layers.map((l) => ({ id: l.id, heights: c(l.heights), depth: c(l.depth), cells: c(l.cells) }))]) }
			case 'type': {
				const l = u.liquid
				return { kind: 'type', type: u.type, groups: c(u.groups), liquid: l ? { verts: c(l.verts), idx: c(l.idx), types: c(l.types) } : null, parts: c(u.parts), tris: c(u.tris) }
			}
			case 'models':
				return { kind: 'models', list: u.list.map(placement) }
			case 'place':
				return { kind: 'place', placement: placement(u.placement) }
			default:
				return u
		}
	})
	return { updates: out, transfer }
}

/** Whether a placement's box meets [x0, x1] × [z0, z1], as the gather tests it. */
export function boxMeets(b: PlacedBox, x0: number, z0: number, x1: number, z1: number): boolean {
	return !(b.max[0] < x0 || b.min[0] > x1 || b.max[2] < z0 || b.min[2] > z1)
}

/**
 * The box a gather over [x0, x1] × [z0, z1] of ground with `cellSize` cells looks for model faces in
 * (TileGatherer.gather: a cell wider all round); a model whose box misses it is passed by.
 */
export function gatherReach(cellSize: number, x0: number, z0: number, x1: number, z1: number, out: number[]): number[] {
	out[0] = x0 - cellSize
	out[1] = z0 - cellSize
	out[2] = x1 + cellSize
	out[3] = z1 + cellSize
	return out
}

const NO_LAYERS: readonly LiquidLayer[] = []
const NO_TRIS = new Float32Array(0)

interface PlacedEntry {
	p: ScenePlacement
	/** The faces of its groups placed so far (`want`), and a stand-in with only its box and group count for the gathers that pass it by. */
	faces: PlacedCollision | null
	want: Uint8Array | null
	standIn: PlacedCollision | null
}

/**
 * The placed models in order, each one's faces placed from its type's local faces only once a
 * gathered box meets it (#849), and then only the groups whose boxes it meets (`placeGroups`, #866):
 * near Northshire, a few of Stormwind's. A gather numbers every model's groups in this order, so one it
 * passes by still counts its groups, through a stand-in that holds only its box and group count.
 */
export class PlacedModels {
	private entries = new Map<number, PlacedEntry>()
	private boxList: PlacedBox[] = []
	private boxesStale = false
	private gatherList: PlacedCollision[] = []
	private reach = [0, 0, 0, 0]

	/** `local` gives a model type's faces; it must have them for every group a gather's reach meets. */
	constructor(private local: (type: string) => HeldFaces | null) {}

	get size(): number {
		return this.entries.size
	}

	get(id: number): ScenePlacement | undefined {
		return this.entries.get(id)?.p
	}

	keys(): IterableIterator<number> {
		return this.entries.keys()
	}

	*values(): IterableIterator<ScenePlacement> {
		for (const e of this.entries.values()) yield e.p
	}

	/** Adds a placement, or replaces one (keeping its place in the order). */
	set(p: ScenePlacement) {
		this.entries.set(p.id, { p, faces: null, want: null, standIn: null })
		this.boxesStale = true
	}

	delete(id: number) {
		if (this.entries.delete(id)) this.boxesStale = true
	}

	clear() {
		this.entries.clear()
		this.boxesStale = true
	}

	/** Frees the placed faces (placed again when a gather needs them), keeping the placements. */
	dropFaces() {
		for (const e of this.entries.values()) {
			e.faces = e.standIn = null
			e.want = null
		}
	}

	/** Every placement's box, in order (adtHeightSpan). */
	boxes(): readonly PlacedBox[] {
		if (this.boxesStale) {
			this.boxList = []
			for (const e of this.entries.values()) this.boxList.push(e.p.box)
			this.boxesStale = false
		}
		return this.boxList
	}

	/**
	 * The models for `TileGatherer.gather` over [x0, x1] × [z0, z1] of `ground`: placed where their box
	 * meets the gather's reach (`gatherReach`), at least the groups it meets, stand-ins elsewhere. The
	 * list is reused by the next call.
	 */
	forGather(ground: NavGround, x0: number, z0: number, x1: number, z1: number): readonly PlacedCollision[] {
		const r = gatherReach(ground.cellSize, x0, z0, x1, z1, this.reach)
		const list = this.gatherList
		list.length = 0
		for (const e of this.entries.values()) {
			const b = e.p.box
			if (boxMeets(b, r[0], r[1], r[2], r[3])) list.push(this.place(e, r))
			else list.push((e.standIn ??= { tris: NO_TRIS, groups: new Uint32Array(e.p.groups), min: b.min, max: b.max, origin: b.origin, liquid: null }))
		}
		return list
	}

	/** Entry `e`'s faces with every group whose box meets reach `r`, placing those it lacks. */
	private place(e: PlacedEntry, r: number[]): PlacedCollision {
		const p = e.p
		let want: Uint8Array | null = null
		for (let g = 0; g < p.groups; g++) {
			if (e.want?.[g] || !groupMeets(p.groupBoxes, g, r[0], r[1], r[2], r[3])) continue
			;(want ??= e.want ? e.want.slice() : new Uint8Array(p.groups))[g] = 1
		}
		if (!want) {
			if (e.faces) return e.faces
			want = new Uint8Array(p.groups)
		}
		const l = this.local(p.type)
		if (!l || (l.have && want.some((w, g) => w && !l.have![g]))) throw new Error(`no collision faces for ${p.type}`)
		e.faces = placeGroups(l.tris, l.groups, p.matrix, want, p.box, l.liquid, e.faces)
		e.want = want
		return e.faces
	}
}

/** A worker's copy of the gather's inputs, and the gatherer that reads it. */
export class NavScene {
	private ground: NavGround | null = null
	private worldSize = 0
	private liquidChunks = new Map<number, LiquidLayer[]>()
	private liquidSource: NavLiquidSource = { side: 0, layers: (c) => this.liquidChunks.get(c) ?? NO_LAYERS }
	private sea: number | null = null
	private liquids = new NavLiquids()
	private types = new Map<string, HeldFaces>()
	private models = new PlacedModels((t) => this.types.get(t) ?? null)
	private gatherer = new TileGatherer()
	private groundAt = (x: number, z: number): number | null => {
		const g = this.ground!
		return x >= 0 && z >= 0 && x <= this.worldSize && z <= this.worldSize ? heightAt(g.heights, g.size, g.cellSize, x, z) : null
	}

	apply(u: SceneUpdate) {
		switch (u.kind) {
			case 'ground':
				this.ground = u.ground
				this.worldSize = u.ground.size * u.ground.cellSize
				this.liquids.reset(this.liquidSource, u.ground, this.sea)
				break
			case 'rows': {
				const g = this.ground!
				g.heights.set(u.heights, u.hz * g.verts)
				g.holes.set(u.holes, u.cz * g.size)
				break
			}
			case 'liquids':
				this.liquidChunks.clear()
				for (const [c, layers] of u.chunks) this.liquidChunks.set(c, layers)
				this.liquidSource.side = u.side
				this.sea = u.sea
				this.liquids.reset(this.liquidSource, this.ground!, u.sea)
				break
			case 'forget':
				this.liquids.forget(u.gx0, u.gz0, u.gx1, u.gz1)
				break
			case 'type':
				this.addType(u)
				break
			case 'models':
				this.models.clear()
				for (const p of u.list) this.models.set(p)
				break
			case 'place':
				this.models.set(u.placement)
				break
			case 'drop':
				this.models.delete(u.id)
				break
		}
	}

	/** Puts a `type` update's groups into the type's faces, made with room for every group the first time (all of them when it brings them all). */
	private addType(u: Extract<SceneUpdate, { kind: 'type' }>) {
		const starts = groupStarts(u.groups)
		const n = u.groups.length
		let t = this.types.get(u.type)
		if (!t) {
			if (u.parts.length === n && u.tris.length === starts[n] * 9) {
				this.types.set(u.type, { tris: u.tris, groups: u.groups, liquid: u.liquid })
				return
			}
			t = { tris: new Float32Array(starts[n] * 9), groups: u.groups, liquid: u.liquid, have: new Uint8Array(n) }
			this.types.set(u.type, t)
		}
		if (!t.have) return
		let at = 0
		for (const g of u.parts) {
			const c = (starts[g + 1] - starts[g]) * 9
			t.tris.set(u.tris.subarray(at, at + c), starts[g] * 9)
			t.have[g] = 1
			at += c
		}
	}

	/** A job's triangles, in the gatherer's buffers (good until the next gather), with the job's height span. */
	gather(job: GatherJob): TileInput {
		const g = this.ground!
		const input = this.gatherer.gather(g, this.models.forGather(g, job.x0, job.z0, job.x1, job.z1), job.x0, job.z0, job.x1, job.z1, this.groundAt, this.liquids)
		input.floorY = job.floorY
		input.ceilY = job.ceilY
		return input
	}
}
