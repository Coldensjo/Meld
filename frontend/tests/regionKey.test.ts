// Run with: bun test tests/regionKey.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedPending, contentKey, regionKey, type PendingAnswer, type RegionKeyInput } from '../src/lib/io/regionKey.ts'
import type { ExportInput } from '../src/lib/io/vmangosExport.ts'
import { LIQUID_WATER, LiquidMap, newLayer } from '../src/lib/water/liquids.ts'

test('the same content gives the same key, and any changed byte another', () => {
	const heights = new Float32Array([1, 2, 3, 4.5])
	const weights = new Uint8Array([0, 255, 7, 9, 11])
	const key = contentKey([heights, weights, '["a","b"]', null])
	assert.equal(contentKey([new Float32Array(heights), new Uint8Array(weights), '["a","b"]', null]), key)
	assert.match(key, /^[0-9a-f]{16}$/)
	const raised = new Float32Array(heights)
	raised[2] += 0.01
	assert.notEqual(contentKey([raised, weights, '["a","b"]', null]), key)
	const repainted = new Uint8Array(weights)
	repainted[4] = 12
	assert.notEqual(contentKey([heights, repainted, '["a","b"]', null]), key)
	assert.notEqual(contentKey([heights, weights, '["a","c"]', null]), key)
})

test('a byte moved from one part to the next, or an absent array given, changes the key', () => {
	assert.notEqual(contentKey([new Uint8Array([1, 2]), new Uint8Array([3])]), contentKey([new Uint8Array([1]), new Uint8Array([2, 3])]))
	assert.notEqual(contentKey([new Uint8Array([]), 'x']), contentKey([null, 'x']))
})

test('an unaligned view is read by its own bytes, as an aligned copy of them is', () => {
	const buf = new Uint8Array([9, 1, 2, 3, 4, 5, 6, 7, 8])
	const view = new Uint8Array(buf.buffer, 1, 8)
	assert.equal(contentKey([view]), contentKey([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]))
})

test('a remembered RegionPending answer holds until the history moves to another fingerprint (#531)', () => {
	let asked = 0
	const key = (k: string) => () => {
		asked++
		return k
	}
	assert.equal(cachedPending(null, 3, key('a')), null)
	const answer: PendingAnswer = { key: 'a', changes: 3, files: 2 }
	// The same step: no fingerprint worked out.
	assert.equal(cachedPending(answer, 3, key('a')), 2)
	assert.equal(asked, 0)
	// A step that leaves the fingerprint (a spawn edit, an undo back): still the answer, now at that step.
	assert.equal(cachedPending(answer, 5, key('a')), 2)
	assert.equal(asked, 1)
	assert.equal(answer.changes, 5)
	assert.equal(cachedPending(answer, 5, key('a')), 2)
	assert.equal(asked, 1)
	// An edit Compile would write: ask again.
	assert.equal(cachedPending(answer, 6, key('b')), null)
	assert.equal(answer.changes, 5)
})

// ---- the region's fingerprint against everything Compile writes (#433) ----------------------------

/** A layer of water `height` high over the whole chunk. */
function water(height: number) {
	const l = newLayer(LIQUID_WATER, height)
	l.cells.fill(1)
	l.depth.fill(0.5)
	return l
}

/** A 16-cell region (2 x 2 chunks) with something in every part: terrain, settings, a model, water. */
function region(): RegionKeyInput {
	const size = 16
	const chunks = (size / 8) ** 2
	const pattern = <T extends Uint8Array | Uint32Array | Float32Array>(a: T) => {
		for (let i = 0; i < a.length; i++) a[i] = (i * 37) % 200
		return a
	}
	const liquids = new LiquidMap(size)
	liquids.set(1, [water(3)])
	return {
		terrain: {
			heights: pattern(new Float32Array((size + 1) ** 2)),
			weights: pattern(new Uint8Array(64)),
			chunkSlots: pattern(new Uint8Array(chunks * 4)),
			holes: pattern(new Uint8Array(size * size)),
			noEffect: pattern(new Uint8Array(size * size)),
			areaIds: pattern(new Uint32Array(chunks)),
			chunkFlags: pattern(new Uint8Array(chunks)),
			shadow: pattern(new Uint8Array(32)),
		},
		settings: {
			palette: ['tileset\\a.blp', 'tileset\\b.blp'],
			textureEffects: { 'tileset\\a.blp': 4 },
			textureLooks: { 'tileset\\b.blp': 1 },
			scopedEffects: { zones: { '12': { 'tileset\\a.blp': 7 } }, tiles: { '0,0': { 'tileset\\b.blp': 9 } } },
			chunkDataKnown: true,
			liquidsKnown: true,
			holesKnown: true,
		},
		objects: [{ uid: 41, type: 'm2:world\\tree.m2', x: 1, y: 2, z: 3, rotY: 0.5, tiltX: 0.1, tiltZ: 0.2, scale: 1 }],
		liquids,
	}
}

type Path = (string | number)[]
type Node = Record<string | number, unknown>

/** The value one step down: a LiquidMap's step is a chunk, whose layers come next. */
const step = (v: unknown, k: string | number): unknown => (v instanceof LiquidMap ? v.layers(k as number) : (v as Node)[k])

