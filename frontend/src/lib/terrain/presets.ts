import { fbm, ridged } from '../engine/noise'
import { TILE_YARDS } from '../wow/format'
import { LIQUID_MAGMA, LIQUID_SLIME } from '../water/liquids'
import { LAKE_RULES, findLakes } from '../water/lakes'

// The starting shapes a new world can have. Every preset but Flat land and Canyon is an island: the
// ground falls away to the sea towards the map's edge, so a world is bounded by water, which the client
// renders as endless ocean beyond the map. Canyon is bounded by mountains instead.

export type PresetId = 'ocean' | 'flat' | 'island' | 'archipelago' | 'hills' | 'mountains' | 'highlands' | 'lakeland' | 'canyon'

export interface Preset {
	id: PresetId
	name: string
	blurb: string
	/** Whether the world starts with water, and at what height. */
	water: boolean
	waterLevel: number
}

/** Seabed height of new ground added to a map (Map Properties growing it); water sits at 0. */
export const OCEAN_FLOOR = -12

export const PRESETS: readonly Preset[] = [
	{ id: 'ocean', name: 'Open sea', blurb: 'Deep water over a seabed of ridges, trenches and shoals. Raise land wherever you like.', water: true, waterLevel: 0 },
	{ id: 'island', name: 'Island', blurb: 'One rugged island with beaches and a hilly middle.', water: true, waterLevel: 0 },
	{ id: 'archipelago', name: 'Archipelago', blurb: 'A scatter of small islands in a shallow sea.', water: true, waterLevel: 0 },
	{ id: 'hills', name: 'Rolling hills', blurb: 'Soft green hills, ringed by the sea.', water: true, waterLevel: 0 },
	{ id: 'lakeland', name: 'Lakeland', blurb: 'Low hills with lakes and ponds between them.', water: true, waterLevel: 0 },
	{ id: 'highlands', name: 'Highlands', blurb: 'A high plateau with cliffs down to the shore.', water: true, waterLevel: 0 },
	{ id: 'mountains', name: 'Mountains', blurb: 'Steep ridged peaks, snow on top, sea all round.', water: true, waterLevel: 0 },
	{ id: 'canyon', name: 'Canyon', blurb: 'Open plains walled in by mountains too high and steep to cross.', water: false, waterLevel: -2 },
	{ id: 'flat', name: 'Flat land', blurb: 'Level ground to the edge of the map, and no water.', water: false, waterLevel: -2 },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]

const smoothstep = (e0: number, e1: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
	return t * t * (3 - 2 * t)
}

/** Samples of the shape's distance field a tile side: a coast within a tenth of a tile of its curve. */
const SHAPE_SAMPLES = 16

/**
 * The shape of a map whose tiles aren't its whole square (#46, the owner's 5A): how deep inside its
 * tiles a point lies, so an island's coast follows the tiles and the sea fills their edges. A distance
 * field to the nearest tile left out (or the square's edge), in samples of SHAPE_SAMPLES a tile.
 */
export class CoastShape {
	/** Samples a side, with a ring of sea round the square. */
	private readonly side: number
	/** Each sample's distance to the sea, over the deepest one's (0 at the coast, 1 the deepest). */
	private readonly depthOf: Float32Array

	constructor(
		/** A byte a tile, 1 a present one, row by row (terrain/tileMask.ts `maskBytes`). */
		readonly mask: Uint8Array,
		/** The square's side in tiles. */
		readonly tiles: number,
	) {
		const g = tiles * SHAPE_SAMPLES
		const side = g + 2
		this.side = side
		const INF = 1e20
		const f = new Float64Array(side * side)
		for (let j = 0; j < side; j++) {
			for (let i = 0; i < side; i++) {
				const inside = i > 0 && j > 0 && i <= g && j <= g && mask[Math.floor((j - 1) / SHAPE_SAMPLES) * tiles + Math.floor((i - 1) / SHAPE_SAMPLES)] !== 0
				f[j * side + i] = inside ? INF : 0
			}
		}
		const d2 = squaredDistance(f, side)
		let max = 0
		const depth = new Float32Array(side * side)
		for (let k = 0; k < depth.length; k++) {
			depth[k] = Math.sqrt(d2[k])
			max = Math.max(max, depth[k])
		}
		for (let k = 0; k < depth.length; k++) depth[k] /= max || 1
		this.depthOf = depth
	}

