import * as THREE from 'three'
import { compressedTexturesOn, fetchImage, fetchTextureDXT, listAssets, textureAnisotropy, type RawImage } from '../wow/api'
import { applySheen, sheenPath } from './sheen'
import { LAYER_BYTES, LEVEL_BYTES, LEVEL_OFFSET, LEVEL_SIDE, RES, blockResamplable, chainAlpha, chainColour, dxtLevels, encodeAlphaChain, encodeColourChain, solidLayer } from './paletteBlocks'

// The map's texture palette as one array texture: layer i is palette entry i. Each entry is a WoW
// tileset path, or a '#rrggbb' colour that stands in for a texture while none is set. WoW
// textures are resampled to PALETTE_RES, so one array holds them all. A layer's alpha is its sheen
// mask: the alpha of the texture's `_s` twin (`Foo_s.blp`), which the client's terrain specular
// reads (Benilla's terrain.rs), or 0 for a texture without one.
//
// Where the renderer samples S3TC (`compressedTexturesOn`, #178) the array is DXT3, about 85 KB a
// layer, built mostly from the BLPs' own blocks and their own mips (paletteBlocks.ts, #216, #225);
// otherwise (`?nodxt`) it is RGBA, 256 KB a layer and a third more for the mips the GPU makes.
// Either way it is mipmapped, trilinear and anisotropic as the models' textures are, so distant
// ground doesn't shimmer, and a texture that arrives re-uploads its layer alone (every level).

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

let twins: { list: Promise<string[]>; set: Promise<Set<string>> } | null = null

/**
 * Whether a tileset texture has an `_s` twin in the client (the `sheen` list, read once a client), so
 * a texture without one costs no request and no 404 in the console and the load log (#336).
 */
export function hasSheenTwin(path: string): Promise<boolean> {
	const list = listAssets('sheen')
	if (twins?.list !== list) twins = { list, set: list.then((l) => new Set(l.map((p) => p.toLowerCase()))) }
	return twins.set.then((s) => s.has(sheenPath(path).toLowerCase()))
}

/** The RGBA pixels of a texture reply that isn't DXT (`fetchImage`'s layout), resampled. */
function rgbaReply(buf: ArrayBuffer): Uint8Array {
	const dv = new DataView(buf)
	return resample(new Uint8Array(buf, 12), dv.getUint32(4, true), dv.getUint32(8, true))
}

const resampled = (img: RawImage) => resample(img.pixels, img.width, img.height)

/**
 * The DXT3 layer of a tileset, every level, from its DXT replies (`sheen` null without an `_s`
 * twin): its colour blocks and the twin's alpha blocks with their own mips, resampled block by
 * block, or encoded from RGBA pixels where a reply isn't a DXT `blockResamplable` allows.
 */
export async function blockLayer(path: string, base: ArrayBuffer, sheen: ArrayBuffer | null): Promise<Uint8Array> {
	const out = new Uint8Array(LAYER_BYTES)
	const l = dxtLevels(base)
	if (l && blockResamplable(l)) chainColour(out, l)
	else encodeColourChain(out, l ? resampled(await fetchImage(path)) : rgbaReply(base))
	if (sheen) {
		const s = dxtLevels(sheen)
		if (s && s[0].kind === 3 && blockResamplable(s)) chainAlpha(out, s)
		else encodeAlphaChain(out, s ? resampled(await fetchImage(sheenPath(path))) : rgbaReply(sheen))
	}
	return out
}

/** The level layout of an RGBA layer: the one level three uploads (the GPU makes the rest). */
const RGBA_LEVEL = [PALETTE_RES * PALETTE_RES * 4]
/** Bytes of an RGBA layer on the GPU with the mips it makes. */
const RGBA_GPU_BYTES = LEVEL_SIDE.reduce((a, s) => a + s * s * 4, 0)

let failHandler: ((path: string, err: unknown) => void) | null = null
/** The palettes holding a texture that failed to load, so a reconnect can ask for those again (#544). */
const failedPalettes = new Set<PaletteArray>()

/** Called once for each palette texture that fails to load (the Engine says so in the status line and the log). */
export function setPaletteFailHandler(fn: ((path: string, err: unknown) => void) | null) {
	failHandler = fn
}

/** Loads again every palette texture that failed, once the client is back. */
export function retryFailedPalettes() {
	failedPalettes.forEach((p) => p.retryFailed())
}

