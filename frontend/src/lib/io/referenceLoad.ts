import * as THREE from 'three'
import { OpenReferenceImageDialog, ReadReferenceImage } from '../../../wailsjs/go/main/App'
import { dominantColours, type RefColour, type RefPixels } from '../terrain/referenceImage'
import { base64ToBytes } from './base64'

// Reading a reference image (View › Reference Image, #184): Go returns the file's bytes as they are
// (never the asset server, and no POST), and the page decodes them itself, in colour, into the pixels
// the conversions read and the texture the terrain shader drapes.

/** The longest side the image is kept at: its texture and the pixels the conversions sample. */
export const REF_MAX_SIDE = 2048

/** A reference image read for a document: its pixels, its texture and a URL for the screen overlay. */
export interface LoadedReference {
	path: string
	pixels: RefPixels
	texture: THREE.Texture
	/** A URL of the picture for the top-down view's overlay: the file's blob, or the canvas's data URL. */
	url: string
	/** The image's flat colours (dominantColours), worked out the first time they are asked for. */
	colours(): RefColour[]
	dispose(): void
}

/** Asks for a reference image file. Returns '' if cancelled. */
export function chooseReferenceFile(): Promise<string> {
	return OpenReferenceImageDialog()
}

/** Reads the image at `path` through the binding and decodes it. */
export async function readReferenceFile(path: string): Promise<LoadedReference> {
	const bytes = base64ToBytes(await ReadReferenceImage(path))
	const type = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg'
	const blob = new Blob([bytes as BlobPart], { type })
	const bitmap = await createImageBitmap(blob)
	try {
		return referenceFrom(path, bitmap, bitmap.width, bitmap.height, URL.createObjectURL(blob))
	} finally {
		bitmap.close()
	}
}

/** A reference image from a picture already in the page (a canvas or bitmap), as the probes make one. */
export function referenceFrom(path: string, source: CanvasImageSource, w: number, h: number, url?: string): LoadedReference {
	const scale = Math.min(1, REF_MAX_SIDE / Math.max(w, h))
	const cw = Math.max(1, Math.round(w * scale))
	const ch = Math.max(1, Math.round(h * scale))
	const canvas = document.createElement('canvas')
	canvas.width = cw
	canvas.height = ch
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('no 2D canvas to read the reference image')
	ctx.drawImage(source, 0, 0, cw, ch)
	const data = ctx.getImageData(0, 0, cw, ch).data
	// Without the file's own blob (a picture made in the page), the screen overlay shows the canvas.
	const link = url ?? canvas.toDataURL('image/png')
	const texture = new THREE.CanvasTexture(canvas)
	// Row 0 at v = 0, as refUV and the shader have it.
	texture.flipY = false
	texture.colorSpace = THREE.SRGBColorSpace
	texture.minFilter = THREE.LinearMipmapLinearFilter
	texture.magFilter = THREE.LinearFilter
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
	texture.anisotropy = 4
	let colours: RefColour[] | null = null
	const pixels: RefPixels = { w: cw, h: ch, data }
	return {
		path,
		pixels,
		texture,
		url: link,
		colours: () => (colours ??= dominantColours(pixels)),
		dispose() {
			texture.dispose()
			if (link.startsWith('blob:')) URL.revokeObjectURL(link)
		},
	}
}
