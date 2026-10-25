// Dragging a lit model (#511): on the lights benchmark map, a brazier near the camera moved a frame at a time, then a sculpt stroke under the braziers.
// The lights, flames and particle pools follow the moved objects without a full rebuild (PropEffects.rebuild and ParticleLayer.rebuild
// not called), no shadowed light goes dark for a frame, and what they hold after it matches a full rebuild. Prints the ms a frame of
// PropEffects.update, ParticleLayer.update and WmoRooms.update during each, for before/after. With View › Bounding boxes on, the
// drag rewrites the moved box in place and the lines match a full rebuild. Each shadowed light's cube map is redrawn in turn during
// both (#629), not light 0's every frame: `redraws` counts the frames each light's shadow.needsUpdate was set.
// touches: frontend/src/lib/world/PropEffects.ts, frontend/src/lib/world/ParticleLayer.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/tools/TerrainTools.ts
const { buildBenchMap, benchView, benchMap } = await P.app('/src/lib/bench/benchMaps.ts')
const { getAsset } = await P.app('/src/lib/models/assets.ts')
const { prefs, editor } = await P.state()
prefs.dayCycle = false
prefs.timeOfDay = benchMap('lights').hour
await buildBenchMap(P.e, 'lights', undefined, 1, 1)
benchView(P.e, 'lights')
await P.frames(2)
await P.settle()
await P.frames(3)
const e = P.e
const L = e.objects
const fx = e.effects
const parts = e.particles
const V3 = e.controller.target.constructor
const M4 = e.camera.matrixWorld.constructor
const at = new V3()
// The lit object nearest the light pool's focus, which holds a shadowed light.
const focus = e.controller.target
let o = null
let best = Infinity
for (const q of L.objects.values()) {
	const a = getAsset(q.type)
	if (!a.effects.some((x) => !x.interior) || L.isHidden(q.id)) continue
	const d = L.worldPosition(q, at).distanceToSquared(focus)
	if (d < best) [o, best] = [q, d]
}
if (!o) return { ok: false, why: 'no lit object' }
const count = () => fx.count
/** The shadowed lights holding a source but dark this frame, waiting for their first map. */
const dark = () => fx.lights.slice(0, 3).filter((l, i) => l.castShadow && fx.slots[i] >= 0 && l.intensity === 0).length
const snapSources = () => {
	const out = []
	for (let i = 0; i < count(); i++) {
		const s = fx.sources[i]
		out.push([s.pos.x, s.pos.y, s.pos.z, s.color.r, s.color.g, s.color.b, s.radius, s.fire ? 1 : 0, s.intensity])
	}
	const f = fx.flames
	return { out, flames: f.count, flameRows: Array.from(f.instanceMatrix.array.slice(0, f.count * 16)) }
}
const diff = (a, b) => {
	if (a.out.length !== b.out.length || a.flames !== b.flames) return Infinity
	let err = 0
	for (let i = 0; i < a.out.length; i++) for (let j = 0; j < a.out[i].length; j++) err = Math.max(err, Math.abs(a.out[i][j] - b.out[i][j]))
	for (let i = 0; i < a.flameRows.length; i++) err = Math.max(err, Math.abs(a.flameRows[i] - b.flameRows[i]))
	return err
}
/** The largest gap between a placed object's particle pools and its matrix now. */
const M = new M4()
const poolErr = () => {
	let err = 0
	let n = 0
	for (const l of parts.list) {
		const id = Number(l.key.split(':')[0])
		const q = L.objects.get(id)
		if (!q || l.follow) continue
		L.matrixOf(q, M)
		for (let j = 0; j < 16; j++) err = Math.max(err, Math.abs(l.inst.elements[j] - M.elements[j]))
		n++
	}
	return { err, pools: n }
}
const t = await P.time({
	'/src/lib/world/PropEffects.ts:PropEffects': ['update', 'rebuild'],
	'/src/lib/world/ParticleLayer.ts:ParticleLayer': ['update', 'rebuild'],
	'/src/lib/world/WmoRooms.ts:WmoRooms': ['update'],
})
const per = (s, n) => {
	const r = {}
	for (const [k, v] of Object.entries(s)) if (k !== 'total') r[k] = { msFrame: Math.round((v.ms / n) * 1000) / 1000, calls: v.calls }
	return r
}
const out = { object: o.type.split(/[\\/]/).pop(), sources: count(), pools: parts.list.length }
// The frames each shadowed light's map was asked to redraw, counted around PropEffects.update.
const redraws = [0, 0, 0]
const update = fx.update
fx.update = function (...a) {
	const was = this.lights.slice(0, 3).map((l) => l.shadow.needsUpdate)
	const r = update.apply(this, a)
	for (let i = 0; i < 3; i++) if (!was[i] && this.lights[i].shadow.needsUpdate) redraws[i]++
	return r
}
/** The lights holding a shadowed source, whose maps should share the redraws. */
const shadowed = () => [0, 1, 2].filter((i) => fx.lights[i].castShadow && fx.slots[i] >= 0)
/** Every shadowed light got about its share of `frames` redraws. */
const turns = (r, lit, frames) => lit.length > 0 && lit.every((i) => r[i] >= Math.floor(frames / lit.length) - 1)
const N = 20
try {
	// A drag, as the Select tool does it: the fields written and the object touched, a frame each move.
	const x0 = o.x
	let darkFrames = 0
	const boxesWere = prefs.showBoxes
	prefs.showBoxes = true
	await P.frames(2)
	const boxGeo = () => e.boxes.lines.geometry
	const geo0 = boxGeo()
	t.reset()
	redraws.fill(0)
	for (let i = 1; i <= N; i++) {
		o.x = x0 + i * 0.25
		o.rotY = i * 0.05
		L.touch(o.id)
		await P.frames(1)
		if (dark()) darkFrames++
	}
	out.drag = { ...per(t.snap(), N), darkFrames, redraws: [...redraws], shadowed: shadowed() }
	// The boxes: written in place (the same geometry), and as a full rebuild makes them.
	const boxes = Float32Array.from(boxGeo().getAttribute('position').array)
	out.drag.boxesInPlace = boxGeo() === geo0
	e.boxes.layer = null
	await P.frames(1)
	const rebuilt = boxGeo().getAttribute('position').array
	let boxErr = boxes.length === rebuilt.length ? 0 : Infinity
	for (let i = 0; i < boxes.length && boxErr < Infinity; i++) boxErr = Math.max(boxErr, Math.abs(boxes[i] - rebuilt[i]))
	out.drag.boxErr = boxErr
	prefs.showBoxes = boxesWere
	const dragged = snapSources()
	out.drag.pool = poolErr()
	// A full rebuild must give the same sources and flames.
	fx.layer = null
	await P.frames(1)
	out.drag.vsRebuild = diff(dragged, snapSources())
	await P.frames(2)

	// A sculpt stroke re-snaps the braziers under it.
	editor.tool = 'sculpt'
	await P.frames(1)
	editor.sculptMode = 'raise'
	editor.brush.radius = 25
	editor.brush.strength = 1
	t.reset()
	let sculptDark = 0
	redraws.fill(0)
	// Around the dragged object: nothing stands within 60 yd of the camera's own spot.
	const c = L.worldPosition(o, new V3())
	const n = 20
	const f0 = { x: c.x - 30, z: c.z }
	const f1 = { x: c.x + 30, z: c.z }
	const tool = e.tools.sculpt
	tool.onDown(e.ctx, new V3(f0.x, e.terrain.heightAt(f0.x, f0.z), f0.z))
	for (let i = 1; i <= n; i++) {
		const x = f0.x + ((f1.x - f0.x) * i) / n
		tool.tick(e.ctx, 0.05, new V3(x, e.terrain.heightAt(x, c.z), c.z))
		await P.frames(1)
		if (dark()) sculptDark++
	}
	tool.onUp(e.ctx)
	await P.frames(1)
	out.sculpt = { ...per(t.snap(), n + 1), darkFrames: sculptDark, redraws: [...redraws], shadowed: shadowed(), frames: n + 1 }
	const sculpted = snapSources()
	out.sculpt.pool = poolErr()
	fx.layer = null
	await P.frames(1)
	out.sculpt.vsRebuild = diff(sculpted, snapSources())
	e.history.undo()
	await P.frames(1)
	editor.tool = 'select'
} finally {
	delete fx.update
	t.restore()
}
const close = (v) => v < 1e-3
const ok =
	out.drag['PropEffects.rebuild'].calls === 0 &&
	out.drag['ParticleLayer.rebuild'].calls === 0 &&
	out.drag.boxesInPlace &&
	close(out.drag.boxErr) &&
	out.drag.darkFrames === 0 &&
	turns(out.drag.redraws, out.drag.shadowed, N) &&
	turns(out.sculpt.redraws, out.sculpt.shadowed, out.sculpt.frames) &&
	close(out.drag.vsRebuild) &&
	close(out.drag.pool.err) &&
	out.sculpt['PropEffects.rebuild'].calls === 0 &&
	close(out.sculpt.vsRebuild) &&
	close(out.sculpt.pool.err)
return { ok, ...out }
