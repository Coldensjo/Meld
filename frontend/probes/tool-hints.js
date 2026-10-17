// The options bar holds only controls (its overflow per tool is reported as `over`, not judged: the controls of Water and the doodad brush still overflow at 1400 px); each tool's hint shows in the status bar's message slot, and a status message takes the slot and gives it back (#238).
const e = P.e
const { editor, ui, setStatus } = await P.state()
e.newDocument(256, 'mountains', 3, 'Probe')
const slot = () => document.querySelector('[data-ui="StatusBar"] .msg')
const text = () => slot().textContent.replace(/\s+/g, ' ').trim()
const bar = () => document.querySelector('[data-ui="OptionsBar"]')
const cases = [
	['select', { tool: 'select' }, 'Click a model to select it'],
	['sculpt hole', { tool: 'sculpt', sculptMode: 'hole' }, '2×2-cell blocks'],
	['sculpt vertex', { tool: 'sculpt', sculptMode: 'vertex' }, 'Drag to pick points'],
	['water', { tool: 'water', waterMode: 'paint' }, 'removes water'],
	['place', { tool: 'place' }, 'scroll rotate'],
	['stamp', { tool: 'stamp' }, "The size and strength are the stack's"],
	['doodad models', { tool: 'doodad', doodadMode: 'models' }, 'drag to scatter'],
	['mapdata impassable', { tool: 'mapdata', mapDataMode: 'impassable' }, 'hatched red'],
]
const results = []
ui.dialog = null
setStatus('Ready')
for (const [name, set, want] of cases) {
	Object.assign(editor, set)
	await P.frames(3)
	const hint = text()
	const noHintInBar = ![...bar().querySelectorAll('.dim')].some((d) => d.textContent.includes(want))
	results.push({ name, hint: hint.slice(0, 50), ok: hint.includes(want) && noHintInBar, over: bar().scrollWidth - bar().clientWidth })
}
// A message takes the slot, then the hint is back.
editor.tool = 'select'
setStatus('Saved probe', 0)
await P.frames(3)
const msgShown = text() === 'Saved probe'
setStatus('Ready')
await P.frames(3)
const hintBack = text().includes('Click a model')
return { ok: results.every((r) => r.ok) && msgShown && hintBack, msgShown, hintBack, results, barWidth: [bar().scrollWidth, bar().clientWidth] }
