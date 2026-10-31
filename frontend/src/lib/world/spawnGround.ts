import type { vmangos } from '../wails/models'
import type { DirtyRect } from '../terrain/dirtyRect'
import { growRect } from '../terrain/dirtyRect'
import { spawnLevel, rampColor, type LegendRow } from './spawnColors'

// View › Ground overlay (#950): each cell of the ground shaded by the creatures around it, the average
// level of the monsters within GROUND_RADIUS (on the spawn colours' level ramp, #949) or how many
// creatures stand within it, with the cells whose level strays from their zone's exploration level
// hatched. The sums are kept per cell and changed only around a spawn that was added, moved or deleted;
// `encode` packs them into the two bytes a cell the terrain shader reads (Terrain.spawnCellBytes).
// Pure but for the typed arrays, for the Bun tests.

export type GroundOverlay = 'off' | 'level' | 'density'

/** How far around a cell its creatures are counted, in yards. */
export const GROUND_RADIUS = 40

/** The creatures within GROUND_RADIUS that the density ramp's top stands for: a packed camp. */
export const GROUND_CROWD = 16

/** The density ramp, from one creature to GROUND_CROWD or more: dark violet to pale pink, apart from the level ramp. */
export const DENSITY_RAMP = [0x4b2470, 0x9a2f9a, 0xe0559c, 0xffb3d6]

/** In a cell's density byte, the bit that marks its level as straying from its zone's; the count is below it. */
export const STRAY_BIT = 0x80
export const COUNT_MAX = 0x7f

/** A level is kept in a byte at a quarter level: 0 for none, up to 63.75. */
export const LEVEL_SCALE = 4

/** Whether a spawn counts in the overlay: a creature (a game object never does). */
export function groundCounts(s: vmangos.WorldSpawn): boolean {
	return s.kind !== 'object'
}

/** The level a spawn adds to the average: a monster's (the middle of its range), 0 for an NPC or none. */
export function groundLevel(s: vmangos.WorldSpawn): number {
	return s.kind === 'monster' ? spawnLevel(s) : 0
}

/** What a spawn last added to the sums, and the sync that last saw it. */
interface Mark {
	x: number
	z: number
	level: number
	seen: number
}

export class SpawnGround {
	/** Per cell: the monsters' levels summed, how many monsters with a level, and how many creatures. */
	readonly levelSum: Float32Array
	readonly levelCount: Uint16Array
	readonly count: Uint16Array
	/** The cells changed since the last `encode`, or null for none. */
	dirty: DirtyRect | null = null
	private marks = new Map<vmangos.WorldSpawn, Mark>()
	private gen = 0
	/** Each paint chunk's zone level (0 for none) and the levels a cell may stray by before it is hatched (0 for never). */
	private zoneLevels: Int16Array | null = null
	private stray = 0

	/**
	 * @param n cells per side of the terrain
	 * @param cellSize a cell's width in yards
	 * @param chunkCells cells per side of a paint chunk, whose zone a cell is compared with
	 */
	constructor(
		readonly n: number,
		readonly cellSize: number,
		readonly chunkCells: number,
	) {
		this.levelSum = new Float32Array(n * n)
		this.levelCount = new Uint16Array(n * n)
		this.count = new Uint16Array(n * n)
	}

	/** How many spawns are in the sums. */
	get size(): number {
		return this.marks.size
	}

	/**
	 * Brings the sums up to `spawns`, of which those `counts` keeps count: only a spawn new, moved or
	 * with another level is added again, and one no longer there taken out. Returns whether any changed.
	 */
	sync(spawns: readonly vmangos.WorldSpawn[], counts: (s: vmangos.WorldSpawn) => boolean = groundCounts): boolean {
		const gen = ++this.gen
		let changed = false
		for (const s of spawns) {
			if (!counts(s)) continue
			if (this.place(s, gen)) changed = true
		}
		for (const [s, m] of this.marks) {
			if (m.seen === gen) continue
			this.splat(m.x, m.z, m.level, -1)
			this.marks.delete(s)
			changed = true
		}
		return changed
	}

	/** Updates the spawns in `moved` (changed in place) without looking for the ones gone. Returns whether any changed. */
	update(moved: readonly vmangos.WorldSpawn[], counts: (s: vmangos.WorldSpawn) => boolean = groundCounts): boolean {
		let changed = false
		for (const s of moved) {
			const m = this.marks.get(s)
			if (!counts(s)) {
				if (m) {
					this.splat(m.x, m.z, m.level, -1)
					this.marks.delete(s)
					changed = true
				}
				continue
			}
			if (this.place(s, m ? m.seen : this.gen)) changed = true
		}
		return changed
	}

	/** Adds `s` where it stands now, taking out what it added before if it moved or changed level. */
	private place(s: vmangos.WorldSpawn, gen: number): boolean {
		const level = groundLevel(s)
		const m = this.marks.get(s)
		if (m) {
			m.seen = gen
			if (m.x === s.x && m.z === s.z && m.level === level) return false
			this.splat(m.x, m.z, m.level, -1)
			m.x = s.x
			m.z = s.z
			m.level = level
		} else this.marks.set(s, { x: s.x, z: s.z, level, seen: gen })
		this.splat(s.x, s.z, level, 1)
		return true
	}

