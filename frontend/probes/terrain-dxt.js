// The terrain's tileset array is DXT3 where the renderer samples S3TC (#216) and draws the ground as the RGBA array does, and its BLP mips (#225) smooth the distant ground.
// touches: frontend/src/lib/terrain/paletteArray.ts, frontend/src/lib/terrain/paletteBlocks.ts, frontend/src/lib/terrain/TerrainMaterial.ts, internal/wow/blp.go
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

// Draw the scene once with each array and read the pixels back (P.shot), with nothing else changed
// between the two.
const u = e.terrain.material.uniforms.palette
const shot = (tex) =>
	P.shot(() => {
		u.value = tex
		e.renderer.render(e.scene, e.camera)
	})
/** Pixels whose largest channel differs by more than 10 (4%), and the mean of that difference. */
const compare = (a, b) => P.diff(a, b, 10)
/** How busy the distant ground is: the far (upper) half of the picture. */
const busy = (a) => P.busy(a, { y0: 0, y1: 0.5 })
// Every array's min filter at once, re-uploaded: level 0 alone (LinearFilter) or the mips.
const filter = async (f) => {
	for (const t of [pal.texture, ref.texture]) {
		t.minFilter = f
		t.needsUpdate = true
	}
	await shot(pal.texture)
	await shot(ref.texture)
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
	await P.only(e.terrain.group, async () => {
		const a = await shot(pal.texture)
		const m = compare(a, await shot(ref.texture))
		mipped.off += m.off / 2
		mipped.mean += m.mean / 2
		busyMipped += busy(a) / 2
		await filter(1006) // THREE.LinearFilter
		const a0 = await shot(pal.texture)
		const l = compare(a0, await shot(ref.texture))
		level0.off += l.off / 2
		level0.mean += l.mean / 2
		busyLevel0 += busy(a0) / 2
		await filter(mipFilter)
	})
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
