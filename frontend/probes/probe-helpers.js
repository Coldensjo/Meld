// P.time, P.stroke and P.turn (#348): the timer counts a scripted Sculpt stroke's ticks, nests once, and restores; the turn changes the yaw every frame. And P.texture (#317): a client texture as a picture for P.save and P.diff; the alpha view differs from the colour view.
// touches: frontend/probes/lib.js, internal/wow/blp.go
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'sculpt'
await P.frames(1)
editor.sculptMode = 'raise'
editor.brush.radius = 14
editor.brush.strength = 1
const tool = e.debug.tools.sculpt
const Cls = tool.constructor
const orig = Cls.prototype.tick
const t = await P.time([
	[Cls, 'tick'],
	[Cls, 'onUp'],
])
const before = Float32Array.from(e.terrain.heights)
const s = await P.stroke(tool, { x: 100, z: 100 }, { x: 160, z: 100 }, 12)
const snap = t.snap()
t.reset()
const zero = t.snap()
t.restore()
const restored = Cls.prototype.tick === orig
let changed = 0
for (let i = 0; i < before.length; i++) if (before[i] !== e.terrain.heights[i]) changed++
e.history.undo()
const yaw0 = e.controller.yaw
const stop = P.turn(0.05)
await P.frames(4)
const turned = e.controller.yaw - yaw0
stop()
await P.frames(2)
const still = e.controller.yaw - yaw0 - turned
const key = Cls.name + '.tick'
const byPath = await P.time({ '/src/lib/engine/Engine.ts:Engine': ['frame'] })
await P.frames(3)
const pathCalls = byPath.snap()['Engine.frame'].calls
byPath.restore()
// P.texture (#317): the colour view, the alpha view (grey) and a resized one.
const path = 'Textures\\Weather\\RainDropSplash01.blp'
const color = await P.texture(path)
const alpha = await P.texture(path, { alpha: true })
const small = await P.texture(path, { size: 64 })
P.save(color, 'color')
P.save(alpha, 'alpha')
const texDiff = P.diff(color, alpha)
let grey = true
for (let i = 0; i < alpha.px.length; i += 4) if (alpha.px[i] !== alpha.px[i + 1] || alpha.px[i] !== alpha.px[i + 2]) grey = false
const texture = {
	ok: color.w > 0 && color.h > 0 && color.px.length === color.w * color.h * 4 && small.w === 64 && small.h === 64 && grey && texDiff.off > 0,
	size: [color.w, color.h],
	lit: [color.lit, alpha.lit],
	diff: texDiff,
}
return {
	ok:
		texture.ok &&
		snap[key].calls === 12 &&
		snap[key].ms > 0 &&
		snap[Cls.name + '.onUp'].calls === 1 &&
		snap.total.calls === 13 &&
		zero.total.calls === 0 &&
		restored &&
		changed > 0 &&
		Math.abs(turned - 0.2) < 1e-6 &&
		Math.abs(still) < 1e-6 &&
		pathCalls === 3,
	snap,
	stroke: s,
	restored,
	changed,
	turned,
	still,
	pathCalls,
	texture,
}
