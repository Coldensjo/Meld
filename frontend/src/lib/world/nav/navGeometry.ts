// What one navmesh tile is built from (View › Walkable ground, #175): the terrain's triangles under
// the tile's box, holes left out as the ground draws them (holes.ts), and the collision faces of the
// placed models that reach into it. A model face below the ground at all three of its corners is
// left out, as VMaNGOS's builder drops the "under map" ones, so a cellar under the terrain doesn't
// count as walkable ground above.

import { writeCellIndex } from '../../terrain/holes'
import type { TileInput } from './navBuild'

/** The ground's fields a tile reads: a Terrain has them. */
export interface NavGround {
	size: number
	verts: number
	cellSize: number
	heights: Float32Array
	holes: Uint8Array
}

/** A placed model's collision faces in world space, nine floats a triangle, and their box. */
export interface PlacedCollision {
	tris: Float32Array
	min: [number, number, number]
	max: [number, number, number]
}

/** The faces of `local` (nine floats a triangle, the model's frame) moved by the column-major matrix `m`. */
export function placeFaces(local: Float32Array, m: ArrayLike<number>): PlacedCollision {
	const tris = new Float32Array(local.length)
	const min: [number, number, number] = [Infinity, Infinity, Infinity]
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < local.length; i += 3) {
		const x = local[i], y = local[i + 1], z = local[i + 2]
		const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
		const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
		const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
		tris[i] = wx
		tris[i + 1] = wy
		tris[i + 2] = wz
		if (wx < min[0]) min[0] = wx
		if (wy < min[1]) min[1] = wy
		if (wz < min[2]) min[2] = wz
		if (wx > max[0]) max[0] = wx
		if (wy > max[1]) max[1] = wy
		if (wz > max[2]) max[2] = wz
	}
	// A mirrored placement (a negative scale) turns the faces inside out: wind them back.
	const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
	if (det < 0) {
		for (let i = 0; i < tris.length; i += 9) {
			for (let k = 0; k < 3; k++) {
				const t = tris[i + 3 + k]
				tris[i + 3 + k] = tris[i + 6 + k]
				tris[i + 6 + k] = t
			}
		}
	}
	return { tris, min, max }
}

/** Gathers tiles' triangles into buffers it keeps and grows. */
export class TileGatherer {
	private pos = new Float32Array(3 * 1024)
	private idx = new Int32Array(3 * 1024)
	private cellIdx = new Uint32Array(6 * 64)
	private vc = 0
	private tc = 0
	private minY = Infinity
	private maxY = -Infinity

	/**
	 * The triangles over the box [x0, x1] × [z0, z1]: the ground's, then the models'. `groundAt` is
	 * the ground's height at a point, or null where there is none (a hole, off the map).
	 */
	gather(
		ground: NavGround,
		models: readonly PlacedCollision[],
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		groundAt: (x: number, z: number) => number | null,
	): TileInput {
		this.vc = this.tc = 0
		this.minY = Infinity
		this.maxY = -Infinity
		this.addGround(ground, x0, z0, x1, z1)
		const modelFrom = this.tc
		for (const m of models) {
			if (m.max[0] < x0 || m.min[0] > x1 || m.max[2] < z0 || m.min[2] > z1) continue
			this.addModel(m.tris, x0, z0, x1, z1, groundAt)
		}
		return { pos: this.pos, vertCount: this.vc, idx: this.idx, triCount: this.tc, modelFrom, minY: this.minY, maxY: this.maxY }
	}

	private reserve(verts: number, tris: number) {
		if ((this.vc + verts) * 3 > this.pos.length) {
			const p = new Float32Array(Math.max(this.pos.length * 2, (this.vc + verts) * 3))
			p.set(this.pos.subarray(0, this.vc * 3))
			this.pos = p
		}
		if ((this.tc + tris) * 3 > this.idx.length) {
			const q = new Int32Array(Math.max(this.idx.length * 2, (this.tc + tris) * 3))
			q.set(this.idx.subarray(0, this.tc * 3))
			this.idx = q
		}
	}

	private vertex(x: number, y: number, z: number) {
		const o = this.vc * 3
		this.pos[o] = x
		this.pos[o + 1] = y
		this.pos[o + 2] = z
		if (y < this.minY) this.minY = y
		if (y > this.maxY) this.maxY = y
		return this.vc++
	}

	private addGround(g: NavGround, x0: number, z0: number, x1: number, z1: number) {
		const cs = g.cellSize
		const cx0 = Math.max(0, Math.floor(x0 / cs))
		const cz0 = Math.max(0, Math.floor(z0 / cs))
		const cx1 = Math.min(g.size - 1, Math.floor(x1 / cs))
		const cz1 = Math.min(g.size - 1, Math.floor(z1 / cs))
		if (cx1 < cx0 || cz1 < cz0) return
		const cells = cx1 - cx0 + 1
		const cellsZ = cz1 - cz0 + 1
		const vx = cells + 1
		this.reserve(vx * (cellsZ + 1), cells * cellsZ * 2)
		const base = this.vc
		for (let z = 0; z <= cellsZ; z++) {
			for (let x = 0; x < vx; x++) {
				const gx = cx0 + x
				const gz = cz0 + z
				this.vertex(gx * cs, g.heights[gz * g.verts + gx], gz * cs)
			}
		}
		if (this.cellIdx.length < cells * cellsZ * 6) this.cellIdx = new Uint32Array(cells * cellsZ * 6)
		const n = writeCellIndex(this.cellIdx, cells, cellsZ, vx, cx0, cz0, g.holes, g.size)
		for (let i = 0; i < n; i++) this.idx[this.tc * 3 + i] = base + this.cellIdx[i]
		this.tc += n / 3
	}

	private addModel(t: Float32Array, x0: number, z0: number, x1: number, z1: number, groundAt: (x: number, z: number) => number | null) {
		this.reserve(t.length / 3, t.length / 9)
		for (let i = 0; i < t.length; i += 9) {
			const ax = t[i], ay = t[i + 1], az = t[i + 2]
			const bx = t[i + 3], by = t[i + 4], bz = t[i + 5]
			const cx = t[i + 6], cy = t[i + 7], cz = t[i + 8]
			if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1 || Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z1) continue
			if (underGround(ax, ay, az, bx, by, bz, cx, cy, cz, groundAt) && underGround(bx, by, bz, cx, cy, cz, ax, ay, az, groundAt) && underGround(cx, cy, cz, ax, ay, az, bx, by, bz, groundAt)) continue
			const o = this.tc * 3
			this.idx[o] = this.vertex(ax, ay, az)
			this.idx[o + 1] = this.vertex(bx, by, bz)
			this.idx[o + 2] = this.vertex(cx, cy, cz)
			this.tc++
		}
	}
}

/**
 * Whether corner a, pulled a little toward the triangle's middle ((5a + b + c) / 7, VMaNGOS's
 * step), lies below the ground.
 */
function underGround(
	ax: number, ay: number, az: number,
	bx: number, by: number, bz: number,
	cx: number, cy: number, cz: number,
	groundAt: (x: number, z: number) => number | null,
): boolean {
	const x = (5 * ax + bx + cx) / 7
	const z = (5 * az + bz + cz) / 7
	const h = groundAt(x, z)
	return h !== null && (5 * ay + by + cy) / 7 < h
}
