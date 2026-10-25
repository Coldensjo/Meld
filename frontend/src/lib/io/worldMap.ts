// A zone's in-game world map (#181): its rectangle in the editor's yards and in the client's
// WorldMapArea extent, the zone's bounds from the Map data zones, and the picture's look. Pure, so it
// is tested on its own; World › World Map (WorldMapDialog.svelte) renders and writes it.

/** The size of a zone's world map picture, as the client's frame shows it. */
export const WORLD_MAP_W = 1002
export const WORLD_MAP_H = 668

import { fromServer, toServer } from '../wow/format'

/** A rectangle of the editor's map in yards: x runs east, z south. */
export interface EditorRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** WorldMapArea's extent: Left and Right are world Y (west the larger), Top and Bottom world X (north the larger). */
export interface WorldExtent {
	left: number
	right: number
	top: number
	bottom: number
}

/**
 * The editor rectangle of an extent, for a block whose north-west tile is (tileX, tileY) (a region's
 * first tile; 0, 0 for a map made for the client). The client's Y is the server's y and its X the
 * server's x (lib/wow/format.ts toServer).
 */
export function extentToRect(e: WorldExtent, tileX = 0, tileY = 0): EditorRect {
	const a = fromServer(e.top, e.left, tileX, tileY)
	const b = fromServer(e.bottom, e.right, tileX, tileY)
	return { x0: a.x, x1: b.x, z0: a.z, z1: b.z }
}

/** The inverse of extentToRect. */
export function rectToExtent(r: EditorRect, tileX = 0, tileY = 0): WorldExtent {
	const a = toServer(r.x0, r.z0, tileX, tileY)
	const b = toServer(r.x1, r.z1, tileX, tileY)
	return { left: a.y, right: b.y, top: a.x, bottom: b.x }
}

/**
 * The bounds of the paint chunks whose area is in the zone (`inZone`), `chunkYards` a chunk, `perSide`
 * chunks a side, or null when none is.
 */
export function zoneBounds(areaIds: ArrayLike<number>, perSide: number, chunkYards: number, inZone: (id: number) => boolean): EditorRect | null {
	let x0 = Infinity
	let z0 = Infinity
	let x1 = -Infinity
	let z1 = -Infinity
	for (let i = 0; i < areaIds.length; i++) {
		if (!areaIds[i] || !inZone(areaIds[i])) continue
		const cx = i % perSide
		const cz = Math.floor(i / perSide)
		x0 = Math.min(x0, cx * chunkYards)
		z0 = Math.min(z0, cz * chunkYards)
		x1 = Math.max(x1, (cx + 1) * chunkYards)
		z1 = Math.max(z1, (cz + 1) * chunkYards)
	}
	return x0 === Infinity ? null : { x0, z0, x1, z1 }
}

/** The rectangle grown by `margin` of its size each way, then on its short side to the picture's 3:2. */
export function fitAspect(r: EditorRect, margin = 0.04): EditorRect {
	let w = (r.x1 - r.x0) * (1 + 2 * margin)
	let h = (r.z1 - r.z0) * (1 + 2 * margin)
	const aspect = WORLD_MAP_W / WORLD_MAP_H
	if (w / h < aspect) w = h * aspect
	else h = w / aspect
	const cx = (r.x0 + r.x1) / 2
	const cz = (r.z0 + r.z1) / 2
	return { x0: cx - w / 2, z0: cz - h / 2, x1: cx + w / 2, z1: cz + h / 2 }
}

/** The picture's pixel box of `part` (inside `whole`), rounded out to whole pixels and kept in the picture. */
export function pixelBox(whole: EditorRect, part: EditorRect, w = WORLD_MAP_W, h = WORLD_MAP_H) {
	const u = (x: number) => ((x - whole.x0) / (whole.x1 - whole.x0)) * w
	const v = (z: number) => ((z - whole.z0) / (whole.z1 - whole.z0)) * h
	const u0 = Math.max(0, Math.floor(u(part.x0)))
	const v0 = Math.max(0, Math.floor(v(part.z0)))
	const u1 = Math.min(w, Math.ceil(u(part.x1)))
	const v1 = Math.min(h, Math.ceil(v(part.z1)))
	return { u0, v0, u1, v1 }
}

