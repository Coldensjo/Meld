// Run with: bun test tests/releaseAsset.test.ts
// An asset built for a thumbnail or a preview and then released leaves nothing in the per-frame
// texture and colour animation lists (#506).
import './runes.ts'
import { expect, mock, test } from 'bun:test'
import * as THREE from 'three'
import type { MeshGroup, WowMesh } from '../src/lib/wow/api.ts'

const api = await import('../src/lib/wow/api.ts')
// The texture arrives from the client through Go; here it is a blank one, at once. The rest of the
// module stays the real one, so a later test file that loads it (the mock lasts the whole run) finds
// every export.
mock.module('../src/lib/wow/api.ts', () => ({
	...api,
	fetchMesh: () => Promise.reject(new Error('no client')),
	loadTexture: () => Promise.resolve(new THREE.Texture()),
	releaseTexture: () => true,
}))
const { animatedCount, buildWowAsset, releaseWowAsset, texturesReady, updateMaterialAnimations } = await import('../src/lib/models/assets.ts')

const scroll = { t: { t: [0, 1000], v: [0, 0, 0, 0, -1, 0], loop: 1000 } }
const fade = { a: { t: [0, 1000], v: [1, 0], loop: 1000 } }

function mesh(groups: Partial<MeshGroup>[]): WowMesh {
	return {
		positions: new Float32Array(9),
		normals: new Float32Array(9),
		uvs: new Float32Array(6),
		indices: new Uint32Array([0, 1, 2]),
		bbox: [0, 0, 0, 1, 1, 1],
		groups: groups.map((g) => ({ start: 0, count: 3, texture: '', blend: 0, twoSided: false, unlit: false, ...g })),
		effects: [],
		emitters: [],
		ribbons: [],
	} as unknown as WowMesh
}

test('a released asset takes its moving textures and colours out of the animated lists', async () => {
	const before = animatedCount()
	const a = buildWowAsset(mesh([{ texture: 'water.blp', uv: scroll }, { color: fade }, { texture: 'rock.blp' }]))
	await texturesReady(a.material)
	expect(animatedCount()).toBe(before + 2)
	const mats = a.material as THREE.Material[]
	let disposed = 0
	for (const m of mats) m.addEventListener('dispose', () => disposed++)
	const map = (mats[0] as THREE.MeshLambertMaterial).map!
	let copyFreed = false
	map.addEventListener('dispose', () => (copyFreed = true))
	releaseWowAsset(a)
	expect(animatedCount()).toBe(before)
	// The two materials of its own are disposed, with the texture copy; the shared one is kept.
	expect(disposed).toBe(2)
	expect(copyFreed).toBe(true)
	updateMaterialAnimations(500)
	// Released twice (a preview's stale load and its drop) is harmless.
	releaseWowAsset(a)
	expect(animatedCount()).toBe(before)
})

test('an asset released before its texture comes never registers it', async () => {
	const before = animatedCount()
	const a = buildWowAsset(mesh([{ texture: 'lava.blp', uv: scroll }]))
	releaseWowAsset(a)
	await texturesReady(a.material)
	expect(animatedCount()).toBe(before)
	expect((a.material as THREE.MeshLambertMaterial[])[0].map).toBeNull()
})

test('thumbnails of many animated models leave the lists as they were', async () => {
	const before = animatedCount()
	for (let i = 0; i < 500; i++) {
		const a = buildWowAsset(mesh([{ texture: 'falls.blp', uv: scroll, color: fade }]))
		await texturesReady(a.material)
		releaseWowAsset(a)
	}
	expect(animatedCount()).toBe(before)
})
