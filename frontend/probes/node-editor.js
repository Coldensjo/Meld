// Tools › Node Editor (#30): the window opens with its starter graph (a hill where the camera looks), Run compiles it to Lua and lifts the ground at the target as one undo step; a wire picked up off an input and let go in the open is unlinked, and Run then stops at that node, marked, without touching the map; a wire dragged from an output to the input links them again; the Add Node menu (a right-click) finds a node by name and adds it; and the Lua view shows the compiled script.
// touches: frontend/src/components/NodeEditorWindow.svelte, frontend/src/lib/script/nodeGraph.ts, frontend/src/lib/engine/ScriptRun.ts, frontend/src/lib/script/prelude.ts
const e = P.e
const { ui } = await P.state()
const bad = []
const r = {}
try {
	e.newDocument(256, 'flat', 0, 'Probe Nodes')
	await P.frames(1)
	const t = e.terrain
	await P.lookAt({ x: 128, y: t.heightAt(128, 128), z: 128 }, { pitch: 0.9, back: 80 })
	await P.frames(1)
	const target = e.controller.target.clone()
	ui.nodeEditor = true
	await P.frames(2)
	const win = document.querySelector('aside.nodes')
	if (!win) throw new Error('the Node Editor did not open')
	const nodes = () => [...win.querySelectorAll('.node')]
	const node = (title) => nodes().find((n) => n.querySelector('.head')?.textContent.includes(title))
	const button = (label) => [...win.querySelectorAll('.bar button')].find((b) => b.textContent.trim() === label)
	const out = () => [...win.querySelectorAll('.output div')].map((d) => d.textContent)
	r.nodes = nodes().length
	if (r.nodes !== 9) bad.push(`the starter graph shows ${r.nodes} nodes, not 9`)
	r.wires = win.querySelectorAll('path.wire').length
	if (r.wires !== 11) bad.push(`it shows ${r.wires} wires, not 11`)

	async function runGraph() {
		button('Run').click()
		await P.frames(1)
		for (let i = 0; i < 200 && !win.querySelector('.output .info, .output .err'); i++) await P.frames(1)
		return out()
	}

	// Run: the hill, one undo step.
	const pos0 = e.history.position
	const before = t.heightAt(target.x, target.z)
	r.out = await runGraph()
	const lift = t.heightAt(target.x, target.z) - before
	r.lift = +lift.toFixed(2)
	if (!(lift > 8 && lift < 10.01)) bad.push(`the starter graph lifted the target ${lift.toFixed(2)} yd, not about 10 (output ${JSON.stringify(r.out)})`)
	if (r.out[0] !== 'Raising a hill where the camera looks') bad.push(`it printed ${JSON.stringify(r.out)}`)
	if (e.history.position !== pos0 + 1) bad.push(`the run made ${e.history.position - pos0} undo steps`)
	e.history.undo()
	await P.frames(1)
	if (Math.abs(t.heightAt(target.x, target.z) - before) > 1e-6) bad.push('the undo left the hill')

	// Pointer events at an element's middle; a made-up pointer can't be captured, which the editor allows.
	const at = (el) => {
		const b = el.getBoundingClientRect()
		return { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }
	}
	const fire = (el, type, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, isPrimary: true, ...p }))
	async function dragPin(pin, to) {
		fire(pin, 'pointerdown', at(pin))
		await P.frames(1)
		fire(pin, 'pointermove', to)
		await P.frames(1)
		fire(pin, 'pointerup', to)
		await P.frames(1)
	}
	const raise = node('Add Height')
	const loop = node('For Each Vertex')
	const raiseId = raise?.dataset.nodeId
	const loopId = loop?.dataset.nodeId
	const vertexIn = win.querySelector(`[data-node="${raiseId}"][data-side="in"][data-pin="vertex"]`)
	const vertexOut = win.querySelector(`[data-node="${loopId}"][data-side="out"][data-pin="vertex"]`)
	if (!vertexIn || !vertexOut) throw new Error('the vertex pins are missing')

	// Picked up and let go in the open: unlinked, and Run stops at Add Height.
	const canvas = win.querySelector('.canvas')
	const cb = canvas.getBoundingClientRect()
	await dragPin(vertexIn, { clientX: cb.right - 30, clientY: cb.bottom - 30 })
	r.wiresUnlinked = win.querySelectorAll('path.wire').length
	if (r.wiresUnlinked !== 10) bad.push(`after unlinking, ${r.wiresUnlinked} wires show, not 10`)
	if (win.querySelector('.menu')) bad.push('letting go of a picked-up wire opened the Add Node menu')
	const pos1 = e.history.position
	r.errorOut = await runGraph()
	if (!/link its vertex/.test(r.errorOut.join('\n'))) bad.push(`the run without the link said ${JSON.stringify(r.errorOut)}`)
	if (!node('Add Height')?.classList.contains('bad')) bad.push('Add Height is not marked as the node at fault')
	if (e.history.position !== pos1) bad.push('a graph that did not compile made an undo step')

	// Dragged from For Each Vertex's vertex to Add Height's: linked again, and it runs.
	await dragPin(vertexOut, at(vertexIn))
	r.wiresRelinked = win.querySelectorAll('path.wire').length
	if (r.wiresRelinked !== 11) bad.push(`after relinking, ${r.wiresRelinked} wires show, not 11`)
	r.rerun = await runGraph()
	if (!r.rerun.some((l) => /^Ran in/.test(l))) bad.push(`the relinked graph said ${JSON.stringify(r.rerun)}`)
	e.history.undo()

	// A right-click opens the Add Node menu; a name and Enter add that node.
	canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: cb.left + 60, clientY: cb.bottom - 80 }))
	await P.frames(2)
	const find = win.querySelector('.menu input')
	if (!find) bad.push('the right-click opened no Add Node menu')
	else {
		find.value = 'noise val'
		find.dispatchEvent(new Event('input', { bubbles: true }))
		await P.frames(1)
		r.menuOffers = [...win.querySelectorAll('.menu .list button')].map((b) => b.textContent.trim())
		if (r.menuOffers.join() !== 'Noise Value') bad.push(`"noise val" offers ${JSON.stringify(r.menuOffers)}`)
		find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
		await P.frames(1)
		if (!node('Noise Value')) bad.push('Enter did not add the Noise Value node')
		if (win.querySelector('.menu')) bad.push('the menu stayed open')
	}

	// The Lua view.
	button('Lua').click()
	await P.frames(1)
	r.lua = win.querySelector('pre.lua')?.textContent ?? ''
	if (!/add_height\(/.test(r.lua) || !/select_origin\(/.test(r.lua)) bad.push(`the Lua view shows ${JSON.stringify(r.lua.slice(0, 200))}`)
	button('Lua').click()

	// Delete takes the selected node off, and stays out of the map's own Delete.
	const head = node('Noise Value')?.querySelector('.head')
	if (head) {
		fire(head, 'pointerdown', at(head))
		fire(head, 'pointerup', at(head))
		await P.frames(1)
		const models = e.objects.list().length
		canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
		await P.frames(1)
		if (node('Noise Value')) bad.push('Delete left the selected node')
		if (nodes().length !== 9) bad.push(`${nodes().length} nodes are left after the Delete, not 9`)
		if (e.objects.list().length !== models) bad.push('the Delete reached the map')

		// Ctrl+Z on the canvas undoes the graph's own edit, not the map's; Ctrl+Y does it again.
		const pos2 = e.history.position
		const key = (k) => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }))
		key('z')
		await P.frames(1)
		if (!node('Noise Value')) bad.push('Ctrl+Z on the canvas did not bring the deleted node back')
		if (e.history.position !== pos2) bad.push('Ctrl+Z on the canvas moved the map history')
		key('y')
		await P.frames(1)
		if (node('Noise Value')) bad.push('Ctrl+Y did not delete the node again')
		if (e.history.position !== pos2) bad.push('Ctrl+Y on the canvas moved the map history')
		// A node dragged is one step.
		const hd = node('Add Height')?.querySelector('.head')
		if (hd) {
			const x0 = node('Add Height').getBoundingClientRect().left
			const p0 = at(hd)
			fire(hd, 'pointerdown', p0)
			fire(hd, 'pointermove', { clientX: p0.clientX + 40, clientY: p0.clientY })
			fire(hd, 'pointermove', { clientX: p0.clientX + 80, clientY: p0.clientY })
			fire(hd, 'pointerup', { clientX: p0.clientX + 80, clientY: p0.clientY })
			await P.frames(1)
			const x1 = node('Add Height').getBoundingClientRect().left
			if (!(x1 > x0 + 40)) bad.push('the node did not move')
			key('z')
			await P.frames(1)
			if (Math.abs(node('Add Height').getBoundingClientRect().left - x0) > 1) bad.push('one Ctrl+Z did not undo the whole drag')
		}
	}
} finally {
	ui.nodeEditor = false
	await P.frames(1)
}
r.bad = bad
r.ok = !bad.length
return r
