// Turning a copied area (see clipboard.ts). Kept apart from the clipboard module, which pulls in the
// terrain stroke, so it can be tested on its own under node.
import type { MapClip } from './clipboard'
import { SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'
import { mirrorLiquidClip, rotateLiquidClip } from '../water/liquids'
import { mirrorShadows, rotateShadows } from './clipShadows'
import { mirrorCells, rotateCells } from '../terrain/areaShape'

/**
 * The clip turned a quarter turn clockwise seen from above (the turn a model's yaw makes for +90°):
 * what was at (x, z) lands at (z, w - x), so a w by h clip becomes h by w. Heights, holes, texels,
 * liquids, chunk data, baked shadows and models turn together; a model's own yaw turns too (the
 * shadows turn with the ground, not with the sun, so a turned paste may want Bake Shadows again). A hole of one triangle
 * keeps its value, so it may land on the other triangle of its cell. noggit's chunk mover has the
 * same turn.
 */
export function rotateClip(clip: MapClip, cellSize: number): MapClip {
	const { w, h } = clip
	const nw = h
	const nh = w
	const heights = new Float32Array((nw + 1) * (nh + 1))
	for (let z = 0; z <= h; z++) for (let x = 0; x <= w; x++) heights[(w - x) * (nw + 1) + z] = clip.heights[z * (w + 1) + x]
	const holes = new Uint8Array(nw * nh)
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) holes[(w - 1 - x) * nw + z] = clip.holes[z * w + x]
	const T = SPLAT_PER_CELL
	const tw = w * T
	const th = h * T
	const ntw = nw * T
	const weights = new Uint8Array(clip.weights.length)
	const slots = new Uint8Array(clip.slots.length)
	for (let z = 0; z < th; z++) {
		for (let x = 0; x < tw; x++) {
			const from = (z * tw + x) * SLOTS
			const to = ((tw - 1 - x) * ntw + z) * SLOTS
			for (let k = 0; k < SLOTS; k++) {
				weights[to + k] = clip.weights[from + k]
				slots[to + k] = clip.slots[from + k]
			}
		}
	}
	const W = w * cellSize
	const objects = clip.objects.map((o) => (o.cparent === undefined ? { ...o, x: o.z, z: W - o.x, rotY: o.rotY + Math.PI / 2 } : { ...o }))
	const out: MapClip = { w: nw, h: nh, heights, holes, weights, slots, palette: [...clip.palette], objects }
	if (clip.liquids) out.liquids = rotateLiquidClip(clip.liquids)
	if (clip.chunkData) {
		const turn = <A extends Uint8Array | Uint32Array>(src: A, dst: A) => {
			for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) dst[(w - 1 - x) * nw + z] = src[z * w + x]
			return dst
		}
		const d = clip.chunkData
		out.chunkData = { areas: turn(d.areas, new Uint32Array(d.areas.length)), flags: turn(d.flags, new Uint8Array(d.flags.length)), noEffect: turn(d.noEffect, new Uint8Array(d.noEffect.length)) }
	}
	if (clip.shadows) out.shadows = rotateShadows(clip.shadows, w, h)
	if (clip.cells) out.cells = rotateCells(clip.cells, w, h)
	return out
}

/**
 * The clip mirrored across its middle: `x` flips it east to west, `z` north to south. Heights, holes,
 * texels, liquids, chunk data, baked shadows and models flip together. A model can't be mirrored itself, so it keeps
 * its shape and turns to face the mirrored way: WoW models face +x and are mostly left-right
 * symmetric, so across x its yaw becomes pi - yaw, across z -yaw, and its forward tilt flips either
 * way. An attached model flips about its parent's own middle.
 */
export function mirrorClip(clip: MapClip, axis: 'x' | 'z', cellSize: number): MapClip {
	const { w, h } = clip
	const fx = axis === 'x'
	const vx = (x: number) => (fx ? w - x : x)
	const vz = (z: number) => (fx ? z : h - z)
	const heights = new Float32Array(clip.heights.length)
	for (let z = 0; z <= h; z++) for (let x = 0; x <= w; x++) heights[vz(z) * (w + 1) + vx(x)] = clip.heights[z * (w + 1) + x]
	const cells = <A extends Uint8Array | Uint32Array>(src: A, dst: A) => {
		for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) dst[(fx ? z : h - 1 - z) * w + (fx ? w - 1 - x : x)] = src[z * w + x]
		return dst
	}
	const holes = cells(clip.holes, new Uint8Array(clip.holes.length))
	const T = SPLAT_PER_CELL
	const tw = w * T
	const th = h * T
	const weights = new Uint8Array(clip.weights.length)
	const slots = new Uint8Array(clip.slots.length)
	for (let z = 0; z < th; z++) {
		for (let x = 0; x < tw; x++) {
			const from = (z * tw + x) * SLOTS
			const to = ((fx ? z : th - 1 - z) * tw + (fx ? tw - 1 - x : x)) * SLOTS
			for (let k = 0; k < SLOTS; k++) {
				weights[to + k] = clip.weights[from + k]
				slots[to + k] = clip.slots[from + k]
			}
		}
	}
	const W = w * cellSize
	const H = h * cellSize
	const objects = clip.objects.map((o) => {
		// Mirrored, a model keeps its lean forward or back and rolls the other way.
		const tiltZ = o.tiltZ === undefined ? undefined : -o.tiltZ
		if (o.cparent !== undefined) return { ...o, z: -o.z, rotY: -o.rotY, tiltZ }
		return fx ? { ...o, x: W - o.x, rotY: Math.PI - o.rotY, tiltZ } : { ...o, z: H - o.z, rotY: -o.rotY, tiltZ }
	})
	const out: MapClip = { w, h, heights, holes, weights, slots, palette: [...clip.palette], objects }
	if (clip.liquids) out.liquids = mirrorLiquidClip(clip.liquids, axis)
	if (clip.chunkData) {
		const d = clip.chunkData
		out.chunkData = { areas: cells(d.areas, new Uint32Array(d.areas.length)), flags: cells(d.flags, new Uint8Array(d.flags.length)), noEffect: cells(d.noEffect, new Uint8Array(d.noEffect.length)) }
	}
	if (clip.shadows) out.shadows = mirrorShadows(clip.shadows, w, h, axis)
	if (clip.cells) out.cells = mirrorCells(clip.cells, w, h, axis)
	return out
}
