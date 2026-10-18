// The liquids the walkable-ground navmesh (#175, #239) marks, as VMaNGOS's mmap generator sees them:
// the map file its extractor writes from the tile's MCLQ (contrib/extractor/System.cpp), read back by
// TerrainBuilder::loadMap. Per chunk that is one liquid type (the layer covering the most cells), one
// surface (each vertex the highest layer's height over a cell it shows) and a "deep" flag when any
// cell shows dark water. The editor's sea counts as ocean in the cells the export gives it
// (internal/adt/water.go, seaLayer). Deep chunks drop out of the navmesh, ground and all, as the
// server's builder leaves them ("players should not be here").

import { LIQUID_CELLS, LIQUID_OCEAN, LIQUID_VERTS, OCEAN_OPACITY, liquidType, type LiquidLayer, type LiquidMap } from '../../water/liquids'
import type { NavGround } from './navGeometry'
import { AREA_MAGMA, AREA_SLIME, AREA_WATER } from './navBuild'

const NV = LIQUID_VERTS * LIQUID_VERTS

/** A chunk's liquid as the server's map file holds it. */
interface ChunkLiquid {
	/** The area its liquid marks (water, magma or slime). */
	area: number
	/** Players can't be here: the server builds no navmesh in the chunk. */
	deep: boolean
	/** The surface at the 9x9 vertices. */
	heights: Float32Array
	/** 1 where a layer shows the cell. */
	shown: Uint8Array
}

const NONE: ChunkLiquid = { area: 0, deep: false, heights: new Float32Array(0), shown: new Uint8Array(0) }

/** noggit's opacity byte for liquid `diff` yards over the ground (Go's adt.DepthByte). */
function depthByte(diff: number, factor: number): number {
	return Math.round(Math.max(0, Math.min(1, (diff + 1) * factor)) * 255)
}

const areaOf = (id: number) => {
	const k = liquidType(id).kind
	return k === 'magma' ? AREA_MAGMA : k === 'slime' ? AREA_SLIME : AREA_WATER
}

/** The map's liquids by chunk for the navmesh, worked out on first ask and kept until `reset`. */
export class NavLiquids {
	private map: LiquidMap | null = null
	private ground: NavGround | null = null
	private sea: number | null = null
	private chunks = new Map<number, ChunkLiquid>()
	private seaLayer: LiquidLayer = { id: LIQUID_OCEAN, heights: new Float32Array(NV), depth: new Float32Array(NV), cells: new Uint8Array(64) }
	private seaDepth = new Uint8Array(NV)

	/** Starts over with these liquids, over this ground, and the sea at `sea` (null for none). */
	reset(map: LiquidMap | null, ground: NavGround, sea: number | null) {
		this.map = map
		this.ground = ground
		this.sea = sea
		this.chunks.clear()
	}

	/** Whether map cell (gx, gz) lies in a deep chunk, which has no navmesh. */
	deep(gx: number, gz: number): boolean {
		return this.chunk(gx, gz).deep
	}

	/**
	 * The liquid over map cell (gx, gz): its area, and the surface at the cell's corners in `out`
	 * ((0,0), (1,0), (0,1), (1,1)); 0 where none shows or the chunk is deep.
	 */
	cell(gx: number, gz: number, out: Float32Array): number {
		const ch = this.chunk(gx, gz)
		if (ch.deep || ch.area === 0) return 0
		const lx = gx % LIQUID_CELLS
		const lz = gz % LIQUID_CELLS
		if (!ch.shown[lz * LIQUID_CELLS + lx]) return 0
		const v = lz * LIQUID_VERTS + lx
		out[0] = ch.heights[v]
		out[1] = ch.heights[v + 1]
		out[2] = ch.heights[v + LIQUID_VERTS]
		out[3] = ch.heights[v + LIQUID_VERTS + 1]
		return ch.area
	}

	private chunk(gx: number, gz: number): ChunkLiquid {
		const g = this.ground
		if (!g || gx < 0 || gz < 0 || gx >= g.size || gz >= g.size) return NONE
		const side = g.size / LIQUID_CELLS
		const c = Math.floor(gz / LIQUID_CELLS) * side + Math.floor(gx / LIQUID_CELLS)
		let ch = this.chunks.get(c)
		if (!ch) {
			ch = this.build(c, side)
			this.chunks.set(c, ch)
		}
		return ch
	}

	private build(c: number, side: number): ChunkLiquid {
		const painted = this.map && c < this.map.side * this.map.side ? this.map.layers(c) : []
		const sea = this.seaFor(c, side, painted)
		if (painted.length === 0 && !sea) return NONE
		const heights = new Float32Array(NV)
		const set = new Uint8Array(NV)
		const shown = new Uint8Array(64)
		let deep = false
		let area = 0
		let bestCells = 0
		let bestHeight = -Infinity
		const layers = sea ? [...painted, sea] : painted
		for (const l of layers) {
			const ocean = liquidType(l.id).kind === 'ocean'
			const depth = l === sea ? this.seaDepth : null
			let cells = 0
			let top = -Infinity
			for (let i = 0; i < 64; i++) {
				if (!l.cells[i]) continue
				cells++
				shown[i] = 1
				const v = (i >> 3) * LIQUID_VERTS + (i & 7)
				const corners = [v, v + 1, v + LIQUID_VERTS, v + LIQUID_VERTS + 1]
				// The export writes an ocean cell as fatigue (dark water) when all its corners are as deep as a byte goes.
				if (ocean && corners.every((k) => (depth ? depth[k] : Math.round(l.depth[k] * 255)) >= 255)) deep = true
				for (const k of corners) {
					const h = l.heights[k]
					if (!set[k] || heights[k] < h) {
						heights[k] = h
						set[k] = 1
					}
					if (h > top) top = h
				}
			}
			if (cells > bestCells || (cells === bestCells && cells > 0 && top > bestHeight)) {
				bestCells = cells
				bestHeight = top
				area = areaOf(l.id)
			}
		}
		if (bestCells === 0) return NONE
		return { area, deep, heights, shown }
	}

	/** The sea's layer in chunk c, in the cells no painted layer covers whose ground lies below it on average. */
	private seaFor(c: number, side: number, painted: readonly LiquidLayer[]): LiquidLayer | null {
		const level = this.sea
		const g = this.ground!
		if (level === null) return null
		const s = this.seaLayer
		const ox = (c % side) * LIQUID_CELLS
		const oz = Math.floor(c / side) * LIQUID_CELLS
		const at = (x: number, z: number) => g.heights[(oz + z) * g.verts + ox + x]
		let any = false
		for (let i = 0; i < 64; i++) {
			const x = i & 7
			const z = i >> 3
			s.cells[i] = 0
			if (painted.some((l) => l.cells[i])) continue
			if ((at(x, z) + at(x + 1, z) + at(x, z + 1) + at(x + 1, z + 1)) / 4 < level) {
				s.cells[i] = 1
				any = true
			}
		}
		if (!any) return null
		for (let z = 0; z < LIQUID_VERTS; z++) {
			for (let x = 0; x < LIQUID_VERTS; x++) {
				const v = z * LIQUID_VERTS + x
				s.heights[v] = level
				this.seaDepth[v] = depthByte(level - at(x, z), OCEAN_OPACITY)
			}
		}
		return s
	}
}
