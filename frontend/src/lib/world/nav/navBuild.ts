// The walkable-ground preview's navmesh tiles (View › Walkable ground, #175), built in the browser
// with recast-navigation-js (MIT, Recast and Detour in WASM) the way VMaNGOS's MoveMapGenerator
// builds the server's movement maps (contrib/mmap/src/TileWorker.cpp): 80-voxel tiles of 0.2667 yd,
// its agent, and its areas: ground up to the player's 52° and steep slope up to 75° on the terrain
// and 61° on models, which only creatures path over (NAV_STEEP_SLOPES); its own ledge filter, which
// steps only 1.2 yd where terrain meets a model against 1.8 on the terrain, so a fence can't be
// stepped over (navFilters.ts); and its liquids, rasterized into a heightfield of their own that
// turns the ground under deep water into swim area (NAV_WATER), under shallow water into the
// transition both walkers and swimmers take, and marks magma and slime.
//
// Left out next to the server's build: gameobjects and the liquids inside WMOs. The recast module is
// passed in, so the WASM loads only once the view is turned on (`loadRecast`), and node tests can
// hand in their own import.

import type * as RecastModule from 'recast-navigation'
import { filterLedgeSpans, heightfieldSpans, markLiquidSpans, removeModelAreas } from './navFilters'

export type Recast = typeof RecastModule

let recastLoad: Promise<Recast> | null = null

/** recast-navigation, imported and its WASM started on first use. */
export function loadRecast(): Promise<Recast> {
	recastLoad ??= import('recast-navigation').then(async (r) => {
		await r.init()
		return r
	})
	return recastLoad
}

/**
 * Area ids, VMaNGOS's NavMeshAreas: where two meet in one voxel the higher wins. The model areas
 * only live until the ledge filter has read them.
 */
export const AREA_GROUND = 1
export const AREA_GROUND_MODEL = 2
export const AREA_STEEP = 3
export const AREA_STEEP_MODEL = 4
export const AREA_WATER_TRANSITION = 5
export const AREA_WATER = 6
export const AREA_MAGMA = 7
export const AREA_SLIME = 8
/** Poly flags, VMaNGOS's NavTerrain: steep ground is ground a player can't take. */
export const NAV_GROUND = 0x01
export const NAV_MAGMA = 0x02
export const NAV_SLIME = 0x04
export const NAV_WATER = 0x08
export const NAV_STEEP = 0x10

/** A polygon's flags by its area, as TileWorker sets them. */
export function areaFlags(area: number): number {
	switch (area) {
		case 0:
			return 0
		case AREA_GROUND:
			return NAV_GROUND
		case AREA_STEEP:
			return NAV_GROUND | NAV_STEEP
		case AREA_WATER_TRANSITION:
			return NAV_GROUND | NAV_WATER
		case AREA_WATER:
			return NAV_WATER
		case AREA_MAGMA:
			return NAV_MAGMA
		case AREA_SLIME:
			return NAV_SLIME
		default:
			return NAV_GROUND
	}
}

/** The server's build settings, in voxels where Recast counts them. */
export interface NavSettings {
	/** Voxel size across and up (yd). */
	cs: number
	ch: number
	/** Voxels along a tile's side. */
	tileCells: number
	/** A tile's side (yd): 1/25 of a client tile, as the server's. */
	tileYards: number
	walkableHeight: number
	/** The climb on the terrain, and where terrain meets a model. */
	walkableClimb: number
	climbTransition: number
	walkableRadius: number
	/**
	 * Ground with a liquid's surface at least `inWater` voxels over it is swim area, under less the
	 * transition; a surface more than `liquidReach` voxels up doesn't count for it.
	 */
	inWater: number
	liquidReach: number
	borderSize: number
	maxEdgeLen: number
	maxSimplificationError: number
	minRegionArea: number
	mergeRegionArea: number
	maxVertsPerPoly: number
	detailSampleDist: number
	detailSampleMaxError: number
	/** cos of the steepest slope a player walks up, and creatures on the terrain and on models. */
	playerCos: number
	terrainCos: number
	modelCos: number
	/** The agent in yards, for the Detour tile. */
	agentHeight: number
	agentRadius: number
	agentClimb: number
}

