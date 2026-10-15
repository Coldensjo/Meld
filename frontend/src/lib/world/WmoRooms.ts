import * as THREE from 'three'
import { getAsset } from '../models/assets'
import { baseType } from '../models/wmoSet'
import { fetchWmoNav } from '../wow/api'
import type { ObjectLayer } from './ObjectLayer'
import { decodeWmoNav, downRayPick, toModel, type WmoNav } from './wmoRoom'

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
}

/** The camera has to move this far (yd) before the probe runs again. */
const MOVE_EPS = 0.01

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
      this.current = { id, path, nav, group: seeds.inGroup, across: seeds.across, eye: [ex, ey, ez] }
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
