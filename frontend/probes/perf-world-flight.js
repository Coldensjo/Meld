// A flight east through Elwynn's world view (#742; docs/TESTS.md, "Probes"): frame by frame the CPU, which shadow maps were redrawn, why and at what cost, and what landed. Numbers for a before/after, checks nothing.
// touches: frontend/src/lib/world/WorldStream.ts, frontend/src/lib/world/WorldPainter.ts, frontend/src/lib/world/worldGround.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/io/region.ts
// The camera flies 100 yd over the ground, 8 yd a frame for 120 frames (edit STEP and N below for another flight); about 100 s of flight, 140 s with the load.
const { editor } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const T = 1600 / 3
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => editor.worldMap === 'Azeroth' || null, 30000, 'the world tab')
const mid = { x: 32.5 * T, z: 49.5 * T }
await P.until(
	() => {
		const s = e.worldStats()
		return s && s.loaded >= 9 && !s.loading && !s.queued ? s : null
	},
	180000,
	'the tiles around the camera loaded',
)
const ground = e.doc.world.heightAt(mid.x, mid.z)
await P.lookAt({ x: mid.x, y: ground + 100, z: mid.z }, { pitch: 0.3, back: 1 })
await P.settle()
await P.frames(20)
// Wrap the shadow pass to see which maps it redrew and what that cost. (P.drawn after each frame: skipping it only moves the stall into the GPU backlog.)
const sm = e.renderer.shadowMap
const info = e.renderer.info.render
const orig = sm.render.bind(sm)
let rec = null
sm.render = (lights, scene, camera) => {
	const key = e.env.key.shadow.needsUpdate
	const far = e.env.far.shadow.needsUpdate
	const c0 = info.calls
	const t0 = performance.now()
	orig(lights, scene, camera)
	rec = { key, far, calls: info.calls - c0, ms: performance.now() - t0 }
}
const STEP = +(globalThis.STEP ?? 8)
const N = +(globalThis.N ?? 120)
const c = e.controller
c.yaw = -Math.PI / 2
// Engine.shadowKey: 0 objects version, 1 heights, 2 holes, 3 spawns, 4 textures bound. A far redraw's cause is the change since the last far redraw, not this frame's (a world view holds scene-only redraws for 30 frames).
const KEYS = ['objects', 'heights', 'holes', 'spawns', 'textures']
let farKey = [...e.shadowKey]
const rows = []
let lastLoaded = e.worldStats().loaded
const t0 = performance.now()
try {
	for (let i = 0; i < N; i++) {
		c.target.x += STEP
		const h = e.doc.world.heightAt(c.target.x, c.target.z)
		if (Number.isFinite(h)) c.target.y = h + 100
		await P.tick()
		rec = null
		const a = performance.now()
		e.frame()
		const ms = performance.now() - a
		await P.drawn()
		const s = e.worldStats()
		const row = { ms, far: !!rec?.far, key: !!rec?.key, sCalls: rec?.calls ?? 0, sMs: rec?.ms ?? 0, tiles: s.loaded - lastLoaded, cause: '' }
		if (row.far) {
			const kd = KEYS.filter((_, j) => e.shadowKey[j] !== farKey[j])
			row.cause = kd.length ? kd.join('+') : 'fit'
			farKey = [...e.shadowKey]
		}
		lastLoaded = s.loaded
		rows.push(row)
	}
} finally {
	sm.render = orig
}
const flightSec = +((performance.now() - t0) / 1000).toFixed(1)
const sum = (f) => rows.reduce((t, r) => t + f(r), 0)
const farRows = rows.filter((r) => r.far)
const sorted = rows.map((r) => r.ms).sort((x, y) => x - y)
const pct = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1)
const avg = (arr, f) => (arr.length ? +(arr.reduce((t, r) => t + f(r), 0) / arr.length).toFixed(1) : 0)
const causes = {}
for (const r of farRows) causes[r.cause] = (causes[r.cause] ?? 0) + 1
return {
	ok: true,
	frames: N,
	step: STEP,
	flightSec,
	frameMs: { mean: avg(rows, (r) => r.ms), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1) },
	farRedraws: farRows.length,
	farCauses: causes,
	keyRedraws: rows.filter((r) => r.key).length,
	farFrameMs: avg(farRows, (r) => r.ms),
	otherFrameMs: avg(
		rows.filter((r) => !r.far),
		(r) => r.ms,
	),
	farShadowMs: avg(farRows, (r) => r.sMs),
	farShadowCalls: Math.round(avg(farRows, (r) => r.sCalls)),
	tilesLanded: sum((r) => r.tiles),
	stats: e.worldStats(),
	trace: rows
		.filter((_, i) => i % 10 === 0)
		.map((r) => `${r.ms.toFixed(0)}${r.far ? 'F' : ''}${r.key ? 'k' : ''}`)
		.join(' '),
}
