// Run with: node --import ./tests/register.mjs --test tests/navServer.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { AREA_GROUND, AREA_MAGMA, AREA_STEEP, AREA_WATER, AREA_WATER_TRANSITION, NAV_GROUND, NAV_MAGMA, NAV_STEEP, NAV_WATER, TileBuilder, loadRecast, vmangosSettings } from '../src/lib/world/nav/navBuild.ts'
import { TileGatherer, placeFaces, type NavGround } from '../src/lib/world/nav/navGeometry.ts'
import { detourSurface, flagsArea, navPoint, parseNavTile } from '../src/lib/world/nav/navServer.ts'
import { serverSpot } from '../src/lib/io/portCoords.ts'

const CELL = 1600 / 3 / 128

test("a point goes into the server's Detour frame and back by the same sum", () => {
	const p = { x: 100.5, y: 42, z: 300.25 }
	const n = navPoint(p, 32, 48, { x: 0, y: 0, z: 0 })
	// Detour's axes are WoW's y, height, x.
	const s = serverSpot(p, 0, 32, 48)
	assert.ok(Math.abs(n.x - s.y) < 1e-3 && Math.abs(n.z - s.x) < 1e-3 && n.y === s.z)
	const back = navPoint(n, 32, 48, { x: 0, y: 0, z: 0 })
	assert.ok(Math.abs(back.x - p.x) < 1e-3 && Math.abs(back.z - p.z) < 1e-3 && back.y === p.y)
})

test("a server polygon's colour comes from its flags as TileWorker sets them", () => {
	assert.equal(flagsArea(NAV_GROUND), AREA_GROUND)
	assert.equal(flagsArea(NAV_GROUND | NAV_STEEP), AREA_STEEP)
	assert.equal(flagsArea(NAV_GROUND | NAV_WATER), AREA_WATER_TRANSITION)
	assert.equal(flagsArea(NAV_WATER), AREA_WATER)
	assert.equal(flagsArea(NAV_MAGMA), AREA_MAGMA)
})

test("a Detour tile's surface reads back as built, and a copy of its bytes paths in a navmesh", async () => {
	const r = await loadRecast()
	const s = vmangosSettings(true)
	const size = 8
	const g: NavGround = { size, verts: size + 1, cellSize: CELL, heights: new Float32Array((size + 1) * (size + 1)).fill(10), holes: new Uint8Array(size * size) }
	const wall = placeFaces(new Float32Array(new THREE.BoxGeometry(2, 11, 12).translate(8, 10.5, 9).toNonIndexed().attributes.position.array), new THREE.Matrix4().elements)
	const groundAt = (x: number, z: number) => (x < 0 || z < 0 || x >= size * CELL || z >= size * CELL ? null : 10)
	const builder = new TileBuilder(r, s)
	const border = s.borderSize * s.cs
	const input = new TileGatherer().gather(g, [wall], -border, -border, s.tileYards + border, s.tileYards + border, groundAt)
	const built = builder.build(input, 0, 0)
	builder.destroy()
	assert.ok(built?.data)
	const bytes = built.data.toTypedArray()
	built.data.destroy()

	// The surface Detour keeps is the build's detail mesh.
	const surface = detourSurface(bytes)
	assert.equal(surface.areas.length, built.areas.length)
	assert.ok(surface.areas.every((a) => a === AREA_GROUND))
	// Recast lifts the detail mesh's copy of a polygon's corners by a voxel (rcBuildPolyMeshDetail's
	// "is this offset necessary?"), which Detour's own copy hasn't.
	for (let i = 0; i < built.tris.length; i++) assert.ok(Math.abs(surface.tris[i] - built.tris[i]) < (i % 3 === 1 ? s.ch + 1e-3 : 1e-3), `corner ${i}`)
	assert.deepEqual(Array.from(surface.polys), Array.from(built.polys))

	// As /wow/navtile sends it: the params, then the tile.
	const buf = new ArrayBuffer(20 + bytes.length)
	new Float32Array(buf, 0, 5).set([0, 0, 0, s.tileYards, s.tileYards])
	new Uint8Array(buf, 20).set(bytes)
	const t = parseNavTile(buf)
	assert.equal(t.tileWidth, Math.fround(s.tileYards))
	const nav = new r.NavMesh()
	assert.ok(nav.initTiled(r.NavMeshParams.create({ orig: t.orig, tileWidth: t.tileWidth, tileHeight: t.tileHeight, maxTiles: 64, maxPolys: 32768 })))
	const data = new r.UnsignedCharArray()
	data.copy(t.data)
	const added = nav.addTile(data, 0, 0)
	assert.ok(!r.statusFailed(added.status), r.statusToReadableString(added.status))
	const q = new r.NavMeshQuery(nav)
	const path = q.computePath({ x: 4, y: 10, z: 9 }, { x: 12, y: 10, z: 9 }, { halfExtents: { x: 2, y: 4, z: 2 } })
	assert.ok(path.success && path.path.some((p) => p.z > 15 || p.z < 3), 'the path went through the wall')
	q.destroy()
	nav.removeTile(added.tileRef)
	data.destroy()
	nav.destroy()
})
