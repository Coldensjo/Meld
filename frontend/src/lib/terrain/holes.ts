/**
 * Holes in the ground: one byte per terrain cell, non-zero where the cell is cut out (a cave mouth, a
 * pit into a building's basement). A cell is two triangles, and a hole can be either of them:
 *
 *   0  solid
 *   1  the whole cell (both triangles; what the client's holes and older maps say)
 *   2  only the first triangle
 *   3  only the second triangle
 *
 * The first triangle is the one written first by writeCellIndex: on a cell whose x+z is odd the
 * diagonal runs from (1,0) to (0,1) and the first triangle holds the (0,0) corner; on an even cell
 * it runs from (0,0) to (1,1) and the first triangle holds the (0,1) corner. A hole triangle is not
 * drawn and the cursor's ray passes through it.
 */

export const HOLE_NONE = 0
export const HOLE_CELL = 1
export const HOLE_FIRST = 2
export const HOLE_SECOND = 3

/** Which triangle (1 or 2) of cell (x, z) the point at local fraction (fx, fz) of the cell lies in. */
export function holeTriangle(x: number, z: number, fx: number, fz: number): 1 | 2 {
  return ((x + z) & 1 ? fx + fz < 1 : fz > fx) ? 1 : 2
}

/** Whether triangle `tri` of a cell with hole value `v` is cut out. */
export const triangleIsHole = (v: number, tri: 1 | 2) => v === HOLE_CELL || v === (tri === 1 ? HOLE_FIRST : HOLE_SECOND)

/** The hole value of a cell now `v` with triangle `tri` cut (`hole` true) or restored. */
export function withTriangle(v: number, tri: 1 | 2, hole: boolean): number {
  const first = tri === 1 ? hole : triangleIsHole(v, 1)
  const second = tri === 2 ? hole : triangleIsHole(v, 2)
  return first && second ? HOLE_CELL : first ? HOLE_FIRST : second ? HOLE_SECOND : HOLE_NONE
}

/**
 * Writes the triangle indices of a render chunk into `idx`, leaving out the cells that are holes, and
 * returns how many indices were written. The chunk is `cells` x `cellsZ` cells starting at map cell
 * (ox, oz), with `vx` vertices a row; `holes` is the map's hole byte per cell, `size` cells a side.
 * Diagonals alternate per cell so the surface doesn't look combed.
 */
export function writeCellIndex(
  idx: Uint32Array,
  cells: number,
  cellsZ: number,
  vx: number,
  ox: number,
  oz: number,
  holes: Uint8Array,
  size: number,
): number {
  let k = 0
  for (let z = 0; z < cellsZ; z++) {
    for (let x = 0; x < cells; x++) {
      const v = holes[(oz + z) * size + ox + x]
      if (v === HOLE_CELL) continue
      const a = z * vx + x
      const b = a + 1
      const c = a + vx
      const d = c + 1
      const first = v !== HOLE_FIRST
      const second = v !== HOLE_SECOND
      if ((x + z) & 1) {
        if (first) { idx[k++] = a; idx[k++] = c; idx[k++] = b }
        if (second) { idx[k++] = b; idx[k++] = c; idx[k++] = d }
      } else {
        if (first) { idx[k++] = a; idx[k++] = c; idx[k++] = d }
        if (second) { idx[k++] = a; idx[k++] = d; idx[k++] = b }
      }
    }
  }
  return k
}

/**
 * Sets the cells of the rect (x0..x1, z0..z1 as cell corners, exclusive at x1/z1, clipped to the map)
 * to `value`. Returns the number of cells that changed.
 */
export function fillHoles(holes: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number, value: 0 | 1): number {
  const cx0 = Math.max(0, x0)
  const cz0 = Math.max(0, z0)
  const cx1 = Math.min(size, x1)
  const cz1 = Math.min(size, z1)
  let n = 0
  for (let z = cz0; z < cz1; z++) {
    for (let x = cx0; x < cx1; x++) {
      const i = z * size + x
      if (holes[i] !== value) {
        holes[i] = value
        n++
      }
    }
  }
  return n
}

/** How many cells of the rect (cell corners, exclusive at x1/z1) are holes, a half-cut cell counting as one. */
export function countHoles(holes: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number): number {
  let n = 0
  for (let z = Math.max(0, z0); z < Math.min(size, z1); z++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) if (holes[z * size + x]) n++
  }
  return n
}