/** The editor rectangle a pixel box covers, the inverse of pixelBox for whole pixels. */
export function boxRect(whole: EditorRect, b: { u0: number; v0: number; u1: number; v1: number }, w = WORLD_MAP_W, h = WORLD_MAP_H): EditorRect {
	const x = (u: number) => whole.x0 + (u / w) * (whole.x1 - whole.x0)
	const z = (v: number) => whole.z0 + (v / h) * (whole.z1 - whole.z0)
	return { x0: x(b.u0), z0: z(b.v0), x1: x(b.u1), z1: z(b.v1) }
}

/** The overlap of two rectangles, or null. */
export function intersect(a: EditorRect, b: EditorRect): EditorRect | null {
	const r = { x0: Math.max(a.x0, b.x0), z0: Math.max(a.z0, b.z0), x1: Math.min(a.x1, b.x1), z1: Math.min(a.z1, b.z1) }
	return r.x1 > r.x0 && r.z1 > r.z0 ? r : null
}

/** Parchment, which the edges fade to, as the client's zone maps are framed. */
const PARCHMENT = [201, 182, 140]

/**
 * The client's map look over a top-down shot (RGBA, w by h): softened by a small blur, toned warm and
 * a little less saturated like painted parchment, and faded to parchment at the picture's edges.
 * `edges` fades only the sides that are the zone's edges (left, top, right, bottom), so a piece pasted
 * into a client's map leaves its neighbours' seams alone.
 */
export function mapLook(px: Uint8Array, w: number, h: number, edges = { left: true, top: true, right: true, bottom: true }): Uint8Array {
	const out = new Uint8Array(px.length)
	const fade = Math.max(8, Math.round(Math.min(WORLD_MAP_W, WORLD_MAP_H) * 0.05))
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let r = 0
			let g = 0
			let b = 0
			let n = 0
			for (let dy = -1; dy <= 1; dy++) {
				const yy = Math.min(h - 1, Math.max(0, y + dy))
				for (let dx = -1; dx <= 1; dx++) {
					const xx = Math.min(w - 1, Math.max(0, x + dx))
					const i = (yy * w + xx) * 4
					const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
					r += px[i] * k
					g += px[i + 1] * k
					b += px[i + 2] * k
					n += k
				}
			}
			r /= n
			g /= n
			b /= n
			// Less saturated, then warm: the grey kept at a fifth, a sepia multiply over it.
			const grey = 0.3 * r + 0.59 * g + 0.11 * b
			r = (r * 0.8 + grey * 0.2) * 1.06 + 6
			g = (g * 0.8 + grey * 0.2) * 0.99 + 3
			b = (b * 0.8 + grey * 0.2) * 0.84
			// Faded toward parchment at the zone's edges.
			let d = Infinity
			if (edges.left) d = Math.min(d, x)
			if (edges.right) d = Math.min(d, w - 1 - x)
			if (edges.top) d = Math.min(d, y)
			if (edges.bottom) d = Math.min(d, h - 1 - y)
			const t = d >= fade ? 0 : 1 - d / fade
			const k = t * t
			const o = (y * w + x) * 4
			out[o] = Math.round(r + (PARCHMENT[0] - r) * k)
			out[o + 1] = Math.round(g + (PARCHMENT[1] - g) * k)
			out[o + 2] = Math.round(b + (PARCHMENT[2] - b) * k)
			out[o + 3] = 255
		}
	}
	return out
}

/** Copies `part` (pw by ph RGBA) into `into` (w wide) at (u0, v0). */
export function paste(into: Uint8Array, w: number, part: Uint8Array, pw: number, ph: number, u0: number, v0: number) {
	for (let y = 0; y < ph; y++) into.set(part.subarray(y * pw * 4, (y + 1) * pw * 4), ((v0 + y) * w + u0) * 4)
}

/**
 * Copies `part` into `into` as paste does, blended into what is there over a band of `band` pixels
 * along its edges, so a piece drawn over a client's map fades into it. A side on the picture's own
 * edge isn't blended.
 */
