// A new world with a zone's trees (#758): in the Start dialog's New world, Ground textures Duskwood and Trees and rocks left at the zone's, Create world makes a Small Island and scatters Duskwood's most placed trees, bushes and rocks over it (ZoneDoodads, wow/zoneTrees.ts, Engine.scatterWorld): every model a tree, a bush or a rock by its path, Duskwood's own the most placed, none in the sea or on its beach, none on ground steeper than its brush allows (but a few, since the probe's slope is measured another way than the brush's), none above the snow line, the two scatters one undo step each. Trees and rocks None makes a world without models. Logs how long Create world took. Saves a view with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/wow/zoneTrees.ts, frontend/src/lib/tools/DoodadBrushTool.ts, internal/vmangos/zonedoodads.go
const { ui, editor } = await P.state()
const r = {}
const { doodadKind } = await P.app('/src/lib/wow/zoneTrees.ts')

/** Opens the New world page, sets the textures, the trees, Small and Island, and creates `name`; resolves once its tab is open. */
async function make(name, zone, trees) {
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
	const select = await P.until(
		() => {
			const s = d.querySelector('.row.pack select')
			return s && !s.disabled && s.querySelector('option[value]:not([value="0"])') ? s : null
		},
		20_000,
		'the zones in Ground textures',
	)
	const o = [...select.options].find((x) => x.textContent.trim() === zone)
	select.value = o.value
	select.dispatchEvent(new Event('change', { bubbles: true }))
	await P.until(() => d.querySelectorAll('.packtile').length === 8, 30_000, `${zone}'s textures`)
	const ts = d.querySelector('.row.trees select')
	r.treeLabel = ts.options[0].textContent.trim()
	ts.value = trees
	ts.dispatchEvent(new Event('change', { bubbles: true }))
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Small')).click()
	const input = d.querySelector('input[type=text]')
	input.value = name
	input.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Island')).click()
	await P.frames(1)
	const t0 = performance.now()
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === name, 60_000, name)
	await P.frames(3)
	return Math.round(performance.now() - t0)
}

try {
	r.createMs = await make('ProbeTrees', 'Duskwood', 'zone')
	const t = P.e.terrain
	const objs = [...P.e.objects.objects.values()]
	r.models = objs.length
	const kinds = {}
	const types = {}
	let wet = 0
	let steep = 0
	let high = 0
	let foreign = 0
	let maxH = -Infinity
	for (let i = 0; i < t.heights.length; i++) maxH = Math.max(maxH, t.heights[i])
	const snow = Math.max(editor.waterLevel + 110, maxH * 0.72)
	const e = t.cellSize
	for (const o of objs) {
		const path = o.type.slice(3)
		const k = doodadKind(path)
		kinds[k] = (kinds[k] ?? 0) + 1
		types[path.slice(path.lastIndexOf('\\') + 1)] = (types[path.slice(path.lastIndexOf('\\') + 1)] ?? 0) + 1
		if (!k) foreign++
		const h = t.heightAt(o.x, o.z)
		if (editor.waterEnabled && h < editor.waterLevel + 2 - 0.01) wet++
		if (h > snow) high++
		const slope = (Math.atan(Math.hypot(t.heightAt(o.x + e, o.z) - t.heightAt(o.x - e, o.z), t.heightAt(o.x, o.z + e) - t.heightAt(o.x, o.z - e)) / (2 * e)) * 180) / Math.PI
		if (slope > (k === 'rock' ? 45 : 30) + 5) steep++
	}
	Object.assign(r, { kinds, wet, steep, high, foreign })
	r.top = Object.entries(types)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6)
	r.undo = P.e.history.steps().map((s) => s.label)
	const w = t.worldSize
	P.e.controller.setFollowGround(true)
	P.e.controller.setView(w * 0.5, t.heightAt(w * 0.5, w * 0.5), w * 0.5, 0.6, 0.45, 350)
	P.fullView()
	await P.frames(40)
	P.save(await P.shot(), 'duskwood-trees')

	await make('ProbeNoTrees', 'Duskwood', 'none')
	r.noneModels = P.e.objects.objects.size
} finally {
	ui.showNewDialog = false
}

const ok =
	r.treeLabel === "Duskwood's" &&
	r.models > 150 &&
	r.undo.join() === 'Scatter trees,Scatter rocks' &&
	(r.kinds.tree ?? 0) > 0 &&
	(r.kinds.bush ?? 0) > 0 &&
	r.wet === 0 &&
	r.steep <= r.models * 0.02 &&
	r.high === 0 &&
	r.foreign === 0 &&
	/^duskwood/.test(r.top[0][0]) &&
	r.noneModels === 0
return { ok, ...r }
