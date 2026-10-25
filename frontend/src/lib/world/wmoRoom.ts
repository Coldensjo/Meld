// The camera's room in a WMO: which group the client counts the eye as inside, from a ray cast
// straight down from the eye. Ported from Benilla's `wmo_portal/seed.rs` (`down_ray_pick`,
// MIT/Apache-2.0), which follows the 1.12 client's per-frame probe (0x6821f0 → 0x6be250 → 0x6a3f80).
// The nearest crossing at or below the eye wins:
//
// - Leg A, the walking-collision faces (every face but DETAIL), with no orientation filter.
// - Leg B, the portal crossings: the eye's side of the portal's plane picks the group. A vertical
//   portal counts only within PORTAL_PLANE_SNAP of its plane, and a crossing within NEAREST_TIE_EPS
//   of the nearest face still wins, so a floor-hole portal flips the room.
// - The terrain race: terrain at or below the eye and strictly above the WMO hit is open ground.
// - Leg C (Benilla's deviation): when A and B miss and no terrain lies at or below the eye, the
//   camera-only faces (DETAIL without NOCAMCOLLIDE), so a pocket floored only with detail faces
//   (the Deadmines entrance) still counts.
//
// An exterior group (MOGP 0x8) or nothing within the ray is outside. Everything here is in the
// WMO's model space with WoW axes (Z up); `toModel` takes an editor-space point there.

import * as THREE from 'three'

/** MOGP 0x8: an exterior group, which never counts as a room. */
export const EXTERIOR = 0x8
/** The ray's length (yd): a floor further below is not the room the eye is in. */
export const MAX_FLOOR_DROP = 1760
/** Below this |n.z| a portal is vertical (a doorway). */
export const PORTAL_NEAR_PARALLEL = 1e-4
/** A vertical portal is crossed only while the eye is this close to its plane (yd). */
export const PORTAL_PLANE_SNAP = 0.1
/** A portal crossing this close under the nearest face hit still wins. */
export const NEAREST_TIE_EPS = 1e-4

export interface WmoNavGroup {
	flags: number
	min: [number, number, number]
	max: [number, number, number]
	refStart: number
	refCount: number
	/** Indices into `fogs` the room's fog blends. */
	fogs: [number, number, number, number]
	/** The group's name in the WMO ('' for none). */
	name: string
}

export interface WmoPortal {
	start: number
	count: number
	/** n·p + d is a point's signed distance. */
	plane: [number, number, number, number]
}

export interface WmoPortalRef {
	portal: number
	/** The group behind the portal. */
	group: number
	/** The side (±1) of the portal's plane the referring group lies on. */
	side: number
}

export interface WmoFog {
	flags: number
	pos: [number, number, number]
	inner: number
	outer: number
	end: number
	/** Fog start as a share of its end. */
	start: number
	/** 0xAARRGGBB. */
	color: number
}

/** A WMO's room data, as /wow/wmonav serves it. */
export interface WmoNav {
	groups: WmoNavGroup[]
	/** The portal polygons' vertices, three floats each. */
	portalVerts: number[]
	portals: WmoPortal[]
	refs: WmoPortalRef[]
	fogs: WmoFog[]
	/** Each group's walking faces and camera-only faces, nine floats a triangle. */
	walk: Float32Array[]
	camera: Float32Array[]
	/** Each group's column index over its walking faces, or null for a group too small to need one. */
	walkGrids?: Array<ColumnGrid | null>
}

/**
 * A column index over a face set (Benilla's column_grid.rs, MIT/Apache-2.0, one level): which faces
 * can own a vertical (x, y) column. A uniform XY grid of about one face a cell, in CSR form, and
 * the faces spanning more than SPAN_CELLS cells, tested for every column. Candidates come out in
 * ascending face order, as a linear scan visits them, so ties resolve the same: it never changes a
 * verdict.
 */
export interface ColumnGrid {
	minX: number
	minY: number
	inv: number
	nx: number
	ny: number
	starts: Uint32Array
	items: Uint32Array
	spanning: Uint32Array
}

/** Fewer faces than this are scanned directly. */
const GRID_MIN_TRIS = 64
const SPAN_CELLS = 32
const MIN_CELL = 0.25
const MAX_CELLS = 1 << 16

