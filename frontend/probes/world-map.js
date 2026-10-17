// World › World Map's exploration overlays (#219): on Northshire (Azeroth 32_48), Elwynn Forest lists the client's twelve overlays (WorldMapOverlay.dbc, their art read) and the preview shows them over the base; Generate redraws the open block's subzones into them: Northshire Valley's piece, with Echo Ridge Mine and the vineyards drawn into it (its art covers them), and no new overlay. Write to Client is not pressed: it writes the client's patch.
await P.scene(P.BENCH)
await P.settle()
const { ui } = await P.state()
ui.dialog = 'worldMap'
const grid = await P.until(() => document.querySelector('#wm-zone')?.closest('.grid'), 30000, 'the World Map dialog')
const count = () => grid.querySelector('.row .dim')?.textContent ?? ''
await P.until(() => /^12 overlays/.test(count()), 60000, "Elwynn's twelve overlays")
const canvas = document.querySelector('[data-ui~="WorldMapDialog"] canvas') ?? grid.parentElement.querySelector('canvas')
const read = () => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
const greenness = (px) => {
	let g = 0
	for (let i = 0; i < px.length; i += 4) if (px[i + 1] > px[i] + 10) g++
	return +(g / (px.length / 4)).toFixed(3)
}
await P.frames(1)
const before = count()
const exploredBefore = greenness(read())
const toggle = [...grid.querySelectorAll('.row input[type=checkbox]')][1]
toggle.click()
await P.frames(1)
const baseOnly = greenness(read())
toggle.click()
const generate = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Generate')
generate.click()
await P.until(() => /drawn/.test(count()) && !generate.disabled, 240000, 'Generate to draw the block')
await P.frames(1)
const out = { before, exploredBefore, baseOnly, after: count(), exploredAfter: greenness(read()) }
ui.dialog = null
// The client's base is parchment where its subzones are and the overlays are green; Generate keeps
// the twelve, redrawing Northshire Valley's.
out.ok = before === '12 overlays' && exploredBefore > baseOnly + 0.03 && out.after === '12 overlays, 1 drawn' && out.exploredAfter > baseOnly + 0.03
return out
