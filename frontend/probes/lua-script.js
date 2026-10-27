// Tools › Scripts (#28): a Lua script run on a flat map raises a hill with Noggit Red's verts API, places, moves, turns and removes models (an m2 rotation of 90° in Noggit's degrees is the editor's turn of 0), prints to the output, and the whole run is one undo step that undo and redo exactly; a script with a runtime error reports its own line and keeps the edits it made before it as an undo step; an endless loop is stopped; and the Scripts window opens with its starter script and runs it on the Run button, lifting the ground where the camera looks. The loop check waits out the whole 10 s limit.
// touches: frontend/src/lib/script/prelude.ts, frontend/src/lib/script/scriptApi.ts, frontend/src/lib/script/luaRun.ts, frontend/src/lib/engine/ScriptRun.ts, frontend/src/components/ScriptWindow.svelte
const e = P.e
const { ui } = await P.state()
const bad = []
const r = {}
const TREE = 'World/Generic/Tree.m2'
try {
	e.newDocument(256, 'flat', 0, 'Probe Lua')
	await P.frames(1)
	const t = e.terrain
	const h0 = t.heights.slice()
	const n0 = e.objects.list().length
	const pos0 = e.history.position
	const printed = []
	const code = `
local c = vec(100, 0, 100)
local sel = select_origin(c, 20)
local n = 0
for _, v in pairs(sel:verts()) do
	local d = dist_2d(v:get_pos(), c)
	if d < 20 then v:add_height(20 - d) n = n + 1 end
end
sel:apply()
print("raised", n)
local top = add_m2("${TREE}", vec(100, 20, 100), 1.5, vec(0, 90, 0))
local other = add_m2("${TREE}", vec(110, 0, 110), 1, vec(0, 180, 0))
other:set_pos(vec(112, 30, 112))
local gone = add_m2("${TREE}", vec(60, 0, 60), 1, vec(0, 0, 0))
gone:remove()
print(#select_origin(c, 30):models(), top:get_rot().y, top:get_filename())
`
	const res = await e.runScript(code, 'probe', (s) => printed.push(s))
	await P.frames(1)
	r.res = res && { ok: res.ok, error: res.error, ms: Math.round(res.ms) }
	r.printed = printed
	if (!res?.ok) bad.push(`the script failed: ${res?.error}`)
	if (!/^2\t90(\.0)?\tworld\/generic\/tree\.m2$/.test(printed[1] ?? '')) bad.push(`it printed ${JSON.stringify(printed)}`)
	const peak = t.heightAt(100, 100)
	r.peak = +peak.toFixed(2)
	if (Math.abs(peak - h0[(100 / t.cellSize) * t.verts + 100 / t.cellSize] - 20) > 0.01) bad.push(`the hill's top is ${peak}, not 20 up`)
	const added = e.objects.list().slice(n0)
	r.added = added.map((o) => ({ type: o.type, x: +o.x.toFixed(2), z: +o.z.toFixed(2), yOff: +o.yOff.toFixed(2), rotY: +o.rotY.toFixed(3), scale: o.scale }))
	if (added.length !== 2) bad.push(`${added.length} models were left, not 2`)
	if (added[0] && (added[0].type !== 'm2:World\\Generic\\Tree.m2' || Math.abs(added[0].rotY) > 1e-6 || added[0].scale !== 1.5)) bad.push('the first tree has the wrong type, turn or scale')
	if (added[1] && (added[1].x !== 112 || Math.abs(added[1].yOff - (30 - t.heightAt(112, 112))) > 0.01)) bad.push('the moved tree is not where set_pos put it')
	if (e.history.position !== pos0 + 1) bad.push(`the run made ${e.history.position - pos0} undo steps`)
	r.label = e.history.peek()?.label
	const h1 = t.heights.slice()
	e.history.undo()
	await P.frames(1)
	let undone = 0
	for (let i = 0; i < h0.length; i++) if (t.heights[i] !== h0[i]) undone++
	if (undone) bad.push(`${undone} heights differ after the undo`)
	if (e.objects.list().length !== n0) bad.push(`${e.objects.list().length - n0} models are left after the undo`)
	e.history.redo()
	await P.frames(1)
	let redone = 0
	for (let i = 0; i < h1.length; i++) if (t.heights[i] !== h1[i]) redone++
	if (redone) bad.push(`${redone} heights differ after the redo`)
	if (e.objects.list().length !== n0 + 2) bad.push('the redo did not bring the two models back')

	// A runtime error names the script's line, and what ran before it is still one undo step.
	const pos1 = e.history.position
	const err = await e.runScript('add_m2("' + TREE + '", vec(30, 0, 30))\nlocal x = nil\nx.y = 1', 'broken', () => {})
	r.error = err?.error
	if (err?.ok !== false || !/^broken:3:/.test(err.error ?? '')) bad.push(`the error reads ${JSON.stringify(err?.error)}`)
	if (e.history.position !== pos1 + 1) bad.push('the edits before the error are not an undo step')

	// An endless loop is stopped by the time limit (10 s), and leaves no step.
	const t0 = performance.now()
	const loop = await e.runScript('while true do end', 'loop', () => {})
	r.loopMs = Math.round(performance.now() - t0)
	if (loop?.ok !== false || !/stopped after/.test(loop.error ?? '')) bad.push(`the loop came back ${JSON.stringify(loop)}`)

	// The window: its starter script raises a hill where the camera looks.
	await P.lookAt({ x: 128, y: t.heightAt(128, 128), z: 128 }, { pitch: 0.9, back: 80 })
	await P.frames(1)
	const target = e.controller.target.clone()
	const before = t.heightAt(target.x, target.z)
	ui.scripts = true
	await P.frames(2)
	const win = document.querySelector('aside.scripts')
	if (!win) bad.push('the Scripts window did not open')
	const run = [...(win?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Run')
	run?.click()
	for (let i = 0; i < 100 && !win?.querySelector('.output .info, .output .err'); i++) await P.frames(1)
	r.windowOut = [...(win?.querySelectorAll('.output div') ?? [])].map((d) => d.textContent)
	const lift = t.heightAt(target.x, target.z) - before
	r.windowLift = +lift.toFixed(2)
	// 10 yd at the hill's middle; the target sits between vertices, so a little less there.
	if (!(lift > 8 && lift < 10.01)) bad.push(`the starter script lifted the target ${lift.toFixed(2)} yd, not about 10`)
} finally {
	ui.scripts = false
	await P.frames(1)
}
r.bad = bad
r.ok = !bad.length
return r