/** The column index of `tris` (nine floats a face), or null for fewer than GRID_MIN_TRIS faces. */
export function buildColumnGrid(tris: Float32Array): ColumnGrid | null {
	const n = tris.length / 9
	if (n < GRID_MIN_TRIS) return null
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity
	for (let i = 0; i < tris.length; i += 3) {
		minX = Math.min(minX, tris[i])
		maxX = Math.max(maxX, tris[i])
		minY = Math.min(minY, tris[i + 1])
		maxY = Math.max(maxY, tris[i + 1])
	}
	const w = Math.max(maxX - minX, 1e-3),
		h = Math.max(maxY - minY, 1e-3)
	let cell = Math.max(MIN_CELL, Math.sqrt((w * h) / n))
	while (Math.ceil(w / cell) * Math.ceil(h / cell) > MAX_CELLS) cell *= 1.5
	const nx = Math.max(1, Math.ceil(w / cell)),
		ny = Math.max(1, Math.ceil(h / cell))
	const inv = 1 / cell
	const at = (v: number, min: number, cells: number) => Math.min(cells - 1, Math.max(0, Math.floor((v - min) * inv)))
	const counts = new Uint32Array(nx * ny + 1)
	const span: number[] = []
	const box = new Int32Array(n * 4)
	for (let f = 0; f < n; f++) {
		const o = f * 9
		const x0 = at(Math.min(tris[o], tris[o + 3], tris[o + 6]), minX, nx),
			x1 = at(Math.max(tris[o], tris[o + 3], tris[o + 6]), minX, nx)
		const y0 = at(Math.min(tris[o + 1], tris[o + 4], tris[o + 7]), minY, ny),
			y1 = at(Math.max(tris[o + 1], tris[o + 4], tris[o + 7]), minY, ny)
		box.set([x0, y0, x1, y1], f * 4)
		if ((x1 - x0 + 1) * (y1 - y0 + 1) > SPAN_CELLS) {
			span.push(f)
			box[f * 4] = -1
			continue
		}
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[y * nx + x + 1]++
	}
	for (let c = 0; c < nx * ny; c++) counts[c + 1] += counts[c]
	const items = new Uint32Array(counts[nx * ny])
	const fill = counts.slice(0, nx * ny)
	// Faces in ascending order, so each cell's list is ascending.
	for (let f = 0; f < n; f++) {
		if (box[f * 4] < 0) continue
		for (let y = box[f * 4 + 1]; y <= box[f * 4 + 3]; y++) for (let x = box[f * 4]; x <= box[f * 4 + 2]; x++) items[fill[y * nx + x]++] = f
	}
	return { minX, minY, inv, nx, ny, starts: counts, items, spanning: Uint32Array.from(span) }
}

/** Decodes the endpoint's body: a u32 header length, the JSON header, then the faces as float32. */
export function decodeWmoNav(buf: ArrayBuffer): WmoNav {
	const n = new DataView(buf).getUint32(0, true)
	type Header = Omit<WmoNav, 'groups' | 'walk' | 'camera'> & { groups: Array<WmoNavGroup & { walk: number; camera: number }> }
	const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as Header
	let off = 4 + n
	const take = (tris: number) => {
		if (off + tris * 36 > buf.byteLength) throw new Error(`WMO room data: ${tris} faces at byte ${off} run past the body's ${buf.byteLength} bytes`)
		const a = new Float32Array(buf, off, tris * 9)
		off += tris * 36
		return a
	}
	const walk = hdr.groups.map((g) => take(g.walk))
	const camera = hdr.groups.map((g) => take(g.camera))
	const walkGrids = walk.map(buildColumnGrid)
	return { groups: hdr.groups, portalVerts: hdr.portalVerts, portals: hdr.portals, refs: hdr.refs, fogs: hdr.fogs, walk, camera, walkGrids }
}

/** The z at column (x, y) of the triangle at `tris[o..o+9]`, or NaN outside it or for a vertical face. */
export function triangleZAt(tris: ArrayLike<number>, o: number, x: number, y: number): number {
	const ax = tris[o],
		ay = tris[o + 1],
		az = tris[o + 2]
	const bx = tris[o + 3],
		by = tris[o + 4],
		bz = tris[o + 5]
	const cx = tris[o + 6],
		cy = tris[o + 7],
		cz = tris[o + 8]
	const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
	if (Math.abs(det) < 1e-9) return NaN
	const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det
	const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det
	const l3 = 1 - l1 - l2
	if (l1 < 0 || l2 < 0 || l3 < 0) return NaN
	return l1 * az + l2 * bz + l3 * cz
}

