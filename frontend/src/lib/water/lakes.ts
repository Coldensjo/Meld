import { LIQUID_CELLS, LIQUID_VERTS, autoOpacity, cloneLayer, newLayer, type LiquidGround, type LiquidLayer, type LiquidMap } from './liquids'

// Lakes for a new world (#759): the basins of the ground that would hold water, each filled to its
// spill height, the level where it would overflow its rim. The fill is a priority flood (Barnes,
// Lehman and Mulla 2014) from the map's edge: every vertex takes the lowest level water must reach
// to flow from it off the map, so a basin's vertices all take its rim's height and a slope's take
// their own. The basins under the sea are the sea's, so only those whose level stands above it count.

/** What makes a basin a lake rather than a puddle or a whole valley. */
export interface LakeRules {
	/** The sea's level, or null for a map without one: basins at or under it are left to the sea. */
	sea: number | null
	/** The least depth of a lake, in yards: shallower pits from noise and erosion stay dry. */
	minDepth: number
	/** The least area of a lake, in square yards. */
	minArea: number
	/** The most of the map one lake may cover, 0 to 1: a Canyon's whole floor is a basin, not a lake. */
	maxShare: number
}

export const LAKE_RULES: Omit<LakeRules, 'sea'> = { minDepth: 2, minArea: 400, maxShare: 0.12 }

/**
 * The lakes of heights `h` (`V` vertices a side, `cellSize` yards apart): each vertex's lake surface,
 * NaN where it holds no lake. A lake's vertices all take one level, its spill height.
 */
export function findLakes(h: Float32Array, V: number, cellSize: number, rules: LakeRules): Float32Array {
	const n = V * V
	const filled = new Float32Array(n)
	const done = new Uint8Array(n)
	const heap = new MinHeap(n)
	// The edge drains off the map.
	for (let i = 0; i < V; i++) {
		for (const v of [i, (V - 1) * V + i, i * V, i * V + V - 1]) {
			if (done[v]) continue
			done[v] = 1
			filled[v] = h[v]
			heap.push(v, h[v])
		}
	}
	while (heap.size) {
		const v = heap.pop()
		const x = v % V
		const z = (v - x) / V
		const level = filled[v]
		for (let k = 0; k < 4; k++) {
			const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0)
			const nz = z + (k === 2 ? 1 : k === 3 ? -1 : 0)
			if (nx < 0 || nz < 0 || nx >= V || nz >= V) continue
			const u = nz * V + nx
			if (done[u]) continue
			done[u] = 1
			filled[u] = Math.max(h[u], level)
			heap.push(u, filled[u])
		}
	}
	// Each basin: its wet vertices, kept as a lake when deep, big and small enough.
	const out = new Float32Array(n).fill(NaN)
	const seen = new Uint8Array(n)
	const stack: number[] = []
	const members: number[] = []
	const above = rules.sea ?? -Infinity
	const wet = (v: number) => filled[v] - h[v] > 0.01 && filled[v] > above + 0.01
	const cellArea = cellSize * cellSize
	const maxVerts = rules.maxShare * n
	for (let s = 0; s < n; s++) {
		if (seen[s] || !wet(s)) continue
		members.length = 0
		let deepest = 0
		seen[s] = 1
		stack.push(s)
		while (stack.length) {
			const v = stack.pop()!
			members.push(v)
			deepest = Math.max(deepest, filled[v] - h[v])
			const x = v % V
			const z = (v - x) / V
			if (x > 0 && !seen[v - 1] && wet(v - 1)) ((seen[v - 1] = 1), stack.push(v - 1))
			if (x < V - 1 && !seen[v + 1] && wet(v + 1)) ((seen[v + 1] = 1), stack.push(v + 1))
			if (z > 0 && !seen[v - V] && wet(v - V)) ((seen[v - V] = 1), stack.push(v - V))
			if (z < V - 1 && !seen[v + V] && wet(v + V)) ((seen[v + V] = 1), stack.push(v + V))
		}
		if (deepest < rules.minDepth || members.length * cellArea < rules.minArea || members.length > maxVerts) continue
		for (const v of members) out[v] = filled[v]
	}
	return out
}

