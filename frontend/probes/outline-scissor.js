// The outline passes are scissored to the outlined models' screen box (#844): with two small helper cubes selected the box is a small share of the view, the stroke drawn on the canvas matches the whole-screen pass's, a cube half off the view still gets its stroke, and on the real GPU (`PROBE_GPU=1`) the Outlines pass's ms with the scissor on and off.
// touches: frontend/src/lib/engine/SelectionOutline.ts
const e = P.e
const { editor, prefs } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
prefs.hoverOutline = false
await P.frames(1)
const h0 = e.terrain.heightAt(128, 128)
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.1, back: 120 })
const L = e.objects
const a = L.add({ type: 'helper:cube:4', x: 118, z: 128, yOff: 0, rotY: 0, scale: 1 })
const b = L.add({ type: 'helper:cube:4', x: 138, z: 128, yOff: 0, rotY: 0, scale: 1 })
selectObjects(L, [a.id, b.id], a.id)
await P.frames(3)
const outline = e.outline
const Outline = outline.constructor
const r3 = e.renderer
const gl = r3.getContext()
const W = gl.drawingBufferWidth
const H = gl.drawingBufferHeight

/** The canvas's pixels right after the selection outline drew, read in the same frame (the drawing buffer is not kept). */
const grab = async () => {
	let px = null
	const render = outline.render
	outline.render = function (...args) {
		render.apply(this, args)
		px = new Uint8Array(W * H * 4)
		gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
	}
	try {
		await P.frames(2)
	} finally {
		delete outline.render
	}
	return px
}
/** Pixels that differ between two grabs by more than a little (the stroke is far from the ground's colours). */
const diff = (p, q) => {
	let n = 0
	for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) n++
	return n
}
const bad = []
const check = async (label) => {
	Outline.scissor = true
	const on = await grab()
	const fit = outline.screenRect(e.camera)
	const share = fit > 0 ? (outline.rect.z * outline.rect.w) / (W * H) : 1
	Outline.scissor = false
	const off = await grab()
	// The stroke with nothing outlined: what the outline adds to the canvas.
	selectObjects(L, [], undefined)
	const none = await grab()
	selectObjects(L, [a.id, b.id], a.id)
	await P.frames(1)
	Outline.scissor = true
	const stroke = diff(off, none)
	const changed = diff(on, off)
	if (fit !== 1) bad.push(`${label}: not scissored (fit ${fit})`)
	if (stroke < 50) bad.push(`${label}: only ${stroke} stroke pixels`)
	if (changed > stroke * 0.02 + 4) bad.push(`${label}: ${changed} pixels differ from the whole-screen pass (stroke ${stroke})`)
	return { share: Math.round(share * 1000) / 1000, stroke, changed }
}
const centred = await check('centred')
if (centred.share > 0.25) bad.push(`centred: the box covers ${centred.share} of the view`)
// Cube a half off an edge of the view: the camera's target slides along x until the cube's centre is on it.
const V3 = e.controller.target.constructor
let edge = null
for (let dx = -200; dx <= 200 && !edge; dx += 1) {
	await P.lookAt({ x: 128 + dx, y: h0, z: 128 }, { pitch: 1.1, back: 120 })
	e.camera.updateMatrixWorld()
	const p = new V3(118, h0 + 2, 128).project(e.camera)
	if (Math.abs(Math.abs(p.x) - 1) < 0.02 && Math.abs(p.y) < 0.9) edge = await check('half off the view')
}
if (!edge) bad.push('could not put a cube on the view edge')

// On the real GPU, the Outlines pass's ms with the scissor on and off (null on SwiftShader).
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.1, back: 120 })
const runs = { on: [], off: [] }
const n = P.env('WINDOWS', 2)
try {
	for (let i = 0; i < n; i++)
		for (const on of i % 2 ? [true, false] : [false, true]) {
			Outline.scissor = on
			await P.frames(3)
			const r = await P.perf(1)
			runs[on ? 'on' : 'off'].push(r.gpu ? r.gpu[2] : null)
		}
} finally {
	Outline.scissor = true
}
const mean = (x) => (x.some((v) => v === null) ? null : Math.round((x.reduce((s, y) => s + y, 0) / x.length) * 1000) / 1000)
return { ok: bad.length === 0, bad, centred, edge, outlinesGpuMs: { off: mean(runs.off), on: mean(runs.on) } }
