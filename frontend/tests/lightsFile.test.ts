// Run with: bun test tests/lightsFile.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { forkBorrowed, lightsToExport, mergeLights } from '../src/lib/io/lightsFile.ts'
import type { vmangos } from '../src/lib/wails/models.ts'

const bands = (n: number, v: number) => Array.from({ length: n }, () => [{ t: 0, v }])
const params = (id: number, v: number) => ({ id, highlightSky: false, glow: 0, waterAlpha: [0.5, 1], oceanAlpha: [0.5, 1], colors: bands(18, v), floats: bands(6, v) }) as vmangos.LightParamSet
const light = (id: number, p: number, global = false, extra: Partial<vmangos.MapLight> = {}) => ({ id, x: global ? 0 : 100, y: 0, z: global ? 0 : 200, inner: 30, outer: 90, global, params: [p, 0, 0, 0, 0], ...extra }) as vmangos.MapLight

test('export takes the lights and only the params they name, in ID order', () => {
	const e = lightsToExport(5, [light(9, 4), light(8, 3, true, { borrowed: true })], { 3: params(3, 1), 4: params(4, 2), 7: params(7, 3) })
	assert.equal(e.mapId, 5)
	assert.deepEqual(
		e.params.map((p) => p.id),
		[3, 4],
	)
	assert.equal(e.lights[1].borrowed, undefined)
})

test('onto the same map an import replaces lights and params by ID and adds the rest', () => {
	const file = lightsToExport(1, [light(10, 20, true), light(11, 21), light(12, 22)], { 20: params(20, 0xff), 21: params(21, 0xee), 22: params(22, 0xdd) })
	const got = mergeLights(1, [light(10, 20, true), light(11, 21, false, { x: 5 })], { 20: params(20, 1), 21: params(21, 2) }, file, { light: 100, params: 200 })
	assert.deepEqual(got.lights.map((l) => l.id).sort(), [10, 11, 12])
	assert.equal(got.lights.find((l) => l.id === 11)?.x, 100)
	assert.equal(got.params[20].colors[0][0].v, 0xff)
	assert.equal(got.params[22].colors[0][0].v, 0xdd)
	assert.deepEqual(got.dirtyLights.sort(), [10, 11, 12])
	assert.deepEqual(got.dirtyParams.sort(), [20, 21, 22])
	assert.equal(got.added, 1)
	assert.equal(got.replaced, 2)
})

test('onto another map an import takes new IDs, keeps positions, and its global light becomes the map’s', () => {
	const file = lightsToExport(0, [light(1, 12, true), light(2, 13, false, { params: [13, 50, 0, 0, 0] })], { 12: params(12, 0xaa), 13: params(13, 0xbb) })
	const before = { 40: params(40, 1) }
	const got = mergeLights(7, [light(30, 40, true)], before, file, { light: 100, params: 200 })
	const g = got.lights.filter((l) => l.global)
	assert.equal(g.length, 1)
	assert.equal(g[0].id, 30, "the map's own global light keeps its ID")
	assert.equal(g[0].params[0], 200)
	const local = got.lights.find((l) => !l.global)!
	assert.equal(local.id, 100)
	assert.deepEqual([local.x, local.z], [100, 200])
	assert.deepEqual(local.params, [201, 50, 0, 0, 0], 'a slot whose params the file lacks keeps its ID')
	assert.equal(got.params[201].colors[0][0].v, 0xbb)
	assert.equal(got.params[201].id, 201)
	assert.equal(got.params[12], undefined, "the source map's params rows are not touched")
	assert.equal(before[40].colors[0][0].v, 1)
	assert.equal(got.replaced, 1)
	assert.equal(got.added, 1)
})

test("a map that borrows Azeroth's global light gets a global light of its own", () => {
	const file = lightsToExport(0, [light(1, 12, true)], { 12: params(12, 0xaa) })
	const got = mergeLights(7, [light(1, 12, true, { borrowed: true })], { 12: params(12, 1) }, file, { light: 100, params: 200 })
	assert.equal(got.lights.length, 1)
	assert.equal(got.lights[0].id, 100)
	assert.equal(got.lights[0].borrowed, undefined)
	assert.equal(got.params[12].colors[0][0].v, 1, "Azeroth's params stay")
	assert.equal(got.params[200].colors[0][0].v, 0xaa)
	assert.equal(got.added, 1)
})

test('new IDs go past the unsaved ones already in the dialog', () => {
	const file = lightsToExport(0, [light(2, 13)], { 13: params(13, 0xbb) })
	const got = mergeLights(7, [light(30, 40, true), light(150, 250)], { 40: params(40, 1), 250: params(250, 1) }, file, { light: 100, params: 200 })
	assert.ok(got.lights.some((l) => l.id === 151 && l.params[0] === 251))
})

test("onto the same map that borrows Azeroth's global light, the global's params still take new IDs", () => {
	const file = lightsToExport(7, [light(1, 12, true, { borrowed: true }), light(60, 61)], { 12: params(12, 0xaa), 61: params(61, 0xcc) })
	const got = mergeLights(7, [light(1, 12, true, { borrowed: true }), light(60, 61)], { 12: params(12, 1), 61: params(61, 1) }, file, { light: 100, params: 200 })
	assert.equal(got.params[12].colors[0][0].v, 1, "Azeroth's params stay")
	assert.equal(got.lights.find((l) => l.global)?.id, 100)
	assert.equal(got.lights.find((l) => l.global)?.params[0], 200)
	assert.equal(got.params[61].colors[0][0].v, 0xcc)
	assert.equal(got.lights.length, 2)
})

test("editing a borrowed global light forks it: new light and params IDs, Azeroth's rows untouched (#946)", () => {
	const az = params(12, 1)
	const lights = [light(1, 12, true, { borrowed: true, params: [12, 13, 14, 0, 0] }), light(150, 300)]
	const got = forkBorrowed(lights, { 12: az, 14: params(14, 2), 300: params(300, 3) }, 1, { light: 100, params: 200 })!
	assert.ok(got)
	assert.equal(got.light, 151, 'past the unsaved light IDs')
	const g = got.lights.find((l) => l.global)!
	assert.equal(g.id, 151)
	assert.equal(g.borrowed, undefined)
	assert.deepEqual(g.params, [301, 13, 302, 0, 0], 'a slot the dialog did not read keeps its ID')
	assert.deepEqual(got.dirtyParams, [301, 302])
	assert.equal(got.params[301].id, 301)
	got.params[301].colors[0][0].v = 0xff
	assert.equal(az.colors[0][0].v, 1, "Azeroth's params are copied, not shared")
	assert.equal(got.lights.length, 2)
	assert.equal(lights[0].id, 1, 'the input is not changed')
	assert.equal(forkBorrowed(got.lights, got.params, 151, { light: 100, params: 200 }), null, 'an own light is not forked')
})
