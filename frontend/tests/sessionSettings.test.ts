// Run with: bun test tests/sessionSettings.test.ts
// The session map's settings in a shared session (lib/session/settings.ts, #1019): two members change the
// sea, the roles, the ground effects, the paths and Map Properties' facts and tiles through a scripted host
// that numbers every message and delivers it to everyone, the sender too, when the test says; each member
// must end with what applying the messages in the host's order gives.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { KIND_SETTINGS, SettingsSync, readSettings, writeSettings, type SettingsData, type SettingsStore } from '../src/lib/session/settings.ts'
import { NO_ROLE } from '../src/lib/terrain/roles.ts'
import { noScopedEffects } from '../src/lib/world/groundEffects.ts'
import { newPath } from '../src/lib/terrain/paths.ts'
import type { VmangosRef } from '../src/lib/engine/MapDocument.ts'
import { newBiome, type Biome } from '../src/lib/terrain/biome.ts'

/** A member's map: the store `editor` or a document's meta would be, its client ref, and the tile masks the terrain was given. */
class Map1 {
	store: SettingsStore
	vmangos: VmangosRef | null
	masks: string[] = []
	/** The map's biomes (`editor.mapBiomes` or a document's `meta.biomes`). */
	biomes: Biome[] = []
	constructor(palette = ['a.blp', 'b.blp', 'c.blp'], vmangos: VmangosRef | null = { dir: 'Probe', mapId: 900 }) {
		this.store = { palette, waterLevel: 0, waterEnabled: false, roles: { rock: NO_ROLE, dirt: NO_ROLE }, textureEffects: {}, textureLooks: {}, scopedEffects: noScopedEffects(), paths: [] }
		this.vmangos = vmangos ? { ...vmangos } : null
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: SettingsData
}

class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, map: Map1) {
		this.inbox.set(id, [])
		const sends: SettingsData[] = []
		let applied = 0
		const sync = new SettingsSync({
			read: () => readSettings(map.store, map.vmangos, map.biomes),
			write: (set) =>
				writeSettings(
					map.store,
					map.vmangos,
					set,
					(t) => map.masks.push(t),
					(b) => (map.biomes = b),
				),
			send: async (data) => {
				sends.push(data)
				const m = { seq: ++this.seq, from: id, kind: KIND_SETTINGS, data: JSON.parse(JSON.stringify(data)) as SettingsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
			applied: () => applied++,
		})
		sync.bind(map, 0)
		return {
			id,
			map,
			sync,
			sends,
			get applied() {
				return applied
			},
		}
	}
	deliver(m: { id: number; sync: SettingsSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

test('a changed field goes out whole, the other member takes it and sends nothing back', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	a.map.store.waterLevel = 12
	a.map.store.waterEnabled = true
	a.map.store.textureEffects = { 'b.blp': 44 }
	a.sync.flush()
	assert.equal(a.sends.length, 1)
	assert.deepEqual(Object.keys(a.sends[0].set).sort(), ['textureEffects', 'waterEnabled', 'waterLevel'])
	// Nothing changed since: no second message.
	a.sync.flush()
	assert.equal(a.sends.length, 1)
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.sync.unacknowledged, 0)
	assert.equal(b.map.store.waterLevel, 12)
	assert.equal(b.map.store.waterEnabled, true)
	assert.deepEqual(b.map.store.textureEffects, { 'b.blp': 44 })
	assert.equal(b.applied, 1)
	b.sync.flush()
	assert.equal(b.sends.length, 0, 'the apply is not sent back')
})

test('two members changing one field at once both end with the later message in the host order', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	b.map.store.waterLevel = 5
	b.sync.flush()
	a.map.store.waterLevel = 7
	a.sync.flush()
	// The host's order: b's 5, then a's 7. A gets b's while its own 7 is unacknowledged and keeps it.
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.map.store.waterLevel, 7)
	assert.equal(b.map.store.waterLevel, 7)
	assert.equal(a.applied, 0)
})

test('different fields changed at once both land on both members', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	a.map.store.waterEnabled = true
	a.sync.flush()
	b.map.store.waterLevel = -3
	b.map.store.textureLooks = { 'c.blp': 3 }
	b.sync.flush()
	host.deliver(a)
	host.deliver(b)
	for (const m of [a, b]) {
		assert.equal(m.map.store.waterEnabled, true)
		assert.equal(m.map.store.waterLevel, -3)
		assert.deepEqual(m.map.store.textureLooks, { 'c.blp': 3 })
	}
})

test('a change not yet sent when another arrives goes out first and stays over it', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	b.map.store.scopedEffects = { zones: { '12': { 'a.blp': 9 } }, tiles: {} }
	b.sync.flush()
	// A's edit is not flushed yet when b's arrives: the apply sends it first, so it comes after b's in the order.
	a.map.store.scopedEffects = { zones: {}, tiles: { '1,2': { 'b.blp': 4 } } }
	host.deliver(a)
	assert.equal(a.sends.length, 1)
	assert.deepEqual(a.map.store.scopedEffects, { zones: {}, tiles: { '1,2': { 'b.blp': 4 } } })
	host.deliver(a)
	host.deliver(b)
	assert.deepEqual(b.map.store.scopedEffects, a.map.store.scopedEffects)
})

