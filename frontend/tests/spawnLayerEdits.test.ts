// Run with: bun test tests/spawnLayerEdits.test.ts
// The spawn save's edit list (SpawnLayer.edits, built through spawnEdits.ts's commands): one edit per
// spawn, and a DELETE only for a row the document loaded or saved, keyed by that row's own guid and
// entry, never a created spawn's or another entry's row (#199, #432).
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { vmangos } from '../wailsjs/go/models'
import type { Command } from '../src/lib/state/history'

const { SpawnLayer, spawnKey } = await import('../src/lib/world/SpawnLayer.ts')
const { spawnAdd, spawnChange, spawnDelete } = await import('../src/lib/world/spawnEdits.ts')

type Kind = 'monster' | 'object'

function spawn(kind: Kind, guid: number, entry: number, x = 0): vmangos.WorldSpawn {
	return vmangos.WorldSpawn.createFrom({
		kind,
		guid,
		entry,
		name: `t${entry}`,
		x,
		y: 0,
		z: 0,
		orientation: 0,
		model: '',
		waypoints: [],
		leader: 0,
		pool: 0,
		motherPool: 0,
	})
}

/** A layer holding `rows` as the world database's spawns. */
function loaded(rows: vmangos.WorldSpawn[]) {
	const layer = new SpawnLayer()
	layer.set(rows)
	return layer
}

const editsOf = (layer: InstanceType<typeof SpawnLayer>) => layer.edits().map((e) => ({ key: spawnKey(e.spawn), guid: e.spawn.guid, entry: e.spawn.entry, created: e.created, deleted: e.deleted }))

test('moving a loaded spawn twice gives one update; setting it back gives none', () => {
	const layer = loaded([spawn('monster', 10, 100, 1)])
	spawnChange(layer, 'monster/10', { x: 5 }, 'Move')
	spawnChange(layer, 'monster/10', { x: 7 }, 'Move')
	assert.deepEqual(editsOf(layer), [{ key: 'monster/10', guid: 10, entry: 100, created: false, deleted: false }])
	spawnChange(layer, 'monster/10', { x: 1 }, 'Move')
	assert.deepEqual(editsOf(layer), [])
})

test('a created spawn deleted before the save writes nothing, and no delete at all', () => {
	const layer = loaded([spawn('monster', 10, 100)])
	spawnAdd(layer, spawn('monster', 11, 200), 'Add')
	spawnChange(layer, 'monster/11', { x: 3 }, 'Move')
	assert.deepEqual(editsOf(layer), [{ key: 'monster/11', guid: 11, entry: 200, created: true, deleted: false }])
	spawnDelete(layer, 'monster/11', 'Delete')
	assert.deepEqual(editsOf(layer), [])
})

test('a retyped then deleted loaded spawn deletes its row by the entry the database has', () => {
	const layer = loaded([spawn('object', 10, 100)])
	spawnChange(layer, 'object/10', { entry: 300, name: 't300' }, 'Retype')
	spawnDelete(layer, 'object/10', 'Delete')
	assert.deepEqual(editsOf(layer), [{ key: 'object/10', guid: 10, entry: 100, created: false, deleted: true }])
})

test('a delete undone gives no edit; a created spawn saved then deleted deletes its own row', () => {
	const layer = loaded([spawn('monster', 10, 100)])
	spawnDelete(layer, 'monster/10', 'Delete')!.undo()
	assert.deepEqual(editsOf(layer), [])
	spawnAdd(layer, spawn('monster', 11, 200), 'Add')
	layer.markSaved()
	spawnChange(layer, 'monster/11', { entry: 201, name: 't201' }, 'Retype')
	spawnDelete(layer, 'monster/11', 'Delete')
	assert.deepEqual(editsOf(layer), [{ key: 'monster/11', guid: 11, entry: 200, created: false, deleted: true }])
})

test('a creature and a game object with the same guid are separate rows', () => {
	const layer = loaded([spawn('monster', 10, 100), spawn('object', 10, 500)])
	spawnDelete(layer, 'object/10', 'Delete')
	assert.deepEqual(editsOf(layer), [{ key: 'object/10', guid: 10, entry: 500, created: false, deleted: true }])
})

