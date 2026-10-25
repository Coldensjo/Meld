// Run with: bun test tests/worldMap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	areasUnder,
	artName,
	boxRect,
	drawOverlays,
	explored,
	extentToRect,
	feather,
	fitAspect,
	intersect,
	mapLook,
	overlayName,
	paste,
	pixelBox,
	rectToExtent,
	WORLD_MAP_H,
	WORLD_MAP_W,
	zoneBounds,
	type OverlayPiece,
} from '../src/lib/io/worldMap.ts'

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
	assert.equal(
		zoneBounds(ids, 4, 10, (id) => id === 99),
		null,
	)
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

// A 40x30 picture of a 4x4-chunk map of 10-yard chunks, a pixel a yard: zone 12, with subzone 87 on
// chunk (1, 1) and subzone 9 on chunk (2, 1); area 500 is another zone's.
const OW = 40
const OH = 30
const whole = { x0: 0, z0: 0, x1: 40, z1: 30 }
const ids = new Array(16).fill(12)
ids[1 * 4 + 1] = 87
ids[1 * 4 + 2] = 9
const parents: Record<number, number> = { 87: 12, 9: 12, 500: 1 }
const names: Record<number, string> = { 87: 'Goldshire', 9: 'Northshire Valley' }
const green = (w: number, h: number) => {
	const px = new Uint8Array(w * h * 4)
	for (let i = 0; i < w * h; i++) px.set([40, 160, 40, 255], i * 4)
	return px
}

test('each subzone painted in a zone drawn whole gets its overlay, and the base leaves it out', () => {
	const box = { u0: 0, v0: 0, u1: OW, v1: OH }
	const under = areasUnder(ids, 4, 10, whole, box, OW, OH)
	assert.equal(under[15 * OW + 15], 87)
	assert.equal(areasUnder(ids, 4, 10, { x0: -20, z0: 0, x1: 20, z1: 30 }, box, OW, OH)[5 * OW + 5], 0, 'a pixel off the map has no area')
	const { overlays, base } = drawOverlays({ look: green(OW, OH), box, under, zoneId: 12, parentOf: (id) => parents[id], nameOf: (id) => names[id], overlays: [], band: 0, w: OW, h: OH })
	assert.deepEqual(
		overlays.map((o) => [o.id, o.areas, o.name, o.changed]),
		[
			[0, [9], 'NORTHSHIREVALLEY', true],
			[0, [87], 'GOLDSHIRE', true],
		],
	)
	const gold = overlays[1]
	assert.ok(gold.box.u0 < 10 && gold.box.u0 >= 1 && gold.box.u1 > 20 && gold.box.u1 <= 29, `Goldshire's box ${JSON.stringify(gold.box)} is its chunk with a soft edge`)
	const alpha = (o: OverlayPiece, x: number, y: number) => o.pixels![((y - o.box.v0) * (o.box.u1 - o.box.u0) + x - o.box.u0) * 4 + 3]
	assert.equal(alpha(gold, 15, 15), 255, 'whole over its chunk')
	assert.ok(alpha(gold, gold.box.u0, 15) < 64, 'soft at its edge')
	assert.ok(gold.hit.left >= 4 && gold.hit.left < 10 && gold.hit.right <= 26 && gold.hit.top >= 4 && gold.hit.bottom <= 26, `hit ${JSON.stringify(gold.hit)}`)
	// The base: parchment where the subzones are, the zone's own ground drawn.
	assert.ok(base[(15 * OW + 15) * 4 + 1] < 200 && base[(15 * OW + 15) * 4] > 150, 'the subzone is parchment in the base')
	assert.equal(base[(29 * OW + 1) * 4 + 1], 160, 'the zone itself is drawn in the base')
	// Explored, the subzone shows again.
	assert.equal(explored(base, overlays, OW)[(15 * OW + 15) * 4 + 1], 160)
	assert.equal(overlayName('Goldshire', new Set(['GOLDSHIRE', 'GOLDSHIRE2'])), 'GOLDSHIRE3')
})

test('an overlay redrawn in part keeps its art outside the box, and others are left alone', () => {
	const red = new Uint8Array(8 * 8 * 4)
	for (let i = 0; i < 64; i++) red.set([200, 20, 20, 255], i * 4)
	const old: OverlayPiece = { id: 122, areas: [87], name: 'GOLDSHIRE', box: { u0: 0, v0: 0, u1: 8, v1: 8 }, hit: { top: 0, left: 0, bottom: 8, right: 8 }, pixels: red, changed: false }
	const other: OverlayPiece = { id: 140, areas: [500], name: 'ELSEWHERE', box: { u0: 30, v0: 0, u1: 40, v1: 5 }, hit: { top: 0, left: 30, bottom: 5, right: 40 }, pixels: null, changed: false }
	const box = { u0: 10, v0: 0, u1: OW, v1: OH }
	const under = areasUnder(ids, 4, 10, whole, box, OW, OH)
	const { overlays } = drawOverlays({ look: green(30, OH), box, under, zoneId: 12, parentOf: (id) => parents[id], nameOf: (id) => names[id], overlays: [old, other], band: 4, w: OW, h: OH })
	const gold = overlays.find((o) => o.id === 122)!
	assert.ok(gold.changed && gold.box.u0 === 0 && gold.box.v0 === 0 && gold.box.u1 > 20, `Goldshire grew to ${JSON.stringify(gold.box)}`)
	const at = (x: number, y: number) => Array.from(gold.pixels!.subarray(((y - gold.box.v0) * (gold.box.u1 - gold.box.u0) + x - gold.box.u0) * 4, ((y - gold.box.v0) * (gold.box.u1 - gold.box.u0) + x - gold.box.u0) * 4 + 4))
	assert.deepEqual(at(3, 3), [200, 20, 20, 255], 'its old art outside the box is kept')
	assert.deepEqual(at(17, 15), [40, 160, 40, 255], 'its chunk inside the box is the new drawing')
	assert.deepEqual(
		overlays.find((o) => o.id === 140),
		other,
		'an overlay of areas not painted is left as it is',
	)
	assert.ok(
		overlays.some((o) => o.id === 0 && o.areas[0] === 9),
		'Northshire got a new overlay',
	)
})

