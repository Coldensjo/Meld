import * as THREE from 'three'
import { getAsset } from '../models/assets'
import type { ObjectLayer } from './ObjectLayer'

/** The 12 edges of a box, as pairs of its corners (corner bit 1 is max x, 2 max y, 4 max z). */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]

/**
 * View › Bounding boxes (Noggit Red's model boxes): every shown model's box, turned and scaled with it,
 * as one set of lines. The lines are rebuilt only when the models, the loaded meshes or the ground
 * change, never per frame.
 */
export class ModelBoxes {
  readonly lines: THREE.LineSegments
  private geometry = new THREE.BufferGeometry()
  private layer: ObjectLayer | null = null
  private version = -1
  private heights = -1
  private corner = new THREE.Vector3()
  private m = new THREE.Matrix4()

  constructor() {
    const material = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.7, fog: false })
    this.lines = new THREE.LineSegments(this.geometry, material)
    this.lines.name = 'model boxes'
    this.lines.frustumCulled = false
    this.lines.visible = false
  }

  /** Shows or hides the boxes and rebuilds them when the map's models or ground changed. */
  update(layer: ObjectLayer, visible: boolean, heightsVersion: number) {
    this.lines.visible = visible
    if (!visible) return
    if (layer === this.layer && layer.version === this.version && heightsVersion === this.heights) return
    this.layer = layer
    this.version = layer.version
    this.heights = heightsVersion
    const objects = layer.list().filter((o) => !layer.isHidden(o.id) && getAsset(o.type).ready)
    const pos = new Float32Array(objects.length * EDGES.length * 3)
    let p = 0
    const c = this.corner
    for (const o of objects) {
      const box = getAsset(o.type).bbox
      layer.matrixOf(o, this.m)
      for (const k of EDGES) {
        c.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(this.m)
        pos[p++] = c.x
        pos[p++] = c.y
        pos[p++] = c.z
      }
    }
    this.geometry.dispose()
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.lines.geometry = this.geometry
  }

  dispose() {
    this.geometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
  }
}