/** Even-odd point-in-polygon over the polygon's (u, v) axes. */
function pointInPoly(verts: ArrayLike<number>, start: number, count: number, u: number, v: number, pu: number, pv: number): boolean {
	let inside = false
	let prev = start + count - 1
	for (let i = start; i < start + count; i++) {
		const cu = verts[i * 3 + u],
			cv = verts[i * 3 + v]
		const qu = verts[prev * 3 + u],
			qv = verts[prev * 3 + v]
		if (cv > pv !== qv > pv && pu < ((qu - cu) * (pv - cv)) / (qv - cv) + cu) inside = !inside
		prev = i
	}
	return inside
}

/** The two axes spanning a plane's projection along its normal's largest component. */
function dominantAxes(nx: number, ny: number, nz: number): [number, number] {
	if (Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz)) return [1, 2]
	if (Math.abs(ny) >= Math.abs(nz)) return [0, 2]
	return [0, 1]
}

/** Leg A's answer, reused by every call: the highest walking face's height and its group (-1 for none). */
const legA = { z: -Infinity, group: -1 }

/** Finds the highest walking face at or below the eye (model space, WoW axes) into `out`. */
function walkLeg(nav: WmoNav, ex: number, ey: number, ez: number, out: { z: number; group: number }) {
	const groups = nav.groups
	let bestZ = -Infinity
	let best = -1
	for (let gi = 0; gi < groups.length; gi++) {
		const g = groups[gi]
		if (ex < g.min[0] || ex > g.max[0] || ey < g.min[1] || ey > g.max[1] || g.min[2] > ez) continue
		const tris = nav.walk[gi]
		const grid = nav.walkGrids?.[gi]
		if (!grid) {
			for (let o = 0; o + 9 <= tris.length; o += 9) {
				const z = triangleZAt(tris, o, ex, ey)
				if (z <= ez && z > bestZ) {
					bestZ = z
					best = gi
				}
			}
			continue
		}
		// The column's cell and the spanning faces, merged in ascending order.
		const cx = Math.floor((ex - grid.minX) * grid.inv),
			cy = Math.floor((ey - grid.minY) * grid.inv)
		const inGrid = cx >= 0 && cy >= 0 && cx < grid.nx && cy < grid.ny
		let a = inGrid ? grid.starts[cy * grid.nx + cx] : 0
		const aEnd = inGrid ? grid.starts[cy * grid.nx + cx + 1] : 0
		let b = 0
		const sp = grid.spanning
		while (a < aEnd || b < sp.length) {
			const f = b >= sp.length || (a < aEnd && grid.items[a] < sp[b]) ? grid.items[a++] : sp[b++]
			const z = triangleZAt(tris, f * 9, ex, ey)
			if (z <= ez && z > bestZ) {
				bestZ = z
				best = gi
			}
		}
	}
	out.z = bestZ
	out.group = best
}

/**
 * The height (model space) of the highest walking face of `nav` at or below the eye, the floor a
 * player would stand on there, or -Infinity where there is none (#310).
 */
export function walkFloorZ(nav: WmoNav, ex: number, ey: number, ez: number): number {
	walkLeg(nav, ex, ey, ez, legA)
	return legA.z
}

/** The probe's verdict: the eye's group and, when a portal won, the group across it; null outside. */
export interface RoomSeeds {
	inGroup: number | null
	across: number | null
}

/**
 * The group the eye is in. `eye` is in model space (WoW axes); `terrainZ` is the ground's height
 * under the eye in the same space, or null where there is none (off the map, or a hole).
 */
