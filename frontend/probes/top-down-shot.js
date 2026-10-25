// A minimap tile's shot (#554): on the benchmark scene, `renderMinimapTile` draws the tile from above without drawing a frame of the view (the frame counter, the clock and the meter's window stay put), the shot is lit ground (not black) and the same twice, the view draws as before after it, and the performance report books the paths and baked shadows to their own section; prints the ms a shot.
// touches: frontend/src/lib/engine/Engine.ts, frontend/src/lib/engine/perfMeter.ts, frontend/src/lib/io/minimapImage.ts
await P.scene(P.BENCH)
await P.settle()
await P.frames(3)
const e = P.e
const shot = (models) => e.renderMinimapTile(0, 0, models, 256)
const stats = (px) => {
	let sum = 0
	let lit = 0
	for (let i = 0; i < px.length; i += 4) {
		const v = px[i] + px[i + 1] + px[i + 2]
		sum += v
		if (v > 30) lit++
	}
	return { mean: +(sum / (px.length / 4) / 3).toFixed(1), lit: +(lit / (px.length / 4)).toFixed(3) }
}
const diff = (a, b) => {
	let d = 0
	for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
	return +(d / a.length).toFixed(3)
}
shot('all')
const calls0 = e.renderer.info.render.calls
const frames0 = e.frames
const clock0 = e.timer.getElapsed()
const times = []
let a = null
let b = null
for (let i = 0; i < 4; i++) {
	const t0 = performance.now()
	const px = shot(i % 2 ? 'buildings' : 'all')
	times.push(performance.now() - t0)
	if (i === 0) a = px
	if (i === 2) b = px
}
const out = {
	ms: times.map((t) => +t.toFixed(1)),
	all: stats(a),
	same: diff(a, b),
	framesKept: e.frames === frames0,
	clockKept: e.timer.getElapsed() === clock0,
	callsAfterShots: e.renderer.info.render.calls,
	callsBefore: calls0,
}
await P.frames(3)
out.topDownAfter = e.topDown
out.viewCalls = e.renderer.info.render.calls
out.glErrors = P.glError()

// The report's sections: the paths and baked shadows have their own.
let r = null
e.measurePerf().then((x) => (r = x))
const end = performance.now() + 4000
while (!r && performance.now() < end) await P.frames(1)
const { CPU_SECTIONS } = await P.app('/src/lib/engine/perfMeter.ts')
const i = CPU_SECTIONS.indexOf('Paths and baked shadows')
out.pathsSection = i >= 0 && r ? +r.sections[i].toFixed(3) : null
out.ok = out.all.lit > 0.9 && out.all.mean > 20 && out.same === 0 && out.framesKept && out.clockKept && !out.topDownAfter && out.viewCalls > 0 && out.glErrors === 0 && out.pathsSection !== null
return out
