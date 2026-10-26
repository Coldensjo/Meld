// Run with: bun test tests/spawnActions.test.ts
// The spawn actions out of Engine (#557): the guid and pool entry a new spawn or pool gets, above
// every open tab's, and a few of the actions that need no Go binding, on a fake host.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { vmangos } from '../wailsjs/go/models'
import type { MapDocument } from '../src/lib/engine/MapDocument'

const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')
const { History } = await import('../src/lib/state/history.ts')
const { SpawnActions, nextFreeGuid, nextFreePoolEntry } = await import('../src/lib/engine/SpawnActions.ts')
const { editor, ui } = await import('../src/lib/state/editor.svelte.ts')

function spawn(kind: 'monster' | 'npc' | 'object', guid: number, pool = 0): vmangos.WorldSpawn {
	return vmangos.WorldSpawn.createFrom({ kind, guid, entry: 100 + guid, name: `${kind}${guid}`, x: 0, y: 0, z: 0, orientation: 0, model: '', waypoints: [], leader: 0, pool, motherPool: 0 })
}

/** A tab holding `rows`: what SpawnActions reads of a MapDocument. */
function tab(rows: vmangos.WorldSpawn[]) {
	const spawnLayer = new SpawnLayer()
	spawnLayer.set(rows)
	return { spawnLayer, history: new History() }
}

function host(docs: ReturnType<typeof tab>[]) {
	const documents = docs as unknown as MapDocument[]
	return {
		documents,
		doc: documents[0],
		cameraPos: new THREE.Vector3(),
		menuSeq: 0,
		focus: () => {},
		deselect: () => {},
		teleport: () => {},
	}
}

test("a new guid is above every open tab's spawns of its kind and at least the floor", () => {
	const docs = [tab([spawn('monster', 7), spawn('object', 40)]), tab([spawn('npc', 12), spawn('object', 3)])]
	// Monsters and NPCs share creature guids; objects have their own.
	assert.equal(nextFreeGuid(docs, 'creature', 0), 13)
	assert.equal(nextFreeGuid(docs, 'object', 0), 41)
	// The database's next guid wins when it is higher.
	assert.equal(nextFreeGuid(docs, 'creature', 500), 500)
	assert.equal(nextFreeGuid([], 'object', 9), 9)
})

test("a new pool entry is above every pool an open tab's spawn is in, of either kind", () => {
	const docs = [tab([spawn('monster', 1, 30), spawn('object', 2, 0)]), tab([spawn('object', 3, 45)])]
	assert.equal(nextFreePoolEntry(docs, 10), 46)
	assert.equal(nextFreePoolEntry(docs, 100), 100)
})

test('picking spawns into a pool joins and leaves it, one undo step each', () => {
	const a = spawn('monster', 1, 30)
	const b = spawn('monster', 2)
	const t = tab([a, b])
	const actions = new SpawnActions(host([t]))
	ui.spawnPick = { mode: 'pool', key: 'monster/1' }
	actions.pickSpawn(t.spawnLayer.get('monster/2')!)
	assert.equal(t.spawnLayer.get('monster/2')!.pool, 30)
	actions.pickSpawn(t.spawnLayer.get('monster/2')!)
	assert.equal(t.spawnLayer.get('monster/2')!.pool, 0)
	t.history.undo()
	assert.equal(t.spawnLayer.get('monster/2')!.pool, 30)
	// A click on the picked spawn itself does nothing, and the picking goes on.
	actions.pickSpawn(t.spawnLayer.get('monster/1')!)
	assert.deepEqual(ui.spawnPick, { mode: 'pool', key: 'monster/1' })
	ui.spawnPick = null
})

/** A key press as handleKey reads it (bun has no KeyboardEvent). */
const key = (k: string) => ({ key: k, altKey: false, shiftKey: false }) as KeyboardEvent

test('the spawn keys: Esc stops placing, Delete removes the selected spawn undoably', () => {
	const t = tab([spawn('object', 5)])
	const actions = new SpawnActions(host([t]))
	ui.placeObject = vmangos.ObjectTemplate.createFrom({ entry: 1, name: 'Chair' })
	assert.equal(actions.handleKey(key('Escape')), true)
	assert.equal(ui.placeObject, null)
	editor.tool = 'select'
	editor.selectedIds = []
	editor.selectedSpawn = t.spawnLayer.get('object/5')!
	assert.equal(actions.handleKey(key('Delete')), true)
	assert.equal(t.spawnLayer.get('object/5'), undefined)
	t.history.undo()
	assert.ok(t.spawnLayer.get('object/5'))
	editor.selectedSpawn = null
})

test("a spawn's right-click menu selects it and lists its actions, Focus before Unselect", () => {
	const t = tab([spawn('monster', 8), spawn('object', 9)])
	const focused: number[][] = []
	const actions = new SpawnActions({ ...host([t]), focus: (x, z, d) => focused.push([x, z, d]) })
	editor.tool = 'paint'
	const m = actions.menu(t.spawnLayer.get('monster/8')!)
	assert.equal(editor.tool, 'select')
	assert.equal(editor.selectedSpawn?.guid, 8)
	assert.equal(m.title, 'monster8 (creature 108, invisible in the game)')
	assert.deepEqual(
		m.items.map((i) => ('label' in i ? i.label : '-')),
		['Edit creature…', 'Give it a path', 'Focus', 'Unselect', '-', 'Copy creature entry 108', 'Copy spawn guid 8', 'Copy name', '-', 'Delete spawn'],
	)
	m.items.find((i) => 'label' in i && i.label === 'Focus')!.run!()
	assert.deepEqual(focused, [[0, 0, 40]])
	const o = actions.menu(t.spawnLayer.get('object/9')!)
	assert.equal(o.items[0] && 'label' in o.items[0] ? o.items[0].label : '', 'Edit object…')
	o.items.find((i) => 'label' in i && i.label === 'Delete spawn')!.run!()
	assert.equal(t.spawnLayer.get('object/9'), undefined)
	editor.selectedSpawn = null
})
