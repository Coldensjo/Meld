import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, setStatus } from '../state/editor.svelte'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE, squaresUnder, type GridRect } from '../terrain/chunkFlags'
import { ChunkDataStroke } from './chunkDataStroke'
import { ShadowStroke } from './shadowStroke'
import { SHADOW_PER_CELL } from '../terrain/bakedShadows'
import { areaName } from '../wow/areas'

/**
 * The Map data tool paints what a chunk's header says besides its ground, into every chunk whose
 * centre is under the brush (or the chunk under the cursor when the brush is smaller than a chunk):
 * in Area mode the zone (AreaTable.dbc ID), which Clear sets back to none, and in Impassable mode the
 * impassable flag, which Clear takes off. No tufts works on cells instead: it marks the cells under
 * the brush as growing no ground effect doodads (as the client's roads are), and Clear lets them grow
 * again. Shadow paints the baked shadows (MCSH) under the brush at their own resolution, 8 texels a
 * cell, and Clear lights them (B-057). Alt+click picks the zone under the cursor. A stroke is one undo
 * step.
 */
export class MapDataTool implements Tool {
	readonly usesBrush = true
	private stroke: ChunkDataStroke | null = null
	private shadows: ShadowStroke | null = null
	private chunksPainted = 0
	private rect: GridRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		if (e.altKey) {
			if (hit && editor.mapDataMode === 'area') this.pickArea(ctx, hit)
			return
		}
		if (editor.mapDataMode === 'area' && !editor.mapDataClear && !editor.mapDataArea) {
			setStatus('Pick a zone in the options bar first, or Alt+click a chunk to take its zone.', 6000)
			return
		}
		this.chunksPainted = 0
		if (editor.mapDataMode === 'shadow') this.shadows = new ShadowStroke(ctx.terrain, this.label())
		else this.stroke = new ChunkDataStroke(ctx.terrain, this.label())
		this.apply(ctx, hit)
	}

	tick(ctx: ToolContext, _dt: number, hit: THREE.Vector3 | null) {
		if (this.stroke || this.shadows) this.apply(ctx, hit)
	}

	onUp(ctx: ToolContext) {
		const cmd = this.stroke?.finish() ?? this.shadows?.finish() ?? null
		this.stroke = null
		this.shadows = null
		if (cmd) ctx.history.push(cmd)
	}

	private label() {
		if (editor.mapDataMode === 'shadow') return editor.mapDataClear ? 'Light shadows' : 'Paint shadows'
		if (editor.mapDataMode === 'impassable') return editor.mapDataClear ? 'Make passable' : 'Mark impassable'
		if (editor.mapDataMode === 'noTufts') return editor.mapDataClear ? 'Grow tufts' : 'No tufts'
		return editor.mapDataClear ? 'Clear zone' : `Paint zone ${areaName(editor.mapDataArea)}`
	}

	/** Takes the zone of the chunk under the cursor as the one to paint. */
	private pickArea(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const step = CHUNK_CELLS * t.cellSize
		const side = t.paintChunksPerSide
		const cx = Math.floor(hit.x / step)
		const cz = Math.floor(hit.z / step)
		if (cx < 0 || cz < 0 || cx >= side || cz >= side) return
		const id = t.areaIds[cz * side + cx]
		if (!id) {
			setStatus('That chunk has no zone.')
			return
		}
		editor.mapDataArea = id
		editor.mapDataClear = false
		setStatus(`Painting ${areaName(id)} (${id}).`)
	}

	private apply(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (!hit) return
		const t = ctx.terrain
		let changed = false
		const side = t.paintChunksPerSide
		const step = CHUNK_CELLS * t.cellSize
		const radius = editor.brush.radius
		if (editor.mapDataMode === 'shadow') {
			if (this.shadows) this.paintShadow(t, hit, radius, this.shadows)
			return
		}
		if (editor.mapDataMode === 'noTufts') {
			const cs = t.cellSize
			const n = t.size
			// Saved before the write: the cells the brush's square covers.
			const b = this.rect
			b.x0 = Math.max(0, Math.floor((hit.x - radius) / cs))
			b.z0 = Math.max(0, Math.floor((hit.z - radius) / cs))
			b.x1 = Math.min(n - 1, Math.floor((hit.x + radius) / cs))
			b.z1 = Math.min(n - 1, Math.floor((hit.z + radius) / cs))
			if (b.x1 < b.x0 || b.z1 < b.z0) return
			this.stroke?.reserveCells(b)
			const v = editor.mapDataClear ? 0 : 1
			squaresUnder(n, cs, hit.x, hit.z, radius, this.rect, (i) => {
				if (t.noEffect[i] === v) return
				t.noEffect[i] = v
				changed = true
			})
			if (changed) this.stroke?.touchCells(this.rect)
		} else if (editor.mapDataMode === 'impassable') {
			const set = !editor.mapDataClear
			squaresUnder(side, step, hit.x, hit.z, radius, this.rect, (i) => {
				const f = set ? t.chunkFlags[i] | CHUNK_IMPASSABLE : t.chunkFlags[i] & ~CHUNK_IMPASSABLE
				if (f === t.chunkFlags[i]) return
				t.chunkFlags[i] = f
				changed = true
			})
		} else {
			const value = editor.mapDataClear ? 0 : editor.mapDataArea
			squaresUnder(side, step, hit.x, hit.z, radius, this.rect, (i) => {
				if (t.areaIds[i] === value) return
				t.areaIds[i] = value
				changed = true
				this.chunksPainted++
			})
			if (changed) setStatus(value ? `Painting ${areaName(value)} (${value}): ${this.chunksPainted} chunks` : `Clearing the zone: ${this.chunksPainted} chunks`)
		}
		// `this.rect` is now what the brush reached: cells for no tufts, else paint chunks.
		if (changed) t.touchChunkData(this.rect, editor.mapDataMode === 'noTufts')
	}

	/** Shadows (or lights, with Clear) the shadow texels whose centres are in the brush circle. */
	private paintShadow(t: ToolContext['terrain'], hit: THREE.Vector3, radius: number, stroke: ShadowStroke) {
		const tex = t.cellSize / SHADOW_PER_CELL
		const side = t.shadowSide
		// A brush smaller than a texel still paints the texel under the cursor.
		const r = Math.max(radius, tex * 0.5)
		const b = this.rect
		b.x0 = Math.max(0, Math.floor((hit.x - r) / tex))
		b.z0 = Math.max(0, Math.floor((hit.z - r) / tex))
		b.x1 = Math.min(side - 1, Math.floor((hit.x + r) / tex))
		b.z1 = Math.min(side - 1, Math.floor((hit.z + r) / tex))
		if (b.x1 < b.x0 || b.z1 < b.z0) return
		stroke.reserve(b)
		const data = t.ensureShadow()
		const v = editor.mapDataClear ? 0 : 255
		const r2 = r * r
		let changed = false
		for (let z = b.z0; z <= b.z1; z++) {
			const dz = (z + 0.5) * tex - hit.z
			for (let x = b.x0; x <= b.x1; x++) {
				const dx = (x + 0.5) * tex - hit.x
				const i = z * side + x
				if (dx * dx + dz * dz > r2 || data[i] === v) continue
				data[i] = v
				changed = true
			}
		}
		if (changed) stroke.touch(b)
	}
}
