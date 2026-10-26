// The coast holds still as the camera moves (#747): on a Large Island made on the New world page, seen from 1200 yd, four shots a sub-pixel turn apart, and the pixels on the near coast whose brightness swings by over 30 counted, with the terrain's foam line at the waterline as drawn, as it was before #747 (0.35 yd either side of the waterline however small on screen) and taken out. The thin line sparkled: 250 to 275 such pixels against 40 to 50 without foam; widened to the pixel (TerrainMaterial's `band`), about 100. Since the sea is a grid instead of one quad (#747, `coast-flight`) the whole coast is far steadier, also on SwiftShader: 17 thin, 4 widened, 4 without foam. The clock is held, so the sea's frame stays put. Passes while the widened line adds under 20 pixels, or under half what the thin one adds. About 140 s; through `newDocument` instead of the dialog the island is far more rugged and inland swings drown the coast's. Saves the coast and its swing for each with `--shot`.
// touches: frontend/src/lib/terrain/TerrainMaterial.ts, frontend/src/lib/terrain/presets.ts, frontend/src/lib/water/liquidMaterial.ts, frontend/src/lib/water/Water.ts
const e = P.e
// A Large Island from the Start dialog's New world page, as the owner made it (its coast follows the tiles).
const { ui, editor } = await P.state()
ui.newMapMode = 'new'
ui.showNewDialog = true
const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Large')).click()
const name = d.querySelector('input[type=text]')
name.value = 'ProbeCoast'
name.dispatchEvent(new Event('input', { bubbles: true }))
;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Island')).click()
const seed = d.querySelector('.seed input')
seed.value = '4242'
seed.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(1)
;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
await P.until(() => e.activeVmangos()?.dir === 'ProbeCoast', 30_000, 'the island')
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
e.controller.setFollowGround(true)
await P.fullView()
// The liquid frames and textures loaded first: a frame arriving between two shots swings the whole sea.
e.controller.setView(cx, 0, w * 0.5, -Math.PI / 2, 0.35, 1200)
await P.settle()
await P.frames(10)
// Hold the clock, so the sea's animated frame stays put between shots.
e.timer.setTimescale(0)

/** The island's near coast in the view; inland the ridges swing too. */
const COAST = { x0: 0.2, x1: 0.8, y0: 0.38, y1: 0.54 }

/** Four shots a sub-pixel turn apart; the count of pixels on the coast whose brightness swings by over 30. */
const swing = async (label) => {
	const shots = []
	for (let i = 0; i < 4; i++) {
		e.controller.setView(cx, 0, w * 0.5, -Math.PI / 2 + i * 0.00015, 0.35, 1200)
		await P.frames(2)
		shots.push(await P.shot())
	}
	const W = shots[0].w
	const { x0, x1, y0, y1 } = P.rect(shots[0], COAST)
	const out = { w: W, h: shots[0].h, px: new Uint8Array(W * shots[0].h * 4), lit: 1 }
	let hot = 0
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const p = y * W + x
			let lo = 255
			let hi = 0
			for (const s of shots) {
				const v = (s.px[p * 4] + s.px[p * 4 + 1] + s.px[p * 4 + 2]) / 3
				lo = Math.min(lo, v)
				hi = Math.max(hi, v)
			}
			if (hi - lo > 30) hot++
			out.px[p * 4] = out.px[p * 4 + 1] = out.px[p * 4 + 2] = Math.min(255, (hi - lo) * 4)
			out.px[p * 4 + 3] = 255
		}
	P.save(shots[0], label, COAST)
	P.save(out, `${label}-spread`, COAST)
	return hot
}

const r = { coast: cx, waterEnabled: editor.waterEnabled }
if (!editor.waterEnabled) return { ok: false, why: 'the island has no sea', ...r }
const m = t.material
const src = m.fragmentShader
/** Draws the terrain with its fragment shader changed by `edit` (a string replace that must match). */
const patch = async (from, to) => {
	const next = src.replace(from, to)
	if (next === src) throw new Error(`the terrain shader no longer holds: ${from}`)
	m.fragmentShader = next
	m.needsUpdate = true
}
r.foam = await swing('foam')
// The foam line as it was before #747: 0.35 yd either side of the waterline, however small on screen.
await patch(/float band = [^;]+;/, 'float band = 0.35;')
r.thinFoam = await swing('thin')
await patch('lit = mix(lit, foamColor, foam * 0.35);', '')
r.noFoam = await swing('nofoam')
// The widened line adds little swing over no foam: under 20 pixels, or well under the thin line's.
r.ok = r.foam - r.noFoam < Math.max(20, (r.thinFoam - r.noFoam) * 0.5)
return r
