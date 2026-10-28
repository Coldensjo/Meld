// The walkable-ground workers' copy of what a tile's triangles are gathered from (#633): the ground's
// heights, holes and inner heights, the liquids and the sea, and every placed model's faces in world
// space. NavPreview keeps the workers' copies up to date with `SceneUpdate`s (the whole ground and
// liquids on a full rebuild, the rows a sculpt or hole stroke changed, a placement added, moved or
// dropped) and posts each tile as a `GatherJob`, its box and height span only, so the gathering
// (TileGatherer, the cut under the models) runs in the worker beside Recast's build. The main thread
// still places the models' faces (it needs their boxes for the height spans and the changed tiles)
// and gathers itself where the workers can't run.

import { heightAt } from '../../terrain/heightField'
import type { LiquidLayer } from '../../water/liquids'
import type { TileInput } from './navBuild'
import { TileGatherer, type NavGround, type PlacedCollision } from './navGeometry'
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
	/** Every placed model's faces, in the main thread's order, replacing those held. */
	| { kind: 'models'; list: [number, PlacedCollision][] }
	/** A model placed, or moved (keeping its place in the order). */
	| { kind: 'place'; id: number; faces: PlacedCollision }
	| { kind: 'drop'; id: number }

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
	const faces = (f: PlacedCollision): PlacedCollision => {
		const l = f.liquid
		return { tris: c(f.tris), min: f.min, max: f.max, origin: f.origin, groups: c(f.groups), liquid: l ? { verts: c(l.verts), idx: c(l.idx), areas: c(l.areas) } : null }
	}
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
			case 'models':
				return { kind: 'models', list: u.list.map(([id, f]) => [id, faces(f)]) }
			case 'place':
				return { kind: 'place', id: u.id, faces: faces(u.faces) }
			default:
				return u
		}
	})
	return { updates: out, transfer }
}

const NO_LAYERS: readonly LiquidLayer[] = []

/** A worker's copy of the gather's inputs, and the gatherer that reads it. */
export class NavScene {
	private ground: NavGround | null = null
	private worldSize = 0
	private liquidChunks = new Map<number, LiquidLayer[]>()
	private liquidSource: NavLiquidSource = { side: 0, layers: (c) => this.liquidChunks.get(c) ?? NO_LAYERS }
	private sea: number | null = null
	private liquids = new NavLiquids()
	private models = new Map<number, PlacedCollision>()
	private list: PlacedCollision[] = []
	private listStale = false
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
			case 'models':
				this.models.clear()
				for (const [id, f] of u.list) this.models.set(id, f)
				this.listStale = true
				break
			case 'place':
				this.models.set(u.id, u.faces)
				this.listStale = true
				break
			case 'drop':
				this.models.delete(u.id)
				this.listStale = true
				break
		}
	}

	/** A job's triangles, in the gatherer's buffers (good until the next gather), with the job's height span. */
	gather(job: GatherJob): TileInput {
		if (this.listStale) {
			this.list = [...this.models.values()]
			this.listStale = false
		}
		const input = this.gatherer.gather(this.ground!, this.list, job.x0, job.z0, job.x1, job.z1, this.groundAt, this.liquids)
		input.floorY = job.floorY
		input.ceilY = job.ceilY
		return input
	}
}
