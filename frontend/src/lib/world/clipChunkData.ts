// The chunk data an area copy carries (see clipboard.ts): each cell's zone, chunk flags and no-tuft
// byte. Kept apart from the clipboard module, which pulls in the terrain stroke, so it can be tested
// on its own under node.
import type { MapClip } from './clipboard'
import type { Rect } from '../tools/brush'
import type { ChunkDataStroke } from '../tools/chunkDataStroke'
import { CHUNK_CELLS, chunkOf } from '../terrain/chunkPaint'

/** The part of a terrain the chunk data is read from and written to. */
export interface ChunkDataTerrain {
	size: number
	paintChunksPerSide: number
	areaIds: Uint32Array
	chunkFlags: Uint8Array
	noEffect: Uint8Array
	touchChunkData(): void
}

/** The zone, flags and no-tuft byte under each cell of the rect (inclusive vertex corners). */
export function copyChunkData(terrain: ChunkDataTerrain, r: Rect): NonNullable<MapClip['chunkData']> {
	const w = r.x1 - r.x0
	const h = r.z1 - r.z0
	const side = terrain.paintChunksPerSide
	const areas = new Uint32Array(w * h)
	const flags = new Uint8Array(w * h)
	const noEffect = new Uint8Array(w * h)
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const gx = r.x0 + x
			const gz = r.z0 + z
			const chunk = chunkOf(Math.floor(gx / CHUNK_CELLS), Math.floor(gz / CHUNK_CELLS), side)
			areas[z * w + x] = terrain.areaIds[chunk]
			flags[z * w + x] = terrain.chunkFlags[chunk]
			noEffect[z * w + x] = terrain.noEffect[gz * terrain.size + gx]
		}
	}
	return { areas, flags, noEffect }
}

/**
 * Lays the clip's chunk data onto the cells of the paste at (px, pz) through `stroke`: the no-tuft
 * cells land cell for cell, and a chunk whose centre cell lies in the paste takes the zone (unless
 * the clip has none there, which keeps the chunk's own, as the export does) and flags of the clip
 * cell under that centre.
 */
export function pasteChunkData(terrain: ChunkDataTerrain, clip: MapClip, px: number, pz: number, stroke: ChunkDataStroke) {
	// A free-form clip (#183) lays only its shape's cells, and a chunk's zone and flags where its middle is in it.
	const inside = clip.cells
	const data = clip.chunkData
	if (!data) return
	const size = terrain.size
	const x0 = Math.max(0, px)
	const z0 = Math.max(0, pz)
	const x1 = Math.min(size - 1, px + clip.w - 1)
	const z1 = Math.min(size - 1, pz + clip.h - 1)
	if (x1 < x0 || z1 < z0) return
	const r = { x0, z0, x1, z1 }
	stroke.reserveCells(r)
	for (let z = z0; z <= z1; z++) {
		for (let x = x0; x <= x1; x++) {
			const i = (z - pz) * clip.w + (x - px)
			if (!inside || inside[i]) terrain.noEffect[z * size + x] = data.noEffect[i]
		}
	}
	stroke.touchCells(r)
	const side = terrain.paintChunksPerSide
	const half = CHUNK_CELLS >> 1
	for (let cz = Math.floor(z0 / CHUNK_CELLS); cz <= Math.floor(z1 / CHUNK_CELLS); cz++) {
		for (let cx = Math.floor(x0 / CHUNK_CELLS); cx <= Math.floor(x1 / CHUNK_CELLS); cx++) {
			const mx = cx * CHUNK_CELLS + half - px
			const mz = cz * CHUNK_CELLS + half - pz
			if (mx < 0 || mz < 0 || mx >= clip.w || mz >= clip.h) continue
			if (inside && !inside[mz * clip.w + mx]) continue
			const chunk = chunkOf(cx, cz, side)
			const area = data.areas[mz * clip.w + mx]
			if (area) terrain.areaIds[chunk] = area
			terrain.chunkFlags[chunk] = data.flags[mz * clip.w + mx]
		}
	}
	terrain.touchChunkData()
}
