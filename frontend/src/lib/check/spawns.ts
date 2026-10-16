// Check Map (#176): creatures and objects standing under the ground, on ground too steep to walk, or
// deep in water, and creature paths that go under the ground or through a building's wall.
import { capped, type Finding } from './findings'

/** A spawn for the checks: its key, what to call it, its kind and where it stands (editor space, y up). */
export interface CheckSpawn {
	key: string
	name: string
	kind: string
	x: number
	y: number
	z: number
	/** Its own path (the main one), as points in editor space. */
	path?: ReadonlyArray<{ x: number; y: number; z: number }>
}

/** What the spawn checks ask of the map. */
export interface SpawnProbes {
	/** The ground's height, -Infinity off the map or over a hole. */
	ground(x: number, z: number): number
	/** The ground's slope there, in degrees. */
	slope(x: number, z: number): number
	/** Whether a liquid or the sea stands more than DEEP yards above the ground there. */
	deepWater(x: number, z: number, ground: number): boolean
	/** Whether a model's surface (a floor, a cave) is within a few yards under (x, y, z). */
	floorNear(x: number, y: number, z: number): boolean
	/** Whether a building's wall stands between the two points (each raised to chest height). */
	wallBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean
}

/**
 * How deep under the ground a spawn or path point must be to count (yards), on flat ground. The
 * server's heights and the editor's ground (bilinear in a cell, where the client cuts it into
 * triangles) differ by up to about half a cell times the slope, so a slope adds that (`underBy`).
 */
const UNDER = 2
/** How close to the ground a spawn stands to count as on it, for the slope and water checks (yards). */
const ON_GROUND = 1.5
/** The steps a path's segment is sampled at for dipping under the ground (yards). */
const SEGMENT_STEP = 2

/** How far under the ground at (x, z) a point may be before it counts as under it. */
function underBy(probes: SpawnProbes, x: number, z: number, cellSize: number): number {
	return UNDER + Math.tan((Math.min(probes.slope(x, z), 80) * Math.PI) / 180) * cellSize * 0.5
}

/** The spawns' own positions: under the ground, on too steep ground, deep in water (creatures only). */
export function checkSpawns(spawns: readonly CheckSpawn[], probes: SpawnProbes, maxSlope: number, cellSize: number): Finding[] {
	const under: Finding[] = []
	const steep: Finding[] = []
	const water: Finding[] = []
	for (const s of spawns) {
		const g = probes.ground(s.x, s.z)
		if (g === -Infinity) continue
		const label = s.kind === 'object' ? `Object ${s.name}` : s.name
		if (s.y < g - underBy(probes, s.x, s.z, cellSize) && !probes.floorNear(s.x, s.y, s.z)) {
			under.push({ check: 'Spawns under the ground', severity: 'error', message: `${label} stands ${(g - s.y).toFixed(1)} yd under the ground.`, x: s.x, z: s.z, target: { kind: 'spawn', key: s.key } })
			continue
		}
		if (s.kind === 'object' || Math.abs(s.y - g) > ON_GROUND) continue
		const slope = probes.slope(s.x, s.z)
		if (slope > maxSlope) steep.push({ check: 'Spawns on steep ground', severity: 'warning', message: `${label} stands on a ${Math.round(slope)}° slope, steeper than walkable.`, x: s.x, z: s.z, target: { kind: 'spawn', key: s.key } })
		if (probes.deepWater(s.x, s.z, g)) water.push({ check: 'Spawns in deep water', severity: 'info', message: `${label} stands on the bottom of deep water (fine for a swimmer).`, x: s.x, z: s.z, target: { kind: 'spawn', key: s.key } })
	}
	return [...capped('Spawns under the ground', under), ...capped('Spawns on steep ground', steep), ...capped('Spawns in deep water', water)]
}

/**
 * Creature paths: a point under the ground, a stretch between two points that dips under it, or one
 * that passes through a building's wall. One finding per path and problem, at its first place.
 */
export function checkPaths(spawns: readonly CheckSpawn[], probes: SpawnProbes, cellSize: number): Finding[] {
	const out: Finding[] = []
	for (const s of spawns) {
		const p = s.path
		if (!p || !p.length) continue
		let under = -1
		let dip = -1
		let wall = -1
		for (let i = 0; i < p.length; i++) {
			const a = p[i]
			const g = probes.ground(a.x, a.z)
			if (under < 0 && g !== -Infinity && a.y < g - underBy(probes, a.x, a.z, cellSize) && !probes.floorNear(a.x, a.y, a.z)) under = i
			if (i + 1 >= p.length) continue
			const b = p[i + 1]
			if (dip < 0 && segmentDips(a, b, probes, cellSize)) dip = i
			if (wall < 0 && probes.wallBetween(a, b)) wall = i
		}
		const at = (i: number) => ({ x: p[i].x, z: p[i].z })
		if (under >= 0) out.push({ check: 'Paths under the ground', severity: 'error', message: `${s.name}'s path point ${under + 1} is under the ground.`, ...at(under), target: { kind: 'spawn', key: s.key } })
		if (dip >= 0) out.push({ check: 'Paths under the ground', severity: 'warning', message: `${s.name}'s path goes under the ground between points ${dip + 1} and ${dip + 2}.`, ...at(dip), target: { kind: 'spawn', key: s.key } })
		if (wall >= 0) out.push({ check: 'Paths through walls', severity: 'warning', message: `${s.name}'s path passes through a building between points ${wall + 1} and ${wall + 2}.`, ...at(wall), target: { kind: 'spawn', key: s.key } })
	}
	return out
}

/** Whether the straight stretch from a to b goes under the ground (by more than `underBy`) between its ends. */
function segmentDips(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, probes: SpawnProbes, cellSize: number): boolean {
	const len = Math.hypot(b.x - a.x, b.z - a.z)
	const n = Math.floor(len / SEGMENT_STEP)
	for (let k = 1; k < n; k++) {
		const t = k / n
		const x = a.x + (b.x - a.x) * t
		const z = a.z + (b.z - a.z) * t
		const y = a.y + (b.y - a.y) * t
		const g = probes.ground(x, z)
		if (g !== -Infinity && y < g - underBy(probes, x, z, cellSize) && !probes.floorNear(x, y, z)) return true
	}
	return false
}
