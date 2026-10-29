// Run with: bun test tests/navmesh.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
	AREA_GROUND,
	AREA_GROUND_MODEL,
	AREA_MAGMA,
	AREA_SLIME,
	AREA_STEEP,
	AREA_STEEP_MODEL,
	AREA_WATER,
	AREA_WATER_TRANSITION,
	NAV_GROUND,
	NAV_WATER,
	TileBuilder,
	loadRecast,
	markAreas,
	runTileJob,
	tileBuffers,
	tileJob,
	vmangosSettings,
	type TileInput,
} from '../src/lib/world/nav/navBuild.ts'
import { TileGatherer, adtGroundSpan, adtHeightSpan, cellLift, groupStarts, liquidTypeArea, placeFaces, placeGroups, placedBox, placedBoxes, typeIndex, type NavGround, type PlacedCollision } from '../src/lib/world/nav/navGeometry.ts'
import { NavLiquids } from '../src/lib/world/nav/navLiquids.ts'
import { HOLE_CELL, HOLE_FIRST } from '../src/lib/terrain/holes.ts'
import { columnSpans, heightfieldSpans } from '../src/lib/world/nav/navFilters.ts'
import { LIQUID_OCEAN, LIQUID_WATER, LiquidMap, newLayer } from '../src/lib/water/liquids.ts'
import { NavScene, PlacedModels, groundUpdate, liquidsUpdate, rowsUpdate, sceneCopy, type LocalFaces, type ScenePlacement, type SceneUpdate } from '../src/lib/world/nav/navScene.ts'
import { heightAt } from '../src/lib/terrain/heightField.ts'

const CELL = 1600 / 3 / 128

/** A flat ground of `size` cells at height 10. */
function flat(size: number): NavGround {
	const verts = size + 1
	return { size, verts, cellSize: CELL, heights: new Float32Array(verts * verts).fill(10), holes: new Uint8Array(size * size) }
}

