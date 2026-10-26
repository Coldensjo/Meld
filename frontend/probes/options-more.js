// The options bar keeps one row at 1400 px (#254): the brush's Size and Strength sit on it next to the tool's modes, what doesn't fit wraps under More, which opens the bar over the viewport with every control in view; Esc closes it, and Tab onto a clipped control opens it. The Sculpt, Water, Doodad and Paint bars fit one row in every mode, with no More (#715, #734), and their panel button (Sculpt's Brush) opens the panel of their other settings, which Esc closes.
// touches: frontend/src/components/OptionsBar.svelte
const e = P.e
const { editor, prefs } = await P.state()
e.newDocument(256, 'mountains', 3, 'Probe')
const root = () => document.querySelector('[data-ui="OptionsBar"]')
const bar = () => root().querySelector('.options')
const more = () => root().querySelector('.more')
const visible = (c) => c.getBoundingClientRect().width > 0
const firstRow = () => {
	const top = bar().getBoundingClientRect().top
	return [...bar().children].filter((c) => visible(c) && c.getBoundingClientRect().top - top <= 20)
}
const label = (c) => (c.textContent || '').replace(/\s+/g, ' ').trim()
const cases = [
	['sculpt hole', { tool: 'sculpt', sculptMode: 'hole' }, ['Size']],
	['sculpt raise', { tool: 'sculpt', sculptMode: 'raise' }, ['Size', 'Strength']],
	['sculpt terrace', { tool: 'sculpt', sculptMode: 'terrace' }, ['Size', 'Strength']],
	['water', { tool: 'water', waterMode: 'paint' }, ['Size']],
	['doodad models', { tool: 'doodad', doodadMode: 'models' }, ['Size', 'Strength']],
	['doodad creatures', { tool: 'doodad', doodadMode: 'creatures' }, ['Size']],
	['paint', { tool: 'paint', paintMode: 'texture' }, ['Size', 'Strength']],
	['place', { tool: 'place' }, []],
]
// Every Sculpt mode fits the row at 1400 px, Flatten with its lock, angled plane and paint on too (#715).
const SCULPT_MODES = ['raise', 'lower', 'smooth', 'blur', 'flatten', 'noise', 'mountain', 'crevice', 'terrace', 'erode', 'vertex', 'hole']
const fits = []
editor.flattenLock.on = true
editor.flattenAngled.on = true
editor.sculptPaint = 'slope'
for (const m of SCULPT_MODES) {
	Object.assign(editor, { tool: 'sculpt', sculptMode: m })
	await P.frames(3)
	const hiddenN = [...bar().children].filter(visible).length - firstRow().length
	if (hiddenN || more()) fits.push({ mode: m, hidden: hiddenN })
}
// So does every mode of Water, Doodad and Paint, with their switches that add controls on (#734).
const spawnEntries = prefs.spawnBrush.entries
prefs.spawnBrush.entries = [
	{ entry: 1, name: 'Kobold Vermin', weight: 50 },
	{ entry: 2, name: 'Defias Thug', weight: 50 },
]
const OTHER_MODES = [
	['water paint', { tool: 'water', waterMode: 'paint' }],
	['water dig', { tool: 'water', waterMode: 'dig' }],
	['water shore', { tool: 'water', waterMode: 'shore' }],
	['doodad models', { tool: 'doodad', doodadMode: 'models' }],
	['doodad creatures', { tool: 'doodad', doodadMode: 'creatures' }],
	['paint texture', { tool: 'paint', paintMode: 'texture' }],
	['paint spray', { tool: 'paint', paintMode: 'texture', paintSpray: true }],
	['paint swap', { tool: 'paint', paintMode: 'swap', paintSpray: false }],
	['paint mask', { tool: 'paint', paintMode: 'mask' }],
	['paint mask by slope', { tool: 'paint', paintMode: 'mask' }, () => (editor.maskSelect.by = 'slope')],
]
editor.water.lock = true
editor.followGround = true
for (const [m, set, extra] of OTHER_MODES) {
	Object.assign(editor, set)
	extra?.()
	await P.frames(3)
	const hiddenN = [...bar().children].filter(visible).length - firstRow().length
	if (hiddenN || more() || !root().querySelector('.brushbtn')) fits.push({ mode: m, hidden: hiddenN })
}
editor.maskSelect.by = 'brush'
editor.water.lock = false
editor.followGround = false
// The Water bar's panel holds its overrides and opacity, and Esc closes it too.
Object.assign(editor, { tool: 'water', waterMode: 'paint' })
await P.frames(3)
root().querySelector('.brushbtn').click()
await P.frames(3)
const wpanel = root().querySelector('.brushpanel')
const waterPanelOk = !!wpanel?.querySelector('[aria-label="Opacity"]')
wpanel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await P.frames(2)
const waterPanelCloses = !root().querySelector('.brushpanel')
// Fourteen creatures stay one chip on the bar; the Spawns panel lists them (#735).
prefs.spawnBrush.entries = Array.from({ length: 14 }, (_, i) => ({ entry: 100 + i, name: `Creature number ${i}`, weight: 10 }))
Object.assign(editor, { tool: 'doodad', doodadMode: 'creatures' })
await P.frames(3)
const chipsOnBar = bar().querySelectorAll('.chip').length
const barOneRow = !more() && [...bar().children].filter(visible).length === firstRow().length
root().querySelector('.brushbtn').click()
await P.frames(3)
const creaturesInPanel = root().querySelectorAll('.brushpanel .chip').length
root()
	.querySelector('.brushpanel')
	?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await P.frames(2)
