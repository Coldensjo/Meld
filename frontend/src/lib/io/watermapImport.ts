// Importing a watermap image, as the owner decided for Noggit Red's unfinished watermap import
// (`TileWater::setWatermapImage`): black is no water, and a grey puts the water's surface at the ground's
// height plus min + grey × (max − min), so a river image follows the terrain. A cell gets water where
// all four of its corners are not black. Kept free of three.js so it can be tested on its own.
import { LIQUID_WATER, type LiquidClipCell } from '../water/liquids'

/** A grey at or under this counts as black (an image stretched over the map blurs its black edges a little). */
export const BLACK = 0.5 / 255

/**
 * The water cells a watermap gives: `ratios` and `ground` hold one value per vertex of a map `cells`
 * cells a side (rows of cells + 1). Each covered cell's corners rise min + grey × (max − min) above the
 * ground under them.
 */
export function watermapCells(ratios: Float32Array, ground: Float32Array, cells: number, min: number, max: number): LiquidClipCell[] {
	const verts = cells + 1
	const surface = (i: number) => ground[i] + min + ratios[i] * (max - min)
	const out: LiquidClipCell[] = []
	for (let z = 0; z < cells; z++) {
		for (let x = 0; x < cells; x++) {
			const i = z * verts + x
			const k = [i, i + 1, i + verts, i + verts + 1]
			if (k.some((v) => ratios[v] <= BLACK)) continue
			out.push({ x, z, id: LIQUID_WATER, heights: [surface(k[0]), surface(k[1]), surface(k[2]), surface(k[3])], depth: [1, 1, 1, 1] })
		}
	}
	return out
}
