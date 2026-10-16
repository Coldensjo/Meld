// The baked shadows an area copy carries (see clipboard.ts, #162): the shadow texels under the area,
// SHADOW_PER_CELL a cell. Kept apart from the clipboard module, which pulls in the terrain stroke, so
// it can be tested on its own under node.
import type { Rect } from '../tools/brush'
import type { ShadowRect } from '../terrain/bakedShadows'
import { SHADOW_PER_CELL } from '../terrain/bakedShadows'

/** The part of a terrain the shadows are read from and written to. */
export interface ShadowTerrain {
	size: number
	shadow: Uint8Array | null
	shadowSide: number
	ensureShadow(): Uint8Array
}

/** Where a paste's shadow texels are saved for undo and reported (a ShadowStroke). */
export interface ShadowWriter {
	reserve(r: ShadowRect): void
	touch(r: ShadowRect): void
}

/**
 * The shadow texels under the cell rect (inclusive vertex corners), w*8 by h*8; undefined when the
 * map has no shadows of its own, so a paste leaves the target's alone.
 */
export function copyShadows(terrain: ShadowTerrain, r: Rect): Uint8Array | undefined {
	const src = terrain.shadow
	if (!src) return undefined
	const n = SHADOW_PER_CELL
	const tw = (r.x1 - r.x0) * n
	const th = (r.z1 - r.z0) * n
	const out = new Uint8Array(tw * th)
	const side = terrain.shadowSide
	for (let z = 0; z < th; z++) out.set(src.subarray((r.z0 * n + z) * side + r.x0 * n, (r.z0 * n + z) * side + r.x0 * n + tw), z * tw)
	return out
}

/**
 * Lays `shadows` (a w by h cell clip's, as copyShadows gives them) onto the paste at cell (px, pz),
 * clipped to the map, through `writer`. A map without shadows of its own gets them, lit elsewhere.
 */
export function pasteShadows(terrain: ShadowTerrain, shadows: Uint8Array, w: number, h: number, px: number, pz: number, writer: ShadowWriter) {
	const n = SHADOW_PER_CELL
	const side = terrain.shadowSide
	const tw = w * n
	const r = {
		x0: Math.max(0, px * n),
		z0: Math.max(0, pz * n),
		x1: Math.min(side - 1, (px + w) * n - 1),
		z1: Math.min(side - 1, (pz + h) * n - 1),
	}
	if (r.x1 < r.x0 || r.z1 < r.z0) return
	writer.reserve(r)
	const dst = terrain.ensureShadow()
	for (let z = r.z0; z <= r.z1; z++) {
		const from = (z - pz * n) * tw + (r.x0 - px * n)
		dst.set(shadows.subarray(from, from + r.x1 - r.x0 + 1), z * side + r.x0)
	}
	writer.touch(r)
}

/** A w by h cell clip's shadows turned a quarter turn clockwise, as rotateClip turns its cells. */
export function rotateShadows(shadows: Uint8Array, w: number, h: number): Uint8Array {
	const n = SHADOW_PER_CELL
	const tw = w * n
	const th = h * n
	const out = new Uint8Array(shadows.length)
	for (let z = 0; z < th; z++) for (let x = 0; x < tw; x++) out[(tw - 1 - x) * th + z] = shadows[z * tw + x]
	return out
}

/** A w by h cell clip's shadows mirrored across its middle, as mirrorClip flips its cells. */
export function mirrorShadows(shadows: Uint8Array, w: number, h: number, axis: 'x' | 'z'): Uint8Array {
	const n = SHADOW_PER_CELL
	const tw = w * n
	const th = h * n
	const out = new Uint8Array(shadows.length)
	for (let z = 0; z < th; z++) {
		for (let x = 0; x < tw; x++) out[(axis === 'x' ? z : th - 1 - z) * tw + (axis === 'x' ? tw - 1 - x : x)] = shadows[z * tw + x]
	}
	return out
}