	/** Whether (u, v) in 0..1 of the square is on one of the map's tiles. */
	present(u: number, v: number): boolean {
		const n = this.tiles
		const tx = Math.min(n - 1, Math.max(0, Math.floor(u * n)))
		const ty = Math.min(n - 1, Math.max(0, Math.floor(v * n)))
		return this.mask[ty * n + tx] !== 0
	}

	/** How deep inside the tiles (u, v) lies: 0 at the coast and off them, 1 at the deepest point, bilinear. */
	depth(u: number, v: number): number {
		const side = this.side
		// Sample i's middle is at u = (i - 0.5) / g.
		const x = Math.min(side - 1.001, Math.max(0, u * (side - 2) + 0.5))
		const y = Math.min(side - 1.001, Math.max(0, v * (side - 2) + 0.5))
		const i = Math.floor(x)
		const j = Math.floor(y)
		const fx = x - i
		const fy = y - j
		const d = this.depthOf
		const a = d[j * side + i] * (1 - fx) + d[j * side + i + 1] * fx
		const b = d[(j + 1) * side + i] * (1 - fx) + d[(j + 1) * side + i + 1] * fx
		return a * (1 - fy) + b * fy
	}
}

/** The squared distance of each sample of `f` (0 the sea, a large number land) to the nearest sea sample: Felzenszwalb and Huttenlocher's transform, rows then columns. */
function squaredDistance(f: Float64Array, side: number): Float64Array {
	const out = new Float64Array(f)
	const line = new Float64Array(side)
	const res = new Float64Array(side)
	const v = new Int32Array(side)
	const z = new Float64Array(side + 1)
	const pass = (get: (k: number) => number, set: (k: number, x: number) => void) => {
		for (let k = 0; k < side; k++) line[k] = get(k)
		let n = 0
		v[0] = 0
		z[0] = -Infinity
		z[1] = Infinity
		for (let q = 1; q < side; q++) {
			let s = (line[q] + q * q - (line[v[n]] + v[n] * v[n])) / (2 * q - 2 * v[n])
			while (s <= z[n]) {
				n--
				s = (line[q] + q * q - (line[v[n]] + v[n] * v[n])) / (2 * q - 2 * v[n])
			}
			n++
			v[n] = q
			z[n] = s
			z[n + 1] = Infinity
		}
		n = 0
		for (let q = 0; q < side; q++) {
			while (z[n + 1] < q) n++
			res[q] = (q - v[n]) * (q - v[n]) + line[v[n]]
		}
		for (let k = 0; k < side; k++) set(k, res[k])
	}
	for (let j = 0; j < side; j++)
		pass(
			(k) => out[j * side + k],
			(k, x) => (out[j * side + k] = x),
		)
	for (let i = 0; i < side; i++)
		pass(
			(k) => out[k * side + i],
			(k, x) => (out[k * side + i] = x),
		)
	return out
}

/**
 * How much of the land stands at (u, v) in 0..1 of the map: 1 well inside, 0 at the edge, with a
 * ragged coastline. Every island preset multiplies its land by this. With a `shape`, the edge is its
 * tiles' (CoastShape), so the coast follows them.
 */
function coast(u: number, v: number, seed: number, shape: CoastShape | null | undefined, land: number): number {
	// The shore's start moves with `land`: 0.1 at 0 (a small island), 0.6 at 0.5 (the default), 1.35 at 1 (past the corners, so land reaches the edge).
	const lo = land < 0.5 ? 0.1 + land : 0.6 + (land - 0.5) * 1.5
	return 1 - smoothstep(lo, lo + 0.35, edge(u, v, seed, shape))
}

/**
 * How near (u, v) lies to the map's edge, ragged: about 0 in the middle and 1 at the edge (or at the
 * tiles left out, with a `shape`). Between a circle and a square, so an island fills the map without
 * touching its edges.
 */
function edge(u: number, v: number, seed: number, shape?: CoastShape | null): number {
	const ragged = (fbm(u * 3 + 11, v * 3 + 7, 3, seed + 101) - 0.5) * 0.3
	if (shape) return 1 - shape.depth(u, v) + ragged
	const dx = u - 0.5
	const dz = v - 0.5
	const round = Math.sqrt(dx * dx + dz * dz) * 2
	const square = Math.max(Math.abs(dx), Math.abs(dz)) * 2
	return round * 0.65 + square * 0.35 + ragged
}