export function feather(into: Uint8Array, w: number, h: number, part: Uint8Array, pw: number, ph: number, u0: number, v0: number, band = 16) {
	for (let y = 0; y < ph; y++) {
		for (let x = 0; x < pw; x++) {
			let d = Infinity
			if (u0 > 0) d = Math.min(d, x)
			if (v0 > 0) d = Math.min(d, y)
			if (u0 + pw < w) d = Math.min(d, pw - 1 - x)
			if (v0 + ph < h) d = Math.min(d, ph - 1 - y)
			const a = d >= band ? 1 : (d + 0.5) / band
			const s = (y * pw + x) * 4
			const o = ((v0 + y) * w + u0 + x) * 4
			for (let c = 0; c < 3; c++) into[o + c] = Math.round(into[o + c] + (part[s + c] - into[o + c]) * a)
			into[o + 3] = 255
		}
	}
}

/** A folder name for a zone's art, from its name: its letters and digits, as the client's own (Elwynn, Stranglethorn). */
export function artName(zone: string): string {
	const s = zone.replace(/[^A-Za-z0-9]+/g, '')
	return /^[A-Za-z]/.test(s) ? s.slice(0, 48) : `Zone${s}`.slice(0, 48)
}

/** A box of the picture in whole pixels, u1 and v1 past its last column and row. */
export interface PixelBox {
	u0: number
	v0: number
	u1: number
	v1: number
}

/**
 * A zone's exploration overlay (#219): a WorldMapOverlay.dbc row and its picture, which the game draws
 * over the base art once the player has explored one of `areas` (up to four AreaTable IDs). `box` is
 * where it sits in the picture, `hit` its hit rectangle (picture pixels), `pixels` its RGBA (the box's
 * size; null when the client's art could not be read), `changed` whether it is to be written (an
 * unchanged one keeps the client's art). `id` 0 is a new row.
 */
export interface OverlayPiece {
	id: number
	areas: number[]
	name: string
	box: PixelBox
	hit: { top: number; left: number; bottom: number; right: number }
	pixels: Uint8Array | null
	changed: boolean
}

/** The soft edge of an overlay, in picture pixels: its alpha fades out over about this much. */
const OVERLAY_SOFT = 8

/** Two passes of a box blur of radius r over a w by h channel, in place. */
function blurChannel(a: Float32Array, w: number, h: number, r: number) {
	const tmp = new Float32Array(a.length)
	const n = 2 * r + 1
	for (let pass = 0; pass < 2; pass++) {
		for (let y = 0; y < h; y++) {
			const row = y * w
			let s = 0
			for (let x = -r; x <= r; x++) s += a[row + Math.min(w - 1, Math.max(0, x))]
			for (let x = 0; x < w; x++) {
				tmp[row + x] = s / n
				s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
			}
		}
		for (let x = 0; x < w; x++) {
			let s = 0
			for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
			for (let y = 0; y < h; y++) {
				a[y * w + x] = s / n
				s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
			}
		}
	}
}

/**
 * The area of the paint chunk under each pixel of `box` (picture pixels of `whole`, w by h), 0 off the
 * map: what the overlays' masks are cut from.
 */
export function areasUnder(areaIds: ArrayLike<number>, perSide: number, chunkYards: number, whole: EditorRect, box: PixelBox, w = WORLD_MAP_W, h = WORLD_MAP_H): Uint32Array {
	const bw = box.u1 - box.u0
	const bh = box.v1 - box.v0
	const out = new Uint32Array(bw * bh)
	for (let y = 0; y < bh; y++) {
		const z = whole.z0 + ((box.v0 + y + 0.5) / h) * (whole.z1 - whole.z0)
		const cz = Math.floor(z / chunkYards)
		if (cz < 0 || cz >= perSide) continue
		for (let x = 0; x < bw; x++) {
			const xx = whole.x0 + ((box.u0 + x + 0.5) / w) * (whole.x1 - whole.x0)
			const cx = Math.floor(xx / chunkYards)
			if (cx >= 0 && cx < perSide) out[y * bw + x] = areaIds[cz * perSide + cx]
		}
	}
	return out
}

/**
 * The soft mask (0..1) of the pixels whose area is one of `ids`, from areasUnder's grid (bw by bh):
 * whole over the areas' chunks, fading out over about `soft` pixels past them.
 */
