import type * as THREE from 'three'
import { setStatus } from '../state/editor.svelte'
import { CHUNK_CELLS, dominantTexel, findSlot, paletteIndex, replaceInChunk, swapTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'
import { TILE_CHUNKS } from '../wow/format'
import { editor, texelAt } from './BrushTool'
import { forEachTexel, type Rect, type TerrainStroke } from './brush'
import type { ToolContext } from './Tool'
import { texName } from '../wow/texName'

/**
 * Paint's Swap mode, owned by the Paint tool: a stroke replaces the texture under its start (or the
 * kept one) with the active one, under the brush or over whole chunks or tiles. `host` is the Paint
 * tool's stroke and its splat and "chunk full" reports.
 */
export class SwapPaint {
	/** The palette texture under the stroke's start, which the stroke replaces. */
	private from = -1
	/** Chunks a whole-layer swap has done in this stroke. */
	private done = new Set<number>()
	private rect: Rect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(
		private host: {
			stroke: () => TerrainStroke | null
			splatChanged: (ctx: ToolContext, r: Rect | null) => void
			chunkFull: () => void
		},
	) {}

	/** At a stroke's start: picks the texture it swaps away (in Swap mode), and forgets the last stroke's chunks. */
	start(t: Terrain, hit: THREE.Vector3 | null) {
		this.from = -1
		this.done.clear()
		if (!hit || editor.paintMode !== 'swap') return
		const sw = editor.swap
		if (sw.keep && sw.from) {
			this.from = paletteIndex(editor.palette, sw.from)
			if (this.from < 0) setStatus(`This map has no ${texName(sw.from)} to swap. Untick Keep to swap what is under the brush.`, 4000)
		} else {
			this.from = dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, hit.x, hit.z))
			if (sw.keep && this.from >= 0) sw.from = editor.palette[this.from] ?? ''
		}
		if (this.from >= 0 && this.from === editor.paintLayer) setStatus('That texture is the active one already: pick the texture to swap to.', 3000)
	}

	/** Moves the stroke's starting texture onto the active layer under the brush. */
	apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const from = this.from
		const to = editor.paintLayer
		if (from < 0 || from === to) return
		if (editor.swap.scope !== 'brush') {
			this.chunks(ctx, hit, from, to)
			return
		}
		const { radius, falloff } = editor.brush
		const strength = editor.brush.strength * ctx.pressure()
		const amt = Math.min(1, strength * dt * 5)
		let refused = 0
		const t = ctx.terrain
		const rect = forEachTexel(
			t,
			hit.x,
			hit.z,
			radius,
			falloff,
			(p, w) => {
				if (!swapTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, p, from, to, amt * w)) refused++
			},
			this.host.stroke(),
		)
		if (refused) this.host.chunkFull()
		this.host.splatChanged(ctx, rect)
	}

	/**
	 * Swaps the whole layer of the stroke's texture for the active one in each chunk the brush touches
	 * (Entire chunk) or in every chunk of the tile under the cursor (Entire tile), once a chunk a stroke,
	 * as Noggit Red's swapper's brush does. A chunk without the texture is left alone.
	 */
	private chunks(ctx: ToolContext, hit: THREE.Vector3, from: number, to: number) {
		const t = ctx.terrain
		const side = t.paintChunksPerSide
		const step = CHUNK_CELLS * t.cellSize
		const per = t.splatRes / side
		let x0: number, z0: number, x1: number, z1: number
		if (editor.swap.scope === 'tile') {
			const tile = TILE_CHUNKS * step
			x0 = Math.floor(hit.x / tile) * TILE_CHUNKS
			z0 = Math.floor(hit.z / tile) * TILE_CHUNKS
			x1 = x0 + TILE_CHUNKS - 1
			z1 = z0 + TILE_CHUNKS - 1
		} else {
			const r = editor.brush.radius
			x0 = Math.floor((hit.x - r) / step)
			z0 = Math.floor((hit.z - r) / step)
			x1 = Math.floor((hit.x + r) / step)
			z1 = Math.floor((hit.z + r) / step)
		}
		x0 = Math.max(0, x0)
		z0 = Math.max(0, z0)
		x1 = Math.min(side - 1, x1)
		z1 = Math.min(side - 1, z1)
		const r = this.rect
		for (let cz = z0; cz <= z1; cz++) {
			for (let cx = x0; cx <= x1; cx++) {
				const c = cz * side + cx
				if (this.done.has(c)) continue
				// Entire chunk takes the chunks the brush circle reaches, not only those its square covers.
				if (editor.swap.scope === 'chunk') {
					const nx = Math.max(cx * step, Math.min(hit.x, (cx + 1) * step))
					const nz = Math.max(cz * step, Math.min(hit.z, (cz + 1) * step))
					if ((nx - hit.x) ** 2 + (nz - hit.z) ** 2 > editor.brush.radius ** 2) continue
				}
				this.done.add(c)
				const slot = findSlot(t.chunkSlots, c, from)
				if (slot < 0) continue
				r.x0 = cx * per
				r.z0 = cz * per
				r.x1 = r.x0 + per - 1
				r.z1 = r.z0 + per - 1
				this.host.stroke()?.reserveSplat(r)
				replaceInChunk(side, t.splatRes, t.chunkSlots, t.weights, c, slot, to)
				this.host.splatChanged(ctx, r)
			}
		}
	}
}
