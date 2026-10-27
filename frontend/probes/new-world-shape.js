// A new world's ground (#744): in the Start dialog's New world, the Height, Roughness, Erosion, Land and Sea depth sliders are there with their defaults, Height redraws the preset pictures, and Create world makes a Large (4×4) Mountains world whose peaks stand over 150 yd with the sea round it going down past 25 yd, eroded (its heights differ from the same seed made with Erosion at none, through `generateHeights`); a Large Rolling hills world tops out between 35 and 110 yd; a Large Canyon (Sea depth greyed out for it) has a low floor in the middle and walls over 250 yd at the corners. Saves a view over each with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/terrain/presets.ts, frontend/src/lib/terrain/generate.ts, frontend/src/lib/terrain/Terrain.ts
const { ui } = await P.state()
const r = {}

/** Opens the Start dialog's New world page. */
const open = async () => {
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	return P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
}
/** Sets a range input and tells Svelte. */
const slide = (input, value) => {
	input.value = String(value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** Makes a Large world of preset `label` named `name` from the open dialog `d`, with Erosion `erosion`; returns its terrain. */
const create = async (d, label, name, erosion) => {
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Large')).click()
	const input = d.querySelector('input[type=text]')
	input.value = name
	input.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes(label)).click()
	const seed = d.querySelector('.seed input')
	slide(seed, 4242)
	const erode = [...d.querySelectorAll('.slider')].find((l) => l.textContent.includes('Erosion')).querySelector('input')
	slide(erode, erosion)
	await P.frames(1)
	const t0 = performance.now()
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === name, 30_000, `the ${label} world`)
	r[`${name}Ms`] = Math.round(performance.now() - t0)
	await P.frames(3)
	return P.e.terrain
}
const range = (t) => {
	let lo = Infinity
	let hi = -Infinity
	for (const h of t.heights) ((lo = Math.min(lo, h)), (hi = Math.max(hi, h)))
	return [Math.round(lo), Math.round(hi)]
}
/** A view over the map's middle from 450 yd, inside the fog. With Follow the Ground off the camera sits on its target and the distance does nothing. */
const view = async (t, name) => {
	const w = t.worldSize
	P.e.controller.setFollowGround(true)
	P.e.controller.setView(w * 0.5, t.heightAt(w * 0.5, w * 0.5), w * 0.5, 0.8, 0.45, 450)
	P.fullView()
	await P.frames(30)
	P.save(await P.shot(), name)
}

let d = await open()
const sliders = [...d.querySelectorAll('.row.look:not(.water) .slider')]
r.sliders = sliders.map((l) => l.querySelector('span').textContent.trim())
// Height redraws the pictures.
const card = [...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Mountains')).querySelector('canvas')
const before = card.toDataURL()
slide(sliders[0].querySelector('input'), 2)
await P.frames(2)
r.heightRedraws = card.toDataURL() !== before
d.querySelector('.reset').click()
await P.frames(1)
r.reset = sliders[0].querySelector('span').textContent.trim()

const m = await create(d, 'Mountains', 'ProbeMountains', 0.5)
r.mountains = range(m)
r.mountainSea = +m.heightAt(5, 5).toFixed(1)
// The same seed with no erosion is another ground.
const { generateHeights } = await P.app('/src/lib/terrain/generate.ts')
const plain = new Float32Array(m.heights.length)
generateHeights(plain, m.size, m.cellSize, 'mountains', 4242, null, { relief: 1, roughness: 1, erosion: 0, seaDepth: 1 })
let moved = 0
for (let i = 0; i < plain.length; i++) moved += Math.abs(plain[i] - m.heights[i])
r.erodedYdAVertex = +(moved / plain.length).toFixed(2)
await view(m, 'mountains')

d = await open()
const hills = await create(d, 'Rolling hills', 'ProbeHills', 0.5)
r.hills = range(hills)
await view(hills, 'hills')

d = await open()
;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Canyon')).click()
await P.frames(1)
r.seaDepthOff = [...d.querySelectorAll('.slider')].find((l) => l.textContent.includes('Sea depth')).querySelector('input').disabled
const canyon = await create(d, 'Canyon', 'ProbeCanyon', 0.5)
const cw = canyon.worldSize
r.canyonFloor = Math.round(canyon.heightAt(cw / 2, cw / 2))
r.canyonCorner = Math.round(canyon.heightAt(2, 2))
await view(canyon, 'canyon')

const ok =
	r.sliders.length === 5 &&
	r.heightRedraws &&
	r.reset.includes('1.0') &&
	r.mountains[1] > 150 &&
	r.mountainSea < -25 &&
	r.erodedYdAVertex > 0.2 &&
	r.hills[1] > 35 &&
	r.hills[1] < 110 &&
	r.seaDepthOff &&
	r.canyonFloor < 40 &&
	r.canyonCorner > 250
return { ok, ...r }
