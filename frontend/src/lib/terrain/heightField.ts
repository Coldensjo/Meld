/**
 * Bilinear height of a heightmap at world position (x, z): `heights` is `size + 1` vertices a side,
 * `cellSize` apart. Positions outside the map clamp to its edge. Pure, so the terrain, the shadow bake
 * and the tests share one.
 */
export function heightAt(heights: ArrayLike<number>, size: number, cellSize: number, x: number, z: number): number {
	const fx = Math.min(Math.max(x / cellSize, 0), size)
	const fz = Math.min(Math.max(z / cellSize, 0), size)
	const x0 = Math.min(Math.floor(fx), size - 1)
	const z0 = Math.min(Math.floor(fz), size - 1)
	const tx = fx - x0
	const tz = fz - z0
	const V = size + 1
	const a = heights[z0 * V + x0]
	const b = heights[z0 * V + x0 + 1]
	const c = heights[(z0 + 1) * V + x0]
	const e = heights[(z0 + 1) * V + x0 + 1]
	return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz
}