test('roles go by texture path, so members whose palettes differ name the same textures', () => {
	const host = new Host()
	const a = host.member(1, new Map1(['a.blp', 'b.blp', 'c.blp']))
	const b = host.member(2, new Map1(['a.blp', 'C.blp', 'b.blp']))
	a.map.store.roles = { rock: 2, dirt: 1 }
	a.sync.flush()
	host.deliver(b)
	assert.deepEqual(b.map.store.roles, { rock: 1, dirt: 2 })
	// A texture b lacks is no role there, and that is not sent back.
	a.map.store.palette = [...a.map.store.palette, 'd.blp']
	a.map.store.roles = { rock: 3, dirt: 1 }
	a.sync.flush()
	host.deliver(b)
	assert.deepEqual(b.map.store.roles, { rock: NO_ROLE, dirt: 2 })
	b.sync.flush()
	assert.equal(b.sends.length, 0)
})

test("Map Properties' facts and tile mask reach the other member's client ref and terrain", () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	a.map.vmangos!.info = { type: 1, name: 'Probe Keep', areaId: 0, loadingScreen: 0, maxPlayers: 5, resetDelay: 0, ghostMap: -1, ghostX: 0, ghostY: 0 }
	a.map.vmangos!.tiles = '1101'
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.map.vmangos!.info?.name, 'Probe Keep')
	assert.equal(b.map.vmangos!.tiles, '1101')
	assert.deepEqual(b.map.masks, ['1101'])
	// Every tile again (an undo): the mask goes away.
	delete a.map.vmangos!.tiles
	delete a.map.vmangos!.info
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.map.vmangos!.tiles, undefined)
	assert.equal(b.map.vmangos!.info, undefined)
	assert.deepEqual(b.map.masks, ['1101', ''])
})

test('an undo syncs like any edit, and the paths go as the whole list', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	const p = newPath([], 'road', 'b.blp')
	p.points.push({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })
	a.map.store.paths = [p]
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.map.store.paths.length, 1)
	assert.deepEqual(b.map.store.paths[0].points, p.points)
	assert.notEqual(b.map.store.paths[0], p)
	a.map.store.paths = []
	a.sync.flush()
	host.deliver(b)
	assert.deepEqual(b.map.store.paths, [])
})

test('a message that does not fit is skipped, and a field this map lacks is not written', () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1(undefined, null))
	b.sync.receive(++host.seq, 1, { id: 1, set: { waterLevel: 'deep', waterEnabled: 3, roles: null, paths: 'x', tiles: '12' } }, 2)
	assert.equal(b.map.store.waterLevel, 0)
	assert.equal(b.applied, 0)
	a.map.vmangos!.tiles = '0111'
	a.map.store.waterLevel = 2
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.map.store.waterLevel, 2)
	assert.equal(b.map.vmangos, null)
	assert.deepEqual(b.map.masks, [])
})

test('a guest holds the messages before its map and applies those after the handoff', () => {
	const map = new Map1()
	const s = new SettingsSync({ read: () => readSettings(map.store, map.vmangos), write: (set) => writeSettings(map.store, map.vmangos, set, () => {}), send: async () => undefined })
	s.wait()
	s.receive(3, 1, { id: 1, set: { waterLevel: 4 } }, 2)
	s.receive(5, 1, { id: 2, set: { waterEnabled: true } }, 2)
	s.bind(map, 3)
	assert.equal(map.store.waterLevel, 0, 'the handoff already held seq 3')
	assert.equal(map.store.waterEnabled, true)
})

test("the map's biomes go as the whole list, checked, and a list that isn't biomes is skipped (#1036)", () => {
	const host = new Host()
	const a = host.member(1, new Map1())
	const b = host.member(2, new Map1())
	a.map.biomes = [newBiome('Forest', ['a.blp']), newBiome('Desert', ['c.blp'])]
	a.sync.flush()
	assert.deepEqual(Object.keys(a.sends[0].set), ['biomes'])
	host.deliver(b)
	host.deliver(a)
	assert.deepEqual(b.map.biomes, a.map.biomes)
	assert.notEqual(b.map.biomes[0], a.map.biomes[0])
	// The apply is not sent back.
	b.sync.flush()
	assert.equal(b.sends.length, 0)
	// A list that doesn't hold biomes is not written.
	b.sync.receive(++host.seq, 3, { id: 1, set: { biomes: [{ name: 7 }] } }, 2)
	assert.equal(b.map.biomes.length, 2)
	assert.equal(b.applied, 1)
})
