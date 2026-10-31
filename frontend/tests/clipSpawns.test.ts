// Run with: bun test tests/clipSpawns.test.ts
// The spawns of an area copy and paste (#964): what comes along of their formations and pools, the
// new guids and pool entries of a paste, heights on the new ground, and a turned or mirrored paste.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { nearNum } from './support/near.ts'
import type { vmangos } from '../src/lib/wails/models'
import type { MapClip } from '../src/lib/world/clipboard.ts'
import { copySpawns, mirrorClipSpawns, pastedOriginal, pasteSpawns, rotateClipSpawns, spawnDropsText, type SpawnGround, type SpawnIds } from '../src/lib/world/clipSpawns.ts'
import { mirrorClip, rotateClip } from '../src/lib/world/clipRotate.ts'
import { slotPosition } from '../src/lib/world/formations.ts'

const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')
const { spawnsAdd } = await import('../src/lib/world/spawnEdits.ts')

const spawn = (o: Partial<vmangos.WorldSpawn>): vmangos.WorldSpawn =>
	({
		kind: 'monster',
		guid: 1,
		entry: 38,
		name: 'Defias Thug',
		x: 0,
		y: 0,
		z: 0,
		orientation: 0,
		scale: 1,
		model: '',
		waypoints: [],
		pathFromTemplate: false,
		events: [],
		tilt: [],
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

/** Ground at height `h` everywhere in 0..size on both axes. */
const flat = (h: number, size = 1000): SpawnGround => ({ contains: (x, z) => x >= 0 && z >= 0 && x <= size && z <= size, heightAt: () => h })

/** Ids counting up from 9000 for creatures, 7000 for objects and 500 for pools. */
function ids(): SpawnIds {
	const next = { creature: 9000, object: 7000 }
	let pool = 500
	return { guid: (k) => next[k]++, pool: () => pool++ }
}

/** The copy area: x and z in 100..200. */
const inArea = (x: number, z: number) => x >= 100 && x <= 200 && z >= 100 && z <= 200

/** A camp: a leader with a path and a follower in its slot, a whole pool of two veins, and one vein of a pool that reaches out of the area. */
function camp(): vmangos.WorldSpawn[] {
	const leader = spawn({
		guid: 10,
		x: 120,
		y: 15,
		z: 130,
		orientation: 1,
		leader: 10,
		groupFlags: 3,
		movementType: 2,
		pathFromTemplate: true,
		events: [12],
		waypoints: [
			{ x: 140, y: 12, z: 130, orientation: 0, waitMs: 0, wanderDistance: 0, scriptId: 0 },
			{ x: 140, y: 14, z: 150, orientation: 2, waitMs: 1000, wanderDistance: 0, scriptId: 0 },
		],
	})
	const slot = slotPosition(leader, 3, 0.5, { x: 0, z: 0 })
	const follower = spawn({ guid: 11, x: slot.x, y: 15, z: slot.z, leader: 10, followDist: 3, followAngle: 0.5, groupFlags: 3 })
	const stray = spawn({ guid: 12, x: 150, y: 10, z: 150, leader: 99, followDist: 2, followAngle: 1, groupFlags: 3 })
	const outsider = spawn({ guid: 99, x: 300, y: 10, z: 300, leader: 99 })
	const pool = { pool: 40, poolLimit: 1, poolName: 'Copper veins', motherPool: 41, motherLimit: 5, motherSize: 20, motherName: 'Elwynn veins' }
	const veinA = spawn({ kind: 'object', guid: 10, entry: 1731, name: 'Copper Vein', x: 160, y: 10, z: 160, ...pool })
	const veinB = spawn({ kind: 'object', guid: 20, entry: 1731, name: 'Copper Vein', x: 162, y: 10, z: 160, ...pool })
	const split = { pool: 42, poolLimit: 1, poolName: 'Split' }
	const veinC = spawn({ kind: 'object', guid: 30, entry: 1731, name: 'Copper Vein', x: 170, y: 10, z: 170, ...split })
	const veinD = spawn({ kind: 'object', guid: 31, entry: 1731, name: 'Copper Vein', x: 400, y: 10, z: 170, ...split })
	return [leader, follower, stray, outsider, veinA, veinB, veinC, veinD]
}

test('a copy takes the spawns in the area relative to its corner, with whole formations and pools only', () => {
	const { spawns, drops } = copySpawns(camp(), inArea, flat(10), 100, 100)
	assert.deepEqual(
		spawns.map((c) => `${c.s.kind}/${c.s.guid}`),
		['monster/10', 'monster/11', 'monster/12', 'object/10', 'object/20', 'object/30'],
	)
	const [leader, follower, stray, veinA, , veinC] = spawns
	assert.deepEqual([leader.s.x, leader.s.z, leader.yOff], [20, 30, 5])
	assert.deepEqual(
		leader.s.waypoints.map((p) => [p.x, p.z]),
		[
			[40, 30],
			[40, 50],
		],
	)
	assert.deepEqual(
		leader.points.map((p) => [p.yOff, p.onGround]),
		[
			[2, true],
			[4, true],
		],
	)
	assert.equal(leader.s.leader, 10, 'the leader still leads the follower that came')
	assert.equal(follower.s.leader, 10)
	assert.equal(stray.s.leader, 0, 'a follower whose leader stayed behind leaves the formation')
	assert.equal(veinA.s.pool, 40, 'a pool all of whose members came along stays')
	assert.equal(veinA.s.motherPool, 0, 'a pasted pool is a new one, out of the master pool')
	assert.equal(veinC.s.pool, 0, 'a pool that reaches out of the area is left')
	assert.deepEqual(drops, { formation: 1, pool: 1, mother: 2 })
	assert.match(spawnDropsText(drops), /1 creature leaves its formation/)
	assert.equal(spawnDropsText({ formation: 0, pool: 0, mother: 0 }), '')
})

test('a pool with members elsewhere in the database, and a leader with no follower in the copy, are left', () => {
	const leader = spawn({ guid: 5, x: 150, z: 150, leader: 5, groupFlags: 3 })
	const away = spawn({ guid: 6, x: 300, z: 300, leader: 5 })
	const vein = spawn({ kind: 'object', guid: 1, x: 150, z: 150, pool: 7, poolLimit: 1, poolElsewhere: 3 })
	const { spawns, drops } = copySpawns([leader, away, vein], inArea, flat(0), 100, 100)
	assert.equal(spawns[0].s.leader, 0)
	assert.equal(spawns[1].s.pool, 0)
	assert.deepEqual(drops, { formation: 0, pool: 1, mother: 0 })
})

test('a paste makes new spawns with new guids, leaders and pools, on the new ground', () => {
	const src = camp()
	const { spawns } = copySpawns(src, inArea, flat(10), 100, 100)
	const out = pasteSpawns(spawns, 500, 600, flat(50), ids())
	assert.equal(out.length, 6)
	const [leader, follower, stray, veinA, veinB, veinC] = out
	assert.deepEqual(
		out.map((s) => s.guid),
		[9000, 9001, 9002, 7000, 7001, 7002],
	)
	assert.deepEqual([leader.x, leader.y, leader.z], [520, 55, 630])
	assert.deepEqual(
		leader.waypoints.map((p) => [p.x, p.y, p.z, p.orientation, p.waitMs]),
		[
			[540, 52, 630, 0, 0],
			[540, 54, 650, 2, 1000],
		],
	)
	assert.equal(leader.pathFromTemplate, false, "a pasted creature walks its own copy of the template's path")
	assert.deepEqual(leader.events, [], 'a new spawn belongs to no world event')
	assert.equal(leader.leader, 9000)
	assert.equal(follower.leader, 9000)
	assert.deepEqual([follower.followDist, follower.followAngle], [3, 0.5])
	assert.equal(stray.leader, 0)
	assert.equal(veinA.pool, 500)
	assert.equal(veinB.pool, 500)
	assert.equal(veinA.poolLimit, 1)
	assert.equal(veinA.poolName, 'Copper veins')
	assert.equal(veinC.pool, 0)
	// The source spawns are untouched.
	assert.deepEqual([src[0].guid, src[0].x, src[0].leader, src[0].waypoints[0].x], [10, 120, 10, 140])
})

test('a spawn off the map is left out, and a leader without its followers stops leading', () => {
	const { spawns } = copySpawns(camp(), inArea, flat(10), 100, 100)
	// The leader stands at (20, 30) of the clip and its follower at x 17, off a map that starts at x 18.
	const ground: SpawnGround = { contains: (x, z) => x >= 18 && x <= 35 && z >= 0 && z <= 35, heightAt: () => 0 }
	const out = pasteSpawns(spawns.slice(0, 2), 0, 0, ground, ids())
	assert.equal(out.length, 1)
	assert.equal(out[0].leader, 0)
	// Its second point (x 40) is off this map: it keeps its height above the creature.
	assert.equal(out[0].waypoints[1].y, out[0].y + 4)
})

test('a turned paste turns the spawns, their paths and facings, and keeps followers in their slots', () => {
	const { spawns } = copySpawns(camp(), inArea, flat(10), 100, 100)
	const W = 100
	const r = rotateClipSpawns(spawns, W)
	const out = pasteSpawns(r, 0, 0, flat(0), ids())
	const [leader, follower] = out
	// (20, 30) lands at (30, W - 20).
	assert.deepEqual([leader.x, leader.z], [30, 80])
	nearNum(leader.orientation, 1 + Math.PI / 2)
	assert.deepEqual([leader.waypoints[0].x, leader.waypoints[0].z], [30, 60])
	assert.equal(leader.waypoints[0].orientation, 0, 'a point with no facing keeps none')
	nearNum(leader.waypoints[1].orientation, 2 + Math.PI / 2)
	const slot = slotPosition(leader, follower.followDist, follower.followAngle, { x: 0, z: 0 })
	nearNum(slot.x, follower.x)
	nearNum(slot.z, follower.z)
	// Four turns bring it back.
	const back = rotateClipSpawns(rotateClipSpawns(rotateClipSpawns(r, W), W), W)
	nearNum(back[0].s.x, spawns[0].s.x)
	nearNum(back[0].s.z, spawns[0].s.z)
	nearNum(back[0].s.orientation, spawns[0].s.orientation)
})

test('a mirrored paste keeps followers in their slots, and flips a tilted object', () => {
	const src = [...camp(), spawn({ kind: 'object', guid: 50, x: 180, z: 120, orientation: 0.3, tilt: [0.1, 0.2, 0.3, 0.9] })]
	const { spawns } = copySpawns(src, inArea, flat(10), 100, 100)
	for (const axis of ['x', 'z'] as const) {
		const m = mirrorClipSpawns(spawns, axis, 100, 100)
		const out = pasteSpawns(m, 0, 0, flat(0), ids())
		const [leader, follower] = out
		const slot = slotPosition(leader, follower.followDist, follower.followAngle, { x: 0, z: 0 })
		nearNum(slot.x, follower.x)
		nearNum(slot.z, follower.z)
		if (axis === 'x') assert.deepEqual([leader.x, leader.z, leader.waypoints[0].x], [80, 30, 60])
		else assert.deepEqual([leader.x, leader.z, leader.waypoints[0].z], [20, 70, 70])
		assert.deepEqual(out[out.length - 1].tilt, [-0.1, 0.2, -0.3, 0.9])
	}
})

test('turning and mirroring an area clip turns its spawns with it', () => {
	const { spawns } = copySpawns(camp(), inArea, flat(10), 100, 100)
	const w = 50
	const clip: MapClip = { w, h: w, heights: new Float32Array((w + 1) * (w + 1)), holes: new Uint8Array(w * w), weights: new Uint8Array(0), slots: new Uint8Array(0), palette: [], objects: [], spawns }
	const r = rotateClip(clip, 2)
	assert.deepEqual([r.spawns![0].s.x, r.spawns![0].s.z], [30, 80])
	const m = mirrorClip(clip, 'x', 2)
	assert.deepEqual([m.spawns![0].s.x, m.spawns![0].s.z], [80, 30])
})

test('the pasted spawns are added as one undo step, as new spawns to save', () => {
	const layer = new SpawnLayer()
	layer.set([spawn({ guid: 10, x: 120, z: 130 })])
	const { spawns } = copySpawns(camp(), inArea, flat(10), 100, 100)
	const list = pasteSpawns(spawns, 0, 0, flat(0), ids())
	list[1].standState = 1
	const cmd = spawnsAdd(layer, list, 'Paste', pastedOriginal)
	assert.equal(layer.spawns.length, 7)
	const edits = layer.edits()
	assert.equal(edits.length, 6)
	assert.ok(edits.every((e) => e.created && !e.deleted))
	// Each is saved against a bare placement, so its formation, pool, path and pose are written.
	const lead = edits.find((e) => e.spawn.guid === 9000)!
	assert.deepEqual([lead.original!.leader, lead.original!.waypoints.length, lead.spawn.leader, lead.spawn.waypoints.length], [0, 0, 9000, 2])
	const sitting = edits.find((e) => e.spawn.guid === 9001)!
	assert.deepEqual([sitting.original!.standState, sitting.original!.sheathState, sitting.spawn.standState], [0, 1, 1])
	const vein = edits.find((e) => e.spawn.kind === 'object' && e.spawn.pool)!
	assert.deepEqual([vein.original!.pool, vein.spawn.pool], [0, 500])
	cmd.undo()
	assert.equal(layer.spawns.length, 1)
	assert.equal(layer.edits().length, 0)
	cmd.redo()
	assert.equal(layer.spawns.length, 7)
	assert.equal(layer.get('monster/9000')?.leader, 9000)
})

test("a pasted creature saves the display and equipment it had of its own, and leaves its template's to the template (#972)", () => {
	const own = pastedOriginal(spawn({ display: 99, equipment: 7, ownDisplay: true, ownEquipment: true }))
	assert.deepEqual([own.display, own.equipment], [0, -1])
	const template = pastedOriginal(spawn({ display: 880, equipment: 3 }))
	assert.deepEqual([template.display, template.equipment], [880, 3])
	const obj = pastedOriginal(spawn({ kind: 'object', display: 12, ownDisplay: true }))
	assert.equal(obj.display, 12)

	// Saving the creature's template keeps the pasted display as an edit.
	const layer = new SpawnLayer()
	const s = spawn({ guid: 9000, display: 99, equipment: 7, ownDisplay: true, ownEquipment: true })
	layer.add(s, pastedOriginal(s))
	layer.rebase(s, { name: 'Defias Bandit', display: 99, equipment: 7 })
	const e = layer.edits().find((x) => x.spawn.guid === 9000)!
	assert.deepEqual([e.original!.name, e.original!.display, e.original!.equipment, e.spawn.display], ['Defias Bandit', 0, -1, 99])
})
