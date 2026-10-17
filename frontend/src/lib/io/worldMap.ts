// A zone's in-game world map (#181): its rectangle in the editor's yards and in the client's
// WorldMapArea extent, the zone's bounds from the Map data zones, and the picture's look. Pure, so it
// is tested on its own; World › World Map (WorldMapDialog.svelte) renders and writes it.

/** The size of a zone's world map picture, as the client's frame shows it. */
export const WORLD_MAP_W = 1002
export const WORLD_MAP_H = 668

/** A 1.12 tile is 533 1/3 yards across, and the client measures from 32 tiles in. */
const TILE = 1600 / 3
const ZERO = 32 * TILE

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
 * first tile; 0, 0 for a map made for the client). The client's Y is ZERO less the editor's x, its X is
 * ZERO less z (io/portCoords.ts).
 */
export function extentToRect(e: WorldExtent, tileX = 0, tileY = 0): EditorRect {
	return { x0: ZERO - e.left - tileX * TILE, x1: ZERO - e.right - tileX * TILE, z0: ZERO - e.top - tileY * TILE, z1: ZERO - e.bottom - tileY * TILE }
}

/** The inverse of extentToRect. */
export function rectToExtent(r: EditorRect, tileX = 0, tileY = 0): WorldExtent {
	return { left: ZERO - (r.x0 + tileX * TILE), right: ZERO - (r.x1 + tileX * TILE), top: ZERO - (r.z0 + tileY * TILE), bottom: ZERO - (r.z1 + tileY * TILE) }
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
