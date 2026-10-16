import * as THREE from 'three'

// The texture endpoint's reply made into a texture (#178), kept apart from api.ts so it can be tested.

const DXT_FORMATS: Record<string, THREE.CompressedPixelFormat> = {
	'1': THREE.RGBA_S3TC_DXT1_Format,
	'3': THREE.RGBA_S3TC_DXT3_Format,
	'5': THREE.RGBA_S3TC_DXT5_Format,
}

/**
 * A texture from the texture endpoint's reply: "DXT1", "DXT3" or "DXT5" with the mip levels as Go
 * sends them (`Client.TextureDXT`), or "RGBA" pixels, whose mips the GPU makes.
 */
export function textureFrom(buf: ArrayBuffer): THREE.Texture {
	const dv = new DataView(buf)
	const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
	const width = dv.getUint32(4, true)
	const height = dv.getUint32(8, true)
	const format = magic.startsWith('DXT') ? DXT_FORMATS[magic[3]] : undefined
	if (format === undefined) {
		const t = new THREE.DataTexture(new Uint8Array(buf, 12), width, height, THREE.RGBAFormat)
		t.generateMipmaps = true
		return t
	}
	const mipmaps: { data: Uint8Array; width: number; height: number }[] = []
	let o = 16
	let w = width
	let h = height
	for (let i = dv.getUint32(12, true); i > 0; i--) {
		const size = dv.getUint32(o, true)
		mipmaps.push({ data: new Uint8Array(buf, o + 4, size), width: w, height: h })
		o += 4 + size
		w = Math.max(1, w >> 1)
		h = Math.max(1, h >> 1)
	}
	// three's typings want ImageData-shaped mips; a compressed level is its blocks and size.
	const t = new THREE.CompressedTexture(mipmaps as unknown as ImageData[], width, height, format)
	t.generateMipmaps = false
	return t
}
