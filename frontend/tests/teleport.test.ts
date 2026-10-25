// Run with: bun test tests/teleport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorPoint } from '../src/lib/io/portCoords.ts'
import { tileKey } from '../src/lib/io/mapTiles.ts'
import type { TriggerShape } from '../src/lib/world/areaTriggers.ts'
import { blockAround, pickTrigger, rayTrigger, spotTile, triggerWins } from '../src/lib/world/teleport.ts'

// The Deadmines entrance (trigger 78) sits near (-11208, 1675) on Azeroth, in block 28_53.
const TX = 28,
	TY = 53
const sphere: TriggerShape = { id: 78, x: -11208, y: 1675, z: 30, radius: 5, boxX: 0, boxY: 0, boxZ: 0, boxYaw: 0 }
const box: TriggerShape = { id: 79, x: -11208, y: 1675, z: 30, radius: 0, boxX: 20, boxY: 4, boxZ: 6, boxYaw: Math.PI / 2 }

/** A ray from `back` units off the trigger's centre along editor axis `axis`, pointing at it. */
function rayAt(t: TriggerShape, axis: 'x' | 'y' | 'z', back: number) {
	const c = editorPoint(t, TX, TY)
	const origin = { ...c, [axis]: c[axis] + back }
	const dir = { x: 0, y: 0, z: 0, [axis]: -Math.sign(back) }
	return { origin, dir }
}

test('a ray at a sphere enters and leaves it a radius either side of its centre', () => {
	const { origin, dir } = rayAt(sphere, 'x', 50)
	const h = rayTrigger(origin, dir, sphere, TX, TY)
	assert.ok(h)
	assert.ok(Math.abs(h.enter - 45) < 1e-6 && Math.abs(h.exit - 55) < 1e-6)
	assert.equal(rayTrigger({ ...origin, y: origin.y + 6 }, dir, sphere, TX, TY), null)
})

test("a box's extents turn with its yaw", () => {
	// Turned a quarter, the box's 20-yard side runs along the server's Y, which is the editor's x.
	const along = rayAt(box, 'x', 50)
	const h = rayTrigger(along.origin, along.dir, box, TX, TY)
	assert.ok(h && Math.abs(h.enter - 40) < 1e-4 && Math.abs(h.exit - 60) < 1e-4)
	const across = rayAt(box, 'z', 50)
	const k = rayTrigger(across.origin, across.dir, box, TX, TY)
	assert.ok(k && Math.abs(k.enter - 48) < 1e-4 && Math.abs(k.exit - 52) < 1e-4)
	// Height is the editor's y: 3 yards up and down.
	assert.equal(rayTrigger({ ...across.origin, y: across.origin.y + 3.5 }, across.dir, box, TX, TY), null)
})

test('a trigger behind the ray or around the camera is not picked', () => {
	const { origin, dir } = rayAt(sphere, 'x', 50)
	assert.equal(rayTrigger(origin, { ...dir, x: 1 }, sphere, TX, TY), null)
	const inside = rayAt(sphere, 'x', 1)
	assert.equal(pickTrigger([sphere], inside.origin, inside.dir, TX, TY), null)
	assert.equal(pickTrigger([sphere], origin, dir, TX, TY)?.trigger.id, 78)
})

test('a building the trigger stands in does not hide it, a spawn inside it does', () => {
	const hit = { trigger: sphere, enter: 45, exit: 55 }
	assert.equal(triggerWins(hit, null, Infinity), true)
	assert.equal(triggerWins(hit, 'model', 50), true)
	assert.equal(triggerWins(hit, 'model', 40), false)
	assert.equal(triggerWins(hit, 'spawn', 50), false)
	assert.equal(triggerWins(hit, 'spawn', 60), true)
})

test('the block opened around a destination holds it, centred where the tiles allow', () => {
	assert.deepEqual(spotTile(sphere), { x: 28, y: 53 })
	const have = new Set<number>()
	for (let y = 50; y < 56; y++) for (let x = 26; x < 32; x++) have.add(tileKey(x, y))
	assert.deepEqual(blockAround({ x: 28, y: 53 }, have, 3), { x: 27, y: 52, size: 3 })
	// At the edge of the map's tiles the block shifts inwards.
	assert.deepEqual(blockAround({ x: 26, y: 50 }, have, 3), { x: 26, y: 50, size: 3 })
	assert.equal(blockAround({ x: 10, y: 10 }, have, 3), null)
	assert.deepEqual(blockAround({ x: 5, y: 5 }, new Set([tileKey(5, 5)]), 3), { x: 5, y: 5, size: 1 })
})
