// What one navmesh tile is built from (View › Walkable ground, #175): the terrain's triangles under
// the tile's box, four a cell about its middle as the server's map has them (a region's middle at the
// client's inner height until the cell is sculpted, cellLift, #284, #380; a half-cell hole keeps its other triangle as the
// ground draws it, holes.ts), and the collision faces of the placed
// models that reach into it, cut as VMaNGOS's builder cuts them (TerrainBuilder::loadVMap,
// TileWorker::buildMoveMapTile; #282):
// - Ground under a model goes: a ground corner whose nearest face above, in one of a model's groups,
//   is an upward one (a floor's top) within 5 yd lies under the model. A triangle with all three
//   corners a yard or more under (and one 1.5 yd or more) is dropped; one with some corners under is
//   cut back to where the ground meets the model. So the crawlspace under Northshire Abbey's floor,
//   1.5 to 2 yd over the ground, is no walkable ground, as on the server.
// - A model face lies "under the map", and is left out, when all three of its corners (pulled a
//   little toward its middle) are 0.2 yd or more below the ground and, looking up, the nearest model
//   face is an upward one: inside a solid, such as a hull's bottom sunk into the ground. A cellar's
//   floor, with its ceiling (a downward face) over it, stays.
// The liquids over the cells (navLiquids.ts) come as triangles of their own, an area each; a cell in
// a deep chunk brings neither ground nor liquid. So do the liquids inside the WMOs (#281), as the
// builder takes them from the vmaps (TerrainBuilder::loadVMap): every wet tile of a kept group's
// MLIQ, with no test against the ground, its area by the type's low two bits (liquidTypeArea).

import { HOLE_CELL, HOLE_FIRST, HOLE_NONE } from '../../terrain/holes'
import { AREA_MAGMA, AREA_SLIME, AREA_WATER, type TileInput } from './navBuild'
import type { NavLiquids } from './navLiquids'

/** The ground's fields a tile reads: a Terrain has them. */
export interface NavGround {
	size: number
	verts: number
	cellSize: number
	heights: Float32Array
	holes: Uint8Array
	/**
	 * How far each cell's middle lies above its corners' mean in the client's tile (a region's inner
	 * heights, Terrain.innerLift, #284), `size` a row; null where every middle is the mean.
	 */
	innerLift?: Float32Array | null
	/** The client's corner heights those lifts are over, `heights`' layout (Terrain.innerBase, #380). */
	innerBase?: Float32Array | null
}

/** How far a corner must move off the client's height for its cells to count as sculpted, in yards (vmangos.SculptedEps). */
const SCULPTED_EPS = 1e-3

/**
 * How far cell (gx, gz)'s middle lies above its corners' mean in the exported tile: the client's lift
 * while all four corners keep the client's heights, 0 once one has moved, since the export puts a
 * sculpted cell's middle at its corners' mean (PatchTileHeights, #380).
 */
export function cellLift(g: NavGround, gx: number, gz: number): number {
	const lift = g.innerLift
	if (!lift) return 0
	const base = g.innerBase
	if (base) {
		const h = g.heights
		const i = gz * g.verts + gx
		const j = i + g.verts
		if (Math.abs(h[i] - base[i]) > SCULPTED_EPS || Math.abs(h[i + 1] - base[i + 1]) > SCULPTED_EPS || Math.abs(h[j] - base[j]) > SCULPTED_EPS || Math.abs(h[j + 1] - base[j + 1]) > SCULPTED_EPS) return 0
	}
	return lift[gz * g.size + gx]
}

/**
 * A WMO's liquids in its own frame, as /wow/collision sends them (#281): every vertex of its groups'
 * MLIQ grids, three indices a wet tile's triangle, and each triangle's liquid type, a LiquidType.dbc
 * ID as the vmap extractor writes it.
 */
export interface ModelLiquid {
	verts: Float32Array
	idx: Uint32Array
	types: Uint32Array
}

/** A placed WMO's liquids: its grids' vertices in world space, three indices a triangle, an area each. */
export interface PlacedLiquid {
	verts: Float32Array
	idx: Uint32Array
	areas: Uint8Array
}