export function downRayPick(nav: WmoNav, ex: number, ey: number, ez: number, terrainZ: number | null): RoomSeeds {
	const groups = nav.groups
	const inColumn = (g: WmoNavGroup) => ex >= g.min[0] && ex <= g.max[0] && ey >= g.min[1] && ey <= g.max[1] && g.min[2] <= ez
	const outside: RoomSeeds = { inGroup: null, across: null }

	// Leg A: the highest walking face at or below the eye.
	walkLeg(nav, ex, ey, ez, legA)
	let bestZ = legA.z
	let best = legA.group

	// Leg B: the portal crossings, racing the face hit.
	let across = -1
	for (let gi = 0; gi < groups.length; gi++) {
		const g = groups[gi]
		if (!inColumn(g)) continue
		const end = Math.min(g.refStart + g.refCount, nav.refs.length)
		for (let r = g.refStart; r < end; r++) {
			const ref = nav.refs[r]
			const p = nav.portals[ref.portal]
			if (!p) continue
			const [nx, ny, nz, d] = p.plane
			let z: number
			if (Math.abs(nz) < PORTAL_NEAR_PARALLEL) {
				// A doorway: crossed at the eye, only within the snap of its plane.
				if (Math.abs(nx * ex + ny * ey + nz * ez + d) > PORTAL_PLANE_SNAP) continue
				z = ez
			} else {
				z = -(nx * ex + ny * ey + d) / nz
				if (z > ez) continue
			}
			if (z < bestZ - NEAREST_TIE_EPS) continue
			if (p.count < 3 || (p.start + p.count) * 3 > nav.portalVerts.length) continue
			const [u, v] = dominantAxes(nx, ny, nz)
			const pu = u === 0 ? ex : ey
			const pv = v === 1 ? ey : z
			if (!pointInPoly(nav.portalVerts, p.start, p.count, u, v, pu, pv)) continue
			// The eye's side, oriented by the ref's side, picks this group or the one behind the portal.
			const signed = nx * ex + ny * ey + nz * ez + d
			const chosen = signed >= 0 === ref.side > 0 ? gi : ref.group
			// A dead neighbour (0xffff) is no room: the mirrored ref takes the crossing.
			if (chosen >= groups.length) continue
			const other = chosen === gi ? ref.group : gi
			bestZ = z
			best = chosen
			across = other < groups.length && other !== chosen ? other : -1
		}
	}

	if (best < 0) {
		// Leg C, only when A and B missed and no terrain lies at or below the eye.
		if (terrainZ !== null && terrainZ <= ez) return outside
		let fbZ = -Infinity
		let fb = -1
		for (let gi = 0; gi < groups.length; gi++) {
			if (!inColumn(groups[gi])) continue
			const tris = nav.camera[gi]
			for (let o = 0; o + 9 <= tris.length; o += 9) {
				const z = triangleZAt(tris, o, ex, ey)
				if (z <= ez && z > fbZ) {
					fbZ = z
					fb = gi
				}
			}
		}
		if (fb < 0 || ez - fbZ > MAX_FLOOR_DROP || groups[fb].flags & EXTERIOR) return outside
		return { inGroup: fb, across: null }
	}
	if (ez - bestZ > MAX_FLOOR_DROP || groups[best].flags & EXTERIOR) return outside
	// Terrain above the eye is off the ray; terrain strictly above the WMO hit is open ground.
	if (terrainZ !== null && terrainZ <= ez && terrainZ > bestZ) return outside
	return { inGroup: best, across: across < 0 ? null : across }
}

/** The point on the face that the last `triangleDistSq` found nearest. */
const closest = new Float64Array(3)

/**
 * The squared distance from (px, py, pz) to the triangle at `t[o..o+9]` (Ericson's closest point,
 * 5.1.5). The nearest point itself is left in `closest`.
 */
