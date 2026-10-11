import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../engine/noise'

/**
 * Tiny helper for building chunky, flat-shaded, vertex-coloured models from
 * primitives — the "hand-made low-poly" look of early WoW props.
 */
export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = []
  private rnd: () => number

  constructor(seed = 1) {
    this.rnd = mulberry32(seed)
  }

  random(min = 0, max = 1) {
    return min + (max - min) * this.rnd()
  }

  /**
   * Add a primitive. `jitter` randomly displaces vertices for an irregular,
   * hand-sculpted feel; `colorVar` adds per-face brightness variation.
   */
  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    opts: {
      pos?: [number, number, number]
      rot?: [number, number, number]
      scale?: [number, number, number] | number
      jitter?: number
      colorVar?: number
    } = {},
  ): this {
    let g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')

    if (opts.jitter) {
      // Jitter by quantised position so shared corners stay welded.
      const pos = g.attributes.position as THREE.BufferAttribute
      const offsets = new Map<string, [number, number, number]>()
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
        let o = offsets.get(key)
        if (!o) {
          const j = opts.jitter
          o = [this.random(-j, j), this.random(-j, j), this.random(-j, j)]
          offsets.set(key, o)
        }
        pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2])
      }
    }

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot ?? [0, 0, 0])))
    const s = opts.scale ?? 1
    const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s)
    m.compose(new THREE.Vector3(...(opts.pos ?? [0, 0, 0])), q, sv)
    g.applyMatrix4(m)

    const base = new THREE.Color(color)
    const count = g.attributes.position.count
    const colors = new Float32Array(count * 3)
    const cv = opts.colorVar ?? 0.06
    const c = new THREE.Color()
    for (let f = 0; f < count; f += 3) {
      const k = 1 + this.random(-cv, cv)
      c.copy(base).multiplyScalar(k)
      for (let v = 0; v < 3; v++) {
        colors[(f + v) * 3] = c.r
        colors[(f + v) * 3 + 1] = c.g
        colors[(f + v) * 3 + 2] = c.b
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.parts.push(g)
    return this
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)
    if (!merged) throw new Error('mergeGeometries failed')
    for (const p of this.parts) p.dispose()
    merged.computeVertexNormals() // non-indexed → flat normals
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

// Primitive shortcuts.
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
export const cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg)
export const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg)
export const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail)
export const dodeca = (r: number) => new THREE.DodecahedronGeometry(r, 0)
export const sphere = (r: number, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h)
export const torus = (r: number, t: number) => new THREE.TorusGeometry(r, t, 4, 8)

/** Triangular prism (gable roof). Width along X, height Y, depth Z. */
export function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(w / 2, 0)
  shape.lineTo(0, h)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false })
  g.translate(0, 0, -d / 2)
  return g
}
