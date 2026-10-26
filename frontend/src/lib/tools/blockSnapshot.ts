// A copy-on-write snapshot of a 2D array, saved block by block, for recording what a stroke changes.
// Only the blocks a stroke is about to write are copied, so starting a stroke on a large map no longer
// copies the whole weights array (268 MB for a 16-tile region). Kept free of three.js and the terrain
// class so it can be tested on its own.

/** An inclusive rect of cells (vertices or texels). */
export interface SnapRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

type Grid = Float32Array | Uint8Array

/**
 * Snapshots `src`, a row-major `width` by `height` grid with `channels` values per cell, in square blocks
 * of `block` cells. `reserve` copies the blocks under a rect before they are written; `extract` then
 * reads what a rect held, from the copies where there are any and from `src` elsewhere, which is the
 * same thing for blocks nothing wrote.
 */
export class BlockSnapshot<T extends Grid> {
	private blocks = new Map<number, T>()
	private readonly src: T
	readonly width: number
	readonly height: number
	readonly channels: number
	readonly block: number
	/** Blocks across the grid. */
	private readonly cols: number

	constructor(src: T, width: number, height: number, channels: number, block: number) {
		this.src = src
		this.width = width
		this.height = height
		this.channels = channels
		this.block = block
		this.cols = Math.ceil(width / block)
	}

	/** How many blocks are saved. */
	get size() {
		return this.blocks.size
	}

	private clip(r: SnapRect): SnapRect | null {
		const c = { x0: Math.max(0, r.x0), z0: Math.max(0, r.z0), x1: Math.min(this.width - 1, r.x1), z1: Math.min(this.height - 1, r.z1) }
		return c.x1 < c.x0 || c.z1 < c.z0 ? null : c
	}

	/** Saves the blocks under `rect` that are not saved yet. Call it before writing them. */
	reserve(rect: SnapRect) {
		const r = this.clip(rect)
		if (!r) return
		const b = this.block
		for (let bz = Math.floor(r.z0 / b); bz <= Math.floor(r.z1 / b); bz++) {
			for (let bx = Math.floor(r.x0 / b); bx <= Math.floor(r.x1 / b); bx++) {
				const key = bz * this.cols + bx
				if (!this.blocks.has(key)) this.blocks.set(key, this.copyBlock(bx, bz))
			}
		}
	}

	/** Whether every block under `rect` is saved. */
	covers(rect: SnapRect): boolean {
		const r = this.clip(rect)
		if (!r) return true
		const b = this.block
		for (let bz = Math.floor(r.z0 / b); bz <= Math.floor(r.z1 / b); bz++) {
			for (let bx = Math.floor(r.x0 / b); bx <= Math.floor(r.x1 / b); bx++) {
				if (!this.blocks.has(bz * this.cols + bx)) return false
			}
		}
		return true
	}

	private copyBlock(bx: number, bz: number): T {
		const b = this.block
		const w = Math.min(b, this.width - bx * b)
		const h = Math.min(b, this.height - bz * b)
		const ch = this.channels
		const out = new (this.src.constructor as new (n: number) => T)(w * h * ch)
		for (let z = 0; z < h; z++) {
			const s = ((bz * b + z) * this.width + bx * b) * ch
			out.set(this.src.subarray(s, s + w * ch) as T, z * w * ch)
		}
		return out
	}

	/**
	 * The values `rect` (clipped to the grid) held when its blocks were saved: row-major over the clipped
	 * rect, `channels` per cell. Blocks never saved are read from the live array.
	 */
	extract(rect: SnapRect): T {
		const r = this.clip(rect)
		const ch = this.channels
		if (!r) return new (this.src.constructor as new (n: number) => T)(0)
		const w = r.x1 - r.x0 + 1
		const h = r.z1 - r.z0 + 1
		const out = new (this.src.constructor as new (n: number) => T)(w * h * ch)
		const b = this.block
		const bx0 = Math.floor(r.x0 / b)
		const bx1 = Math.floor(r.x1 / b)
		for (let z = r.z0; z <= r.z1; z++) {
			const bz = Math.floor(z / b)
			const dstRow = (z - r.z0) * w * ch
			for (let bx = bx0; bx <= bx1; bx++) {
				const xs = Math.max(r.x0, bx * b)
				const bw = Math.min(b, this.width - bx * b)
				const xe = Math.min(r.x1, bx * b + bw - 1)
				const n = (xe - xs + 1) * ch
				const saved = this.blocks.get(bz * this.cols + bx)
				let seg: T
				if (saved) {
					const s = ((z - bz * b) * bw + (xs - bx * b)) * ch
					seg = saved.subarray(s, s + n) as T
				} else {
					const s = (z * this.width + xs) * ch
					seg = this.src.subarray(s, s + n) as T
				}
				out.set(seg, dstRow + (xs - r.x0) * ch)
			}
		}
		return out
	}

