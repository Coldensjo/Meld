// Run with: bun test tests/perfMeter.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { CPU_SECTIONS, PerfMeter, SECTION, ShadowPassCalls, formatReport, meshCalls, meshTriangles, topCalls, topModels, type PerfReport } from '../src/lib/engine/perfMeter.ts'

test('marks book the time since the last mark to their section, averaged over the frames', () => {
	const m = new PerfMeter()
	m.setOn(true)
	for (let f = 0; f < 4; f++) {
		const t = f * 250
		m.begin(t)
		m.mark(SECTION.Picking, t + 1)
		m.mark(SECTION.Terrain, t + 4)
		m.mark(SECTION.Picking, t + 5)
		assert.equal(m.end(t + 5), false)
	}
	m.begin(1000)
	m.mark(SECTION.Terrain, 1003)
	assert.equal(m.end(1003), true, 'a second has gone by')
	const w = m.take(1003)
	assert.equal(w.frames, 5)
	assert.equal(w.frameMs, 250)
	assert.equal(w.worstMs, 250)
	assert.equal(w.sections[SECTION.Picking], (4 * 2) / 5)
	assert.equal(w.sections[SECTION.Terrain], (4 * 3 + 3) / 5)
	assert.equal(w.cpuMs, (4 * 5 + 3) / 5)
	assert.equal(m.take(1003).frames, 0, 'take starts a new window')
})

test('an off meter books nothing', () => {
	const m = new PerfMeter()
	m.begin(0)
	m.mark(SECTION.Tool, 10)
	assert.equal(m.end(2000), false)
	m.setOn(true)
	assert.equal(
		m.take(0).sections.reduce((a, b) => a + b, 0),
		0,
	)
})

test('an instanced mesh draws its draw range times its instances, and nothing when hidden', () => {
	const geometry = { index: { count: 300 }, drawRange: { count: Infinity }, attributes: {} }
	assert.equal(meshTriangles({ visible: true, count: 4, geometry }), 400)
	assert.equal(meshTriangles({ visible: false, count: 4, geometry }), 0)
	assert.equal(meshTriangles({ visible: true, count: 2, geometry: { ...geometry, drawRange: { count: 30 } } }), 20)
	assert.equal(meshTriangles({ visible: true, count: 1, geometry: { index: null, drawRange: { count: Infinity }, attributes: { position: { count: 9 } } } }), 3)
})

test('the costliest models sum a type met twice and keep the top n', () => {
	const top = topModels(
		[
			{ type: 'a', triangles: 10, instances: 1, calls: 2 },
			{ type: 'b', triangles: 30, instances: 2, calls: 1 },
			{ type: 'a', triangles: 25, instances: 3, calls: 2 },
			{ type: 'c', triangles: 0, instances: 0, calls: 0 },
			{ type: 'd', triangles: 5, instances: 1, calls: 9 },
		],
		2,
	)
	assert.deepEqual(top, [
		{ type: 'a', triangles: 35, instances: 4, calls: 4 },
		{ type: 'b', triangles: 30, instances: 2, calls: 1 },
	])
})

test('the models making the most draw calls count a call a geometry group drawn (#692)', () => {
	const geometry = { index: { count: 300 }, drawRange: { count: Infinity }, attributes: {}, groups: [{}, {}, {}] }
	assert.equal(meshCalls({ visible: true, count: 40, geometry }), 3, 'a call a group, however many instances')
	assert.equal(meshCalls({ visible: true, count: 1, geometry: { ...geometry, groups: [] } }), 1, 'one with no groups')
	assert.equal(meshCalls({ visible: true, count: 0, geometry }), 0, 'none with no instance packed')
	assert.equal(meshCalls({ visible: false, count: 4, geometry }), 0, 'none when hidden')
	assert.equal(meshCalls({ visible: true, count: 1, geometry: { ...geometry, userData: { drawnCalls: 2 } } }), 2, 'a culled WMO, only its materials in view (#934)')
	const top = topCalls(
		[
			{ type: 'wmo', triangles: 9000, instances: 1, calls: 12 },
			{ type: 'tree', triangles: 100, instances: 50, calls: 2 },
			{ type: 'tree', triangles: 50, instances: 20, calls: 2 },
			{ type: 'rock', triangles: 20000, instances: 9, calls: 1 },
		],
		2,
	)
	assert.deepEqual(
		top.map((m) => [m.type, m.calls]),
		[
			['wmo', 12],
			['tree', 4],
		],
	)
})

test('the shadow passes split the calls of the frame and say which maps were kept (#692)', () => {
	const p = new ShadowPassCalls()
	p.beginFrame()
	// The near map draws calls 100..400 and the far map 400..1000 of a frame of 1600: the scene pass has the other 700.
	p.enter(0, 100)
	p.enter(1, 400)
	p.enter(-1, 1000)
	p.leave(1000)
	p.endFrame()
	assert.deepEqual(p.byPass(1600), { scene: 700, near: 300, far: 600, points: null })
	// A still frame keeps both maps; a frame with posed models draws the near one twice (the still casters, then the posed ones).
	p.beginFrame()
	p.leave(10)
	p.endFrame()
	assert.deepEqual(p.byPass(500), { scene: 500, near: null, far: null, points: null })
	p.beginFrame()
	p.enter(0, 0)
	p.enter(-1, 50)
	p.enter(0, 50)
	p.leave(70)
	p.endFrame()
	assert.deepEqual(p.byPass(570), { scene: 500, near: 70, far: null, points: null })
	assert.deepEqual(p.takeRedrawn(), { near: 2, far: 1, points: 0 })
	assert.deepEqual(p.takeRedrawn(), { near: 0, far: 0, points: 0 }, 'a new window')
})

test('the report names every section and says when the GPU is not timed', () => {
	const r: PerfReport = {
		frames: 60,
		fps: 60,
		frameMs: 16.7,
		worstMs: 20,
		cpuMs: 3,
		sections: CPU_SECTIONS.map(() => 0.1),
		gpu: null,
		calls: 100,
		callsByPass: { scene: 60, near: 40, far: null, points: null },
		shadowRedraws: { near: 60, far: 2, points: 0 },
		triangles: 5000,
		geometries: 10,
		textures: 20,
		programs: 5,
		instancedMeshes: 7,
		heapMB: null,
		models: [],
		topCalls: [{ type: 'world/wmo/a.wmo', triangles: 900, instances: 1, calls: 12 }],
	}
	const text = formatReport(r)
	for (const name of CPU_SECTIONS) assert.ok(text.includes(name), name)
	assert.ok(text.includes('GPU: n/a'))
	assert.ok(text.includes('by pass: scene 60, near shadow 40, far shadow kept, point-light shadows kept'))
	assert.ok(text.includes('world/wmo/a.wmo: 12 calls'))
	assert.ok(formatReport({ ...r, gpu: [1, 2, 3] }).includes('GPU 6.00 ms'))
})
