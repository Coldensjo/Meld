import type { Terrain } from '../terrain/Terrain'
import { CHUNK_CELLS, SLOTS, SPLAT_PER_CELL, acquireSlotCompacting, addWeight, chunkOf, compactChunk } from '../terrain/chunkPaint'
import type { Command } from '../state/history'
import { BlockSnapshot } from './blockSnapshot'

export interface Rect {
	x0: number
	z0: number
	x1: number
	z1: number
}

export { brushShape, brushWeight, FALLOFF_CURVES, type FalloffCurve } from './falloff'
import { brushShape, brushWeight } from './falloff'
import { brushImage, imageWeight } from './brushImage'

/** Normalised brush distance: circle (euclidean) or square (chebyshev). */
export function brushDist(dx: number, dz: number, radius: number) {
	return (brushShape.square ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.sqrt(dx * dx + dz * dz)) / radius
}

/**
 * Brush centre, optionally snapped so a square brush's edges sit on cell
 * lines (for tile-aligned square painting).
 */
export function brushCenter(x: number, z: number, radius: number, cellSize: number, snap: boolean): [number, number] {
	if (!snap) return [x, z]
	const s = (v: number) => Math.round((v - radius) / cellSize) * cellSize + radius
	return [s(x), s(z)]
}

/**
 * Iterate heightmap vertices under a circular brush (shaped by the brush image while one is active,
 * see brushImage.ts). Returns touched rect. A `stroke` that records
 * heights saves the rect's blocks first, so what `fn` writes can be undone.
 */
export function forEachVertex(terrain: Terrain, cx: number, cz: number, radius: number, falloff: number, fn: (index: number, w: number, x: number, z: number) => void, stroke?: TerrainStroke | null): Rect | null {
	const cs = terrain.cellSize
	const x0 = Math.max(0, Math.floor((cx - radius) / cs))
	const z0 = Math.max(0, Math.floor((cz - radius) / cs))
	const x1 = Math.min(terrain.size, Math.ceil((cx + radius) / cs))
	const z1 = Math.min(terrain.size, Math.ceil((cz + radius) / cs))
	if (x1 < x0 || z1 < z0) return null
	stroke?.reserveHeights({ x0, z0, x1, z1 })
	const V = terrain.verts
	for (let z = z0; z <= z1; z++) {
		for (let x = x0; x <= x1; x++) {
			const dx = x * cs - cx
			const dz = z * cs - cz
			let w = brushWeight(brushDist(dx, dz, radius), falloff)
			if (w > 0 && brushImage.active) w *= imageWeight(dx, dz, radius)
			if (w > 0) fn(z * V + x, w, x, z)
		}
	}
	return { x0, z0, x1, z1 }
}

/**
 * Iterate splat texels under a circular brush. Returns touched texel rect. A `stroke` that records the
 * paint or the mask saves the rect's chunks first, so what `fn` writes can be undone.
 */
export function forEachTexel(terrain: Terrain, cx: number, cz: number, radius: number, falloff: number, fn: (pixel: number, w: number) => void, stroke?: TerrainStroke | null): Rect | null {
	const R = terrain.splatRes
	const ts = terrain.worldSize / R
	const x0 = Math.max(0, Math.floor((cx - radius) / ts))
	const z0 = Math.max(0, Math.floor((cz - radius) / ts))
	const x1 = Math.min(R - 1, Math.ceil((cx + radius) / ts))
	const z1 = Math.min(R - 1, Math.ceil((cz + radius) / ts))
	if (x1 < x0 || z1 < z0) return null
	stroke?.reserveTexels({ x0, z0, x1, z1 })
	for (let z = z0; z <= z1; z++) {
		for (let x = x0; x <= x1; x++) {
			const dx = (x + 0.5) * ts - cx
			const dz = (z + 0.5) * ts - cz
			let w = brushWeight(brushDist(dx, dz, radius), falloff)
			if (w > 0 && brushImage.active) w *= imageWeight(dx, dz, radius)
			if (w > 0) fn(z * R + x, w)
		}
	}
	return { x0, z0, x1, z1 }
}

/** Splat texels along one side of a paint chunk. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

/**
 * Adds `amount` (0 to 1) of palette texture `tex` to a splat texel, in the paint chunk that holds
 * it. A chunk already holding SLOTS other textures (the 1.12 limit) refuses it (returns false), so
 * the stroke can tell the user; replacing one of them is the Layers panel's Replace or Swap mode.
 */
export function paintPixel(terrain: Terrain, pixel: number, tex: number, amount: number): boolean {
	const R = terrain.splatRes
	const x = pixel % R
	const z = Math.floor(pixel / R)
	const c = chunkOf(Math.floor(x / TEXELS_PER_CHUNK), Math.floor(z / TEXELS_PER_CHUNK), terrain.paintChunksPerSide)
	const k = acquireSlotCompacting(terrain.paintChunksPerSide, R, terrain.chunkSlots, terrain.weights, c, tex)
	if (k < 0) return false
	addWeight(terrain.weights, pixel * SLOTS, k, amount)
	return true
}

