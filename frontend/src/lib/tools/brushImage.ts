// Image brushes, after Noggit Red's image mask (`MapChunk::stamp`, `ui/tools/UiCommon/ImageMaskSelector`):
// a greyscale image from the user's own folder is laid over the brush's square, turned by a rotation,
// and each vertex or texel's brush weight is multiplied by the grey under it, so the stroke takes the
// image's shape. Kept free of three.js so it can be tested on its own.
import type { Mirror } from './symmetry'

/**
 * The image the brush iterators read while a stroke that uses it ticks (`active`): grey levels 0 to 1,
 * `w` by `h`, and the matrix (a00 a01; a10 a11) that takes an offset from the brush centre into the
 * image's frame: the rotation undone, and a symmetric stroke's copy undone too (#182), so a mirrored
 * dab paints the image mirrored. Brush tools switch `active` on for their own stroke only, so the other
 * brushes are never shaped by it.
 */
export const brushImage = { active: false, data: null as Float32Array | null, w: 0, h: 0, a00: 1, a01: 0, a10: 0, a11: 1, bytes: null as Uint8Array | null, version: 0 }

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
	setBrushImageTransform(deg, null)
}

/** Turns the image by `deg` degrees, for the dab a symmetric stroke's copy `m` makes (null for the stroke's own). */
export function setBrushImageTransform(deg: number, m: Mirror | null) {
	const r = (deg * Math.PI) / 180
	const c = Math.cos(r)
	const s = Math.sin(r)
	// The turn undone after the copy undone: R(-turn) times the copy's transpose (its inverse).
	const m00 = m ? m.m00 : 1
	const m01 = m ? m.m01 : 0
	const m10 = m ? m.m10 : 0
	const m11 = m ? m.m11 : 1
	brushImage.a00 = c * m00 + s * m01
	brushImage.a01 = c * m10 + s * m11
	brushImage.a10 = -s * m00 + c * m01
	brushImage.a11 = -s * m10 + c * m11
}

/**
 * The image's grey at offset (dx, dz) from the brush centre, for a brush of `radius`: the image spans
 * the brush's square, turned about the centre. Bilinear between pixels; 0 outside the image. 1 when no
 * image is set.
 */
export function imageWeight(dx: number, dz: number, radius: number): number {
	const d = brushImage.data
	if (!d) return 1
	const { w, h, a00, a01, a10, a11 } = brushImage
	// Into the image's frame: undo the turn (and a symmetric copy), then map [-radius, radius] to the pixel grid.
	const u = ((a00 * dx + a01 * dz) / radius + 1) * 0.5 * w - 0.5
	const v = ((a10 * dx + a11 * dz) / radius + 1) * 0.5 * h - 0.5
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
