// The Node Editor's procedures (#1091): with ListGraphs answered by a stand-in that holds two graphs, a callee "probe-raise" (Procedure Inputs area and amount, a For Each Vertex lifting the area by the amount, a Procedure Output "lifted") and a caller "probe-caller" (a Procedure node set to probe-raise, fed a selection around the camera target and 4, its output printed), opening the caller shows the Procedure node with the callee's inputs and output as pins and its wires drawn, the graph picker lists both graphs, and Run lifts the target 4 yd as one undo step and prints 4.
// touches: frontend/src/components/NodeEditorWindow.svelte, frontend/src/lib/script/nodeGraph.ts
const e = P.e
const { ui } = await P.state()
const { answerConfirm } = await P.app('/src/lib/state/confirm.ts')
const { addNode, connect, graphLibrary, serializeGraph } = await import('/src/lib/script/nodeGraph.ts')
const App = window.go.main.App
const realList = App.ListGraphs
const bad = []
const r = {}

function build() {
	const g = { nodes: [], links: [] }
	const at = (type, x, y, values = {}) => {
		const n = addNode(g, type, x, y)
		n.values = values
		return n.id
	}
	return { g, at }
}
const link = (g, from, out, to, inp, lib) => {
	const err = connect(g, from, out, to, inp, lib)
	if (err) bad.push(`link ${from}.${out} to ${to}.${inp}: ${err}`)
}

// The callee.
const callee = build()
{
	const { g, at } = callee
	const begin = at('begin', 0, 0)
	const area = at('procInput', 0, 120, { name: 'area', type: 'sel' })
	const amount = at('procInput', 0, 240, { name: 'amount', type: 'number', def: 1 })
	const loop = at('forEachVertex', 230, 0)
	const add = at('addHeight', 460, 0)
	const out = at('procOutput', 460, 160, { name: 'lifted' })
	link(g, begin, 'next', loop, 'in')
	link(g, area, 'value', loop, 'sel')
	link(g, loop, 'body', add, 'in')
	link(g, loop, 'vertex', add, 'vertex')
	link(g, amount, 'value', add, 'amount')
	link(g, loop, 'next', out, 'in')
	link(g, amount, 'value', out, 'value')
}
const calleeFile = { name: 'probe-raise.mgraph', text: serializeGraph(callee.g) }
const lib = graphLibrary([calleeFile])

// The caller.
const caller = build()
{
	const { g, at } = caller
	const begin = at('begin', 0, 0)
	const target = at('targetPos', 0, 120)
	const sel = at('selectAround', 0, 200, { radius: 6 })
	const call = at('procedure', 240, 0, { graph: 'probe-raise', in_amount: 4 })
	const say = at('print', 520, 0)
	link(g, begin, 'next', call, 'in', lib)
	link(g, target, 'position', sel, 'center', lib)
	link(g, sel, 'sel', call, 'in_area', lib)
	link(g, call, 'next', say, 'in', lib)
	link(g, call, 'out_lifted', say, 'value', lib)
}
const files = [calleeFile, { name: 'probe-caller.mgraph', text: serializeGraph(caller.g) }]

try {
	App.ListGraphs = async () => files
	e.newDocument(256, 'flat', 0, 'Probe Procedures')
	await P.frames(1)
	const t = e.terrain
	await P.lookAt({ x: 128, y: t.heightAt(128, 128), z: 128 }, { pitch: 0.9, back: 80 })
	await P.frames(1)
	const target = e.controller.target.clone()
	// Reopened, so it reads the stand-in's list.
	ui.nodeEditor = false
	await P.frames(1)
	ui.nodeEditor = true
	await P.frames(2)
	const win = document.querySelector('aside.nodes')
	if (!win) throw new Error('the Node Editor did not open')
	await P.until(() => [...win.querySelectorAll('nav li button')].find((b) => b.textContent.trim() === 'probe-caller') || null, 5000, 'the caller in the graph list')
	;[...win.querySelectorAll('nav li button')].find((b) => b.textContent.trim() === 'probe-caller').click()
	await P.frames(2)
	// An unsaved graph left by an earlier probe asks first.
	if (ui.confirm) {
		answerConfirm(true)
		await P.frames(2)
	}
	const node = (title) => [...win.querySelectorAll('.node')].find((n) => n.querySelector('.head')?.textContent.trim().endsWith(title))
	const proc = node('Procedure')
	if (!proc) throw new Error('the caller shows no Procedure node')
	const pins = (side) => [...proc.querySelectorAll(`[data-side="${side}"]`)].map((p) => p.dataset.pin)
	r.inPins = pins('in')
	r.outPins = pins('out')
	if (r.inPins.join() !== 'in,in_area,in_amount') bad.push(`the Procedure's inputs are ${JSON.stringify(r.inPins)}, not in, in_area, in_amount`)
	if (r.outPins.join() !== 'next,out_lifted') bad.push(`its outputs are ${JSON.stringify(r.outPins)}, not next, out_lifted`)
	r.options = [...proc.querySelectorAll('select option')].map((o) => o.value)
	if (r.options.join() !== 'probe-raise,probe-caller') bad.push(`the graph picker offers ${JSON.stringify(r.options)}`)
	r.wires = win.querySelectorAll('path.wire').length
	if (r.wires !== 5) bad.push(`the caller shows ${r.wires} wires, not 5`)

	const pos0 = e.history.position
	const before = t.heightAt(target.x, target.z)
	;[...win.querySelectorAll('.bar button')].find((b) => b.textContent.trim() === 'Run').click()
	await P.frames(1)
	for (let i = 0; i < 200 && !win.querySelector('.output .info, .output .err'); i++) await P.frames(1)
	r.out = [...win.querySelectorAll('.output div')].map((d) => d.textContent)
	const lift = t.heightAt(target.x, target.z) - before
	r.lift = +lift.toFixed(2)
	if (Math.abs(lift - 4) > 0.01) bad.push(`the procedure lifted the target ${lift.toFixed(2)} yd, not 4 (output ${JSON.stringify(r.out)})`)
	if (r.out[0] !== '4') bad.push(`the caller printed ${JSON.stringify(r.out)}, not 4 first`)
	if (e.history.position !== pos0 + 1) bad.push(`the run made ${e.history.position - pos0} undo steps`)
	if (e.history.position > pos0) e.history.undo()
} finally {
	App.ListGraphs = realList
	ui.nodeEditor = false
}
r.bad = bad
r.ok = !bad.length
return r
