// The options bar keeps one row at 1400 px (#254): the brush's Size and Strength sit on it next to the tool's modes, what doesn't fit wraps under More, which opens the bar over the viewport with every control in view; Esc closes it, and Tab onto a clipped control opens it. The Sculpt bar fits one row in every mode, with no More (#715), and its Brush button opens the panel of its other settings, which Esc closes.
// touches: frontend/src/components/OptionsBar.svelte
const e = P.e
const { editor } = await P.state()
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
// The Brush button opens its panel below the bar, inside the window, and Esc closes it.
Object.assign(editor, { sculptMode: 'flatten' })
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
// Tab onto a clipped control (the water tool's last button) opens the bar.
Object.assign(editor, { tool: 'water', waterMode: 'paint' })
await P.frames(3)
const last = [...bar().querySelectorAll('button, input, select')].filter((c) => !firstRow().some((f) => f.contains(c))).pop()
last?.focus()
// A headless page has no window focus, so focus() fires no focusin: send it as the app's window would.
if (last && !document.hasFocus()) last.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
await P.frames(2)
const focusOpens = !!last && bar().classList.contains('open')
return { ok: results.every((r) => r.ok) && focusOpens && !fits.length && panelOk && panelCloses, focusOpens, sculptOverflow: fits, panelOk, panelCloses, results, width: root().clientWidth }
