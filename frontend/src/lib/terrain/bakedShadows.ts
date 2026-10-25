// The client's baked terrain shadows (each chunk's MCSH, B-173): a bit per texel, 64 texels a chunk
// (8 a cell), rows running south, bit n of a byte the texel n columns into it, as Go stitches them for a
// region (vmangos.RegionShadows). The client darkens shadowed ground to 70% of its light (Benilla's
// terrain.wgsl, after the client's terrainp_s.bls: diffuse x (0.3 x lit + 0.7)).
import { CHUNK_SHADOW_BYTES } from '../wow/format'

import { heightAt } from './heightField'

/** How much of its light a shadowed texel keeps. */
export const BAKED_SHADOW_LIGHT = 0.7

/** Unpacks the bits into a byte per texel (255 in shadow, 0 lit), `side` texels a side, for an R8 texture. */
export function unpackShadowBits(bits: Uint8Array, side: number): Uint8Array {
	const out = new Uint8Array(side * side)
	for (let i = 0; i < out.length; i++) if ((bits[i >> 3] >> (i & 7)) & 1) out[i] = 255
	return out
}

/** Shadow texels per cell side: a chunk's 64, as MCSH has them (8 cells a chunk). */
export const SHADOW_PER_CELL = 8

/** A chunk's shadow map in the client's form: 64 rows of 8 bytes, bit n the texel n columns into its byte. */
export { CHUNK_SHADOW_BYTES }

/** Packs a byte per texel (in shadow from 128) into a bit per texel, as unpackShadowBits reads them. */
export function packShadowBits(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(Math.ceil(bytes.length / 8))
	for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 128) out[i >> 3] |= 1 << (i & 7)
	return out
}

/** The shadow map of paint chunk (cx, cz) in the client's form, from a byte per texel `side` a side. */
export function chunkShadowBits(shadow: Uint8Array, side: number, cx: number, cz: number): Uint8Array {
	const out = new Uint8Array(CHUNK_SHADOW_BYTES)
	const n = SHADOW_PER_CELL * 8
	for (let r = 0; r < n; r++) {
		const row = (cz * n + r) * side + cx * n
		for (let c = 0; c < n; c++) if (shadow[row + c] >= 128) out[r * 8 + (c >> 3)] |= 1 << (c & 7)
	}
	return out
}

/** Cells a side of the blocks the bake skips over when its ray is above their highest ground. */
export const SHADOW_BLOCK = 4
const BLOCK = SHADOW_BLOCK

/**
 * What else casts in a bake besides the ground (the placed models, world/shadowCasters.ts), sorted
 * into the bake's blocks of SHADOW_BLOCK cells, `nb` a side.
 */
export interface ShadowCasters {
	/** Raises `blockMax[k]` to the top of the casters over block k, so a ray only skips a block above them. */
	raise(blockMax: Float32Array, nb: number): void
	/**
	 * Whether the ray from (x, y, z) toward the sun (`dir`, unit length) meets a caster of block k.
	 * `ray` numbers the ray, so a caster over several blocks is tested once a ray.
	 */
	hits(k: number, ray: number, x: number, y: number, z: number, dir: readonly number[]): boolean
}

/** A rect of shadow texels, inclusive. */
export interface ShadowRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/**
 * Bakes the ground's shadows from the sun into `out` (a byte per texel, `size * SHADOW_PER_CELL` a
 * side, 255 in shadow) over the texels of `rect`: a texel is in shadow when the ground rises above the
 * line from it toward the sun. `sun` points toward the sun in editor space (y up). The ground casts,
 * and with `casters` the placed models too (#163), as Blizzard's own maps shadow under trees and
 * buildings. Returns how many texels changed.
 */
export function bakeShadows(heights: Float32Array, size: number, cellSize: number, sun: readonly number[], rect: ShadowRect, out: Uint8Array, casters?: ShadowCasters): number {
	return shadowBaker(heights, size, cellSize, sun, casters)(rect, out)
}

/**
 * bakeShadows split in two: the setup (the blocks' highest ground and casters) once, then a function
 * that bakes any rect, so a long bake can run a band of rows at a time.
 */
