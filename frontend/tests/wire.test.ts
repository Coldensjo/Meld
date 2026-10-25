// The frontend's parsers of the binary /wow/* replies against fixtures Go's own encoders wrote from
// generated geometry (#520): internal/wow/wire_test.go (mesh, collision, wmonav) and
// internal/vmangos/wire_test.go (navtile). A layout change on the Go side means writing the
// fixtures again with `go test ./internal/wow/ ./internal/vmangos/ -run TestWireFixtures -update`,
// and this test then says which parser has to follow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCollision, parseMesh } from '../src/lib/wow/meshReply.ts'
import { decodeWmoNav } from '../src/lib/world/wmoRoom.ts'
import { parseNavTile } from '../src/lib/world/nav/navServer.ts'

function fixture(name: string): ArrayBuffer {
	const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** Where a typed array ends in its buffer. */
const end = (a: ArrayBufferView) => a.byteOffset + a.byteLength

test('parseMesh reads every section of Mesh.Encode', () => {
	const buf = fixture('mesh.bin')
	const m = parseMesh(buf)
	assert.equal(m.positions.length, 8 * 3)
	assert.deepEqual(Array.from(m.positions.slice(21, 24)), [2, 3, 4])
	assert.deepEqual(Array.from(m.normals.slice(21, 24)), [0, 1, 7])
	assert.deepEqual(Array.from(m.uvs.slice(14, 16)), [7 / 8, 1 / 8])
	assert.deepEqual(Array.from(m.colors!.slice(28, 32)), [70, 71, 72, 255])
	assert.equal(m.indices.length, 36)
	assert.deepEqual(Array.from(m.indices.slice(30, 36)), [1, 5, 7, 1, 7, 3])
	assert.deepEqual(m.bbox, [0, 0, 0, 2, 3, 4])
	assert.equal(m.groups.length, 2)
	assert.deepEqual([m.groups[1].start, m.groups[1].count, m.groups[1].texture, m.groups[1].twoSided, m.groups[1].interior], [18, 18, 'fixture\\b.blp', true, true])
	assert.equal(m.effects[0].kind, 'light')
	assert.deepEqual(m.bones?.[0].pivot, [1, 1.5, 2])
	assert.deepEqual(Array.from(m.boneW!.slice(28, 32)), [255, 0, 0, 7])
	assert.deepEqual(Array.from(m.rooms!.slice(14, 16)), [2, 7])
	const l = m.liquid!
	assert.deepEqual(Array.from(l.positions.slice(9, 12)), [2, 1, 4])
	assert.deepEqual(Array.from(l.uvs.slice(6, 8)), [1, 1])
	assert.deepEqual(Array.from(l.info.slice(12, 16)), [1, 2, 0, 203])
	assert.deepEqual(Array.from(l.body.slice(0, 4)), [9, 8, 7, 255])
	assert.deepEqual(Array.from(l.rooms), [2, 0, 2, 0, 2, 0, 2, 0])
	assert.deepEqual(Array.from(l.indices), [0, 2, 1, 1, 2, 3])
	assert.equal(end(l.indices), buf.byteLength, 'the liquid indices end the reply')
})

test('parseCollision reads the faces, groups and liquids of collision.encode', () => {
	const buf = fixture('collision.bin')
	const c = parseCollision(buf)
	assert.equal(c.tris.length, 18)
	assert.deepEqual(Array.from(c.tris.slice(9, 12)), [5, 5, 5])
	assert.deepEqual(Array.from(c.groups), [1, 1])
	assert.ok(c.liquid)
	assert.deepEqual(Array.from(c.liquid.verts.slice(9, 12)), [3, 2, 3])
	assert.deepEqual(Array.from(c.liquid.idx), [0, 2, 1, 1, 2, 3])
	assert.deepEqual(Array.from(c.liquid.types), [1, 3])
	assert.equal(end(c.liquid.types), buf.byteLength, 'the liquid types end the reply')
})

test('decodeWmoNav reads WMONav.Encode', () => {
	const buf = fixture('wmonav.bin')
	const n = decodeWmoNav(buf)
	assert.equal(n.groups.length, 2)
	assert.equal(n.groups[0].name, 'hall')
	assert.deepEqual(n.groups[0].fogs, [1, 0, 0, 0])
	assert.deepEqual(n.groups[1].max, [20, 20, 20])
	assert.equal(n.portalVerts.length, 12)
	assert.deepEqual(n.portals[0].plane, [0, 0, 1, -10])
	assert.deepEqual(n.refs[0], { portal: 0, group: 1, side: -1 })
	assert.equal(n.fogs[1].color, 0xff445566)
	assert.deepEqual([n.walk[0].length, n.walk[1].length, n.camera[0].length, n.camera[1].length], [9, 18, 9, 0])
	assert.equal(n.walk[0][2], 1)
	assert.equal(n.walk[1][17], 3)
	assert.equal(n.camera[0][8], 4)
	assert.equal(end(n.camera[0]), buf.byteLength, 'the camera faces end the reply')
})

test('parseNavTile reads NavTile', () => {
	const t = parseNavTile(fixture('navtile.bin'))
	assert.deepEqual(t.orig, { x: -6933.5, y: 12.25, z: -16000 })
	assert.equal(t.tileWidth, 533.25)
	assert.equal(t.tileHeight, 266.5)
	assert.equal(String.fromCharCode(t.data[3], t.data[2], t.data[1], t.data[0]), 'DNAV')
	assert.equal(new DataView(t.data.buffer, t.data.byteOffset).getUint32(4, true), 7, 'the Detour version')
})
