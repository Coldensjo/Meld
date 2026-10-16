// The Doodad tool's Creatures mode (#171): a spawn brush that paints creature spawns as the doodad
// brush paints models. Its templates come with weights; the brush keeps the creatures under it at a
// density and never closer to each other than its spacing, and gives each spawn the brush's level,
// wander, movement and respawn. Kept free of three.js so it can be tested on its own.
import type { PlacementRules } from './doodadBrush'

/** A creature template in the brush, as the browser's Creatures tab gives it, with its weight. */
export interface SpawnBrushEntry {
	entry: number
	name: string
	subname: string
	levelMin: number
	levelMax: number
	faction: number
	npcFlags: number
	rank: number
	type: number
	display: number
	scale: number
	equipment: number
	weight: number
}

export interface SpawnBrush {
	entries: SpawnBrushEntry[]
	/** Creatures per 100 by 100 yards the brush fills the ground under it to. */
	density: number
	/** The least distance between two creatures, in yards (social aggro is the concern). */
	spacing: number
	/** A level range for the spawns, or 0 for the template's own. */
	levelMin: number
	levelMax: number
	/** Random movement within `wander` yards, or none. */
	movement: 'stay' | 'random'
	wander: number
	respawnSecs: number
	/** Each creature faces a random way, or toward the brush's centre (a camp around a fire). */
	facing: 'random' | 'centre'
	/** No creature on ground steeper than this (degrees; 90 allows any), nor in water with `avoidWater`. */
	maxSlope: number
	avoidWater: boolean
	/** The doodad brush's placement rules (textures, height, holes) besides those two (#196); missing for anywhere. */
	rules?: PlacementRules
}

export function newSpawnBrush(): SpawnBrush {
	return { entries: [], density: 12, spacing: 8, levelMin: 0, levelMax: 0, movement: 'random', wander: 5, respawnSecs: 300, facing: 'random', maxSlope: 50, avoidWater: true }
}

/** How many creatures the brush wants in its circle of `radius` yards at its density. */
export function targetCount(density: number, radius: number): number {
	return Math.floor((density * Math.PI * radius * radius) / 10000 + 0.5)
}

/** An entry drawn by weight from `r` in [0, 1); -1 when no entry has weight. */
export function pickSpawnEntry(entries: readonly SpawnBrushEntry[], r: number): number {
	let sum = 0
	for (const e of entries) sum += Math.max(0, e.weight)
	if (sum <= 0) return -1
	let t = r * sum
	for (let i = 0; i < entries.length; i++) {
		t -= Math.max(0, entries[i].weight)
		if (t < 0) return i
	}
	return entries.length - 1
}

/** Whether (x, z) is at least `spacing` yards from each of the `count` points in `near` (x, z pairs). */
export function spacedOut(x: number, z: number, spacing: number, near: ArrayLike<number>, count: number): boolean {
	const s2 = spacing * spacing
	for (let i = 0; i < count; i++) {
		const dx = near[i * 2] - x
		const dz = near[i * 2 + 1] - z
		if (dx * dx + dz * dz < s2) return false
	}
	return true
}

/**
 * The editor turn (about +y, 0 facing +x) a creature at (x, z) takes: a random one from `r`, or toward
 * the brush centre (cx, cz) with `facing` 'centre'.
 */
export function facingTurn(facing: SpawnBrush['facing'], x: number, z: number, cx: number, cz: number, r: number): number {
	if (facing === 'centre' && (x !== cx || z !== cz)) return Math.atan2(-(cz - z), cx - x)
	return r * Math.PI * 2
}

/** A level in the brush's range from `r`, or the template's own range when the brush sets none. */
export function brushLevels(brush: SpawnBrush, e: SpawnBrushEntry): { min: number; max: number } {
	if (brush.levelMin <= 0 && brush.levelMax <= 0) return { min: e.levelMin, max: e.levelMax }
	const lo = Math.max(1, brush.levelMin || brush.levelMax)
	const hi = Math.max(lo, brush.levelMax || brush.levelMin)
	return { min: lo, max: hi }
}

/** A brush entry from a template, weight 1, or the template's fields for an entry already in. */
export function entryFrom(t: Omit<SpawnBrushEntry, 'weight'>, weight = 1): SpawnBrushEntry {
	const { entry, name, subname, levelMin, levelMax, faction, npcFlags, rank, type, display, scale, equipment } = t
	return { entry, name, subname, levelMin, levelMax, faction, npcFlags, rank, type, display, scale, equipment, weight }
}
