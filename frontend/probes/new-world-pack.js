// A new world painted with a zone's textures (#733): in the Start dialog's New world, Ground textures offers the client's zones by continent; picking Tanaris reads the textures its own tiles use (ZoneTextures, the seabed left out) and shows the eight roles' pictures, and Create world makes a Small Island whose palette is Tanaris's (its main sand as the ground, another sand for the lush patches since it has no grass, its rock on the slopes, no snow so the peaks take the rock), painted by role, the shore in the sand role. Picking Default again goes back to Elwynn's. Saves a view with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/wow/texturePack.ts, internal/vmangos/zonetextures.go
const { ui, editor } = await P.state()
const r = {}
const file = (p) => p.slice(p.lastIndexOf('\\') + 1)

try {
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
	r.groups = [...select.querySelectorAll('optgroup')].map((g) => g.label)
	const pick = (label) => {
		const o = [...select.options].find((x) => x.textContent.trim() === label)
		select.value = o.value
		select.dispatchEvent(new Event('change', { bubbles: true }))
	}
	pick('Tanaris')
	const t0 = performance.now()
	await P.until(() => d.querySelectorAll('.packtile').length === 8, 30_000, "Tanaris's textures")
	r.readMs = Math.round(performance.now() - t0)
	r.tiles = [...d.querySelectorAll('.packtile [title]')].map((e) => e.getAttribute('title'))
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Small')).click()
	const name = d.querySelector('input[type=text]')
	name.value = 'ProbePack'
	name.dispatchEvent(new Event('input', { bubbles: true }))
	;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Island')).click()
	await P.frames(1)
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === 'ProbePack', 30_000, 'the world')
	await P.frames(3)
	r.palette = editor.palette.map(file)
	// Which palette entries the ground uses, and how often.
	const used = {}
	for (const s of P.e.terrain.chunkSlots) if (s < 255) used[s] = (used[s] ?? 0) + 1
	r.used = used
	const t = P.e.terrain
	const w = t.worldSize
	P.e.controller.setFollowGround(true)
	P.e.controller.setView(w * 0.5, t.heightAt(w * 0.5, w * 0.5), w * 0.5, 0.8, 0.5, 500)
	P.fullView()
	await P.frames(30)
	P.save(await P.shot(), 'tanaris')

	// Default again: Elwynn's textures, and no pictures.
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	const d2 = await P.until(() => P.dialog('Start')?.querySelector('.row.pack select') && P.dialog('Start'), 10_000, 'the Start dialog again')
	const s2 = d2.querySelector('.row.pack select')
	s2.value = '0'
	s2.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(2)
	r.defaultTiles = d2.querySelectorAll('.packtile').length
} finally {
	ui.showNewDialog = false
}

const p = r.palette ?? []
const ok =
	r.groups.length >= 2 &&
	r.tiles.length === 8 &&
	r.tiles[0].startsWith('Grass: ') &&
	p.length === 8 &&
	p[0] === 'TanarisSandStones.blp' &&
	p[3].startsWith('TanarisRock') &&
	p[5] === p[3] &&
	p[1] === 'TanarisSandBase01.blp' &&
	/sand/i.test(p[4]) &&
	(r.used[0] ?? 0) > 0 &&
	(r.used[4] ?? 0) > 0 &&
	r.defaultTiles === 0
return { ok, ...r }
