import { fetchImage } from './api'
import { CLASS_ATLAS, classCell } from './classes'

// Class icons cut from the client's class atlas (classes.ts), once a session per class and size.

let atlas: Promise<HTMLCanvasElement | null> | null = null
const images = new Map<string, Promise<string | null>>()

/** The atlas on a canvas, read from the client once a session; null when the client has none. */
function loadAtlas(): Promise<HTMLCanvasElement | null> {
	if (!atlas) {
		atlas = fetchImage(CLASS_ATLAS)
			.then((img) => {
				const c = document.createElement('canvas')
				c.width = img.width
				c.height = img.height
				const data = new ImageData(img.width, img.height)
				data.data.set(img.pixels)
				c.getContext('2d', { willReadFrequently: true })!.putImageData(data, 0, 0)
				return c
			})
			.catch(() => null)
	}
	return atlas
}

/** An image URL of a class's icon at `px` pixels, or null when the client or the class has none. */
export function classIcon(id: number, px = 36): Promise<string | null> {
	const cell = classCell(id)
	if (!cell) return Promise.resolve(null)
	const key = `${id}|${px}`
	let p = images.get(key)
	if (!p) {
		p = loadAtlas().then((src) => {
			if (!src) return null
			const [l, r, t, b] = cell
			const out = document.createElement('canvas')
			out.width = out.height = px
			out.getContext('2d', { willReadFrequently: true })!.drawImage(src, l * src.width, t * src.height, (r - l) * src.width, (b - t) * src.height, 0, 0, px, px)
			return out.toDataURL('image/png')
		})
		images.set(key, p)
	}
	return p
}
