// The walkable-ground view's server mode (#240): the navmesh the world server loaded, read from its
// movement maps (data/mmaps, one Detour tile a client tile, served by /wow/navtile, vmangos.NavTile),
// instead of one built in the browser. The tiles are in the server's Detour frame, which is WoW's
// with its axes swapped (x its y, y the height, z its x); `navPoint` takes the editor's points there
// and back. This file reads the tile's surface for drawing; NavPreview adds the tile to a NavMesh
// for the path test.

import { AREA_GROUND, AREA_MAGMA, AREA_SLIME, AREA_STEEP, AREA_WATER, AREA_WATER_TRANSITION, NAV_GROUND, NAV_MAGMA, NAV_SLIME, NAV_STEEP, NAV_WATER } from './navBuild'

import { TILE_YARDS as ADT_YARDS, ZERO_POINT } from '../../wow/format'

/** A client tile's side (yd) (lib/wow/format.ts TILE_YARDS). */
export { ADT_YARDS }

/** The server's navmesh params (its .mmap) and one tile's Detour data, as /wow/navtile sends them. */
export interface ServerTile {
	orig: { x: number; y: number; z: number }
	tileWidth: number
	tileHeight: number
	data: Uint8Array
}

export function parseNavTile(buf: ArrayBuffer): ServerTile {
	const v = new DataView(buf)
	const f = (i: number) => v.getFloat32(i * 4, true)
	return { orig: { x: f(0), y: f(1), z: f(2) }, tileWidth: f(3), tileHeight: f(4), data: new Uint8Array(buf, 20) }
}

/**
 * A point of the editor's map, whose first tile is (tileX, tileY), in the server's Detour frame, or
 * one of that frame back in the editor's: the same sum both ways (portCoords.ts `serverSpot`, then
 * Detour's axis order), a half turn about the up axis, so a triangle keeps its winding.
 */
export function navPoint(p: { x: number; y: number; z: number }, tileX: number, tileY: number, out: { x: number; y: number; z: number }) {
	const x = ZERO_POINT - tileX * ADT_YARDS - p.x
	const z = ZERO_POINT - tileY * ADT_YARDS - p.z
	out.x = x
	out.y = p.y
	out.z = z
	return out
}

/** A server polygon's area (navBuild's ids, for its colour) by its flags, as TileWorker sets them. */
export function flagsArea(flags: number): number {
	if (flags & NAV_MAGMA) return AREA_MAGMA
	if (flags & NAV_SLIME) return AREA_SLIME
	if (flags & NAV_WATER) return flags & NAV_GROUND ? AREA_WATER_TRANSITION : AREA_WATER
	if (flags & NAV_STEEP) return AREA_STEEP
	return AREA_GROUND
}

const align4 = (n: number) => (n + 3) & ~3
const DT_POLYTYPE_OFFMESH_CONNECTION = 1

/**
 * The detail surface of a Detour tile (32-bit layout, dtNavMesh::addTile's sections): its triangles
 * in the tile's own frame, nine floats each, with their polygon's area (`flagsArea`) and index.
 * Off-mesh connections have no surface. Throws when the data isn't a Detour tile.
 */
export function detourSurface(data: Uint8Array): { tris: Float32Array; areas: Uint8Array; polys: Uint16Array } {
	const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
	if (data.byteLength < 100 || v.getUint32(0, true) !== 0x444e4156) throw new Error('not a Detour tile')
	const count = (i: number) => v.getInt32(24 + i * 4, true)
	const polyCount = count(0),
		vertCount = count(1),
		linkCount = count(2),
		detailMeshCount = count(3),
		detailVertCount = count(4),
		detailTriCount = count(5)
	const vertsAt = 100
	const polysAt = vertsAt + align4(12 * vertCount)
	const meshesAt = polysAt + align4(32 * polyCount) + align4(12 * linkCount)
	const dVertsAt = meshesAt + align4(12 * detailMeshCount)
	const dTrisAt = dVertsAt + align4(12 * detailVertCount)
	if (dTrisAt + 4 * detailTriCount > data.byteLength) throw new Error('Detour tile cut short')
	let n = 0
	for (let p = 0; p < polyCount && p < detailMeshCount; p++) {
		if (v.getUint8(polysAt + p * 32 + 31) >> 6 !== DT_POLYTYPE_OFFMESH_CONNECTION) n += v.getUint8(meshesAt + p * 12 + 9)
	}
	const tris = new Float32Array(n * 9)
	const areas = new Uint8Array(n)
	const polys = new Uint16Array(n)
	let k = 0
	for (let p = 0; p < polyCount && p < detailMeshCount; p++) {
		const pa = polysAt + p * 32
		if (v.getUint8(pa + 31) >> 6 === DT_POLYTYPE_OFFMESH_CONNECTION) continue
		const area = flagsArea(v.getUint16(pa + 28, true))
		const nv = v.getUint8(pa + 30)
		const ma = meshesAt + p * 12
		const vertBase = v.getUint32(ma, true)
		const triBase = v.getUint32(ma + 4, true)
		const nt = v.getUint8(ma + 9)
		for (let t = 0; t < nt; t++) {
			const ta = dTrisAt + (triBase + t) * 4
			for (let c = 0; c < 3; c++) {
				const i = v.getUint8(ta + c)
				// A detail triangle's corner is one of the polygon's own vertices or one of its detail vertices.
				const at = i < nv ? vertsAt + v.getUint16(pa + 4 + i * 2, true) * 12 : dVertsAt + (vertBase + i - nv) * 12
				const o = k * 9 + c * 3
				tris[o] = v.getFloat32(at, true)
				tris[o + 1] = v.getFloat32(at + 4, true)
				tris[o + 2] = v.getFloat32(at + 8, true)
			}
			areas[k] = area
			polys[k] = p
			k++
		}
	}
	return { tris, areas, polys }
}
