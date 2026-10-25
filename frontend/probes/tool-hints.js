// The options bar holds only controls (the controls that wrap under its More button are reported per tool as `hidden`; options-more checks them, #254); each tool's hint shows in the status bar's message slot, and a status message takes the slot and gives it back (#238).
// touches: frontend/src/components/OptionsBar.svelte, frontend/src/components/StatusBar.svelte, frontend/src/components/ToolHint.svelte
// tier: smoke
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
	// A late status message (the ground effects' count, read in the background) can take the slot: clear it and look again.
	let hint = ''
	for (let i = 0; i < 4 && !hint.includes(want); i++) {
		setStatus('Ready')
		await P.frames(3)
		hint = text()
	}
	const noHintInBar = ![...bar().querySelectorAll('.dim')].some((d) => d.textContent.includes(want))
	results.push({ name, hint: hint.slice(0, 50), ok: hint.includes(want) && noHintInBar, hidden: Number(/\((\d+)\)/.exec(bar().querySelector('.more')?.textContent ?? '')?.[1] ?? 0) })
}
// A message takes the slot, then the hint is back.
editor.tool = 'select'
setStatus('Saved probe', 0)
await P.frames(3)
const msgShown = text() === 'Saved probe'
setStatus('Ready')
await P.frames(3)
const hintBack = text().includes('Click a model')
return { ok: results.every((r) => r.ok) && msgShown && hintBack, msgShown, hintBack, results }
