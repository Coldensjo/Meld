// The coast holds still while the camera flies (#747): on a Large Island made on the New world page, seen from 1200 yd, six shots with the camera stepped 0.37 yd along the coast's normal (a frame of flight, under a pixel there), and the pixels whose brightness jumps by over 25 between shots at least twice counted, with the sea as drawn (a grid of cells about a tile wide, Water.ts) and as the one quad it was. On a real GPU (`PROBE_GPU=1`, D3D11 through ANGLE) the quad's depth wobbled from frame to frame and the whole shoreline swapped sea and land: 544 such pixels against 1 to 4 with a grid; SwiftShader draws both steady, so there the probe only checks the grid's count stays low. The clock is held, so the sea's frame stays put. About 15 s on the GPU. Saves the coast and its flips for each with `--shot`.
// touches: frontend/src/lib/water/Water.ts, frontend/src/lib/water/liquidMaterial.ts
const e = P.e
const gl = e.renderer.getContext()
const info = gl.getExtension('WEBGL_debug_renderer_info')
const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'n/a'
const swiftShader = /swiftshader/i.test(gpu)
// A Large Island from the Start dialog's New world page, as the owner made it (as in coast-foam).
const { ui, editor } = await P.state()
ui.newMapMode = 'new'
ui.showNewDialog = true
const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Large')).click()
const name = d.querySelector('input[type=text]')
name.value = 'ProbeFlight'
name.dispatchEvent(new Event('input', { bubbles: true }))
;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Island')).click()
const seed = d.querySelector('.seed input')
seed.value = '4242'
seed.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(1)
;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
await P.until(() => e.activeVmangos()?.dir === 'ProbeFlight', 30_000, 'the island')
await P.frames(3)
const t = e.terrain
const w = t.worldSize
// The west coast along the middle row.
let cx = -1
for (let x = 0; x < w * 0.5; x += 1) {
	if (t.heightAt(x, w * 0.5) > 0) {
		cx = x
		break
	}
}
if (cx < 0) return { ok: false, why: 'no coast on the middle row' }
if (!editor.waterEnabled) return { ok: false, why: 'the island has no sea' }
e.controller.setFollowGround(true)
await P.fullView()
const DIST = 1200
const PITCH = 0.25
e.controller.setView(cx, 0, w * 0.5, -Math.PI / 2, PITCH, DIST)
await P.settle()
await P.frames(10)
// Hold the clock, so the sea's animated frame stays put between shots.
e.timer.setTimescale(0)

/** The coast and the land behind it; the ridges' skyline above moves with the camera and is left out. */
const VIEW = { x0: 0, x1: 1, y0: 0.3, y1: 0.8 }

/** Six shots a step of flight apart; the count of pixels that jump by over 25 at least twice. */
const fly = async (label) => {
	const shots = []
	for (let i = 0; i < 6; i++) {
		e.controller.setView(cx + i * 0.37, 0, w * 0.5, -Math.PI / 2, PITCH, DIST)
		await P.frames(2)
		shots.push(await P.shot())
	}
	const W = shots[0].w
	const { x0, x1, y0, y1 } = P.rect(shots[0], VIEW)
	const out = { w: W, h: shots[0].h, px: new Uint8Array(W * shots[0].h * 4), lit: 1 }
	const lum = (s, p) => (s.px[p * 4] + s.px[p * 4 + 1] + s.px[p * 4 + 2]) / 3
	let hot = 0
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const p = y * W + x
			let jumps = 0
			for (let k = 1; k < shots.length; k++) if (Math.abs(lum(shots[k - 1], p) - lum(shots[k], p)) > 25) jumps++
			if (jumps >= 2) hot++
			out.px[p * 4] = out.px[p * 4 + 1] = out.px[p * 4 + 2] = Math.min(255, jumps * 50)
			out.px[p * 4 + 3] = 255
		}
	P.save(shots[0], label, VIEW)
	P.save(out, `${label}-flips`, VIEW)
	return hot
}

const water = e.water
const grid = water.mesh.geometry
const r = { gpu, coast: cx, cells: Math.round(Math.sqrt(grid.attributes.position.count)) - 1 }
r.grid = await fly('grid')
// The sea as it was before #747: one quad the same size.
const quad = new grid.constructor(w * 10, w * 10)
quad.rotateX(-Math.PI / 2)
water.mesh.geometry = quad
try {
	r.quad = await fly('quad')
} finally {
	water.mesh.geometry = grid
	quad.dispose()
}
// The grid's coast stays still; on a real GPU the quad's flickered, which shows the probe still sees it.
r.ok = r.grid < 40 && (swiftShader || r.quad > 200)
return r
