import { fetchImage } from './api'
import { COIN_ATLAS, COIN_CELL, type Coin } from './money'

// The coins cut from the client's money atlas (money.ts), once a session per coin and size (#679).

let atlas: Promise<HTMLCanvasElement | null> | null = null
const images = new Map<string, Promise<string | null>>()

/** The atlas on a canvas, read once a session; null when the client has none (or there is no backend). */
function loadAtlas(): Promise<HTMLCanvasElement | null> {
	if (!atlas) {
		atlas = fetchImage(COIN_ATLAS)
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

/** An image URL of a coin at `px` pixels, alpha kept, or null when the client has no money atlas. */
export function coinIcon(coin: Coin, px = 16): Promise<string | null> {
	const key = `${coin}|${px}`
	let p = images.get(key)
	if (!p) {
		p = loadAtlas().then((src) => {
			if (!src) return null
			const out = document.createElement('canvas')
			out.width = out.height = px
			const w = src.width / 4
			out.getContext('2d', { willReadFrequently: true })!.drawImage(src, COIN_CELL[coin] * src.width, 0, w, src.height, 0, 0, px, px)
			return out.toDataURL('image/png')
		})
		images.set(key, p)
	}
	return p
}
