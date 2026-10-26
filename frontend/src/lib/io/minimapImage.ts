// The map from above as the Minimap window draws it: the ground grey by height and blue under the sea,
// a pixel per cell. Kept free of the DOM so it can be tested on its own; `saveMinimapImage` in images.ts
// draws it with the overview and the tile borders into a PNG.

/**
 * Shades the map's heights into `out` (RGBA, `size` pixels a side, a pixel per cell): grey from dark
 * to light between the lowest dry ground and the highest point, and blue under `sea`, darker the
 * deeper. Pass -Infinity as `sea` for a map without one.
 */
export function shadeHeights(heights: Float32Array, size: number, sea: number, out: Uint8ClampedArray) {
	const V = size + 1
	let lo = Infinity
	let hi = -Infinity
	for (let i = 0; i < heights.length; i++) {
		const h = heights[i]
		if (h < lo) lo = h
		if (h > hi) hi = h
	}
	const base = Math.max(lo, sea)
	const span = Math.max(1, hi - base)
	for (let z = 0; z < size; z++) {
		for (let x = 0; x < size; x++) {
			const h = heights[z * V + x]
			const i = (z * size + x) * 4
			if (h < sea) {
				const depth = Math.min(1, (sea - h) / 30)
				out[i] = 20 + 20 * (1 - depth)
				out[i + 1] = 60 + 40 * (1 - depth)
				out[i + 2] = 110 + 50 * (1 - depth)
			} else {
				const v = 70 + 150 * Math.min(1, (h - base) / span)
				out[i] = v
				out[i + 1] = v
				out[i + 2] = v * 0.92
			}
			out[i + 3] = 255
		}
	}
}

/** The pixels a cell takes in a saved minimap, so a small map still saves at least 512 pixels across. */
export function minimapScale(size: number) {
	return Math.max(1, Math.ceil(512 / size))
}

/**
 * What the minimap last drew: the terrain object, its heights version and the sea level. A new map
 * starts its own count, so two maps of one size both stand at version 1 after their first upload, and
 * a key of size and version alone kept the old map's picture over a new world (#749).
 */
export class MinimapDrawn {
	private terrain: object | null = null
	private version = -1
	private sea = NaN

	/** Whether the picture needs drawing for `terrain` at heights `version` under `sea`; when it does, records it as drawn. */
	stale(terrain: object, version: number, sea: number): boolean {
		if (terrain === this.terrain && version === this.version && sea === this.sea) return false
		this.terrain = terrain
		this.version = version
		this.sea = sea
		return true
	}
}