/** A closed box's faces from min to max, wound outward. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
	const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed()
	g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
	return new Float32Array(g.attributes.position.array)
}

const groundAt = (g: NavGround) => (x: number, z: number) => {
	const cx = Math.floor(x / g.cellSize),
		cz = Math.floor(z / g.cellSize)
	return cx < 0 || cz < 0 || cx >= g.size || cz >= g.size ? null : g.heights[cz * g.verts + cx]
}

test('a triangle is ground to 52°, steep to the terrain or model limit, and nothing past it', () => {
	const s = vmangosSettings(true)
	// A face rising toward +x at the given slope; corners (0,0,0), (0,0,1), (1,tan,0) wind it up.
	const face = (deg: number, model: boolean): number => {
		const t = Math.tan((deg * Math.PI) / 180)
		const input: TileInput = { pos: new Float32Array([0, 0, 0, 0, 0, 1, 1, t, 0]), vertCount: 3, idx: new Int32Array([0, 1, 2]), triCount: 1, modelFrom: model ? 0 : 1, minY: 0, maxY: t }
		const out = new Uint8Array(1)
		markAreas(input, s, out)
		return out[0]
	}
	assert.equal(face(30, false), AREA_GROUND)
	assert.equal(face(60, false), AREA_STEEP)
	assert.equal(face(70, false), AREA_STEEP)
	assert.equal(face(30, true), AREA_GROUND_MODEL)
	assert.equal(face(60, true), AREA_STEEP_MODEL)
	assert.equal(face(70, true), 0)
	assert.equal(face(80, false), 0)
	// Facing down is never walkable.
	const down: TileInput = { pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), vertCount: 3, idx: new Int32Array([0, 1, 2]), triCount: 1, modelFrom: 1, minY: 0, maxY: 0 }
	const out = new Uint8Array(1)
	markAreas(down, s, out)
	assert.equal(out[0], 0)
})

test('the gatherer takes the ground under the box, leaves holes out, cuts the ground out of a crate and drops faces under the map', () => {
	const g = flat(16)
	g.holes[2 * 16 + 2] = 1
	const gather = new TileGatherer()
	const sunk = placeFaces(box(5, 2, 5, 7, 4, 7), new THREE.Matrix4().elements) // wholly under the ground at 10
	const crate = placeFaces(box(1, 9, 1, 3, 12, 3), new THREE.Matrix4().elements)
	const t = gather.gather(g, [sunk, crate], 0, 0, 3 * CELL - 0.01, 3 * CELL - 0.01, groundAt(g))
	// 3x3 cells, one a hole: 8 cells of four triangles about their middles. The crate stands in the
	// first cell over its middle, so each of that cell's triangles is cut back to the crate's walls
	// and gains the two triangles (both ways up) that close the cut: 8 more.
	assert.equal(t.modelFrom, 40)
	for (let i = 0; i < t.modelFrom; i++) {
		let x = 0,
			z = 0
		for (let k = 0; k < 3; k++) {
			x += t.pos[t.idx[i * 3 + k] * 3] / 3
			z += t.pos[t.idx[i * 3 + k] * 3 + 2] / 3
		}
		assert.ok(!(x > 1 && x < 3 && z > 1 && z < 3), `ground triangle ${i} lies inside the crate`)
	}
	// Under the map is a face whose corners lie 0.2 yd or more under the ground with an upward face
	// nearest over them: inside a solid. The crate's bottom goes (its top is over it) and its sides,
	// which reach over the ground, stay: 10 faces. The sunk box keeps only its top, which nothing
	// lies over: 2 faces, the lowest corners.
	assert.equal(t.triCount - t.modelFrom, 12)
	assert.equal(t.minY, 4)
	assert.equal(t.maxY, 12)
})

test("a region's cell middle sits at the corners' mean plus the client's inner lift, and counts in the tile's span (#284)", () => {
	const g = flat(16)
	g.innerLift = new Float32Array(16 * 16)
	g.innerLift[1 * 16 + 1] = 0.5
	g.innerLift[2 * 16 + 0] = -0.25
	const t = new TileGatherer().gather(g, [], 0, 0, 3 * CELL - 0.01, 3 * CELL - 0.01, groundAt(g))
	const middle = (cx: number, cz: number) => {
		for (let v = 0; v < t.vertCount; v++) {
			if (Math.abs(t.pos[v * 3] - (cx + 0.5) * CELL) < 1e-4 && Math.abs(t.pos[v * 3 + 2] - (cz + 0.5) * CELL) < 1e-4) return t.pos[v * 3 + 1]
		}
		return NaN
	}
	assert.ok(Math.abs(middle(1, 1) - 10.5) < 1e-5)
	assert.ok(Math.abs(middle(0, 2) - 9.75) < 1e-5)
	assert.equal(middle(2, 2), 10)
	assert.ok(Math.abs(t.maxY - 10.5) < 1e-5 && Math.abs(t.minY - 9.75) < 1e-5)
	const span = adtHeightSpan(g, [], 0, 0, 16 * CELL, null, [0, 0])
	assert.ok(Math.abs(span[0] - 9.75) < 1e-5 && Math.abs(span[1] - 10.5) < 1e-5)
	// Without lifts every middle is the corners' mean.
	g.innerLift = null
	const flatTile = new TileGatherer().gather(g, [], 0, 0, 3 * CELL - 0.01, 3 * CELL - 0.01, groundAt(g))
	assert.equal(flatTile.maxY, 10)
})

test('the ground span, a deep chunk asked once a run, is every cell taken one by one, its own and a row of each neighbour (#868)', () => {
	// Four client tiles of 16 cells, liquid chunks of 8: random heights, holes, lifts and a sculpted corner.
	const g = flat(32)
	let seed = 7
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
	for (let i = 0; i < g.heights.length; i++) g.heights[i] = rnd() * 40
	g.innerBase = g.heights.slice()
	g.innerLift = new Float32Array(32 * 32)
	for (let i = 0; i < g.innerLift.length; i++) g.innerLift[i] = rnd() * 6 - 3
	g.heights[20 * g.verts + 9] += 1
	for (let i = 0; i < g.holes.length; i++) if (rnd() < 0.1) g.holes[i] = HOLE_CELL
	// The chunk (1, 2) is deep: cells 8..15, 16..23.
	const deep = (gx: number, gz: number) => gx >= 8 && gx < 16 && gz >= 16 && gz < 24
	const adt = 16 * CELL
	for (const [ax, az] of [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
	]) {
		let lo = Infinity
		let hi = -Infinity
		for (let gz = Math.max(0, az * 16 - 1); gz <= Math.min(31, az * 16 + 16); gz++) {
			for (let gx = Math.max(0, ax * 16 - 1); gx <= Math.min(31, ax * 16 + 16); gx++) {
				if (g.holes[gz * 32 + gx] === HOLE_CELL || deep(gx, gz)) continue
				const i = gz * g.verts + gx
				const c = [g.heights[i], g.heights[i + 1], g.heights[i + g.verts], g.heights[i + g.verts + 1]]
				c.push((c[0] + c[1] + c[2] + c[3]) / 4 + cellLift(g, gx, gz))
				lo = Math.min(lo, ...c)
				hi = Math.max(hi, ...c)
			}
		}
		assert.deepEqual(adtGroundSpan(g, ax, az, adt, deep, [0, 0]), [lo, hi], `tile ${ax}, ${az}`)
		assert.deepEqual(adtHeightSpan(g, [], ax, az, adt, deep, [0, 0]), [lo, hi], `tile ${ax}, ${az} with no models`)
	}
})

test("a sculpted cell's middle sits at its corners' mean, as the export writes it (#380)", () => {
	const g = flat(16)
	g.innerLift = new Float32Array(16 * 16).fill(2)
	g.innerBase = g.heights.slice()
	assert.equal(cellLift(g, 5, 5), 2)
	// Lower the corner shared by cells (4..5, 4..5): those four lose the client's lift, their neighbours keep it.
	g.heights[5 * g.verts + 5] = 6
	for (const [x, z] of [
		[4, 4],
		[5, 4],
		[4, 5],
		[5, 5],
	])
		assert.equal(cellLift(g, x, z), 0)
	for (const [x, z] of [
		[3, 5],
		[6, 5],
		[5, 3],
		[5, 6],
		[0, 0],
	])
		assert.equal(cellLift(g, x, z), 2)
	// Float noise is not a sculpt.
	g.heights[5 * g.verts + 5] = 10 + 1e-4
	assert.equal(cellLift(g, 5, 5), 2)
	// Without the base heights, every cell keeps its lift.
	g.heights[5 * g.verts + 5] = 6
	g.innerBase = null
	assert.equal(cellLift(g, 5, 5), 2)
})

test("a half-cell hole leaves out the same world triangle whatever the tile's first cell", () => {
	const g = flat(16)
	g.holes[3 * 16 + 4] = HOLE_FIRST // x+z odd: the first triangle holds the cell's (0,0) corner
	const gather = new TileGatherer()
	// The cell's three corners of each triangle the gatherer kept, as world-space keys.
	const triangles = (x0: number, z0: number): Set<string> => {
		const t = gather.gather(g, [], x0 * CELL + 0.01, z0 * CELL + 0.01, 6 * CELL - 0.01, 6 * CELL - 0.01, groundAt(g))
		const out = new Set<string>()
		for (let i = 0; i < t.modelFrom; i++) {
			const key: string[] = []
			let inCell = true
			for (let k = 0; k < 3; k++) {
				const v = t.idx[i * 3 + k] * 3
				const cx = Math.round(t.pos[v] / CELL),
					cz = Math.round(t.pos[v + 2] / CELL)
				// A solid cell's triangles meet at its middle, off the grid.
				if (Math.abs(t.pos[v] / CELL - cx) > 1e-3 || Math.abs(t.pos[v + 2] / CELL - cz) > 1e-3) inCell = false
				if (cx < 4 || cx > 5 || cz < 3 || cz > 4) inCell = false
				key.push(`${cx},${cz}`)
			}
			if (inCell) out.add(key.sort().join(' '))
		}
		return out
	}
	const even = triangles(2, 2) // first cell x+z even
	const odd = triangles(3, 2) // first cell x+z odd
	assert.equal(even.size, 1)
	assert.deepEqual([...odd], [...even])
	// The kept triangle is the second one, without the (0,0) corner.
	assert.deepEqual([...even], ['4,4 5,3 5,4'])
})

test('a mirrored placement winds the faces back outward', () => {
	const local = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]) // facing up
	const m = new THREE.Matrix4().makeScale(-1, 1, 1)
	const p = placeFaces(local, m.elements)
	const a = new THREE.Vector3().fromArray(p.tris, 0),
		b = new THREE.Vector3().fromArray(p.tris, 3),
		c = new THREE.Vector3().fromArray(p.tris, 6)
	const n = b.sub(a).cross(c.sub(a))
	assert.ok(n.y > 0, 'the mirrored face turned down')
})

test('a navmesh over flat ground walks around a wall and not through a cliff-high box', async () => {
	const r = await loadRecast()
	const s = vmangosSettings(true)
	const g = flat(16) // 66.7 yd a side: about 3 x 3 tiles
	const wall = placeFaces(box(20, 5, 0, 22, 16, 50), new THREE.Matrix4().elements)
	const builder = new TileBuilder(r, s)
	const gather = new TileGatherer()
	const nav = new r.NavMesh()
	assert.ok(nav.initTiled(r.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: s.tileYards, tileHeight: s.tileYards, maxTiles: 64, maxPolys: 4096 })))
	const tiles = Math.ceil((16 * CELL) / s.tileYards)
	const border = s.borderSize * s.cs
	let ground = 0
	let steep = 0
	const t0 = performance.now()
	for (let tz = 0; tz < tiles; tz++) {
		for (let tx = 0; tx < tiles; tx++) {
			const input = gather.gather(g, [wall], tx * s.tileYards - border, tz * s.tileYards - border, (tx + 1) * s.tileYards + border, (tz + 1) * s.tileYards + border, groundAt(g))
			const built = builder.build(input, tx, tz)
			assert.ok(built, `tile ${tx},${tz} failed`)
			for (const a of built.areas) a === AREA_STEEP ? steep++ : ground++
			if (built.data) nav.addTile(built.data, r.Detour.DT_TILE_FREE_DATA, 0)
		}
	}
	const ms = (performance.now() - t0) / (tiles * tiles)
	assert.ok(ground > 0, 'no ground in the navmesh')
	assert.equal(steep, 0)
	assert.ok(ms < 200, `${ms.toFixed(1)} ms a tile`)
	const q = new r.NavMeshQuery(nav)
	// From west of the wall to east of it: the wall runs z 0..50, so the path goes round its end.
	const from = { x: 10, y: 10, z: 20 }
	const to = { x: 32, y: 10, z: 20 }
	const path = q.computePath(from, to, { halfExtents: { x: 2, y: 4, z: 2 } })
	assert.ok(path.success, `no path: ${path.error?.name}`)
	const end = path.path[path.path.length - 1]
	assert.ok(Math.hypot(end.x - to.x, end.z - to.z) < 0.5, 'the path stops short')
	assert.ok(
		path.path.some((p) => p.z > 50),
		'the path went through the wall',
	)
	// The wall's top (11 yd up) is ground of its own, but can't be reached from below.
	const top = q.findNearestPoly({ x: 21, y: 16, z: 25 }, { halfExtents: { x: 1, y: 1, z: 1 } })
	assert.ok(top.success && top.nearestRef !== 0, 'the wall top has no navmesh')
	const up = q.computePath(from, { x: 21, y: 16, z: 25 }, { halfExtents: { x: 1, y: 1, z: 1 } })
	const last = up.path[up.path.length - 1]
	assert.ok(!up.success || !last || last.y < 12, 'a path climbed the wall')
	builder.destroy()
	q.destroy()
	nav.destroy()
})

/** Builds every tile of ground `g` with `models` and `liquids` into a navmesh, counting each area's triangles. */
async function buildNav(g: NavGround, models: PlacedCollision[], liquids?: NavLiquids) {
	const r = await loadRecast()
	const s = vmangosSettings(true)
	const builder = new TileBuilder(r, s)
	const gather = new TileGatherer()
	const nav = new r.NavMesh()
	assert.ok(nav.initTiled(r.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: s.tileYards, tileHeight: s.tileYards, maxTiles: 256, maxPolys: 4096 })))
	const tiles = Math.ceil((g.size * CELL) / s.tileYards)
	const border = s.borderSize * s.cs
	const areas = new Map<number, number>()
	for (let tz = 0; tz < tiles; tz++) {
		for (let tx = 0; tx < tiles; tx++) {
			const input = gather.gather(g, models, tx * s.tileYards - border, tz * s.tileYards - border, (tx + 1) * s.tileYards + border, (tz + 1) * s.tileYards + border, groundAt(g), liquids)
			const built = builder.build(input, tx, tz)
			if (!built) continue
			for (const a of built.areas) areas.set(a, (areas.get(a) ?? 0) + 1)
			if (built.data) nav.addTile(built.data, r.Detour.DT_TILE_FREE_DATA, 0)
		}
	}
	builder.destroy()
	const q = new r.NavMeshQuery(nav)
	/** The path from a to b for a creature crossing polygons with `include`'s flags, and how far short of b it ends. */
	const path = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, include: number) => {
		const filter = new r.QueryFilter()
		filter.includeFlags = include
		const res = q.computePath(a, b, { filter, halfExtents: { x: 2, y: 4, z: 2 }, maxPathPolys: 2048 })
		r.Raw.destroy(filter.raw)
		const end = res.path[res.path.length - 1]
		return { ...res, short: end ? Math.hypot(end.x - b.x, end.z - b.z) : Infinity }
	}
	const done = () => {
		q.destroy()
		nav.destroy()
	}
	return { r, areas, q, path, done }
}