/**
 * The seabed at (x, y) in tiles, at most 4 yd under the water: about 60 yd down at `depth` 1, with
 * trenches, ridges and seamounts that come up into shoals, all scaled by `depth`.
 */
function seabed(x: number, y: number, seed: number, depth: number): number {
	const n = fbm(x * 1.3, y * 1.3, 5, seed + 307)
	const r = ridged(x * 0.9 + 4, y * 0.9 + 6, 5, seed + 301)
	return Math.min(-4, -(14 + 46 * depth) + ((n - 0.5) * 50 + r * r * 55) * depth)
}

/** A Canyon wall's height in yards over its floor: whatever the Height slider, too high and steep to walk up. */
const CANYON_WALL = 300
/** Yards of a Canyon's wall from its foot to its crest at most; less on a small map, which makes it steeper. */
const CANYON_BAND = 220

/**
 * How a new world's ground is drawn beyond its preset (#744), the New world page's sliders. `relief`
 * scales the land's height above the sea, `roughness` the small detail laid over it (0 none), and
 * `erosion` (0 to 1) how much water and gravity carve it once made (`generateHeights`), and `seaDepth`
 * how deep the open sea's floor lies (1 about 60 yd down), and `land` (0 to 1) how much of the map is
 * land: a small island in open sea at 0, the preset's own coast at 0.5, land up to the edges at 1.
 */
export interface ShapeOptions {
	relief: number
	roughness: number
	erosion: number
	seaDepth: number
	land: number
}

/** The New world page's defaults. */
export const DEFAULT_SHAPE: ShapeOptions = { relief: 1, roughness: 1, erosion: 0.5, seaDepth: 1, land: 0.5 }

/** How a map is shaped by `presetHeight`, beyond its preset and seed. */
export interface HeightOptions {
	/** The map's side in tiles (533 yd each); the noise is laid out in tiles, so detail keeps its size on a big map. */
	tiles: number
	/** Its tiles when they aren't the whole square, for the coast. */
	shape?: CoastShape | null
	relief?: number
	roughness?: number
	seaDepth?: number
	/** How much of the map is land, 0 to 1 (`ShapeOptions.land`); a Canyon's walls and the ocean ignore it. */
	land?: number
	/** Leaves a Canyon's walls out, for `generateHeights` to lay them on after erosion (`canyonWall`). */
	noWall?: boolean
}

/**
 * Ground height in yards at (u, v) in 0..1 of the map for a preset. The coast is laid out over the map
 * (an island fills it whatever its size), but the hills and ridges in tiles, through domain-warped
 * noise (its coordinates bent by more noise, so ridges and shores wind), so a 6x6 world has more of
 * them rather than the same few stretched. Heights are in real yards: Rolling hills rise to about
 * 50 yd as Elwynn's do, Mountains to well over 200. Off the coast the ground goes down to the open
 * sea's floor (`seabed`), and a Canyon's walls stand over 300 yd whatever the Height.
 */
