// The terrain's tileset array is DXT3 where the renderer samples S3TC (#216) and draws the ground as the RGBA array does, and its BLP mips (#225) smooth the distant ground.
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const pal = e.terrain.palette
const compressed = !!pal.texture.isCompressedArrayTexture
// The same palette as the RGBA array the `?nodxt` page builds, loaded beside it.
const { PaletteArray } = await P.app('/src/lib/terrain/paletteArray.ts')
const ref = new PaletteArray(() => {}, false)
ref.set([...pal.entries])
await P.settle()
await P.frames(2)

// Draw the scene once with each array and read the pixels back in the same task (no
// preserveDrawingBuffer needed), with nothing else changed between the two.
const gl = e.renderer.getContext()
const w = gl.drawingBufferWidth
const h = gl.drawingBufferHeight
const u = e.terrain.material.uniforms.palette
const shot = (tex) => {
	u.value = tex
	e.renderer.render(e.scene, e.camera)
	const px = new Uint8Array(w * h * 4)
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
	return px
}
/** Pixels whose largest channel differs by more than 10 (4%), and the mean of that difference. */
const compare = (a, b) => {
	let off = 0
	let sum = 0
	for (let i = 0; i < a.length; i += 4) {
		let d = 0
		for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]))
		if (d > 10) off++
		sum += d
	}
	return { off: off / (a.length / 4), mean: sum / (a.length / 4) }
}
/** The mean difference between horizontal neighbours in the far (upper) half: how busy the distant ground is. */
const busy = (a) => {
	let sum = 0
	let n = 0
	for (let y = h >> 1; y < h; y++)
		for (let x = 1; x < w; x++) {
			const i = (y * w + x) * 4
			for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c] - a[i + c - 4])
			n += 3
		}
	return sum / n
}
// Every array's min filter at once, re-uploaded: level 0 alone (LinearFilter) or the mips.
const filter = (f) => {
	for (const t of [pal.texture, ref.texture]) {
		t.minFilter = f
		t.needsUpdate = true
	}
	shot(pal.texture)
	shot(ref.texture)
}
// The ground alone (the abbey would hide most of it), lit as the editor lights it and as the client
// does, whose terrain specular reads the sheen masks in the layers' alpha. At level 0 the two arrays
// hold the same pixels; their mips differ (the BLPs' own against the GPU's box filter, which averages
// in linear light), so the mipped draws are only compared loosely.
const { prefs } = await P.state()
const lighting = prefs.clientLighting
const mipFilter = pal.texture.minFilter
const level0 = { off: 0, mean: 0 }
const mipped = { off: 0, mean: 0 }
let busyMipped = 0
let busyLevel0 = 0
for (const client of [false, true]) {
	prefs.clientLighting = client
	await P.frames(3)
	const hidden = e.scene.children.filter((c) => c.visible && c !== e.terrain.group && !c.isLight)
	for (const c of hidden) c.visible = false
	const a = shot(pal.texture)
	const m = compare(a, shot(ref.texture))
	mipped.off += m.off / 2
	mipped.mean += m.mean / 2
	busyMipped += busy(a) / 2
	filter(1006) // THREE.LinearFilter
	const a0 = shot(pal.texture)
	const l = compare(a0, shot(ref.texture))
	level0.off += l.off / 2
	level0.mean += l.mean / 2
	busyLevel0 += busy(a0) / 2
	filter(mipFilter)
	for (const c of hidden) c.visible = true
	u.value = pal.texture
}
prefs.clientLighting = lighting
ref.dispose()
const glErrors = P.glError()
const levels = pal.texture.mipmaps.length
return {
	ok: compressed && glErrors === 0 && levels === 9 && level0.off < 0.02 && mipped.mean < 8 && busyMipped < 0.8 * busyLevel0,
	compressed,
	levels,
	layers: pal.entries.length,
	paletteMB: +(pal.bytes / 1048576).toFixed(1),
	rgbaMB: +(ref.bytes / 1048576).toFixed(1),
	level0Over4pc: +(level0.off * 100).toFixed(2) + '%',
	level0MeanDiff: +level0.mean.toFixed(2),
	mippedOver4pc: +(mipped.off * 100).toFixed(2) + '%',
	mippedMeanDiff: +mipped.mean.toFixed(2),
	farBusyMipped: +busyMipped.toFixed(2),
	farBusyLevel0: +busyLevel0.toFixed(2),
	glErrors,
}
