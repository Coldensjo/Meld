import * as THREE from 'three'
import { getAsset } from '../models/assets'
import { baseType } from '../models/wmoSet'
import { fetchWmoNav } from '../wow/api'
import type { ObjectLayer } from './ObjectLayer'
import { EXTERIOR_LIT } from './wmoFlood'
import { selectWmoFog, type FogTarget } from './wmoFog'
import { decodeWmoNav, downRayPick, EXTERIOR, toModel, type RoomSeeds, type WmoNav } from './wmoRoom'

/** The WMO room the camera is in. */
export interface CameraRoom {
  /** The placed WMO's object id and client path. */
  id: number
  path: string
  nav: WmoNav
  group: number
  /** The group across the portal the probe crossed, or null. */
  across: number | null
  /** The eye in the WMO's model space (WoW axes). */
  eye: [number, number, number]
  /** The probe's verdict, the portal flood's seeds. */
  seeds: RoomSeeds
  /** The placement's world matrix and origin, as the probe saw them. */
  matrix: THREE.Matrix4
  origin: THREE.Vector3
  /** The room's fog, or null where the WMO keeps the scene's. */
  fog: FogTarget | null
}

/** The camera has to move this far (yd) before the probe runs again. */
const MOVE_EPS = 0.01
/** How far (yd) from the camera a building is flooded from outside. */
const OUTSIDE_RANGE = 400

/** A placed WMO with portals in view that the camera is not in, flooded from outside. */
export interface OutsideWmo {
  id: number
  nav: WmoNav
  /** The placement's world matrix and origin. */
  matrix: THREE.Matrix4
  origin: THREE.Vector3
  /** Its distance from the camera, nearest first. */
  dist: number
}

/**
 * Tracks which room of which placed WMO the camera is in (`wmoRoom.ts`'s probe), loading each WMO's
 * room data from the client the first time the camera enters its box. The probe reruns only when
 * the camera moves or the objects change.
 */
export class WmoRooms {
  current: CameraRoom | null = null
  private navs = new Map<string, WmoNav | null>()
  private wmoIds: number[] = []
  private layer: ObjectLayer | null = null
  private objectsVersion = -1
  private lastEye = new THREE.Vector3(NaN, NaN, NaN)
  private loaded = 0
  private seenLoaded = -1
  private m = new THREE.Matrix4()
  private inv = new THREE.Matrix4()
  private local = new THREE.Vector3()
  private eyeModel: [number, number, number] = [0, 0, 0]
  private groundModel: [number, number, number] = [0, 0, 0]
  private pool: OutsideWmo[] = []
  private found: OutsideWmo[] = []
  private box = new THREE.Box3()

  /**
   * The nearest `max` placed WMOs with a portal graph that meet `frustum` within OUTSIDE_RANGE of
   * `eye`, other than the one the camera is in; one whose room data is still loading is left out
   * (and starts loading). The list and its entries are reused by the next call.
   */
  outside(objects: ObjectLayer, frustum: THREE.Frustum, eye: THREE.Vector3, max: number): readonly OutsideWmo[] {
    const found = this.found
    found.length = 0
    if (objects !== this.layer) return found
    for (const id of this.wmoIds) {
      if (id === this.current?.id) continue
      const o = objects.objects.get(id)
      if (!o || objects.isHidden(id)) continue
      const asset = getAsset(o.type)
      if (!asset.ready) continue
      objects.matrixOf(o, this.m)
      this.box.copy(asset.bbox).applyMatrix4(this.m)
      const dist = this.box.distanceToPoint(eye)
      if (dist > OUTSIDE_RANGE || !frustum.intersectsBox(this.box)) continue
      const nav = this.nav(baseType(o.type).slice('wmo:'.length))
      if (!nav || !nav.portals.length) continue
      let e = this.pool[found.length]
      if (!e) {
        e = { id: 0, nav, matrix: new THREE.Matrix4(), origin: new THREE.Vector3(), dist: 0 }
        this.pool.push(e)
      }
      e.id = id
      e.nav = nav
      e.matrix.copy(this.m)
      e.origin.setFromMatrixPosition(this.m)
      e.dist = dist
      found.push(e)
    }
    found.sort((a, b) => a.dist - b.dist)
    if (found.length > max) found.length = max
    return found
  }

  /**
   * Runs the probe for an eye at `eye` (world space). `groundAt` gives the terrain's height under a
   * point, or null where there is none (off the map, or a hole).
   */
  update(objects: ObjectLayer, eye: THREE.Vector3, groundAt: (x: number, z: number) => number | null) {
    if (objects !== this.layer || objects.version !== this.objectsVersion) {
      this.layer = objects
      this.objectsVersion = objects.version
      this.wmoIds.length = 0
      for (const o of objects.objects.values()) if (o.type.startsWith('wmo:')) this.wmoIds.push(o.id)
    } else if (eye.distanceToSquared(this.lastEye) < MOVE_EPS * MOVE_EPS && this.loaded === this.seenLoaded) {
      return
    }
    this.lastEye.copy(eye)
    this.seenLoaded = this.loaded
    this.current = null
    const ground = groundAt(eye.x, eye.z)
    for (const id of this.wmoIds) {
      const o = objects.objects.get(id)
      if (!o || objects.isHidden(id)) continue
      const asset = getAsset(o.type)
      if (!asset.ready) {
        this.lastEye.set(NaN, NaN, NaN) // look again once it has loaded
        continue
      }
      objects.matrixOf(o, this.m)
      this.inv.copy(this.m).invert()
      this.local.copy(eye).applyMatrix4(this.inv)
      if (!asset.bbox.containsPoint(this.local)) continue
      const path = baseType(o.type).slice('wmo:'.length)
      const nav = this.nav(path)
      if (!nav) continue
      toModel(this.local, this.eyeModel)
      let groundZ: number | null = null
      if (ground !== null) {
        this.local.set(eye.x, ground, eye.z).applyMatrix4(this.inv)
        groundZ = toModel(this.local, this.groundModel)[2]
      }
      const [ex, ey, ez] = this.eyeModel
      const seeds = downRayPick(nav, ex, ey, ez, groundZ)
      if (seeds.inGroup === null) continue
      // The fog comes from the first of the camera's groups that is a true interior (no 0x48).
      let fog: FogTarget | null = null
      for (const g of [seeds.inGroup, seeds.across]) {
        if (g === null || nav.groups[g].flags & (EXTERIOR | EXTERIOR_LIT)) continue
        fog = selectWmoFog(nav.fogs, nav.groups[g].fogs, this.eyeModel)
        break
      }
      const matrix = this.m.clone()
      this.current = {
        id,
        path,
        nav,
        group: seeds.inGroup,
        across: seeds.across,
        eye: [ex, ey, ez],
        seeds,
        matrix,
        origin: new THREE.Vector3().setFromMatrixPosition(matrix),
        fog,
      }
      return
    }
  }

  /** The room data of a WMO, or null while it loads (or when it failed). */
  private nav(path: string): WmoNav | null {
    const key = path.toLowerCase()
    if (this.navs.has(key)) return this.navs.get(key)!
    this.navs.set(key, null)
    fetchWmoNav(path)
      .then((buf) => {
        this.navs.set(key, decodeWmoNav(buf))
        this.loaded++
      })
      .catch(() => {})
    return null
  }
}
