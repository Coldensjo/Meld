// Run with: bun test tests/clipShadows.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyShadows, mirrorShadows, pasteShadows, rotateShadows, type ShadowTerrain } from '../src/lib/world/clipShadows.ts'
import { SHADOW_PER_CELL } from '../src/lib/terrain/bakedShadows.ts'

function terrain(size: number, shadow: boolean): ShadowTerrain {
	const side = size * SHADOW_PER_CELL
	const t: ShadowTerrain = {
		size,
		shadowSide: side,
		shadow: shadow ? new Uint8Array(side * side) : null,
		ensureShadow() {
			if (!t.shadow) t.shadow = new Uint8Array(side * side)
			return t.shadow
		},
	}
	return t
}

test('an area copy carries its shadows, and a paste lays them at the new place', () => {
	const src = terrain(16, true)
	const side = src.shadowSide
	// One shadowed texel in cell (2, 3): its first texel.
	src.shadow![3 * 8 * side + 2 * 8] = 255
	const clip = copyShadows(src, { x0: 2, z0: 3, x1: 4, z1: 5 })!
	assert.equal(clip.length, 2 * 8 * 2 * 8)
	assert.equal(clip[0], 255)

	// Into a map with no shadows of its own: it gets them, lit elsewhere, and the writer saw the rect.
	const dst = terrain(16, false)
	const seen: number[][] = []
	pasteShadows(dst, clip, 2, 2, 10, 1, { reserve: (r) => seen.push([r.x0, r.z0, r.x1, r.z1]), touch: () => {} })
	assert.deepEqual(seen, [[80, 8, 95, 23]])
	assert.equal(dst.shadow![8 * side + 80], 255)
	assert.equal(
		dst.shadow!.reduce((n, v) => n + (v ? 1 : 0), 0),
		1,
	)

	// Off the map's edge: clipped, not wrapped.
	pasteShadows(dst, clip, 2, 2, 15, 15, { reserve: () => {}, touch: () => {} })
	assert.equal(dst.shadow![15 * 8 * side + 15 * 8], 255)

	// A map with no shadows of its own copies none, so a paste leaves the target's alone.
	assert.equal(copyShadows(terrain(16, false), { x0: 0, z0: 0, x1: 2, z1: 2 }), undefined)
})

test('shadows turn and mirror with the clip', () => {
	// A 2 by 1 cell clip: 16 by 8 texels, the first texel shadowed.
	const s = new Uint8Array(16 * 8)
	s[0] = 255
	// A quarter turn clockwise: (x, z) lands at (z, tw - 1 - x) in a clip 8 texels wide.
	const r = rotateShadows(s, 2, 1)
	assert.equal(r[15 * 8 + 0], 255)
	const mx = mirrorShadows(s, 2, 1, 'x')
	assert.equal(mx[15], 255)
	const mz = mirrorShadows(s, 2, 1, 'z')
	assert.equal(mz[7 * 16], 255)
})