/**
 * Writes lakes `level` (from `findLakes`, one per ground vertex) into `map` as layers of liquid `id`,
 * the water brush's layout: every cell with a lake corner is covered, each corner at the lake's level
 * (a shore corner at its cell's), its depth from the ground by the brush's rule. Returns the cells
 * covered. A chunk's other liquids leave those cells.
 */
export function fillLakes(map: LiquidMap, ground: LiquidGround, level: Float32Array, id: number): number {
	const V = ground.verts
	const factor = autoOpacity(id)
	const work = new Map<number, LiquidLayer[]>()
	let covered = 0
	for (let gz = 0; gz < ground.size; gz++) {
		for (let gx = 0; gx < ground.size; gx++) {
			const v = gz * V + gx
			let top = -Infinity
			for (const k of [v, v + 1, v + V, v + V + 1]) if (!Number.isNaN(level[k])) top = Math.max(top, level[k])
			if (top === -Infinity) continue
			const c = Math.floor(gz / LIQUID_CELLS) * map.side + Math.floor(gx / LIQUID_CELLS)
			let layers = work.get(c)
			if (!layers) {
				layers = map.layers(c).map(cloneLayer)
				work.set(c, layers)
			}
			let layer = layers.find((l) => l.id === id)
			if (!layer) {
				layer = newLayer(id, top)
				layers.push(layer)
			}
			const lx = gx % LIQUID_CELLS
			const lz = gz % LIQUID_CELLS
			for (const l of layers) l.cells[lz * LIQUID_CELLS + lx] = l === layer ? 1 : 0
			for (let dz = 0; dz <= 1; dz++) {
				for (let dx = 0; dx <= 1; dx++) {
					const k = v + dz * V + dx
					const surface = Number.isNaN(level[k]) ? top : level[k]
					const i = (lz + dz) * LIQUID_VERTS + lx + dx
					layer.heights[i] = surface
					layer.depth[i] = Math.min(1, Math.max(0, (surface - ground.heights[k] + 1) * factor))
				}
			}
			covered++
		}
	}
	for (const [c, layers] of work) map.set(c, layers)
	return covered
}

/**
 * The lake level near each vertex: its own, or a lake's within `reach` vertices, NaN where there is
 * none. For `Terrain.autoPaint` to lay sand along the shores as it does along the sea's.
 */
export function shoreLevels(level: Float32Array, V: number, reach = 2): Float32Array {
	let cur = level
	for (let pass = 0; pass < reach; pass++) {
		const next = cur.slice()
		for (let z = 0; z < V; z++) {
			for (let x = 0; x < V; x++) {
				const v = z * V + x
				if (!Number.isNaN(cur[v])) continue
				// The highest lake beside it (a comparison with NaN is false, so dry neighbours never win).
				let best = -Infinity
				if (x > 0 && cur[v - 1] > best) best = cur[v - 1]
				if (x < V - 1 && cur[v + 1] > best) best = cur[v + 1]
				if (z > 0 && cur[v - V] > best) best = cur[v - V]
				if (z < V - 1 && cur[v + V] > best) best = cur[v + V]
				if (best > -Infinity) next[v] = best
			}
		}
		cur = next
	}
	return cur
}

/** A binary min-heap of vertex indices by a float key, preallocated for `cap` entries. */
class MinHeap {
	private idx: Int32Array
	private key: Float32Array
	size = 0
	constructor(cap: number) {
		this.idx = new Int32Array(cap)
		this.key = new Float32Array(cap)
	}
	push(v: number, k: number) {
		let i = this.size++
		while (i > 0) {
			const p = (i - 1) >> 1
			if (this.key[p] <= k) break
			this.idx[i] = this.idx[p]
			this.key[i] = this.key[p]
			i = p
		}
		this.idx[i] = v
		this.key[i] = k
	}
	pop(): number {
		const top = this.idx[0]
		const n = --this.size
		const v = this.idx[n]
		const k = this.key[n]
		let i = 0
		for (;;) {
			let c = 2 * i + 1
			if (c >= n) break
			if (c + 1 < n && this.key[c + 1] < this.key[c]) c++
			if (this.key[c] >= k) break
			this.idx[i] = this.idx[c]
			this.key[i] = this.key[c]
			i = c
		}
		this.idx[i] = v
		this.key[i] = k
		return top
	}
}