export function triangleDistSq(t: ArrayLike<number>, o: number, px: number, py: number, pz: number): number {
	const ax = t[o],
		ay = t[o + 1],
		az = t[o + 2]
	const abx = t[o + 3] - ax,
		aby = t[o + 4] - ay,
		abz = t[o + 5] - az
	const acx = t[o + 6] - ax,
		acy = t[o + 7] - ay,
		acz = t[o + 8] - az
	const apx = px - ax,
		apy = py - ay,
		apz = pz - az
	const d1 = abx * apx + aby * apy + abz * apz
	const d2 = acx * apx + acy * apy + acz * apz
	let qx: number, qy: number, qz: number
	if (d1 <= 0 && d2 <= 0) {
		qx = ax
		qy = ay
		qz = az
	} else {
		const bpx = px - t[o + 3],
			bpy = py - t[o + 4],
			bpz = pz - t[o + 5]
		const d3 = abx * bpx + aby * bpy + abz * bpz
		const d4 = acx * bpx + acy * bpy + acz * bpz
		const cpx = px - t[o + 6],
			cpy = py - t[o + 7],
			cpz = pz - t[o + 8]
		const d5 = abx * cpx + aby * cpy + abz * cpz
		const d6 = acx * cpx + acy * cpy + acz * cpz
		const vc = d1 * d4 - d3 * d2
		const vb = d5 * d2 - d1 * d6
		const va = d3 * d6 - d5 * d4
		if (d3 >= 0 && d4 <= d3) {
			qx = t[o + 3]
			qy = t[o + 4]
			qz = t[o + 5]
		} else if (d6 >= 0 && d5 <= d6) {
			qx = t[o + 6]
			qy = t[o + 7]
			qz = t[o + 8]
		} else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
			const v = d1 / (d1 - d3)
			qx = ax + abx * v
			qy = ay + aby * v
			qz = az + abz * v
		} else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
			const w = d2 / (d2 - d6)
			qx = ax + acx * w
			qy = ay + acy * w
			qz = az + acz * w
		} else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
			const bx = t[o + 3],
				by = t[o + 4],
				bz = t[o + 5]
			qx = bx + (t[o + 6] - bx) * w
			qy = by + (t[o + 7] - by) * w
			qz = bz + (t[o + 8] - bz) * w
		} else {
			const sum = va + vb + vc
			// A degenerate face (no area): its first corner stands for it.
			if (!(Math.abs(sum) > 1e-12)) {
				qx = ax
				qy = ay
				qz = az
			} else {
				const v = vb / sum,
					w = vc / sum
				qx = ax + abx * v + acx * w
				qy = ay + aby * v + acy * w
				qz = az + abz * v + acz * w
			}
		}
	}
	closest[0] = qx
	closest[1] = qy
	closest[2] = qz
	const dx = px - qx,
		dy = py - qy,
		dz = pz - qz
	return dx * dx + dy * dy + dz * dz
}

/**
 * The distance (model units) from the eye to the nearest of the WMO's collision faces (the walking
 * faces and the camera-only ones, walls included), or Infinity when none lies within `reach`. Only
 * the groups whose box comes within `reach` are searched, and through a group's column index only
 * the cells within `reach` of the eye's column. The Engine pulls the near plane in by it (#304).
 */
export function nearestFaceDist(nav: WmoNav, ex: number, ey: number, ez: number, reach: number, out?: number[]): number {
	best = reach * reach
	bestOut = out ?? null
	const groups = nav.groups
	for (let gi = 0; gi < groups.length; gi++) {
		const g = groups[gi]
		if (ex < g.min[0] - reach || ex > g.max[0] + reach || ey < g.min[1] - reach || ey > g.max[1] + reach || ez < g.min[2] - reach || ez > g.max[2] + reach) continue
		for (let k = 0; k < 2; k++) {
			const tris = k === 0 ? nav.walk[gi] : nav.camera[gi]
			const grid = k === 0 ? nav.walkGrids?.[gi] : null
			if (!grid) {
				for (let o = 0; o + 9 <= tris.length; o += 9) {
					keepNearest(triangleDistSq(tris, o, ex, ey, ez))
				}
				continue
			}
			const x0 = Math.max(0, Math.floor((ex - reach - grid.minX) * grid.inv)),
				x1 = Math.min(grid.nx - 1, Math.floor((ex + reach - grid.minX) * grid.inv))
			const y0 = Math.max(0, Math.floor((ey - reach - grid.minY) * grid.inv)),
				y1 = Math.min(grid.ny - 1, Math.floor((ey + reach - grid.minY) * grid.inv))
			// A face in several cells is measured once a cell; the minimum is the same.
			for (let cy = y0; cy <= y1; cy++) {
				for (let cx = x0; cx <= x1; cx++) {
					const c = cy * grid.nx + cx
					for (let i = grid.starts[c]; i < grid.starts[c + 1]; i++) {
						keepNearest(triangleDistSq(tris, grid.items[i] * 9, ex, ey, ez))
					}
				}
			}
			for (let i = 0; i < grid.spanning.length; i++) {
				keepNearest(triangleDistSq(tris, grid.spanning[i] * 9, ex, ey, ez))
			}
		}
	}
	bestOut = null
	return best < reach * reach ? Math.sqrt(best) : Infinity
}

