import { editorPoint, TILE_SIZE } from '../io/portCoords'
import type { TileBlock } from '../io/regionGrow'
import { tileKey } from '../io/mapTiles'
import type { TriggerShape } from './areaTriggers'

// Teleporters in the viewport (#306): picking an area trigger's volume with the pointer's ray, and
// finding the block of a map's tiles to open around a teleport's destination.

/** A point in the editor's space (a THREE.Vector3 fits). */
interface Vec {
	x: number
	y: number
	z: number
}

/** Where a ray enters and leaves a trigger's volume, as distances along it. */
export interface TriggerHit {
	trigger: TriggerShape
	enter: number
	exit: number
}

/**
 * Where the ray (origin, unit dir, in the editor's map of a block whose first tile is (tileX,
 * tileY)) enters and leaves trigger t's sphere or box, or null when it misses or the volume is
 * behind it. The ray is taken into the server's frame about the trigger's centre (the axis swap is
 * a rotation and a mirror, so distances stay the same), then into the box's frame by its yaw.
 */
export function rayTrigger(origin: Vec, dir: Vec, t: TriggerShape, tileX: number, tileY: number): { enter: number; exit: number } | null {
	const c = editorPoint(t, tileX, tileY)
	// Editor x, y, z are the server's -Y, Z, -X.
	let ox = -(origin.z - c.z),
		oy = -(origin.x - c.x)
	const oz = origin.y - c.y
	let dx = -dir.z,
		dy = -dir.x
	const dz = dir.y
	let enter: number, exit: number
	if (t.radius > 0) {
		const b = ox * dx + oy * dy + oz * dz
		const cc = ox * ox + oy * oy + oz * oz - t.radius * t.radius
		const disc = b * b - cc
		if (disc < 0) return null
		const s = Math.sqrt(disc)
		enter = -b - s
		exit = -b + s
	} else {
		const cos = Math.cos(t.boxYaw),
			sin = Math.sin(t.boxYaw)
		;[ox, oy] = [ox * cos + oy * sin, -ox * sin + oy * cos]
		;[dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos]
		enter = -Infinity
		exit = Infinity
		const slabs: [number, number, number][] = [
			[ox, dx, t.boxX / 2],
			[oy, dy, t.boxY / 2],
			[oz, dz, t.boxZ / 2],
		]
		for (const [o, d, h] of slabs) {
			if (Math.abs(d) < 1e-9) {
				if (o < -h || o > h) return null
				continue
			}
			let a = (-h - o) / d,
				b = (h - o) / d
			if (a > b) [a, b] = [b, a]
			enter = Math.max(enter, a)
			exit = Math.min(exit, b)
			if (enter > exit) return null
		}
	}
	return exit < 0 ? null : { enter, exit }
}

/**
 * The trigger the ray enters first. A trigger the camera is inside is left out, since it would
 * take every click made from inside it.
 */
export function pickTrigger(triggers: readonly TriggerShape[], origin: Vec, dir: Vec, tileX: number, tileY: number): TriggerHit | null {
	let best: TriggerHit | null = null
	for (const t of triggers) {
		const h = rayTrigger(origin, dir, t, tileX, tileY)
		if (!h || h.enter < 0) continue
		if (!best || h.enter < best.enter) best = { trigger: t, enter: h.enter, exit: h.exit }
	}
	return best
}

/**
 * Whether a right-click picks the trigger over what else the ray met (`hit` at `distance`, a spawn
 * or a placed model, or nothing). A model counts only in front of the trigger, so a building a
 * dungeon portal stands in does not hide the portal; a spawn counts inside it too, as it is small and
 * clicked on purpose.
 */
export function triggerWins(trigger: TriggerHit, hit: 'spawn' | 'model' | null, distance: number): boolean {
	if (hit === null) return true
	return distance > (hit === 'spawn' ? trigger.exit : trigger.enter)
}

/** The client tile (column, row, as tiles are named) a server spot lies in. */
export function spotTile(spot: Vec): { x: number; y: number } {
	const p = editorPoint(spot)
	return { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.z / TILE_SIZE) }
}

/** Whether block b holds tile t. */
export function blockHolds(b: TileBlock, t: { x: number; y: number }): boolean {
	return t.x >= b.x && t.x < b.x + b.size && t.y >= b.y && t.y < b.y + b.size
}

/**
 * The block to open around tile t of a map whose tiles are `have` (tileKey): the biggest square of
 * at most maxSize tiles a side that holds t and lies wholly on the map's tiles, the one with t
 * nearest its middle; null when t has no tile.
 */
export function blockAround(t: { x: number; y: number }, have: ReadonlySet<number>, maxSize: number): TileBlock | null {
	if (!have.has(tileKey(t.x, t.y))) return null
	for (let size = maxSize; size >= 1; size--) {
		let best: TileBlock | null = null
		let bestOff = Infinity
		for (let y = t.y - size + 1; y <= t.y; y++) {
			for (let x = t.x - size + 1; x <= t.x; x++) {
				if (x < 0 || y < 0 || x + size > 64 || y + size > 64) continue
				let full = true
				for (let j = y; j < y + size && full; j++)
					for (let i = x; i < x + size; i++)
						if (!have.has(tileKey(i, j))) {
							full = false
							break
						}
				if (!full) continue
				const off = Math.abs(x + (size - 1) / 2 - t.x) + Math.abs(y + (size - 1) / 2 - t.y)
				if (off < bestOff) {
					best = { x, y, size }
					bestOff = off
				}
			}
		}
		if (best) return best
	}
	return null
}
