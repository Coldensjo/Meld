// A reference image (View › Reference Image, #184): the author's own plan of a zone, a PNG or JPEG
// laid over the map to trace, and turned into editor data. This module is the arithmetic, free of
// three.js so it can be tested on its own: where the image lies on the ground, dragging its corners,
// the colours it is drawn in, and its brightness or colours read into heights, zones, textures or the
// mask. The Engine wraps each conversion into one undo step.

import { NO_TEXTURE, SLOTS } from './chunkPaint'

/** Where the image is drawn: draped over the ground, or over the top-down view, fixed to the screen. */
export type ReferenceMode = 'ground' | 'screen'

/** The image on the ground: its centre (x, z), its width and height there, in world units, and its turn about the centre in radians. */
export interface ReferencePlace {
	x: number
	z: number
	w: number
	h: number
	turn: number
}

/** A map's reference image as the map file keeps it (mapfile.ReferenceImage): its path, never its pixels. */
export interface ReferenceImage extends ReferencePlace {
	path: string
	mode: ReferenceMode
	opacity: number
	shown: boolean
}

/** An image's pixels, RGBA a byte each, row by row from the top. */
export interface RefPixels {
	w: number
	h: number
	data: Uint8ClampedArray | Uint8Array
}

/** One of the flat colours a plan is drawn in, and the share of the image's pixels nearest to it. */
export interface RefColour {
	r: number
	g: number
	b: number
	share: number
}

/** The smallest size the image may be dragged to on the ground, in world units. */
export const MIN_SIDE = 1

/** A copy of a reference record, for undo. */
export function copyReference(r: ReferenceImage | null): ReferenceImage | null {
	return r ? { ...r } : null
}

/** Whether two records are the same. */
export function sameReference(a: ReferenceImage | null, b: ReferenceImage | null): boolean {
	if (!a || !b) return a === b
	return a.path === b.path && a.mode === b.mode && a.opacity === b.opacity && a.shown === b.shown && a.x === b.x && a.z === b.z && a.w === b.w && a.h === b.h && a.turn === b.turn
}

/** A record from what a map file gave, or null when it is missing or makes no sense. */
export function readReference(v: unknown): ReferenceImage | null {
	if (!v || typeof v !== 'object') return null
	const o = v as Record<string, unknown>
	const num = (k: string, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d)
	if (typeof o.path !== 'string' || !o.path) return null
	const w = num('w', 0)
	const h = num('h', 0)
	if (w < MIN_SIDE || h < MIN_SIDE) return null
	return {
		path: o.path,
		mode: o.mode === 'screen' ? 'screen' : 'ground',
		opacity: Math.min(1, Math.max(0, num('opacity', 0.5))),
		shown: o.shown !== false,
		x: num('x', 0),
		z: num('z', 0),
		w,
		h,
		turn: num('turn', 0),
	}
}

/** The image over the whole map: centred, its longer side the map's, its shape kept, not turned. */
export function fitPlace(imgW: number, imgH: number, worldSize: number): ReferencePlace {
	const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : 1
	const w = aspect >= 1 ? worldSize : worldSize * aspect
	const h = aspect >= 1 ? worldSize / aspect : worldSize
	return { x: worldSize / 2, z: worldSize / 2, w, h, turn: 0 }
}

/**
 * The image's own frame at world (x, z): `out[0]` along its width and `out[1]` down its height, both
 * 0 to 1 over the image (outside it below 0 or above 1). Row 0 of the image is at the top, toward -z
 * when it is not turned, as the top-down view shows north. The shader computes the same.
 */
export function refUV(p: ReferencePlace, x: number, z: number, out: Float64Array | number[]): void {
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	const ox = x - p.x
	const oz = z - p.z
	out[0] = (ox * c + oz * s) / p.w + 0.5
	out[1] = (-ox * s + oz * c) / p.h + 0.5
}

/** World (x, z) of a point of the image's frame (u, v as refUV gives them). */
export function refPoint(p: ReferencePlace, u: number, v: number): [number, number] {
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	const lx = (u - 0.5) * p.w
	const lz = (v - 0.5) * p.h
	return [p.x + lx * c - lz * s, p.z + lx * s + lz * c]
}

