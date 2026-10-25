// Run with: bun test tests/pickNearest.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type * as THREE from 'three'
import type { vmangos } from '../wailsjs/go/models'
import type { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'
import type { SpawnLayer } from '../src/lib/world/SpawnLayer.ts'
import { pickNearest } from '../src/lib/world/pickNearest.ts'

const ray = {} as THREE.Raycaster
const npc = { guid: 1, name: 'Innkeeper Farley' } as vmangos.WorldSpawn

function layers(model: number | null, spawn: number | null) {
	const objects = { pickHit: () => (model === null ? null : { id: 7, distance: model }) } as unknown as ObjectLayer
	const spawns = { pickHit: () => (spawn === null ? null : { spawn: npc, distance: spawn }) } as unknown as SpawnLayer
	return [objects, spawns] as const
}

test('a creature standing on a floor is picked over the building under it', () => {
	const [o, s] = layers(12, 10)
	assert.deepEqual(pickNearest(o, s, ray), { spawn: npc, id: null, distance: 10 })
})

test('a wall in front of a creature is picked over the creature', () => {
	const [o, s] = layers(5, 10)
	assert.deepEqual(pickNearest(o, s, ray), { spawn: null, id: 7, distance: 5 })
})

test('either alone is picked, and nothing gives nothing', () => {
	assert.deepEqual(pickNearest(...layers(null, 3), ray), { spawn: npc, id: null, distance: 3 })
	assert.deepEqual(pickNearest(...layers(3, null), ray), { spawn: null, id: 7, distance: 3 })
	assert.deepEqual(pickNearest(...layers(null, null), ray), { spawn: null, id: null, distance: Infinity })
})