const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180)

/**
 * TileWorker's settings: `continent` for maps 0 and 1 (Azeroth, Kalimdor), whose voxels are 0.25 yd
 * tall and agent 0.2 yd wide; 0.1 yd and 0.3 yd elsewhere.
 */
export function vmangosSettings(continent: boolean): NavSettings {
	const cs = 1600 / 3 / 2000
	const ch = continent ? 0.25 : 0.1
	const agentHeight = 1.5
	const agentRadius = continent ? 0.2 : 0.3
	const agentClimb = 1.8
	const walkableRadius = Math.ceil(agentRadius / cs)
	const walkableHeight = Math.ceil(agentHeight / ch)
	return {
		cs,
		ch,
		tileCells: 80,
		tileYards: 80 * cs,
		walkableHeight,
		walkableClimb: Math.floor(agentClimb / ch),
		climbTransition: Math.floor(1.2 / ch),
		walkableRadius,
		inWater: Math.floor(walkableHeight / 2),
		liquidReach: Math.ceil(30 / ch),
		borderSize: walkableRadius + 3,
		maxEdgeLen: 45,
		maxSimplificationError: 1.8,
		minRegionArea: 30 * 30,
		mergeRegionArea: 10 * 10,
		maxVertsPerPoly: 6,
		detailSampleDist: 2,
		detailSampleMaxError: 0.5,
		playerCos: cosDeg(52),
		terrainCos: cosDeg(75),
		modelCos: cosDeg(61),
		agentHeight,
		agentRadius,
		agentClimb,
	}
}

/**
 * The triangles of one tile's build: corners in `pos` (world, Y up), `idx` three a triangle, and the
 * triangles from `modelFrom` on are models' (the rest terrain). The liquids' surfaces come apart,
 * an area a triangle (`AREA_WATER`, `AREA_MAGMA` or `AREA_SLIME`); `minY` and `maxY` span both.
 */
export interface TileInput {
	pos: Float32Array
	vertCount: number
	idx: Int32Array
	triCount: number
	modelFrom: number
	minY: number
	maxY: number
	/**
	 * The heights the voxels span, the server's for the client tile (`adtHeightSpan`): the first
	 * voxel starts at `floorY`. Without them, a yard under `minY` and over `maxY`.
	 */
	floorY?: number
	ceilY?: number
	liquidPos?: Float32Array
	liquidVertCount?: number
	liquidIdx?: Int32Array
	liquidAreas?: Uint8Array
	liquidTriCount?: number
}

/**
 * Each triangle's area by its slope, as TileWorker marks them: ground up to the player's limit,
 * steep up to the terrain's or the model's, none past it (or facing down). A model's face takes the
 * model twin of its area, which the ledge filter tells apart.
 */
export function markAreas(input: TileInput, s: NavSettings, out: Uint8Array) {
	const { pos, idx } = input
	for (let t = 0; t < input.triCount; t++) {
		const a = idx[t * 3] * 3,
			b = idx[t * 3 + 1] * 3,
			c = idx[t * 3 + 2] * 3
		const ux = pos[b] - pos[a],
			uy = pos[b + 1] - pos[a + 1],
			uz = pos[b + 2] - pos[a + 2]
		const vx = pos[c] - pos[a],
			vy = pos[c + 1] - pos[a + 1],
			vz = pos[c + 2] - pos[a + 2]
		const nx = uy * vz - uz * vy
		const ny = uz * vx - ux * vz
		const nz = ux * vy - uy * vx
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
		const up = len > 0 ? ny / len : -1
		const model = t >= input.modelFrom
		const limit = model ? s.modelCos : s.terrainCos
		out[t] = up > s.playerCos ? (model ? AREA_GROUND_MODEL : AREA_GROUND) : up > limit ? (model ? AREA_STEEP_MODEL : AREA_STEEP) : 0
	}
}

/** A built tile: Detour's data for the navmesh, and its surface to draw (world triangles, an area each). */
export interface BuiltTile {
	data: RecastModule.UnsignedCharArray | null
	/** Nine floats a triangle of the detail mesh. */
	tris: Float32Array
	/** Each triangle's area, and its polygon's index in the tile (to shade polygons apart). */
	areas: Uint8Array
	polys: Uint16Array
}

