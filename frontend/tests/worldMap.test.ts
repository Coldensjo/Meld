// Run with: node --import ./tests/register.mjs --test tests/worldMap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artName, boxRect, extentToRect, feather, fitAspect, intersect, mapLook, paste, pixelBox, rectToExtent, WORLD_MAP_H, WORLD_MAP_W, zoneBounds } from '../src/lib/io/worldMap.ts'

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)

test("Elwynn's extent lands on its tiles, and back", () => {
	// The client's row: L 1535.4, R -1935.4, T -7939.6, B -10254.2; Elwynn is around tiles 30..36, 47..50.
	const e = { left: 1535.4, right: -1935.4, top: -7939.6, bottom: -10254.2 }
	const r = extentToRect(e)
	const tile = 1600 / 3
	near(r.x0 / tile, 29.12, 0.01)
	near(r.x1 / tile, 35.63, 0.01)
	near(r.z0 / tile, 46.89, 0.01)
	near(r.z1 / tile, 51.23, 0.01)
	// A region opened at tile 32_48 sees it moved by its first tile.
	const inRegion = extentToRect(e, 32, 48)
	near(inRegion.x0, r.x0 - 32 * tile)
	near(inRegion.z0, r.z0 - 48 * tile)
	const back = rectToExtent(inRegion, 32, 48)
	near(back.left, e.left)
	near(back.right, e.right)
	near(back.top, e.top)
	near(back.bottom, e.bottom)
	// West is the larger Y and north the larger X, as WorldMapArea stores them.
	assert.ok(back.left > back.right && back.top > back.bottom)
})

test('a zone is the chunks of its areas, grown to the picture’s 3:2', () => {
	// A 4x4 chunk map: area 7 in chunks (1,1) and (2,1), area 8 (a subzone) in (2,2), area 9 elsewhere.
	const ids = new Uint32Array(16)
	ids[5] = 7
	ids[6] = 7
	ids[10] = 8
	ids[0] = 9
	const b = zoneBounds(ids, 4, 10, (id) => id === 7 || id === 8)!
	assert.deepEqual(b, { x0: 10, z0: 10, x1: 30, z1: 30 })
	assert.equal(zoneBounds(ids, 4, 10, (id) => id === 99), null)
	const f = fitAspect(b, 0)
	near((f.x1 - f.x0) / (f.z1 - f.z0), WORLD_MAP_W / WORLD_MAP_H)
	near((f.x0 + f.x1) / 2, 20)
	near(f.z1 - f.z0, 20, 1e-9)
})

test('pixel boxes and rectangles turn into each other', () => {
	const whole = { x0: 0, z0: 0, x1: 1002, z1: 668 }
	const part = { x0: 100.4, z0: 50.6, x1: 300.2, z1: 900 }
	const box = pixelBox(whole, part)
	assert.deepEqual(box, { u0: 100, v0: 50, u1: 301, v1: 668 })
	const r = boxRect(whole, box)
	for (const [k, v] of Object.entries({ x0: 100, z0: 50, x1: 301, z1: 668 })) near(r[k as keyof typeof r], v, 1e-9)
	assert.deepEqual(intersect(whole, { x0: 900, z0: -10, x1: 2000, z1: 10 }), { x0: 900, z0: 0, x1: 1002, z1: 10 })
	assert.equal(intersect(whole, { x0: 2000, z0: 0, x1: 3000, z1: 10 }), null)
})

test('the map look warms the picture and fades only the edges asked for', () => {
	// Larger than the fade band (5% of the whole picture's short side, 33 px) on every side.
	const w = 200
	const h = 120
	const px = new Uint8Array(w * h * 4)
	for (let i = 0; i < px.length; i += 4) px.set([60, 120, 60, 255], i)
	const all = mapLook(px, w, h)
	const mid = (60 * w + 100) * 4
	assert.ok(all[mid] > 60 && all[mid + 2] < 60, 'warmer: more red, less blue')
	assert.equal(all[mid + 3], 255)
	// The corner is parchment, the middle isn't.
	assert.deepEqual(Array.from(all.subarray(0, 3)), [201, 182, 140])
	const leftOnly = mapLook(px, w, h, { left: true, top: false, right: false, bottom: false })
	assert.deepEqual(Array.from(leftOnly.subarray(0, 3)), [201, 182, 140])
	const rightEdge = (60 * w + w - 1) * 4
	assert.equal(leftOnly[rightEdge], leftOnly[mid], 'the right edge is left as the middle')
})

test('paste copies a part into its place, and art names are folder-safe', () => {
	const into = new Uint8Array(4 * 3 * 4)
	paste(into, 4, new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]), 2, 1, 1, 2)
	assert.deepEqual(Array.from(into.subarray((2 * 4 + 1) * 4, (2 * 4 + 3) * 4)), [1, 1, 1, 1, 2, 2, 2, 2])
	assert.equal(into[0], 0)
	assert.equal(artName("Jaguero Isle (Stranglethorn's)"), 'JagueroIsleStranglethorns')
	assert.equal(artName('42 Fields'), 'Zone42Fields')
})

test('feather blends a piece into what is under it along its inner edges only', () => {
	const w = 40
	const h = 10
	const into = new Uint8Array(w * h * 4).fill(0)
	const part = new Uint8Array(20 * h * 4).fill(200)
	// At the picture's left edge, full height: only its right side is inside the picture.
	feather(into, w, h, part, 20, h, 0, 0, 8)
	const at = (x: number) => into[(5 * w + x) * 4]
	assert.equal(at(0), 200, 'the side on the picture edge is not blended')
	assert.equal(at(10), 200)
	assert.ok(at(19) > 0 && at(19) < 40, `the inner edge is mostly what was there: ${at(19)}`)
	assert.equal(at(25), 0, 'outside the piece is untouched')
})