function grow(r: Rect | null, add: Rect | null): Rect | null {
	if (!add) return r
	if (!r) return { ...add }
	r.x0 = Math.min(r.x0, add.x0)
	r.z0 = Math.min(r.z0, add.z0)
	r.x1 = Math.max(r.x1, add.x1)
	r.z1 = Math.max(r.z1, add.z1)
	return r
}

/** Cells a side of the blocks a stroke saves: the splat's paint chunk, so a chunk's slots are saved whole. */
const SNAPSHOT_BLOCK = TEXELS_PER_CHUNK

/**
 * Records a brush stroke for undo. Before a layer is written, `reserve*` saves the blocks under the
 * rect about to change (the brush iterators do this for a stroke they are given); `touch*` grows the
 * stroke's dirty rect after the write; and `finish` keeps, before and after, only the cells under that
 * rect that differ, block by block (BlockSnapshot.diff), and says in the step's `bytes` how much it holds.
 */
export class TerrainStroke {
	private hBefore: BlockSnapshot<Float32Array> | null = null
	private wBefore: BlockSnapshot<Uint8Array> | null = null
	private slotsBefore: Uint8Array | null = null
	private mBefore: BlockSnapshot<Uint8Array> | null = null
	private holesBefore: BlockSnapshot<Uint8Array> | null = null
	private hRect: Rect | null = null
	private sRect: Rect | null = null
	private mRect: Rect | null = null
	private holesRect: Rect | null = null
	/** Whether `finish` frees the slots the stroke's chunks no longer use (`settleSlots`). */
	private settle: boolean

	/**
	 * `settle: false` keeps a chunk's empty texture layers: a script's `chunk:add_texture` adds a layer
	 * with no weight yet, for a later stroke to paint (#760).
	 */
	constructor(
		private terrain: Terrain,
		private label: string,
		opts: { heights?: boolean; splat?: boolean; mask?: boolean; holes?: boolean; settle?: boolean },
		private onHeightsChanged?: (r: Rect) => void,
	) {
		this.settle = opts.settle ?? true
		const R = terrain.splatRes
		if (opts.heights) this.hBefore = new BlockSnapshot(terrain.heights, terrain.verts, terrain.verts, 1, SNAPSHOT_BLOCK)
		if (opts.splat) {
			this.wBefore = new BlockSnapshot(terrain.weights, R, R, SLOTS, SNAPSHOT_BLOCK)
			this.slotsBefore = terrain.chunkSlots.slice()
		}
		if (opts.mask) this.mBefore = new BlockSnapshot(terrain.mask, R, R, 1, SNAPSHOT_BLOCK)
		if (opts.holes) this.holesBefore = new BlockSnapshot(terrain.holes, terrain.size, terrain.size, 1, SNAPSHOT_BLOCK)
	}

	/** Saves the heights (vertex rect, inclusive) about to be written. */
	reserveHeights(r: Rect | null) {
		if (r) this.hBefore?.reserve(r)
	}

	/** Saves the paint (texel rect, inclusive) about to be written. */
	reserveSplat(r: Rect | null) {
		if (r) this.wBefore?.reserve(r)
	}

	/** Saves the mask (texel rect, inclusive) about to be written. */
	reserveMask(r: Rect | null) {
		if (r) this.mBefore?.reserve(r)
	}

	/** Saves the holes (cell rect, inclusive) about to be written. */
	reserveHoles(r: Rect | null) {
		if (r) this.holesBefore?.reserve(r)
	}

	/** Saves whichever of the paint and the mask the stroke records, under a texel rect about to be written. */
	reserveTexels(r: Rect | null) {
		this.reserveSplat(r)
		this.reserveMask(r)
	}

	/**
	 * A write that reached blocks that were not saved first can't be undone there. It's a bug in the
	 * caller; the blocks are saved now (too late) so the rest of the stroke still records.
	 */
	private late(snap: BlockSnapshot<Float32Array> | BlockSnapshot<Uint8Array> | null, r: Rect | null, what: string) {
		if (!snap || !r || snap.covers(r)) return
		console.warn(`TerrainStroke: ${what} written before they were reserved; undo will not restore them`)
		snap.reserve(r)
	}

	/** A cell rect (inclusive cells) whose holes changed. */
	touchHoles(r: Rect | null) {
		this.late(this.holesBefore, r, 'holes')
		this.holesRect = grow(this.holesRect, r)
		this.terrain.touchHoles(r)
	}

	touchMask(r: Rect | null) {
		this.late(this.mBefore, r, 'mask texels')
		this.mRect = grow(this.mRect, r)
	}

	touchHeights(r: Rect | null) {
		this.late(this.hBefore, r, 'heights')
		this.hRect = grow(this.hRect, r)
	}

