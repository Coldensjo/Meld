// Texture painting in the 1.12 style: the map is split into chunks of CHUNK_CELLS cells (the
// server's MCNK chunks), and each chunk uses at most SLOTS textures. Every texel of a chunk
// blends the same textures, so a finished map exports as game chunks with no conversion.
//
// This module is plain data handling with no rendering dependency, so the rules can be tested
// on their own (see chunkPaint.test.ts).

/** A chunk is 8x8 cells, as in the 1.12 terrain format. */
export const CHUNK_CELLS = 8
/** Textures per chunk: the four layers 1.12 allows in one chunk. */
export const SLOTS = 4
/** Palette index meaning "no texture in this slot". */
export const NO_TEXTURE = 255
/** Palette entries a map can hold (indices 0 to 254). */
export const MAX_PALETTE = 255
/** Splat texels per cell along each side. */
export const SPLAT_PER_CELL = 4

/** Chunks along one side of a map. The map's size must be a multiple of CHUNK_CELLS. */
export function chunksPerSide(size: number): number {
  return size / CHUNK_CELLS
}

/** Index of the chunk holding the cell (or texel, once scaled) at (x, z). */
export function chunkOf(x: number, z: number, side: number): number {
  return z * side + x
}

/** The slot of chunk c that holds palette index tex, or -1. */
export function findSlot(slots: Uint8Array, c: number, tex: number): number {
  for (let k = 0; k < SLOTS; k++) if (slots[c * SLOTS + k] === tex) return k
  return -1
}

/**
 * The slot of chunk c that tex should paint into: its own slot if the chunk has it, else a free
 * one. Returns -1 when the chunk already has SLOTS other textures.
 */
export function acquireSlot(slots: Uint8Array, c: number, tex: number): number {
  const have = findSlot(slots, c, tex)
  if (have >= 0) return have
  for (let k = 0; k < SLOTS; k++) {
    if (slots[c * SLOTS + k] === NO_TEXTURE) {
      slots[c * SLOTS + k] = tex
      return k
    }
  }
  return -1
}

/** Makes the four weights of a texel sum to 255, adjusting the largest one by any rounding error. */
export function normalizeTexel(w: Uint8Array, base: number): void {
  let sum = 0
  for (let k = 0; k < SLOTS; k++) sum += w[base + k]
  if (sum === 255) return
  if (sum === 0) {
    w[base] = 255
    return
  }
  let largest = 0
  for (let k = 1; k < SLOTS; k++) if (w[base + k] > w[base + largest]) largest = k
  let total = 0
  for (let k = 0; k < SLOTS; k++) {
    w[base + k] = Math.round((w[base + k] * 255) / sum)
    total += w[base + k]
  }
  w[base + largest] = Math.max(0, Math.min(255, w[base + largest] + 255 - total))
}

/**
 * Adds `amount` (0 to 1) of slot k to the texel whose weights start at base, taking the weight
 * proportionally from the other slots so the four still sum to 255.
 */
export function addWeight(w: Uint8Array, base: number, k: number, amount: number): void {
  const cur = w[base + k]
  const next = Math.min(255, cur + amount * 255)
  let others = 0
  for (let j = 0; j < SLOTS; j++) if (j !== k) others += w[base + j]
  const scale = others > 0 ? (255 - next) / others : 0
  for (let j = 0; j < SLOTS; j++) {
    if (j === k) w[base + j] = Math.round(next)
    else w[base + j] = Math.round(w[base + j] * scale)
  }
  if (others === 0) w[base + k] = 255
  normalizeTexel(w, base)
}

/**
 * Packs per-texel weights over `roles` candidate textures into the chunk form: each chunk keeps
 * the SLOTS roles with the most weight in it, and each texel's weights are redistributed over them.
 * fill(x, z, out) writes the `roles` weights of texel (x, z), each on a 0-255 scale, into out. It's
 * called once per texel, a chunk at a time, so the whole map's weights never sit in memory at once.
 * res is the splat's texels a side and side the paint chunks a side.
 */
export function packRoles(
  side: number,
  res: number,
  roles: number,
  fill: (x: number, z: number, out: Float32Array) => void,
): { weights: Uint8Array; chunkSlots: Uint8Array } {
  const chunks = side * side
  const per = res / side
  const weights = new Uint8Array(res * res * SLOTS)
  const chunkSlots = new Uint8Array(chunks * SLOTS).fill(NO_TEXTURE)
  const chunkRoles = new Float32Array(per * per * roles)
  const texel = new Float32Array(roles)
  const totals = new Float32Array(roles)

  for (let c = 0; c < chunks; c++) {
    const cx = c % side
    const cz = Math.floor(c / side)
    totals.fill(0)
    for (let lz = 0; lz < per; lz++) {
      for (let lx = 0; lx < per; lx++) {
        fill(cx * per + lx, cz * per + lz, texel)
        const p = (lz * per + lx) * roles
        for (let r = 0; r < roles; r++) {
          chunkRoles[p + r] = texel[r]
          totals[r] += texel[r]
        }
      }
    }
    const picked = Array.from({ length: roles }, (_, r) => r)
      .filter((r) => totals[r] > 0)
      .sort((a, b) => totals[b] - totals[a])
      .slice(0, SLOTS)
    // A chunk nothing was painted in still needs a texture: the first palette entry.
    if (picked.length === 0) chunkSlots[c * SLOTS] = 0
    picked.forEach((r, k) => (chunkSlots[c * SLOTS + k] = r))

    for (let lz = 0; lz < per; lz++) {
      for (let lx = 0; lx < per; lx++) {
        const p = (lz * per + lx) * roles
        const base = ((cz * per + lz) * res + cx * per + lx) * SLOTS
        let sum = 0
        for (let k = 0; k < picked.length; k++) sum += chunkRoles[p + picked[k]]
        if (sum > 0) {
          for (let k = 0; k < picked.length; k++) weights[base + k] = Math.round((chunkRoles[p + picked[k]] * 255) / sum)
          normalizeTexel(weights, base)
        } else {
          weights[base] = 255
        }
      }
    }
  }
  return { weights, chunkSlots }
}

