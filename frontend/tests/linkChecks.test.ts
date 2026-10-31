// Run with: bun test tests/linkChecks.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { checkFlights, checkPortals, FAR_STOP, type LinkMap, type LinkReport } from '../src/lib/check/links.ts'
import { toServer } from '../src/lib/wow/format.ts'
import type { vmangos } from '../src/lib/wails/models'

// The map's frame: a region whose first tile is 30, 40.
const FRAME = { tileX: 30, tileY: 40 }

/** A stop at editor (x, z), height y. */
const stop = (id: number, x: number, z: number, over: Partial<vmangos.LinkNode> = {}): vmangos.LinkNode => {
	const s = toServer(x, z, FRAME.tileX, FRAME.tileY)
	return { id, mapId: 0, x: s.x, y: s.y, z: 10, name: `Stop ${id}`, hordeMount: 2224, allianceMount: 541, from: 1, to: 1, network: true, ...over }
}

const report = (over: Partial<LinkReport> = {}): LinkReport => ({ checked: true, nodes: [], portals: [], error: '', ...over })

const template = (entry: number, name: string, npcFlags = 0): vmangos.WorldTemplate => ({ entry, name, npcFlags, aiName: '', type: -1, values: {}, starts: [], ends: [], ownVendor: false, ownTrainer: false, aiEvents: 0 })

const master = template(1, 'Gryphon Master', 8)
const masterAt = (x: number, z: number) => ({ key: 'c:1', kind: 'creature', entry: 1, x, y: 10, z })