/** The image's four corners on the ground, top left, top right, bottom right, bottom left. */
export function refCorners(p: ReferencePlace): Array<[number, number]> {
	return [refPoint(p, 0, 0), refPoint(p, 1, 0), refPoint(p, 1, 1), refPoint(p, 0, 1)]
}

/** The (u, v) of corner k, in refCorners' order. */
const CORNER_UV: Array<[number, number]> = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1],
]

/**
 * What a press at world (x, z) takes hold of while the image is being placed: a corner (0 to 3, in
 * refCorners' order) within `handle` world units of it, the image itself, or null outside it.
 */
export function refHit(p: ReferencePlace, x: number, z: number, handle: number): number | 'inside' | null {
	const corners = refCorners(p)
	let best = -1
	let bestD = handle
	corners.forEach(([cx, cz], k) => {
		const d = Math.max(Math.abs(cx - x), Math.abs(cz - z))
		if (d <= bestD) {
			best = k
			bestD = d
		}
	})
	if (best >= 0) return best
	const uv = [0, 0]
	refUV(p, x, z, uv)
	return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1 ? 'inside' : null
}

/**
 * The place after dragging corner `k` of `p0` to world (x, z): the opposite corner stays put and the
 * turn is kept. With `keepAspect` the image keeps its shape, scaled by how far along its diagonal the
 * corner went; otherwise its width and height follow the corner on their own.
 */
export function dragCorner(p0: ReferencePlace, k: number, x: number, z: number, keepAspect: boolean): ReferencePlace {
	const [ou, ov] = CORNER_UV[(k + 2) % 4]
	const [ox, oz] = refPoint(p0, ou, ov)
	const c = Math.cos(p0.turn)
	const s = Math.sin(p0.turn)
	// The pointer in the image's frame from the fixed corner, signed toward the dragged corner.
	const sx = CORNER_UV[k][0] > ou ? 1 : -1
	const sz = CORNER_UV[k][1] > ov ? 1 : -1
	const dx = ((x - ox) * c + (z - oz) * s) * sx
	const dz = (-(x - ox) * s + (z - oz) * c) * sz
	let w: number
	let h: number
	if (keepAspect) {
		const f = Math.max(MIN_SIDE / Math.min(p0.w, p0.h), (dx * p0.w + dz * p0.h) / (p0.w * p0.w + p0.h * p0.h))
		w = p0.w * f
		h = p0.h * f
	} else {
		w = Math.max(MIN_SIDE, dx)
		h = Math.max(MIN_SIDE, dz)
	}
	// The new centre: half the new size from the fixed corner, toward the dragged one.
	const lx = (sx * w) / 2
	const lz = (sz * h) / 2
	return { x: ox + lx * c - lz * s, z: oz + lx * s + lz * c, w, h, turn: p0.turn }
}

/** The place after turning `p0` about its centre by the angle the pointer swept from (x0, z0) to (x, z). */
export function dragTurn(p0: ReferencePlace, x0: number, z0: number, x: number, z: number): ReferencePlace {
	const a0 = Math.atan2(z0 - p0.z, x0 - p0.x)
	const a1 = Math.atan2(z - p0.z, x - p0.x)
	let turn = p0.turn + a1 - a0
	turn = Math.atan2(Math.sin(turn), Math.cos(turn))
	return { ...p0, turn }
}

// ---------------------------------------------------------------- colours

/** Pixels more transparent than this are no colour: left alone by every conversion. */
const ALPHA_MIN = 128

/**
 * The flat colours the image is drawn in, most used first: its pixels counted in 5-bit-a-channel
 * buckets, the largest buckets taken while they are at least `merge` apart (RGB distance, so the
 * antialiased edge between two colours doesn't count as a third), at most `max` of them, none under
 * `minShare` of the image. Each colour is its bucket's mean, and its share counts every pixel nearer
 * to it than `merge`.
 */
