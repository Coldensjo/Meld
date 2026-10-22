// Check Map (#176): models placed twice, floating above the ground, or buried under it.
import { capped, type Box, type Finding } from './findings'

/** A placed model for the checks: its placement and, once its mesh is loaded, its world box. */
export interface CheckModel {
	id: number
	type: string
	name: string
	parent?: number
	x: number
	z: number
	yOff: number
	rotY: number
	scale: number
	box: Box | null
}

/** How close two copies must be (yards, radians, scale) to count as the same placement. */
const SAME_PLACE = 0.05
const SAME_TURN = 0.01

/**
 * Models of the same type placed at the same spot with the same turn and size on the same parent: an
 * accidental double paste. Each group is one finding, whose fix deletes all but the first.
 */
export function checkDuplicateModels(models: readonly CheckModel[]): Finding[] {
	// Cells of 1 yd, wider than SAME_PLACE, so a twin is in the same cell or one of the eight around it.
	const cells = new Map<string, CheckModel[]>()
	const cellKey = (m: CheckModel, dx: number, dz: number) => `${m.type}|${m.parent ?? ''}|${Math.floor(m.x) + dx}|${Math.floor(m.z) + dz}`
	for (const m of models) {
		const key = cellKey(m, 0, 0)
		let b = cells.get(key)
		if (!b) cells.set(key, (b = []))
		b.push(m)
	}
	const order = new Map<number, number>()
	models.forEach((m, i) => order.set(m.id, i))
	const out: Finding[] = []
	const seen = new Set<number>()
	for (const a of models) {
		if (seen.has(a.id)) continue
		const twins: CheckModel[] = []
		for (let dx = -1; dx <= 1; dx++) {
			for (let dz = -1; dz <= 1; dz++) {
				for (const o of cells.get(cellKey(a, dx, dz)) ?? []) {
					if (
						o !== a &&
						!seen.has(o.id) &&
						Math.abs(o.x - a.x) < SAME_PLACE &&
						Math.abs(o.z - a.z) < SAME_PLACE &&
						Math.abs(o.yOff - a.yOff) < SAME_PLACE &&
						Math.abs(o.scale - a.scale) < SAME_PLACE &&
						Math.abs(Math.atan2(Math.sin(o.rotY - a.rotY), Math.cos(o.rotY - a.rotY))) < SAME_TURN
					) {
						twins.push(o)
					}
				}
			}
		}
		if (!twins.length) continue
		twins.sort((p, q) => order.get(p.id)! - order.get(q.id)!)
		seen.add(a.id)
		for (const t of twins) seen.add(t.id)
		out.push({
			check: 'Duplicate models',
			severity: 'warning',
			message: `${a.name} is placed ${twins.length + 1} times at the same spot.`,
			x: a.x,
			z: a.z,
			target: { kind: 'models', ids: twins.map((t) => t.id) },
			fix: 'deleteModels',
		})
	}
	return capped('Duplicate models', out)
}

/** How far a model's lowest point may stand above the ground before it counts as floating (yards). */
export const FLOAT_GAP = 1
/** Higher than this above the ground, a model is more likely meant to fly (a bird, an effect): info only. */
export const HIGH_UP = 8

/**
 * Root models whose lowest point is more than FLOAT_GAP above the ground everywhere under their
 * footprint, with no other model's box under them to stand on; and models whose whole box is under
 * the ground (they never show). `ground(x, z)` is the height there, -Infinity off the map or over a
 * hole; `onWater(x, y, z)`, when given, says a liquid's surface holds a foot at that height (a lily
 * pad). Attached models ride their parents and are left out.
 */
export function checkModelHeights(models: readonly CheckModel[], ground: (x: number, z: number) => number, onWater?: (x: number, y: number, z: number) => boolean): Finding[] {
	const floating: Finding[] = []
	const buried: Finding[] = []
	const withBox = models.filter((m) => m.box)
	for (const m of withBox) {
		if (m.parent !== undefined) continue
		const b = m.box!
		const xs = [b.min[0], (b.min[0] + b.max[0]) / 2, b.max[0]]
		const zs = [b.min[2], (b.min[2] + b.max[2]) / 2, b.max[2]]
		let hi = -Infinity
		let lo = Infinity
		for (const x of xs) {
			for (const z of zs) {
				const g = ground(x, z)
				if (g === -Infinity) continue
				hi = Math.max(hi, g)
				lo = Math.min(lo, g)
			}
		}
		// Over a hole or off the map everywhere: nothing to stand on or be buried in.
		if (hi === -Infinity) continue
		if (b.max[1] < lo - 0.1) {
			buried.push({
				check: 'Buried models',
				severity: 'warning',
				message: `${m.name} is under the ground (its top is ${(lo - b.max[1]).toFixed(1)} yd down).`,
				x: m.x,
				z: m.z,
				target: { kind: 'models', ids: [m.id] },
				fix: 'groundModels',
			})
			continue
		}
		const gap = b.min[1] - hi
		if (gap <= FLOAT_GAP) continue
		if (standsOnAnother(m, withBox)) continue
		if (onWater?.((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2)) continue
		const high = gap > HIGH_UP
		floating.push({
			check: 'Floating models',
			severity: high ? 'info' : 'warning',
			message: high ? `${m.name} is ${gap.toFixed(0)} yd up with nothing under it (fine for a bird or an effect).` : `${m.name} floats ${gap.toFixed(1)} yd above the ground with nothing under it.`,
			x: m.x,
			z: m.z,
			target: { kind: 'models', ids: [m.id] },
			fix: 'groundModels',
		})
	}
	return [...capped('Floating models', floating), ...capped('Buried models', buried)]
}

/** Whether another model's box reaches up to `m`'s lowest point under its footprint (a table under a lamp, a roof). */
function standsOnAnother(m: CheckModel, all: readonly CheckModel[]): boolean {
	const b = m.box!
	const foot = b.min[1]
	for (const o of all) {
		if (o === m) continue
		const ob = o.box!
		if (ob.max[0] < b.min[0] || ob.min[0] > b.max[0] || ob.max[2] < b.min[2] || ob.min[2] > b.max[2]) continue
		if (ob.max[1] >= foot - FLOAT_GAP && ob.min[1] <= foot + FLOAT_GAP) return true
		// A box that holds the model's foot inside it (a lamp on a wall of a building's box).
		if (ob.min[1] <= foot && ob.max[1] >= foot) return true
	}
	return false
}