export function presetHeight(id: PresetId, u: number, v: number, seed: number, o: HeightOptions): number {
	if (id === 'flat') return 0
	const p = u * o.tiles
	const q = v * o.tiles
	const x = warpX(p, q, seed)
	const y = warpY(p, q, seed)
	const depth = o.seaDepth ?? 1
	if (id === 'ocean') return seabed(x, y, seed, depth)
	const land = Math.min(1, Math.max(0, o.land ?? 0.5))
	const c = coast(u, v, seed, o.shape, land)
	let h: number
	/** How far out into the open sea the point is (0 on and round the land, 1 out at sea), for the seabed. */
	let open = 1 - c
	/** Height laid on after Height scales the land: a Canyon's walls. */
	let wall = 0
	switch (id) {
		case 'island': {
			const n = fbm(x * 2, y * 2, 6, seed)
			const r = ridged(x * 1.4, y * 1.4, 6, seed + 3)
			h = c * (12 + n * 34 + r * r * 110) - 8
			break
		}
		case 'archipelago': {
			// Broad noise over the map decides where islands rise; the sea between them is shallow.
			const where = smoothstep(0.64 - 0.28 * land, 0.78 - 0.28 * land, fbm(u * 4, v * 4, 4, seed + 5))
			const n = fbm(x * 3, y * 3, 5, seed)
			h = c * where * (14 + n * 36) - 6
			open = 1 - c * where
			break
		}
		case 'hills': {
			const n = fbm(x * 1.6, y * 1.6, 6, seed)
			h = c * (26 + (n - 0.5) * 90) - 8
			break
		}
		case 'lakeland': {
			const n = fbm(x * 1.6, y * 1.6, 6, seed)
			// Lakes: dips where a second noise runs high, cut below the water line.
			const lake = smoothstep(0.58, 0.7, fbm(x * 2.4 + 3, y * 2.4 + 9, 4, seed + 17))
			h = c * (14 + (n - 0.5) * 44 - lake * 40) - 7
			break
		}
		case 'highlands': {
			// A plateau with a steep rim: the coast mask squared and stepped makes the cliffs.
			const rim = smoothstep(0.25, 0.6, c)
			const n = fbm(x * 2, y * 2, 5, seed)
			const r = ridged(x * 1.6, y * 1.6, 5, seed + 9)
			h = rim * (55 + (n - 0.5) * 30 + r * 26) + c * 4 - 10
			break
		}
		case 'mountains': {
			const base = fbm(x * 1.1, y * 1.1, 5, seed)
			const r = ridged(x, y, 7, seed + 7)
			const mask = smoothstep(0.4, 0.75, base)
			h = c * (12 + (base - 0.45) * 44 + r * r * 260 * mask) - 8
			break
		}
		case 'canyon': {
			// A floor of low rolling plains, and the wall round it.
			const n = fbm(x * 1.4, y * 1.4, 5, seed)
			h = 6 + (n - 0.5) * 22
			open = 0
			if (!o.noWall) wall = canyonWall(u, v, seed, o)
			break
		}
	}
	// Out at sea, the ground goes down to the seabed, from a shallow shelf just off the shore.
	if (h < 0 && open > 0) h += open * smoothstep(0, 6, -h) * (seabed(x, y, seed, depth) - h)
	// Small detail down to a few cells, stronger on high ground and fading out under the sea; unwarped,
	// since the warp would stretch it into streaks.
	const rough = o.roughness ?? 1
	if (rough > 0) {
		const land = smoothstep(-4, 4, h)
		h += (fbm(p * 7, q * 7, 6, seed + 61) - 0.5) * rough * land * (14 + Math.max(0, h) * 0.2)
	}
	const relief = o.relief ?? 1
	return (h > 0 ? h * relief : h) + wall
}

// The noise's coordinates in tiles, warped by up to about a sixth of a tile (90 yd) each way.
const warpX = (p: number, q: number, seed: number) => p + (fbm(p * 0.7 + 5.2, q * 0.7 + 1.3, 3, seed + 201) - 0.5) * 0.6
const warpY = (p: number, q: number, seed: number) => q + (fbm(p * 0.7 + 9.7, q * 0.7 + 2.8, 3, seed + 211) - 0.5) * 0.6

/**
 * A Canyon's wall at (u, v), over its floor: a smoothstep from its foot to its crest across at most
 * CANYON_BAND yards, so the middle of the wall is everywhere far steeper than the 50 degrees a player
 * (or the server's paths) can climb, with ridged peaks along the crest. Height doesn't scale it.
 */
export function canyonWall(u: number, v: number, seed: number, o: HeightOptions): number {
	const p = u * o.tiles
	const q = v * o.tiles
	const x = warpX(p, q, seed)
	const y = warpY(p, q, seed)
	const half = (o.tiles * TILE_YARDS) / 2
	const band = Math.min(CANYON_BAND, half * 0.45)
	const inside = (1 - edge(u, v, seed, o.shape)) * half
	const t = smoothstep(band + 40, 40, inside)
	if (t <= 0) return 0
	const r = ridged(x * 1.2, y * 1.2, 6, seed + 13)
	return t * (CANYON_WALL + r * 140)
}

/** The height above which `Terrain.autoPaint` lays snow, for a map whose highest ground is `maxH`: high ground only, never a hilltop. */
export function snowLine(waterLevel: number, maxH: number): number {
	return Math.max(waterLevel + 110, maxH * 0.72)
}

