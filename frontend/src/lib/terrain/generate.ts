// A new world's starting ground (#744): a preset's heights (presets.ts), then, when asked, water and
// gravity run over it (erosion.ts), which carve the valleys, gullies and scree that make noise read as
// real ground. Kept free of three.js so it can be tested on its own.
import { Eroder, talusSlope } from './erosion'
import { canyonWall, presetHeight, type CoastShape, type PresetId, type ShapeOptions } from './presets'
import { TILE_YARDS } from '../wow/format'
import { imageRatios } from '../io/heightmapImport'

/** Water drops a cell at full erosion, and thermal passes after them. */
const FULL_DENSITY = 0.8
const FULL_PASSES = 8
/** Ground steeper than this slides at the thermal passes: what keeps a ridged peak from standing as a spike. */
const TALUS_DEG = 42

/**
 * Fills `out`, the (size+1)² heights of a map of `size` cells of `cellSize` yards, with preset `kind`
 * from `seed`, its coast following `shape`'s tiles when given, shaped by `o` (presets.ts
 * `ShapeOptions`; what is left out is that of a plain preset: relief and roughness 1, no erosion).
 */
export function generateHeights(out: Float32Array, size: number, cellSize: number, kind: PresetId, seed: number, shape?: CoastShape | null, o: Partial<ShapeOptions> = {}) {
	const V = size + 1
	const erosion = Math.min(1, Math.max(0, o.erosion ?? 0))
	// A Canyon's walls go on after the erosion: its gullies would cut ramps a player could climb out by.
	const walls = kind === 'canyon' && erosion > 0
	const h = { tiles: (size * cellSize) / TILE_YARDS, shape, relief: o.relief, roughness: o.roughness, seaDepth: o.seaDepth, land: o.land, noWall: walls }
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) out[z * V + x] = presetHeight(kind, x / size, z / size, seed, h)
	if (erosion > 0 && kind !== 'ocean' && kind !== 'flat') erode(out, V, cellSize, erosion, seed)
	if (walls) for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) out[z * V + x] += canyonWall(x / size, z / size, seed, h)
}

/**
 * A new world started from a heightmap image (#745), as Terrain > Import Heightmap reads it (#44): the
 * decoded image (internal/heightmap, through the ReadHeightmap binding), its black at `min` yards and
 * its white at `max`, stretched over the whole map, with the sea at 0 when `sea`.
 */
export interface ImageGround {
	img: { side: number; heights: ArrayLike<number> }
	min: number
	max: number
	sea: boolean
}

/**
 * Fills `out`, the (size+1)² heights of a map of `size` cells of `cellSize` yards, from `g`'s image
 * resampled to the map's grid, then erodes it at `erosion` (0 to 1) as a preset is: off by default,
 * since Gaea and World Machine erode already.
 */
export function imageGroundHeights(out: Float32Array, size: number, cellSize: number, g: ImageGround, erosion = 0, seed = 0) {
	const ratios = imageRatios(g.img, size + 1)
	for (let i = 0; i < out.length; i++) out[i] = g.min + ratios[i] * (g.max - g.min)
	const e = Math.min(1, Math.max(0, erosion))
	if (e > 0) erode(out, size + 1, cellSize, e, seed, g.sea ? 0 : -Infinity)
}

/**
 * Erodes the heights `hs` (`V` a side, yards) in place at `strength` 0 to 1: the Eroder works in cell
 * units. Drops start only on ground above `landAbove` (the sea, or -Infinity on a map without one).
 */
function erode(hs: Float32Array, V: number, cellSize: number, strength: number, seed: number, landAbove = 0) {
	// Drops start on land only: rain on the seabed would carve its ridges as if they stood in the air.
	const spawn = new Float32Array(hs.length)
	let land = 0
	for (let i = 0; i < hs.length; i++) {
		if (hs[i] > landAbove) {
			spawn[i] = 1
			land++
		}
		hs[i] /= cellSize
	}
	const e = new Eroder()
	e.seed(seed + 977)
	e.droplets(hs, V, V, Math.round(strength * FULL_DENSITY * land), spawn)
	const talus = talusSlope(TALUS_DEG)
	const passes = Math.max(1, Math.round(strength * FULL_PASSES))
	// Half strength a pass: at full, ground below a cliff overshoots back and forth into a checkerboard.
	for (let p = 0; p < passes; p++) e.thermal(hs, V, V, talus, 0.5)
	for (let i = 0; i < hs.length; i++) hs[i] *= cellSize
	soften(hs, V)
}

/**
 * Half of a 3x3 blur over the inner vertices, once: drops falling off a cliff leave spikes a vertex
 * wide at its foot (up to 6 yd), which this takes out while the gullies, two cells wide or more, stay.
 */
function soften(hs: Float32Array, V: number) {
	const src = hs.slice()
	for (let z = 1; z < V - 1; z++) {
		for (let x = 1; x < V - 1; x++) {
			const i = z * V + x
			const edges = src[i - 1] + src[i + 1] + src[i - V] + src[i + V]
			const corners = src[i - V - 1] + src[i - V + 1] + src[i + V - 1] + src[i + V + 1]
			hs[i] = src[i] * 0.5 + ((src[i] * 4 + edges * 2 + corners) / 16) * 0.5
		}
	}
}