test("the span filters read the heightfield's spans where Recast keeps them", async () => {
	const r = await loadRecast()
	const ctx = new r.RecastBuildContext()
	const hf = r.allocHeightfield()
	assert.ok(r.createHeightfield(ctx, hf, 4, 4, [0, 0, 0], [4, 10, 4], 1, 0.25))
	const verts = new r.VerticesArray()
	verts.copy([0, 1, 0, 0, 1, 4, 4, 2, 0, 0, 5, 0, 0, 5, 4, 4, 5, 0])
	const tris = new r.TrianglesArray()
	tris.copy([0, 1, 2, 3, 4, 5])
	const areas = new r.TriangleAreasArray()
	areas.copy([AREA_GROUND, AREA_WATER])
	assert.ok(r.rasterizeTriangles(ctx, verts, 6, tris, areas, 2, hf, 0))
	const s = heightfieldSpans(r, hf)
	let seen = 0
	for (let i = 0; i < 16; i++) {
		const api: Array<[number, number, number]> = []
		for (let sp = hf.spans(i); sp && r.Raw.Module.getPointer(sp.raw); sp = sp.next()!) api.push([sp.smin(), sp.smax(), sp.area()])
		assert.deepEqual(columnSpans(s, i), api)
		seen += api.length
	}
	assert.ok(seen > 4)
	r.freeHeightfield(hf)
	verts.destroy()
	tris.destroy()
	areas.destroy()
})

