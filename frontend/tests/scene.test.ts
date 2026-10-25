// Run with: bun test tests/scene.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseScene, TOOL_IDS, VIEW_PREFS } from '../src/lib/io/sceneParse.ts'
import { prefValueOk } from '../src/lib/state/prefsPatch.ts'

const current: Record<string, unknown> = {}
for (const k of VIEW_PREFS) current[k] = k === 'renderScale' || k === 'timeOfDay' ? 1 : false

const good = () => ({
	v: 1,
	map: { file: 'C:\\maps\\a.wmap' },
	view: { target: [1, 2, 3], yaw: 0.5, pitch: 0.4, distance: 30, hour: 12 },
	prefs: { renderScale: 0.75, fog: true },
	tool: 'sculpt',
	selectedIds: [1, 2],
	selected: 1,
	area: null,
	viewport: [800, 600],
})
const line = (o: unknown, prefix = 'Meld scene ') => prefix + JSON.stringify(o)
const bad = (mut: (s: Record<string, unknown>) => void, re: RegExp) => {
	const s = good() as Record<string, unknown>
	mut(s)
	assert.throws(() => parseScene(line(s), current), re)
}

test('a good scene parses, with the old prefix too', () => {
	const sc = parseScene(line(good()), current)
	assert.equal(sc.tool, 'sculpt')
	assert.deepEqual(sc.prefs, { renderScale: 0.75, fog: true })
	assert.deepEqual(parseScene(line(good(), 'WorldEditor scene '), current).viewport, [800, 600])
	const r = good() as Record<string, unknown>
	r.map = { region: { mapName: 'Azeroth', x: 1, y: 2, size: 4 } }
	r.area = { x0: 0, z0: 0, x1: 5, z1: 5 }
	assert.deepEqual(parseScene(line(r), current).area, { x0: 0, z0: 0, x1: 5, z1: 5 })
})

test("a world view's scene names its map (#15), and one without a map name is refused", () => {
	const w = good() as Record<string, unknown>
	w.map = { world: { mapName: 'Kalimdor' } }
	assert.deepEqual(parseScene(line(w), current).map, { world: { mapName: 'Kalimdor' } })
	bad((s) => (s.map = { world: { mapName: '' } }), /"map.world"/)
	bad((s) => (s.map = { world: 'Kalimdor' }), /"map.world"/)
})

test('text that is not a scene is refused', () => {
	assert.throws(() => parseScene('hello', current), /not a Meld scene/)
	assert.throws(() => parseScene('Meld scene {oops', current), /not valid JSON/)
	bad((s) => (s.v = 2), /version/)
})

test('missing or mistyped fields are named', () => {
	bad((s) => delete s.prefs, /"prefs"/)
	bad((s) => delete s.map, /"map"/)
	bad((s) => delete s.selectedIds, /"selectedIds"/)
	bad((s) => delete s.viewport, /"viewport"/)
	bad((s) => delete s.view, /"view"/)
	bad((s) => (s.view = { target: [1, 2], yaw: 0, pitch: 0, distance: 1, hour: 1 }), /view.target/)
	bad((s) => (s.view = { target: [1, 2, 3], yaw: 'x', pitch: 0, distance: 1, hour: 1 }), /view.yaw/)
	bad((s) => (s.tool = 'sculp'), /"tool"/)
	bad((s) => (s.selectedIds = ['a']), /"selectedIds"/)
	bad((s) => (s.viewport = [1]), /"viewport"/)
	bad((s) => (s.area = { x0: 1 }), /"area"/)
	bad((s) => (s.prefs = { renderScale: '1' }), /"renderScale"/)
	bad((s) => (s.prefs = { fog: 1 }), /"fog"/)
})

test('unknown prefs are dropped, not copied', () => {
	const s = good() as Record<string, unknown>
	s.prefs = { fog: true, sidebarWidth: 'wide' }
	assert.deepEqual(parseScene(line(s), current).prefs, { fog: true })
})

test('every tool id is listed once', () => {
	assert.equal(new Set(TOOL_IDS).size, TOOL_IDS.length)
})

test('prefValueOk keeps the type of the current value', () => {
	assert.ok(prefValueOk(1, 2))
	assert.ok(!prefValueOk(1, '2'))
	assert.ok(!prefValueOk(1, Number.NaN))
	assert.ok(prefValueOk([], [1]))
	assert.ok(!prefValueOk([], {}))
	assert.ok(!prefValueOk({}, null))
	assert.ok(prefValueOk(null, null))
})
