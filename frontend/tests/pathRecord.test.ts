// Run with: bun test tests/pathRecord.test.ts
// A path's last apply as the map file keeps it (#395, tools/pathRecord.ts): the record an apply makes
// survives the file's blob, and the undo step made from the record read back takes the apply back
// on a map reopened without its history, as the one made at the apply does.
import './runes.ts'
import { expect, test } from 'bun:test'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { newPath, type MapPath } from '../src/lib/terrain/paths.ts'
import { LiquidMap, encodeLiquids } from '../src/lib/water/liquids.ts'
import { applyPath, recordCommand } from '../src/lib/tools/pathApply.ts'
import { appliesOf, decodePathApplies, encodePathApplies, savedApplies, shiftApplies, type SavedApply } from '../src/lib/tools/pathRecord.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')

const SIZE = 64

/** A rolling map painted all over with palette texture 0, no liquids and no models. */
function world() {
	const t = new Terrain(SIZE, 2)
	const V = t.verts
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) t.heights[z * V + x] = 10 + Math.sin(x * 0.3) + Math.cos(z * 0.2)
	t.chunkSlots.fill(NO_TEXTURE)
	for (let c = 0; c < t.paintChunksPerSide ** 2; c++) t.chunkSlots[c * SLOTS] = 0
	t.weights.fill(0)
	for (let p = 0; p < t.splatRes * t.splatRes; p++) t.weights[p * SLOTS] = 255
	return { terrain: t, objects: new ObjectLayer(t), liquids: new LiquidMap(SIZE) }
}

function path(kind: MapPath['kind'], points: Array<[number, number]>, over: Partial<MapPath> = {}): MapPath {
	const p = newPath([], kind, 'tex')
	p.points = points.map(([x, z]) => ({ x, y: 12, z }))
	return { ...p, ...over }
}

/** Everything an apply may change, copied. */
function state(m: ReturnType<typeof world>) {
	return {
		heights: m.terrain.heights.slice(),
		weights: m.terrain.weights.slice(),
		slots: m.terrain.chunkSlots.slice(),
		liquids: encodeLiquids(m.liquids),
		models: m.objects
			.list()
			.map((o) => `${o.id} ${o.type} ${o.x.toFixed(3)} ${o.z.toFixed(3)}`)
			.sort(),
	}
}

/** The record through the map file's blob, as a reopened map reads it. */
function reread(list: SavedApply[]): SavedApply[] {
	return decodePathApplies(encodePathApplies(list), SIZE, SIZE * 4)
}

test('a road and a river read back from the file take their apply back, heights, paint and liquid, and redo puts it again', () => {
	for (const p of [
		path(
			'road',
			[
				[20, 30],
				[100, 60],
			],
			{ width: 8 },
		),
		path(
			'river',
			[
				[10, 100],
				[110, 20],
			],
			{ width: 10, depth: 2, liquid: 1 },
		),
	]) {
		const m = world()
		const before = state(m)
		const res = applyPath(m, p, p.kind === 'road' ? 2 : -1)
		expect(res.record).not.toBeNull()
		const after = state(m)
		expect(after.heights).not.toEqual(before.heights)
		if (p.kind === 'road') expect(after.weights).not.toEqual(before.weights)
		else expect(after.liquids).not.toEqual(before.liquids)
		const [saved] = reread([{ pathId: p.id, record: res.record! }])
		expect(saved.pathId).toBe(p.id)
		const cmd = recordCommand(m, saved.record, 'Apply')
		cmd.undo()
		expect(state(m)).toEqual(before)
		cmd.redo()
		expect(state(m)).toEqual(after)
		expect(cmd.bytes).toBeGreaterThan(0)
	}
})

test('a fence read back from the file removes its models, but not another model that took one of their ids', () => {
	const m = world()
	m.objects.add({ type: 'helper:cube:2', x: 5, z: 5, yOff: 0, rotY: 0, scale: 1 })
	const before = state(m)
	const f = path(
		'fence',
		[
			[10, 20],
			[70, 20],
		],
		{ model: 'helper:cube:4' },
	)
	const res = applyPath(m, f, -1, { length: 6, alongZ: false })
	expect(m.objects.list().length).toBe(11)
	const [saved] = reread([{ pathId: f.id, record: res.record! }])
	expect(saved.record.models?.type).toBe('helper:cube:4')
	const cmd = recordCommand(m, saved.record, 'Apply')
	cmd.undo()
	expect(state(m)).toEqual(before)
	cmd.redo()
	expect(m.objects.list().length).toBe(11)
	// One fence model deleted by hand, its id taken by a tree since: taking the fence back leaves the tree.
	const id = saved.record.models!.ids[3]
	m.objects.remove(id)
	m.objects.add({ id, type: 'helper:cube:2', x: 1, z: 1, yOff: 0, rotY: 0, scale: 1 })
	recordCommand(m, saved.record, 'Apply').undo()
	expect(m.objects.list().map((o) => o.type)).toEqual(['helper:cube:2', 'helper:cube:2'])
})

test('the file keeps only the live applies of paths still in the map', () => {
	const m = world()
	const a = path('road', [
		[20, 30],
		[100, 30],
	])
	const b = {
		...path('road', [
			[20, 80],
			[100, 80],
		]),
		id: a.id + 1,
	}
	const c = {
		...path('road', [
			[20, 110],
			[100, 110],
		]),
		id: a.id + 2,
	}
	const live = appliesOf(m.terrain)
	for (const p of [a, b, c]) {
		const res = applyPath(m, p, -1)
		live.set(p.id, { record: res.record!, cmd: res.cmd!, live: true })
	}
	live.get(b.id)!.live = false
	expect(savedApplies(m.terrain, [a, b]).map((s) => s.pathId)).toEqual([a.id])
	expect(savedApplies(new Terrain(16, 2), [a])).toEqual([])
})

test('a grown map moves the records with its old square', () => {
	const m = world()
	const p = path(
		'river',
		[
			[10, 100],
			[110, 20],
		],
		{ width: 10 },
	)
	const res = applyPath(m, p, -1)
	const r = res.record!
	const [moved] = shiftApplies([{ pathId: p.id, record: r }], SIZE, SIZE * 2, SIZE, 8)
	const V0 = SIZE + 1
	const V = SIZE * 2 + 1
	const i = r.heights!.index[0]
	expect(moved.record.heights!.index[0]).toBe((Math.floor(i / V0) + 8) * V + (i % V0) + SIZE)
	const c = r.liquids!.chunks[0]
	const C0 = SIZE / 8
	expect(moved.record.liquids!.chunks[0]).toBe((Math.floor(c / C0) + 1) * C0 * 2 + (c % C0) + C0)
	expect(moved.record.heights!.before).toBe(r.heights!.before)
})

test('a blob that does not fit the map reads as none', () => {
	const m = world()
	const p = path('road', [
		[20, 30],
		[100, 60],
	])
	const blob = encodePathApplies([{ pathId: p.id, record: applyPath(m, p, 1).record! }])
	expect(decodePathApplies(blob, SIZE, SIZE * 4).length).toBe(1)
	expect(decodePathApplies(blob.subarray(0, blob.length - 1), SIZE, SIZE * 4)).toEqual([])
	expect(decodePathApplies(blob, 16, 64)).toEqual([])
	expect(decodePathApplies(new Uint8Array(0), SIZE, SIZE * 4)).toEqual([])
})
