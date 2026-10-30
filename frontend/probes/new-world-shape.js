// A new world's ground (#744): the Start dialog's New world page shows one section at a time (Basics, Land, Water, Textures and trees, Seed and ID, #776) and fits a 1280×720 window at the 1.25 UI scale (512 px tall) without scrolling whichever is shown; the Height, Roughness, Erosion, Land, Sea depth and Beaches sliders are there with their defaults, Height redraws the preset pictures and the Land section's picture, and Create world makes a Large (4×4) Mountains world whose peaks stand over 150 yd with the sea round it going down past 25 yd, eroded (its heights differ from the same seed made with Erosion at none, through `generateHeights`); a Large Rolling hills world tops out between 35 and 110 yd; a Large Canyon (Sea depth and Beaches greyed out for it) has a low floor in the middle and walls over 250 yd at the corners; a Small Island at the default Beaches (40 yd) has land within 20 yd of the sea no more than 1.5 yd over it, painted sand (#766), and a view along its coast. Saves a view over each with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/terrain/presets.ts, frontend/src/lib/terrain/generate.ts, frontend/src/lib/terrain/Terrain.ts
const { ui } = await P.state()
const r = {}

/** Opens the Start dialog's New world page. */
const open = async () => {
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	return P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
}
/** Shows the New world page's section `id` (#776: basics, land, water, ground, seed). */
const tab = (d, id) => d.querySelector(`[data-section=${id}]`).click()
/** Sets a range input and tells Svelte. */
const slide = (input, value) => {
	input.value = String(value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** Makes a world of preset `label` (Large, or size `size`) named `name` from the open dialog `d`, with Erosion `erosion`; returns its terrain. */
const create = async (d, label, name, erosion, size = 'Large') => {
	tab(d, 'basics')
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes(size)).click()
	const input = d.querySelector('input[type=text]')
	input.value = name
	input.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes(label)).click()
	tab(d, 'seed')
	const seed = d.querySelector('.seed input')
	slide(seed, 4242)
	tab(d, 'land')
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
// The page fits a 1280×720 window at the 1.25 UI scale without scrolling (#776): every section, one shown at a time.
{
	const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
	const body = d.querySelector('.body')
	r.sections = []
	for (const b of d.querySelectorAll('[data-section]')) {
		b.click()
		await P.frames(1)
		const shown = [...d.querySelectorAll('[data-section-body]')].filter((s) => getComputedStyle(s).visibility === 'visible').map((s) => s.dataset.sectionBody)
		r.sections.push({ id: b.dataset.section, shown: shown.join(), height: Math.round(d.getBoundingClientRect().height / zoom), scrolls: body.scrollHeight > body.clientHeight + 1 })
	}
	r.fits = r.sections.length === 5 && r.sections.every((s) => s.shown === s.id && s.height <= 512 && !s.scrolls)
	tab(d, 'basics')
}
tab(d, 'land')
const sliders = [...d.querySelectorAll('.row.look:not(.water) .slider')]
r.sliders = sliders.map((l) => l.querySelector('span').textContent.trim())
// Height redraws the pictures, the cards' and the Land section's own.
const big = d.querySelector('[data-section-body=land] .picture canvas')
const bigBefore = big.toDataURL()
const card = [...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Mountains')).querySelector('canvas')
const before = card.toDataURL()
slide(sliders[0].querySelector('input'), 2)
await P.frames(2)
r.heightRedraws = card.toDataURL() !== before && big.toDataURL() !== bigBefore
d.querySelector('.reset').click()
await P.frames(1)
r.reset = sliders[0].querySelector('span').textContent.trim()

const m = await create(d, 'Mountains', 'ProbeMountains', 0.5)
r.mountains = range(m)
r.mountainSea = +m.heightAt(5, 5).toFixed(1)
// The same seed with no erosion is another ground.
const { generateHeights } = await P.app('/src/lib/terrain/generate.ts')
const plain = new Float32Array(m.heights.length)
generateHeights(plain, m.size, m.cellSize, 'mountains', 4242, null, { relief: 1, roughness: 1, erosion: 0, seaDepth: 1, beach: 40 })
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
r.beachesOff = [...d.querySelectorAll('.slider')].find((l) => l.textContent.includes('Beaches')).querySelector('input').disabled
const canyon = await create(d, 'Canyon', 'ProbeCanyon', 0.5)
const cw = canyon.worldSize
r.canyonFloor = Math.round(canyon.heightAt(cw / 2, cw / 2))
r.canyonCorner = Math.round(canyon.heightAt(2, 2))
await view(canyon, 'canyon')

// Beaches (#766): the land within 20 yd of the sea lies nearly flat, and sand covers it.
d = await open()
r.beachLabel = [...d.querySelectorAll('.slider')]
	.find((l) => l.textContent.includes('Beaches'))
	.querySelector('span')
	.textContent.trim()
const isle = await create(d, 'Island', 'ProbeIsland', 0.5, 'Small')
{
	const V = isle.verts
	const hs = isle.heights
	const sea = P.e.debug.doc.meta.waterLevel
	const reach = Math.ceil(20 / isle.cellSize)
	let hi = -Infinity
	let n = 0
	let coastAt = -1
	// Sand (role 4, the palette's fifth texture on a new world) in the paint chunk of each beach vertex.
	const pcs = isle.paintChunksPerSide
	const slots = isle.chunkSlots.length / (pcs * pcs)
	const span = isle.worldSize / pcs
	let sandy = 0
	for (let z = reach; z < V - reach; z++) {
		for (let x = reach; x < V - reach; x++) {
			const i = z * V + x
			if (hs[i] < sea) continue
			let near = false
			for (let dz = -reach; dz <= reach && !near; dz++) for (let dx = -reach; dx <= reach && !near; dx++) if (dx * dx + dz * dz <= reach * reach && hs[i + dz * V + dx] < sea) near = true
			if (!near) continue
			n++
			hi = Math.max(hi, hs[i] - sea)
			const c = Math.min(pcs - 1, Math.floor((z * isle.cellSize) / span)) * pcs + Math.min(pcs - 1, Math.floor((x * isle.cellSize) / span))
			if (isle.chunkSlots.subarray(c * slots, (c + 1) * slots).includes(4)) sandy++
			if (coastAt < 0 && z > V / 2) coastAt = i
		}
	}
	r.beachVerts = n
	r.beachTop = +hi.toFixed(2)
	r.beachSandShare = +(sandy / n).toFixed(3)
	const cx = (coastAt % V) * isle.cellSize
	const cz = Math.floor(coastAt / V) * isle.cellSize
	P.e.controller.setFollowGround(true)
	P.e.controller.setView(cx, isle.heightAt(cx, cz), cz, 0.8, 0.35, 160)
	P.fullView()
	await P.frames(30)
	P.save(await P.shot(), 'island-beach')
}

const ok =
	r.fits &&
	r.sliders.length === 6 &&
	r.beachLabel.includes('40 yd') &&
	r.beachesOff &&
	r.beachVerts > 500 &&
	r.beachTop <= 1.6 &&
	r.beachSandShare > 0.95 &&
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
