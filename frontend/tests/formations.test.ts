// Run with: bun test tests/formations.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { vmangos } from '../wailsjs/go/models'
import { disbandChanges, FORMATION_DEFAULT, joinChanges, leaveChanges, slotAt, slotFieldsAt, slotPosition } from '../src/lib/world/formations.ts'
import { chanceProblem, joinMotherChanges, joinPoolChanges, leaveMotherChanges, motherLimitChanges, poolLegend, poolRule, poolSize } from '../src/lib/world/pools.ts'

const spawn = (o: Partial<vmangos.WorldSpawn>): vmangos.WorldSpawn =>
	({
		kind: 'monster',
		guid: 1,
		name: 'x',
		x: 0,
		y: 0,
		z: 0,
		orientation: 0,
		scale: 1,
		leader: 0,
		followDist: 0,
		followAngle: 0,
		groupFlags: 0,
		pool: 0,
		poolLimit: 0,
		poolName: '',
		poolChance: 0,
		poolElsewhere: 0,
		motherPool: 0,
		motherLimit: 0,
		motherSize: 0,
		motherName: '',
		...o,
	}) as vmangos.WorldSpawn

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)

test("a slot ahead of a leader facing 0 lies towards the region's -Z, and 90° is on its left (-X)", () => {
	const leader = spawn({ x: 10, z: 10, orientation: 0 })
	const ahead = slotPosition(leader, 3, 0, { x: 0, z: 0 })
	near(ahead.x, 10)
	near(ahead.z, 7)
	// Server +Y (west) is the region's -X; facing north, west is on the left.
	const left = slotPosition(leader, 3, Math.PI / 2, { x: 0, z: 0 })
	near(left.x, 7)
	near(left.z, 10)
})

test('slotAt undoes slotPosition for any facing', () => {
	for (const o of [0, 1, 2.5, 4.7, 6]) {
		const leader = spawn({ x: -4, z: 20, orientation: o })
		for (const a of [0, 0.3, 3, 5.9]) {
			const p = slotPosition(leader, 4.5, a, { x: 0, z: 0 })
			const s = slotAt(leader, p.x, p.z)
			near(s.followDist, 4.5)
			near(s.followAngle, a)
		}
	}
})

test('joining makes the leader lead with the default flags and the member follow in its slot', () => {
	const leader = spawn({ guid: 1, x: 0, z: 0 })
	const member = spawn({ guid: 2, x: 0, z: 2 })
	const c = joinChanges([leader, member], leader, member)
	assert.ok(Array.isArray(c))
	assert.deepEqual(c[0], { key: 'monster/1', vals: { leader: 1, followDist: 0, followAngle: 0, groupFlags: FORMATION_DEFAULT } })
	assert.equal(c[1].key, 'monster/2')
	near(c[1].vals.followDist!, 2)
	near(c[1].vals.followAngle!, Math.PI) // behind a leader facing -Z
	assert.equal(c[1].vals.leader, 1)
})

test('a follower cannot lead, a leader with followers cannot join, objects never walk in formation', () => {
	const leader = spawn({ guid: 1, leader: 1 })
	const follower = spawn({ guid: 2, leader: 1 })
	const other = spawn({ guid: 3, leader: 3 })
	const its = spawn({ guid: 4, leader: 3 })
	const chest = spawn({ guid: 5, kind: 'object' })
	const all = [leader, follower, other, its, chest]
	assert.equal(typeof joinChanges(all, follower, spawn({ guid: 9 })), 'string')
	assert.equal(typeof joinChanges(all, leader, other), 'string')
	assert.equal(typeof joinChanges(all, leader, chest), 'string')
	assert.equal(typeof joinChanges(all, leader, leader), 'string')
})

test('the last follower leaving ends the formation; disbanding takes every follower', () => {
	const leader = spawn({ guid: 1, leader: 1 })
	const a = spawn({ guid: 2, leader: 1 })
	const b = spawn({ guid: 3, leader: 1 })
	assert.deepEqual(
		leaveChanges([leader, a, b], a).map((c) => c.key),
		['monster/2'],
	)
	assert.deepEqual(
		leaveChanges([leader, a], a).map((c) => c.key),
		['monster/2', 'monster/1'],
	)
	assert.deepEqual(
		disbandChanges([leader, a, b], leader).map((c) => c.key),
		['monster/1', 'monster/2', 'monster/3'],
	)
	assert.equal(leaveChanges([leader, a], a)[0].vals.leader, 0)
})

