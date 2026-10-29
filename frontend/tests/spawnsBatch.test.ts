// Run with: bun test tests/spawnsBatch.test.ts
// Undoing and redoing a Spawn brush stroke of 60 creatures redraws the spawn layer once, not once a
// creature (#193): the stroke's undo and redo run their commands inside `spawnsBatch`, as
// SpawnBrushTool.onUp pushes them, and the layer's `version` (one a redraw) counts the redraws.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { vmangos } from '../src/lib/wails/models'
import type { Command } from '../src/lib/state/history'

const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')
const { spawnAdd, spawnsBatch, syncSpawnUi } = await import('../src/lib/world/spawnEdits.ts')
const { editor } = await import('../src/lib/state/editor.svelte.ts')

function creature(guid: number, x: number): vmangos.WorldSpawn {
	return { kind: 'monster', guid, entry: 38, name: 'Defias Thug', x, y: 0, z: 0, orientation: 0, model: '', waypoints: [], leader: 0, pool: 0, motherPool: 0 } as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

test("a 60-creature stroke's undo and redo each redraw the layer once", () => {
	const layer = new SpawnLayer()
	const loaded = Array.from({ length: 500 }, (_, i) => creature(1 + i, i))
	layer.set(loaded)
	syncSpawnUi(layer, true)
	const cmds: Command[] = []
	// One redraw's bumps of `version` (a rebuild and its kinds), from the first add, outside a batch.
	const before = layer.version
	cmds.push(spawnAdd(layer, creature(9_100_000, 100), 'Spawn brush'))
	const redraw = layer.version - before
	assert.ok(redraw >= 1)
	for (let i = 1; i < 60; i++) cmds.push(spawnAdd(layer, creature(9_100_000 + i, 100 + i), 'Spawn brush'))
	assert.equal(layer.spawns.length, 560)
	assert.equal(layer.version - before, 60 * redraw, 'each unbatched add redraws the layer')
	// The two closures the Spawn brush pushes (SpawnBrushTool.onUp).
	const stroke: Command = {
		label: 'Spawn brush',
		undo: () =>
			spawnsBatch(layer, () => {
				for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo()
			}),
		redo: () => spawnsBatch(layer, () => cmds.forEach((c) => c.redo())),
	}

	const v0 = layer.version
	stroke.undo()
	assert.equal(layer.spawns.length, 500)
	assert.equal(layer.version - v0, redraw, 'the undo redrew the layer more than once')
	assert.equal(editor.spawns.length, 500, "the undo left the editor's spawn list behind")

	const v1 = layer.version
	stroke.redo()
	assert.equal(layer.spawns.length, 560)
	assert.equal(layer.version - v1, redraw, 'the redo redrew the layer more than once')
	assert.equal(editor.spawns.length, 560, "the redo left the editor's spawn list behind")
})
