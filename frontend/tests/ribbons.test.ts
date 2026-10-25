// Run with: bun test tests/ribbons.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { AnimTrack, MeshRibbon } from '../src/lib/wow/api.ts'
import { VERTEX_FLOATS } from '../src/lib/world/particles.ts'
import { gravityStep, MAX_EDGES, RibbonTrail, ribbonBlend } from '../src/lib/world/ribbons.ts'

const k = (v: number): AnimTrack => ({ t: [0], v: [v], loop: 0 })

function def(over: Partial<MeshRibbon> = {}): MeshRibbon {
	return {
		frame: new THREE.Matrix4().toArray(),
		bone: -1,
		texture: 'trail.blp',
		blend: 4,
		above: k(1),
		below: k(0.5),
		edgesPerSecond: 10,
		edgeLifetime: 1,
		gravity: 0,
		rows: 1,
		cols: 1,
		slot: 0,
		...over,
	}
}

const at = (x: number) => new THREE.Matrix4().makeTranslation(x, 0, 0)

test('gravity telescopes to g·t² at any frame rate (Benilla ribbons.rs)', () => {
	for (const g of [0.5, 2, -1]) {
		for (const dt of [1 / 144, 1 / 60, 1 / 15]) {
			const steps = Math.round(1 / dt)
			let y = 0
			let age = 0
			for (let i = 0; i < steps; i++) {
				y += gravityStep(g, age, dt)
				age += dt
			}
			const t = steps * dt
			assert.ok(Math.abs(y - g * t * t) < 1e-4, `g ${g} dt ${dt}: ${y}`)
		}
	}
})

test('a ribbon blend folds as Benilla folds it', () => {
	assert.equal(ribbonBlend(4), 'add')
	assert.equal(ribbonBlend(2), 'alpha')
	assert.equal(ribbonBlend(1), 'alphaKey')
	assert.equal(ribbonBlend(6), 'opaque')
})

test('a moving point lays edges spanning +Y, drawn as a strip back from the point', () => {
	const r = new RibbonTrail(def())
	for (let i = 0; i < 10; i++) r.step(0.1, i * 100, at(i))
	assert.equal(r.count, 10, '10 a second for a second')
	const out = new Float32Array(r.floats)
	const n = r.expand(out, 0)
	assert.equal(n, 10 * 4 * VERTEX_FLOATS, 'a quad between each pair')
	// The first quad starts at the point: its bottom-left is the point's bottom, its top-left the top.
	assert.deepEqual([out[0], out[1], out[2]], [9, -0.5, 0])
	assert.deepEqual([out[27], out[28], out[29]], [9, 1, 0])
	assert.equal(out[3], 0, 'U is 0 at the point')
	const last = n - VERTEX_FLOATS
	assert.ok(out[last + 3] > 0.8, `U nears 1 at the oldest edge: ${out[last + 3]}`)
})

test('edges die at their lifetime, the gate stops the trail, and the ring has a cap', () => {
	const r = new RibbonTrail(def({ edgeLifetime: 0.25 }))
	for (let i = 0; i < 10; i++) r.step(0.1, i * 100, at(i))
	assert.ok(r.count <= 3, `${r.count} edges live`)
	const off = new RibbonTrail(def({ on: k(0) }))
	for (let i = 0; i < 5; i++) off.step(0.1, i * 100, at(i))
	assert.equal(off.count, 0)
	assert.equal(off.expand(new Float32Array(1000), 0), 0, 'a dark ribbon draws nothing')
	const many = new RibbonTrail(def({ edgesPerSecond: 1e6, edgeLifetime: 100 }))
	many.step(0.1, 0, at(0))
	assert.equal(many.count, MAX_EDGES)
})

test('edges rise by gravity', () => {
	const r = new RibbonTrail(def({ gravity: 2, edgesPerSecond: 1 }))
	r.step(1, 0, at(0))
	for (let i = 1; i <= 10; i++) r.step(0.05, 1000 + i * 50, at(0))
	const out = new Float32Array(r.floats)
	r.expand(out, 0)
	// The edge's top (the quad's third corner) has risen above the point's.
	assert.ok(out[2 * VERTEX_FLOATS + 1] > 1.2, `${out[2 * VERTEX_FLOATS + 1]}`)
})
