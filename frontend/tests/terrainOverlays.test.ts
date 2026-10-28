import { test } from 'bun:test'
import assert from 'node:assert/strict'
import './runes.ts'
import * as THREE from 'three'
import { createTerrainMaterial } from '../src/lib/terrain/TerrainMaterial.ts'
import { FRAME_OVERLAYS, OVERLAYS_OFF, updateTerrainOverlays, withOverlaysOff, type OverlayState } from '../src/lib/terrain/terrainOverlays.ts'

const material = () => createTerrainMaterial(new THREE.Texture(), new THREE.Texture(), new THREE.Texture(), 512, 2, 32, 16)

test('every overlay turned off for the minimap is a uniform of the terrain material and of its shader', () => {
	const m = material()
	for (const name of Object.keys(OVERLAYS_OFF)) {
		assert.ok(m.uniforms[name], `${name} is a uniform`)
		assert.match(m.fragmentShader, new RegExp(`uniform \\w+ ${name};`), `${name} is declared in the shader`)
	}
})

test('the overlays frame sets are written, then turned off for a shot and put back after it', () => {
	const m = material()
	const u = m.uniforms
	const on: OverlayState = { brushVisible: 1, gridVisible: 1, unpaintable: 3, climbCos: 0.7, contourStep: 5, chunkLineWorld: 33, maskVisible: 0.45 }
	updateTerrainOverlays(u, on)
	for (const k of FRAME_OVERLAYS) assert.equal(u[k].value, on[k])
	;(u.chunkHover.value as THREE.Vector4).set(1, 2, 3, 4)
	u.tileWorld.value = 266
	u.selMode.value = 3
	const seen = withOverlaysOff(u, () => {
		for (const [name, off] of Object.entries(OVERLAYS_OFF)) {
			if (u[name].value instanceof THREE.Vector4) assert.deepEqual((u[name].value as THREE.Vector4).toArray(), [0, 0, 0, 0], name)
			else assert.equal(u[name].value, off, name)
		}
		return 'drawn'
	})
	assert.equal(seen, 'drawn')
	for (const k of FRAME_OVERLAYS) assert.equal(u[k].value, on[k])
	assert.deepEqual((u.chunkHover.value as THREE.Vector4).toArray(), [1, 2, 3, 4])
	assert.equal(u.tileWorld.value, 266)
	assert.equal(u.selMode.value, 3)
})

test('the overlays are put back when the shot throws, and a missing overlay is an error', () => {
	const u = material().uniforms
	u.gridVisible.value = 1
	assert.throws(() =>
		withOverlaysOff(u, () => {
			throw new Error('context lost')
		}),
	)
	assert.equal(u.gridVisible.value, 1)
	const partial = { ...u }
	delete partial.refEdit
	assert.throws(() => withOverlaysOff(partial, () => 0), /refEdit/)
	assert.equal(u.gridVisible.value, 1, 'what was turned off before the error is put back')
})
