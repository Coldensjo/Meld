// A new world's water (#759): in the Start dialog's New world, the water row has Sea level, Lakes and Lakes of (greyed out until Lakes is ticked); ticking Lakes with Magma puts magma's orange into the Rolling hills picture; Create world makes a Medium (3×3) Rolling hills world with the sea at 5 yd whose liquids are magma layers only, each covered cell's surface above the sea, over ground below it (a basin) and at its lake's rim, sand painted along the shores, and `exportInput` sending them with the sea at 5. Saves a view with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/water/lakes.ts, frontend/src/lib/terrain/presets.ts, frontend/src/lib/terrain/Terrain.ts
const { ui, editor } = await P.state()
const r = {}
const slide = (input, value) => {
	input.value = String(value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** Pixels of the canvas near magma's preview colour. */
const orange = (canvas) => {
	const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
	let n = 0
	for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 70 && data[i + 1] < 110 && data[i + 2] < 50) n++
	return n
}

try {
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
	const row = d.querySelector('.row.water')
	r.labels = [...row.querySelectorAll('.field > span, .check')].map((l) => l.textContent.trim().replace(/\s+/g, ' '))
	const select = row.querySelector('select')
	r.liquidOffAtFirst = select.disabled
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Medium')).click()
	const name = d.querySelector('input[type=text]')
	name.value = 'ProbeLakes'
	name.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Rolling hills')).click()
	slide(d.querySelector('.seed input'), 4242)
	const card = [...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Rolling hills')).querySelector('canvas')
	await P.frames(2)
	r.orangeBefore = orange(card)
	const lakes = row.querySelector('input[type=checkbox]')
	lakes.click()
	await P.frames(1)
	select.value = select.querySelector('option:last-child').value
	select.dispatchEvent(new Event('change', { bubbles: true }))
	slide(row.querySelector('input[type=range]'), 5)
	await P.frames(2)
	r.liquidOn = !select.disabled
	r.orangeAfter = orange(card)
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === 'ProbeLakes', 60_000, 'the world')
	await P.frames(3)
	const t = P.e.terrain
	r.sea = { enabled: editor.waterEnabled, level: editor.waterLevel }
	const liquids = P.e.doc.liquids
	const ids = new Set()
	let cells = 0
	let lowSurface = 0
	let dryUnder = 0
	const levels = new Set()
	const C = 8
	for (const [c, layers] of liquids.entries()) {
		const cx = c % liquids.side
		const cz = Math.floor(c / liquids.side)
		for (const l of layers) {
			ids.add(l.id)
			for (let k = 0; k < C * C; k++) {
				if (!l.cells[k]) continue
				cells++
				const lx = k % C
				const lz = Math.floor(k / C)
				const top = l.heights[lz * (C + 1) + lx]
				levels.add(Math.round(top * 10))
				if (top <= editor.waterLevel) lowSurface++
				// The lowest corner of the cell's ground is under the surface: the lake sits in a basin.
				const v = (cz * C + lz) * t.verts + cx * C + lx
				const low = Math.min(t.heights[v], t.heights[v + 1], t.heights[v + t.verts], t.heights[v + t.verts + 1])
				if (low >= top) dryUnder++
			}
		}
	}
	r.ids = [...ids]
	r.cells = cells
	r.lakes = levels.size
	r.lowSurface = lowSurface
	r.dryUnder = dryUnder
	// Sand (role 4, the palette's fifth texture on a new world) in the chunks the lakes lie in: their shores.
	const slots = t.chunkSlots.length / (liquids.side * liquids.side)
	let lakeChunks = 0
	let sandy = 0
	for (const [c] of liquids.entries()) {
		lakeChunks++
		if (t.chunkSlots.subarray(c * slots, (c + 1) * slots).includes(4)) sandy++
	}
	r.sandyLakeChunks = `${sandy}/${lakeChunks}`
	r.sandShare = sandy / lakeChunks
	const input = P.e.exportInput()
	r.export = { waterLevel: input.waterLevel, layers: [...input.liquids.entries()].length }
	// A view over the biggest lake's first cell.
	const [first] = [...liquids.entries()]
	if (first) {
		const [c, layers] = first
		const span = C * t.cellSize
		const x = ((c % liquids.side) + 0.5) * span
		const z = (Math.floor(c / liquids.side) + 0.5) * span
		P.e.controller.setFollowGround(true)
		P.e.controller.setView(x, layers[0].heights[0], z, 0.8, 0.5, 300)
		P.fullView()
		await P.frames(30)
		P.save(await P.shot(), 'lakes')
	}
} finally {
	ui.showNewDialog = false
}

const ok =
	r.labels.some((l) => l.startsWith('Sea level')) &&
	r.labels.includes('Lakes') &&
	r.liquidOffAtFirst &&
	r.liquidOn &&
	r.orangeBefore === 0 &&
	r.orangeAfter > 0 &&
	r.sea.enabled &&
	r.sea.level === 5 &&
	r.ids.length === 1 &&
	r.ids[0] === 3 &&
	r.cells > 50 &&
	r.lowSurface === 0 &&
	r.dryUnder === 0 &&
	r.sandShare > 0.5 &&
	r.export.waterLevel === 5 &&
	r.export.layers > 0
return { ok, ...r }
