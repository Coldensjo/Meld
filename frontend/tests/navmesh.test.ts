// Run with: bun test tests/navmesh.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
	AREA_GROUND,
	AREA_GROUND_MODEL,
	AREA_STEEP,
	AREA_STEEP_MODEL,
	AREA_WATER,
	AREA_WATER_TRANSITION,
	NAV_GROUND,
	NAV_WATER,
	TileBuilder,
	loadRecast,
	markAreas,
	vmangosSettings,
	type TileInput,
} from '../src/lib/world/nav/navBuild.ts'
import { TileGatherer, placeFaces, type NavGround, type PlacedCollision } from '../src/lib/world/nav/navGeometry.ts'
import { NavLiquids } from '../src/lib/world/nav/navLiquids.ts'
import { HOLE_FIRST } from '../src/lib/terrain/holes.ts'
import { columnSpans, heightfieldSpans } from '../src/lib/world/nav/navFilters.ts'
import { LIQUID_OCEAN, LIQUID_WATER, LiquidMap, newLayer } from '../src/lib/water/liquids.ts'

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
	const cx = Math.floor(x / g.cellSize), cz = Math.floor(z / g.cellSize)
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
		let x = 0, z = 0
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
				const cx = Math.round(t.pos[v] / CELL), cz = Math.round(t.pos[v + 2] / CELL)
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
	const a = new THREE.Vector3().fromArray(p.tris, 0), b = new THREE.Vector3().fromArray(p.tris, 3), c = new THREE.Vector3().fromArray(p.tris, 6)
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
	assert.ok(path.path.some((p) => p.z > 50), 'the path went through the wall')
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
	assert.ok(round.path.some((p) => p.z > 60), 'the path stepped over the fence')
	model.done()
	// The same 1.5 yd step in the terrain itself: a raised strip of cells, which the 1.8 yd climb takes.
	const t = flat(16)
	for (let z = 0; z <= 16; z++) for (let x = 7; x <= 8; x++) t.heights[z * t.verts + x] = 11.5
	const ground = await buildNav(t, [])
	const over = ground.path(a, b, NAV_GROUND)
	assert.ok(over.success && over.short < 0.5, 'no path over the terrain step')
	assert.ok(over.path.every((p) => p.z < 50), 'the path went round the terrain step')
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

test("the sea is ocean over the cells whose ground lies below it, where no painted layer is", () => {
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