/**
 * A placed model's collision faces in world space, nine floats a triangle, their box, the placement's
 * x and z, and how many triangles each of its groups holds in turn (the server's GroupModels: an M2's
 * hull is one, a WMO's groups and doodads one each). A WMO's liquids come too; the box holds their
 * vertices, dry ones as well, as the server's height span does.
 */
export interface PlacedCollision {
	tris: Float32Array
	min: [number, number, number]
	max: [number, number, number]
	origin: [number, number]
	groups: Uint32Array
	liquid?: PlacedLiquid | null
}

/**
 * The navmesh area of a WMO liquid of vmap type `t`, as the mmap builder picks it: by the type's low
 * two bits, water for 0 and 1, magma for 2 and slime for 3. The extractor writes LiquidType.dbc IDs
 * (water 1, ocean 2, magma 3, slime 4), so the server's mmaps hold a WMO's ocean as magma, its magma
 * as slime and its slime as water (Ironforge's forge lava is slime in its tile), and so does this.
 */
export function liquidTypeArea(t: number): number {
	switch (t & 3) {
		case 2:
			return AREA_MAGMA
		case 3:
			return AREA_SLIME
		default:
			return AREA_WATER
	}
}

/** Moves the points of `local` by the column-major matrix `m` into `out`, growing the box [min, max]. */
function movePoints(local: Float32Array, m: ArrayLike<number>, out: Float32Array, min: number[], max: number[]) {
	for (let i = 0; i < local.length; i += 3) {
		const x = local[i],
			y = local[i + 1],
			z = local[i + 2]
		const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
		const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
		const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
		out[i] = wx
		out[i + 1] = wy
		out[i + 2] = wz
		if (wx < min[0]) min[0] = wx
		if (wy < min[1]) min[1] = wy
		if (wz < min[2]) min[2] = wz
		if (wx > max[0]) max[0] = wx
		if (wy > max[1]) max[1] = wy
		if (wz > max[2]) max[2] = wz
	}
}

/**
 * The faces of `local` (nine floats a triangle, the model's frame) moved by the column-major matrix
 * `m`, in `groups` (one group of them all when not given), with the model's `liquid` when it has one.
 */
