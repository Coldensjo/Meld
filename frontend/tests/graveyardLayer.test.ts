// Run with: bun test tests/graveyardLayer.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { editorPoint } from '../src/lib/io/portCoords.ts'
import { ALLIANCE, ANYONE, facingTip, GRAVE_POST, GraveyardLayer, graveyardColor, HORDE } from '../src/lib/world/GraveyardLayer.ts'

test("a graveyard's colour says whom its links serve", () => {
	const hex = (links: { faction: number }[]) => graveyardColor(links).getHex()
	assert.equal(hex([{ faction: ALLIANCE }]), 0x4d8dff)
	assert.equal(hex([{ faction: HORDE }]), 0xff5a4d)
	assert.equal(hex([{ faction: HORDE }, { faction: ALLIANCE }]), 0x7ee081)
	assert.equal(hex([{ faction: ANYONE }]), 0x7ee081)
	assert.equal(hex([]), 0x8a8a8a)
})

test('the facing points along the server facing: 0 is +X, a quarter turn +Y', () => {
	const g = { x: 10, y: 20, z: 5, o: 0 }
	assert.deepEqual(facingTip(g, 2), { x: 12, y: 20, z: 5 })
	const q = facingTip({ ...g, o: Math.PI / 2 }, 2)
	assert.ok(Math.abs(q.x - 10) < 1e-9 && Math.abs(q.y - 22) < 1e-9)
})

test('a ray through a cross picks its graveyard, and only while the layer is shown', () => {
	const layer = new GraveyardLayer()
	const list = [
		{ id: 7, x: -9000, y: 400, z: 90, o: 0, links: [] },
		{ id: 8, x: -9100, y: 450, z: 95, o: 1, links: [{ zone: 12, faction: ALLIANCE }] },
	]
	layer.set(list, 31, 48, 8)
	const p = editorPoint(list[1], 31, 48)
	const ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y + GRAVE_POST + 40, p.z), new THREE.Vector3(0, -1, 0))
	assert.equal(layer.pick(ray), null, 'hidden')
	layer.group.visible = true
	layer.group.updateMatrixWorld(true)
	assert.equal(layer.pick(ray), 8)
	const miss = new THREE.Raycaster(new THREE.Vector3(p.x + 30, p.y + 40, p.z), new THREE.Vector3(0, -1, 0))
	assert.equal(layer.pick(miss), null)
	// More graveyards than the first mesh holds still draw and pick.
	const many = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, x: -9000 - i * 50, y: 400, z: 90, o: 0, links: [] }))
	layer.set(many, 31, 48, null)
	const q = editorPoint(many[39], 31, 48)
	layer.group.updateMatrixWorld(true)
	assert.equal(layer.pick(new THREE.Raycaster(new THREE.Vector3(q.x, q.y + 40, q.z), new THREE.Vector3(0, -1, 0))), 139)
	layer.dispose()
})
