import * as THREE from 'three'
import type { AnimBone, AnimTrack } from '../wow/api'

/**
 * Plays a model's idle loop by skinning its shared geometry on the CPU. All
 * instances of a model animate in sync, so the cost is per model type, not
 * per placed object — fine for doodads (windmills, flags, braziers).
 */
export class ModelAnimation {
  private bindPos: Float32Array
  private bindNor: Float32Array
  private mats: THREE.Matrix4[]
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private tmpS = new THREE.Vector3()
  private tmpM = new THREE.Matrix4()
  private pivot = new THREE.Matrix4()
  private unpivot = new THREE.Matrix4()

  constructor(
    private geometry: THREE.BufferGeometry,
    private bones: AnimBone[],
    private boneIdx: Uint8Array,
    private boneW: Uint8Array,
  ) {
    const pos = geometry.attributes.position.array as Float32Array
    const nor = geometry.attributes.normal.array as Float32Array
    this.bindPos = pos.slice()
    this.bindNor = nor.slice()
    // Each mesh animates in place; make sure the GPU copy is updatable.
    ;(geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    ;(geometry.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    this.mats = bones.map(() => new THREE.Matrix4())
  }

  /** Sample a track at time `ms` into `out` (3 or 4 components). */
  private sample(tr: AnimTrack, ms: number, n: number, out: number[]) {
    const times = tr.t
    const v = tr.v
    if (times.length === 1 || !tr.loop) {
      for (let k = 0; k < n; k++) out[k] = v[k]
      return
    }
    const t = ms % tr.loop
    let hi = times.findIndex((x) => x > t)
    if (hi < 0) hi = times.length - 1
    const lo = Math.max(0, hi - 1)
    const span = times[hi] - times[lo]
    const f = tr.step || span <= 0 ? 0 : Math.min(1, Math.max(0, (t - times[lo]) / span))
    for (let k = 0; k < n; k++) out[k] = v[lo * n + k] + (v[hi * n + k] - v[lo * n + k]) * f
  }

  private s3 = [0, 0, 0]
  private s4 = [0, 0, 0, 1]

  update(ms: number) {
    const b = this.bones
    for (let i = 0; i < b.length; i++) {
      const bone = b[i]
      const m = this.mats[i]
      const p = bone.pivot
      this.pivot.makeTranslation(p[0], p[1], p[2])
      this.unpivot.makeTranslation(-p[0], -p[1], -p[2])
      this.tmpV.set(0, 0, 0)
      this.tmpQ.identity()
      this.tmpS.set(1, 1, 1)
      if (bone.tr) {
        this.sample(bone.tr, ms, 3, this.s3)
        this.tmpV.fromArray(this.s3)
      }
      if (bone.rot) {
        this.sample(bone.rot, ms, 4, this.s4)
        this.tmpQ.fromArray(this.s4).normalize()
      }
      if (bone.sc) {
        this.sample(bone.sc, ms, 3, this.s3)
        this.tmpS.fromArray(this.s3)
      }
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS)
      m.multiplyMatrices(this.pivot, this.tmpM).multiply(this.unpivot)
      // M2 lists parents before children.
      if (bone.parent >= 0 && bone.parent < i) m.premultiply(this.mats[bone.parent])
    }

    const pos = this.geometry.attributes.position.array as Float32Array
    const nor = this.geometry.attributes.normal.array as Float32Array
    const bp = this.bindPos
    const bn = this.bindNor
    const bi = this.boneIdx
    const bw = this.boneW
    const n = bp.length / 3
    for (let v = 0; v < n; v++) {
      const x = bp[v * 3], y = bp[v * 3 + 1], z = bp[v * 3 + 2]
      const nx = bn[v * 3], ny = bn[v * 3 + 1], nz = bn[v * 3 + 2]
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, wsum = 0
      for (let k = 0; k < 4; k++) {
        const w = bw[v * 4 + k]
        if (!w) continue
        const e = this.mats[bi[v * 4 + k]].elements
        const f = w / 255
        wsum += f
        px += (e[0] * x + e[4] * y + e[8] * z + e[12]) * f
        py += (e[1] * x + e[5] * y + e[9] * z + e[13]) * f
        pz += (e[2] * x + e[6] * y + e[10] * z + e[14]) * f
        qx += (e[0] * nx + e[4] * ny + e[8] * nz) * f
        qy += (e[1] * nx + e[5] * ny + e[9] * nz) * f
        qz += (e[2] * nx + e[6] * ny + e[10] * nz) * f
      }
      if (wsum === 0) {
        px = x; py = y; pz = z; qx = nx; qy = ny; qz = nz
      }
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz
      const l = Math.hypot(qx, qy, qz) || 1
      nor[v * 3] = qx / l; nor[v * 3 + 1] = qy / l; nor[v * 3 + 2] = qz / l
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.normal.needsUpdate = true
  }
}