export function areaMask(under: Uint32Array, bw: number, bh: number, ids: ReadonlySet<number>, soft = OVERLAY_SOFT): Float32Array {
	const m = new Float32Array(bw * bh)
	for (let i = 0; i < under.length; i++) if (ids.has(under[i])) m[i] = 1
	// Grown by half the soft edge first, so the blur after it leaves the inside whole.
	const r = Math.max(1, Math.round(soft / 4))
	blurChannel(m, bw, bh, r)
	for (let i = 0; i < m.length; i++) m[i] = m[i] > 0.001 ? 1 : 0
	blurChannel(m, bw, bh, r)
	return m
}

/**
 * The look with the masked parts left out, faded to plain parchment (a trace of the ground's light and
 * shade kept, so it reads as paper): the base art under a zone's overlays, as the client's is.
 */
export function blankOut(look: Uint8Array, mask: Float32Array): Uint8Array {
	const out = look.slice()
	for (let i = 0; i < mask.length; i++) {
		const k = mask[i]
		if (k <= 0) continue
		const o = i * 4
		const shade = (0.3 * look[o] + 0.59 * look[o + 1] + 0.11 * look[o + 2] - 128) * 0.12
		for (let c = 0; c < 3; c++) out[o + c] = Math.round(look[o + c] + (Math.max(0, Math.min(255, PARCHMENT[c] + shade)) - look[o + c]) * k)
	}
	return out
}

/** A name for a new overlay's art from its area's name, not one of `taken` (upper case, as the client's). */
export function overlayName(area: string, taken: ReadonlySet<string>): string {
	const base = artName(area).toUpperCase().slice(0, 44)
	let name = base
	for (let i = 2; taken.has(name); i++) name = `${base}${i}`
	return name
}

/** The bounds of the pixels of a w by h RGBA picture whose alpha is at least `min`, or null. */
function alphaBounds(px: Uint8Array, w: number, h: number, min: number): PixelBox | null {
	let u0 = Infinity
	let v0 = Infinity
	let u1 = -Infinity
	let v1 = -Infinity
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (px[(y * w + x) * 4 + 3] < min) continue
			u0 = Math.min(u0, x)
			v0 = Math.min(v0, y)
			u1 = Math.max(u1, x + 1)
			v1 = Math.max(v1, y + 1)
		}
	}
	return u0 === Infinity ? null : { u0, v0, u1, v1 }
}

/**
 * The overlay `o` with `px` (uw by uh, at u0, v0 in the picture) as its art, trimmed to what shows, its
 * hit rectangle the part that is half there or more; with no art when nothing shows.
 */
function trimmed(o: OverlayPiece, px: Uint8Array, u0: number, v0: number, uw: number, uh: number): OverlayPiece {
	const t = alphaBounds(px, uw, uh, 1)
	if (!t) return { ...o, pixels: null, box: { u0: 0, v0: 0, u1: 0, v1: 0 }, changed: true }
	const tw = t.u1 - t.u0
	const th = t.v1 - t.v0
	const out = new Uint8Array(tw * th * 4)
	for (let y = 0; y < th; y++) out.set(px.subarray(((t.v0 + y) * uw + t.u0) * 4, ((t.v0 + y) * uw + t.u1) * 4), y * tw * 4)
	const half = alphaBounds(px, uw, uh, 128) ?? t
	return {
		...o,
		box: { u0: u0 + t.u0, v0: v0 + t.v0, u1: u0 + t.u1, v1: v0 + t.v1 },
		hit: { top: v0 + half.v0, left: u0 + half.u0, bottom: v0 + half.v1, right: u0 + half.u1 },
		pixels: out,
		changed: true,
	}
}

/**
 * The overlays after a zone is drawn (`look`, the part of the picture in `box`, already in the map's
 * look; `under`, areasUnder of the box): every subzone of `zoneId` painted in the part (an area whose
 * parent is the zone) is drawn into the overlay that names it, else the one whose art covers most of
 * it (half or more), else a new one; an overlay's alpha is its subzones' chunks with a soft edge. The part of an overlay outside the box is kept, and the new drawing
 * fades into it over `band` pixels along the box's edges inside the picture (0 for a zone drawn
 * whole). An overlay none of whose areas is painted in the part keeps its art, except over the part's
 * chunks of other areas, where it is cleared (fading over the band), so a subzone repainted away no
 * longer shows there; one left with nothing is dropped. Returns the overlays and
 * `base`, the look with the redrawn overlays' areas left out (blankOut).
 */
