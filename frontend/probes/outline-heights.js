// The selection outline samples the terrain's own height texture (#567): ground raised under a selected model's edge marks its buried part red, and the stroke uploads only the edited texels, not the whole float heightmap each frame.
// touches: frontend/src/lib/engine/SelectionOutline.ts, frontend/src/lib/terrain/Terrain.ts
const e = P.e
const { editor } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
e.newDocument(1024, 'flat', 0, 'Probe')
await P.frames(2)
const L = e.objects
const cx = 300
const cz = 300
const o = L.add({ type: 'helper:cube:4', x: cx, z: cz, yOff: 0, rotY: 0, scale: 1 })
selectObjects(L, [o.id])
// The outline is drawn under the Select tool; the Sculpt tool's stroke is driven directly.
editor.tool = 'select'
editor.sculptMode = 'raise'
editor.brush.radius = 2
editor.brush.strength = 1
const V3 = e.camera.position.constructor
P.lookAt(new V3(cx, e.terrain.heightAt(cx, cz) + 2, cz), { yaw: 0.6, pitch: -0.5, back: 30 })
await P.frames(4)

/** Pixels of the outline's mask: the model's silhouette (R) and its buried parts (G). */
const mask = () => {
	const rt = e.outline.maskRT
	const px = new Uint8Array(rt.width * rt.height * 4)
	e.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px)
	let model = 0
	let red = 0
	for (let i = 0; i < px.length; i += 4) {
		if (px[i] > 127) model++
		if (px[i + 1] > 127) red++
	}
	return { model, red }
}
const before = mask()

// Count the float RED texels uploaded during the stroke (the height textures are the only ones).
const gl = e.renderer.getContext()
let texels = 0
const ti = gl.texImage2D
const ts = gl.texSubImage2D
gl.texImage2D = function (...a) {
	if (a.length >= 9 && a[7] === gl.FLOAT && a[6] === gl.RED) texels += a[3] * a[4]
	return ti.apply(this, a)
}
gl.texSubImage2D = function (...a) {
	if (a.length >= 9 && a[7] === gl.FLOAT && a[6] === gl.RED) texels += a[4] * a[5]
	return ts.apply(this, a)
}
try {
	// Raise the ground along the cube's edge only: its middle (where it snaps to) stays put.
	await P.stroke(e.tools.sculpt, { x: cx + 2.5, z: cz - 3 }, { x: cx + 2.5, z: cz + 3 }, 30)
} finally {
	gl.texImage2D = ti
	gl.texSubImage2D = ts
}
await P.frames(2)
const after = mask()
const shared = e.outline.shared.heightTex.value === e.terrain.heightTexture()
const whole = e.terrain.verts * e.terrain.verts
return {
	ok: shared && before.model > 0 && before.red === 0 && after.red > 0 && texels < whole,
	shared,
	before,
	after,
	edgeRaised: e.terrain.heightAt(cx + 2.5, cz),
	texelsUploaded: texels,
	wholeMap: whole,
}
