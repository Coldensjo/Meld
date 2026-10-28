// A new world's rivers (#763): in the Start dialog's New world, the water row has a Rivers slider (none at first) and the Liquid select, greyed out until Lakes or Rivers asks for it; Rivers at 4 with Magma puts magma's orange into the Rolling hills picture without lakes; Create world makes a Medium (3×3) Rolling hills world (seed 4242) with up to 4 River paths in the Path tool's list, each of magma, falling from the high ground at least 8 yd to a mouth at the sea or a lake, its liquid magma layers only, never under the sea, the surface the same on both sides of every chunk edge it crosses (fillRiver's rule), the ground carved under it, sand on its banks, no scattered model standing in it, and `exportInput` sending the layers. Saves a view with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/water/rivers.ts, frontend/src/lib/water/lakes.ts, frontend/src/lib/tools/pathApply.ts, frontend/src/lib/terrain/presets.ts
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
	const label = (start) => [...row.querySelectorAll('.field')].find((f) => f.querySelector('span')?.textContent.trim().startsWith(start))
	const rivers = label('Rivers')
	r.riversAtFirst = rivers?.querySelector('span').textContent.trim().replace(/\s+/g, ' ')
	const select = row.querySelector('select')
	r.liquidOffAtFirst = select.disabled
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Medium')).click()
	const name = d.querySelector('input[type=text]')
	name.value = 'ProbeRivers'
	name.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Rolling hills')).click()
	slide(d.querySelector('.seed input'), 4242)
	const card = [...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Rolling hills')).querySelector('canvas')
	await P.frames(2)
	r.orangeBefore = orange(card)
	slide(rivers.querySelector('input[type=range]'), 4)
	await P.frames(1)
	r.liquidOn = !select.disabled
	select.value = select.querySelector('option:last-child').value
	select.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(2)
	r.riversShown = rivers.querySelector('span').textContent.trim().replace(/\s+/g, ' ')
	r.orangeAfter = orange(card)
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === 'ProbeRivers', 60_000, 'the world')
	await P.frames(3)
	const t = P.e.terrain
	const sea = editor.waterLevel
	const paths = editor.paths.filter((p) => p.kind === 'river')
	r.rivers = paths.map((p) => ({ name: p.name, points: p.points.length, width: p.width, liquid: p.liquid, drop: +(p.points[0].y - p.points[p.points.length - 1].y).toFixed(1), mouth: +p.points[p.points.length - 1].y.toFixed(1) }))
	const V = t.verts
	const cs = t.cellSize
	const ground = (x, z) => t.heights[Math.round(z / cs) * V + Math.round(x / cs)]
	// The ground in the middle of each river lies under its surface there.
	r.carved = paths.filter((p) => {
		const q = p.points[Math.floor(p.points.length / 2)]
		return ground(q.x, q.z) < q.y
	}).length
	const liquids = P.e.debug.doc.liquids
	const C = 8
	const ids = new Set()
	let cells = 0
	let underSea = 0
	for (const [, layers] of liquids.entries()) {
		for (const l of layers) {
			ids.add(l.id)
			for (let k = 0; k < C * C; k++) {
				if (!l.cells[k]) continue
				cells++
				if (l.heights[Math.floor(k / C) * (C + 1) + (k % C)] < sea - 0.01) underSea++
			}
		}
	}
	r.ids = [...ids]
	r.cells = cells
	r.underSea = underSea
	// Across every chunk edge a river crosses, both chunks' corners on the edge stand at one height.
	const layerAt = (cx, cz) => (cx < liquids.side && cz < liquids.side ? liquids.layers(cz * liquids.side + cx).find((l) => l.id === 3) : undefined)
	const wet = (l, lx, lz) => !!l && lx >= 0 && lz >= 0 && lx < C && lz < C && !!l.cells[lz * C + lx]
	let edges = 0
	let steps = 0
	for (let cz = 0; cz < liquids.side; cz++) {
		for (let cx = 0; cx < liquids.side; cx++) {
			const a = layerAt(cx, cz)
			if (!a) continue
			const east = layerAt(cx + 1, cz)
			const south = layerAt(cx, cz + 1)
			for (let i = 0; i < C; i++) {
				if (east && wet(a, C - 1, i) && wet(east, 0, i)) {
					edges++
					if (Math.abs(a.heights[i * (C + 1) + C] - east.heights[i * (C + 1)]) > 0.01) steps++
				}
				if (south && wet(a, i, C - 1) && wet(south, i, 0)) {
					edges++
					if (Math.abs(a.heights[C * (C + 1) + i] - south.heights[i]) > 0.01) steps++
				}
			}
		}
	}
	r.chunkEdges = edges
	r.steps = steps
	// Sand (role 4, the palette's fifth texture on a new world) in the chunks a river runs through.
	const slots = t.chunkSlots.length / (liquids.side * liquids.side)
	let riverChunks = 0
	let sandy = 0
	for (const [c] of liquids.entries()) {
		riverChunks++
		if (t.chunkSlots.subarray(c * slots, (c + 1) * slots).includes(4)) sandy++
	}
	r.sandShare = +(sandy / riverChunks).toFixed(2)
	// The trees and rocks scattered after (#758) keep out of the rivers and their lakes.
	let models = 0
	let wetModels = 0
	for (const o of P.e.objects.objects.values()) {
		models++
		if (liquids.covers(o.x, o.z, cs, t.heightAt(o.x, o.z))) wetModels++
	}
	r.models = models
	r.wetModels = wetModels
	const input = P.e.exportInput()
	r.exportLayers = [...input.liquids.entries()].length
	// A view down the biggest river from above its middle.
	const p = paths[0]
	if (p) {
		const q = p.points[Math.floor(p.points.length / 2)]
		P.e.controller.setFollowGround(true)
		P.e.controller.setView(q.x, q.y, q.z, 0.9, 0.6, 160)
		P.fullView()
		await P.frames(30)
		P.save(await P.shot(), 'rivers')
	}
} finally {
	ui.showNewDialog = false
}

const ok =
	r.riversAtFirst === 'Rivers none' &&
	r.liquidOffAtFirst &&
	r.liquidOn &&
	r.riversShown === 'Rivers 4' &&
	r.orangeBefore === 0 &&
	r.orangeAfter > 0 &&
	r.rivers.length >= 1 &&
	r.rivers.length <= 4 &&
	r.rivers.every((q) => q.liquid === 3 && q.points >= 3 && q.drop >= 8 && q.mouth >= editor.waterLevel - 0.01) &&
	r.carved === r.rivers.length &&
	r.ids.length === 1 &&
	r.ids[0] === 3 &&
	r.cells > 50 &&
	r.underSea === 0 &&
	r.chunkEdges > 0 &&
	r.steps === 0 &&
	r.sandShare > 0.5 &&
	r.wetModels === 0 &&
	r.exportLayers > 0
return { ok, ...r }
