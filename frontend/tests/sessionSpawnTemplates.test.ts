// Run with: bun test tests/sessionSpawnTemplates.test.ts
// A guest of a shared session places spawns from the templates the session map's rows use (#1050),
// copying the row of an entry that looks most like its template, and reads no world database.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { vmangos } from '../src/lib/wails/models'
import type { MapDocument } from '../src/lib/engine/MapDocument'

const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')
const { History } = await import('../src/lib/state/history.ts')
const { SpawnActions } = await import('../src/lib/engine/SpawnActions.ts')
const { shared } = await import('../src/lib/session/shared.svelte.ts')
const { copyCreatureRow, layerTemplates, lookFromRows, templatesOf } = await import('../src/lib/session/spawnTemplates.ts')
const { editor } = await import('../src/lib/state/editor.svelte.ts')

function row(kind: 'monster' | 'npc' | 'object', guid: number, entry: number, extra: Partial<vmangos.WorldSpawn> = {}): vmangos.WorldSpawn {
	return {
		kind,
		guid,
		entry,
		name: `${kind}${entry}`,
		subname: '',
		levelMin: 5,
		levelMax: 6,
		faction: 7,
		npcFlags: kind === 'npc' ? 1 : 0,
		rank: 0,
		type: 1,
		x: 0,
		y: 0,
		z: 0,
		orientation: 0,
		display: 100 + entry,
		ownDisplay: false,
		ownEquipment: false,
		// No model, so the layer loads none in the test.
		model: '',
		look: `skin=${entry}`,
		anim: 0,
		scale: 2,
		displayScale: 2,
		equipment: 0,
		equipItems: [0, 0, 0],
		standState: 0,
		emoteState: 0,
		sheathState: kind === 'object' ? 0 : 1,
		waypoints: [],
		leader: 0,
		pool: 0,
		motherPool: 0,
		...extra,
	} as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

test("a session map's templates are one per entry, from the row nearest its template's look", () => {
	const sitting = row('monster', 1, 50, { standState: 1, anim: 97, look: 'sit' })
	const own = row('monster', 2, 50, { ownDisplay: true, display: 999, look: 'own' })
	const plain = row('monster', 9, 50)
	const t = templatesOf([sitting, own, plain, row('npc', 3, 60), row('object', 4, 70, { scale: 1.5 }), row('object', 5, 70)])
	assert.deepEqual(
		t.creatures.map((c) => c.entry),
		[50, 60],
	)
	assert.equal(t.creatureRow.get(50), plain)
	assert.equal(t.creatures[0].look, 'skin=50')
	// The template's part of the size: the row's scale over its display's.
	assert.equal(t.creatures[0].scale, 1)
	assert.equal(t.creatures[1].npcFlags, 1)
	// Objects: the lowest guid's row, its size the row's scale.
	assert.deepEqual(t.objects, [{ entry: 70, name: 'object70', type: 1, display: 170, size: 1.5, model: '' }])
	// With only a sitting row and one of its own display, the sitting one is nearer the template.
	assert.equal(templatesOf([own, sitting]).creatureRow.get(50), sitting)
})

test('a copy of a row keeps its look, its own display and its pose, under a new guid', () => {
	const r = row('monster', 1, 50, { ownDisplay: true, display: 999, standState: 1, anim: 97, equipItems: [11, 0, 0], ownEquipment: true, equipment: 3 })
	const n = copyCreatureRow(r, 77, 1, 2, 3, 0.5)
	assert.equal(n.guid, 77)
	assert.deepEqual([n.x, n.y, n.z, n.orientation], [1, 2, 3, 0.5])
	assert.deepEqual([n.display, n.ownDisplay, n.equipment, n.ownEquipment, n.standState, n.anim, n.look, n.scale], [999, true, 3, true, 1, 97, 'skin=50', 2])
	assert.deepEqual(n.equipItems, [11, 0, 0])
	assert.notEqual(n.equipItems, r.equipItems)
	assert.deepEqual([n.waypoints.length, n.pool, n.leader], [0, 0, 0])
})

test("a layer's templates are built again only when its spawns changed", () => {
	const layer = new SpawnLayer()
	layer.set([row('monster', 1, 50)])
	const a = layerTemplates(layer)
	assert.equal(layerTemplates(layer), a)
	layer.add(row('monster', 2, 51))
	const b = layerTemplates(layer)
	assert.notEqual(b, a)
	assert.deepEqual(
		b.creatures.map((c) => c.entry),
		[50, 51],
	)
})

test("a guest places a template its session map uses as a copy of the map's row, with no database read", async () => {
	const spawnLayer = new SpawnLayer()
	spawnLayer.set([row('monster', 10, 50, { look: 'wolf' }), row('object', 20, 70)])
	const doc = { id: 3, spawnLayer, history: new History() }
	const actions = new SpawnActions({
		documents: [doc] as unknown as MapDocument[],
		doc: doc as unknown as MapDocument,
		cameraPos: new THREE.Vector3(10, 0, 0),
		menuSeq: 0,
		focus: () => {},
		deselect: () => {},
		teleport: () => {},
	})
	// The bindings would throw if read: a guest has no server.
	const go = ((globalThis as Record<string, unknown>).window = { go: { main: { App: new Proxy({}, { get: () => () => Promise.reject(new Error('no server')) }) } } })
	shared.role = 'guest'
	shared.docId = 3
	try {
		actions.setLane(2, 16, { creature: 1000, object: 2000, pool: 300 })
		const t = templatesOf(spawnLayer.spawns)
		await actions.placeCreature(t.creatures[0], new THREE.Vector3(1, 2, 3))
		const placed = editor.selectedSpawn!
		assert.equal(placed.entry, 50)
		assert.equal(placed.look, 'wolf')
		assert.equal(placed.guid % 16, 2)
		assert.ok(placed.guid >= 1000)
		assert.ok(spawnLayer.get(`monster/${placed.guid}`))
		await actions.placeObject(t.objects[0], new THREE.Vector3(1, 2, 3))
		assert.equal(editor.selectedSpawn!.entry, 70)
		assert.ok(editor.selectedSpawn!.guid >= 2000)
		// The spawn brush dresses from the row too, and leaves out an entry the map has none of.
		const entry = { entry: 50, name: 'Wolf', subname: '', levelMin: 1, levelMax: 1, faction: 0, npcFlags: 0, rank: 0, type: 1, display: 150, scale: 1, equipment: 0, weight: 1 }
		assert.equal(actions.brushLook(entry)?.look, 'wolf')
		assert.equal(actions.brushCreature(entry, 0, 0, 0, 0)?.look, 'wolf')
		assert.equal(actions.brushCreature({ ...entry, entry: 51 }, 0, 0, 0, 0), null)
		// A template the map has none of is not placed.
		const before = spawnLayer.spawns.length
		await actions.placeCreature({ ...t.creatures[0], entry: 51 }, new THREE.Vector3())
		assert.equal(spawnLayer.spawns.length, before)
	} finally {
		// A selected spawn left behind would be looked up in the next test's layers, and dropped with their pick.
		editor.selectedSpawn = null
		shared.role = ''
		shared.docId = 0
		void go
		delete (globalThis as Record<string, unknown>).window
	}
})

test("a guest dresses a spawn from the session map's rows: the look of one with the same display, equipment and weapons, the animation of one in the same pose", () => {
	const rows = [
		row('monster', 1, 50, { look: 'wolf', displayScale: 1.5 }),
		row('monster', 2, 60, { display: 300, ownDisplay: true, equipment: 4, ownEquipment: true, sheathState: 0, look: 'armed', model: 'm' }),
		row('monster', 3, 60, { emoteState: 10, anim: 69 }),
	]
	assert.deepEqual(lookFromRows(rows, 50, 150, 0, 0, 0, 1), { model: '', look: 'wolf', anim: 0, displayScale: 1.5 })
	// Display 0 is the template's, from a row of the entry without one of its own; a stand state has its own loop.
	assert.deepEqual(lookFromRows(rows, 50, 0, 0, 3, 0, 1), { model: '', look: 'wolf', anim: 100, displayScale: 1.5 })
	// An emote comes from a row playing it.
	assert.equal(lookFromRows(rows, 60, 300, 4, 0, 10, 0).anim, 69)
	assert.equal(lookFromRows(rows, 60, 300, 4, 0, 0, 0).look, 'armed')
	assert.throws(() => lookFromRows(rows, 50, 150, 0, 0, 0, 2), /display, equipment and weapons/)
	assert.throws(() => lookFromRows(rows, 50, 999, 0, 0, 0, 1), /display, equipment and weapons/)
	assert.throws(() => lookFromRows(rows, 50, 150, 0, 0, 11, 1), /emote/)
})

test("a guest's spawn edit of a pose is dressed from the map's rows, with no database read", async () => {
	const spawnLayer = new SpawnLayer()
	spawnLayer.set([row('monster', 10, 50, { look: 'wolf' }), row('monster', 11, 50, { look: 'wolf', standState: 1, anim: 97 })])
	const doc = { id: 3, spawnLayer, history: new History() }
	const actions = new SpawnActions({
		documents: [doc] as unknown as MapDocument[],
		doc: doc as unknown as MapDocument,
		cameraPos: new THREE.Vector3(),
		menuSeq: 0,
		focus: () => {},
		deselect: () => {},
		teleport: () => {},
	})
	const asked: string[] = []
	;(globalThis as Record<string, unknown>).window = { go: { main: { App: new Proxy({}, { get: (_, n) => () => (asked.push(String(n)), Promise.reject(new Error('no server'))) }) } } }
	shared.role = 'guest'
	shared.docId = 3
	try {
		await actions.editSpawn('monster/10', { standState: 3 }, 'Stand state')
		const s = spawnLayer.get('monster/10')!
		assert.deepEqual([s.standState, s.anim, s.look], [3, 100, 'wolf'])
		// A display no row has is refused, and the spawn is left as it was.
		await actions.editSpawn('monster/10', { display: 999 }, 'Display')
		assert.equal(spawnLayer.get('monster/10')!.display, 150)
		assert.deepEqual(asked, [])
	} finally {
		editor.selectedSpawn = null
		shared.role = ''
		shared.docId = 0
		delete (globalThis as Record<string, unknown>).window
	}
})
