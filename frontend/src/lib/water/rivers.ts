import { LAKE_RULES, findLakes, priorityFlood, type Flood } from './lakes'

// Rivers for a new world (#763): each from the high ground down to the sea or a lake, along the way
// water would take. The priority flood (lakes.ts) gives every vertex the one it drains to, pits and
// flats included, and summing each vertex's drainage down that tree (flow accumulation) gives where
// water gathers. A river is picked at its mouth, the dry vertex draining into the sea or a lake that
// gathers the most water, and followed upstream along its largest branch until the branch gathers too
// little to run. The biggest rivers come first, each kept clear of the ones before.

/** What makes a stream a river, and how many a world gets. */
export interface RiverRules {
	/** The sea's level, or null for a map without one: its rivers then run off the map's edge. */
	sea: number | null
	/** The most rivers. */
	count: number
	/** The least ground a river drains at its mouth, square yards. */
	minArea: number
	/** The ground a stream drains where it rises: upstream of that it is too small to run. */
	sourceArea: number
	/** The shortest river, yards. */
	minLength: number
	/** How much lower a river's mouth lies than its source at least, yards: one from the high ground. */
	minDrop: number
	/** How far one river keeps from another, yards. */
	spacing: number
}

export const RIVER_RULES: Omit<RiverRules, 'sea' | 'count'> = { minArea: 30000, sourceArea: 3000, minLength: 160, minDrop: 8, spacing: 60 }

/** The most rivers the New world page offers. */
export const MAX_RIVERS = 8

/** A river as found: where it runs, and what it drains. */
export interface River {
	/** Its vertices, from the source down to the mouth; for a river into a lake, the last is the lake's. */
	verts: number[]
	/** Its surface at each vertex: the flooded ground, never under the sea, falling all the way. */
	surface: number[]
	/** Where it rises: high ground, or a lake it runs out of (then the first vertex is the lake's). */
	from: 'source' | 'lake'
	/** What it runs into. */
	into: 'sea' | 'lake' | 'edge'
	/** The ground it drains at its mouth, square yards. */
	area: number
}

/**
 * The rivers of heights `h` (`V` vertices a side, `cellSize` yards apart), the biggest first, up to
 * `rules.count`. `lakes` are the lake levels (`findLakes`, NaN where none) they may end in; a river
 * never runs through one, nor through a basin too deep for it to cross (one too small or too big to
 * be a lake): those are where its sources stop climbing.
 */
export function findRivers(h: Float32Array, V: number, cellSize: number, rules: RiverRules, lakes: Float32Array, flood: Flood = priorityFlood(h, V)): River[] {
	const out: River[] = []
	if (rules.count <= 0) return out
	const n = V * V
	const { filled, down, order } = flood
	const sea = rules.sea ?? -Infinity
	// Basins as deep as a lake's, whatever their size: a river doesn't cross them.
	const basins = findLakes(h, V, cellSize, { sea: rules.sea, minDepth: LAKE_RULES.minDepth, minArea: 0, maxShare: 1 }, flood)
	const wet = (v: number) => h[v] < sea || !Number.isNaN(lakes[v])
	const blocked = (v: number) => wet(v) || !Number.isNaN(basins[v])
	// Flow accumulation, from the heads down: a vertex comes after the one it drains to in `order`.
	const acc = new Float32Array(n).fill(1)
	const branch = new Int32Array(n).fill(-1)
	for (let i = n - 1; i >= 0; i--) {
		const u = order[i]
		const d = down[u]
		if (d < 0) continue
		acc[d] += acc[u]
		if (branch[d] < 0 || acc[u] > acc[branch[d]]) branch[d] = u
	}
	// The mouths: dry vertices draining into the sea or a lake, or off the edge of a map with no sea.
	const cellArea = cellSize * cellSize
	const least = rules.minArea / cellArea
	const mouths: number[] = []
	for (let v = 0; v < n; v++) {
		if (acc[v] < least || blocked(v)) continue
		const d = down[v]
		if (d < 0 ? rules.sea === null : wet(d)) mouths.push(v)
	}
	mouths.sort((a, b) => acc[b] - acc[a])
	const taken = new Uint8Array(n)
	const reach = Math.max(1, Math.round(rules.spacing / cellSize))
	const source = rules.sourceArea / cellArea
	for (const m of mouths) {
		if (out.length >= rules.count) break
		if (taken[m]) continue
		const up = [m]
		let v = branch[m]
		for (; v >= 0 && acc[v] >= source && !blocked(v) && !taken[v]; v = branch[v]) up.push(v)
		const head = up[up.length - 1]
		// Out of a lake: a vertex past its shore, so the lake's water meets the river's.
		const from = v >= 0 && !taken[v] && !Number.isNaN(lakes[v]) && h[v] >= sea ? 'lake' : 'source'
		const d = down[m]
		const into = d < 0 ? 'edge' : h[d] < sea ? 'sea' : 'lake'
		if ((up.length - 1) * cellSize < rules.minLength || filled[head] - Math.max(filled[m], sea) < rules.minDrop) continue
		if (from === 'lake') up.push(v)
		const verts = up.reverse()
		// Into a lake, a vertex past the shore, so the river's water meets the lake's.
		if (into === 'lake') verts.push(d)
		const surface: number[] = []
		let last = Infinity
		for (const v of verts) {
			last = Math.min(last, Math.max(Number.isNaN(lakes[v]) ? filled[v] : lakes[v], sea))
			surface.push(last)
		}
		out.push({ verts, surface, from, into, area: acc[m] * cellArea })
		for (const v of verts) mark(taken, V, v, reach)
	}
	return out
}