test('a dragged follower takes its slot; a creature without a leader in the region does not', () => {
	const leader = spawn({ guid: 1, leader: 1, x: 0, z: 0 })
	const f = spawn({ guid: 2, leader: 1 })
	near(slotFieldsAt([leader, f], f, 0, -5)!.followDist!, 5)
	assert.equal(slotFieldsAt([f], f, 0, -5), undefined)
	assert.equal(slotFieldsAt([leader, f], leader, 0, -5), undefined)
})

test('a pool counts its members in the region and elsewhere, and says what the server spawns', () => {
	const a = spawn({ guid: 1, kind: 'object', pool: 7, poolLimit: 1, poolElsewhere: 3 })
	const b = spawn({ guid: 2, kind: 'object', pool: 7, poolLimit: 1, poolElsewhere: 3 })
	const creature = spawn({ guid: 1, pool: 7 })
	assert.equal(poolSize([a, b, creature], a), 5)
	assert.equal(poolRule(1, 5), '1 of its 5 spawns at a time')
	assert.equal(poolRule(5, 5), 'all of its 5 spawns')
	assert.equal(typeof joinPoolChanges(a, creature), 'string')
	const c = joinPoolChanges(a, spawn({ guid: 3, kind: 'object' }))
	assert.ok(Array.isArray(c) && c[0].vals.pool === 7 && c[0].vals.poolElsewhere === 3 && c[0].vals.poolChance === 0)
})

test('chances must add up to 100 when every member of a limit-1 pool has one', () => {
	const a = spawn({ guid: 1, pool: 7, poolLimit: 1, poolChance: 40 })
	const b = spawn({ guid: 2, pool: 7, poolLimit: 1, poolChance: 40 })
	assert.match(chanceProblem([a, b], a), /80%/)
	b.poolChance = 60
	assert.equal(chanceProblem([a, b], a), '')
	b.poolChance = 0
	assert.equal(chanceProblem([a, b], a), '')
	a.poolLimit = b.poolLimit = 2
	assert.match(chanceProblem([a, b], a), /limit of 1/)
})

test('the legend lists a mother pool once for all its spots, with its limit and size', () => {
	const spot = (guid: number, pool: number) => spawn({ guid, kind: 'object', pool, poolLimit: 1, motherPool: 1080, motherLimit: 15, motherSize: 113, motherName: 'Tin' })
	const lone = spawn({ guid: 9, kind: 'object', pool: 5, poolLimit: 1, poolElsewhere: 1, poolName: 'Chest' })
	const legend = poolLegend([spot(1, 100), spot(2, 100), spot(3, 101), lone])
	assert.deepEqual(
		legend.map((e) => [e.pool, e.mother, e.limit, e.size, e.spawns]),
		[
			[1080, true, 15, 113, 3],
			[5, false, 1, 2, 1],
		],
	)
})

test('a pool joins a master pool with all its spawns, and leaves it again', () => {
	const spot = (guid: number, pool: number) => spawn({ guid, kind: 'object', pool, poolLimit: 1, motherPool: 1080, motherLimit: 15, motherSize: 113, motherName: 'Tin' })
	const a = spot(1, 100)
	const b = spot(2, 101)
	const n1 = spawn({ guid: 3, kind: 'object', pool: 9000, poolLimit: 1 })
	const n2 = spawn({ guid: 4, kind: 'object', pool: 9000, poolLimit: 1 })
	const all = [a, b, n1, n2]
	const c = joinMotherChanges(all, a, n1)
	assert.ok(Array.isArray(c))
	const by = new Map(c.map((x) => [x.key, x.vals]))
	assert.deepEqual(by.get('object/3'), { motherPool: 1080, motherLimit: 15, motherName: 'Tin', motherSize: 114 })
	assert.equal(by.get('object/4')?.motherPool, 1080)
	assert.deepEqual(by.get('object/1'), { motherSize: 114 })
	assert.equal(typeof joinMotherChanges(all, n1, a), 'string', 'a pool with no master pool has none to join')
	assert.equal(typeof joinMotherChanges(all, b, a), 'string', 'already in it')
	assert.equal(typeof joinMotherChanges(all, a, spawn({ guid: 5, kind: 'object' })), 'string', 'a spawn in no pool')
	const out = new Map(leaveMotherChanges(all, a).map((x) => [x.key, x.vals]))
	assert.equal(out.get('object/1')?.motherPool, 0)
	assert.deepEqual(out.get('object/2'), { motherSize: 112 })
	assert.equal(out.has('object/3'), false)
	assert.deepEqual(
		motherLimitChanges(all, a, 20).map((x) => x.key),
		['object/1', 'object/2'],
	)
})
