// Run with: bun test tests/perfMeter.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CPU_SECTIONS, PerfMeter, SECTION, formatReport, meshTriangles, topModels, type PerfReport } from '../src/lib/engine/perfMeter.ts'

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
			{ type: 'a', triangles: 10, instances: 1 },
			{ type: 'b', triangles: 30, instances: 2 },
			{ type: 'a', triangles: 25, instances: 3 },
			{ type: 'c', triangles: 0, instances: 0 },
			{ type: 'd', triangles: 5, instances: 1 },
		],
		2,
	)
	assert.deepEqual(top, [
		{ type: 'a', triangles: 35, instances: 4 },
		{ type: 'b', triangles: 30, instances: 2 },
	])
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
		triangles: 5000,
		geometries: 10,
		textures: 20,
		programs: 5,
		instancedMeshes: 7,
		heapMB: null,
		models: [],
	}
	const text = formatReport(r)
	for (const name of CPU_SECTIONS) assert.ok(text.includes(name), name)
	assert.ok(text.includes('GPU: n/a'))
	assert.ok(formatReport({ ...r, gpu: [1, 2, 3] }).includes('GPU 6.00 ms'))
})