test('a fence 1.5 yd high is stepped over on the terrain but not as a model', async () => {
	// A ridge across the way, z 0..60 of the 66.7 yd map: as a model a creature goes round its end.
	const g = flat(16)
	const fence = placeFaces(box(30, 9, 0, 30.6, 11.5, 60), new THREE.Matrix4().elements)
	const a = { x: 15, y: 10, z: 20 }
	const b = { x: 45, y: 10, z: 20 }
	const model = await buildNav(g, [fence])
	const round = model.path(a, b, NAV_GROUND)
	assert.ok(round.success && round.short < 0.5, 'no path round the fence')
	assert.ok(
		round.path.some((p) => p.z > 60),
		'the path stepped over the fence',
	)
	model.done()
	// The same 1.5 yd step in the terrain itself: a raised strip of cells, which the 1.8 yd climb takes.
	const t = flat(16)
	for (let z = 0; z <= 16; z++) for (let x = 7; x <= 8; x++) t.heights[z * t.verts + x] = 11.5
	const ground = await buildNav(t, [])
	const over = ground.path(a, b, NAV_GROUND)
	assert.ok(over.success && over.short < 0.5, 'no path over the terrain step')
	assert.ok(
		over.path.every((p) => p.z < 50),
		'the path went round the terrain step',
	)
	ground.done()
})