export function shadowBaker(heights: Float32Array, size: number, cellSize: number, sun: readonly number[], casters?: ShadowCasters): (rect: ShadowRect, out: Uint8Array) => number {
	const side = size * SHADOW_PER_CELL
	const verts = size + 1
	let top = -Infinity
	for (let i = 0; i < heights.length; i++) if (heights[i] > top) top = heights[i]
	const flat = Math.hypot(sun[0], sun[2])
	const lit = sun[1] <= 0 || flat < 1e-6
	// Along the ground toward the sun (ux, uz), rising `slope` a yard; fine steps of a quarter cell.
	const ux = lit ? 0 : sun[0] / flat
	const uz = lit ? 0 : sun[2] / flat
	const slope = lit ? 0 : sun[1] / flat
	const step = cellSize / 4
	const world = size * cellSize
	// The highest ground of each block of BLOCK cells: a ray above it skips the block in one step.
	const nb = Math.ceil(size / BLOCK)
	const blockMax = new Float32Array(nb * nb).fill(-Infinity)
	for (let vz = 0; vz < verts; vz++) {
		for (let vx = 0; vx < verts; vx++) {
			const h = heights[vz * verts + vx]
			// A vertex on a block edge bounds the blocks on both sides.
			for (let bz = Math.max(0, Math.ceil(vz / BLOCK) - 1); bz <= Math.min(nb - 1, Math.floor(vz / BLOCK)); bz++) {
				for (let bx = Math.max(0, Math.ceil(vx / BLOCK) - 1); bx <= Math.min(nb - 1, Math.floor(vx / BLOCK)); bx++) {
					const k = bz * nb + bx
					if (h > blockMax[k]) blockMax[k] = h
				}
			}
		}
	}
	const blockWorld = BLOCK * cellSize
	if (casters) {
		casters.raise(blockMax, nb)
		for (let k = 0; k < blockMax.length; k++) if (blockMax[k] > top) top = blockMax[k]
	}
	const len = Math.hypot(sun[0], sun[1], sun[2]) || 1
	const dir = [sun[0] / len, sun[1] / len, sun[2] / len]
	let ray = 0
	const height = (x: number, z: number) => heightAt(heights, size, cellSize, x, z)
	const texel = cellSize / SHADOW_PER_CELL
	return (rect, out) => {
		let changed = 0
		for (let tz = rect.z0; tz <= rect.z1; tz++) {
			for (let tx = rect.x0; tx <= rect.x1; tx++) {
				let shadow = false
				if (!lit) {
					let x = (tx + 0.5) * texel
					let z = (tz + 0.5) * texel
					// A little above the ground, so a slope doesn't shadow itself.
					let y = height(x, z) + 0.05
					const ox = x
					const oy = y
					const oz = z
					let last = -1
					ray++
					for (;;) {
						let d = step
						const bx = Math.min(nb - 1, Math.floor(x / blockWorld))
						const bz = Math.min(nb - 1, Math.floor(z / blockWorld))
						const k = bz * nb + bx
						if (casters && k !== last) {
							last = k
							// A ray entering a block above its casters stays above them: it only rises.
							if (y <= blockMax[k] && casters.hits(k, ray, ox, oy, oz, dir)) {
								shadow = true
								break
							}
						}
						if (y > blockMax[k]) {
							// Above the whole block: on to where the ray leaves it.
							const ex = ux > 0 ? ((bx + 1) * blockWorld - x) / ux : ux < 0 ? (bx * blockWorld - x) / ux : Infinity
							const ez = uz > 0 ? ((bz + 1) * blockWorld - z) / uz : uz < 0 ? (bz * blockWorld - z) / uz : Infinity
							d = Math.max(step, Math.min(ex, ez) + 1e-3)
						}
						x += ux * d
						z += uz * d
						y += slope * d
						if (y > top || x < 0 || z < 0 || x > world || z > world) break
						if (height(x, z) > y) {
							shadow = true
							break
						}
					}
				}
				const i = tz * side + tx
				const v = shadow ? 255 : 0
				if (out[i] !== v) {
					out[i] = v
					changed++
				}
			}
		}
		return changed
	}
}
