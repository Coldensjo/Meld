import type { Terrain } from '../terrain/Terrain'
import type { Command } from '../state/history'
import type { ShadowRect } from '../terrain/bakedShadows'
import { BlockSnapshot } from './blockSnapshot'

/** Shadow texels a side of the blocks a stroke saves: a chunk's. */
const BLOCK = 64

/**
 * Records an edit of the baked shadows for undo (B-057): the texels are saved block by block before
 * they are written (`reserve`), and `finish` keeps the rect that changed, before and after. A map
 * that had no shadows of its own goes back to none on undo.
 */
export class ShadowStroke {
	private terrain: Terrain
	private label: string
	private hadShadow: boolean
	private before: BlockSnapshot<Uint8Array>
	private rect: ShadowRect | null = null

	constructor(terrain: Terrain, label: string) {
		this.terrain = terrain
		this.label = label
		this.hadShadow = terrain.shadow !== null
		const side = terrain.shadowSide
		this.before = new BlockSnapshot(terrain.ensureShadow(), side, side, 1, BLOCK)
	}

	/** Saves the texels of a rect (inclusive) about to be written. */
	reserve(r: ShadowRect) {
		this.before.reserve(r)
	}

	/** A rect (inclusive) whose texels were written: uploaded now, and kept for the undo step. */
	touch(r: ShadowRect) {
		const c = this.rect
		if (!c) this.rect = { ...r }
		else {
			c.x0 = Math.min(c.x0, r.x0)
			c.z0 = Math.min(c.z0, r.z0)
			c.x1 = Math.max(c.x1, r.x1)
			c.z1 = Math.max(c.z1, r.z1)
		}
		this.terrain.touchShadow(r.z0, r.z1)
	}

	finish(): Command | null {
		const t = this.terrain
		const r = this.rect
		const before = r ? this.before.extract(r) : null
		const after = r ? extract(t.ensureShadow(), t.shadowSide, r) : null
		if (!r || !before || !after || before.every((v, i) => v === after[i])) {
			// Nothing changed: a map that had no shadows of its own still has none.
			if (!this.hadShadow) t.setShadow(null)
			return null
		}
		const hadShadow = this.hadShadow
		const apply = (undo: boolean) => {
			if (undo && !hadShadow) {
				t.setShadow(null)
				return
			}
			inject(t.ensureShadow(), t.shadowSide, r, undo ? before : after)
			t.touchShadow(r.z0, r.z1)
		}
		return { label: this.label, bytes: before.byteLength + after.byteLength, undo: () => apply(true), redo: () => apply(false) }
	}
}

/** The bytes of a rect of a `width`-wide byte grid, row by row. */
function extract(src: Uint8Array, width: number, r: ShadowRect) {
	const w = r.x1 - r.x0 + 1
	const out = new Uint8Array(w * (r.z1 - r.z0 + 1))
	for (let z = r.z0; z <= r.z1; z++) out.set(src.subarray(z * width + r.x0, z * width + r.x0 + w), (z - r.z0) * w)
	return out
}

/** Writes `data` (as `extract` gives it) back into the rect. */
function inject(dst: Uint8Array, width: number, r: ShadowRect, data: Uint8Array) {
	const w = r.x1 - r.x0 + 1
	for (let z = r.z0; z <= r.z1; z++) dst.set(data.subarray((z - r.z0) * w, (z - r.z0 + 1) * w), z * width + r.x0)
}
