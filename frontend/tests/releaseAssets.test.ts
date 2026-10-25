// Run with: bun test tests/releaseAssets.test.ts
// The kept models of a closed map are let go of with their own geometry and materials, and with the
// shared materials and textures no remaining model uses (#505).
import './runes.ts'
import { expect, mock, test } from 'bun:test'
import * as THREE from 'three'
import type { MeshGroup, WowMesh } from '../src/lib/wow/api.ts'

const api = await import('../src/lib/wow/api.ts')
// Each model is one triangle whose groups map the textures named in its path ("a.blp+b.blp.m2").
// The rest of the module stays the real one, so a later test file that loads it (the mock lasts the
// whole run) finds every export.
const released: string[] = []
mock.module('../src/lib/wow/api.ts', () => ({
	...api,
	fetchMesh: (path: string) =>
		Promise.resolve(
			mesh(
				path
					.replace(/\.m2$/, '')
					.split('+')
					.map((texture) => ({ texture })),
			),
		),
	loadTexture: () => Promise.resolve(new THREE.Texture()),
	releaseTexture: (path: string) => {
		released.push(path)
		return true
	},
}))
const { buildWowAsset, getAsset, keptCounts, loadAsset, releaseAssets, releaseWowAsset } = await import('../src/lib/models/assets.ts')

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

function disposals(o: THREE.EventDispatcher<{ dispose: object }>) {
	const n = { count: 0 }
	o.addEventListener('dispose', () => n.count++)
	return n
}

test('a released model lets go of its geometry, and of the materials and textures only it used', async () => {
	released.length = 0
	const a = await loadAsset('m2:grass.blp+shared.blp.m2')
	const b = await loadAsset('m2:shared.blp.m2')
	const before = keptCounts()
	const geometry = disposals(a.geometry)
	const [alone, shared] = a.material as THREE.Material[]
	const aloneGone = disposals(alone)
	const sharedGone = disposals(shared)
	expect((b.material as THREE.Material[])[0]).toBe(shared)
	expect(releaseAssets(['m2:grass.blp+shared.blp.m2'])).toBe(1)
	expect(geometry.count).toBe(1)
	expect(aloneGone.count).toBe(1)
	// The other model still draws with the shared material and its texture.
	expect(sharedGone.count).toBe(0)
	expect(released).toEqual(['grass.blp'])
	expect(keptCounts().models).toBe(before.models - 1)
	expect(keptCounts().materials).toBe(before.materials - 1)
	// Asked for again, it loads afresh.
	expect(getAsset('m2:grass.blp+shared.blp.m2').ready).toBe(false)
	expect((await loadAsset('m2:grass.blp+shared.blp.m2')).ready).toBe(true)
	releaseAssets(['m2:grass.blp+shared.blp.m2', 'm2:shared.blp.m2'])
	expect(sharedGone.count).toBe(1)
	expect(released).toContain('shared.blp')
})

test('a preview keeps the shared materials and textures of a released model', async () => {
	released.length = 0
	const kept = await loadAsset('m2:bark.blp.m2')
	const preview = buildWowAsset(mesh([{ texture: 'bark.blp' }]))
	const material = (kept.material as THREE.Material[])[0]
	expect((preview.material as THREE.Material[])[0]).toBe(material)
	const gone = disposals(material)
	releaseAssets(['m2:bark.blp.m2'])
	expect(gone.count).toBe(0)
	expect(released).toEqual([])
	releaseWowAsset(preview)
})

test('a model released while it loads is let go of when it arrives, unless asked for again', async () => {
	const before = keptCounts().models
	const p = loadAsset('m2:late.blp.m2')
	releaseAssets(['m2:late.blp.m2'])
	await p
	expect(keptCounts().models).toBe(before)
	const q = loadAsset('m2:later.blp.m2')
	releaseAssets(['m2:later.blp.m2'])
	getAsset('m2:later.blp.m2')
	await q
	expect(keptCounts().models).toBe(before + 1)
	releaseAssets(['m2:later.blp.m2'])
})