export class PaletteArray {
	/** The array texture the terrain shader samples. Replaced when the palette outgrows it. */
	texture: THREE.DataArrayTexture | THREE.CompressedArrayTexture
	/** Each uploaded level's bytes, every layer: DXT3 levels 0 to LEVELS - 1, or the one RGBA level. */
	private levels: Uint8Array[] = []
	private paths: string[] = []
	/** Each entry's layer bytes loaded so far (RGBA level 0, or DXT3 every level), by entry. */
	private loaded = new Map<string, Uint8Array>()
	private loading = new Set<string>()
	/** Paths whose load failed: reported once, left grey until retryFailed. */
	private failed = new Set<string>()
	/** A layer's bytes in each uploaded level. */
	private readonly levelBytes: readonly number[]
	/** Where each level starts in a layer's bytes. */
	private readonly levelOffset: readonly number[]
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
		this.levelBytes = compressed ? LEVEL_BYTES : RGBA_LEVEL
		this.levelOffset = compressed ? LEVEL_OFFSET : [0]
		this.blank = compressed ? solidLayer(128, 128, 128) : solid('#808080')
		this.texture = this.make(8)
	}

	get entries(): readonly string[] {
		return this.paths
	}

	/** Bytes the array takes on the GPU, mips included. */
	get bytes(): number {
		const depth = this.texture.image.depth
		return this.compressed ? depth * LAYER_BYTES : depth * RGBA_GPU_BYTES
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

	/**
	 * Sets entry `i` alone, growing the array as `set` does, and leaves the other layers as they are
	 * (`set` writes every layer again). The bytes of the path it replaces are let go of unless another
	 * entry shows it. For a palette whose entries come and go, the world view's (world/worldPaint.ts).
	 */
	setEntry(i: number, path: string) {
		const old = this.paths[i]
		this.paths[i] = path
		if (old && old !== path && !this.paths.includes(old)) this.loaded.delete(old)
		const depth = depthFor(Math.max(1, this.paths.length))
		if (depth !== this.texture.image.depth) {
			this.texture.dispose()
			this.texture = this.make(depth)
			this.onReplace(this.texture)
		}
		// Only a write of its own uploads anything: a needsUpdate without a layer update sends every layer.
		if (this.fill(i, path)) this.texture.needsUpdate = true
	}

	/** Whether `path`'s texture has loaded or failed, so its layer will not change again. */
	settled(path: string): boolean {
		return isColor(path) || this.loaded.has(path) || this.failed.has(path)
	}

	private make(depth: number): THREE.DataArrayTexture | THREE.CompressedArrayTexture {
		this.levels = this.levelBytes.map((n) => new Uint8Array(n * depth))
		for (let i = 0; i < depth; i++) this.put(i, this.blank)
		const t = this.compressed
			? new THREE.CompressedArrayTexture(
					// three's typings want ImageData-shaped mips; a compressed level is its blocks and size,
					// every layer's in one array, which addLayerUpdate slices per layer.
					this.levels.map((data, k) => ({ data, width: LEVEL_SIDE[k], height: LEVEL_SIDE[k] })) as unknown as ImageData[],
					PALETTE_RES,
					PALETTE_RES,
					depth,
					THREE.RGBA_S3TC_DXT3_Format,
				)
			: new THREE.DataArrayTexture(this.levels[0], PALETTE_RES, PALETTE_RES, depth)
		t.wrapS = t.wrapT = THREE.RepeatWrapping
		t.magFilter = THREE.LinearFilter
		t.minFilter = THREE.LinearMipmapLinearFilter
		t.anisotropy = textureAnisotropy()
		// The RGBA array's mips are made on the GPU after each upload; the DXT3 one brings its own.
		t.generateMipmaps = !this.compressed
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

	/** Copies a layer's bytes into each level. */
	private put(layer: number, px: Uint8Array) {
		this.levels.forEach((l, k) => {
			const n = this.levelBytes[k]
			const o = this.levelOffset[k]
			l.set(px.subarray(o, o + n), layer * n)
		})
	}

	private write(layer: number, px: Uint8Array) {
		if (layer >= this.texture.image.depth) return
		this.put(layer, px)
		if (!this.whole) this.texture.addLayerUpdate(layer)
	}

	/** Writes the layer of entry `path`, now when its bytes are at hand (true) or once they load. */
	private fill(layer: number, path: string): boolean {
		if (!path) return false
		const px = this.loaded.get(path)
		if (px) {
			this.write(layer, px)
			return true
		}
		if (isColor(path)) {
			const [r, g, b] = hexRGB(path)
			const c = this.compressed ? solidLayer(r, g, b) : solid(path)
			this.loaded.set(path, c)
			this.write(layer, c)
			return true
		}
		if (this.loading.has(path) || this.failed.has(path)) return false
		this.loading.add(path)
		const layerBytes = this.compressed
			? Promise.all([fetchTextureDXT(path), hasSheenTwin(path).then((has) => (has ? fetchTextureDXT(sheenPath(path)).catch(() => null) : null))]).then(([base, sheen]) => blockLayer(path, base, sheen))
			: Promise.all([fetchImage(path), hasSheenTwin(path).then((has) => (has ? fetchImage(sheenPath(path)).then(resampled, () => null) : null))]).then(([img, mask]) => {
					const px = resampled(img)
					applySheen(px, mask)
					return px
				})
		layerBytes
			.then((px) => {
				this.loading.delete(path)
				this.loaded.set(path, px)
				// Every layer that shows this path gets it, whichever slot it sits in now; none may (an entry
				// replaced while it loaded), and then nothing is sent.
				let wrote = false
				this.paths.forEach((p, i) => {
					if (p !== path) return
					this.write(i, px)
					wrote = true
				})
				if (wrote) this.texture.needsUpdate = true
			})
			.catch((err) => {
				this.loading.delete(path)
				// Keep the grey placeholder, say so once, and ask again when the client reconnects.
				this.failed.add(path)
				failedPalettes.add(this)
				failHandler?.(path, err)
			})
		return false
	}

	/** Asks again for the textures that failed. */
	retryFailed() {
		const paths = [...this.failed]
		this.failed.clear()
		failedPalettes.delete(this)
		this.paths.forEach((p, i) => {
			if (paths.includes(p)) this.fill(i, p)
		})
	}

	dispose() {
		failedPalettes.delete(this)
		this.texture.dispose()
	}
}
