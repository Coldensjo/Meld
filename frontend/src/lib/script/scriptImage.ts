// The image work the Node Editor's image nodes ask of the script API (#1090), done here rather than pixel
// by pixel in Lua: a Gaussian blur and a bilinear resize of a script image's RGBA bytes.
import type { ScriptImage } from './scriptApi'

/** Blurs an image in place with a Gaussian of `sigma` pixels, `passes` times, the edges clamped. */
export function blurImage(img: ScriptImage, sigma: number, passes: number) {
	if (!(sigma > 0) || !(passes > 0)) return
	const r = Math.min(Math.ceil(sigma * 3), Math.max(img.width, img.height))
	const kernel = new Float32Array(r * 2 + 1)
	let sum = 0
	for (let i = -r; i <= r; i++) sum += kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
	for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
	const { width: w, height: h, data } = img
	const tmp = new Float32Array(w * h * 4)
	for (let p = 0; p < passes; p++) {
		// Across, into tmp; then down, back into the bytes.
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				for (let c = 0; c < 4; c++) {
					let v = 0
					for (let k = -r; k <= r; k++) {
						const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k
						v += data[(y * w + sx) * 4 + c] * kernel[k + r]
					}
					tmp[(y * w + x) * 4 + c] = v
				}
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				for (let c = 0; c < 4; c++) {
					let v = 0
					for (let k = -r; k <= r; k++) {
						const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k
						v += tmp[(sy * w + x) * 4 + c] * kernel[k + r]
					}
					data[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(v)))
				}
	}
}

/** A copy of an image stretched to w by h, each pixel sampled bilinearly at its centre. */
export function resizeImage(img: ScriptImage, w: number, h: number): ScriptImage {
	const out: ScriptImage = { width: w, height: h, data: new Uint8Array(w * h * 4) }
	const { width: sw, height: sh, data } = img
	for (let y = 0; y < h; y++) {
		const fy = Math.max(0, Math.min(sh - 1, ((y + 0.5) * sh) / h - 0.5))
		const y0 = Math.floor(fy)
		const y1 = Math.min(sh - 1, y0 + 1)
		const ty = fy - y0
		for (let x = 0; x < w; x++) {
			const fx = Math.max(0, Math.min(sw - 1, ((x + 0.5) * sw) / w - 0.5))
			const x0 = Math.floor(fx)
			const x1 = Math.min(sw - 1, x0 + 1)
			const tx = fx - x0
			for (let c = 0; c < 4; c++) {
				const a = data[(y0 * sw + x0) * 4 + c] * (1 - tx) + data[(y0 * sw + x1) * 4 + c] * tx
				const b = data[(y1 * sw + x0) * 4 + c] * (1 - tx) + data[(y1 * sw + x1) * 4 + c] * tx
				out.data[(y * w + x) * 4 + c] = Math.round(a * (1 - ty) + b * ty)
			}
		}
	}
	return out
}
