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

	/** The chunks that ended up different, each with its layers before; the stroke starts over. */
	changed(): Map<number, LiquidLayer[]> {
		const before = new Map<number, LiquidLayer[]>()
		for (const [c, layers] of this.before) if (!sameLayers(layers, this.map.layers(c))) before.set(c, layers)
		this.before.clear()
		return before
	}

	finish(): Command | null {
		const map = this.map
		const before = this.changed()
		if (!before.size) return null
		const after = new Map<number, LiquidLayer[]>()
		for (const c of before.keys()) after.set(c, map.layers(c).map(cloneLayer))
		const apply = (m: Map<number, LiquidLayer[]>) => {
			for (const [c, layers] of m) map.set(c, layers.map(cloneLayer))
		}
		let bytes = 0
		for (const m of [before, after]) for (const layers of m.values()) for (const l of layers) bytes += l.heights.byteLength + l.depth.byteLength + l.cells.byteLength
		return { label: this.label, bytes, undo: () => apply(before), redo: () => apply(after) }
	}
}