test('an overlay whose subzone is no longer painted in the box is cleared there, dropped when nothing is left, and one that only spills over the edge left alone', () => {
	const red = (w: number, h: number) => {
		const px = new Uint8Array(w * h * 4)
		for (let i = 0; i < w * h; i++) px.set([200, 20, 20, 255], i * 4)
		return px
	}
	// Area 300's piece reaches into the box, 301's lies inside it; neither is painted in the block any more.
	const gone: OverlayPiece = { id: 150, areas: [300], name: 'GONE', box: { u0: 0, v0: 0, u1: 20, v1: 8 }, hit: { top: 0, left: 0, bottom: 8, right: 20 }, pixels: red(20, 8), changed: false }
	const inside: OverlayPiece = { id: 151, areas: [301], name: 'INSIDE', box: { u0: 30, v0: 22, u1: 38, v1: 28 }, hit: { top: 22, left: 30, bottom: 28, right: 38 }, pixels: red(8, 6), changed: false }
	// 302's soft edge only spills over the band at the box's edge, as a neighbour's does.
	const spill: OverlayPiece = { id: 152, areas: [302], name: 'SPILL', box: { u0: 6, v0: 20, u1: 12, v1: 28 }, hit: { top: 20, left: 6, bottom: 28, right: 12 }, pixels: red(6, 8), changed: false }
	const box = { u0: 10, v0: 0, u1: OW, v1: OH }
	const under = areasUnder(ids, 4, 10, whole, box, OW, OH)
	const { overlays } = drawOverlays({ look: green(30, OH), box, under, zoneId: 12, parentOf: (id) => parents[id] ?? 12, nameOf: (id) => names[id] ?? `Area${id}`, overlays: [gone, inside, spill], band: 4, w: OW, h: OH })
	const g = overlays.find((o) => o.id === 150)!
	assert.ok(g.changed, 'the piece is written again')
	const alpha = (x: number, y: number) => g.pixels![((y - g.box.v0) * (g.box.u1 - g.box.u0) + x - g.box.u0) * 4 + 3]
	assert.equal(alpha(3, 3), 255, 'its art outside the box is kept')
	assert.ok(alpha(10, 3) > 0 && alpha(10, 3) < 255, 'it fades over the band at the box edge')
	assert.ok(g.box.u1 <= 14, `cleared inside the box past the band: ${JSON.stringify(g.box)}`)
	assert.ok(g.hit.right <= 14, `its hit rectangle shrank: ${JSON.stringify(g.hit)}`)
	assert.equal(
		overlays.find((o) => o.id === 151),
		undefined,
		'a piece left with nothing is dropped',
	)
	assert.deepEqual(
		overlays.find((o) => o.id === 152),
		spill,
		'a piece that only spills over the band keeps the client art',
	)
})

test('a subzone no overlay names is drawn into the overlay whose art covers it', () => {
	// Goldshire's art covers both its chunk and Northshire's, as Elwynn's Northshire piece covers Echo Ridge Mine.
	const art = new Uint8Array(20 * 10 * 4)
	for (let i = 0; i < 200; i++) art.set([200, 20, 20, 255], i * 4)
	const old: OverlayPiece = { id: 122, areas: [87], name: 'GOLDSHIRE', box: { u0: 10, v0: 10, u1: 30, v1: 20 }, hit: { top: 10, left: 10, bottom: 20, right: 30 }, pixels: art, changed: false }
	const box = { u0: 0, v0: 0, u1: OW, v1: OH }
	const under = areasUnder(ids, 4, 10, whole, box, OW, OH)
	const { overlays, base } = drawOverlays({ look: green(OW, OH), box, under, zoneId: 12, parentOf: (id) => parents[id], nameOf: (id) => names[id], overlays: [old], band: 0, w: OW, h: OH })
	assert.equal(overlays.length, 1, 'no new overlay for Northshire')
	const gold = overlays[0]
	assert.deepEqual(gold.areas, [87], 'Northshire does not join the areas that reveal it')
	assert.equal(gold.pixels![((25 - gold.box.v0 - 10) * (gold.box.u1 - gold.box.u0) + 25 - gold.box.u0) * 4 + 3], 255, 'Northshire is drawn into it')
	assert.ok(base[(15 * OW + 25) * 4 + 1] < 200, 'and left out of the base')
})