test('ground under deep water is swim area, under shallow water both walk and swim, and a deep ocean drops out', async () => {
	// 32 cells (133 yd) a side, 4 x 4 chunks: a river 2 yd deep down chunk column 1, a 0.5 yd ford down column 2.
	const g = flat(32)
	const map = new LiquidMap(32)
	const strip = (cx: number, id: number, height: number, depth = 1) => {
		for (let cz = 0; cz < 4; cz++) {
			const l = newLayer(id, height)
			l.cells.fill(1)
			l.depth.fill(depth)
			map.set(cz * 4 + cx, [l])
		}
	}
	strip(1, LIQUID_WATER, 12)
	strip(2, LIQUID_WATER, 10.5)
	const liquids = new NavLiquids()
	liquids.reset(map, g, null)
	const built = await buildNav(g, [], liquids)
	assert.ok((built.areas.get(AREA_WATER) ?? 0) > 0, 'no swim area')
	assert.ok((built.areas.get(AREA_WATER_TRANSITION) ?? 0) > 0, 'no shallow water')
	const west = { x: 15, y: 10, z: 60 }
	const ford = { x: 85, y: 10, z: 60 }
	const east = { x: 120, y: 10, z: 60 }
	const walk = built.path(west, east, NAV_GROUND)
	assert.ok(!walk.success || walk.short > 5, 'a walker crossed the river')
	const swim = built.path(west, east, NAV_GROUND | NAV_WATER)
	assert.ok(swim.success && swim.short < 0.5, 'a swimmer could not cross the river')
	const wade = built.path(ford, east, NAV_GROUND)
	assert.ok(wade.success && wade.short < 0.5, 'a walker could not wade the ford')
	built.done()

	// Ocean as deep as a depth byte goes is the client's dark water: no navmesh in its chunks at all.
	const sea = new LiquidMap(32)
	const deep = newLayer(LIQUID_OCEAN, 12)
	deep.cells.fill(1)
	sea.set(5, [deep]) // chunk (1, 1)
	const deepLiquids = new NavLiquids()
	deepLiquids.reset(sea, g, null)
	const out = await buildNav(g, [], deepLiquids)
	const inside = out.q.findNearestPoly({ x: 50, y: 10, z: 50 }, { halfExtents: { x: 2, y: 4, z: 2 } })
	assert.ok(!inside.success || !inside.nearestRef, 'the deep ocean chunk has navmesh')
	const outside = out.q.findNearestPoly({ x: 100, y: 10, z: 100 }, { halfExtents: { x: 2, y: 4, z: 2 } })
	assert.ok(outside.success && outside.nearestRef, 'the dry ground has no navmesh')
	out.done()
})

test('the sea is ocean over the cells whose ground lies below it, where no painted layer is', () => {
	const g = flat(16) // ground at 10
	for (let z = 0; z <= 16; z++) for (let x = 8; x <= 16; x++) g.heights[z * g.verts + x] = 20
	const map = new LiquidMap(16)
	const lake = newLayer(LIQUID_WATER, 15)
	lake.cells[0] = 1
	map.set(0, [lake])
	const liquids = new NavLiquids()
	liquids.reset(map, g, 12)
	const h = new Float32Array(4)
	assert.equal(liquids.cell(0, 0, h), AREA_WATER)
	assert.deepEqual([...h], [15, 15, 15, 15])
	assert.equal(liquids.cell(3, 3, h), AREA_WATER)
	assert.deepEqual([...h], [12, 12, 12, 12])
	assert.equal(liquids.cell(10, 3, h), 0, 'sea over ground above it')
	assert.equal(liquids.deep(3, 3), false)
})