export function placeFaces(local: Float32Array, m: ArrayLike<number>, groups?: Uint32Array, liquid?: ModelLiquid | null): PlacedCollision {
	const tris = new Float32Array(local.length)
	const min: [number, number, number] = [Infinity, Infinity, Infinity]
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
	movePoints(local, m, tris, min, max)
	let placedLiquid: PlacedLiquid | null = null
	if (liquid && liquid.types.length > 0) {
		const verts = new Float32Array(liquid.verts.length)
		movePoints(liquid.verts, m, verts, min, max)
		const areas = new Uint8Array(liquid.types.length)
		for (let t = 0; t < areas.length; t++) areas[t] = liquidTypeArea(liquid.types[t])
		placedLiquid = { verts, idx: liquid.idx, areas }
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
	return { tris, min, max, origin: [m[12], m[14]], groups: groups ?? Uint32Array.of(local.length / 9), liquid: placedLiquid }
}

/**
 * The heights client tile (ax, az) of the map is voxelized between, as the server's builder takes
 * them (MapBuilder::getTileBounds): the lowest and highest of every vertex it loads for the tile, the
 * ground's (its own cells and a cell's row of each neighbour's, holes and deep chunks left out) and
 * every vertex of the models the tile places, however far they reach. Which models those are follows
 * the export: the tile an origin falls in, clamped to the block; a model whose faces reach over
 * another tile counts there too, as a WMO is placed in every tile it spans. The span sets where the
 * voxels' height steps fall, which decides whether a gap a hair over the agent's height (a floor
 * 1.55 yd over the ground under Northshire Abbey, #282) is walkable, so the browser's tiles take the
 * server's. `deep` tells a cell of a deep chunk; `out` is [min, max], Infinity and -Infinity when
 * nothing is there.
 */
export function adtHeightSpan(ground: NavGround, models: readonly PlacedCollision[], ax: number, az: number, adtYards: number, deep: ((gx: number, gz: number) => boolean) | null, out: [number, number]): [number, number] {
	let lo = Infinity
	let hi = -Infinity
	const per = Math.round(adtYards / ground.cellSize)
	const side = Math.max(1, Math.round(ground.size / per))
	const x0 = Math.max(0, ax * per - 1),
		x1 = Math.min(ground.size - 1, (ax + 1) * per)
	const z0 = Math.max(0, az * per - 1),
		z1 = Math.min(ground.size - 1, (az + 1) * per)
	const h = ground.heights
	const v = ground.verts
	const lifted = !!ground.innerLift
	for (let gz = z0; gz <= z1; gz++) {
		for (let gx = x0; gx <= x1; gx++) {
			if (ground.holes[gz * ground.size + gx] === HOLE_CELL || deep?.(gx, gz)) continue
			const i = gz * v + gx
			const a = h[i],
				b = h[i + 1],
				c = h[i + v],
				d = h[i + v + 1]
			// The cell's middle counts too, as the inner sample does on the server.
			const m = lifted ? (a + b + c + d) / 4 + cellLift(ground, gx, gz) : a
			lo = Math.min(lo, a, b, c, d, m)
			hi = Math.max(hi, a, b, c, d, m)
		}
	}
	const bx0 = ax * adtYards,
		bx1 = bx0 + adtYards
	const bz0 = az * adtYards,
		bz1 = bz0 + adtYards
	const tile = (p: number) => Math.max(0, Math.min(side - 1, Math.floor(p / adtYards)))
	for (const m of models) {
		const own = tile(m.origin[0]) === ax && tile(m.origin[1]) === az
		if (!own && (m.max[0] < bx0 || m.min[0] > bx1 || m.max[2] < bz0 || m.min[2] > bz1)) continue
		lo = Math.min(lo, m.min[1])
		hi = Math.max(hi, m.max[1])
	}
	out[0] = lo
	out[1] = hi
	return out
}

/** Gathers tiles' triangles into buffers it keeps and grows. */
export class TileGatherer {
	private pos = new Float32Array(3 * 1024)
	private idx = new Int32Array(3 * 1024)
	private vc = 0
	private tc = 0
	private minY = Infinity
	private maxY = -Infinity
	private lpos = new Float32Array(3 * 256)
	private lidx = new Int32Array(3 * 256)
	private lareas = new Uint8Array(256)
	private lvc = 0
	private ltc = 0
	private corner = new Float32Array(4)
	/** The model faces over the tile's box (nine floats each) and each one's group, groups kept together. */
	private near = new Float32Array(9 * 256)
	private nearGroup = new Int32Array(256)
	private nc = 0
	/** Each ground corner's distance up to a model it lies under (underModels), -1 where it lies under none. */
	private inside = new Float32Array(256)
	private hit = new Float32Array(3)
	private vi = [0, 0, 0]
	private ins = [false, false, false]

	/**
	 * The triangles over the box [x0, x1] × [z0, z1]: the ground's, then the models'. `groundAt` is
	 * the ground's height at a point, or null where there is none (a hole, off the map). `liquids`,
	 * when given, adds the liquid surfaces and leaves out the deep chunks.
	 */
	gather(ground: NavGround, models: readonly PlacedCollision[], x0: number, z0: number, x1: number, z1: number, groundAt: (x: number, z: number) => number | null, liquids?: NavLiquids): TileInput {
		this.vc = this.tc = this.lvc = this.ltc = this.nc = 0
		this.minY = Infinity
		this.maxY = -Infinity
		this.addGround(ground, x0, z0, x1, z1, liquids)
		const groundVerts = this.vc
		// The faces over the whole cells the ground came from, so a cut comes out the same in each tile.
		const cs = ground.cellSize
		this.gatherNear(models, x0 - cs, z0 - cs, x1 + cs, z1 + cs)
		if (this.nc > 0) this.cutUnderModels(groundVerts)
		const modelFrom = this.tc
		for (const m of models) {
			if (m.max[0] < x0 || m.min[0] > x1 || m.max[2] < z0 || m.min[2] > z1) continue
			this.addModel(m.tris, x0, z0, x1, z1, groundAt)
			if (m.liquid) this.addModelLiquid(m.liquid, x0, z0, x1, z1)
		}
		return {
			pos: this.pos,
			vertCount: this.vc,
			idx: this.idx,
			triCount: this.tc,
			modelFrom,
			minY: this.minY,
			maxY: this.maxY,
			liquidPos: this.lpos,
			liquidVertCount: this.lvc,
			liquidIdx: this.lidx,
			liquidAreas: this.lareas,
			liquidTriCount: this.ltc,
		}
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

	private addGround(g: NavGround, x0: number, z0: number, x1: number, z1: number, liquids?: NavLiquids) {
		const cs = g.cellSize
		const cx0 = Math.max(0, Math.floor(x0 / cs))
		const cz0 = Math.max(0, Math.floor(z0 / cs))
		const cx1 = Math.min(g.size - 1, Math.floor(x1 / cs))
		const cz1 = Math.min(g.size - 1, Math.floor(z1 / cs))
		if (cx1 < cx0 || cz1 < cz0) return
		const cells = cx1 - cx0 + 1
		const cellsZ = cz1 - cz0 + 1
		const vx = cells + 1
		this.reserve(vx * (cellsZ + 1) + cells * cellsZ, cells * cellsZ * 4)
		const base = this.vc
		for (let z = 0; z <= cellsZ; z++) {
			for (let x = 0; x < vx; x++) {
				const gx = cx0 + x
				const gz = cz0 + z
				this.vertex(gx * cs, g.heights[gz * g.verts + gx], gz * cs)
			}
		}
		const tri = (a: number, b: number, c: number) => {
			const o = this.tc * 3
			this.idx[o] = a
			this.idx[o + 1] = b
			this.idx[o + 2] = c
			this.tc++
		}
		for (let z = 0; z < cellsZ; z++) {
			for (let x = 0; x < cells; x++) {
				const gx = cx0 + x
				const gz = cz0 + z
				const v = g.holes[gz * g.size + gx]
				if (v === HOLE_CELL || liquids?.deep(gx, gz)) continue
				const a = base + z * vx + x
				const b = a + 1
				const c = a + vx
				const d = c + 1
				if (v === HOLE_NONE) {
					// Four triangles about the cell's middle, as the server's map has the client's inner
					// height there: the corners' mean, lifted as far as the client's tile has it over
					// its own corners' mean while the cell is unsculpted, which is what the export
					// writes (PatchTileHeights, #284, #380).
					const p = this.pos
					const lift = cellLift(g, gx, gz)
					const m = this.vertex((gx + 0.5) * cs, (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1] + p[d * 3 + 1]) / 4 + lift, (gz + 0.5) * cs)
					tri(a, c, m)
					tri(c, d, m)
					tri(d, b, m)
					tri(b, a, m)
					continue
				}
				// A half-cell hole keeps its other triangle as the ground draws it (writeCellIndex).
				const first = v !== HOLE_FIRST
				if ((gx + gz) & 1) {
					if (first) tri(a, c, b)
					else tri(b, c, d)
				} else if (first) tri(a, c, d)
				else tri(a, d, b)
			}
		}
		if (liquids) for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) this.addLiquid(g, x, z, liquids)
	}

	/**
	 * Cell (gx, gz)'s liquid as two triangles, each left out when the cell's ground lies wholly above
	 * it (TerrainBuilder: "liquid under the terrain").
	 */
	private addLiquid(g: NavGround, gx: number, gz: number, liquids: NavLiquids) {
		const h = this.corner
		const area = liquids.cell(gx, gz, h)
		if (!area) return
		const i = gz * g.verts + gx
		const ground = Math.min(g.heights[i], g.heights[i + 1], g.heights[i + g.verts], g.heights[i + g.verts + 1])
		const first = Math.max(h[0], h[2], h[1]) >= ground
		const second = Math.max(h[1], h[2], h[3]) >= ground
		if (!first && !second) return
		this.reserveLiquid(4, 2)
		const cs = g.cellSize
		const v = this.lvc
		for (let k = 0; k < 4; k++) {
			const o = (v + k) * 3
			this.lpos[o] = (gx + (k & 1)) * cs
			this.lpos[o + 1] = h[k]
			this.lpos[o + 2] = (gz + (k >> 1)) * cs
			if (h[k] < this.minY) this.minY = h[k]
			if (h[k] > this.maxY) this.maxY = h[k]
		}
		this.lvc += 4
		const tri = (a: number, b: number, c: number) => {
			const o = this.ltc * 3
			this.lidx[o] = v + a
			this.lidx[o + 1] = v + b
			this.lidx[o + 2] = v + c
			this.lareas[this.ltc++] = area
		}
		if (first) tri(0, 2, 1)
		if (second) tri(1, 2, 3)
	}

	private reserveLiquid(verts: number, tris: number) {
		if ((this.lvc + verts) * 3 > this.lpos.length) {
			const p = new Float32Array(Math.max(this.lpos.length * 2, (this.lvc + verts) * 3))
			p.set(this.lpos.subarray(0, this.lvc * 3))
			this.lpos = p
		}
		if (this.ltc + tris > this.lareas.length) {
			const n = Math.max(this.lareas.length * 2, this.ltc + tris)
			const q = new Int32Array(n * 3)
			q.set(this.lidx.subarray(0, this.ltc * 3))
			this.lidx = q
			const r = new Uint8Array(n)
			r.set(this.lareas.subarray(0, this.ltc))
			this.lareas = r
		}
	}

	/** A WMO's liquid triangles over the box, three corners of their own each, after the map's liquids. */
	private addModelLiquid(l: PlacedLiquid, x0: number, z0: number, x1: number, z1: number) {
		const p = l.verts
		const n = l.areas.length
		for (let t = 0; t < n; t++) {
			const a = l.idx[t * 3] * 3,
				b = l.idx[t * 3 + 1] * 3,
				c = l.idx[t * 3 + 2] * 3
			if (Math.max(p[a], p[b], p[c]) < x0 || Math.min(p[a], p[b], p[c]) > x1) continue
			if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < z0 || Math.min(p[a + 2], p[b + 2], p[c + 2]) > z1) continue
			this.reserveLiquid(3, 1)
			const v = this.lvc
			for (let k = 0; k < 3; k++) {
				const s = l.idx[t * 3 + k] * 3
				const o = (v + k) * 3
				const y = p[s + 1]
				this.lpos[o] = p[s]
				this.lpos[o + 1] = y
				this.lpos[o + 2] = p[s + 2]
				this.lidx[this.ltc * 3 + k] = v + k
				if (y < this.minY) this.minY = y
				if (y > this.maxY) this.maxY = y
			}
			this.lvc += 3
			this.lareas[this.ltc++] = l.areas[t]
		}
	}

	private addModel(t: Float32Array, x0: number, z0: number, x1: number, z1: number, groundAt: (x: number, z: number) => number | null) {
		this.reserve(t.length / 3, t.length / 9)
		for (let i = 0; i < t.length; i += 9) {
			const ax = t[i],
				ay = t[i + 1],
				az = t[i + 2]
			const bx = t[i + 3],
				by = t[i + 4],
				bz = t[i + 5]
			const cx = t[i + 6],
				cy = t[i + 7],
				cz = t[i + 8]
			if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1 || Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z1) continue
			if (this.underMap(ax, ay, az, bx, by, bz, cx, cy, cz, groundAt) && this.underMap(bx, by, bz, cx, cy, cz, ax, ay, az, groundAt) && this.underMap(cx, cy, cz, ax, ay, az, bx, by, bz, groundAt)) continue
			const o = this.tc * 3
			this.idx[o] = this.vertex(ax, ay, az)
			this.idx[o + 1] = this.vertex(bx, by, bz)
			this.idx[o + 2] = this.vertex(cx, cy, cz)
			this.tc++
		}
	}

	/**
	 * Whether corner a of a model face, pulled a little toward the triangle's middle ((5a + b + c) / 7),
	 * lies under the map (TerrainBuilder::IsUnderMap): 0.2 yd or more below the ground, and under a
	 * model, the nearest model face straight above it an upward one.
	 */
	private underMap(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, groundAt: (x: number, z: number) => number | null): boolean {
		const x = (5 * ax + bx + cx) / 7
		const y = (5 * ay + by + cy) / 7 + UNDER_LIFT
		const z = (5 * az + bz + cz) / 7
		const h = groundAt(x, z)
		if (h === null || y > h) return false
		let minIn = -1
		let minOut = -1
		const n = this.near
		for (let k = 0; k < this.nc; k++) {
			const t = rayUp(n, k * 9, x, y, z)
			if (t < 0) continue
			if (faceUp(n, k * 9)) {
				if (minIn < 0 || t < minIn) minIn = t
			} else if (minOut < 0 || t < minOut) minOut = t
		}
		return minIn >= 0 && (minOut < 0 || minIn < minOut)
	}

	/** The faces of the models that reach over the box, each one's group numbered across the models. */
	private gatherNear(models: readonly PlacedCollision[], x0: number, z0: number, x1: number, z1: number) {
		let group = 0
		for (const m of models) {
			if (m.max[0] < x0 || m.min[0] > x1 || m.max[2] < z0 || m.min[2] > z1) {
				group += m.groups.length
				continue
			}
			const t = m.tris
			let end = 0
			for (let g = 0; g < m.groups.length; g++, group++) {
				const start = end
				end = Math.min(t.length / 9, start + m.groups[g])
				for (let k = start; k < end; k++) {
					const i = k * 9
					if (Math.max(t[i], t[i + 3], t[i + 6]) < x0 || Math.min(t[i], t[i + 3], t[i + 6]) > x1) continue
					if (Math.max(t[i + 2], t[i + 5], t[i + 8]) < z0 || Math.min(t[i + 2], t[i + 5], t[i + 8]) > z1) continue
					if (this.nc >= this.nearGroup.length) {
						const f = new Float32Array(this.near.length * 2)
						f.set(this.near)
						this.near = f
						const q = new Int32Array(this.nearGroup.length * 2)
						q.set(this.nearGroup)
						this.nearGroup = q
					}
					this.near.set(t.subarray(i, i + 9), this.nc * 9)
					this.nearGroup[this.nc++] = group
				}
			}
		}
	}

	/**
	 * Takes the ground out from under the models, as the server's builder does ("remove from terrain
	 * all triangles inside any model"): of the ground triangles gathered so far, whose corners are the
	 * first `groundVerts` vertices, one with some corners under a model is cut back to where it meets
	 * the model, and one wholly under goes.
	 */
	private cutUnderModels(groundVerts: number) {
		if (this.inside.length < groundVerts) this.inside = new Float32Array(groundVerts * 2)
		const inside = this.inside
		for (let v = 0; v < groundVerts; v++) inside[v] = this.underModels(this.pos[v * 3], this.pos[v * 3 + 1] + UNDER_LIFT, this.pos[v * 3 + 2])
		// Vertices added by the cuts lie under nothing.
		const dist = (v: number) => (v < groundVerts ? inside[v] : -1)
		const groundTris = this.tc
		const vi = this.vi
		const ins = this.ins
		for (let t = 0; t < groundTris; t++) {
			for (let j = 0; j < 3; j++) {
				vi[j] = this.idx[t * 3 + j]
				ins[j] = dist(vi[j]) >= 0.1
			}
			if (dist(vi[0]) < 1 && dist(vi[1]) < 1 && dist(vi[2]) < 1) continue
			if (ins[0] === ins[1] && ins[1] === ins[2]) continue
			const o = !ins[0] ? 0 : !ins[1] ? 1 : 2
			const o1 = (o + 1) % 3
			const o2 = (o + 2) % 3
			if (ins[o1] && ins[o2]) {
				// Two corners under: the triangle ends where its edges from the third meet the model, or
				// four fifths of the way along them.
				const a = this.segmentHit(vi[o], vi[o1], 0) ? this.addHit() : this.lerpVertex(vi[o1], vi[o], 0.2)
				const b = this.segmentHit(vi[o], vi[o2], 0) ? this.addHit() : this.lerpVertex(vi[o2], vi[o], 0.2)
				vi[o1] = a
				vi[o2] = b
			} else {
				// One corner under: it moves to where the edge from the first other corner meets the
				// model, and the strip from there to the second other corner's cut is added both ways up.
				const under = ins[o1] ? o1 : o2
				const other = under === o1 ? o2 : o1
				const fa0 = this.segmentHit(vi[o], vi[under], -0.01) ? this.addHit() : -1
				const fb0 = this.segmentHit(vi[other], vi[under], -0.01) ? this.addHit() : -1
				let fa: number, fb: number
				if (fa0 < 0 && fb0 < 0) {
					fa = this.lerpVertex(vi[o], vi[under], 0.75)
					fb = this.lerpVertex(vi[other], vi[under], 0.75)
				} else {
					// A single miss gives a new vertex on the corner itself, which counts as under nothing.
					fa = fa0 >= 0 ? fa0 : this.lerpVertex(vi[under], vi[under], 0)
					fb = fb0 >= 0 ? fb0 : this.lerpVertex(vi[under], vi[under], 0)
				}
				this.reserve(0, 2)
				const k = this.tc * 3
				this.idx[k] = vi[other]
				this.idx[k + 1] = fa
				this.idx[k + 2] = fb
				this.idx[k + 3] = fb
				this.idx[k + 4] = fa
				this.idx[k + 5] = vi[other]
				this.tc += 2
				vi[under] = fa
			}
			for (let j = 0; j < 3; j++) this.idx[t * 3 + j] = vi[j]
		}
		// A triangle wholly under a model (a yard or more, and somewhere 1.5 yd or more) goes.
		let w = 0
		for (let t = 0; t < this.tc; t++) {
			const a = this.idx[t * 3],
				b = this.idx[t * 3 + 1],
				c = this.idx[t * 3 + 2]
			if (t < groundTris) {
				const da = dist(a),
					db = dist(b),
					dc = dist(c)
				if (da >= 1 && db >= 1 && dc >= 1 && (da >= 1.5 || db >= 1.5 || dc >= 1.5)) continue
			}
			this.idx[w * 3] = a
			this.idx[w * 3 + 1] = b
			this.idx[w * 3 + 2] = c
			w++
		}
		this.tc = w
	}

	/**
	 * How far up from (x, y, z) a model lies that it is under, or -1: for each group of the faces near,
	 * the nearest face straight above must be an upward one (the point is under the group's floor, or
	 * inside it), within UNDER_REACH (GroupModel::IsUnderObject). The nearest such group counts.
	 */
	private underModels(x: number, y: number, z: number): number {
		let best = -1
		let group = -1
		let minIn = -1
		let minOut = -1
		const n = this.near
		for (let k = 0; k <= this.nc; k++) {
			if (k === this.nc || this.nearGroup[k] !== group) {
				if (minIn >= 0 && (minOut < 0 || minIn < minOut) && minIn < UNDER_REACH && (best < 0 || minIn < best)) best = minIn
				if (k === this.nc) break
				group = this.nearGroup[k]
				minIn = minOut = -1
			}
			const t = rayUp(n, k * 9, x, y, z)
			if (t < 0) continue
			if (faceUp(n, k * 9)) {
				if (minIn < 0 || t < minIn) minIn = t
			} else if (minOut < 0 || t < minOut) minOut = t
		}
		return best
	}

	/**
	 * Where the ground edge from vertex a toward vertex b first meets a model face, moved `modify` yd
	 * along it (back toward a when negative, and a itself when the hit is nearer than that), into
	 * `hit` (StaticMapTree::getObjectHitPos). False when nothing is in the way.
	 */
	private segmentHit(a: number, b: number, modify: number): boolean {
		const p = this.pos
		const ax = p[a * 3],
			ay = p[a * 3 + 1],
			az = p[a * 3 + 2]
		const dx = p[b * 3] - ax,
			dy = p[b * 3 + 1] - ay,
			dz = p[b * 3 + 2] - az
		const len = Math.hypot(dx, dy, dz)
		if (len < 1e-10) return false
		const ux = dx / len,
			uy = dy / len,
			uz = dz / len
		let best = len
		let found = false
		for (let k = 0; k < this.nc; k++) {
			const t = rayTriangle(this.near, k * 9, ax, ay, az, ux, uy, uz)
			if (t > 0 && t < best) {
				best = t
				found = true
			}
		}
		if (!found) return false
		const d = modify < 0 && best <= -modify ? 0 : best + modify
		this.hit[0] = ax + ux * d
		this.hit[1] = ay + uy * d
		this.hit[2] = az + uz * d
		return true
	}

	/** A new vertex at the last `segmentHit`. */
	private addHit(): number {
		this.reserve(1, 0)
		return this.vertex(this.hit[0], this.hit[1], this.hit[2])
	}

	/** A new vertex `share` of the way from vertex a to vertex b. */
	private lerpVertex(a: number, b: number, share: number): number {
		this.reserve(1, 0)
		const p = this.pos
		return this.vertex(p[a * 3] + (p[b * 3] - p[a * 3]) * share, p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * share, p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * share)
	}
}