	/** Adds (sign 1) or takes out (-1) a creature at (x, z) with `level` (0 for none) in every cell whose centre is within the radius. */
	private splat(x: number, z: number, level: number, sign: 1 | -1) {
		const cs = this.cellSize
		const n = this.n
		const r = GROUND_RADIUS
		const x0 = Math.max(0, Math.floor((x - r) / cs))
		const x1 = Math.min(n - 1, Math.floor((x + r) / cs))
		const z0 = Math.max(0, Math.floor((z - r) / cs))
		const z1 = Math.min(n - 1, Math.floor((z + r) / cs))
		if (x1 < x0 || z1 < z0) return
		const r2 = r * r
		for (let cz = z0; cz <= z1; cz++) {
			const dz = (cz + 0.5) * cs - z
			const row = cz * n
			for (let cx = x0; cx <= x1; cx++) {
				const dx = (cx + 0.5) * cs - x
				if (dx * dx + dz * dz > r2) continue
				const i = row + cx
				this.count[i] += sign
				if (level > 0) {
					this.levelSum[i] += sign * level
					this.levelCount[i] += sign
				}
			}
		}
		const rect = { x0, z0, x1, z1 }
		if (this.dirty) growRect(this.dirty, rect)
		else this.dirty = rect
	}

	/** The average monster level around cell `i`, or 0 with none. */
	levelAt(i: number): number {
		const k = this.levelCount[i]
		return k > 0 ? this.levelSum[i] / k : 0
	}

	/**
	 * Sets each paint chunk's zone level (`levels`, 0 where a chunk has none) and how far a cell's level
	 * may stray from it before it is hatched (0 for never). Marks every cell when either changed.
	 */
	setZones(levels: Int16Array | null, stray: number) {
		if (levels === this.zoneLevels && stray === this.stray) return
		this.zoneLevels = levels
		this.stray = stray
		this.dirty = { x0: 0, z0: 0, x1: this.n - 1, z1: this.n - 1 }
	}

	/** Whether cell (cx, cz)'s average level is more than the stray from its chunk's zone level. */
	strays(cx: number, cz: number): boolean {
		const zl = this.zoneLevels
		if (!zl || this.stray <= 0) return false
		const i = cz * this.n + cx
		if (!this.levelCount[i]) return false
		const side = this.n / this.chunkCells
		const zone = zl[Math.floor(cz / this.chunkCells) * side + Math.floor(cx / this.chunkCells)]
		return zone > 0 && Math.abs(this.levelAt(i) - zone) > this.stray
	}

	/**
	 * Writes the cells in `rect` (the dirty ones by default) into `out`, `stride` bytes a cell from
	 * `offset`: the level byte (LEVEL_SCALE a level, 0 for no monster), then the density byte (the
	 * creatures, at most COUNT_MAX, with STRAY_BIT). Returns the rect written, or null, and clears `dirty`.
	 */
	encode(out: Uint8Array, stride = 4, offset = 2, rect: DirtyRect | null = this.dirty): DirtyRect | null {
		this.dirty = null
		if (!rect) return null
		const n = this.n
		for (let cz = rect.z0; cz <= rect.z1; cz++) {
			for (let cx = rect.x0; cx <= rect.x1; cx++) {
				const i = cz * n + cx
				const k = this.levelCount[i]
				const lv = k > 0 ? Math.min(255, Math.max(1, Math.round((this.levelSum[i] / k) * LEVEL_SCALE))) : 0
				const c = Math.min(COUNT_MAX, this.count[i])
				const o = i * stride + offset
				out[o] = lv
				out[o + 1] = c | (this.strays(cx, cz) ? STRAY_BIT : 0)
			}
		}
		return rect
	}
}

/**
 * Each paint chunk's zone level, from its area ID (`areaIds`) and the areas' exploration levels
 * (`levelOf`, 0 for one not known), a subzone without one taking its zone's (`parentOf`).
 */
export function chunkZoneLevels(areaIds: Uint32Array, levelOf: ReadonlyMap<number, number>, parentOf: ReadonlyMap<number, number>, out = new Int16Array(areaIds.length)): Int16Array {
	for (let c = 0; c < areaIds.length; c++) {
		const id = areaIds[c]
		let lv = id ? (levelOf.get(id) ?? 0) : 0
		if (lv <= 0 && id) lv = levelOf.get(parentOf.get(id) ?? 0) ?? 0
		out[c] = lv > 0 ? lv : 0
	}
	return out
}

/** The density ramp's colour for `count` creatures (0xRRGGBB), blended between its stops. */
export function densityColor(count: number): number {
	const t = Math.min(1, Math.max(0, (count - 1) / (GROUND_CROWD - 1)))
	const x = t * (DENSITY_RAMP.length - 1)
	const i = Math.min(DENSITY_RAMP.length - 2, Math.floor(x))
	const f = x - i
	let out = 0
	for (const shift of [16, 8, 0]) {
		const a = (DENSITY_RAMP[i] >> shift) & 0xff
		const b = (DENSITY_RAMP[i + 1] >> shift) & 0xff
		out |= Math.round(a + (b - a) * f) << shift
	}
	return out
}

/** The legend's rows for a mode: the level ramp over `levels` in a few steps, or the density ramp. */
export function groundLegend(mode: GroundOverlay, levels: readonly [number, number]): LegendRow[] {
	if (mode === 'density') {
		const steps = [1, 4, 8, 12, GROUND_CROWD]
		return steps.map((k, i) => ({ color: densityColor(k), label: i === steps.length - 1 ? `${k} or more creatures` : k === 1 ? '1 creature' : `${k} creatures` }))
	}
	if (mode !== 'level') return []
	const [lo, hi] = levels
	if (hi <= 0) return []
	if (hi <= lo) return [{ color: rampColor(0.5), label: `Level ${Math.round(lo)}` }]
	const rows: LegendRow[] = []
	let last = -1
	for (let i = 0; i < 5; i++) {
		const t = i / 4
		const lv = Math.round(lo + (hi - lo) * t)
		if (lv === last) continue
		last = lv
		rows.push({ color: rampColor(t), label: `Level ${lv}` })
	}
	rows[0].label += ' and below'
	rows[rows.length - 1].label += ' and above'
	return rows
}