test("a WMO's liquid over its floor is swim area, its type's low bits picking the area as the server's mmaps do", async () => {
	// A slab 2 yd over the ground, x 20..110, with a pool 2.5 yd deep across it at x 50..70, and a dry
	// grid vertex far below, which the model's box (the server's height span) still takes in.
	const g = flat(32)
	const slab = box(20, 9, 15, 110, 12, 115)
	const pool = (type: number) => ({
		verts: new Float32Array([50, 14.5, 10, 70, 14.5, 10, 50, 14.5, 120, 70, 14.5, 120, 60, -40, 60]),
		idx: new Uint32Array([0, 2, 3, 0, 3, 1]),
		types: new Uint32Array([type, type]),
	})
	const placed = placeFaces(slab, new THREE.Matrix4().elements, undefined, pool(1))
	assert.equal(placed.min[1], -40, 'the dry liquid vertex is out of the box')
	assert.deepEqual([...placed.liquid!.areas], [AREA_WATER, AREA_WATER])
	const input = new TileGatherer().gather(g, [placed], 40, 40, 80, 80, groundAt(g))
	assert.equal(input.liquidTriCount, 2)
	assert.equal(input.maxY, 14.5)

	const built = await buildNav(g, [placed])
	assert.ok((built.areas.get(AREA_WATER) ?? 0) > 0, 'no swim area over the floor')
	const west = { x: 35, y: 12, z: 60 }
	const east = { x: 95, y: 12, z: 60 }
	const walk = built.path(west, east, NAV_GROUND)
	assert.ok(!walk.success || walk.short > 5, 'a walker crossed the pool')
	const swim = built.path(west, east, NAV_GROUND | NAV_WATER)
	assert.ok(swim.success && swim.short < 0.5, 'a swimmer could not cross the pool')
	built.done()

	// Magma (LiquidType 3) comes out as slime, ocean (2) as magma and slime (4) as water.
	assert.deepEqual([3, 2, 4, 21].map(liquidTypeArea), [AREA_SLIME, AREA_MAGMA, AREA_WATER, AREA_WATER])
	const lava = await buildNav(g, [placeFaces(slab, new THREE.Matrix4().elements, undefined, pool(3))])
	assert.ok((lava.areas.get(AREA_SLIME) ?? 0) > 0, 'no slime area over the floor')
	assert.equal(lava.areas.get(AREA_WATER) ?? 0, 0)
	lava.done()
})

test("a worker's job (#508) builds the same tile as the main thread, from copies that own their buffers", async () => {
	const r = await loadRecast()
	const s = vmangosSettings(true)
	const g = flat(16)
	const wall = placeFaces(box(20, 5, 0, 22, 16, 50), new THREE.Matrix4().elements)
	const gather = new TileGatherer()
	const border = s.borderSize * s.cs
	const tx = 2
	const tz = 1
	const input = gather.gather(g, [wall], tx * s.tileYards - border, tz * s.tileYards - border, (tx + 1) * s.tileYards + border, (tz + 1) * s.tileYards + border, groundAt(g))
	const job = tileJob(input, true, tx, tz)
	// The copies hold just the used parts, apart from the gatherer's buffers, which it reuses.
	assert.equal(job.input.pos.length, input.vertCount * 3)
	assert.equal(job.input.idx.length, input.triCount * 3)
	assert.notEqual(job.input.pos.buffer, input.pos.buffer)
	assert.equal(tileBuffers(job).length, 2)
	const builder = new TileBuilder(r, s)
	const here = builder.build(input, tx, tz)
	assert.ok(here?.data)
	const out = runTileJob(r, new Map(), job)
	assert.ok(out?.data)
	assert.deepEqual(out.data, here.data.toTypedArray())
	assert.deepEqual(out.tris, here.tris)
	assert.deepEqual(out.areas, here.areas)
	assert.deepEqual(out.polys, here.polys)
	// Each array owns its buffer, so handing them over moves no more than they hold.
	for (const a of [out.data, out.tris, out.areas, out.polys]) assert.equal(a.byteLength, a.buffer.byteLength)
	assert.equal(tileBuffers(out).length, 4)
	// The bytes make a tile the navmesh takes.
	const nav = new r.NavMesh()
	assert.ok(nav.initTiled(r.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: s.tileYards, tileHeight: s.tileYards, maxTiles: 64, maxPolys: 4096 })))
	const data = new r.UnsignedCharArray()
	data.copy(out.data)
	assert.ok(!r.statusFailed(nav.addTile(data, 0, 0).status))
	nav.destroy()
	data.destroy()
	here.data.destroy()
	builder.destroy()
})