/** How far over a ground corner a model's floor may lie for the ground to count as under it (yd). */
const UNDER_REACH = 5
/** How far a point is lifted before it looks up for a model: a ground corner, a model face's corner (yd). */
const UNDER_LIFT = 0.2

/**
 * How far straight up from (x, y, z) the triangle at `o` in `t` lies, or -1 when the ray misses it.
 * An edge-on face is missed, as IntersectTriangle's determinant check misses it.
 */
function rayUp(t: Float32Array, o: number, x: number, y: number, z: number): number {
	const ax = t[o],
		az = t[o + 2],
		bx = t[o + 3],
		bz = t[o + 5],
		cx = t[o + 6],
		cz = t[o + 8]
	const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
	if (Math.abs(d) < 1e-5) return -1
	const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
	if (l1 < 0 || l1 > 1) return -1
	const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
	if (l2 < 0 || l1 + l2 > 1) return -1
	const h = l1 * t[o + 1] + l2 * t[o + 4] + (1 - l1 - l2) * t[o + 7] - y
	return h > 0 ? h : -1
}

/** Whether the triangle at `o` in `t` faces up by its winding (faces are wound outward). */
function faceUp(t: Float32Array, o: number): boolean {
	const ux = t[o + 3] - t[o],
		uz = t[o + 5] - t[o + 2]
	const vx = t[o + 6] - t[o],
		vz = t[o + 8] - t[o + 2]
	return uz * vx - ux * vz >= 0
}

