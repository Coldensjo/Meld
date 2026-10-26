// Run with: bun test tests/terrainGenerate.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CoastShape, presetHeight, snowLine, type PresetId } from '../src/lib/terrain/presets.ts'
import { generateHeights, imageGroundHeights } from '../src/lib/terrain/generate.ts'

const CELL = 1600 / 3 / 128
const TILE = 1600 / 3

/** The highest ground of a preset on a map of `tiles` a side, sampled every 8 cells. */
function highest(id: PresetId, tiles: number, seed = 7): number {
	let max = -Infinity
	const n = tiles * 16
	for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) max = Math.max(max, presetHeight(id, i / n, j / n, seed, { tiles }))
	return max
}

/** The mean slope (yards over yards) of a preset round the map's middle, measured a cell apart. */
function meanSlope(id: PresetId, tiles: number, seed = 7): number {
	const step = CELL / (tiles * TILE)
	let sum = 0
	let n = 0
	for (let j = 0; j < 40; j++) {
		for (let i = 0; i < 40; i++) {
			const u = 0.45 + i * step * 3
			const v = 0.45 + j * step * 3
			const h = presetHeight(id, u, v, seed, { tiles })
			sum += Math.hypot(presetHeight(id, u + step, v, seed, { tiles }) - h, presetHeight(id, u, v + step, seed, { tiles }) - h) / CELL
			n++
		}
	}
	return sum / n
}

test('the presets stand in real yards: hills up to Elwynn heights, mountains far higher (#744)', () => {
	const hills = highest('hills', 4)
	assert.ok(hills > 35 && hills < 110, `hills ${hills}`)
	assert.ok(highest('mountains', 4) > 150, `mountains ${highest('mountains', 4)}`)
	assert.equal(presetHeight('flat', 0.5, 0.5, 1, { tiles: 2, relief: 2 }), 0)
})

test('detail keeps its size on a big map instead of stretching with it (#744)', () => {
	// Before #744 the noise was laid over the map's 0..1, so a 6x6 map's slopes were a sixth of a 1-tile map's.
	for (const id of ['hills', 'mountains'] as const) {
		const small = meanSlope(id, 1)
		const big = meanSlope(id, 6)
		assert.ok(big > small * 0.5, `${id}: 1 tile ${small.toFixed(3)}, 6 tiles ${big.toFixed(3)}`)
	}
})

test('Height scales the land above the sea and leaves the seabed; Roughness 0 drops the detail', () => {
	for (let k = 0; k < 200; k++) {
		const u = (k * 0.137) % 1
		const v = (k * 0.071) % 1
		const one = presetHeight('island', u, v, 3, { tiles: 3 })
		const two = presetHeight('island', u, v, 3, { tiles: 3, relief: 2 })
		assert.ok(Math.abs(two - (one > 0 ? one * 2 : one)) < 1e-9, `${u},${v}: ${one} ${two}`)
	}
	// Roughness lays a few yards of detail over the land, and none at 0.
	let sq = 0
	for (let k = 0; k < 400; k++) {
		const u = 0.3 + (k % 20) * 0.02
		const v = 0.3 + Math.floor(k / 20) * 0.02
		const d = presetHeight('hills', u, v, 7, { tiles: 2 }) - presetHeight('hills', u, v, 7, { tiles: 2, roughness: 0 })
		sq += d * d
	}
	const rms = Math.sqrt(sq / 400)
	assert.ok(rms > 1.5 && rms < 15, `detail ${rms} yd`)
})