/** `nearestFaceDist`'s running minimum, and where it copies the nearest point (or null). */
let best = 0
let bestOut: number[] | null = null

function keepNearest(d: number) {
	if (d >= best) return
	best = d
	if (bestOut) {
		bestOut[0] = closest[0]
		bestOut[1] = closest[1]
		bestOut[2] = closest[2]
	}
}

/**
 * The fraction (0..1) along the segment from `a` to `b` at which it first crosses one of the WMO's
 * collision faces (the walking faces and the camera-only ones), or Infinity where it crosses none.
 * `normal` gets that face's unit normal, turned to face `a`. Only the groups whose box meets the
 * segment's are searched, and through a group's column index only the cells under the segment.
 */
export function sweepFaces(nav: WmoNav, a: ArrayLike<number>, b: ArrayLike<number>, normal: number[]): number {
	const ax = a[0],
		ay = a[1],
		az = a[2]
	const dx = b[0] - ax,
		dy = b[1] - ay,
		dz = b[2] - az
	const minX = Math.min(ax, b[0]),
		maxX = Math.max(ax, b[0])
	const minY = Math.min(ay, b[1]),
		maxY = Math.max(ay, b[1])
	const minZ = Math.min(az, b[2]),
		maxZ = Math.max(az, b[2])
	let hit = Infinity
	let hitTris: ArrayLike<number> | null = null
	let hitO = 0
	const groups = nav.groups
	for (let gi = 0; gi < groups.length; gi++) {
		const g = groups[gi]
		if (maxX < g.min[0] || minX > g.max[0] || maxY < g.min[1] || minY > g.max[1] || maxZ < g.min[2] || minZ > g.max[2]) continue
		for (let k = 0; k < 2; k++) {
			const tris = k === 0 ? nav.walk[gi] : nav.camera[gi]
			const grid = k === 0 ? nav.walkGrids?.[gi] : null
			if (!grid) {
				for (let o = 0; o + 9 <= tris.length; o += 9) {
					const t = segmentTriangle(tris, o, ax, ay, az, dx, dy, dz)
					if (t < hit) {
						hit = t
						hitTris = tris
						hitO = o
					}
				}
				continue
			}
			const x0 = Math.max(0, Math.floor((minX - grid.minX) * grid.inv)),
				x1 = Math.min(grid.nx - 1, Math.floor((maxX - grid.minX) * grid.inv))
			const y0 = Math.max(0, Math.floor((minY - grid.minY) * grid.inv)),
				y1 = Math.min(grid.ny - 1, Math.floor((maxY - grid.minY) * grid.inv))
			for (let cy = y0; cy <= y1; cy++) {
				for (let cx = x0; cx <= x1; cx++) {
					const c = cy * grid.nx + cx
					for (let i = grid.starts[c]; i < grid.starts[c + 1]; i++) {
						const o = grid.items[i] * 9
						const t = segmentTriangle(tris, o, ax, ay, az, dx, dy, dz)
						if (t < hit) {
							hit = t
							hitTris = tris
							hitO = o
						}
					}
				}
			}
			for (let i = 0; i < grid.spanning.length; i++) {
				const o = grid.spanning[i] * 9
				const t = segmentTriangle(tris, o, ax, ay, az, dx, dy, dz)
				if (t < hit) {
					hit = t
					hitTris = tris
					hitO = o
				}
			}
		}
	}
	if (!hitTris) return Infinity
	const t = hitTris,
		o = hitO
	const e1x = t[o + 3] - t[o],
		e1y = t[o + 4] - t[o + 1],
		e1z = t[o + 5] - t[o + 2]
	const e2x = t[o + 6] - t[o],
		e2y = t[o + 7] - t[o + 1],
		e2z = t[o + 8] - t[o + 2]
	let nx = e1y * e2z - e1z * e2y,
		ny = e1z * e2x - e1x * e2z,
		nz = e1x * e2y - e1y * e2x
	const len = Math.hypot(nx, ny, nz)
	const s = nx * dx + ny * dy + nz * dz > 0 ? -1 / len : 1 / len
	nx *= s
	ny *= s
	nz *= s
	normal[0] = nx
	normal[1] = ny
	normal[2] = nz
	return hit
}

