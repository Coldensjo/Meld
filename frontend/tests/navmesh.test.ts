// Run with: node --import ./tests/register.mjs --test tests/navmesh.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { AREA_GROUND, AREA_STEEP, TileBuilder, loadRecast, markAreas, vmangosSettings, type TileInput } from '../src/lib/world/nav/navBuild.ts'
import { TileGatherer, placeFaces, type NavGround, type PlacedCollision } from '../src/lib/world/nav/navGeometry.ts'

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
	assert.equal(face(70, true), 0)
	assert.equal(face(80, false), 0)
	// Facing down is never walkable.
	const down: TileInput = { pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), vertCount: 3, idx: new Int32Array([0, 1, 2]), triCount: 1, modelFrom: 1, minY: 0, maxY: 0 }
	const out = new Uint8Array(1)
	markAreas(down, s, out)
	assert.equal(out[0], 0)
})

test('the gatherer takes the ground under the box, leaves holes out and drops faces below the ground', () => {
	const g = flat(16)
	g.holes[2 * 16 + 2] = 1
	const gather = new TileGatherer()
	const cave = placeFaces(box(1, 2, 1, 3, 4, 3), new THREE.Matrix4().elements) // under the ground at 10
	const crate = placeFaces(box(1, 9, 1, 3, 12, 3), new THREE.Matrix4().elements)
	const t = gather.gather(g, [cave, crate], 0, 0, 3 * CELL - 0.01, 3 * CELL - 0.01, groundAt(g))
	// 3x3 cells, one a hole: 8 cells of two triangles.
	assert.equal(t.modelFrom, 16)
	// The cave box is gone; the crate's 12 faces stay, but its bottom corners lie below the ground
	// only along the bottom face (the sides reach above it).
	assert.ok(t.triCount - t.modelFrom >= 10 && t.triCount - t.modelFrom <= 12, `models gave ${t.triCount - t.modelFrom} faces`)
	assert.equal(t.minY, 9)
	assert.equal(t.maxY, 12)
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
