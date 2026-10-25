// Spray painting, after noggit3's World::sprayTexture: while the button is held, small paint dabs land at
// random points inside the brush circle. Kept apart from TerrainTools so it can be tested on its own.

/** Width of one 1.12 alpha-map texel in world units: a chunk is 100/3 yards and 64 texels across. */
const ALPHA_TEXEL = 100 / 3 / 64

/** Most dabs one frame places, so a huge brush at full pressure can't stall a frame. */
export const MAX_DABS = 2048

/**
 * Radius of one dab for the spray Size setting (1 to 40). noggit3 sizes its spray brush at Size half
 * alpha texels; ours is at least one splat texel (`texel`), so a dab always reaches a texel centre.
 */
export function sprayDabRadius(size: number, texel: number): number {
	return Math.max(texel, (size * ALPHA_TEXEL) / 2)
}

/**
 * Paint amount of one dab, from the brush strength. noggit3 paints a dab with 1 - (1 - strength)^(dt * 10),
 * at one chance per frame; this is that amount for a 60 Hz frame, so the amount doesn't shrink with dt
 * while the dab count already scales with it.
 */
export function sprayAmount(strength: number): number {
	return 1 - Math.pow(1 - Math.min(1, Math.max(0, strength)), 10 / 60)
}

/**
 * Picks this frame's dab centres inside the circle of `radius` around (cx, cz). Writes x, z pairs into
 * `out` and returns the number of dabs.
 *
 * noggit3 lays a grid with a step of a quarter dab radius over the circle and gives each grid point a
 * Pressure/1000 chance per frame. Here the expected count of that grid is drawn at uniformly random
 * points instead, which spreads the same number of dabs without visiting every grid point. The chance is
 * scaled to a 60 Hz frame, so the spray rate doesn't depend on the frame rate.
 */
export function sprayDabs(cx: number, cz: number, radius: number, dab: number, pressure: number, dt: number, rand: () => number, out: Float32Array): number {
	if (radius <= 0 || dab <= 0 || pressure <= 0) return 0
	const step = dab / 4
	const points = Math.PI * (radius / step) ** 2
	const expected = points * (pressure / 1000) * dt * 60
	const n = Math.min(Math.floor(expected + rand()), MAX_DABS, out.length >> 1)
	for (let i = 0; i < n; i++) {
		const r = radius * Math.sqrt(rand())
		const a = 2 * Math.PI * rand()
		out[i * 2] = cx + r * Math.cos(a)
		out[i * 2 + 1] = cz + r * Math.sin(a)
	}
	return n
}