test("a worker's copy of the scene (#633) gathers the same triangles as the main thread, after whole and partial updates, placing only the models it meets (#849)", () => {
	const g = flat(32)
	g.innerLift = new Float32Array(32 * 32).fill(0.25)
	g.innerBase = g.heights.slice()
	for (let z = 0; z <= 32; z++) for (let x = 0; x <= 32; x++) g.heights[z * g.verts + x] = 10 + Math.sin(x * 0.7) * 2 + z * 0.1
	g.innerBase = g.heights.slice()
	const map = new LiquidMap(32)
	const lake = newLayer(LIQUID_WATER, 11)
	lake.cells.fill(1)
	map.set(1, [lake])
	const liquids = new NavLiquids()
	liquids.reset(map, g, 9.5)
	// Four model types: a crate, a wall in two groups, a far tower no gathered box meets, first in the
	// order, so the others' groups are numbered after its own, and a city whose box meets the job's but
	// whose middle group lies far off (#866), so it is neither sent nor placed.
	const city = new Float32Array([...box(44, 5, 5, 46, 14, 30), ...box(300, 0, 300, 310, 50, 310), ...box(50, 5, 40, 52, 12, 60)])
	const types = new Map<string, LocalFaces>([
		['m2:crate', { tris: box(10, 9, 10, 14, 13, 14), groups: Uint32Array.of(12), liquid: null }],
		['wmo:wall', { tris: box(40, 5, 5, 42, 16, 60), groups: Uint32Array.of(6, 6), liquid: null }],
		['wmo:tower', { tris: box(0, 0, 0, 10, 60, 10), groups: Uint32Array.of(4, 4, 4), liquid: null }],
		['wmo:city', { tris: city, groups: Uint32Array.of(12, 12, 12), liquid: null }],
	])
	const placement = (id: number, type: string, m: THREE.Matrix4): ScenePlacement => {
		const l = types.get(type)!
		const b = placedBoxes(l.tris, typeIndex(l.tris, l.groups, l.liquid), m.elements, l.liquid)
		assert.deepEqual(b.box, placedBox(l.tris, m.elements, l.liquid))
		return { id, type, matrix: new Float64Array(m.elements), groups: l.groups.length, box: b.box, groupBoxes: b.groups }
	}
	const placements = new Map<number, ScenePlacement>([
		[3, placement(3, 'wmo:tower', new THREE.Matrix4().setPosition(400, 0, 400))],
		[1, placement(1, 'm2:crate', new THREE.Matrix4())],
		[2, placement(2, 'wmo:wall', new THREE.Matrix4().makeRotationY(0.3).setPosition(5, 0, 3))],
		[4, placement(4, 'wmo:city', new THREE.Matrix4().makeRotationY(-0.1))],
	])
	// The main thread before #849: every model's faces placed.
	const allPlaced = () => [...placements.values()].map((p) => placeFaces(types.get(p.type)!.tris, p.matrix, types.get(p.type)!.groups))
	const worldSize = g.size * g.cellSize
	const at = (x: number, z: number) => (x >= 0 && z >= 0 && x <= worldSize && z <= worldSize ? heightAt(g.heights, g.size, g.cellSize, x, z) : null)
	const scene = new NavScene()
	// Each update goes through a copy, as postMessage hands it over, so the scene never shares the main thread's arrays.
	const send = (u: SceneUpdate[]) => {
		const c = sceneCopy(u)
		for (const x of c.updates) scene.apply(x)
		return c
	}
	// The tower's type is never sent: its box misses the job's; nor is the city's far group.
	const typeUpdate = (type: string, parts?: number[]): SceneUpdate => {
		const l = types.get(type)!
		const all = [...l.groups.keys()]
		const tris = parts ? new Float32Array(parts.flatMap((g) => [...l.tris.subarray(g * 12 * 9, (g + 1) * 12 * 9)])) : l.tris
		return { kind: 'type', type, groups: l.groups, liquid: l.liquid, parts: Uint32Array.from(parts ?? all), tris }
	}
	const sent = send([groundUpdate(g), liquidsUpdate(map, 9.5), typeUpdate('m2:crate'), typeUpdate('wmo:wall'), typeUpdate('wmo:city', [0, 2]), { kind: 'models', list: [...placements.values()] }])
	assert.ok(sent.transfer.length > 8)
	const job = { continent: true, tx: 0, tz: 0, x0: 0, z0: 0, x1: 80, z1: 70, floorY: -3, ceilY: 30 }
	// The main thread's own list places the faces only where the gather needs them too.
	const mainModels = new PlacedModels((t) => types.get(t) ?? null)
	const same = (why: string) => {
		mainModels.clear()
		for (const p of placements.values()) mainModels.set(p)
		const here = new TileGatherer().gather(g, allPlaced(), job.x0, job.z0, job.x1, job.z1, at, liquids)
		const there = scene.gather(job)
		const mine = new TileGatherer().gather(g, mainModels.forGather(g, job.x0, job.z0, job.x1, job.z1), job.x0, job.z0, job.x1, job.z1, at, liquids)
		assert.equal(there.floorY, -3)
		assert.equal(there.ceilY, 30)
		assert.ok(here.triCount > 0 && here.liquidTriCount! > 0, why)
		for (const other of [there, mine]) {
			for (const k of ['vertCount', 'triCount', 'modelFrom', 'minY', 'maxY', 'liquidVertCount', 'liquidTriCount'] as const) assert.equal(other[k], here[k], `${why}: ${k}`)
			assert.deepEqual(other.pos.subarray(0, other.vertCount * 3), here.pos.subarray(0, here.vertCount * 3), why)
			assert.deepEqual(other.idx.subarray(0, other.triCount * 3), here.idx.subarray(0, here.triCount * 3), why)
			assert.deepEqual(other.liquidPos!.subarray(0, other.liquidVertCount! * 3), here.liquidPos!.subarray(0, here.liquidVertCount! * 3), why)
			assert.deepEqual(other.liquidAreas!.subarray(0, other.liquidTriCount!), here.liquidAreas!.subarray(0, here.liquidTriCount!), why)
		}
		// The height span from the boxes alone is the one from the placed faces.
		assert.deepEqual(adtHeightSpan(g, mainModels.boxes(), 0, 0, 16 * CELL, null, [0, 0]), adtHeightSpan(g, allPlaced(), 0, 0, 16 * CELL, null, [0, 0]), why)
	}
	same('the whole scene')

	// A sculpt and a hole: only their rows go, and the chunks under them are forgotten on both sides.
	for (let z = 4; z <= 6; z++) for (let x = 3; x <= 9; x++) g.heights[z * g.verts + x] -= 3
	g.holes[5 * 32 + 20] = 1
	liquids.forget(2, 3, 21, 6)
	send([rowsUpdate(g, 4, 6), { kind: 'forget', gx0: 2, gz0: 3, gx1: 21, gz1: 6 }])
	same('after the sculpt and the hole')

	// A model moved (keeping its place in the order) and one dropped.
	placements.set(1, placement(1, 'm2:crate', new THREE.Matrix4().setPosition(6, 0, 4)))
	send([{ kind: 'place', placement: placements.get(1)! }])
	same('after the crate moved')
	placements.delete(2)
	send([{ kind: 'drop', id: 2 }])
	same('after the wall went')

	// A gather that meets a model whose type the worker lacks throws, so the workers give way to the main
	// thread; so does one that meets a group it was not sent, until it is.
	assert.throws(() => scene.gather({ ...job, x0: 390, z0: 390, x1: 420, z1: 420 }), /no collision faces for wmo:tower/)
	const far = { ...job, x0: 250, z0: 250, x1: 330, z1: 330 }
	assert.throws(() => scene.gather(far), /no collision faces for wmo:city/)
	send([typeUpdate('wmo:city', [1])])
	const farHere = new TileGatherer().gather(g, allPlaced(), far.x0, far.z0, far.x1, far.z1, at, liquids)
	const farThere = scene.gather(far)
	assert.ok(farHere.triCount > 0)
	assert.equal(farThere.triCount, farHere.triCount)
	assert.deepEqual(farThere.pos.subarray(0, farThere.vertCount * 3), farHere.pos.subarray(0, farHere.vertCount * 3))
	// The near job again, with the city's far group now placed beside the others.
	same('after the far group came')
})

