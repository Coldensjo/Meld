// The Euclidean distance transform, for a new world's coast (presets.ts `CoastShape`) and its beaches (beach.ts).

/** The squared distance of each sample of `f` (0 the sea, a large number land) to the nearest sea sample: Felzenszwalb and Huttenlocher's transform, rows then columns. */
export function squaredDistance(f: Float64Array, side: number): Float64Array {
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