test('erosion at creation is seeded, changes the ground and keeps it in range', () => {
	const size = 128
	const V = size + 1
	const plain = new Float32Array(V * V)
	const a = new Float32Array(V * V)
	const b = new Float32Array(V * V)
	generateHeights(plain, size, CELL, 'mountains', 11)
	generateHeights(a, size, CELL, 'mountains', 11, null, { erosion: 0.6 })
	generateHeights(b, size, CELL, 'mountains', 11, null, { erosion: 0.6 })
	assert.deepEqual(a, b)
	let moved = 0
	let maxPlain = -Infinity
	let maxA = -Infinity
	for (let i = 0; i < a.length; i++) {
		moved += Math.abs(a[i] - plain[i])
		maxPlain = Math.max(maxPlain, plain[i])
		maxA = Math.max(maxA, a[i])
		assert.ok(Number.isFinite(a[i]))
	}
	assert.ok(moved / a.length > 0.2, `moved ${moved / a.length} yd a vertex`)
	assert.ok(maxA <= maxPlain + 1, `eroded peak ${maxA} over ${maxPlain}`)
	// The plain sea and flat land stay as they are.
	const flat = new Float32Array(V * V)
	generateHeights(flat, size, CELL, 'flat', 1, null, { erosion: 1 })
	assert.ok(flat.every((h) => h === 0))
})

test('snow lies on high ground only, never on hilltops', () => {
	assert.ok(snowLine(0, highest('hills', 4)) > highest('hills', 4))
	assert.ok(snowLine(0, 260) < 260)
})

/** The share of a map's vertices reached from its middle without crossing ground steeper than 50 degrees (the server's walkable slope), and whether that reaches its edge. */
function walkOut(h: Float32Array, V: number): { escaped: boolean; reached: number } {
	const max = Math.tan((50 * Math.PI) / 180)
	const steep = (x: number, z: number) => {
		const gx = (h[z * V + Math.min(V - 1, x + 1)] - h[z * V + Math.max(0, x - 1)]) / (2 * CELL)
		const gz = (h[Math.min(V - 1, z + 1) * V + x] - h[Math.max(0, z - 1) * V + x]) / (2 * CELL)
		return Math.hypot(gx, gz) > max
	}
	const seen = new Uint8Array(V * V)
	const mid = Math.floor(V / 2)
	const stack = [mid * V + mid]
	seen[stack[0]] = 1
	let escaped = false
	let reached = 0
	while (stack.length) {
		const i = stack.pop()!
		reached++
		const x = i % V
		const z = (i - x) / V
		if (x === 0 || z === 0 || x === V - 1 || z === V - 1) escaped = true
		for (let dz = -1; dz <= 1; dz++) {
			for (let dx = -1; dx <= 1; dx++) {
				const xx = x + dx
				const zz = z + dz
				if (xx < 0 || zz < 0 || xx >= V || zz >= V || seen[zz * V + xx] || steep(xx, zz)) continue
				seen[zz * V + xx] = 1
				stack.push(zz * V + xx)
			}
		}
	}
	return { escaped, reached: reached / (V * V) }
}

test('a Canyon is plains no one can walk out of, eroded, low or rough', () => {
	for (const tiles of [1, 2]) {
		for (const o of [{}, { erosion: 0.5 }, { erosion: 1, relief: 0.4, roughness: 2 }]) {
			for (const seed of [1, 2]) {
				const size = tiles * 128
				const V = size + 1
				const h = new Float32Array(V * V)
				generateHeights(h, size, CELL, 'canyon', seed, null, o)
				const walk = walkOut(h, V)
				const what = `${tiles} tiles ${JSON.stringify(o)} seed ${seed}`
				assert.ok(!walk.escaped, `walked out of ${what}`)
				assert.ok(walk.reached > 0.1, `floor ${walk.reached} of ${what}`)
				const mid = Math.floor(V / 2)
				assert.ok(h[mid * V + mid] < 40, `floor ${h[mid * V + mid]} of ${what}`)
				assert.ok(h[0] > 250, `corner ${h[0]} of ${what}`)
			}
		}
	}
})

