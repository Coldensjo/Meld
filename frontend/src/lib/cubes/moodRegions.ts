// Mood regions in the editor (3dgame #143): places with a mood of their own (CubeWorld.moods, the
// format's MOODS record), each a box of cubes and the name of a mood in the game's moods file
// (crates/gameplay/moods.toml). The client wears the mood of the innermost region its camera is in
// instead of its layer's (crates/world World::mood_region_at, ported by `moodRegionAt`). Painting,
// changing and removing one is one History step. A region may reach any layer of the world: it only
// changes the look. Pure data, with no three.js, so it runs in the unit tests.

import type { CubeWorld, WorldMood } from './world'
import type { CubeBox } from './clip'
import type { Command } from '../state/historyCore'

/** How many cubes a region holds (MoodRegion::volume). */
export function regionVolume(r: WorldMood): number {
	return (r.max.x - r.min.x + 1) * (r.max.z - r.min.z + 1) * (r.max.layer - r.min.layer + 1)
}

/** Whether region `r` holds the cube (x, z, layer). */
export function regionHolds(r: WorldMood, x: number, z: number, layer: number): boolean {
	return x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z && layer >= r.min.layer && layer <= r.max.layer
}

/**
 * The index of the innermost region holding the cube (x, z, layer), as the game picks it
 * (World::mood_region_at): the one holding the fewest cubes, and of those the last; -1 for none.
 */
export function moodRegionAt(world: CubeWorld, x: number, z: number, layer: number): number {
	let best = -1
	let size = Infinity
	world.moods.forEach((r, i) => {
		if (!regionHolds(r, x, z, layer)) return
		const v = regionVolume(r)
		if (v <= size) {
			best = i
			size = v
		}
	})
	return best
}

/** Why a region of the box `b` may not be painted, or '' when it may. */
export function regionBlock(world: CubeWorld, b: CubeBox): string {
	const inside = (x: number, z: number, layer: number) => world.spawnInside({ x, z, layer })
	if (!inside(b.x0, b.z0, b.top) || !inside(b.x1, b.z1, b.bottom)) return 'outside the world'
	return ''
}

/** Adds a region of `mood` over the box `b`, at the end of the list; says why not instead. */
export function paintRegion(world: CubeWorld, mood: string, b: CubeBox): WorldMood | string {
	if (!mood) return 'no mood picked'
	const why = regionBlock(world, b)
	if (why) return why
	const r: WorldMood = { mood, min: { x: b.x0, z: b.z0, layer: b.top }, max: { x: b.x1, z: b.z1, layer: b.bottom } }
	world.moods.push(r)
	return r
}

/** Gives region `i` the mood `mood`; says why not instead. */
export function setRegionMood(world: CubeWorld, i: number, mood: string): WorldMood | string {
	const r = world.moods[i]
	if (!r) return 'no such region'
	if (!mood) return 'no mood picked'
	r.mood = mood
	return r
}

/** Removes region `i`; returns it, or null when there is none. */
export function removeRegion(world: CubeWorld, i: number): WorldMood | null {
	if (!world.moods[i]) return null
	return world.moods.splice(i, 1)[0]
}

/** A copy of a list of regions. */
export function copyRegions(list: readonly WorldMood[]): WorldMood[] {
	return list.map((r) => ({ mood: r.mood, min: { ...r.min }, max: { ...r.max } }))
}

/**
 * Runs `edit` on the world's mood regions as one History step: a copy before and after, the undo and
 * redo putting one back (on the world itself, which the tab owns) and calling `changed` (to redraw
 * them). Returns `edit`'s result; nothing is recorded when it changed nothing.
 */
export function editRegions<T>(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, edit: () => T): T {
	const before = copyRegions(world.moods)
	const out = edit()
	const after = copyRegions(world.moods)
	if (JSON.stringify(before) === JSON.stringify(after)) return out
	changed()
	history.push({
		label,
		bytes: JSON.stringify(after).length * 4,
		undo: () => {
			world.moods = copyRegions(before)
			changed()
		},
		redo: () => {
			world.moods = copyRegions(after)
			changed()
		},
	})
	return out
}

/** A region in words: its mood and its box. */
export function regionWords(r: WorldMood): string {
	const layers = r.min.layer === r.max.layer ? `layer ${r.min.layer}` : `layers ${r.min.layer} to ${r.max.layer}`
	return `the ${r.mood} region over (${r.min.x}, ${r.min.z}) to (${r.max.x}, ${r.max.z}), ${layers}`
}
