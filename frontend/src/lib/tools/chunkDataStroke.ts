import type { Terrain } from '../terrain/Terrain'
import type { Command } from '../state/history'
import { BlockSnapshot, type SnapRect as Rect } from './blockSnapshot'

/** Cells a side of the blocks a stroke saves of the no-effect cells. */
const CELL_BLOCK = 32

/** The bytes of a rect of a `width`-wide byte grid, row by row. */
function extract(src: Uint8Array, width: number, r: Rect) {
	const w = r.x1 - r.x0 + 1
	const out = new Uint8Array(w * (r.z1 - r.z0 + 1))
	for (let z = r.z0; z <= r.z1; z++) out.set(src.subarray(z * width + r.x0, z * width + r.x0 + w), (z - r.z0) * w)
	return out
}

/** Writes `data` (as `extract` gives it) back into the rect. */
function inject(dst: Uint8Array, width: number, r: Rect, data: Uint8Array) {
	const w = r.x1 - r.x0 + 1
	for (let z = r.z0; z <= r.z1; z++) dst.set(data.subarray((z - r.z0) * w, (z - r.z0 + 1) * w), z * width + r.x0)
}

/**
 * Records a Map data stroke for undo: the chunks' area IDs and flags, and the no-effect cells. The
 * chunk tables are small, so they are copied whole when the stroke starts and only the chunks that
 * changed are kept; the cells are saved block by block before they are written (`reserveCells`), as
 * TerrainStroke saves the holes.
 */
export class ChunkDataStroke {
	private areasBefore: Uint32Array
	private flagsBefore: Uint8Array
	private cellsBefore: BlockSnapshot<Uint8Array>
	private cellRect: Rect | null = null
	private terrain: Terrain
	private label: string

	constructor(terrain: Terrain, label: string) {
		this.terrain = terrain
		this.label = label
		this.areasBefore = terrain.areaIds.slice()
		this.flagsBefore = terrain.chunkFlags.slice()
		this.cellsBefore = new BlockSnapshot(terrain.noEffect, terrain.size, terrain.size, 1, CELL_BLOCK)
	}

	/** Saves the no-effect cells under a cell rect (inclusive) about to be written. */
	reserveCells(r: Rect) {
		this.cellsBefore.reserve(r)
	}

	/** A cell rect (inclusive) whose no-effect cells changed. */
	touchCells(r: Rect) {
		const c = this.cellRect
		if (!c) this.cellRect = { ...r }
		else {
			c.x0 = Math.min(c.x0, r.x0)
			c.z0 = Math.min(c.z0, r.z0)
			c.x1 = Math.max(c.x1, r.x1)
			c.z1 = Math.max(c.z1, r.z1)
		}
	}

	finish(): Command | null {
		const t = this.terrain
		const chunks: number[] = []
		for (let i = 0; i < t.areaIds.length; i++) {
			if (t.areaIds[i] !== this.areasBefore[i] || t.chunkFlags[i] !== this.flagsBefore[i]) chunks.push(i)
		}
		const areas = { before: Uint32Array.from(chunks, (i) => this.areasBefore[i]), after: Uint32Array.from(chunks, (i) => t.areaIds[i]) }
		const flags = { before: Uint8Array.from(chunks, (i) => this.flagsBefore[i]), after: Uint8Array.from(chunks, (i) => t.chunkFlags[i]) }
		const r = this.cellRect
		const cells = r ? { before: this.cellsBefore.extract(r), after: extract(t.noEffect, t.size, r) } : null
		if (cells && cells.before.every((v, i) => v === cells.after[i])) this.cellRect = null
		if (!chunks.length && !this.cellRect) return null
		const keepCells = this.cellRect !== null
		const apply = (before: boolean) => {
			chunks.forEach((c, k) => {
				t.areaIds[c] = before ? areas.before[k] : areas.after[k]
				t.chunkFlags[c] = before ? flags.before[k] : flags.after[k]
			})
			if (keepCells && r && cells) inject(t.noEffect, t.size, r, before ? cells.before : cells.after)
			t.touchChunkData()
		}
		let bytes = areas.before.byteLength + areas.after.byteLength + flags.before.byteLength + flags.after.byteLength
		if (keepCells && cells) bytes += cells.before.byteLength + cells.after.byteLength
		return { label: this.label, bytes, undo: () => apply(true), redo: () => apply(false) }
	}
}
