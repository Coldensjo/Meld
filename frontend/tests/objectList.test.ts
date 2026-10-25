// Run with: bun test tests/objectList.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatObjectList, parseObjectList } from '../src/lib/world/objectList.ts'

const tree = { id: 1, type: 'm2:World\Tree a.m2', x: 10.5, z: -3, yOff: 0.25, rotY: 1.5, scale: 1.2, tiltX: 0.1, tiltZ: -0.2 }

test('a list round-trips through text', () => {
	const text = formatObjectList([tree])
	const { objects, errors } = parseObjectList(text)
	assert.deepEqual(errors, [])
	assert.deepEqual(objects, [{ type: tree.type, x: 10.5, z: -3, yOff: 0.25, rotY: 1.5, scale: 1.2, tiltX: 0.1, tiltZ: -0.2 }])
})

test('lists from before tilt still read, with no tilt', () => {
	const { objects, errors } = parseObjectList('m2:a.m2\t1\t2\t0\t0\t1')
	assert.deepEqual(errors, [])
	assert.deepEqual(objects, [{ type: 'm2:a.m2', x: 1, z: 2, yOff: 0, rotY: 0, scale: 1 }])
})

test('a tilt that is not a number is reported', () => {
	const { objects, errors } = parseObjectList('m2:a.m2\t1\t2\t0\t0\t1\tx\t0')
	assert.equal(objects.length, 0)
	assert.match(errors[0], /line 1: a tilt/)
})

test('attached models are left out of the export', () => {
	const child = { ...tree, id: 2, parent: 1 }
	const lines = formatObjectList([tree, child]).trim().split('\n')
	assert.equal(lines.length, 2, 'header and one model')
})

test('bad lines are reported, not imported', () => {
	const text = ['# comment', '', 'm2:a.m2\t1\t2\t0\t0\t1', 'stone.txt\t1\t2\t0\t0\t1', 'm2:b.m2\t1\t2', 'm2:c.m2\tx\t2\t0\t0\t1', 'm2:d.m2\t1\t2\t0\t0\t0'].join('\n')
	const { objects, errors } = parseObjectList(text)
	assert.equal(objects.length, 1)
	assert.equal(errors.length, 4)
	assert.match(errors[0], /line 4/)
})

test('model paths with spaces survive', () => {
	const { objects } = parseObjectList('wmo:World\Orc\Passive Doodads.wmo\t1\t2\t3\t0\t1')
	assert.equal(objects[0].type, 'wmo:World\Orc\Passive Doodads.wmo')
})
