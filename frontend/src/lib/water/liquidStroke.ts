import type { Command } from '../state/history'
import { cloneLayer, type LiquidLayer, type LiquidMap } from './liquids'

function sameLayer(a: LiquidLayer, b: LiquidLayer): boolean {
	if (a.id !== b.id) return false
	for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
	for (let i = 0; i < a.heights.length; i++) if (a.heights[i] !== b.heights[i] || a.depth[i] !== b.depth[i]) return false
	return true
}

function sameLayers(a: readonly LiquidLayer[], b: readonly LiquidLayer[]): boolean {
	return a.length === b.length && a.every((l, i) => sameLayer(l, b[i]))
}

/**
 * Records a liquid edit for undo: `reserve` saves a chunk's layers before it first changes, and
 * `finish` keeps the chunks that ended up different, before and after.
 */
export class LiquidStroke {
	private before = new Map<number, LiquidLayer[]>()
	private map: LiquidMap
	private label: string

	constructor(map: LiquidMap, label: string) {
		this.map = map
		this.label = label
	}

	readonly reserve = (c: number) => {
		if (!this.before.has(c)) this.before.set(c, this.map.layers(c).map(cloneLayer))
	}

	finish(): Command | null {
		const map = this.map
		const before = new Map<number, LiquidLayer[]>()
		const after = new Map<number, LiquidLayer[]>()
		for (const [c, layers] of this.before) {
			const now = map.layers(c)
			if (sameLayers(layers, now)) continue
			before.set(c, layers)
			after.set(c, now.map(cloneLayer))
		}
		this.before.clear()
		if (!before.size) return null
		const apply = (m: Map<number, LiquidLayer[]>) => {
			for (const [c, layers] of m) map.set(c, layers.map(cloneLayer))
		}
		let bytes = 0
		for (const m of [before, after]) for (const layers of m.values()) for (const l of layers) bytes += l.heights.byteLength + l.depth.byteLength + l.cells.byteLength
		return { label: this.label, bytes, undo: () => apply(before), redo: () => apply(after) }
	}
}