/**
 * Builds navmesh tiles one at a time, reusing its WASM arrays. `destroy` frees them.
 */
export class TileBuilder {
	private ctx: RecastModule.RecastBuildContext
	private verts: RecastModule.FloatArray
	private tris: RecastModule.IntArray
	private areas: RecastModule.UnsignedCharArray
	private areaBuf = new Uint8Array(0)
	private order = new Uint32Array(0)
	private keys = new Float32Array(0)
	private sortedIdx = new Int32Array(0)
	private sortedAreas = new Uint8Array(0)
	private r: Recast
	readonly s: NavSettings

	constructor(r: Recast, s: NavSettings) {
		this.r = r
		this.s = s
		this.ctx = new r.RecastBuildContext()
		this.verts = new r.VerticesArray()
		this.tris = new r.TrianglesArray()
		this.areas = new r.TriangleAreasArray()
	}

	/** The tile at (tx, tz): its box is [tx, tx + 1) × [tz, tz + 1) tile sides from the world origin. */
	build(input: TileInput, tx: number, tz: number): BuiltTile | null {
		const r = this.r
		const s = this.s
		if (input.triCount === 0) return null
		if (this.areaBuf.length < input.triCount) this.areaBuf = new Uint8Array(input.triCount * 2)
		const areaBuf = this.areaBuf.subarray(0, input.triCount)
		markAreas(input, s, areaBuf)
		const lt = input.liquidTriCount ?? 0

		const border = s.borderSize * s.cs
		const floorY = Math.min(input.floorY ?? input.minY - 1, input.minY)
		const ceilY = Math.max(input.ceilY ?? input.maxY + 1, input.maxY)
		const bmin: [number, number, number] = [tx * s.tileYards - border, floorY, tz * s.tileYards - border]
		const bmax: [number, number, number] = [(tx + 1) * s.tileYards + border, ceilY, (tz + 1) * s.tileYards + border]
		const side = s.tileCells + s.borderSize * 2
		const ctx = this.ctx
		const hf = r.allocHeightfield()
		const lhf = lt > 0 ? r.allocHeightfield() : null
		let chf: RecastModule.RecastCompactHeightfield | null = null
		let cset: RecastModule.RecastContourSet | null = null
		let pmesh: RecastModule.RecastPolyMesh | null = null
		let dmesh: RecastModule.RecastPolyMeshDetail | null = null
		try {
			if (!r.createHeightfield(ctx, hf, side, side, bmin, bmax, s.cs, s.ch)) return null
			// The liquids first, into a heightfield of their own, which only marks the ground under them.
			if (lhf) {
				if (!r.createHeightfield(ctx, lhf, side, side, bmin, bmax, s.cs, s.ch)) return null
				this.verts.copy(input.liquidPos!.subarray(0, input.liquidVertCount! * 3))
				this.tris.copy(input.liquidIdx!.subarray(0, lt * 3))
				this.areas.copy(input.liquidAreas!.subarray(0, lt))
				if (!r.rasterizeTriangles(ctx, this.verts, input.liquidVertCount!, this.tris, this.areas, lt, lhf, 0)) return null
			}
			this.verts.copy(input.pos.subarray(0, input.vertCount * 3))
			this.sortByHeight(input, areaBuf)
			this.tris.copy(this.sortedIdx.subarray(0, input.triCount * 3))
			this.areas.copy(this.sortedAreas.subarray(0, input.triCount))
			// No merging of areas across heights: where a triangle's span overlaps one already there, the
			// higher top keeps its area, or the larger area where a lower triangle reaches into it.
			if (!r.rasterizeTriangles(ctx, this.verts, input.vertCount, this.tris, this.areas, input.triCount, hf, 0)) return null
			r.filterLowHangingWalkableObstacles(ctx, s.walkableClimb, hf)
			const spans = heightfieldSpans(r, hf)
			filterLedgeSpans(spans, s.walkableHeight, s.climbTransition, s.walkableClimb)
			removeModelAreas(spans)
			r.filterWalkableLowHeightSpans(ctx, s.walkableHeight, hf)
			if (lhf) markLiquidSpans(heightfieldSpans(r, lhf), heightfieldSpans(r, hf), s.inWater, s.liquidReach)
			chf = r.allocCompactHeightfield()
			if (!r.buildCompactHeightfield(ctx, s.walkableHeight, s.walkableClimb, hf, chf)) return null
			if (!r.erodeWalkableArea(ctx, s.walkableRadius, chf)) return null
			if (!r.medianFilterWalkableArea(ctx, chf)) return null
			if (!r.buildDistanceField(ctx, chf)) return null
			if (!r.buildRegions(ctx, chf, s.borderSize, s.minRegionArea, s.mergeRegionArea)) return null
			cset = r.allocContourSet()
			if (!r.buildContours(ctx, chf, s.maxSimplificationError, s.maxEdgeLen, cset, r.Recast.RC_CONTOUR_TESS_WALL_EDGES)) return null
			pmesh = r.allocPolyMesh()
			if (!r.buildPolyMesh(ctx, cset, s.maxVertsPerPoly, pmesh)) return null
			dmesh = r.allocPolyMeshDetail()
			if (!r.buildPolyMeshDetail(ctx, pmesh, chf, s.detailSampleDist, s.detailSampleMaxError, dmesh)) return null
			const np = pmesh.npolys()
			if (np === 0) return { data: null, tris: new Float32Array(0), areas: new Uint8Array(0), polys: new Uint16Array(0) }
			for (let i = 0; i < np; i++) pmesh.setFlags(i, areaFlags(pmesh.areas(i) & 0xf))
			const surface = detailSurface(pmesh, dmesh)
			const params = new r.NavMeshCreateParams()
			params.setPolyMeshCreateParams(pmesh)
			params.setPolyMeshDetailCreateParams(dmesh)
			params.setWalkableHeight(s.agentHeight)
			params.setWalkableRadius(s.agentRadius)
			params.setWalkableClimb(s.agentClimb)
			params.setCellSize(s.cs)
			params.setCellHeight(s.ch)
			params.setBuildBvTree(true)
			params.setTileX(tx)
			params.setTileY(tz)
			const made = r.createNavMeshData(params)
			r.Raw.destroy(params.raw)
			return { data: made.success ? made.navMeshData : null, ...surface }
		} finally {
			r.freeHeightfield(hf)
			if (lhf) r.freeHeightfield(lhf)
			if (chf) r.freeCompactHeightfield(chf)
			if (cset) r.freeContourSet(cset)
			if (pmesh) r.freePolyMesh(pmesh)
			if (dmesh) r.freePolyMeshDetail(dmesh)
		}
	}