export function dominantColours(px: RefPixels, max = 12, minShare = 0.002, merge = 40): RefColour[] {
	const counts = new Uint32Array(32768)
	const sums = new Float64Array(32768 * 3)
	const d = px.data
	let total = 0
	for (let i = 0; i < px.w * px.h; i++) {
		const o = i * 4
		if (d[o + 3] < ALPHA_MIN) continue
		const key = ((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3)
		counts[key]++
		sums[key * 3] += d[o]
		sums[key * 3 + 1] += d[o + 1]
		sums[key * 3 + 2] += d[o + 2]
		total++
	}
	if (!total) return []
	const keys: number[] = []
	for (let k = 0; k < counts.length; k++) if (counts[k]) keys.push(k)
	keys.sort((a, b) => counts[b] - counts[a])
	const picked: RefColour[] = []
	const m2 = merge * merge
	for (const k of keys) {
		if (picked.length >= max || counts[k] / total < minShare) break
		const n = counts[k]
		const c = { r: Math.round(sums[k * 3] / n), g: Math.round(sums[k * 3 + 1] / n), b: Math.round(sums[k * 3 + 2] / n), share: 0 }
		if (picked.some((p) => dist2(p, c.r, c.g, c.b) < m2)) continue
		picked.push(c)
	}
	// Each picked colour's share: the pixels nearest to it, within `merge`.
	const idx = colourIndices(px, picked, merge)
	const per = new Uint32Array(picked.length)
	for (let i = 0; i < idx.length; i++) if (idx[i] !== NONE) per[idx[i]]++
	picked.forEach((c, i) => (c.share = per[i] / total))
	return picked
}

function dist2(c: RefColour, r: number, g: number, b: number): number {
	const dr = c.r - r
	const dg = c.g - g
	const db = c.b - b
	return dr * dr + dg * dg + db * db
}

/** colourIndices' value for a pixel that is none of the colours. */
export const NONE = 255

/** The index of the colour nearest to each pixel, within `tolerance` (RGB distance), else NONE; transparent pixels are NONE. */
export function colourIndices(px: RefPixels, colours: RefColour[], tolerance: number): Uint8Array {
	const out = new Uint8Array(px.w * px.h).fill(NONE)
	const t2 = tolerance * tolerance
	const d = px.data
	for (let i = 0; i < out.length; i++) {
		const o = i * 4
		if (d[o + 3] < ALPHA_MIN) continue
		let best = NONE
		let bestD = t2
		for (let k = 0; k < colours.length; k++) {
			const dd = dist2(colours[k], d[o], d[o + 1], d[o + 2])
			if (dd <= bestD) {
				bestD = dd
				best = k
			}
		}
		out[i] = best
	}
	return out
}

/** A colour as '#rrggbb'. */
export function colourHex(c: { r: number; g: number; b: number }): string {
	return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- conversions

/** The image's pixel under world (x, z) (nearest), or -1 off the image. */
function pixelAt(px: RefPixels, p: ReferencePlace, c: number, s: number, x: number, z: number): number {
	const ox = x - p.x
	const oz = z - p.z
	const u = (ox * c + oz * s) / p.w + 0.5
	const v = (-ox * s + oz * c) / p.h + 0.5
	if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1
	return Math.floor(v * px.h) * px.w + Math.floor(u * px.w)
}

/** How the image's heights meet the ground's. */
export type RefHeightMode = 'set' | 'add'

/**
 * The image's brightness (the mean of red, green and blue, bilinear) as heights from `min` (black) to
 * `max` (white), set on the vertices under it or added to them. Vertices off the image or under its
 * transparent pixels keep their height. `heights` is `verts` a side, `cellSize` apart. Returns the new
 * heights and how many vertices it set.
 */
export function heightsFromImage(heights: Float32Array, verts: number, cellSize: number, px: RefPixels, p: ReferencePlace, min: number, max: number, mode: RefHeightMode): { next: Float32Array; count: number } {
	const next = heights.slice()
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	const d = px.data
	let count = 0
	const grey = (ix: number, iz: number) => {
		const o = (iz * px.w + ix) * 4
		return d[o + 3] < ALPHA_MIN ? -1 : (d[o] + d[o + 1] + d[o + 2]) / 765
	}
	for (let z = 0; z < verts; z++) {
		for (let x = 0; x < verts; x++) {
			const ox = x * cellSize - p.x
			const oz = z * cellSize - p.z
			const u = (ox * c + oz * s) / p.w + 0.5
			const v = (-ox * s + oz * c) / p.h + 0.5
			if (u < 0 || v < 0 || u > 1 || v > 1) continue
			// Bilinear between pixel centres, clamped at the image's edges.
			const fx = Math.min(px.w - 1, Math.max(0, u * px.w - 0.5))
			const fz = Math.min(px.h - 1, Math.max(0, v * px.h - 0.5))
			const x0 = Math.floor(fx)
			const z0 = Math.floor(fz)
			const x1 = Math.min(px.w - 1, x0 + 1)
			const z1 = Math.min(px.h - 1, z0 + 1)
			const g00 = grey(x0, z0)
			const g10 = grey(x1, z0)
			const g01 = grey(x0, z1)
			const g11 = grey(x1, z1)
			if (g00 < 0 || g10 < 0 || g01 < 0 || g11 < 0) continue
			const tx = fx - x0
			const tz = fz - z0
			const g = (g00 * (1 - tx) + g10 * tx) * (1 - tz) + (g01 * (1 - tx) + g11 * tx) * tz
			const h = min + g * (max - min)
			const i = z * verts + x
			next[i] = mode === 'add' ? heights[i] + h : h
			count++
		}
	}
	return { next, count }
}

/** Samples a side of a chunk the zone vote takes. */
const VOTES = 4

/**
 * Each chunk's zone from the image: `areaOf[k]` is the AreaTable ID colour k paints (0 for none). A
 * chunk takes the zone most of its VOTES x VOTES samples name, when at least one does; others keep
 * theirs. `areaIds` is `chunksSide` a side, chunks `chunkWorld` wide. Returns the chunks changed.
 */
export function areasFromImage(areaIds: Uint32Array, chunksSide: number, chunkWorld: number, idx: Uint8Array, px: RefPixels, p: ReferencePlace, areaOf: number[]): number {
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	const votes = new Map<number, number>()
	let changed = 0
	for (let cz = 0; cz < chunksSide; cz++) {
		for (let cx = 0; cx < chunksSide; cx++) {
			votes.clear()
			for (let j = 0; j < VOTES; j++) {
				for (let i = 0; i < VOTES; i++) {
					const at = pixelAt(px, p, c, s, (cx + (i + 0.5) / VOTES) * chunkWorld, (cz + (j + 0.5) / VOTES) * chunkWorld)
					if (at < 0 || idx[at] === NONE) continue
					const area = areaOf[idx[at]] ?? 0
					if (area) votes.set(area, (votes.get(area) ?? 0) + 1)
				}
			}
			let best = 0
			let bestN = 0
			for (const [area, n] of votes) {
				if (n > bestN) {
					best = area
					bestN = n
				}
			}
			const ch = cz * chunksSide + cx
			if (best && areaIds[ch] !== best) {
				areaIds[ch] = best
				changed++
			}
		}
	}
	return changed
}

/**
 * Adds the texels whose colour is `chosen` to the mask, fully. `mask` is `res` a side, each texel
 * `texelWorld` wide. Returns the texels set and their rect, or null when none were.
 */
export function maskFromImage(mask: Uint8Array, res: number, texelWorld: number, idx: Uint8Array, px: RefPixels, p: ReferencePlace, chosen: boolean[]): { count: number; rect: { x0: number; z0: number; x1: number; z1: number } | null } {
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	let count = 0
	let x0 = res,
		z0 = res,
		x1 = -1,
		z1 = -1
	for (let z = 0; z < res; z++) {
		for (let x = 0; x < res; x++) {
			const at = pixelAt(px, p, c, s, (x + 0.5) * texelWorld, (z + 0.5) * texelWorld)
			if (at < 0 || idx[at] === NONE || !chosen[idx[at]]) continue
			mask[z * res + x] = 255
			count++
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			if (z > z1) z1 = z
		}
	}
	return { count, rect: x1 < 0 ? null : { x0, z0, x1, z1 } }
}

/**
 * Paints the texels whose colour names a texture (`layerOf[k]`, a palette index, or -1 for none) with
 * that texture alone: a quick first pass of painting from a plan. A chunk holds at most SLOTS
 * textures: its slots keep the textures its other texels still use, and the image's textures take the
 * rest, the most used in the chunk first; a texture that finds no slot leaves its texels as they were
 * (counted in `refused`). `weights` holds SLOTS bytes a texel, `res` a side, each texel `texelWorld`
 * wide, and `slots` SLOTS palette indices a chunk, `chunksSide` a side. Returns the texels painted,
 * those refused and the painted rect.
 */
export function texturesFromImage(
	weights: Uint8Array,
	slots: Uint8Array,
	res: number,
	chunksSide: number,
	texelWorld: number,
	idx: Uint8Array,
	px: RefPixels,
	p: ReferencePlace,
	layerOf: number[],
): { painted: number; refused: number; rect: { x0: number; z0: number; x1: number; z1: number } | null } {
	const c = Math.cos(p.turn)
	const s = Math.sin(p.turn)
	const per = res / chunksSide
	const target = new Int16Array(per * per)
	let painted = 0
	let refused = 0
	let x0 = res,
		z0 = res,
		x1 = -1,
		z1 = -1
	for (let cz = 0; cz < chunksSide; cz++) {
		for (let cx = 0; cx < chunksSide; cx++) {
			let any = false
			for (let j = 0; j < per; j++) {
				for (let i = 0; i < per; i++) {
					const at = pixelAt(px, p, c, s, (cx * per + i + 0.5) * texelWorld, (cz * per + j + 0.5) * texelWorld)
					const layer = at < 0 || idx[at] === NONE ? -1 : (layerOf[idx[at]] ?? -1)
					target[j * per + i] = layer
					if (layer >= 0) any = true
				}
			}
			if (!any) continue
			const tx0 = cx * per
			const tz0 = cz * per
			const { next, refusedLayers } = settleChunkSlots(weights, slots, res, cz * chunksSide + cx, tx0, tz0, per, target)
			slots.set(next, (cz * chunksSide + cx) * SLOTS)
			for (let j = 0; j < per; j++) {
				for (let i = 0; i < per; i++) {
					const layer = target[j * per + i]
					if (layer < 0) continue
					if (refusedLayers.has(layer)) {
						refused++
						continue
					}
					const k = next.indexOf(layer)
					const tx = tx0 + i
					const tz = tz0 + j
					const o = (tz * res + tx) * SLOTS
					for (let q = 0; q < SLOTS; q++) weights[o + q] = q === k ? 255 : 0
					painted++
					if (tx < x0) x0 = tx
					if (tx > x1) x1 = tx
					if (tz < z0) z0 = tz
					if (tz > z1) z1 = tz
				}
			}
		}
	}
	return { painted, refused, rect: x1 < 0 ? null : { x0, z0, x1, z1 } }
}

/**
 * Which textures of a chunk get a slot when its texels take `target` (a palette index each, -1 for a
 * texel left alone): the slots the left-alone texels use are kept, and the target textures take the
 * free ones, the most used first. A refused texture's texels keep their paint, so the slots they use
 * are kept too, which can refuse another; a few rounds settle it. Returns the chunk's new slots and
 * the refused textures.
 */
function settleChunkSlots(weights: Uint8Array, slots: Uint8Array, res: number, ch: number, tx0: number, tz0: number, per: number, target: Int16Array): { next: Uint8Array; refusedLayers: Set<number> } {
	const base = ch * SLOTS
	const refusedLayers = new Set<number>()
	let next = slots.slice(base, base + SLOTS)
	for (let round = 0; round <= SLOTS; round++) {
		const kept = [false, false, false, false]
		const counts = new Map<number, number>()
		for (let j = 0; j < per; j++) {
			for (let i = 0; i < per; i++) {
				const layer = target[j * per + i]
				if (layer >= 0 && !refusedLayers.has(layer)) {
					counts.set(layer, (counts.get(layer) ?? 0) + 1)
					continue
				}
				const o = ((tz0 + j) * res + tx0 + i) * SLOTS
				for (let k = 0; k < SLOTS; k++) if (weights[o + k] > 0 && slots[base + k] !== NO_TEXTURE) kept[k] = true
			}
		}
		next = new Uint8Array(SLOTS)
		for (let k = 0; k < SLOTS; k++) next[k] = kept[k] ? slots[base + k] : NO_TEXTURE
		const order = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a - b)
		let newlyRefused = false
		for (const layer of order) {
			if (next.includes(layer)) continue
			// Its own old slot when nothing keeps that one, else any free one.
			let k = -1
			for (let q = 0; q < SLOTS && k < 0; q++) if (slots[base + q] === layer && next[q] === NO_TEXTURE) k = q
			for (let q = 0; q < SLOTS && k < 0; q++) if (next[q] === NO_TEXTURE) k = q
			if (k < 0) {
				refusedLayers.add(layer)
				newlyRefused = true
				continue
			}
			next[k] = layer
		}
		if (!newlyRefused) break
	}
	return { next, refusedLayers }
}
