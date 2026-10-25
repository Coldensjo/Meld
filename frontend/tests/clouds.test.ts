// Run with: bun test tests/clouds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CloudKernel, COLS, domeMesh, projectCells, type CloudFrame } from '../src/lib/wow/clouds.ts'
import { cloudGlowIsSun, cloudGlowTrack } from '../src/lib/wow/dayNight.ts'

// Benilla's clouds/kernel.rs cases.
const g = Math.hypot(0.6, 0.5, 0.1)
const frame = (over: Partial<CloudFrame> = {}): CloudFrame => ({
	sun: [1, 0.78, 0.54],
	slope: [0.17, 0.41, 0.52],
	base: [0.1, 0.1, 0.12],
	storm: 0,
	glowDir: [0.6 / g, 0.5 / g, 0.1 / g],
	glowTrack: 1,
	...over,
})

test('density 0 is a clear sky', () => {
	const k = new CloudKernel()
	k.rebuild(0, frame())
	assert.ok(k.tile.every((b) => b === 0))
	for (let i = 3; i < k.rgba.length; i += 4) assert.equal(k.rgba[i], 0)
	assert.equal(k.coverage(0.3, 0.5, 0.2), 0)
})

test('density 1 is overcast, 0.6 scattered, and the field is the same each time', () => {
	const a = new CloudKernel()
	const b = new CloudKernel()
	a.rebuild(1, frame())
	b.rebuild(1, frame())
	assert.deepEqual(a.tile, b.tile)
	assert.deepEqual(a.rgba, b.rgba)
	assert.ok(
		a.tile.every((v) => v > 0),
		'overcast leaves no clear cell',
	)
	const mean = a.tile.reduce((s, v) => s + v, 0) / a.tile.length
	assert.ok(mean > 200, `overcast mean ${mean}`)
	const mid = new CloudKernel()
	mid.rebuild(0.6, frame())
	const clear = mid.tile.filter((v) => v === 0).length
	const covered = mid.tile.filter((v) => v > 100).length
	assert.ok(clear > 0 && covered > 0, `scattered: clear ${clear}, covered ${covered}`)
})

test("a texel's alpha is its coverage, and the glow only brightens", () => {
	const dark = new CloudKernel()
	dark.rebuild(1, frame({ glowTrack: 0 }))
	const lit = new CloudKernel()
	lit.rebuild(1, frame())
	let brighter = 0
	for (let i = 0; i < COLS * COLS; i++) {
		assert.equal(dark.rgba[i * 4 + 3], dark.tile[i])
		assert.ok(lit.rgba[i * 4] >= dark.rgba[i * 4])
		if (lit.rgba[i * 4] > dark.rgba[i * 4]) brighter++
	}
	assert.ok(brighter > 0, 'the glow never fired')
})

test('the field scrolls a quarter at a time, ten times a second', () => {
	const k = new CloudKernel()
	k.rebuild(0.6, frame())
	const before = k.tile.slice()
	assert.equal(k.tick(0.05, 0.6, frame()), false, 'not yet')
	assert.equal(k.tick(0.06, 0.6, frame()), true)
	// The first quarter of rows moved on to the next time slice; the rest stays.
	assert.notDeepEqual(k.tile.subarray(0, 32 * COLS), before.subarray(0, 32 * COLS))
	assert.deepEqual(k.tile.subarray(32 * COLS), before.subarray(32 * COLS))
})

test('the zenith is the tile centre and the 45-degree rim its edge', () => {
	assert.deepEqual(projectCells(0, 1, 0), [64, 64])
	const rim = projectCells(1, -Math.SQRT1_2 + 1e-9, 0)!
	assert.ok(Math.abs(rim[0] - 128) < 0.01 && Math.abs(rim[1] - 64) < 0.01, `${rim}`)
	assert.equal(projectCells(0, 0, 0), null)
})

test('the dome is twelve rings of sixteen, its rim at eye level and see-through', () => {
	const d = domeMesh()
	assert.equal(d.positions.length / 3, 12 * 16)
	assert.equal(d.indices.length, 11 * 16 * 6)
	assert.ok(Math.abs(d.positions[11 * 16 * 3 + 1]) < 1e-6, 'the rim is level with the eye')
	assert.equal(d.alphas[11 * 16], 0)
	assert.equal(d.alphas[0], 1)
	assert.deepEqual([d.uvs[0], d.uvs[1]], [0.5, 0.5], 'the zenith samples the tile centre')
})

test('the glow follows the sun from 04:50 to 22:10 and dips at dawn and dusk', () => {
	assert.equal(cloudGlowTrack(720), 1)
	assert.equal(cloudGlowTrack(0.20139 * 1440), 0)
	assert.equal(cloudGlowTrack(0.95 * 1440), 1)
	assert.ok(cloudGlowIsSun(720))
	assert.ok(!cloudGlowIsSun(60))
})