test('the open sea goes deep over a seabed with relief, deeper with Sea depth, and stays under the water', () => {
	const depths = (seaDepth: number) => {
		let lo = Infinity
		let hi = -Infinity
		let sum = 0
		for (let k = 0; k < 400; k++) {
			const h = presetHeight('ocean', (k % 20) / 20, Math.floor(k / 20) / 20, 5, { tiles: 4, seaDepth })
			lo = Math.min(lo, h)
			hi = Math.max(hi, h)
			sum += h
		}
		return { lo, hi, mean: sum / 400 }
	}
	const one = depths(1)
	assert.ok(one.mean < -35 && one.lo < -60, `mean ${one.mean}, deepest ${one.lo}`)
	assert.ok(one.hi <= -4 && one.hi - one.lo > 30, `seabed ${one.lo}..${one.hi}`)
	assert.ok(depths(2.5).mean < one.mean - 40, `${depths(2.5).mean} against ${one.mean}`)
	// An island's open water goes down to the seabed, its lakes stay shallow and its land stays put.
	assert.ok(presetHeight('island', 0.02, 0.02, 5, { tiles: 4 }) < -25)
	assert.equal(presetHeight('island', 0.5, 0.5, 5, { tiles: 4, seaDepth: 3 }), presetHeight('island', 0.5, 0.5, 5, { tiles: 4 }))
})

test('Land moves the shore: a small island at 0, the default coast at 0.5, land to the edge at 1', () => {
	const share = (id: PresetId, land?: number, shape?: CoastShape) => {
		let n = 0
		const N = 40
		for (let k = 0; k < N * N; k++) if (presetHeight(id, (k % N) / (N - 1), Math.floor(k / N) / (N - 1), 5, { tiles: 4, land, shape }) > 0) n++
		return n / (N * N)
	}
	for (const id of ['island', 'hills', 'mountains', 'archipelago'] as const) {
		const s = [0, 0.25, 0.5, 0.75, 1].map((l) => share(id, l))
		for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1], `${id} land share ${s}`)
		assert.ok(s[4] > s[0] + 0.3, `${id} land share ${s}`)
		assert.equal(share(id, 0.5), share(id), id)
	}
	assert.ok(share('hills', 0) < 0.25 && share('hills', 0) > 0.01)
	assert.ok(share('hills', 1) > 0.85)
	// An L of tiles goes through CoastShape.
	const mask = new Uint8Array([1, 1, 1, 0])
	const shape = new CoastShape(mask, 2)
	assert.ok(share('hills', 1, shape) > share('hills', 0, shape) + 0.2)
	// Canyon and the open sea ignore it.
	assert.equal(presetHeight('canyon', 0.3, 0.4, 5, { tiles: 4, land: 0 }), presetHeight('canyon', 0.3, 0.4, 5, { tiles: 4, land: 1 }))
})

test('a world from a heightmap stretches the image over the map between its black and white heights (#745)', () => {
	// A 3x3 image: black left, mid grey in the middle column, white right (heights as internal/heightmap decodes them).
	const img = { side: 3, heights: [-1024, 0, 1024, -1024, 0, 1024, -1024, 0, 1024] }
	const size = 8
	const out = new Float32Array((size + 1) ** 2)
	imageGroundHeights(out, size, CELL, { img, min: -40, max: 200, sea: true })
	const at = (x: number, z: number) => out[z * (size + 1) + x]
	assert.equal(at(0, 0), -40)
	assert.equal(at(size, size), 200)
	assert.ok(Math.abs(at(size / 2, 3) - 80) < 1e-4, `middle ${at(size / 2, 3)}`)
	// Bilinear between the samples: a quarter of the way across is a quarter of the way up to the grey.
	assert.ok(Math.abs(at(2, 5) - 20) < 1e-4, `quarter ${at(2, 5)}`)
	// Erosion leaves the range roughly where it was but moves the ground.
	const eroded = new Float32Array(out.length)
	imageGroundHeights(eroded, size, CELL, { img, min: -40, max: 200, sea: true }, 1, 3)
	assert.ok(eroded.some((v, i) => Math.abs(v - out[i]) > 1e-3))
})