	/**
	 * The triangles in the order the server rasterizes them (SortAndRasterizeTriangles, VMaNGOS #2197):
	 * by their first corner's height, highest first, ties in input order. A span's area depends on it,
	 * since a lower triangle reaching into a span takes the larger of the two areas.
	 */
	private sortByHeight(input: TileInput, areas: Uint8Array) {
		const n = input.triCount
		const { pos, idx } = input
		if (this.order.length < n) {
			this.order = new Uint32Array(n * 2)
			this.keys = new Float32Array(n * 2)
			this.sortedIdx = new Int32Array(n * 6)
			this.sortedAreas = new Uint8Array(n * 2)
		}
		const order = this.order.subarray(0, n)
		const keys = this.keys
		for (let t = 0; t < n; t++) {
			order[t] = t
			keys[t] = pos[idx[t * 3] * 3 + 1]
		}
		order.sort((a, b) => keys[b] - keys[a] || a - b)
		const out = this.sortedIdx
		for (let k = 0; k < n; k++) {
			const t = order[k]
			out[k * 3] = idx[t * 3]
			out[k * 3 + 1] = idx[t * 3 + 1]
			out[k * 3 + 2] = idx[t * 3 + 2]
			this.sortedAreas[k] = areas[t]
		}
	}

	destroy() {
		this.verts.destroy()
		this.tris.destroy()
		this.areas.destroy()
	}
}

/**
 * One tile's build as it crosses to and from a worker (#508): the inputs copied out of the gatherer's
 * reused buffers, and the result with Detour's data as plain bytes instead of a WASM array.
 */
export interface TileJob {
	continent: boolean
	tx: number
	tz: number
	input: TileInput
}