prefs.spawnBrush.entries = spawnEntries
const spawnChipsOk = chipsOnBar === 1 && barOneRow && creaturesInPanel === 14
// The Brush button opens its panel below the bar, inside the window, and Esc closes it.
Object.assign(editor, { tool: 'sculpt', sculptMode: 'flatten' })
await P.frames(3)
root().querySelector('.brushbtn').click()
await P.frames(3)
const panel = root().querySelector('.brushpanel')
const pr = panel?.getBoundingClientRect()
const panelOk =
	!!pr &&
	pr.top >= bar().getBoundingClientRect().bottom - 1 &&
	pr.right <= root().getBoundingClientRect().right + 1 &&
	!!panel.querySelector('[aria-label="Flatten target"]') &&
	!!panel.querySelector('[aria-label="Paint while sculpting"]')
panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await P.frames(2)
const panelCloses = !root().querySelector('.brushpanel')
editor.flattenLock.on = false
editor.flattenAngled.on = false
editor.sculptPaint = 'off'
const results = []
for (const [name, set, keep] of cases) {
	Object.assign(editor, set)
	await P.frames(3)
	const row = firstRow().map(label)
	const kept = keep.every((k) => row.some((r) => r.startsWith(k)))
	const hiddenN = [...bar().children].filter(visible).length - firstRow().length
	// The More button names how many are clipped, and is there only when some are.
	const btn = more()
	const counted = hiddenN ? btn?.textContent.includes(`(${hiddenN})`) : !btn
	let opened = true
	let rowStays = true
	if (btn) {
		btn.click()
		await P.frames(2)
		const r = bar().getBoundingClientRect()
		// Open: nothing clipped, every control inside the bar, and the window's row stays 34 px high.
		opened = bar().scrollHeight <= bar().clientHeight + 1 && [...bar().children].filter(visible).every((c) => c.getBoundingClientRect().bottom <= r.bottom + 1)
		rowStays = Math.round(root().getBoundingClientRect().height) === 34
		bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await P.frames(2)
		opened = opened && !bar().classList.contains('open')
	}
	results.push({ name, ok: kept && counted && opened && rowStays, kept, hidden: hiddenN, counted, opened, rowStays })
}
// Tab onto a clipped control opens the bar. No bar overflows at 1400 px now, so narrow the options bar's window to 700 px.
prefs.spawnBrush.entries = Array.from({ length: 14 }, (_, i) => ({ entry: 100 + i, name: `Creature number ${i}`, weight: 10 }))
root().style.maxWidth = '700px'
Object.assign(editor, { tool: 'doodad', doodadMode: 'creatures' })
await P.frames(3)
const last = [...bar().querySelectorAll('button, input, select')].filter((c) => !firstRow().some((f) => f.contains(c))).pop()
last?.focus()
// A headless page has no window focus, so focus() fires no focusin: send it as the app's window would.
if (last && !document.hasFocus()) last.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
await P.frames(2)
const focusOpens = !!last && bar().classList.contains('open')
bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
prefs.spawnBrush.entries = spawnEntries
root().style.maxWidth = ''
await P.frames(2)
return {
	ok: results.every((r) => r.ok) && focusOpens && !fits.length && panelOk && panelCloses && waterPanelOk && waterPanelCloses && spawnChipsOk,
	focusOpens,
	spawnChipsOk,
	chipsOnBar,
	barOneRow,
	creaturesInPanel,
	overflow: fits,
	panelOk,
	panelCloses,
	waterPanelOk,
	waterPanelCloses,
	results,
	width: root().clientWidth,
}
