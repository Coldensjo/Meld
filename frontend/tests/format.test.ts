import { describe, expect, test } from 'bun:test'
import fixture from './fixtures/format.json'
import * as format from '../src/lib/wow/format'
import { editorPoint, serverSpot } from '../src/lib/io/portCoords'
import { extentToRect, rectToExtent } from '../src/lib/io/worldMap'

// tests/fixtures/format.json is written by Go (internal/adt TestFormatFixture, -update), so
// this checks lib/wow/format.ts and the Go constants and adt.ToServer agree (#538).
describe('1.12 format constants', () => {
	test('match the Go side', () => {
		expect(format.TILE_YARDS).toBeCloseTo(fixture.TILE_YARDS, 9)
		expect(format.ZERO_POINT).toBeCloseTo(fixture.ZERO_POINT, 9)
		expect(format.TILE_CHUNKS).toBe(fixture.TILE_CHUNKS)
		expect(format.CHUNK_CELLS).toBe(fixture.CHUNK_CELLS)
		expect(format.TILE_CELLS).toBe(fixture.TILE_CELLS)
		expect(format.TILE_VERTS).toBe(fixture.TILE_VERTS)
		expect(format.SLOTS).toBe(fixture.SLOTS)
		expect(format.ALPHA_SIZE).toBe(fixture.ALPHA_SIZE)
		expect(format.LIQUID_RECORD_BYTES).toBe(fixture.LIQUID_RECORD_BYTES)
		expect(format.CHUNK_SHADOW_BYTES).toBe(fixture.CHUNK_SHADOW_BYTES)
	})

	test('toServer and fromServer match adt.ToServer on the fixture points', () => {
		for (const p of fixture.points) {
			const s = format.toServer(p.x, p.z, p.tileX, p.tileY)
			expect(s.x).toBeCloseTo(p.sx, 6)
			expect(s.y).toBeCloseTo(p.sy, 6)
			const e = format.fromServer(p.sx, p.sy, p.tileX, p.tileY)
			expect(e.x).toBeCloseTo(p.x, 6)
			expect(e.z).toBeCloseTo(p.z, 6)
		}
	})

	test('serverSpot, editorPoint and the world map extent use the same swap', () => {
		for (const p of fixture.points) {
			const s = serverSpot({ x: p.x, y: 7, z: p.z }, 1, p.tileX, p.tileY)
			expect(s.x).toBeCloseTo(p.sx, 6)
			expect(s.y).toBeCloseTo(p.sy, 6)
			expect(s.z).toBe(7)
			const e = editorPoint({ x: p.sx, y: p.sy, z: 7 }, p.tileX, p.tileY)
			expect(e.x).toBeCloseTo(p.x, 6)
			expect(e.z).toBeCloseTo(p.z, 6)
			const ext = rectToExtent({ x0: p.x, z0: p.z, x1: p.x, z1: p.z }, p.tileX, p.tileY)
			expect(ext.left).toBeCloseTo(p.sy, 6)
			expect(ext.top).toBeCloseTo(p.sx, 6)
			const r = extentToRect(ext, p.tileX, p.tileY)
			expect(r.x0).toBeCloseTo(p.x, 6)
			expect(r.z0).toBeCloseTo(p.z, 6)
		}
	})
})