/** Marks the vertices within `r` of vertex `v`. */
function mark(taken: Uint8Array, V: number, v: number, r: number) {
	const x = v % V
	const z = (v - x) / V
	for (let j = Math.max(0, z - r); j <= Math.min(V - 1, z + r); j++) {
		for (let i = Math.max(0, x - r); i <= Math.min(V - 1, x + r); i++) {
			if ((i - x) * (i - x) + (j - z) * (j - z) <= r * r) taken[j * V + i] = 1
		}
	}
}

/** A river's width in yards, from the ground it drains: a brook from a few hills, a broad river from a range. */
export function riverWidth(area: number): number {
	return Math.round(Math.min(16, Math.max(6, 3 + Math.sqrt(area) / 60)))
}

/**
 * A river's course as control points for a River path (terrain/paths.ts): about every `step` yards
 * along its vertices, ends included, smoothed so the curve doesn't follow the grid's stair steps, each
 * at the river's surface there. World x and z are the vertex's times `cellSize`.
 */
export function riverPoints(r: River, V: number, cellSize: number, step = 24): { x: number; y: number; z: number }[] {
	const k = Math.max(1, Math.round(step / cellSize))
	const pick: number[] = []
	for (let i = 0; i < r.verts.length - 1; i += k) pick.push(i)
	pick.push(r.verts.length - 1)
	// A short last span would kink the curve: the last pick before it goes.
	if (pick.length > 2 && pick[pick.length - 1] - pick[pick.length - 2] < k / 2) pick.splice(pick.length - 2, 1)
	const pts = pick.map((i) => {
		const v = r.verts[i]
		const x = v % V
		return { x: x * cellSize, y: r.surface[i], z: ((v - x) / V) * cellSize }
	})
	for (let pass = 0; pass < 2; pass++) {
		const was = pts.map((p) => ({ x: p.x, z: p.z }))
		for (let i = 1; i < pts.length - 1; i++) {
			pts[i].x = 0.25 * was[i - 1].x + 0.5 * was[i].x + 0.25 * was[i + 1].x
			pts[i].z = 0.25 * was[i - 1].z + 0.5 * was[i].z + 0.25 * was[i + 1].z
		}
	}
	return pts
}

/** A new world's water as planned from its ground: the lake levels to fill (NaN where none) and its rivers. */
export interface WaterPlan {
	lakes: Float32Array | null
	rivers: River[]
}

/**
 * Plans a new world's lakes and rivers over heights `h`: with `lakes` every lake the ground holds,
 * else only those a river runs into or out of, and up to `rivers` rivers. Null lakes when none are to be filled.
 */
export function planWater(h: Float32Array, V: number, cellSize: number, sea: number | null, lakes: boolean, rivers: number): WaterPlan {
	const flood = priorityFlood(h, V)
	const all = findLakes(h, V, cellSize, { ...LAKE_RULES, sea }, flood)
	const found = rivers > 0 ? findRivers(h, V, cellSize, { ...RIVER_RULES, sea, count: rivers }, all, flood) : []
	if (lakes) return { lakes: all, rivers: found }
	const ends: number[] = []
	for (const r of found) {
		if (r.from === 'lake') ends.push(r.verts[0])
		if (r.into === 'lake') ends.push(r.verts[r.verts.length - 1])
	}
	if (!ends.length) return { lakes: null, rivers: found }
	// Only the lakes the rivers run into: each one's vertices from the river's last.
	const kept = new Float32Array(V * V).fill(NaN)
	const stack = [...ends]
	while (stack.length) {
		const v = stack.pop()!
		if (!Number.isNaN(kept[v]) || Number.isNaN(all[v])) continue
		kept[v] = all[v]
		const x = v % V
		if (x > 0) stack.push(v - 1)
		if (x < V - 1) stack.push(v + 1)
		if (v >= V) stack.push(v - V)
		if (v < V * V - V) stack.push(v + V)
	}
	return { lakes: kept, rivers: found }
}