/**
 * Paints a bird's-eye picture of a preset onto a canvas: sea by depth, land from sand through green
 * to rock (by slope, as `autoPaint` does) and snow, lit from the north-west. `px` pixels a side. With
 * `o.shape`, over its square, the tiles left out dark. Erosion isn't drawn: it is too slow to run here.
 */
export function drawPresetPreview(canvas: HTMLCanvasElement, id: PresetId, seed: number, px: number, o: HeightOptions, water?: WorldWater) {
	const s = px + 1
	const h = new Float32Array(s * s)
	for (let y = 0; y <= px; y++) for (let x = 0; x <= px; x++) h[y * s + x] = presetHeight(id, x / px, y / px, seed, o)
	const p = presetById(id)
	drawHeights(canvas, h, px, p.water ? (water?.sea ?? p.waterLevel) : null, o.tiles, o.shape, water?.lakes)
}

/** The New world page's water (#759): the sea's level, and the lakes' liquid when they are on; for its pictures and `Engine.newDocument`. */
export interface WorldWater {
	sea?: number
	/** LiquidType.dbc ID of the lakes, or null for none. */
	lakes?: number | null
}

/** A lake's colour in a picture by its liquid: magma, slime, else water. */
function lakeColour(id: number): [number, number, number] {
	return id === LIQUID_MAGMA ? [222, 92, 30] : id === LIQUID_SLIME ? [112, 172, 58] : [78, 148, 196]
}

/**
 * Paints heights `h` ((px+1)² yards, over a map of `tiles` a side) as `drawPresetPreview` does: the sea
 * below `sea` (null for none), with `lakes` (a LiquidType.dbc ID) the basins' lakes of that liquid
 * (`findLakes`), and with `shape` the tiles left out dark. Also the From a heightmap card's (#745).
 */
export function drawHeights(canvas: HTMLCanvasElement, h: Float32Array, px: number, sea: number | null, tiles: number, shape?: CoastShape | null, lakes?: number | null) {
	canvas.width = canvas.height = px
	const ctx = canvas.getContext('2d')
	if (!ctx) return
	const img = ctx.createImageData(px, px)
	const s = px + 1
	let maxH = 0
	for (const v of h) maxH = Math.max(maxH, v)
	const level = sea ?? 0
	const water = sea !== null
	const snow = snowLine(level, maxH)
	// Yards a pixel, for the slope.
	const cell = (tiles * TILE_YARDS) / px
	const lake = lakes ? findLakes(h, s, cell, { ...LAKE_RULES, sea }) : null
	const lakeRgb = lakes ? lakeColour(lakes) : null
	for (let y = 0; y < px; y++) {
		for (let x = 0; x < px; x++) {
			const v = h[y * s + x]
			let r: number, g: number, b: number
			if (shape && !shape.present((x + 0.5) / px, (y + 0.5) / px)) [r, g, b] = [24, 26, 30]
			else if (lake && lakeRgb && !Number.isNaN(lake[y * s + x])) [r, g, b] = lakeRgb
			else if (water && v < level) {
				const d = Math.min(1, (level - v) / 90)
				r = 70 - d * 50
				g = 140 - d * 80
				b = 190 - d * 70
			} else {
				const dx = h[y * s + x + 1] - v
				const dz = h[(y + 1) * s + x] - v
				const slope = Math.hypot(dx, dz) / cell
				if (v < level + 1.2 && water) [r, g, b] = [196, 182, 128]
				else if (v > snow) [r, g, b] = [230, 232, 236]
				else if (slope > 0.55) [r, g, b] = [120, 108, 92]
				else {
					const t = Math.min(1, v / 120)
					;[r, g, b] = [86 + t * 40, 128 + t * 6, 56 + t * 10]
				}
				// Shade by the slope towards the light.
				const light = Math.min(1.3, Math.max(0.55, 1 - ((dx + dz) / cell) * 0.7))
				r *= light
				g *= light
				b *= light
			}
			const i = (y * px + x) * 4
			img.data[i] = r
			img.data[i + 1] = g
			img.data[i + 2] = b
			img.data[i + 3] = 255
		}
	}
	ctx.putImageData(img, 0, 0)
}
