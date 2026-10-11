import * as THREE from 'three'
import type { adt } from '../../../wailsjs/go/models'

/** Surface colours, by the liquid kinds of the chunk flags: river or lake, ocean, magma, slime. */
const KIND_COLORS: Array<[number, number]> = [
  [0x04, 0x3a8fc4],
  [0x08, 0x1d4f8a],
  [0x10, 0xd9531e],
  [0x20, 0x6fbf3a],
]
const DEFAULT_COLOR = 0x3a8fc4

const VERTS = 9
const CELLS = 8

/**
 * The water of a region's chunks as one mesh: a quad for each covered cell, at the surface heights
 * the client stores. Each chunk's cells sit at its place in the block, so the water lies on the
 * ground the terrain shows. Returns null when no cell is covered.
 */
export function liquidMesh(liquids: adt.Liquid[], cellSize: number): THREE.Mesh | null {
  let quads = 0
  for (const l of liquids) for (const c of l.cells) if (c) quads++
  if (quads === 0) return null

  const pos = new Float32Array(quads * 6 * 3)
  const col = new Float32Array(quads * 6 * 3)
  const color = new THREE.Color()
  let p = 0
  let k = 0
  for (const l of liquids) {
    const kind = KIND_COLORS.find(([bit]) => (l.kind & bit) !== 0)?.[1] ?? DEFAULT_COLOR
    color.setHex(kind)
    const x0 = l.indexX * CELLS
    const z0 = l.indexY * CELLS
    for (let r = 0; r < CELLS; r++) {
      for (let c = 0; c < CELLS; c++) {
        if (!l.cells[r * CELLS + c]) continue
        // The cell's four corners: (row, column) on the chunk's 9x9 vertex grid.
        const corner = (vr: number, vc: number) => {
          const v = vr * VERTS + vc
          return [(x0 + vc) * cellSize, l.heights[v], (z0 + vr) * cellSize] as const
        }
        const a = corner(r, c)
        const b = corner(r, c + 1)
        const d = corner(r + 1, c)
        const e = corner(r + 1, c + 1)
        for (const v of [a, d, b, b, d, e]) {
          pos[p++] = v[0]
          pos[p++] = v[1]
          pos[p++] = v[2]
          // Each vertex carries the kind's colour, so one mesh shows every liquid.
          col[k] = color.r
          col[k + 1] = color.g
          col[k + 2] = color.b
          k += 3
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geometry.computeVertexNormals()
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'liquids'
  return mesh
}
