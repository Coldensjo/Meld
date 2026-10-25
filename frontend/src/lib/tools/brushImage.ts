// Image brushes, after Noggit Red's image mask (`MapChunk::stamp`, `ui/tools/UiCommon/ImageMaskSelector`):
// a greyscale image from the user's own folder is laid over the brush's square, turned by a rotation,
// and each vertex or texel's brush weight is multiplied by the grey under it, so the stroke takes the
// image's shape. Kept free of three.js so it can be tested on its own.

/**
 * The image the brush iterators read while a stroke that uses it ticks (`active`): grey levels 0 to 1,
 * `w` by `h`, and the rotation's cosine and sine. Brush tools switch `active` on for their own stroke
 * only, so the other brushes are never shaped by it.
 */
export const brushImage = { active: false, data: null as Float32Array | null, w: 0, h: 0, cos: 1, sin: 0, bytes: null as Uint8Array | null, version: 0 }

/** Sets the image (grey bytes, row-major), or clears it with null. */
export function setBrushImage(pix: Uint8Array | null, w = 0, h = 0) {
	brushImage.version++
	if (!pix || !w || !h) {
		brushImage.data = null
		brushImage.bytes = null
		brushImage.w = brushImage.h = 0
		return
	}
	// The grey bytes as they came, for the cursor's texture (the brush ring shows the image).
	brushImage.bytes = pix
	const data = new Float32Array(w * h)
	for (let i = 0; i < data.length; i++) data[i] = pix[i] / 255
	brushImage.data = data
	brushImage.w = w
	brushImage.h = h
}

/** Turns the image by `deg` degrees (clockwise seen from above, as the map's x east and z south). */
export function setBrushImageRotation(deg: number) {
	const r = (deg * Math.PI) / 180
	brushImage.cos = Math.cos(r)
	brushImage.sin = Math.sin(r)
}

/**
 * The image's grey at offset (dx, dz) from the brush centre, for a brush of `radius`: the image spans
 * the brush's square, turned about the centre. Bilinear between pixels; 0 outside the image. 1 when no
 * image is set.
 */
export function imageWeight(dx: number, dz: number, radius: number): number {
	const d = brushImage.data
	if (!d) return 1
	const { w, h, cos, sin } = brushImage
	// Into the image's frame: undo the turn, then map [-radius, radius] to the pixel grid.
	const u = ((dx * cos + dz * sin) / radius + 1) * 0.5 * w - 0.5
	const v = ((-dx * sin + dz * cos) / radius + 1) * 0.5 * h - 0.5
	if (u < -0.5 || v < -0.5 || u > w - 0.5 || v > h - 0.5) return 0
	const x0 = Math.max(0, Math.min(w - 1, Math.floor(u)))
	const y0 = Math.max(0, Math.min(h - 1, Math.floor(v)))
	const x1 = Math.min(w - 1, x0 + 1)
	const y1 = Math.min(h - 1, y0 + 1)
	const fx = Math.max(0, Math.min(1, u - x0))
	const fy = Math.max(0, Math.min(1, v - y0))
	const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx
	const bottom = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx
	return top * (1 - fy) + bottom * fy
}
