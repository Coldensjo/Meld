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
}

/** Decodes the endpoint's body: a u32 header length, the JSON header, then the faces as float32. */
export function decodeWmoNav(buf: ArrayBuffer): WmoNav {
  const n = new DataView(buf).getUint32(0, true)
  type Header = Omit<WmoNav, 'groups' | 'walk' | 'camera'> & { groups: Array<WmoNavGroup & { walk: number; camera: number }> }
  const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as Header
  let off = 4 + n
  const take = (tris: number) => {
    const a = new Float32Array(buf, off, tris * 9)
    off += tris * 36
    return a
  }
  const walk = hdr.groups.map((g) => take(g.walk))
  const camera = hdr.groups.map((g) => take(g.camera))
  return { groups: hdr.groups, portalVerts: hdr.portalVerts, portals: hdr.portals, refs: hdr.refs, fogs: hdr.fogs, walk, camera }
}

/** The z at column (x, y) of the triangle at `tris[o..o+9]`, or NaN outside it or for a vertical face. */
export function triangleZAt(tris: ArrayLike<number>, o: number, x: number, y: number): number {
  const ax = tris[o], ay = tris[o + 1], az = tris[o + 2]
  const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5]
  const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8]
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
    const cu = verts[i * 3 + u], cv = verts[i * 3 + v]
    const qu = verts[prev * 3 + u], qv = verts[prev * 3 + v]
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
  let bestZ = -Infinity
  let best = -1
  for (let gi = 0; gi < groups.length; gi++) {
    if (!inColumn(groups[gi])) continue
    const tris = nav.walk[gi]
    for (let o = 0; o + 9 <= tris.length; o += 9) {
      const z = triangleZAt(tris, o, ex, ey)
      if (z <= ez && z > bestZ) {
        bestZ = z
        best = gi
      }
    }
  }

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

/** Takes an editor-space point, already in the model's local frame, to WoW axes: (x, -z, y). */
export function toModel(local: THREE.Vector3, out: [number, number, number]): [number, number, number] {
  out[0] = local.x
  out[1] = -local.z
  out[2] = local.y
  return out
}
