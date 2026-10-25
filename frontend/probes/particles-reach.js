// The far-emitter pre-test (#330) runs the same particle pools and ribbons as the exact range and view test alone, on the benchmark scene (PROBE_MAP=<kind>, PROBE_SCALE for a benchmark map), from its view and three turns.
// touches: frontend/src/lib/world/ParticleLayer.ts, frontend/src/lib/world/particles.ts, frontend/src/lib/world/ribbons.ts
const kind = P.env('MAP', 'bench')
const scale = P.env('SCALE', 1)
if (kind === 'bench') {
	await P.scene(P.BENCH)
	await P.settle()
} else await P.loadBenchMap(kind, undefined, scale)
const pl = P.e.particles
const { ParticlePool } = await P.app('/src/lib/world/particles.ts')
const { RibbonTrail } = await P.app('/src/lib/world/ribbons.ts')
let pools = new Set()
const wrap = (proto) => {
	const f = proto.step
	proto.step = function (...a) {
		pools.add(this)
		return f.apply(this, a)
	}
	return () => (proto.step = f)
}
const undo = [wrap(ParticlePool.prototype), wrap(RibbonTrail.prototype)]
const saved = new Map()
for (const l of pl.live.values()) saved.set(l, l.reach)
const views = []
const target = P.e.camera.position.clone()
for (let v = 0; v < 4; v++) {
	if (v) await P.lookAt({ x: target.x + 40 * Math.cos(v * 1.6), y: target.y - 20, z: target.z + 40 * Math.sin(v * 1.6) }, { yaw: v * 1.6, pitch: 0.4, back: 30 })
	// Let the camera settle (a followed camera glides), then off, on and off again: the two offs must
	// agree, or something besides the switch changed between the frames and the view is retried.
	const eq = (a, b) => a.size === b.size && [...a].every((p) => b.has(p))
	let got = null
	for (let tries = 0; tries < 5 && !got?.still; tries++) {
		await P.frames(3)
		got = {}
		for (const [k, on] of [
			['off', false],
			['on', true],
			['off2', false],
		]) {
			for (const [l, reach] of saved) l.reach = on ? reach : Infinity
			pools = new Set()
			await P.frames(1)
			got[k] = pools
		}
		got.still = eq(got.off, got.off2)
	}
	views.push({ on: got.on.size, off: got.off.size, still: got.still, same: got.still && eq(got.on, got.off) })
}
for (const [l, reach] of saved) l.reach = reach
undo.forEach((u) => u())
return { ok: views.every((v) => v.same), kind, scale, live: pl.live.size, views }
