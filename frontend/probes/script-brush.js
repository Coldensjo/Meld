// The Script Brush tool (#29): a Lua script that calls brush() loads into the tool through Engine.runScript; the options bar shows its script, size and falloff and its tags as controls; a stroke sends on_left_click, on_left_hold (with dt) and on_left_release at the brush's position with the tags' values, raising the ground under the brush with noise from sel:make_noise and placing a model on release, all one undo step named after the brush that undo and redo exactly; a handler's error stops the stroke with the script's line in the Scripts window's output and keeps the edits made before it as a step; and load_png reaches Go: a missing file comes back as the script's error, and a PNG written to the throwaway client's scratch folder reads with its pixels.
// touches: frontend/src/lib/script/prelude.ts, frontend/src/lib/script/scriptApi.ts, frontend/src/lib/script/scriptNoise.ts, frontend/src/lib/io/scriptImages.ts, internal/scripts/image.go, frontend/src/lib/engine/ScriptBrushes.ts, frontend/src/lib/tools/ScriptBrushTool.ts, frontend/src/components/ScriptBrushBar.svelte, app_scripts.go
const e = P.e
const { editor } = await P.state()
const { scriptLog } = await P.app('src/lib/script/scriptBrush.svelte.ts')
const bad = []
const r = {}
const TREE = 'World/Generic/Tree.m2'
const before = { tool: editor.tool, radius: editor.brush.radius, falloff: editor.brush.falloff }
try {
	e.newDocument(256, 'flat', 0, 'Probe script brush')
	await P.frames(1)
	const t = e.terrain
	const code = `
local b = brush("Probe Raise")
b:add_description("Raises the ground with noise")
local amount = b:add_real_tag("Amount", 0, 20, 2, 2)
local mode = b:add_string_list_tag("Mode", "raise", "flat")
local holds = 0
function b:on_left_click(evt)
	local sel = select_origin(evt:pos(), evt:outer_radius())
	for _, v in pairs(sel:verts()) do
		if dist_2d(v:get_pos(), evt:pos()) < evt:outer_radius() then v:add_height(amount:get()) end
	end
	print("click", evt:pos().x, evt:outer_radius(), mode:get())
end
function b:on_left_hold(evt)
	holds = holds + 1
	local sel = select_origin(evt:pos(), evt:outer_radius())
	local map = sel:make_noise(0.05, "SIMPLEX", "probe")
	for _, v in pairs(sel:verts()) do
		if dist_2d(v:get_pos(), evt:pos()) < evt:outer_radius() then v:add_height(evt:dt() * (1 + map:get(v:get_pos()))) end
	end
end
function b:on_left_release(evt)
	add_m2("${TREE}", evt:pos(), 1, vec(0, 90, 0))
	print("release", holds)
end
`
	const loaded = await e.runScript(code, 'probe-brush', () => {})
	r.loaded = loaded && { ok: loaded.ok, error: loaded.error, brushes: loaded.brushes }
	if (!loaded?.ok || loaded.brushes.join() !== 'Probe Raise') bad.push(`the brush script loaded as ${JSON.stringify(r.loaded)}`)
	editor.tool = 'script'
	editor.brush.radius = 10
	editor.brush.falloff = 0.4
	await P.frames(2)
	const bar = document.querySelector('.options')
	const labels = [...(bar?.querySelectorAll('label') ?? [])].map((l) => l.textContent.trim().split(/\s/)[0])
	r.labels = labels
	if (!bar?.querySelector('select[aria-label="Brush script"]')) bad.push('the options bar has no brush script picker')
	if (!labels.includes('Amount') || !labels.includes('Mode')) bad.push(`the options bar shows ${JSON.stringify(labels)}, not the brush's tags`)
	if (!bar?.textContent.includes('Raises the ground with noise')) bad.push("the brush's description is not shown")
	e.scriptBrushes.setTag(0, 1, 5)
	e.scriptBrushes.setTag(0, 2, 'flat')

	const h0 = t.heights.slice()
	const n0 = e.objects.list().length
	const pos0 = e.history.position
	scriptLog.lines = []
	const stroke = await P.stroke('script', { x: 100, z: 100 }, { x: 140, z: 100 }, 12, 0.05)
	await e.scriptBrushes.settled()
	await P.frames(1)
	r.stroke = stroke
	r.out = scriptLog.lines.map((l) => l.text)
	if (!/^click\t100(\.0)?\t10(\.0)?\tflat$/.test(r.out[0] ?? '')) bad.push(`the click printed ${JSON.stringify(r.out[0])}`)
	const holds = Number((r.out.find((l) => l.startsWith('release')) ?? '').split('\t')[1])
	r.holds = holds
	if (!(holds >= 6 && holds <= 12)) bad.push(`${holds} hold events ran in a 12-frame stroke`)
	const start = t.heightAt(100, 100) - h0[(100 / t.cellSize) * t.verts + 100 / t.cellSize]
	const mid = t.heightAt(120, 100)
	r.start = +start.toFixed(2)
	r.mid = +mid.toFixed(2)
	// The click raised 5 yd at the start; the holds add up to about dt × (1 ± 1) a frame along the line.
	if (!(start > 5 && start < 8)) bad.push(`the stroke's start rose ${start.toFixed(2)} yd, not 5 and a little`)
	if (!(mid > 0 && mid < 3)) bad.push(`the middle of the stroke rose ${mid.toFixed(2)} yd`)
	if (t.heightAt(100, 140) !== 0) bad.push('the ground 40 yd off the stroke moved')
	const added = e.objects.list().slice(n0)
	r.added = added.map((o) => ({ type: o.type, x: +o.x.toFixed(1), z: +o.z.toFixed(1) }))
	if (added.length !== 1 || added[0].type !== 'm2:World\\Generic\\Tree.m2' || Math.abs(added[0].x - 140) > 0.01) bad.push(`the release placed ${JSON.stringify(r.added)}`)
	if (e.history.position !== pos0 + 1) bad.push(`the stroke made ${e.history.position - pos0} undo steps`)
	r.label = e.history.peek()?.label
	if (r.label !== 'Script brush Probe Raise') bad.push(`the step is named ${r.label}`)
	const h1 = t.heights.slice()
	e.history.undo()
	await P.frames(1)
	let undone = 0
	for (let i = 0; i < h0.length; i++) if (t.heights[i] !== h0[i]) undone++
	if (undone || e.objects.list().length !== n0) bad.push(`after the undo ${undone} heights differ and ${e.objects.list().length - n0} models are left`)
	e.history.redo()
	await P.frames(1)
	let redone = 0
	for (let i = 0; i < h1.length; i++) if (t.heights[i] !== h1[i]) redone++
	if (redone || e.objects.list().length !== n0 + 1) bad.push(`after the redo ${redone} heights differ and ${e.objects.list().length - n0} models are back`)

	// A handler's error ends the stroke at the script's line; what it did before is still a step.
	const broken = await e.runScript(
		'local b = brush("Broken")\nfunction b:on_left_click(evt) local s = select_origin(evt:pos(), 4) for _, v in pairs(s:verts()) do v:add_height(1) end end\nfunction b:on_left_hold(evt)\n\tlocal x = nil\n\tx.y = 1\nend',
		'broken-brush',
		() => {},
	)
	if (!broken?.ok) bad.push(`the broken brush did not load: ${broken?.error}`)
	scriptLog.lines = []
	const pos1 = e.history.position
	await P.stroke('script', { x: 60, z: 60 }, { x: 60, z: 70 }, 4, 0.05)
	await e.scriptBrushes.settled()
	await P.frames(1)
	r.brokenOut = scriptLog.lines.map((l) => l.text)
	if (!scriptLog.lines.some((l) => l.kind === 'err' && /^broken-brush:5:/.test(l.text))) bad.push(`the error reads ${JSON.stringify(r.brokenOut)}`)
	if (scriptLog.lines.filter((l) => l.kind === 'err').length !== 1) bad.push('the stroke went on after the error')
	if (e.history.position !== pos1 + 1 || Math.abs(t.heightAt(60, 60) - 1) > 1e-6) bad.push("the click's edit before the error is not a step")

	// load_png goes through the app's binding, which says what was wrong with the file.
	const png = await e.runScript('load_png("probe-missing-image.png")', 'png', () => {})
	r.png = png?.error
	if (png?.ok !== false || !/^png:1: load_png: /.test(png.error ?? '') || !/probe-missing-image\.png/.test(png.error ?? '')) bad.push(`load_png of a missing file came back ${JSON.stringify(png)}`)
	// And a real PNG, written to the throwaway client's scratch folder and read by its whole path.
	const c = document.createElement('canvas')
	c.width = 3
	c.height = 2
	const g = c.getContext('2d')
	g.fillStyle = 'rgb(200, 100, 50)'
	g.fillRect(2, 1, 1, 1)
	const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
	await P.sandboxClient()
	const file = await P.sandboxFile('probe-brush.png', blob)
	const read = []
	const img = await e.runScript(`local img = load_png([[${file}]])\nprint(img:width(), img:height(), round(img:get_red(2, 1) * 255), round(img:get_blue(2, 1) * 255), img:get_alpha(0, 0))`, 'png2', (s) => read.push(s))
	r.pngRead = img?.error ?? read[0]
	if (!img?.ok || !/^3\t2\t200\t50\t0(\.0)?$/.test(read[0] ?? '')) bad.push(`load_png read ${JSON.stringify(r.pngRead)}`)
} finally {
	e.scriptBrushes.unload()
	editor.tool = before.tool
	editor.brush.radius = before.radius
	editor.brush.falloff = before.falloff
	await P.frames(1)
}
r.bad = bad
r.ok = !bad.length
return r