	/**
	 * What changed under `rect` since its blocks were saved, as a patch that holds only the changed part
	 * of each saved block (the bounding rect of the cells that differ in it), before and after. Blocks
	 * never saved were never written, so they hold nothing to undo. A whole-mask step that changes a
	 * small area keeps that area and not two copies of the mask (#444).
	 */
	diff(rect: SnapRect): GridPatch<T> {
		const patch = new GridPatch<T>(this.width, this.channels)
		const r = this.clip(rect)
		if (!r) return patch
		const b = this.block
		const ch = this.channels
		const W = this.width
		const src = this.src
		const make = this.src.constructor as new (n: number) => T
		for (const [key, saved] of this.blocks) {
			const bx = key % this.cols
			const bz = (key - bx) / this.cols
			const bw = Math.min(b, W - bx * b)
			const x0 = Math.max(r.x0, bx * b)
			const z0 = Math.max(r.z0, bz * b)
			const x1 = Math.min(r.x1, bx * b + bw - 1)
			const z1 = Math.min(r.z1, bz * b + Math.min(b, this.height - bz * b) - 1)
			if (x1 < x0 || z1 < z0) continue
			// The bounding rect of the cells that differ, in grid cells.
			let cx0 = x1 + 1
			let cz0 = z1 + 1
			let cx1 = -1
			let cz1 = -1
			for (let z = z0; z <= z1; z++) {
				const sRow = (z - bz * b) * bw
				for (let x = x0; x <= x1; x++) {
					const s = (sRow + x - bx * b) * ch
					const g = (z * W + x) * ch
					let same = true
					for (let k = 0; k < ch; k++) {
						if (saved[s + k] !== src[g + k]) {
							same = false
							break
						}
					}
					if (same) continue
					if (x < cx0) cx0 = x
					if (x > cx1) cx1 = x
					if (z < cz0) cz0 = z
					if (z > cz1) cz1 = z
				}
			}
			if (cx1 < 0) continue
			const w = cx1 - cx0 + 1
			const h = cz1 - cz0 + 1
			const before = new make(w * h * ch)
			const after = new make(w * h * ch)
			for (let z = cz0; z <= cz1; z++) {
				const s = ((z - bz * b) * bw + cx0 - bx * b) * ch
				const g = (z * W + cx0) * ch
				before.set(saved.subarray(s, s + w * ch) as T, (z - cz0) * w * ch)
				after.set(src.subarray(g, g + w * ch) as T, (z - cz0) * w * ch)
			}
			patch.add({ x0: cx0, z0: cz0, x1: cx1, z1: cz1 }, before, after)
		}
		return patch
	}

	/**
	 * Puts back, in the live array, the saved values of the cells under `rect` for which `off(x, z)` is true.
	 * Blocks never saved were never written. Call it before diff, so those cells count as unchanged.
	 */
	restore(rect: SnapRect, off: (x: number, z: number) => boolean) {
		const r = this.clip(rect)
		if (!r) return
		const b = this.block
		const ch = this.channels
		const W = this.width
		for (const [key, saved] of this.blocks) {
			const bx = key % this.cols
			const bz = (key - bx) / this.cols
			const bw = Math.min(b, W - bx * b)
			const x0 = Math.max(r.x0, bx * b)
			const z0 = Math.max(r.z0, bz * b)
			const x1 = Math.min(r.x1, bx * b + bw - 1)
			const z1 = Math.min(r.z1, bz * b + Math.min(b, this.height - bz * b) - 1)
			for (let z = z0; z <= z1; z++) {
				for (let x = x0; x <= x1; x++) {
					if (!off(x, z)) continue
					const s = ((z - bz * b) * bw + x - bx * b) * ch
					const g = (z * W + x) * ch
					for (let k = 0; k < ch; k++) this.src[g + k] = saved[s + k]
				}
			}
		}
	}

	/** Drops the saved blocks. */
	clear() {
		this.blocks.clear()
	}
}

/** One changed rect of a patch, row-major, `channels` values per cell, before and after. */
interface PatchPiece<T extends Grid> {
	rect: SnapRect
	before: T
	after: T
}

/**
 * The changed rects of a grid (BlockSnapshot.diff), each before and after, for an undo step that keeps
 * only what changed. `apply` writes them into the grid passed at call time, so an undo reads the
 * document's live array and not one captured when the step was made.
 */
export class GridPatch<T extends Grid> {
	private pieces: PatchPiece<T>[] = []
	/** The grid's cells a row and values a cell. */
	readonly width: number
	readonly channels: number
	/** The bytes the patch holds. */
	bytes = 0
	/** The bounding rect of every changed cell, or null when nothing changed. */
	rect: SnapRect | null = null

	constructor(width: number, channels: number) {
		this.width = width
		this.channels = channels
	}

	/** How many changed rects it holds. */
	get size() {
		return this.pieces.length
	}

	add(rect: SnapRect, before: T, after: T) {
		this.pieces.push({ rect, before, after })
		this.bytes += before.byteLength + after.byteLength
		const u = this.rect
		this.rect = u ? { x0: Math.min(u.x0, rect.x0), z0: Math.min(u.z0, rect.z0), x1: Math.max(u.x1, rect.x1), z1: Math.max(u.z1, rect.z1) } : { ...rect }
	}

	/** Writes the before (`before` true) or after values into `dst`, a grid of the patch's width and channels. */
	apply(dst: T, before: boolean) {
		const ch = this.channels
		for (const p of this.pieces) {
			const r = p.rect
			const w = (r.x1 - r.x0 + 1) * ch
			const data = before ? p.before : p.after
			for (let z = r.z0; z <= r.z1; z++) dst.set(data.subarray((z - r.z0) * w, (z - r.z0 + 1) * w) as T, (z * this.width + r.x0) * ch)
		}
	}
}