	touchSplat(r: Rect | null) {
		this.late(this.wBefore, r, 'paint texels')
		this.sRect = grow(this.sRect, r)
	}

	/**
	 * Frees the texture slots that the stroke's chunks no longer use, so a chunk whose texture was painted
	 * away can take a new one. A chunk is reordered as a whole, so the splat rect grows to cover it and
	 * undo restores all of it.
	 */
	private settleSlots() {
		const t = this.terrain
		const r = this.sRect
		if (!r) return
		const side = t.paintChunksPerSide
		const per = t.splatRes / side
		let changed = false
		for (let cz = Math.floor(r.z0 / per); cz <= Math.floor(r.z1 / per); cz++) {
			for (let cx = Math.floor(r.x0 / per); cx <= Math.floor(r.x1 / per); cx++) {
				// Painting can free or reassign slots anywhere in a chunk, so undo covers each chunk whole.
				if (compactChunk(side, t.splatRes, t.chunkSlots, t.weights, cz * side + cx)) changed = true
				grow(r, { x0: cx * per, z0: cz * per, x1: cx * per + per - 1, z1: cz * per + per - 1 })
			}
		}
		if (changed) t.markSplatDirty(r)
	}

	finish(): Command | null {
		const t = this.terrain
		const parts: Array<{ apply: (before: boolean) => void }> = []
		// Each layer keeps only the cells that differ, block by block (#444): a whole-mask step that
		// changes a corner of the mask keeps that corner, not two copies of the mask.
		let bytes = 0
		// A tile the map leaves out of its square keeps its ground (#737): put back what the stroke wrote there
		// (a vertex shared with a present tile stays), so the diff holds nothing of it and undo keeps to the stroke.
		if (t.tileMask) {
			if (this.hBefore && this.hRect) this.hBefore.restore(this.hRect, (x, z) => t.vertexOff(x, z))
			if (this.wBefore && this.sRect) this.wBefore.restore(this.sRect, (x, z) => t.texelOff(x, z))
			if (this.slotsBefore) {
				const side = t.paintChunksPerSide
				const per = t.size / side
				for (let c = 0; c < side * side; c++) {
					if (!t.tileOff(((c % side) * per) | 0, Math.floor(c / side) * per)) continue
					for (let k = 0; k < SLOTS; k++) t.chunkSlots[c * SLOTS + k] = this.slotsBefore[c * SLOTS + k]
				}
			}
			if (this.wBefore && this.sRect) t.markSplatDirty(this.sRect)
			if (this.mBefore && this.mRect) this.mBefore.restore(this.mRect, (x, z) => t.texelOff(x, z))
			if (this.holesBefore && this.holesRect) this.holesBefore.restore(this.holesRect, (x, z) => t.tileOff(x, z))
		}
		if (this.hBefore && this.hRect) {
			const r = this.hRect
			const patch = this.hBefore.diff(r)
			bytes += patch.bytes
			const cb = this.onHeightsChanged
			parts.push({
				apply: (b) => {
					patch.apply(t.heights, b)
					t.markDirty(r.x0, r.z0, r.x1, r.z1)
					cb?.(r)
				},
			})
		}
		if (this.wBefore && this.slotsBefore) {
			if (this.settle) this.settleSlots()
			const slotsChanged = t.chunkSlots.some((v, i) => v !== this.slotsBefore![i])
			const slotsBefore = slotsChanged ? this.slotsBefore : null
			const slotsAfter = slotsChanged ? t.chunkSlots.slice() : null
			const r = this.sRect
			const patch = r ? this.wBefore.diff(r) : null
			bytes += (patch?.bytes ?? 0) + (slotsChanged ? slotsBefore!.byteLength * 2 : 0)
			if (r || slotsChanged) {
				parts.push({
					apply: (b) => {
						patch?.apply(t.weights, b)
						if (slotsBefore && slotsAfter) t.chunkSlots.set(b ? slotsBefore : slotsAfter)
						t.markSplatDirty(r)
					},
				})
			}
		}
		if (this.mBefore && this.mRect) {
			const patch = this.mBefore.diff(this.mRect)
			bytes += patch.bytes
			parts.push({
				apply: (b) => {
					patch.apply(t.mask, b)
					if (patch.rect) t.markMaskDirty(patch.rect)
				},
			})
		}
		if (this.holesBefore && this.holesRect) {
			const r = this.holesRect
			const patch = this.holesBefore.diff(r)
			bytes += patch.bytes
			parts.push({
				apply: (b) => {
					patch.apply(t.holes, b)
					t.touchHoles(r)
					// The chunk rebuild runs off vertices; a cell's far corner is one past it.
					t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
				},
			})
		}
		this.hBefore = this.wBefore = this.slotsBefore = this.mBefore = this.holesBefore = null
		if (!parts.length) return null
		return {
			label: this.label,
			bytes,
			undo: () => parts.forEach((p) => p.apply(true)),
			redo: () => parts.forEach((p) => p.apply(false)),
		}
	}
}
