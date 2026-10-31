// A layered layout of a small directed graph (#948, the quest editor's chain view; the node editor of
// #30 is to use it too): each node gets a layer (a column, from first to last) and a row within it.
// Layers come from the longest path to each node, after the edges that close a loop are set aside;
// rows from the mean row of each node's predecessors, so arrows cross less. Meant for tens of nodes,
// not thousands: no allocation worries, it runs once when the graph changes.

export interface LayerEdge<K> {
	from: K
	to: K
}

/**
 * The layer of each node (0 for the first) and the indices of the edges set aside because they close
 * a loop (found by a depth-first walk in `nodes` order). Edges whose ends aren't both in `nodes` are ignored.
 */
export function layers<K>(nodes: readonly K[], edges: readonly LayerEdge<K>[]): { layer: Map<K, number>; back: Set<number> } {
	const known = new Set(nodes)
	const out = new Map<K, number[]>()
	for (const n of nodes) out.set(n, [])
	edges.forEach((e, i) => {
		if (known.has(e.from) && known.has(e.to)) out.get(e.from)!.push(i)
	})
	// Loops: an edge to a node still on the walk's stack.
	const back = new Set<number>()
	const state = new Map<K, 1 | 2>()
	for (const start of nodes) {
		if (state.has(start)) continue
		const stack: { node: K; next: number }[] = [{ node: start, next: 0 }]
		state.set(start, 1)
		while (stack.length) {
			const top = stack[stack.length - 1]
			const list = out.get(top.node)!
			if (top.next >= list.length) {
				state.set(top.node, 2)
				stack.pop()
				continue
			}
			const i = list[top.next++]
			const to = edges[i].to
			const s = state.get(to)
			if (s === 1) back.add(i)
			else if (s === undefined) {
				state.set(to, 1)
				stack.push({ node: to, next: 0 })
			}
		}
	}
	// Longest path, in topological order over the edges that remain.
	const indeg = new Map<K, number>()
	for (const n of nodes) indeg.set(n, 0)
	for (const n of nodes) for (const i of out.get(n)!) if (!back.has(i)) indeg.set(edges[i].to, indeg.get(edges[i].to)! + 1)
	const layer = new Map<K, number>()
	const ready = nodes.filter((n) => indeg.get(n) === 0)
	for (const n of ready) layer.set(n, 0)
	while (ready.length) {
		const n = ready.shift()!
		for (const i of out.get(n)!) {
			if (back.has(i)) continue
			const to = edges[i].to
			layer.set(to, Math.max(layer.get(to) ?? 0, layer.get(n)! + 1))
			indeg.set(to, indeg.get(to)! - 1)
			if (indeg.get(to) === 0) ready.push(to)
		}
	}
	return { layer, back }
}

/**
 * The row of each node within its layer: the first layer in `nodes` order, each later one by the mean
 * row of the node's predecessors in earlier layers (nodes without one keep `nodes` order, after the rest).
 */
export function rows<K>(nodes: readonly K[], edges: readonly LayerEdge<K>[], layer: ReadonlyMap<K, number>): Map<K, number> {
	const preds = new Map<K, K[]>()
	for (const e of edges) {
		const a = layer.get(e.from)
		const b = layer.get(e.to)
		if (a === undefined || b === undefined || a >= b) continue
		const p = preds.get(e.to)
		if (p) p.push(e.from)
		else preds.set(e.to, [e.from])
	}
	const byLayer = new Map<number, K[]>()
	for (const n of nodes) {
		const l = layer.get(n)
		if (l === undefined) continue
		const list = byLayer.get(l)
		if (list) list.push(n)
		else byLayer.set(l, [n])
	}
	const row = new Map<K, number>()
	for (const l of [...byLayer.keys()].sort((a, b) => a - b)) {
		const list = byLayer.get(l)!
		const key = new Map<K, number>()
		list.forEach((n, i) => {
			const p = (preds.get(n) ?? []).map((x) => row.get(x)).filter((r): r is number => r !== undefined)
			key.set(n, p.length ? p.reduce((s, r) => s + r, 0) / p.length : 1e9 + i)
		})
		const sorted = list.map((n, i) => ({ n, i })).sort((a, b) => key.get(a.n)! - key.get(b.n)! || a.i - b.i)
		sorted.forEach((s, i) => row.set(s.n, i))
	}
	return row
}