/** Every leaf of the input (a typed array, a primitive, null), found by walking it, so a field added later is walked too. */
function leaves(v: unknown, path: Path = []): Path[] {
	if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return [path]
	if (v instanceof LiquidMap) {
		const out: Path[] = []
		for (let c = 0; c < v.side * v.side; c++) if (v.layers(c).length) out.push(...leaves(v.layers(c), [...path, c]))
		return out
	}
	const keys = Object.keys(v)
	assert.ok(keys.length, `${path.join('.')} is empty in the fixture: give it a value, so its edits are checked`)
	return keys.flatMap((k) => leaves((v as Node)[k], [...path, Array.isArray(v) ? Number(k) : k]))
}

/** The leaf at `path`, and a setter for it. */
function at(input: RegionKeyInput, path: Path) {
	let parent: unknown = input
	for (const k of path.slice(0, -1)) parent = step(parent, k)
	const key = path[path.length - 1]
	return { value: (parent as Node)[key], set: (v: unknown) => ((parent as Node)[key] = v) }
}

/** A leaf changed as an edit would change it. */
function changed(v: unknown): unknown {
	if (v === null) return new Uint8Array(4).fill(1)
	if (ArrayBuffer.isView(v)) {
		const a = (v as Uint8Array).slice()
		a[0] = a[0] + 1
		return a
	}
	if (typeof v === 'boolean') return !v
	if (typeof v === 'number') return v + 1
	if (typeof v === 'string') return v + 'x'
	throw new Error(`no edit for a ${typeof v}`)
}

test('every part of the region changes the key when edited, and the key comes back when the edit is undone (#433)', () => {
	const base = regionKey(region())
	const paths = leaves(region())
	// The terrain's 8 arrays, the settings' 2 palette entries, 4 effect choices and 3 flags, the model's 9 fields and the layer's 4.
	assert.ok(paths.length >= 30, `only ${paths.length} leaves walked`)
	for (const path of paths) {
		const input = region()
		const leaf = at(input, path)
		const before = leaf.value
		leaf.set(ArrayBuffer.isView(before) ? (before as Uint8Array).slice() : before)
		assert.equal(regionKey(input), base, `${path.join('.')}: writing the same value changed the key`)
		leaf.set(changed(before))
		assert.notEqual(regionKey(input), base, `${path.join('.')}: an edit left the key as it was`)
		leaf.set(before)
		assert.equal(regionKey(input), base, `${path.join('.')}: undoing the edit gave another key`)
	}
})

/**
 * What each key of the export (and so of the tiles Compile writes) is built from, as edits to the
 * region's parts, or why the region save doesn't send it. Typed over every key of `ExportInput`, so a
 * key added there fails `make check` until it is mapped here, and so into `RegionKeyInput`.
 */
const exportSources: { [K in keyof ExportInput]-?: ((i: RegionKeyInput) => void)[] | { notSent: string } } = {
	size: { notSent: "the block's size, fixed while it is open; the arrays are sized by it" },
	cellSize: { notSent: "a 1.12 tile's cell, the same on every map" },
	heights: [(i) => (i.terrain.heights[20] += 0.5)],
	weights: [(i) => (i.terrain.weights[9] ^= 1)],
	chunkSlots: [(i) => (i.terrain.chunkSlots[2] += 1)],
	palette: [(i) => (i.settings.palette = ['tileset\\a.blp', 'tileset\\c.blp'])],
	effects: [(i) => (i.settings.textureEffects = { 'tileset\\a.blp': 5 })],
	looks: [(i) => (i.settings.textureLooks = {})],
	effectAt: [(i) => (i.settings.scopedEffects = { zones: {}, tiles: {} }), (i) => (i.terrain.areaIds[0] = 999)],
	// The cells under buildings are worked out from the models, so moving one counts.
	noEffect: [(i) => (i.terrain.noEffect[5] ^= 1), (i) => (i.objects = [{ ...i.objects[0], x: 50 }])],
	headers: [(i) => (i.terrain.areaIds[3] += 1), (i) => (i.terrain.chunkFlags[1] ^= 1), (i) => (i.settings.chunkDataKnown = false)],
	holes: [(i) => (i.terrain.holes[17] ^= 1)],
	holesAdd: [(i) => (i.settings.holesKnown = false)],
	shadows: [(i) => (i.terrain.shadow![4] ^= 1), (i) => (i.terrain.shadow = null)],
	objects: [(i) => (i.objects = [...i.objects, { ...i.objects[0], uid: 0 }]), (i) => (i.objects = [])],
	waterEnabled: { notSent: 'only a whole map made for the client publishes it (publishVmangosMap); a region keeps its water in liquids' },
	waterLevel: { notSent: 'only a whole map made for the client publishes it (publishVmangosMap); a region keeps its water in liquids' },
	// The region save sends the layers, and whether only the chunks that have some count (partialLiquids).
	liquids: [(i) => i.liquids.set(0, [water(1)]), (i) => i.liquids.set(1, []), (i) => (i.settings.liquidsKnown = false)],
}

test('every key of exportInput is built from a part of the region that changes the key (#433)', () => {
	const base = regionKey(region())
	for (const [key, sources] of Object.entries(exportSources)) {
		if (!Array.isArray(sources)) continue
		sources.forEach((edit, n) => {
			const input = region()
			edit(input)
			assert.notEqual(regionKey(input), base, `exportInput.${key}, edit ${n + 1}: the key stayed as it was`)
		})
	}
})
