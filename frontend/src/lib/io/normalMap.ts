// The normal map export (#44, Noggit Red's "Export normalmap"): each vertex's ground normal from the
// heights around it, as an RGB pixel. Noggit Red writes the components straight into the channels,
// which clips every negative one to 0; this writes n · 0.5 + 0.5, the usual encoding, so the image
// keeps the whole normal. X is east (red), Y up (green), Z south (blue), in the editor's axes.

/**
 * The normals of a `side` by `side` vertex grid of `heights` spaced `cell` yards apart, as RGB bytes
 * (three a vertex, row-major), by central differences (one-sided at the edges).
 */
export function normalMapPixels(heights: ArrayLike<number>, side: number, cell: number): Uint8Array {
	const out = new Uint8Array(side * side * 3)
	const h = (x: number, z: number) => heights[Math.min(side - 1, Math.max(0, z)) * side + Math.min(side - 1, Math.max(0, x))]
	for (let z = 0; z < side; z++) {
		for (let x = 0; x < side; x++) {
			const dx = (h(x + 1, z) - h(x - 1, z)) / ((Math.min(side - 1, x + 1) - Math.max(0, x - 1)) * cell || 1)
			const dz = (h(x, z + 1) - h(x, z - 1)) / ((Math.min(side - 1, z + 1) - Math.max(0, z - 1)) * cell || 1)
			const nx = -dx,
				ny = 1,
				nz = -dz
			const len = Math.hypot(nx, ny, nz)
			const o = (z * side + x) * 3
			out[o] = Math.round((nx / len) * 127.5 + 127.5)
			out[o + 1] = Math.round((ny / len) * 127.5 + 127.5)
			out[o + 2] = Math.round((nz / len) * 127.5 + 127.5)
		}
	}
	return out
}

/** Base64 of `bytes`, for the bridge (CLAUDE.md: blobs cross it as base64 strings). */
export function toBase64(bytes: Uint8Array): string {
	let s = ''
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(s)
}
