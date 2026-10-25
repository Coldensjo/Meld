// Importing a heightmap image onto the map, after Noggit Red's importer (`MapTile::setHeightmapImage`):
// each sample's grey (0 to 1) becomes a height between a min and a max, which is set on the ground, or
// added to it, subtracted from it or multiplied into it. An image of another size is resampled to the
// map's. Kept free of three.js so it can be tested on its own.

/** How the image's heights meet the ground's. */
export type HeightmapMode = 'set' | 'add' | 'subtract' | 'multiply'

/** The heights the Go side decodes an image to (internal/heightmap: black -1024, white +1024). */
export const IMAGE_MIN = -1024
export const IMAGE_MAX = 1024

/** The image's greys (0 to 1) resampled bilinearly to `side` by `side`, from its decoded heights. */
export function imageRatios(img: { side: number; heights: ArrayLike<number> }, side: number): Float32Array {
	const out = new Float32Array(side * side)
	const n = img.side
	const ratio = (i: number) => (img.heights[i] - IMAGE_MIN) / (IMAGE_MAX - IMAGE_MIN)
	for (let z = 0; z < side; z++) {
		const v = side > 1 ? (z * (n - 1)) / (side - 1) : 0
		const z0 = Math.min(n - 1, Math.floor(v))
		const z1 = Math.min(n - 1, z0 + 1)
		const fz = v - z0
		for (let x = 0; x < side; x++) {
			const u = side > 1 ? (x * (n - 1)) / (side - 1) : 0
			const x0 = Math.min(n - 1, Math.floor(u))
			const x1 = Math.min(n - 1, x0 + 1)
			const fx = u - x0
			const top = ratio(z0 * n + x0) * (1 - fx) + ratio(z0 * n + x1) * fx
			const bottom = ratio(z1 * n + x0) * (1 - fx) + ratio(z1 * n + x1) * fx
			out[z * side + x] = top * (1 - fz) + bottom * fz
		}
	}
	return out
}

/** The ground's new heights: each ratio as a height between min and max, put onto `current` by `mode`. */
export function importHeights(current: Float32Array, ratios: Float32Array, mode: HeightmapMode, min: number, max: number): Float32Array {
	const out = new Float32Array(current.length)
	for (let i = 0; i < out.length; i++) {
		const h = min + ratios[i] * (max - min)
		const c = current[i]
		out[i] = mode === 'add' ? c + h : mode === 'subtract' ? c - h : mode === 'multiply' ? c * h : h
	}
	return out
}

/**
 * Noggit Red's per-tile import (`MapTile::setHeightmapImage`): `ratios` (a square image already
 * resampled to its side) put onto the tile whose first vertex is (x0, z0) in a `side`-vertex grid,
 * by `mode`. With `tiledEdges` the image covers the tile less its last row and column, the vertices
 * it shares with the next tiles, which keep their heights, so tiles imported one by one meet
 * without seams. Returns the whole grid, the rest unchanged.
 */
export function importHeightsOnTile(current: Float32Array, side: number, ratios: Float32Array, x0: number, z0: number, mode: HeightmapMode, min: number, max: number): Float32Array {
	const out = current.slice()
	const n = Math.round(Math.sqrt(ratios.length))
	for (let z = 0; z < n && z0 + z < side; z++) {
		for (let x = 0; x < n && x0 + x < side; x++) {
			const i = (z0 + z) * side + x0 + x
			const h = min + ratios[z * n + x] * (max - min)
			const c = current[i]
			out[i] = mode === 'add' ? c + h : mode === 'subtract' ? c - h : mode === 'multiply' ? c * h : h
		}
	}
	return out
}
