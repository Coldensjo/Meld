import * as THREE from 'three'
import { compressedTexturesOn, fetchImage, fetchTextureDXT, type RawImage } from '../wow/api'
import { applySheen, sheenPath } from './sheen'
import {
	LAYER_BYTES,
	RES,
	blockResamplable,
	dxtLevel,
	encodeAlpha,
	encodeColour,
	solidLayer,
	writeAlpha,
	writeColour,
} from './paletteBlocks'

// The map's texture palette as one array texture: layer i is palette entry i. Each entry is a WoW
// tileset path, or a '#rrggbb' colour that stands in for a texture while none is set. WoW
// textures are resampled to PALETTE_RES, so one array holds them all. A layer's alpha is its sheen
// mask: the alpha of the texture's `_s` twin (`Foo_s.blp`), which the client's terrain specular
// reads (Benilla's terrain.rs), or 0 for a texture without one.
//
// Where the renderer samples S3TC (`compressedTexturesOn`, #178) the array is DXT3, 64 KB a layer,
// built mostly from the BLPs' own blocks (paletteBlocks.ts, #216); otherwise (`?nodxt`) it is RGBA,
// 256 KB a layer. Either way it has no mips, and a texture that arrives re-uploads its layer alone.

export const PALETTE_RES = RES

/** Colour entries are '#' followed by six hex digits. */
export function isColor(entry: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(entry)
}

/** Layers the array is allocated with, in powers of two so it only grows now and then. */
function depthFor(count: number): number {
	let d = 8
	while (d < count) d *= 2
	return d
}

const hexRGB = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function solid(hex: string): Uint8Array {
	const n = PALETTE_RES * PALETTE_RES
	const out = new Uint8Array(n * 4)
	const [r, g, b] = hexRGB(hex)
	for (let i = 0; i < n; i++) {
		out[i * 4] = r
		out[i * 4 + 1] = g
		out[i * 4 + 2] = b
		out[i * 4 + 3] = 0
	}
	return out
}

/** Nearest-neighbour resample of RGBA pixels to PALETTE_RES square. */
function resample(pixels: Uint8Array, w: number, h: number): Uint8Array {
	const out = new Uint8Array(PALETTE_RES * PALETTE_RES * 4)
	for (let y = 0; y < PALETTE_RES; y++) {
		const sy = Math.min(h - 1, Math.floor((y * h) / PALETTE_RES))
		for (let x = 0; x < PALETTE_RES; x++) {
			const sx = Math.min(w - 1, Math.floor((x * w) / PALETTE_RES))
			const s = (sy * w + sx) * 4
			const d = (y * PALETTE_RES + x) * 4
			out[d] = pixels[s]
			out[d + 1] = pixels[s + 1]
			out[d + 2] = pixels[s + 2]
			out[d + 3] = pixels[s + 3]
		}
	}
	return out
}

/** The RGBA pixels of a texture reply that isn't DXT (`fetchImage`'s layout), resampled. */
function rgbaReply(buf: ArrayBuffer): Uint8Array {
	const dv = new DataView(buf)
	return resample(new Uint8Array(buf, 12), dv.getUint32(4, true), dv.getUint32(8, true))
}

const resampled = (img: RawImage) => resample(img.pixels, img.width, img.height)

/**
 * The DXT3 layer of a tileset from its DXT replies (`sheen` null without an `_s` twin): its colour
 * blocks and the twin's alpha blocks, resampled block by block, or encoded from RGBA pixels where a
 * reply isn't a DXT `blockResamplable` allows.
 */
export async function blockLayer(path: string, base: ArrayBuffer, sheen: ArrayBuffer | null): Promise<Uint8Array> {
	const out = new Uint8Array(LAYER_BYTES)
	const l = dxtLevel(base)
	if (l && blockResamplable(l)) writeColour(out, l)
	else encodeColour(out, l ? resampled(await fetchImage(path)) : rgbaReply(base))
	if (sheen) {
		const s = dxtLevel(sheen)
		if (s && s.kind === 3 && blockResamplable(s)) writeAlpha(out, s)
		else encodeAlpha(out, s ? resampled(await fetchImage(sheenPath(path))) : rgbaReply(sheen))
	}
	return out
}

export class PaletteArray {
	/** The array texture the terrain shader samples. Replaced when the palette outgrows it. */
	texture: THREE.DataArrayTexture | THREE.CompressedArrayTexture
	private data: Uint8Array
	private paths: string[] = []
	/** Each entry's layer bytes loaded so far (RGBA or DXT3), by entry. */
	private loaded = new Map<string, Uint8Array>()
	private loading = new Set<string>()
	private readonly layerBytes: number
	/** The bytes of a layer with no texture yet: grey, no sheen. */
	private readonly blank: Uint8Array
	/** Until the texture's first upload, which sends every layer; after it, a write sends its layer alone. */
	private whole = true

