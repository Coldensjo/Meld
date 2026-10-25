// World › World Map's exploration overlays (#219): on Northshire (Azeroth 32_48), Elwynn Forest lists the client's twelve overlays (WorldMapOverlay.dbc, their art read) and the preview shows them over the base; Generate redraws the open block's subzones into them: Northshire Valley's piece, with Echo Ridge Mine and the vineyards drawn into it (its art covers them), and no new overlay. Write to Client then writes it in a throwaway client (#382): the dialog opened again reads the written map back, the twelve overlays and the generated picture; the real client is left alone.
// touches: frontend/src/components/WorldMapDialog.svelte, frontend/src/lib/io/worldMap.ts, internal/vmangos/worldmap.go, internal/vmangos/worldmapoverlay.go
await P.scene(P.BENCH)
await P.settle()
const { ui } = await P.state()
const open = async () => {
	ui.dialog = 'worldMap'
	const grid = await P.until(() => document.querySelector('#wm-zone')?.closest('.grid'), 30000, 'the World Map dialog')
	await P.until(() => /^12 overlays/.test(grid.querySelector('.row .dim')?.textContent ?? ''), 60000, "Elwynn's twelve overlays")
	await P.frames(1)
	return grid
}
let grid = await open()
const count = () => grid.querySelector('.row .dim')?.textContent ?? ''
const canvas = () => grid.parentElement.querySelector('canvas')
const read = () => {
	const c = canvas()
	return c.getContext('2d').getImageData(0, 0, c.width, c.height).data
}
const greenness = (px) => {
	let g = 0
	for (let i = 0; i < px.length; i += 4) if (px[i + 1] > px[i] + 10) g++
	return +(g / (px.length / 4)).toFixed(3)
}
/** The mean difference of two previews, per channel (0 to 255). */
const diff = (a, b) => {
	let d = 0
	for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
	return +(d / ((a.length / 4) * 3)).toFixed(2)
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const before = count()
const original = read()
const exploredBefore = greenness(original)
const toggle = [...grid.querySelectorAll('.row input[type=checkbox]')][1]
toggle.click()
await P.frames(1)
const baseOnly = greenness(read())
toggle.click()
const generate = button('Generate')
generate.click()
await P.until(() => /drawn/.test(count()) && !generate.disabled, 240000, 'Generate to draw the block')
await P.frames(1)
const generated = read()
const out = { before, exploredBefore, baseOnly, after: count(), exploredAfter: greenness(generated), generatedDiff: diff(original, generated) }

// Write to Client for real, into a throwaway copy of the client (#382), then the dialog opened again
// reads the zone's map from it.
const sb = await P.sandboxClient()
out.sandbox = sb.dataDir
try {
	button('Write to Client').click()
	await P.until(() => button('Working…'), 30000, 'Write to Client to start')
	await P.until(() => button('Write to Client') && !button('Write to Client').disabled, 240000, 'Write to Client')
	out.error = grid.parentElement.querySelector('.error')?.textContent ?? ''
	ui.dialog = null
	await P.frames(1)
	grid = await open()
	const reread = read()
	out.written = { count: count(), diff: diff(generated, reread), originalDiff: diff(original, reread), explored: greenness(reread) }
} finally {
	ui.dialog = null
	await P.frames(1)
}
out.ended = await P.endSandbox()

// The client's base is parchment where its subzones are and the overlays are green; Generate keeps
// the twelve, redrawing Northshire Valley's, and what was written reads back as generated (the BLPs
// are compressed, so nearly).
out.ok =
	before === '12 overlays' &&
	exploredBefore > baseOnly + 0.03 &&
	out.after === '12 overlays, 1 drawn' &&
	out.exploredAfter > baseOnly + 0.03 &&
	!out.error &&
	out.written?.count === '12 overlays' &&
	out.written.diff < out.written.originalDiff / 2 &&
	out.ended.wasOn &&
	out.ended.realUnchanged
return out
