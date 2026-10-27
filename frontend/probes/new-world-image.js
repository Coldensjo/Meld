// A new world from a heightmap (#745): in the Start dialog's New world, the From a heightmap… card asks for a PNG (the file dialog and ReadHeightmap stubbed with a grey cone drawn in the page: black rim, white peak), shows it in its picture and swaps the preset sliders for Black at, White at, Sea and Erosion (none to start); Create world makes a Small (2×2) world whose middle stands near White (200 yd), whose corners lie near Black (-40 yd) under a sea at 0, with the heights resampled from the 64-pixel image to the map's 257 vertices. Saves a view with `--shot`. Nothing written.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/lib/terrain/generate.ts, frontend/src/lib/terrain/presets.ts, frontend/src/lib/io/heightmapImport.ts
const { ui, editor } = await P.state()
const r = {}

// A cone 64 pixels a side, decoded as internal/heightmap does: black -1024, white +1024.
const side = 64
const heights = []
for (let y = 0; y < side; y++)
	for (let x = 0; x < side; x++) {
		const d = Math.hypot(x - (side - 1) / 2, y - (side - 1) / 2) / ((side - 1) / 2)
		heights.push(-1024 + Math.max(0, 1 - d) * 2048)
	}
const App = window.go.main.App
const stubs = { open: App.OpenHeightmapDialog, read: App.ReadHeightmap }
App.OpenHeightmapDialog = async () => 'C:\\Probe\\cone.png'
App.ReadHeightmap = async () => ({ side, heights })
const slide = (input, value) => {
	input.value = String(value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
try {
	ui.newMapMode = 'new'
	ui.showNewDialog = true
	const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
	;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Small')).click()
	const name = d.querySelector('input[type=text]')
	name.value = 'ProbeImage'
	name.dispatchEvent(new Event('input', { bubbles: true }))
	const card = () => d.querySelector('.preset.fromimage')
	card().click()
	await P.until(() => card().classList.contains('active') && card().querySelector('canvas'), 10_000, 'the image picked')
	await P.frames(2)
	r.cardName = card().querySelector('small').textContent.trim()
	// The picture: a bright middle over a dark (sea) rim.
	const px = card().querySelector('canvas').getContext('2d').getImageData(0, 0, 96, 96).data
	const lum = (x, y) => {
		const i = (y * 96 + x) * 4
		return px[i] + px[i + 1] + px[i + 2]
	}
	r.pictureMiddleBrighter = lum(48, 48) > lum(2, 2)
	r.labels = [...d.querySelectorAll('.row.look .field > span, .row.look .check')].map((l) => l.textContent.trim().replace(/\s+/g, ' '))
	r.presetSliders = [...d.querySelectorAll('.slider')].filter((l) => /Height|Roughness|Land|Sea depth/.test(l.textContent)).length
	const nums = [...d.querySelectorAll('.row.look input[type=number]')]
	slide(nums[0], -40)
	slide(nums[1], 200)
	await P.frames(1)
	;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
	await P.until(() => P.e.activeVmangos()?.dir === 'ProbeImage', 30_000, 'the world')
	await P.frames(3)
	const t = P.e.terrain
	const w = t.worldSize
	r.size = t.size
	r.middle = +t.heightAt(w / 2, w / 2).toFixed(1)
	r.corner = +t.heightAt(1, 1).toFixed(1)
	r.water = { enabled: editor.waterEnabled, level: editor.waterLevel }
	P.e.controller.setFollowGround(true)
	P.e.controller.setView(w * 0.5, t.heightAt(w * 0.5, w * 0.5), w * 0.5, 0.8, 0.45, 700)
	P.fullView()
	await P.frames(30)
	P.save(await P.shot(), 'image')
} finally {
	App.OpenHeightmapDialog = stubs.open
	App.ReadHeightmap = stubs.read
	ui.showNewDialog = false
}

const ok = r.cardName === 'cone.png' && r.pictureMiddleBrighter && r.presetSliders === 0 && r.labels.some((l) => l.startsWith('Erosion none')) && r.size === 256 && r.middle > 190 && r.corner < -35 && r.water.enabled && r.water.level === 0
return { ok, ...r }
