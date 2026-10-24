// Editing a cube world (#31): a set of cube changes that keeps each cube's state before and after, so
// it can be undone and redone as one History step, and the chunks whose meshes the change touches.
// The world's rules hold here: nothing changes outside the world or in the metal layers, which no
// player may reach (the root docs/DESIGN.md, Hard rules). Pure data, with no three.js, so it runs in the unit tests.

import { CHUNK_SIZE, LAYER_COUNT, normalize, normalizeBlend, normalizePaint, type Cube, type CubeWorld, type Paint } from './world'
import type { CubeAt } from './pick'

/** The first of the metal layers (26 to 30), which are never built in (crates/world/src/layer.rs, the metal theme is unreachable). */
export const FIRST_METAL_LAYER = 26

/** The most cubes one box fill changes, so one undo step stays small. */
export const MAX_BOX_CUBES = 64 * 64 * 16

/** Why a cube cannot be edited, or '' when it can. */
export function editBlock(world: CubeWorld, x: number, z: number, layer: number): string {
	if (!(layer >= 0 && layer < LAYER_COUNT) || !world.contains(x, z, layer)) return 'outside the world'
	if (layer >= FIRST_METAL_LAYER) return `in the metal layers (${FIRST_METAL_LAYER} to ${LAYER_COUNT - 1}), which are never built in`
	return ''
}

const pack = (c: Cube) => c.kind | (c.shape << 8) | (c.rotation << 16)

/** A cube, its paint and its blend (world.ts paintOf and blendOf, packed) and its overlay (#226), as a step keeps them. */
interface CubeState {
	cube: number
	paint: Paint
	blend: number
	overlay: number
}

/**
 * Cube changes made to a world: `set` changes a cube (and its paint and blend) now and remembers what it
 * was, `undo` and `redo` put the cubes back and again, paint and blend with them, so undoing an erase
 * brings back the emptied cube's paint and blend. Each returns the chunks to rebuild (CubeWorld.chunkKey), the changed cubes'
 * own and the neighbours' whose faces against them may change.
 */
export class CubeChanges {
	/** The cube's index (layer, z, x) to its state before and after. */
	private readonly before = new Map<number, CubeState>()
	private readonly after = new Map<number, CubeState>()

	constructor(readonly world: CubeWorld) {}

	/** How many cubes changed. */
	get size() {
		return this.after.size
	}

	/** About how many bytes the step holds, for the history's budget. */
	get bytes() {
		return this.after.size * 64
	}

	/**
	 * Sets a cube, normalized, its paint and its blend (packed, world.ts paintOf and blendOf; left out, the
	 * cube keeps what it has, as CubeWorld.set does). Returns false when it is not editable (editBlock) or already so.
	 */
	set(x: number, z: number, layer: number, kind: number, shape = 0, rotation = 0, paint?: Paint, blend?: number, overlay?: number): boolean {
		const w = this.world
		if (editBlock(w, x, z, layer)) return false
		const now = w.get(x, z, layer)
		const nowPaint = w.paintOf(x, z, layer)
		const next = normalize(kind, shape, rotation)
		const nextPaint = normalizePaint(next.kind, paint ?? nowPaint)
		const nowBlend = w.blendOf(x, z, layer)
		const nextBlend = normalizeBlend(next.kind, blend ?? nowBlend)
		const nowOverlay = w.overlayAt(x, z, layer)
		const nextOverlay = next.kind ? (overlay ?? nowOverlay) : 0
		if (pack(now) === pack(next) && nowPaint === nextPaint && nowBlend === nextBlend && nowOverlay === nextOverlay) return false
		const i = (layer * w.sizeZ + z) * w.sizeX + x
		if (!this.before.has(i)) this.before.set(i, { cube: pack(now), paint: nowPaint, blend: nowBlend, overlay: nowOverlay })
		this.after.set(i, { cube: pack(next), paint: nextPaint, blend: nextBlend, overlay: nextOverlay })
		w.set(x, z, layer, next.kind, next.shape, next.rotation)
		w.setPaint(x, z, layer, nextPaint)
		w.setBlend(x, z, layer, nextBlend)
		w.setOverlay(x, z, layer, nextOverlay)
		return true
	}

	/** Paints the cube at (x, z, layer) with `paint` (packed), keeping the cube. Returns false when it is not editable, empty or already so. */
	paint(x: number, z: number, layer: number, paint: Paint): boolean {
		const c = this.world.get(x, z, layer)
		return c.kind !== 0 && this.set(x, z, layer, c.kind, c.shape, c.rotation, paint)
	}

	/** Puts `overlay` over the top of the cube at (x, z, layer) (#226; 0 takes it off), keeping the cube. Returns false when it is not editable, empty or already so. */
	overlay(x: number, z: number, layer: number, overlay: number): boolean {
		const c = this.world.get(x, z, layer)
		return c.kind !== 0 && this.set(x, z, layer, c.kind, c.shape, c.rotation, undefined, undefined, overlay)
	}

