// The client's baked terrain shadows (each chunk's MCSH, B-173): a bit per texel, 64 texels a chunk
// (8 a cell), rows running south, bit n of a byte the texel n columns into it, as Go stitches them for a
// region (vmangos.RegionShadows). The client darkens shadowed ground to 70% of its light (Benilla's
// terrain.wgsl, after the client's terrainp_s.bls: diffuse x (0.3 x lit + 0.7)).

/** How much of its light a shadowed texel keeps. */
export const BAKED_SHADOW_LIGHT = 0.7

/** Unpacks the bits into a byte per texel (255 in shadow, 0 lit), `side` texels a side, for an R8 texture. */
export function unpackShadowBits(bits: Uint8Array, side: number): Uint8Array {
  const out = new Uint8Array(side * side)
  for (let i = 0; i < out.length; i++) if ((bits[i >> 3] >> (i & 7)) & 1) out[i] = 255
  return out
}

/** Shadow texels per cell side: a chunk's 64, as MCSH has them (8 cells a chunk). */
export const SHADOW_PER_CELL = 8

/** A chunk's shadow map in the client's form: 64 rows of 8 bytes, bit n the texel n columns into its byte. */
export const CHUNK_SHADOW_BYTES = 512

/** Packs a byte per texel (in shadow from 128) into a bit per texel, as unpackShadowBits reads them. */
export function packShadowBits(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 8))
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 128) out[i >> 3] |= 1 << (i & 7)
  return out
}

/** The shadow map of paint chunk (cx, cz) in the client's form, from a byte per texel `side` a side. */
export function chunkShadowBits(shadow: Uint8Array, side: number, cx: number, cz: number): Uint8Array {
  const out = new Uint8Array(CHUNK_SHADOW_BYTES)
  const n = SHADOW_PER_CELL * 8
  for (let r = 0; r < n; r++) {
    const row = (cz * n + r) * side + cx * n
    for (let c = 0; c < n; c++) if (shadow[row + c] >= 128) out[r * 8 + (c >> 3)] |= 1 << (c & 7)
  }
  return out
}

/** Cells a side of the blocks the bake skips over when its ray is above their highest ground. */
const BLOCK = 4

/** A rect of shadow texels, inclusive. */
export interface ShadowRect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/**
 * Bakes the ground's shadows from the sun into `out` (a byte per texel, `size * SHADOW_PER_CELL` a
 * side, 255 in shadow) over the texels of `rect`: a texel is in shadow when the ground rises above the
 * line from it toward the sun. `sun` points toward the sun in editor space (y up). Only the ground
 * casts: models (trees, buildings) don't, while Blizzard's own maps often shadow under them too.
 * Returns how many texels changed.
 */
export function bakeShadows(heights: Float32Array, size: number, cellSize: number, sun: readonly number[], rect: ShadowRect, out: Uint8Array): number {
  const side = size * SHADOW_PER_CELL
  const verts = size + 1
  let top = -Infinity
  for (let i = 0; i < heights.length; i++) if (heights[i] > top) top = heights[i]
  const flat = Math.hypot(sun[0], sun[2])
  const lit = sun[1] <= 0 || flat < 1e-6
  // Along the ground toward the sun (ux, uz), rising `slope` a yard; fine steps of a quarter cell.
  const ux = lit ? 0 : sun[0] / flat
  const uz = lit ? 0 : sun[2] / flat
  const slope = lit ? 0 : sun[1] / flat
  const step = cellSize / 4
  const world = size * cellSize
  // The highest ground of each block of BLOCK cells: a ray above it skips the block in one step.
  const nb = Math.ceil(size / BLOCK)
  const blockMax = new Float32Array(nb * nb).fill(-Infinity)
  for (let vz = 0; vz < verts; vz++) {
    for (let vx = 0; vx < verts; vx++) {
      const h = heights[vz * verts + vx]
      // A vertex on a block edge bounds the blocks on both sides.
      for (let bz = Math.max(0, Math.ceil(vz / BLOCK) - 1); bz <= Math.min(nb - 1, Math.floor(vz / BLOCK)); bz++) {
        for (let bx = Math.max(0, Math.ceil(vx / BLOCK) - 1); bx <= Math.min(nb - 1, Math.floor(vx / BLOCK)); bx++) {
          const k = bz * nb + bx
          if (h > blockMax[k]) blockMax[k] = h
        }
      }
    }
  }
  const blockWorld = BLOCK * cellSize
  const height = (x: number, z: number) => {
    const fx = x / cellSize
    const fz = z / cellSize
    const x0 = Math.min(Math.floor(fx), size - 1)
    const z0 = Math.min(Math.floor(fz), size - 1)
    const tx = fx - x0
    const tz = fz - z0
    const a = heights[z0 * verts + x0]
    const b = heights[z0 * verts + x0 + 1]
    const c = heights[(z0 + 1) * verts + x0]
    const e = heights[(z0 + 1) * verts + x0 + 1]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz
  }
  let changed = 0
  const texel = cellSize / SHADOW_PER_CELL
  for (let tz = rect.z0; tz <= rect.z1; tz++) {
    for (let tx = rect.x0; tx <= rect.x1; tx++) {
      let shadow = false
      if (!lit) {
        let x = (tx + 0.5) * texel
        let z = (tz + 0.5) * texel
        // A little above the ground, so a slope doesn't shadow itself.
        let y = height(x, z) + 0.05
        for (;;) {
          let d = step
          const bx = Math.min(nb - 1, Math.floor(x / blockWorld))
          const bz = Math.min(nb - 1, Math.floor(z / blockWorld))
          if (y > blockMax[bz * nb + bx]) {
            // Above the whole block: on to where the ray leaves it.
            const ex = ux > 0 ? ((bx + 1) * blockWorld - x) / ux : ux < 0 ? (bx * blockWorld - x) / ux : Infinity
            const ez = uz > 0 ? ((bz + 1) * blockWorld - z) / uz : uz < 0 ? (bz * blockWorld - z) / uz : Infinity
            d = Math.max(step, Math.min(ex, ez) + 1e-3)
          }
          x += ux * d
          z += uz * d
          y += slope * d
          if (y > top || x < 0 || z < 0 || x > world || z > world) break
          if (height(x, z) > y) {
            shadow = true
            break
          }
        }
      }
      const i = tz * side + tx
      const v = shadow ? 255 : 0
      if (out[i] !== v) {
        out[i] = v
        changed++
      }
    }
  }
  return changed
}