/** How far along the unit ray from (ox, oy, oz) the triangle at `o` in `t` lies, either side, or -1 (Möller-Trumbore). */
function rayTriangle(t: Float32Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
	const e1x = t[o + 3] - t[o],
		e1y = t[o + 4] - t[o + 1],
		e1z = t[o + 5] - t[o + 2]
	const e2x = t[o + 6] - t[o],
		e2y = t[o + 7] - t[o + 1],
		e2z = t[o + 8] - t[o + 2]
	const px = dy * e2z - dz * e2y,
		py = dz * e2x - dx * e2z,
		pz = dx * e2y - dy * e2x
	const a = e1x * px + e1y * py + e1z * pz
	if (Math.abs(a) < 1e-5) return -1
	const f = 1 / a
	const sx = ox - t[o],
		sy = oy - t[o + 1],
		sz = oz - t[o + 2]
	const u = f * (sx * px + sy * py + sz * pz)
	if (u < 0 || u > 1) return -1
	const qx = sy * e1z - sz * e1y,
		qy = sz * e1x - sx * e1z,
		qz = sx * e1y - sy * e1x
	const v = f * (dx * qx + dy * qy + dz * qz)
	if (v < 0 || u + v > 1) return -1
	const d = f * (e2x * qx + e2y * qy + e2z * qz)
	return d > 0 ? d : -1
}
