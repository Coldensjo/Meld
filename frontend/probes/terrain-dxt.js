// The terrain's tileset array is DXT3 where the renderer samples S3TC (#216), and draws the ground as the RGBA array does.
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
// The ground alone (the abbey would hide most of it), lit as the editor lights it and as the client
// does, whose terrain specular reads the sheen masks in the layers' alpha.
const { prefs } = await P.state()
const lighting = prefs.clientLighting
let off = 0
let sum = 0
for (const client of [false, true]) {
	prefs.clientLighting = client
	await P.frames(3)
	const hidden = e.scene.children.filter((c) => c.visible && c !== e.terrain.group && !c.isLight)
	for (const c of hidden) c.visible = false
	const a = shot(pal.texture)
	const b = shot(ref.texture)
	for (const c of hidden) c.visible = true
	u.value = pal.texture
	for (let i = 0; i < a.length; i += 4) {
		let d = 0
		for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]))
		if (d > 10) off++
		sum += d
	}
}
prefs.clientLighting = lighting
ref.dispose()
const glErrors = P.glError()
const differ = off / (2 * w * h)
return {
	ok: compressed && glErrors === 0 && differ < 0.02,
	compressed,
	layers: pal.entries.length,
	paletteMB: +(pal.bytes / 1048576).toFixed(1),
	rgbaMB: +(ref.bytes / 1048576).toFixed(1),
	differOver4pc: +(differ * 100).toFixed(2) + '%',
	meanMaxChannelDiff: +(sum / (2 * w * h)).toFixed(2),
	glErrors,
}