test('flight master: served by its nearest stop for each side, the way the server picks it', () => {
	const near = [stop(5, 100, 100), stop(6, 2000, 2000)]
	assert.deepEqual(checkFlights([masterAt(103, 100)], [master], report({ nodes: near }), FRAME), [])

	// No stop on the map has a mount for either side (a boat's stop, or one only spells fly from).
	const none = checkFlights([masterAt(100, 100)], [master], report({ nodes: [stop(5, 100, 100, { hordeMount: 0, allianceMount: 0 }), stop(6, 50, 50, { network: false })] }), FRAME)
	assert.equal(none.length, 1)
	assert.equal(none[0].severity, 'error')
	assert.match(none[0].message, /Gryphon Master \(creature 1\) is a flight master/)
	assert.deepEqual(none[0].target, { kind: 'spawn', key: 'c:1' })

	// The Horde's nearest stop, a yard away, has no route out; the Alliance's is far, so the master is taken for the Horde's.
	const split = checkFlights([masterAt(100, 100)], [master], report({ nodes: [stop(5, 101, 100, { allianceMount: 0, from: 0 }), stop(6, 100 + FAR_STOP + 50, 100, { hordeMount: 0 })] }), FRAME)
	assert.deepEqual(
		split.map((f) => [f.severity, f.check]),
		[
			['warning', 'Flight masters without flights'],
			['info', 'Flight stops without routes'],
		],
	)
	assert.match(split[0].message, /Horde's nearest flight stop, Stop 5 \(stop 5\) 1 yd away, has no route from it/)

	// Both sides' stops far away: info for each.
	const far = checkFlights([masterAt(0, 0)], [master], report({ nodes: [stop(5, 300, 0, { allianceMount: 0 }), stop(6, 0, 400, { hordeMount: 0 })] }), FRAME)
	assert.deepEqual(
		far.map((f) => f.message),
		[
			"Gryphon Master (creature 1): the Horde's nearest flight stop is Stop 5 (stop 5), 300 yd away, so it offers that stop's flights.",
			"Gryphon Master (creature 1): the Alliance's nearest flight stop is Stop 6 (stop 6), 400 yd away, so it offers that stop's flights.",
		],
	)

	// A creature without the flag isn't checked.
	assert.deepEqual(checkFlights([masterAt(100, 100)], [template(1, 'Bob')], report(), FRAME), [])
})

test('flight stops: no route at all is a warning, one way only is info, and a boat stop or a spell flight’s is left out', () => {
	const f = checkFlights(
		[],
		[],
		report({ nodes: [stop(1, 10, 20, { from: 0, to: 0 }), stop(2, 0, 0, { to: 0 }), stop(3, 0, 0, { from: 0, to: 0, hordeMount: 0, allianceMount: 0 }), stop(4, 0, 0), stop(8, 0, 0, { to: 0, network: false })] }),
		FRAME,
	)
	assert.deepEqual(
		f.map((x) => [x.severity, x.message]),
		[
			['warning', 'Flight stop 1 (Stop 1) has no route to or from it.'],
			['info', 'Flight stop 2 (Stop 2) has routes from it but none to it, so no one flies there.'],
		],
	)
	// Go there goes to the stop, in the editor's frame.
	assert.ok(Math.abs(f[0].x - 10) < 1e-6 && Math.abs(f[0].z - 20) < 1e-6)
})

/** The open map: flat ground at 0 over x, z in 0..1000, a hole at 500..510, a floor at 20 over 600..700. */
const MAP: LinkMap = {
	mapId: 0,
	...FRAME,
	contains: (x, z) => x >= 0 && x <= 1000 && z >= 0 && z <= 1000,
	ground: (x) => (x >= 500 && x < 510 ? -Infinity : 0),
	floorBelow: (x, y) => (x >= 600 && x <= 700 && y >= 20 ? 20 : -Infinity),
}

const portal = (dest: { map?: number; x: number; z: number; y: number }, over: Partial<vmangos.PortalLink> = {}): vmangos.PortalLink => {
	const s = toServer(dest.x, dest.z, FRAME.tileX, FRAME.tileY)
	return {
		kind: 'into',
		label: 'Spell 9 (Teleport)',
		trigger: 0,
		entry: 0,
		guid: 0,
		at: [0, 0, 0],
		dest: { map: dest.map ?? 0, x: s.x, y: s.y, z: dest.y, o: 0, level: 0, message: '' },
		mapKnown: true,
		mapName: 'Eastern Kingdoms',
		ground: null,
		inBuilding: false,
		outsideBuilding: false,
		...over,
	}
}

test('portals on the open map: under the ground, in the air, over a hole, and on a model floor', () => {
	const run = (...ps: vmangos.PortalLink[]) => checkPortals([], [], [], report({ portals: ps }), MAP, null)
	assert.deepEqual(run(portal({ x: 100, z: 100, y: 1 })), [])
	assert.deepEqual(run(portal({ x: 100, z: 100, y: -1.5 })), [], 'a yard and a half under is within reach')
	const under = run(portal({ x: 100, z: 100, y: -10 }))
	assert.equal(under.length, 1)
	assert.equal(under[0].severity, 'error')
	assert.match(under[0].message, /^Spell 9 \(Teleport\) lands 10 yd under the ground \(/)
	assert.ok(Math.abs(under[0].x - 100) < 1e-3, 'goes to the target')
	const air = run(portal({ x: 100, z: 100, y: 50 }))
	assert.equal(air[0].severity, 'warning')
	assert.match(air[0].message, /lands 50 yd above the ground .*, so the player falls\./)
	assert.match(run(portal({ x: 505, z: 100, y: 3 }))[0].message, /over a hole with nothing under it/)
	// On a model's floor 20 yd up: fine; 30 yd over it: falls onto the floor.
	assert.deepEqual(run(portal({ x: 650, z: 100, y: 21 })), [])
	assert.match(run(portal({ x: 650, z: 100, y: 50 }))[0].message, /lands 30 yd above the floor/)
	// Off the map's terrain (elsewhere on the continent): not measured.
	assert.deepEqual(run(portal({ x: 5000, z: 100, y: 500 })), [])
	// Two teleports to one target: one finding, counting the other.
	const two = run(portal({ x: 100, z: 100, y: -10 }), portal({ x: 100, z: 100, y: -10 }, { label: 'Area trigger 7' }))
	assert.equal(two.length, 1)
	assert.match(two[0].message, /One more teleport lands there\.$/)
})

test('portals to another map: an unknown map, the client ground there, and a building', () => {
	const run = (...ps: vmangos.PortalLink[]) => checkPortals([{ key: 'o:9', kind: 'object', entry: 9, x: 40, z: 50 }], [], [template(9, 'Portal to Ironforge')], report({ portals: ps }), MAP, null)
	const other = { map: 1, x: 0, z: 0, y: 100 }
	const missing = run(portal(other, { kind: 'object', entry: 9, label: 'Casts Teleport', mapKnown: false }))
	assert.equal(missing[0].severity, 'error')
	assert.equal(missing[0].message, 'Portal to Ironforge (object 9): Casts Teleport sends the player to map 1, which the client has no map for.')
	assert.deepEqual(missing[0].target, { kind: 'spawn', key: 'o:9' }, 'goes to the spawn that sends the player')
	assert.equal(missing[0].x, 40)
	assert.match(run(portal(other, { ground: 60, mapName: 'Kalimdor' }))[0].message, /lands 40 yd above the ground on Kalimdor/)
	assert.equal(run(portal(other, { ground: 120 }))[0].severity, 'error')
	assert.deepEqual(run(portal(other, { ground: 99 })), [])
	assert.deepEqual(run(portal(other, { ground: 20, inBuilding: true })), [], 'a building’s floor is not read')
	assert.deepEqual(run(portal(other)), [], 'no tile there')
	const dungeon = run(portal(other, { mapName: 'The Deadmines', outsideBuilding: true }))
	assert.equal(dungeon[0].severity, 'warning')
	assert.match(dungeon[0].message, /lands outside the building on The Deadmines \(.*\), in the void\.$/)
	// An area trigger on the open map goes to the trigger.
	const s = toServer(300, 400, FRAME.tileX, FRAME.tileY)
	const trig = run(portal(other, { kind: 'trigger', trigger: 7, label: 'Area trigger 7', at: [s.x, s.y, 0], ground: 0 }))
	assert.ok(Math.abs(trig[0].x - 300) < 1e-3 && Math.abs(trig[0].z - 400) < 1e-3)
})