test("a placement's box from its groups' (#866) is placedBox's to the bit, turned, mirrored and with liquids, and each group's box holds its faces", () => {
	const local = new Float32Array([...box(-3, 0, -2, 5, 7, 4), ...box(20, -4, 1, 21, 30, 2), ...box(0.5, 1, 0.5, 1, 2, 1), ...box(-40, 3, 9, -39, 4, 60)])
	const groups = Uint32Array.of(12, 12, 0, 12, 12)
	const liquid = { verts: new Float32Array([0, 2, 0, 4, 2, 0, 0, 2, 3, 9, -30, 9]), idx: new Uint32Array([0, 2, 1]), types: new Uint32Array([1]) }
	const index = typeIndex(local, groups, liquid)
	const starts = groupStarts(groups)
	const matrices = [
		new THREE.Matrix4(),
		new THREE.Matrix4().makeRotationY(2.2).setPosition(-8123.4, 12.5, 4410.75),
		new THREE.Matrix4().compose(new THREE.Vector3(123.4, 56.7, 890.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, -0.4)), new THREE.Vector3(1.3, 1.3, -1.3)),
	]
	for (const m of matrices) {
		for (const l of [liquid, null]) {
			const b = placedBoxes(local, index, m.elements, l)
			assert.deepEqual(b.box, placedBox(local, m.elements, l))
			const faces = placeFaces(local, m.elements, groups, l)
			for (let g = 0; g < groups.length; g++) {
				for (let k = starts[g] * 9; k < starts[g + 1] * 9; k += 3) {
					for (let a = 0; a < 3; a++) assert.ok(faces.tris[k + a] >= b.groups[g * 6 + a] && faces.tris[k + a] <= b.groups[g * 6 + 3 + a], `group ${g}`)
				}
			}
			// Placing the groups bit by bit, a mirror wound back, gives placeFaces's own.
			const want = new Uint8Array(groups.length)
			want[1] = 1
			let some = placeGroups(local, groups, m.elements, want, b.box, l, null)
			want.fill(1)
			some = placeGroups(local, groups, m.elements, want, b.box, l, some)
			assert.deepEqual(some.tris, faces.tris)
			assert.deepEqual(some.groups, groups)
			assert.deepEqual(some.liquid, faces.liquid)
		}
	}
})

test("a placement's box (#849) is the one its placed faces get, liquids and a mirror too", () => {
	const local = box(-3, 0, -2, 5, 7, 4)
	const liquid = { verts: new Float32Array([0, 2, 0, 4, 2, 0, 0, 2, 3, 9, -30, 9]), idx: new Uint32Array([0, 2, 1]), types: new Uint32Array([1]) }
	const m = new THREE.Matrix4().compose(new THREE.Vector3(123.4, 56.7, 890.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, -0.4)), new THREE.Vector3(1.3, 1.3, -1.3))
	const faces = placeFaces(local, m.elements, undefined, liquid)
	const b = placedBox(local, m.elements, liquid)
	assert.deepEqual(b.min, faces.min)
	assert.deepEqual(b.max, faces.max)
	assert.deepEqual(b.origin, faces.origin)
	assert.deepEqual(placedBox(local, m.elements).max, placeFaces(local, m.elements).max)
})
