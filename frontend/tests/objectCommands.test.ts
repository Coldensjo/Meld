// Run with: bun test tests/objectCommands.test.ts
// The shared add/remove undo steps (#451): ids kept through undo and redo, attachments restored, and
// the step holds copies, so an edit after it doesn't leak in.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
const { addedCommand, removedCommand } = await import('../src/lib/world/objectCommands.ts')

const terrain = { heightAt: () => 0 } as unknown as Terrain
const at = (x: number) => ({ type: 'helper:cube:4', x, z: 0, yOff: 0, rotY: 0, scale: 1 })

test('addedCommand undoes an add and redoes it with the same ids, parent first', () => {
	const L = new ObjectLayer(terrain)
	const a = L.add(at(1))
	const b = L.add({ ...at(0), parent: a.id })
	const cmd = addedCommand(L, [a, b], 'Place')
	a.x = 99
	assert.equal(cmd.label, 'Place')
	cmd.undo()
	assert.equal(L.objects.size, 0)
	cmd.redo()
	assert.equal(L.objects.get(a.id)?.x, 1, 'the step holds the models as they were added')
	assert.equal(L.objects.get(b.id)?.parent, a.id)
})

test('removedCommand undoes a removal and redoes it', () => {
	const L = new ObjectLayer(terrain)
	const a = L.add(at(1))
	const keep = L.add(at(2))
	L.remove(a.id)
	const cmd = removedCommand(L, [a])
	assert.equal(cmd.label, 'Delete')
	cmd.undo()
	assert.ok(L.objects.has(a.id))
	cmd.redo()
	assert.ok(!L.objects.has(a.id))
	assert.ok(L.objects.has(keep.id))
})
