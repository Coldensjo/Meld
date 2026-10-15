// Sculpt › Blur, after Noggit Red's blur (`MapChunk::blurTerrain`): each vertex under the brush moves
// toward the average of the heights around it, weighted down linearly to nothing at a radius as wide as
// the brush, so it evens out a whole hillside where Smooth only rubs out bumps a cell wide. Noggit Red
// weighs by the round distance; Meld uses the same falloff along x and then along z (a separable tent),
// which is the same blur to within a few percent and costs the brush's width per vertex, not its area.
// Kept free of three.js so it can be tested on its own.

/** An inclusive vertex rect. */
export interface VertexRect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/**
 * Writes into `out` (indexed like `src`, `verts` a row) the blurred height of every vertex in `r`: a tent
 * of `radius` vertices along x, then along z, over `src`, clamped to the map. `tmp` is scratch space;
 * a bigger one is returned when it was too small, for the caller to keep.
 */
export function tentBlur(src: Float32Array, verts: number, r: VertexRect, radius: number, out: Float32Array, tmp: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const R = Math.max(1, Math.round(radius))
  const zz0 = Math.max(0, r.z0 - R)
  const zz1 = Math.min(verts - 1, r.z1 + R)
  const w = r.x1 - r.x0 + 1
  const need = w * (zz1 - zz0 + 1)
  if (tmp.length < need) tmp = new Float32Array(need)
  // Along x, for every row the second pass reads.
  for (let z = zz0; z <= zz1; z++) {
    const row = z * verts
    for (let x = r.x0; x <= r.x1; x++) {
      let sum = 0
      let wt = 0
      for (let d = -R; d <= R; d++) {
        const xx = x + d
        if (xx < 0 || xx >= verts) continue
        const k = 1 - Math.abs(d) / (R + 1)
        sum += src[row + xx] * k
        wt += k
      }
      tmp[(z - zz0) * w + (x - r.x0)] = sum / wt
    }
  }
  // Along z.
  for (let z = r.z0; z <= r.z1; z++) {
    for (let x = r.x0; x <= r.x1; x++) {
      let sum = 0
      let wt = 0
      for (let d = -R; d <= R; d++) {
        const zz = z + d
        if (zz < zz0 || zz > zz1) continue
        const k = 1 - Math.abs(d) / (R + 1)
        sum += tmp[(zz - zz0) * w + (x - r.x0)] * k
        wt += k
      }
      out[z * verts + x] = sum / wt
    }
  }
  return tmp
}
