// The far horizon's mesh (B-167): a map's WDL tiles around the open block, meshed as the client meshes
// them (Benilla's wdl.rs, MIT/Apache): per tile 17x17 heights at the chunk corners and 16x16 at the
// chunk centres, each chunk a fan of four triangles about its centre. Kept free of three.js so it can
// be tested on its own.

/** A tile of the horizon: where it lies in tiles from the block's first tile, and its WDL heights. */
export interface HorizonTile {
  dx: number
  dy: number
  heights: number[]
}

const OUTER = 17
const INNER = 16
const VERTS = OUTER * OUTER + INNER * INNER

/** The tiles' vertices (x, height, z in the block's frame) and triangles, facing up. `tileYards` is a tile's width. */
export function horizonMesh(tiles: readonly HorizonTile[], tileYards: number): { positions: Float32Array; indices: Uint32Array } {
  const chunk = tileYards / INNER
  const positions = new Float32Array(tiles.length * VERTS * 3)
  const indices = new Uint32Array(tiles.length * INNER * INNER * 12)
  let p = 0
  let q = 0
  tiles.forEach((t, k) => {
    const x0 = t.dx * INNER
    const z0 = t.dy * INNER
    for (let r = 0; r < OUTER; r++) {
      for (let c = 0; c < OUTER; c++) {
        positions[p++] = (x0 + c) * chunk
        positions[p++] = t.heights[r * OUTER + c]
        positions[p++] = (z0 + r) * chunk
      }
    }
    for (let r = 0; r < INNER; r++) {
      for (let c = 0; c < INNER; c++) {
        positions[p++] = (x0 + c + 0.5) * chunk
        positions[p++] = t.heights[OUTER * OUTER + r * INNER + c]
        positions[p++] = (z0 + r + 0.5) * chunk
      }
    }
    const base = k * VERTS
    for (let r = 0; r < INNER; r++) {
      for (let c = 0; c < INNER; c++) {
        const ctr = base + OUTER * OUTER + r * INNER + c
        const tl = base + r * OUTER + c
        const tr = tl + 1
        const bl = tl + OUTER
        const br = bl + 1
        // Counter-clockwise seen from above (x east, z south): north, east, south, west.
        indices.set([ctr, tr, tl, ctr, br, tr, ctr, bl, br, ctr, tl, bl], q)
        q += 12
      }
    }
  })
  return { positions, indices }
}
