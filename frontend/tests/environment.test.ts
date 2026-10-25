// Run with: bun test tests/environment.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Environment } from '../src/lib/engine/Environment.ts'

test('without shadows the key light still shines from the sun', () => {
	const env = new Environment(new THREE.Scene())
	env.update(9, 0, new THREE.PerspectiveCamera())
	const at = new THREE.Vector3(100, 5, -40)
	env.aimKey(at)
	const dir = env.key.position.clone().sub(env.key.target.position)
	assert.ok(dir.normalize().distanceTo(env.state.keyDir) < 1e-6)
	assert.ok(env.key.target.position.equals(at))
	assert.ok(env.state.keyDir.y > 0, 'the morning sun is up')
})
