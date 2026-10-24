// The texture ids a world's faces are painted with, and replacing one id with another across the
// world (Edit › Textures in This World, 3dgame #216), so an id the editor does not know (#215) can be
// matched with one of its textures.

import { CHUNK_AREA, CHUNK_SIZE, FACE_COUNT, type CubeWorld, withTexture } from './world'
import { type CubeChanges, editBlock } from './edit'

/** How many cube faces of `world` are painted each texture id, or have it over them (an overlay, #226), by id; unpainted faces are not counted. */
export function textureUse(world: CubeWorld): Map<number, number> {
	const use = new Map<number, number>()
	for (const planes of world.paint.values()) {
		for (const t of planes) if (t) use.set(t, (use.get(t) ?? 0) + 1)
	}
	for (const over of world.overlay.values()) {
		for (const t of over) if (t) use.set(t, (use.get(t) ?? 0) + 1)
	}
	return use
}

/**
 * Paints every face of `world` painted one of the ids `from` with `to` instead (0 unpaints it, so it
 * shows its kind's own texture), through `changes`, which then holds the step. Faces in the metal layers,
 * which are never built in (editBlock), are left as they are; returns how many faces were.
 */
export function replaceTexture(changes: CubeChanges, from: ReadonlySet<number>, to: number): number {
	const world = changes.world
	let skipped = 0
	// The keys first: painting can drop a chunk's paint from the map while it is walked.
	for (const key of [...world.paint.keys()]) {
		const planes = world.paint.get(key)
		if (!planes) continue
		const cx = key % world.chunksX
		const cz = Math.floor(key / world.chunksX) % world.chunksZ
		const layer = Math.floor(key / (world.chunksX * world.chunksZ))
		for (let i = 0; i < CHUNK_AREA; i++) {
			let faces = 0
			for (let f = 0; f < FACE_COUNT; f++) if (from.has(planes[f * CHUNK_AREA + i])) faces++
			if (!faces) continue
			const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE)
			const z = cz * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)
			if (editBlock(world, x, z, layer)) {
				skipped += faces
				continue
			}
			let paint = world.paintOf(x, z, layer)
			for (let f = 0; f < FACE_COUNT; f++) if (from.has(planes[f * CHUNK_AREA + i])) paint = withTexture(paint, f, to)
			changes.paint(x, z, layer, paint)
		}
	}
	// The overlays over the tops of cubes (#226): `to` in their place, 0 taking them off.
	for (const key of [...world.overlay.keys()]) {
		const over = world.overlay.get(key)
		if (!over) continue
		const cx = key % world.chunksX
		const cz = Math.floor(key / world.chunksX) % world.chunksZ
		const layer = Math.floor(key / (world.chunksX * world.chunksZ))
		for (let i = 0; i < CHUNK_AREA; i++) {
			if (!from.has(over[i])) continue
			const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE)
			const z = cz * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)
			if (editBlock(world, x, z, layer)) skipped++
			else changes.overlay(x, z, layer, to)
		}
	}
	return skipped
}