	/**
	 * Called with the new texture whenever it's replaced, so the material can pick it up. `compressed`
	 * picks the DXT3 array, for a renderer that samples S3TC.
	 */
	constructor(
		private onReplace: (t: THREE.Texture) => void,
		private readonly compressed = compressedTexturesOn(),
	) {
		this.layerBytes = compressed ? LAYER_BYTES : PALETTE_RES * PALETTE_RES * 4
		this.blank = compressed ? solidLayer(128, 128, 128) : solid('#808080')
		this.data = new Uint8Array(0)
		this.texture = this.make(8)
	}

	get entries(): readonly string[] {
		return this.paths
	}

	/** Bytes the array takes on the GPU. */
	get bytes(): number {
		return this.data.length
	}

	/** Sets the palette. Entries keep their index; a new entry's texture loads in the background. */
	set(paths: string[]) {
		this.paths = paths.slice()
		const depth = depthFor(Math.max(1, paths.length))
		if (depth !== this.texture.image.depth) {
			this.texture.dispose()
			this.texture = this.make(depth)
			this.onReplace(this.texture)
		}
		paths.forEach((p, i) => this.fill(i, p))
		this.texture.needsUpdate = true
	}

	private make(depth: number): THREE.DataArrayTexture | THREE.CompressedArrayTexture {
		this.data = new Uint8Array(this.layerBytes * depth)
		for (let i = 0; i < depth; i++) this.data.set(this.blank, i * this.layerBytes)
		const t = this.compressed
			? new THREE.CompressedArrayTexture(
					// three's typings want ImageData-shaped mips; a compressed level is its blocks and size.
					[{ data: this.data, width: PALETTE_RES, height: PALETTE_RES }] as unknown as ImageData[],
					PALETTE_RES,
					PALETTE_RES,
					depth,
					THREE.RGBA_S3TC_DXT3_Format,
				)
			: new THREE.DataArrayTexture(this.data, PALETTE_RES, PALETTE_RES, depth)
		t.wrapS = t.wrapT = THREE.RepeatWrapping
		t.magFilter = THREE.LinearFilter
		t.minFilter = THREE.LinearFilter
		t.generateMipmaps = false
		t.colorSpace = THREE.SRGBColorSpace
		t.needsUpdate = true
		this.whole = true
		t.onUpdate = () => {
			if (t === this.texture) this.whole = false
		}
		// Re-fill from the cache: a new array starts grey.
		this.texture = t
		this.paths.forEach((p, i) => {
			const px = this.loaded.get(p)
			if (px) this.write(i, px)
		})
		return t
	}

	private write(layer: number, px: Uint8Array) {
		if (layer >= this.texture.image.depth) return
		this.data.set(px, layer * this.layerBytes)
		if (!this.whole) this.texture.addLayerUpdate(layer)
	}

	private fill(layer: number, path: string) {
		if (!path) return
		const px = this.loaded.get(path)
		if (px) {
			this.write(layer, px)
			return
		}
		if (isColor(path)) {
			const [r, g, b] = hexRGB(path)
			const c = this.compressed ? solidLayer(r, g, b) : solid(path)
			this.loaded.set(path, c)
			this.write(layer, c)
			return
		}
		if (this.loading.has(path)) return
		this.loading.add(path)
		const layerBytes = this.compressed
			? Promise.all([fetchTextureDXT(path), fetchTextureDXT(sheenPath(path)).catch(() => null)]).then(([base, sheen]) =>
					blockLayer(path, base, sheen),
				)
			: Promise.all([fetchImage(path), fetchImage(sheenPath(path)).then(resampled, () => null)]).then(([img, mask]) => {
					const px = resampled(img)
					applySheen(px, mask)
					return px
				})
		layerBytes
			.then((px) => {
				this.loading.delete(path)
				this.loaded.set(path, px)
				// Every layer that shows this path gets it, whichever slot it sits in now.
				this.paths.forEach((p, i) => {
					if (p === path) this.write(i, px)
				})
				this.texture.needsUpdate = true
			})
			.catch(() => {
				this.loading.delete(path)
				// Keep the grey placeholder and drop the failed path from the cache so it can be retried.
			})
	}

	dispose() {
		this.texture.dispose()
	}
}
