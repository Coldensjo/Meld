// The walkable-ground preview's navmesh tiles (View › Walkable ground, #175), built in the browser
// with recast-navigation-js (MIT, Recast and Detour in WASM) the way VMaNGOS's MoveMapGenerator
// builds the server's movement maps (contrib/mmap/src/TileWorker.cpp, its settings only): 80-voxel
// tiles of 0.2667 yd, its agent, and its areas, ground up to the player's 52° and steep slope up to
// 75° on the terrain and 61° on models, which only creatures path over (NAV_STEEP_SLOPES).
//
// Left out next to the server's build: liquids (its swim areas), its own ledge filter for
// terrain-to-model steps (1.2 yd against the terrain's 1.8, so a fence can't be stepped over; Recast's
// filter uses 1.8 for both here) and gameobjects. The recast module is passed in, so the WASM loads
// only once the view is turned on (`loadRecast`), and node tests can hand in their own import.

import type * as RecastModule from 'recast-navigation'

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

/** Area ids, VMaNGOS's NavMeshAreas: where two meet in one voxel the higher wins. */
export const AREA_GROUND = 1
export const AREA_STEEP = 3
/** Poly flags, VMaNGOS's NavTerrain: steep ground is ground a player can't take. */
export const NAV_GROUND = 0x01
export const NAV_STEEP = 0x10

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
	walkableClimb: number
	walkableRadius: number
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
	return {
		cs,
		ch,
		tileCells: 80,
		tileYards: 80 * cs,
		walkableHeight: Math.ceil(agentHeight / ch),
		walkableClimb: Math.floor(agentClimb / ch),
		walkableRadius,
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
 * triangles from `modelFrom` on are models' (the rest terrain).
 */
export interface TileInput {
	pos: Float32Array
	vertCount: number
	idx: Int32Array
	triCount: number
	modelFrom: number
	minY: number
	maxY: number
}

/**
 * Each triangle's area by its slope, as TileWorker marks them: ground up to the player's limit,
 * steep up to the terrain's or the model's, none past it (or facing down).
 */
export function markAreas(input: TileInput, s: NavSettings, out: Uint8Array) {
	const { pos, idx } = input
	for (let t = 0; t < input.triCount; t++) {
		const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
		const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
		const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
		const nx = uy * vz - uz * vy
		const ny = uz * vx - ux * vz
		const nz = ux * vy - uy * vx
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
		const up = len > 0 ? ny / len : -1
		const limit = t < input.modelFrom ? s.terrainCos : s.modelCos
		out[t] = up > s.playerCos ? AREA_GROUND : up > limit ? AREA_STEEP : 0
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
		this.verts.copy(input.pos.subarray(0, input.vertCount * 3))
		this.tris.copy(input.idx.subarray(0, input.triCount * 3))
		this.areas.copy(areaBuf)

		const border = s.borderSize * s.cs
		const bmin: [number, number, number] = [tx * s.tileYards - border, input.minY - 1, tz * s.tileYards - border]
		const bmax: [number, number, number] = [(tx + 1) * s.tileYards + border, input.maxY + 1, (tz + 1) * s.tileYards + border]
		const side = s.tileCells + s.borderSize * 2
		const ctx = this.ctx
		const hf = r.allocHeightfield()
		let chf: RecastModule.RecastCompactHeightfield | null = null
		let cset: RecastModule.RecastContourSet | null = null
		let pmesh: RecastModule.RecastPolyMesh | null = null
		let dmesh: RecastModule.RecastPolyMeshDetail | null = null
		try {
			if (!r.createHeightfield(ctx, hf, side, side, bmin, bmax, s.cs, s.ch)) return null
			if (!r.rasterizeTriangles(ctx, this.verts, input.vertCount, this.tris, this.areas, input.triCount, hf, s.walkableClimb)) return null
			r.filterLowHangingWalkableObstacles(ctx, s.walkableClimb, hf)
			r.filterLedgeSpans(ctx, s.walkableHeight, s.walkableClimb, hf)
			r.filterWalkableLowHeightSpans(ctx, s.walkableHeight, hf)
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
			for (let i = 0; i < np; i++) pmesh.setFlags(i, pmesh.areas(i) === AREA_STEEP ? NAV_GROUND | NAV_STEEP : NAV_GROUND)
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
			if (chf) r.freeCompactHeightfield(chf)
			if (cset) r.freeContourSet(cset)
			if (pmesh) r.freePolyMesh(pmesh)
			if (dmesh) r.freePolyMeshDetail(dmesh)
		}
	}

	destroy() {
		this.verts.destroy()
		this.tris.destroy()
		this.areas.destroy()
	}
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
