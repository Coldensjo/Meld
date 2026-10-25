// Run with: bun test tests/gizmoAxes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { TransformGizmo } from '../src/lib/engine/TransformGizmo.ts'

test("the move arrows point along the world axes, or along a model's own turned ones", () => {
	const g = new TransformGizmo()
	const base = new THREE.Vector3(10, 0, 10)
	const eye = new THREE.Vector3(10, 50, 60)
	const v = new THREE.Vector3()
	g.update(base, 2, 4, eye, true, true, 0)
	assert.deepEqual(
		g
			.axisDir('moveX', v)
			.toArray()
			.map((n) => Math.round(n * 1e6) / 1e6 + 0),
		[1, 0, 0],
	)
	assert.deepEqual(
		g
			.axisDir('moveZ', v)
			.toArray()
			.map((n) => Math.round(n * 1e6) / 1e6 + 0),
		[0, 0, 1],
	)
	// A model turned a quarter turn (yaw +90°, as three turns about y): its x points to -z, its z to +x.
	g.update(base, 2, 4, eye, true, true, Math.PI / 2)
	assert.deepEqual(
		g
			.axisDir('moveX', v)
			.toArray()
			.map((n) => Math.round(n * 1e6) / 1e6 + 0),
		[0, 0, -1],
	)
	assert.deepEqual(
		g
			.axisDir('moveZ', v)
			.toArray()
			.map((n) => Math.round(n * 1e6) / 1e6 + 0),
		[1, 0, 0],
	)
	// The arrow's own drawn tip lies along that direction.
	g.group.updateMatrixWorld(true)
	const tip = new THREE.Vector3(0, 1, 0)
	const arrowX = g.group.children[g.group.children.length - 1].children[0]
	arrowX.localToWorld(tip)
	assert.ok(tip.z < base.z - 1 && Math.abs(tip.x - base.x) < 1e-6, `x arrow tip at ${tip.toArray()}`)
})
