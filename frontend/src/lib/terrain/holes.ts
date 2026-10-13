/**
 * Holes in the ground: one byte per terrain cell, 1 where the cell is cut out (a cave mouth, a pit
 * into a building's basement). A hole cell draws no triangles and the cursor's ray passes through it.
 */

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
      if (holes[(oz + z) * size + ox + x]) continue
      const a = z * vx + x
      const b = a + 1
      const c = a + vx
      const d = c + 1
      if ((x + z) & 1) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b
        idx[k++] = b; idx[k++] = c; idx[k++] = d
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d
        idx[k++] = a; idx[k++] = d; idx[k++] = b
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

/** How many cells of the rect (cell corners, exclusive at x1/z1) are holes. */
export function countHoles(holes: Uint8Array, size: number, x0: number, z0: number, x1: number, z1: number): number {
  let n = 0
  for (let z = Math.max(0, z0); z < Math.min(size, z1); z++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) n += holes[z * size + x]
  }
  return n
}
