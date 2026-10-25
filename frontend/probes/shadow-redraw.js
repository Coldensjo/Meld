// The sun's near shadow map is kept between frames and redrawn only when something it shows changed (#326):
// a still view redraws neither cascade; moving an object, sculpting, cutting holes, undo, a layer toggle and
// a turn of the camera each redraw the near one. The far one holds through a small turn and a sun moved
// under 0.1°, and is redrawn after a long pan or a larger sun move (#324). Counts the frames whose
// markShadows asked for a redraw.
// touches: frontend/src/lib/engine/shadowCascades.ts, frontend/src/lib/engine/Environment.ts, frontend/src/lib/world/shadowCasters.ts
// tier: smoke
const e = P.e
const { editor, prefs } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)
if (!e.env.key.castShadow) return { ok: false, error: 'the sun casts no shadows (Graphics › Shadows is off)' }
const near = e.env.key.shadow
const far = e.env.far.shadow
let nears = 0
let fars = 0
const mark = e.markShadows.bind(e)
e.markShadows = () => {
	mark()
	if (near.needsUpdate) nears++
	if (far.needsUpdate) fars++
}
const count = async (fn) => {
	await P.frames(2)
	nears = fars = 0
	await fn()
	await P.frames(3)
	return { near: nears, far: fars }
}
const focus = e.env.key.target.position
const cube = e.objects.add({ type: 'helper:cube:4', x: focus.x, z: focus.z, yOff: 0, rotY: 0, scale: 1 })
// A new map's spawns and preferences arrive a few frames late, and each redraws the maps once.
await P.settle()
await P.frames(10)
const r = {}
try {
	r.still = await count(() => {})
	r.moved = await count(() => {
		cube.x += 2
		e.objects.touch(cube.id)
	})
	r.sculpted = await count(async () => {
		editor.tool = 'sculpt'
		await P.frames(1)
		editor.sculptMode = 'raise'
		const V3 = e.controller.target.constructor
		const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
		const tool = e.tools.sculpt
		tool.onDown(e.ctx, at(focus.x + 10, focus.z))
		for (let i = 0; i < 5; i++) tool.tick(e.ctx, 0.05, at(focus.x + 10 + i, focus.z))
		tool.onUp(e.ctx)
	})
	r.holes = await count(() => {
		editor.selection = { x0: 9, z0: 9, x1: 14, z1: 14 }
		e.setHoleInSelection(true)
	})
	r.undone = await count(() => e.history.undo())
	r.layer = await count(() => {
		prefs.showObjects = false
	})
	prefs.showObjects = true
	await P.frames(2)
	r.turned = await count(() => {
		e.controller.yaw += 0.05
	})
	// #324: the far fit is held while the view turns a little, and refit once it has moved a good
	// share of the far box's half-size; the sun's direction is held within 0.1°.
	r.panned = await count(() => {
		e.controller.target.x += e.env.far.shadow.camera.right * 0.5
	})
	r.sunNudged = await count(() => {
		e.hour += 0.001
	})
	r.sunMoved = await count(() => {
		e.hour += 0.05
	})
	r.stillAgain = await count(() => {})
} finally {
	prefs.showObjects = true
	e.markShadows = mark
}
const redrawn = ['moved', 'sculpted', 'holes', 'undone', 'layer', 'turned'].every((k) => r[k].near > 0)
const held = r.turned.far === 0 && r.panned.far > 0 && r.sunNudged.near === 0 && r.sunNudged.far === 0 && r.sunMoved.near > 0 && r.sunMoved.far > 0
return { ok: r.still.near === 0 && r.still.far === 0 && r.stillAgain.near === 0 && redrawn && r.layer.far > 0 && held, ...r }