/**
 * Where the segment from (ax, ay, az) along (dx, dy, dz) crosses the triangle at `t[o..o+9]`, as a
 * fraction of it (0..1), either side of the face; Infinity where it misses (Möller and Trumbore).
 */
function segmentTriangle(t: ArrayLike<number>, o: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number): number {
	const vx = t[o],
		vy = t[o + 1],
		vz = t[o + 2]
	const e1x = t[o + 3] - vx,
		e1y = t[o + 4] - vy,
		e1z = t[o + 5] - vz
	const e2x = t[o + 6] - vx,
		e2y = t[o + 7] - vy,
		e2z = t[o + 8] - vz
	const px = dy * e2z - dz * e2y,
		py = dz * e2x - dx * e2z,
		pz = dx * e2y - dy * e2x
	const det = e1x * px + e1y * py + e1z * pz
	if (Math.abs(det) < 1e-12) return Infinity
	const inv = 1 / det
	const sx = ax - vx,
		sy = ay - vy,
		sz = az - vz
	const u = (sx * px + sy * py + sz * pz) * inv
	if (u < 0 || u > 1) return Infinity
	const qx = sy * e1z - sz * e1y,
		qy = sz * e1x - sx * e1z,
		qz = sx * e1y - sy * e1x
	const v = (dx * qx + dy * qy + dz * qz) * inv
	if (v < 0 || u + v > 1) return Infinity
	const h = (e2x * qx + e2y * qy + e2z * qz) * inv
	return h >= 0 && h <= 1 ? h : Infinity
}

const hitNormal = [0, 0, 0]
const nearPoint = [0, 0, 0]
const sweepFrom = [0, 0, 0]

/**
 * Moves a sphere of radius `r` from `a` towards `b` against the WMO's collision faces, as the
 * client's camera collides (#305), leaving where it stops in `b`. The path is swept, so a fast
 * move never passes through a thin wall in one step: at a face the sphere stops `r` off it and
 * slides along it with the rest of the move (twice at most, for a corner). Then it is pushed out
 * to `r` from any face it ended nearer to. Returns whether `b` changed. All in model space.
 */
export function collideSphere(nav: WmoNav, a: ArrayLike<number>, b: number[], r: number): boolean {
	let moved = false
	sweepFrom[0] = a[0]
	sweepFrom[1] = a[1]
	sweepFrom[2] = a[2]
	for (let pass = 0; pass < 3; pass++) {
		const t = sweepFaces(nav, sweepFrom, b, hitNormal)
		if (t === Infinity) break
		moved = true
		const nx = hitNormal[0],
			ny = hitNormal[1],
			nz = hitNormal[2]
		// Stop r off the face, on the side the move came from.
		const sx = sweepFrom[0] + (b[0] - sweepFrom[0]) * t + nx * r
		const sy = sweepFrom[1] + (b[1] - sweepFrom[1]) * t + ny * r
		const sz = sweepFrom[2] + (b[2] - sweepFrom[2]) * t + nz * r
		if (pass === 2) {
			b[0] = sx
			b[1] = sy
			b[2] = sz
			break
		}
		// The rest of the move, less its part into the face: a slide along it.
		let rx = b[0] - sx,
			ry = b[1] - sy,
			rz = b[2] - sz
		const into = rx * nx + ry * ny + rz * nz
		rx -= nx * into
		ry -= ny * into
		rz -= nz * into
		sweepFrom[0] = sx
		sweepFrom[1] = sy
		sweepFrom[2] = sz
		b[0] = sx + rx
		b[1] = sy + ry
		b[2] = sz + rz
	}
	for (let i = 0; i < 3; i++) {
		const d = nearestFaceDist(nav, b[0], b[1], b[2], r, nearPoint)
		// On a face exactly, there is no side to push to.
		if (d === Infinity || d < 1e-6) break
		const k = (r - d) / d + 1e-4
		b[0] += (b[0] - nearPoint[0]) * k
		b[1] += (b[1] - nearPoint[1]) * k
		b[2] += (b[2] - nearPoint[2]) * k
		moved = true
	}
	return moved
}

/** Takes an editor-space point, already in the model's local frame, to WoW axes: (x, -z, y). */
export function toModel(local: THREE.Vector3, out: [number, number, number]): [number, number, number] {
	out[0] = local.x
	out[1] = -local.z
	out[2] = local.y
	return out
}