/**
 * Converts a map saved with eight global paint layers (format 1) to chunks. Each old layer is its
 * own palette index, so the palette keeps the layer order. The old splat is upsampled from
 * oldRes to res texels a side, and each chunk keeps its four strongest layers.
 */
export function convertGlobalLayers(
  side: number,
  res: number,
  oldRes: number,
  splatA: Uint8Array,
  splatB: Uint8Array,
): { weights: Uint8Array; chunkSlots: Uint8Array } {
  const layers = 8
  const scale = oldRes / res
  return packRoles(side, res, layers, (x, z, out) => {
    const o = (Math.floor(z * scale) * oldRes + Math.floor(x * scale)) * 4
    for (let k = 0; k < 4; k++) {
      out[k] = splatA[o + k]
      out[4 + k] = splatB[o + k]
    }
  })
}

/**
 * Share of the painted map each palette entry takes, sampled every few texels (0 to 1 per entry).
 * res is the splat's texels a side and side the paint chunks a side.
 */
export function paletteCoverage(
  weights: Uint8Array,
  chunkSlots: Uint8Array,
  res: number,
  side: number,
  entries: number,
): number[] {
  const out = new Array<number>(entries).fill(0)
  const per = res / side
  const step = 7
  let total = 0
  for (let t = 0; t < res * res; t += step) {
    const x = t % res
    const z = Math.floor(t / res)
    const c = chunkOf(Math.floor(x / per), Math.floor(z / per), side)
    for (let k = 0; k < SLOTS; k++) {
      const tex = chunkSlots[c * SLOTS + k]
      const w = weights[t * SLOTS + k]
      if (tex === NO_TEXTURE || tex >= entries || w === 0) continue
      out[tex] += w
      total += w
    }
  }
  return out.map((v) => (total > 0 ? v / total : 0))
}

/** Index of path in palette (case-insensitive), or -1. */
export function paletteIndex(palette: readonly string[], path: string): number {
  const want = path.toLowerCase()
  return palette.findIndex((p) => p.toLowerCase() === want)
}

/**
 * Replaces palette texture `from` with `to` across the whole map. A chunk that has `to` already folds
 * `from`'s weight into it; otherwise the slot is renamed. res is the splat's texels a side and side the
 * paint chunks a side.
 */
export function replacePalette(side: number, res: number, slots: Uint8Array, weights: Uint8Array, from: number, to: number): void {
  if (from === to) return
  const per = res / side
  for (let c = 0; c < side * side; c++) {
    const fromSlot = findSlot(slots, c, from)
    if (fromSlot < 0) continue
    const toSlot = findSlot(slots, c, to)
    if (toSlot < 0) {
      slots[c * SLOTS + fromSlot] = to
      continue
    }
    const cx = c % side
    const cz = Math.floor(c / side)
    for (let z = cz * per; z < (cz + 1) * per; z++) {
      for (let x = cx * per; x < (cx + 1) * per; x++) {
        const base = (z * res + x) * SLOTS
        weights[base + toSlot] = Math.min(255, weights[base + toSlot] + weights[base + fromSlot])
        weights[base + fromSlot] = 0
        normalizeTexel(weights, base)
      }
    }
    slots[c * SLOTS + fromSlot] = NO_TEXTURE
  }
}

/** Sets every chunk to one texture, fully painted, which is how a map starts. */
export function clearPalette(side: number, res: number, slots: Uint8Array, weights: Uint8Array, to = 0): void {
  slots.fill(NO_TEXTURE)
  for (let c = 0; c < side * side; c++) slots[c * SLOTS] = to
  for (let t = 0; t < res * res; t++) {
    weights[t * SLOTS] = 255
    weights[t * SLOTS + 1] = 0
    weights[t * SLOTS + 2] = 0
    weights[t * SLOTS + 3] = 0
  }
}

/**
 * Moves one texel's four weights toward the base texture (slot 0 at 255) by `f`, and keeps them
 * summing to 255. `o` is the texel's first weight in the array.
 */
export function resetTexel(w: Uint8Array, o: number, f: number) {
  for (let k = 0; k < SLOTS; k++) {
    const target = k === 0 ? 255 : 0
    w[o + k] = Math.round(w[o + k] + (target - w[o + k]) * f)
  }
  // Rounding can leave the four weights a unit off 255; the base takes the difference.
  w[o] += 255 - (w[o] + w[o + 1] + w[o + 2] + w[o + 3])
}
