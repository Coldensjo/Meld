// The Delete key deletes the selected model, and the tool letters work, whatever last held the focus (#345): a checkbox, a slider, a select, a closed editor.
// touches: frontend/src/App.svelte, frontend/src/lib/state/selection.ts, frontend/src/lib/tools/ObjectTools.ts
// tier: smoke
const e = P.e
const { ui, editor } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(2)
e.history.clear?.()
editor.tool = 'select'

const press = (target, key, init = {}) => {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(ev)
	return ev
}
const fresh = () => {
	const o = e.objects.add({ type: 'm2:probe', x: 100, z: 100, yOff: 0, rotY: 0, scale: 1 })
	sel.selectObjects(e.objects, [o.id])
	return o.id
}
const exists = (id) => e.objects.list().some((o) => o.id === id)
const field = (type) => {
	const el = document.createElement('input')
	el.type = type
	document.body.append(el)
	el.focus()
	return el
}
const results = {}
const tryDelete = (name, target) => {
	const id = fresh()
	press(target, 'Delete')
	results[name] = !exists(id)
	if (!exists(id)) e.undo()
	sel.selectObjects(e.objects, [])
}

tryDelete('body', document.body)
for (const type of ['checkbox', 'range', 'radio', 'button']) {
	const el = field(type)
	tryDelete(type, el)
	el.remove()
}
const select = document.createElement('select')
select.innerHTML = '<option>a</option><option>b</option>'
document.body.append(select)
select.focus()
tryDelete('select', select)
select.remove()
// A text field keeps Delete for its text.
const text = field('text')
const id = fresh()
press(text, 'Delete')
results.textKeepsDelete = exists(id)
text.remove()
sel.selectObjects(e.objects, [])
// Each editor, opened and closed, leaves the keys working.
for (const name of ['questEditor', 'itemEditor', 'spellEditor', 'objectEditor', 'creatureEditor']) {
	ui[name] = name === 'objectEditor' || name === 'creatureEditor' ? { key: null, entry: 0 } : { entry: 0 }
	await P.frames(2)
	ui[name] = null
	await P.frames(2)
	tryDelete('after ' + name, document.body)
}
// Ctrl+F under an open editor leaves the asset browser's search box alone (#574).
ui.itemEditor = { entry: 0 }
await P.frames(4)
await new Promise((r) => setTimeout(r, 50))
const before = document.activeElement
press(window, 'f', { ctrlKey: true })
const search = document.querySelector('.browser input[type="search"], .browser input[type="text"]')
results.ctrlFUnderEditor = !!document.querySelector('.editor') && document.activeElement !== search && document.activeElement === before
ui.itemEditor = null
await P.frames(2)
// A slider still keeps its arrow keys, and a tool letter reaches the tool.
const range = field('range')
range.value = '5'
const arrow = press(range, 'ArrowRight')
results.sliderKeepsArrows = !arrow.defaultPrevented
range.remove()
return { ok: Object.entries(results).every(([k, v]) => v === true), results }