	/** Sets which edges of the cube's faces blend (#84; packed, world.ts blendOf), keeping the cube and its paint. Returns false when it is not editable, empty or already so. */
	blend(x: number, z: number, layer: number, blend: number): boolean {
		const c = this.world.get(x, z, layer)
		return c.kind !== 0 && this.set(x, z, layer, c.kind, c.shape, c.rotation, undefined, blend)
	}

	/** The cubes changed, as places. */
	cells(): Array<{ x: number; z: number; layer: number }> {
		return [...this.after.keys()].map((i) => {
			const [x, z, layer] = this.unindex(i)
			return { x, z, layer }
		})
	}

	/** Puts every changed cube back as it was. */
	undo(): Set<number> {
		return this.write(this.before)
	}

	/** Changes every cube again. */
	redo(): Set<number> {
		return this.write(this.after)
	}

	/** The chunks the changes touch. */
	dirty(): Set<number> {
		const out = new Set<number>()
		for (const i of this.after.keys()) this.touch(out, i)
		return out
	}

	private write(states: Map<number, CubeState>): Set<number> {
		const out = new Set<number>()
		for (const [i, { cube: c, paint, blend, overlay }] of states) {
			const [x, z, layer] = this.unindex(i)
			this.world.set(x, z, layer, c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff)
			this.world.setPaint(x, z, layer, paint)
			this.world.setBlend(x, z, layer, blend)
			this.world.setOverlay(x, z, layer, overlay)
			this.touch(out, i)
		}
		return out
	}

	private unindex(i: number): [number, number, number] {
		const w = this.world
		return [i % w.sizeX, Math.floor(i / w.sizeX) % w.sizeZ, Math.floor(i / (w.sizeX * w.sizeZ))]
	}

	/** Adds the chunks around cube `i`. */
	private touch(out: Set<number>, i: number) {
		const [x, z, layer] = this.unindex(i)
		chunksAround(this.world, x, z, layer, out)
	}
}

/**
 * The chunks whose meshes a change of cube (x, z, layer) may change: its own, and its neighbours'
 * across chunk edges and in the layers above and below. Added to `out`, which is returned.
 */
export function chunksAround(w: CubeWorld, x: number, z: number, layer: number, out = new Set<number>()): Set<number> {
	const cx = Math.floor(x / CHUNK_SIZE)
	const cz = Math.floor(z / CHUNK_SIZE)
	const add = (ax: number, az: number, al: number) => w.hasChunk(ax, az, al) && out.add(w.chunkKey(ax, az, al))
	add(cx, cz, layer)
	add(cx, cz, layer - 1)
	add(cx, cz, layer + 1)
	if (x % CHUNK_SIZE === 0) add(cx - 1, cz, layer)
	if (x % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx + 1, cz, layer)
	if (z % CHUNK_SIZE === 0) add(cx, cz - 1, layer)
	if (z % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx, cz + 1, layer)
	return out
}

/**
 * The chunks a change of paint on cube (x, z, layer) redraws: its own, and those around it (chunksAround)
 * where something blends (#84), since a neighbour's blended edge shows the texture this cube's face shows.
 */
export function paintChunks(w: CubeWorld, x: number, z: number, layer: number): Set<number> {
	const own = w.chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), layer)
	const out = new Set<number>([own])
	if (!w.blend.size) return out
	for (const key of chunksAround(w, x, z, layer)) if (w.blend.has(key)) out.add(key)
	return out
}

/** The box of cubes between two corners, inclusive, raised by `extra` layers above the higher corner. */
export function boxOf(a: CubeAt, b: CubeAt, extra = 0) {
	return {
		x0: Math.min(a.x, b.x),
		x1: Math.max(a.x, b.x),
		z0: Math.min(a.z, b.z),
		z1: Math.max(a.z, b.z),
		top: Math.max(0, Math.min(a.layer, b.layer) - Math.max(0, extra)),
		bottom: Math.max(a.layer, b.layer),
	}
}

/** How many cubes a box holds. */
export const boxSize = (b: ReturnType<typeof boxOf>) => (b.x1 - b.x0 + 1) * (b.z1 - b.z0 + 1) * (b.bottom - b.top + 1)

/** Sets every cube of a box to one cube (kind 0 empties it). Returns how many changed. */
export function fillBox(changes: CubeChanges, box: ReturnType<typeof boxOf>, kind: number, shape = 0, rotation = 0): number {
	let n = 0
	for (let layer = box.top; layer <= box.bottom; layer++) {
		for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) if (changes.set(x, z, layer, kind, shape, rotation)) n++
	}
	return n
}