/** A small seeded generator (mulberry32), so a failing sequence can be run again. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

type Row = { entry: number; x: number }

/**
 * Applies the edits to the database as the Go side writes them, asserting each one's rules: a create
 * names a free row, an update or delete an existing row with the entry it has.
 */
function save(db: Map<string, Row>, edits: vmangos.SpawnEdit[], where: string) {
	const seen = new Set<string>()
	for (const e of edits) {
		const key = spawnKey(e.spawn)
		assert.ok(!seen.has(key), `${where}: two edits for ${key}`)
		seen.add(key)
		const row = db.get(key)
		if (e.created) {
			assert.ok(!e.deleted, `${where}: ${key} created and deleted`)
			assert.equal(row, undefined, `${where}: created ${key} names a row the database has`)
			db.set(key, { entry: e.spawn.entry, x: e.spawn.x })
			continue
		}
		assert.ok(row, `${where}: ${e.deleted ? 'delete' : 'update'} of ${key}, a row the document never loaded or saved`)
		assert.ok(e.original, `${where}: ${key} has no original`)
		assert.equal(e.original.entry, row.entry, `${where}: ${key}'s original entry is not the row's`)
		if (e.deleted) {
			assert.equal(e.spawn.entry, row.entry, `${where}: delete of ${key} names entry ${e.spawn.entry}, the row has ${row.entry}`)
			db.delete(key)
		} else db.set(key, { entry: e.spawn.entry, x: e.spawn.x })
	}
}

test('random edit sequences: every save leaves the database as the editor shows it', () => {
	for (let seed = 1; seed <= 300; seed++) {
		const r = rng(seed)
		const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
		const db = new Map<string, Row>()
		const rows: vmangos.WorldSpawn[] = []
		for (const kind of ['monster', 'object'] as const) {
			for (let guid = 1; guid <= 4; guid++) {
				const s = spawn(kind, guid, 100 + guid, guid)
				rows.push(s)
				db.set(spawnKey(s), { entry: s.entry, x: s.x })
			}
		}
		const layer = loaded(rows)
		// New guids come from above every guid the database or a region has, as SpawnActions.placeCreature does.
		const next: Record<Kind, number> = { monster: 5, object: 5 }
		const done: Command[] = []
		const undone: Command[] = []
		const push = (c: Command | null) => {
			if (!c) return
			done.push(c)
			undone.length = 0
		}
		const log: string[] = []
		for (let step = 0; step < 40; step++) {
			const live = layer.spawns.map(spawnKey)
			const op = Math.floor(r() * 7)
			if (op === 0 || !live.length) {
				const kind = pick(['monster', 'object'] as const)
				const s = spawn(kind, next[kind]++, 200 + Math.floor(r() * 5), Math.floor(r() * 10))
				log.push(`add ${spawnKey(s)}`)
				push(spawnAdd(layer, s, 'Add'))
			} else if (op === 1) {
				const key = pick(live)
				log.push(`move ${key}`)
				push(spawnChange(layer, key, { x: Math.floor(r() * 10) }, 'Move'))
			} else if (op === 2) {
				const key = pick(live)
				const entry = 100 + Math.floor(r() * 8)
				log.push(`retype ${key} ${entry}`)
				push(spawnChange(layer, key, { entry, name: `t${entry}` }, 'Retype'))
			} else if (op === 3) {
				const key = pick(live)
				log.push(`delete ${key}`)
				push(spawnDelete(layer, key, 'Delete'))
			} else if (op === 4 && done.length) {
				log.push('undo')
				const c = done.pop()!
				c.undo()
				undone.push(c)
			} else if (op === 5 && undone.length) {
				log.push('redo')
				const c = undone.pop()!
				c.redo()
				done.push(c)
			} else if (op === 6) {
				log.push('save')
				save(db, layer.edits(), `seed ${seed}: ${log.join(', ')}`)
				layer.markSaved()
			}
			assert.equal(layer.editCount(), layer.edits().length, `seed ${seed}: ${log.join(', ')}: editCount`)
		}
		const where = `seed ${seed}: ${log.join(', ')}`
		save(db, layer.edits(), where)
		const shown = new Map(layer.spawns.map((s) => [spawnKey(s), { entry: s.entry, x: s.x }]))
		assert.deepEqual(new Map([...db].sort()), new Map([...shown].sort()), `${where}: database and editor differ`)
	}
})
