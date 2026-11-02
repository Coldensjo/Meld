// The Euclidean distance transform, for a new world's coast (presets.ts `CoastShape`) and its beaches (beach.ts).

/**
 * The squared distance of each sample of `f` (0 the sea, a large number land) to the nearest sea sample: Felzenszwalb and Huttenlocher's transform, rows then columns.
 * With `nearest`, each sample's nearest sea sample's index is written into it too (the feature transform).
 */
export function squaredDistance(f: Float64Array, side: number, nearest?: Int32Array): Float64Array {
	const out = new Float64Array(f)
	const line = new Float64Array(side)
	const res = new Float64Array(side)
	const site = nearest ? new Int32Array(side) : null
	const v = new Int32Array(side)
	const z = new Float64Array(side + 1)
	/** One line of `side` samples from `start`, `step` apart; `rows` for the first pass, whose sites are the samples themselves. */
	const pass = (start: number, step: number, rows: boolean) => {
		for (let k = 0; k < side; k++) line[k] = out[start + k * step]
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
			if (site && nearest) site[q] = rows ? start + v[n] * step : nearest[start + v[n] * step]
		}
		for (let k = 0; k < side; k++) out[start + k * step] = res[k]
		if (site && nearest) for (let k = 0; k < side; k++) nearest[start + k * step] = site[k]
	}
	for (let j = 0; j < side; j++) pass(j * side, 1, true)
	for (let i = 0; i < side; i++) pass(i, side, false)
	return out
}
