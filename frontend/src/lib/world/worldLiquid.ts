import { LIQUID_CELLS, LIQUID_VERTS, TILE_YARDS } from '../wow/format'
import type { GroundStride } from './worldGround'

// The world view's liquids (#15), kept free of three.js so they can be tested: one client tile's MCLQ
// layers as /wow/groundliquids sends them (wow.EncodeLiquids), and the mesh arrays they are drawn with
// in the tile's own frame, as a region's LiquidRenderer draws its layers.

const NV = LIQUID_VERTS * LIQUID_VERTS
const NC = LIQUID_CELLS * LIQUID_CELLS
/** A liquid cell's side in yards: a tile is 16 chunks of 8 cells. */
const CELL = TILE_YARDS / 16 / LIQUID_CELLS
/** The bytes of one layer in the reply (wow.LiquidLayerSize). */
export const LIQUID_LAYER_BYTES = 4 + NV * 4 + NV + NC

/** One liquid layer of a chunk of a tile, as the client stores it (adt.Liquid). */
export interface TileLiquid {
	/** The chunk in the tile, 0 to 15 east and south. */
	indexX: number
	indexY: number
	/** The liquid, as the tile names it (LIQUID_WATER, LIQUID_OCEAN, LIQUID_MAGMA or LIQUID_SLIME). */
	type: number
	/** The surface heights at the chunk's 9x9 vertices, row by row, in absolute yards. */
	heights: Float32Array
	/** Each vertex's opacity, 0 (clear) to 255 (deep). */
	depth: Uint8Array
	/** The chunk's 8x8 cells, 1 where the liquid covers it. */
	cells: Uint8Array
}

/** Reads a /wow/groundliquids reply: "LIQD", a uint16 count, then each layer as LIQUID_LAYER_BYTES. */
export function parseLiquids(buf: ArrayBuffer): TileLiquid[] {
	const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
	if (String.fromCharCode(...head) !== 'LIQD' || buf.byteLength < 6) throw new Error(`not a tile's liquids (${buf.byteLength} bytes)`)
	const v = new DataView(buf)
	const n = v.getUint16(4, true)
	if (buf.byteLength !== 6 + n * LIQUID_LAYER_BYTES) throw new Error(`a tile's liquids of ${buf.byteLength} bytes for ${n} layers`)
	const out: TileLiquid[] = []
	for (let k = 0, at = 6; k < n; k++, at += LIQUID_LAYER_BYTES) {
		// The heights start at an odd offset, which a Float32Array cannot view: they are read one by one.
		const heights = new Float32Array(NV)
		for (let i = 0; i < NV; i++) heights[i] = v.getFloat32(at + 4 + i * 4, true)
		out.push({
			indexX: v.getUint8(at),
			indexY: v.getUint8(at + 1),
			type: v.getUint8(at + 2),
			heights,
			depth: new Uint8Array(buf.slice(at + 4 + NV * 4, at + 4 + NV * 5)),
			cells: new Uint8Array(buf.slice(at + 4 + NV * 5, at + LIQUID_LAYER_BYTES)),
		})
	}
	return out
}

/** Whether layer `l` covers all of the `s` x `s` cells from cell (c, r). */
function allCovered(l: TileLiquid, c: number, r: number, s: number): boolean {
	for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) if (!l.cells[y * LIQUID_CELLS + x]) return false
	return true
}

/**
 * The mesh of a tile's liquid layers at `stride`, in the tile's own frame (its north-west corner at the
 * origin), as LiquidRenderer builds a region's: each layer's 9x9 vertices at its surface heights, with
 * its depth (0 to 1) and the shader's kind (`kindOf` its type), and two triangles a covered cell, in
 * noggit's order. At a stride of 2 or 4 a block of that many cells a side that the layer covers
 * whole is two triangles from the block's corners, so an open sea far off costs a sixteenth; a block
 * with a dry cell keeps its cells. null when no cell is covered.
 */
export function liquidMesh(layers: readonly TileLiquid[], stride: GroundStride, kindOf: (type: number) => number): { positions: Float32Array; depth: Float32Array; kind: Float32Array; index: Uint32Array } | null {
	const s = stride
	const corner = (p: number, r: number, c: number) => p + r * LIQUID_VERTS + c
	let tris = 0
	for (const l of layers) {
		for (let r = 0; r < LIQUID_CELLS; r += s) {
			for (let c = 0; c < LIQUID_CELLS; c += s) {
				if (s > 1 && allCovered(l, c, r, s)) {
					tris += 2
					continue
				}
				for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) if (l.cells[y * LIQUID_CELLS + x]) tris += 2
			}
		}
	}
	if (!tris) return null
	const positions = new Float32Array(layers.length * NV * 3)
	const depth = new Float32Array(layers.length * NV)
	const kind = new Float32Array(layers.length * NV)
	const index = new Uint32Array(tris * 3)
	let k = 0
	const quad = (a: number, b: number, c: number, d: number) => {
		// noggit's triangles: (p, p+9, p+10) and (p+10, p+1, p), with b below a, c below and right, d right.
		index[k++] = a
		index[k++] = b
		index[k++] = c
		index[k++] = c
		index[k++] = d
		index[k++] = a
	}
	layers.forEach((l, n) => {
		const p = n * NV
		const ox = l.indexX * LIQUID_CELLS * CELL
		const oz = l.indexY * LIQUID_CELLS * CELL
		const kd = kindOf(l.type)
		for (let i = 0; i < NV; i++) {
			positions[(p + i) * 3] = ox + (i % LIQUID_VERTS) * CELL
			positions[(p + i) * 3 + 1] = l.heights[i]
			positions[(p + i) * 3 + 2] = oz + Math.floor(i / LIQUID_VERTS) * CELL
			depth[p + i] = l.depth[i] / 255
			kind[p + i] = kd
		}
		for (let r = 0; r < LIQUID_CELLS; r += s) {
			for (let c = 0; c < LIQUID_CELLS; c += s) {
				if (s > 1 && allCovered(l, c, r, s)) {
					quad(corner(p, r, c), corner(p, r + s, c), corner(p, r + s, c + s), corner(p, r, c + s))
					continue
				}
				for (let y = r; y < r + s; y++) {
					for (let x = c; x < c + s; x++) {
						if (l.cells[y * LIQUID_CELLS + x]) quad(corner(p, y, x), corner(p, y + 1, x), corner(p, y + 1, x + 1), corner(p, y, x + 1))
					}
				}
			}
		}
	})
	return { positions, depth, kind, index }
}
