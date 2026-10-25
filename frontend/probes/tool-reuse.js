// The tools' hover and tick paths reuse what they built (#452): the Doodad and Spawn brushes keep their plan while nothing it depends on changes and draw a new one when the radius or brush does, a pasted clip's ghosts keep their landings while the anchor stays put, a Place scatter stroke keeps its props spaced, and the Water tool and Clear › Liquids paint and clear water with their reused brush (each undone).
// touches: frontend/src/lib/tools/DoodadBrushTool.ts, frontend/src/lib/tools/SpawnBrushTool.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/tools/ClearTool.ts, frontend/src/lib/water/liquidStroke.ts
const e = P.e
const { editor, prefs } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const ctx = e.ctx
const V3 = e.controller.target.constructor
const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
const out = {}
const bad = []

// Doodad brush: the same inputs keep the plan, a new radius or a new entry draws another.
editor.tool = 'doodad'
editor.doodadMode = 'models'
await P.frames(1)
editor.brush.radius = 20
editor.brush.strength = 0.5
prefs.doodadBrushes = [{ name: 'Probe', spacing: 1, entries: [{ type: 'helper:cube:1', weight: 1, scaleMin: 1, scaleMax: 1, sink: 0, tilt: 0, align: 0 }] }]
prefs.doodadBrush = 'Probe'
const doodad = e.tools.doodad
const brush = prefs.doodadBrushes[0]
doodad.ensurePlan(brush)
const plan0 = doodad.plan
for (let i = 0; i < 5; i++) doodad.ensurePlan(brush)
if (doodad.plan !== plan0) bad.push('doodad plan redrawn with the same inputs')
editor.brush.radius = 30
doodad.ensurePlan(brush)
if (doodad.plan === plan0) bad.push('doodad plan kept after the radius changed')
const plan1 = doodad.plan
prefs.doodadBrushes[0].entries.push({ type: 'helper:cube:4', weight: 1, scaleMin: 1, scaleMax: 1, sink: 0, tilt: 0, align: 0 })
doodad.ensurePlan(prefs.doodadBrushes[0])
if (doodad.plan === plan1) bad.push('doodad plan kept after an entry was added')
out.doodadPlan = doodad.plan.length

// Spawn brush: the same spot keeps the plan, a move of a quarter radius draws another.
const spawn = doodad.spawns
if (spawn) {
	prefs.spawnBrush = { ...prefs.spawnBrush, entries: [{ entry: 6, weight: 1 }] }
	spawn.ensurePlan(ctx, at(100, 100))
	const s0 = spawn.plan
	spawn.ensurePlan(ctx, at(100.5, 100))
	if (spawn.plan !== s0) bad.push('spawn plan redrawn for a small move')
	spawn.ensurePlan(ctx, at(140, 100))
	if (spawn.plan === s0) bad.push('spawn plan kept after a long move')
	out.spawnPlan = spawn.plan.length
} else bad.push('no spawn brush')

// A pasted clip's ghosts: the landings stay while the anchor stays, and are worked out again when it moves.
const sel = e.tools.select
const clip = { objects: [{ cid: 1, type: 'helper:cube:1', x: 0, z: 0, yOff: 0, rotY: 0, tiltX: 0, tiltZ: 0, scale: 1 }] }
sel.pasteOnModel = true
sel.updateGhosts(ctx, clip, at(50, 50))
const l0 = sel.landings
sel.updateGhosts(ctx, clip, at(50.001, 50))
if (sel.landings !== l0) bad.push('paste landings worked out again for the same anchor')
sel.updateGhosts(ctx, clip, at(60, 50))
if (sel.landings === l0) bad.push('paste landings kept after the anchor moved')
sel.updateGhosts(ctx, null, null)
sel.pasteOnModel = false

// Place scatter: the stroke's props stay spaced.
editor.tool = 'place'
await P.frames(1)
editor.prefab = 'helper:cube:1'
editor.placeScatter = true
editor.brush.radius = 10
editor.brush.strength = 1
const place = e.tools.place
const before = e.objects.objects.size
place.onDown(ctx, at(128, 128), { clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, altKey: false, button: 0 })
for (let i = 0; i < 60; i++) place.tick(ctx, 0.1, at(128 + i * 0.2, 128))
const scattered = [...place.scattering]
place.onUp(ctx)
editor.placeScatter = false
let closest = Infinity
for (let i = 0; i < scattered.length; i++) {
	for (let j = i + 1; j < scattered.length; j++) closest = Math.min(closest, Math.hypot(scattered[i].x - scattered[j].x, scattered[i].z - scattered[j].z))
}
out.scattered = scattered.length
out.scatterClosest = +closest.toFixed(2)
if (scattered.length < 3) bad.push('scatter placed too few props')
if (closest < 0.8) bad.push('scattered props closer than the spacing')
e.history.undo()
if (e.objects.objects.size !== before) bad.push('scatter not undone')

// Water paint, then Clear › Liquids over it.
const wet = () => {
	let n = 0
	for (let c = 0; c < ctx.liquids.side * ctx.liquids.side; c++) if (ctx.liquids.layers(c).length) n++
	return n
}
editor.tool = 'water'
editor.waterMode = 'paint'
await P.frames(1)
editor.brush.radius = 20
const water = e.tools.water
water.onDown(ctx, at(128, 128), { ctrlKey: false })
for (let i = 0; i < 10; i++) water.tick(ctx, 0.05, at(128 + i, 128))
water.onUp(ctx)
out.wetChunks = wet()
if (!out.wetChunks) bad.push('water paint left no liquid')
editor.tool = 'clear'
editor.clearMode = 'liquids'
await P.frames(1)
const clear = e.tools.clear
clear.onDown(ctx, at(128, 128))
for (let i = 0; i < 10; i++) clear.tick(ctx, 0.05, at(128 + i, 128))
clear.onUp(ctx)
out.wetAfterClear = wet()
if (out.wetAfterClear >= out.wetChunks) bad.push('Clear › Liquids removed nothing')
e.history.undo()
e.history.undo()
await P.frames(1)
if (wet() !== 0) bad.push('water not undone')

return { ok: bad.length === 0, bad, ...out }
