// Opening an instance from the Start dialog's "Part of Azeroth" (#222): the Deadmines (an instance with ADT tiles) gets a block picked on its tiles and Open enabled, Molten Core (one WMO, no tiles) says it can't be opened and keeps Open greyed, and opening 2x2 tiles of the Deadmines reads its ground into a tab (it replaces the page's untouched start map).
const { ui, editor } = await P.state()
ui.newMapMode = 'open'
ui.showNewDialog = true
const openButton = () => [...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.trim() === 'Open')
const pick = async (dir) => {
	const row = await P.until(() => [...document.querySelectorAll('.mapname')].find((b) => (b.getAttribute('title') || '').startsWith(`${dir} (`)), 30000, `${dir} in the map list`)
	row.click()
}
await pick('DeadminesInstance')
const deadmines = await P.until(() => {
	const t = document.querySelector('.wrap .dim')?.textContent ?? ''
	return /^\s*Tiles/.test(t) && !openButton().disabled ? t.trim().replace(/\s+/g, ' ') : null
}, 30000, "the Deadmines' block picked and Open enabled")
const img = await P.until(() => {
	const i = document.querySelector('.wrap img')
	return i && i.complete && i.naturalWidth ? i : null
}, 60000, "the Deadmines' overview")
await pick('MoltenCore')
const moltenNote = await P.until(() => {
	const n = [...document.querySelectorAll('.wrap .note')].map((x) => x.textContent.trim()).find((t) => t.includes('no terrain tiles'))
	return n ?? null
}, 30000, "Molten Core's no-tiles note")
const moltenDisabled = openButton().disabled
await pick('DeadminesInstance')
await P.until(() => !openButton().disabled || null, 30000, 'Open enabled again')
// The picked block is 6x6 tiles, which SwiftShader takes minutes to draw; open 2x2 of it the way Open does.
ui.showNewDialog = false
const { openWowRegion } = await P.app('/src/lib/io/mapio.ts')
openWowRegion(P.e, 'DeadminesInstance', 32, 32, 2)
await P.until(() => editor.regionMap === 'DeadminesInstance' || null, 60000, "the Deadmines' tab")
const t = P.e.terrain
let lo = Infinity, hi = -Infinity
for (const h of t.heights) {
	lo = Math.min(lo, h)
	hi = Math.max(hi, h)
}
const out = { deadmines, overview: img.naturalWidth, moltenNote: moltenNote.slice(0, 60), moltenDisabled, relief: +(hi - lo).toFixed(1) }
out.ok = out.overview > 0 && moltenDisabled && out.relief > 1
return out