export interface TileOutput {
	/** Detour's tile data, null where the tile has no polygons. */
	data: Uint8Array | null
	tris: Float32Array
	areas: Uint8Array
	polys: Uint16Array
}

/** A job for the tile at (tx, tz) with copies of `input`'s used parts, which own their buffers. */
export function tileJob(input: TileInput, continent: boolean, tx: number, tz: number): TileJob {
	const copy: TileInput = {
		pos: input.pos.slice(0, input.vertCount * 3),
		vertCount: input.vertCount,
		idx: input.idx.slice(0, input.triCount * 3),
		triCount: input.triCount,
		modelFrom: input.modelFrom,
		minY: input.minY,
		maxY: input.maxY,
		floorY: input.floorY,
		ceilY: input.ceilY,
	}
	const lt = input.liquidTriCount ?? 0
	if (lt > 0) {
		copy.liquidPos = input.liquidPos!.slice(0, input.liquidVertCount! * 3)
		copy.liquidVertCount = input.liquidVertCount
		copy.liquidIdx = input.liquidIdx!.slice(0, lt * 3)
		copy.liquidAreas = input.liquidAreas!.slice(0, lt)
		copy.liquidTriCount = lt
	}
	return { continent, tx, tz, input: copy }
}

/** The buffers of a job or an output, to hand over with postMessage. */
export function tileBuffers(x: TileJob | TileOutput): ArrayBuffer[] {
	const list: ArrayBuffer[] = []
	const add = (a: ArrayBufferView | null | undefined) => {
		if (a && !list.includes(a.buffer as ArrayBuffer)) list.push(a.buffer as ArrayBuffer)
	}
	if ('input' in x) {
		const i = x.input
		for (const a of [i.pos, i.idx, i.liquidPos, i.liquidIdx, i.liquidAreas]) add(a)
	} else for (const a of [x.data, x.tris, x.areas, x.polys]) add(a)
	return list
}

/** A view that owns its whole buffer, so handing it over moves no more than it holds. */
function own<T extends Float32Array | Uint8Array | Uint16Array>(a: T): T {
	return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : (a.slice() as T)
}

/**
 * Builds a job's tile with `builders`' TileBuilder for its settings (made on first use), and returns
 * it with Detour's data copied out of the WASM heap and freed there. The worker's whole build.
 */
export function runTileJob(r: Recast, builders: Map<boolean, TileBuilder>, job: TileJob): TileOutput | null {
	let b = builders.get(job.continent)
	if (!b) {
		b = new TileBuilder(r, vmangosSettings(job.continent))
		builders.set(job.continent, b)
	}
	const built = b.build(job.input, job.tx, job.tz)
	if (!built) return null
	const data = built.data ? built.data.toTypedArray() : null
	built.data?.destroy()
	return { data, tris: own(built.tris), areas: own(built.areas), polys: own(built.polys) }
}

/** The detail mesh's triangles in world space, with their polygon's area and index. */
function detailSurface(pmesh: RecastModule.RecastPolyMesh, dmesh: RecastModule.RecastPolyMeshDetail) {
	const np = pmesh.npolys()
	const n = dmesh.ntris()
	const tris = new Float32Array(n * 9)
	const areas = new Uint8Array(n)
	const polys = new Uint16Array(n)
	let k = 0
	for (let p = 0; p < np; p++) {
		const vb = dmesh.meshes(p * 4)
		const tb = dmesh.meshes(p * 4 + 2)
		const nt = dmesh.meshes(p * 4 + 3)
		const area = pmesh.areas(p)
		for (let t = 0; t < nt; t++) {
			for (let c = 0; c < 3; c++) {
				const v = (vb + dmesh.tris((tb + t) * 4 + c)) * 3
				tris[k * 9 + c * 3] = dmesh.verts(v)
				tris[k * 9 + c * 3 + 1] = dmesh.verts(v + 1)
				tris[k * 9 + c * 3 + 2] = dmesh.verts(v + 2)
			}
			areas[k] = area
			polys[k] = p
			k++
		}
	}
	return { tris: tris.subarray(0, k * 9), areas: areas.subarray(0, k), polys: polys.subarray(0, k) }
}
