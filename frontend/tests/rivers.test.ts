// Run with: bun test tests/rivers.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAKE_RULES, findLakes } from '../src/lib/water/lakes.ts'
import { findRivers, planWater, riverPoints, type RiverRules } from '../src/lib/water/rivers.ts'

const CS = 4

/** Heights over a V×V grid from f(x, z) in vertices. */
function field(V: number, f: (x: number, z: number) => number): Float32Array {
	const h = new Float32Array(V * V)
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) h[z * V + x] = f(x, z)
	return h
}

const rules: RiverRules = { sea: 0, count: 4, minArea: 4000, sourceArea: 400, minLength: 100, minDrop: 8, spacing: 40 }

/** A plane rising from the sea at x = 0 inland, with a valley down its middle (z = 32), its sides steeper than its floor. */
const V = 65
const valley = () => field(V, (x, z) => (x - 3) * 0.6 + Math.abs(z - 32) * 1.5)

test('a river runs down the valley from the high ground to the sea', () => {
	const h = valley()
	const none = new Float32Array(V * V).fill(NaN)
	const rivers = findRivers(h, V, CS, rules, none)
	assert.ok(rivers.length >= 1)
	const r = rivers[0]
	assert.equal(r.into, 'sea')
	assert.equal(r.from, 'source')
	// Along the valley floor, from inland (where the map's edge turns it) down to the coast.
	for (const v of r.verts) if (v % V < 60) assert.equal(Math.floor(v / V), 32)
	const first = r.verts[0] % V
	const last = r.verts[r.verts.length - 1] % V
	assert.ok(first > 40 && last <= 4, `from x ${first} to x ${last}`)
	// The surface falls all the way and never under the sea.
	for (let i = 1; i < r.surface.length; i++) assert.ok(r.surface[i] <= r.surface[i - 1])
	assert.ok(r.surface[r.surface.length - 1] >= 0)
	// Its mouth is dry, the next vertex down the sea's.
	assert.ok(h[r.verts[r.verts.length - 1]] >= 0)
})

test('the biggest river comes first, and rivers keep their spacing', () => {
	// Two valleys, at z = 16 and z = 48.
	const h = field(V, (x, z) => (x - 3) * 0.6 + Math.min(Math.abs(z - 16), Math.abs(z - 48)) * 1.5)
	const none = new Float32Array(V * V).fill(NaN)
	const two = findRivers(h, V, CS, { ...rules, count: 8 }, none)
	const rows = two.map((r) => Math.floor(r.verts[0] / V))
	assert.ok(rows.includes(16) && rows.includes(48), `rivers in rows ${rows}`)
	assert.ok(two[0].area >= two[1].area)
	// Each river at least the spacing from every other's vertices.
	for (let i = 0; i < two.length; i++) {
		for (let j = i + 1; j < two.length; j++) {
			for (const a of two[i].verts) {
				for (const b of two[j].verts) assert.ok(Math.hypot((a % V) - (b % V), Math.floor(a / V) - Math.floor(b / V)) * CS > rules.spacing - CS)
			}
		}
	}
	assert.equal(findRivers(h, V, CS, { ...rules, count: 1 }, none).length, 1)
	assert.equal(findRivers(h, V, CS, { ...rules, count: 0 }, none).length, 0)
})

test('flat ground and a map with no way down get no river', () => {
	const none = new Float32Array(V * V).fill(NaN)
	assert.equal(
		findRivers(
			field(V, () => 10),
			V,
			CS,
			rules,
			none,
		).length,
		0,
	)
	// No sea and walled in: everything drains into a basin too big to be a lake.
	const walled = field(V, (x, z) => (x === 0 || z === 0 || x === V - 1 || z === V - 1 ? 300 : 5 + x * 0.3))
	assert.equal(findRivers(walled, V, CS, { ...rules, sea: null }, none).length, 0)
})

test('the control points follow the river at its surface, ends included', () => {
	const h = valley()
	const [r] = findRivers(h, V, CS, rules, new Float32Array(V * V).fill(NaN))
	const pts = riverPoints(r, V, CS)
	assert.ok(pts.length >= 3)
	const first = r.verts[0]
	const last = r.verts[r.verts.length - 1]
	assert.deepEqual(pts[0], { x: (first % V) * CS, y: r.surface[0], z: Math.floor(first / V) * CS })
	assert.deepEqual(pts[pts.length - 1], { x: (last % V) * CS, y: r.surface[r.surface.length - 1], z: Math.floor(last / V) * CS })
	for (let i = 1; i < pts.length; i++) assert.ok(pts[i].y <= pts[i - 1].y)
})

test('without Lakes, the lake a river runs into is filled and the others stay dry', () => {
	// No sea: a long slope down to a bowl at x = 30, and a second bowl off the river's way at the far corner.
	const W = 129
	const bowl = (x: number, z: number, cx: number, cz: number) => Math.max(0, 14 - Math.hypot(x - cx, z - cz))
	const h = field(W, (x, z) => 40 + x * 0.5 + Math.abs(z - 64) * 1.5 - bowl(x, z, 30, 64) * 3 - bowl(x, z, 100, 115) * 3)
	const all = findLakes(h, W, CS, { ...LAKE_RULES, sea: null })
	assert.ok(!Number.isNaN(all[64 * W + 30]) && !Number.isNaN(all[115 * W + 100]), 'two lakes in the ground')
	const plan = planWater(h, W, CS, null, false, 4)
	const into = plan.rivers.find((r) => r.into === 'lake')
	assert.ok(into, `rivers ${plan.rivers.map((r) => `${r.from}>${r.into}`)}`)
	assert.ok(plan.lakes)
	assert.equal(plan.lakes[64 * W + 30], all[64 * W + 30])
	assert.ok(Number.isNaN(plan.lakes[115 * W + 100]))
	// Its last vertex is the lake's.
	assert.ok(!Number.isNaN(plan.lakes[into.verts[into.verts.length - 1]]))
	// With Lakes, both.
	const both = planWater(h, W, CS, null, true, 4)
	assert.ok(both.lakes && !Number.isNaN(both.lakes[115 * W + 100]))
	// Neither: no lakes to fill.
	assert.equal(planWater(h, W, CS, null, false, 0).lakes, null)
})