export function drawOverlays(opts: {
	look: Uint8Array
	box: PixelBox
	under: Uint32Array
	zoneId: number
	parentOf: (id: number) => number | undefined
	nameOf: (id: number) => string
	overlays: readonly OverlayPiece[]
	band: number
	w?: number
	h?: number
}): { overlays: OverlayPiece[]; base: Uint8Array } {
	const { look, box, under, zoneId, parentOf, nameOf, band } = opts
	const W = opts.w ?? WORLD_MAP_W
	const H = opts.h ?? WORLD_MAP_H
	const bw = box.u1 - box.u0
	const bh = box.v1 - box.v0
	const painted = new Set<number>()
	for (const a of under) if (a && a !== zoneId && parentOf(a) === zoneId) painted.add(a)
	const overlays = opts.overlays.map((o) => ({ ...o }))
	const taken = new Set(overlays.map((o) => o.name.toUpperCase()))
	// A subzone no overlay names, which an overlay's art already mostly covers (Echo Ridge Mine inside
	// Elwynn's Northshire Valley piece), is drawn into that one, as the client's maps do; otherwise it
	// gets its own.
	const joined = new Map<number, Set<number>>()
	const n0 = overlays.length
	for (const a of [...painted].sort((x, y) => x - y)) {
		if (overlays.some((o) => o.areas.includes(a))) continue
		let count = 0
		for (const v of under) if (v === a) count++
		let best = -1
		let bestCover = 0
		for (let n = 0; n < n0; n++) {
			const o = overlays[n]
			if (!o.pixels) continue
			const ow = o.box.u1 - o.box.u0
			let cover = 0
			for (let y = Math.max(box.v0, o.box.v0); y < Math.min(box.v1, o.box.v1); y++) {
				for (let x = Math.max(box.u0, o.box.u0); x < Math.min(box.u1, o.box.u1); x++) {
					if (under[(y - box.v0) * bw + x - box.u0] === a) cover += o.pixels[((y - o.box.v0) * ow + x - o.box.u0) * 4 + 3] / 255
				}
			}
			if (cover > bestCover) {
				best = n
				bestCover = cover
			}
		}
		if (best >= 0 && bestCover >= count / 2) {
			joined.set(best, (joined.get(best) ?? new Set()).add(a))
			continue
		}
		const name = overlayName(nameOf(a), taken)
		taken.add(name)
		overlays.push({ id: 0, areas: [a], name, box: { u0: 0, v0: 0, u1: 0, v1: 0 }, hit: { top: 0, left: 0, bottom: 0, right: 0 }, pixels: null, changed: true })
	}
	// How much of the new drawing a pixel of the box takes: all of it inside, fading over the band at
	// the box's edges inside the picture, so an overlay's old art outside the box joins it.
	const weight = (x: number, y: number) => {
		if (band <= 0) return 1
		let d = Infinity
		if (box.u0 > 0) d = Math.min(d, x)
		if (box.v0 > 0) d = Math.min(d, y)
		if (box.u1 < W) d = Math.min(d, bw - 1 - x)
		if (box.v1 < H) d = Math.min(d, bh - 1 - y)
		return d >= band ? 1 : (d + 0.5) / band
	}
	const all = new Float32Array(bw * bh)
	for (let n = 0; n < overlays.length; n++) {
		const o = overlays[n]
		const more = joined.get(n)
		if (!more && !o.areas.some((a) => painted.has(a))) {
			// Its subzones aren't painted in the box: its old art is cleared over the block's chunks of
			// other areas (#278), fading over the band like a redrawn one, and kept where the chunk is
			// still one of its own or off the block, so its soft edge past the box stays. Only when its
			// art shows (half there or more) past the band: a neighbour whose soft edge just spills over
			// the block's edge (Goldshire's, Stormwind's beside Northshire) keeps the client's art.
			if (!o.pixels || o.box.u1 <= box.u0 || o.box.u0 >= box.u1 || o.box.v1 <= box.v0 || o.box.v0 >= box.v1) continue
			const ow = o.box.u1 - o.box.u0
			const oh = o.box.v1 - o.box.v0
			const px = o.pixels.slice()
			let deep = false
			let cleared = false
			for (let y = Math.max(box.v0, o.box.v0); y < Math.min(box.v1, o.box.v1); y++) {
				for (let x = Math.max(box.u0, o.box.u0); x < Math.min(box.u1, o.box.u1); x++) {
					const a = under[(y - box.v0) * bw + x - box.u0]
					if (!a || o.areas.includes(a)) continue
					const d = ((y - o.box.v0) * ow + x - o.box.u0) * 4 + 3
					const wt = weight(x - box.u0, y - box.v0)
					if (wt >= 1 && px[d] >= 128) deep = true
					const k = Math.round(px[d] * (1 - wt))
					if (k === px[d]) continue
					px[d] = k
					cleared = true
				}
			}
			if (deep && cleared) overlays[n] = trimmed(o, px, o.box.u0, o.box.v0, ow, oh)
			continue
		}
		const m = areaMask(under, bw, bh, new Set([...o.areas, ...(more ?? [])]))
		for (let i = 0; i < m.length; i++) all[i] = Math.max(all[i], m[i])
		// The overlay's new box: its old one and the box's part where the mask shows.
		const had = o.pixels && o.box.u1 > o.box.u0 ? o.box : null
		const u = had ? { ...had } : { u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity }
		for (let y = 0; y < bh; y++) {
			for (let x = 0; x < bw; x++) {
				if (m[y * bw + x] <= 0) continue
				u.u0 = Math.min(u.u0, box.u0 + x)
				u.v0 = Math.min(u.v0, box.v0 + y)
				u.u1 = Math.max(u.u1, box.u0 + x + 1)
				u.v1 = Math.max(u.v1, box.v0 + y + 1)
			}
		}
		if (u.u0 === Infinity) continue
		const uw = u.u1 - u.u0
		const uh = u.v1 - u.v0
		const px = new Uint8Array(uw * uh * 4)
		if (had && o.pixels) {
			const hw = had.u1 - had.u0
			for (let y = 0; y < had.v1 - had.v0; y++) px.set(o.pixels.subarray(y * hw * 4, (y + 1) * hw * 4), ((had.v0 - u.v0 + y) * uw + had.u0 - u.u0) * 4)
		}
		// The new drawing over the old, alpha-weighted so the old's hidden colour doesn't bleed in.
		for (let y = Math.max(0, u.v0 - box.v0); y < Math.min(bh, u.v1 - box.v0); y++) {
			for (let x = Math.max(0, u.u0 - box.u0); x < Math.min(bw, u.u1 - box.u0); x++) {
				const a = weight(x, y)
				const s = (y * bw + x) * 4
				const d = ((box.v0 + y - u.v0) * uw + box.u0 + x - u.u0) * 4
				const oldA = (px[d + 3] / 255) * (1 - a)
				const newA = m[y * bw + x] * a
				const outA = oldA + newA
				for (let c = 0; c < 3; c++) px[d + c] = outA > 0 ? Math.round((px[d + c] * oldA + look[s + c] * newA) / outA) : look[s + c]
				px[d + 3] = Math.round(Math.min(1, outA) * 255)
			}
		}
		overlays[n] = trimmed(o, px, u.u0, u.v0, uw, uh)
	}
	// A new overlay that came out empty is dropped; a client's that did is dropped from the table too.
	return { overlays: overlays.filter((o) => o.pixels || (o.id && !o.changed)), base: blankOut(look, all) }
}

/** The picture as a player who has explored everything sees it: the overlays drawn over the base. */
export function explored(base: Uint8Array, overlays: readonly OverlayPiece[], w = WORLD_MAP_W): Uint8Array {
	const out = base.slice()
	for (const o of overlays) {
		if (!o.pixels) continue
		const ow = o.box.u1 - o.box.u0
		for (let y = 0; y < o.box.v1 - o.box.v0; y++) {
			for (let x = 0; x < ow; x++) {
				const s = (y * ow + x) * 4
				const a = o.pixels[s + 3] / 255
				if (!a) continue
				const d = ((o.box.v0 + y) * w + o.box.u0 + x) * 4
				for (let c = 0; c < 3; c++) out[d + c] = Math.round(out[d + c] + (o.pixels[s + c] - out[d + c]) * a)
			}
		}
	}
	return out
}
