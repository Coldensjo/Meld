import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'

// Ground effects, as the game grows them: each texture carries a GroundEffectTexture ID whose row
// names up to four detail models (grass tufts, flowers, pebbles) and a density, and a cell grows
// the effect of the texture that weighs most on it. The tables come from the client (Go,
// internal/vmangos/groundeffects.go); a map may give a texture an effect of its own. This module is
// the arithmetic; GroundEffectLayer draws it.

export interface GroundEffect {
  doodads: string[]
  density: number
  terrain: number
}

export interface GroundEffectTables {
  /** By GroundEffectTexture ID. */
  effects: Record<string, GroundEffect>
  /** The effect each tileset texture (lower-case path) carries in the client's tiles. */
  textures: Record<string, number>
}

/** A map's own choice of effect per texture path (0 for none), over what the client's tiles say. */
export type TextureEffects = Record<string, number>

/** The effect ID texture `path` grows: the map's own choice first, else what the client's tiles give it; 0 for none. */
export function effectFor(path: string, own: TextureEffects, tables: GroundEffectTables | null): number {
  if (path.startsWith('#')) return 0
  const mine = own[path]
  if (mine !== undefined) return mine
  return tables?.textures[path.toLowerCase()] ?? 0
}

/**
 * The slot (0..3) that weighs most over cell (cx, cz) of a map with `splatRes` texels a side, read
 * from the four weights per texel; -1 for an empty cell.
 */
export function cellPredominant(weights: Uint8Array, splatRes: number, cx: number, cz: number): number {
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  const x0 = cx * SPLAT_PER_CELL
  const z0 = cz * SPLAT_PER_CELL
  for (let z = z0; z < z0 + SPLAT_PER_CELL; z++) {
    let i = (z * splatRes + x0) * SLOTS
    for (let x = 0; x < SPLAT_PER_CELL; x++, i += SLOTS) {
      s0 += weights[i]
      s1 += weights[i + 1]
      s2 += weights[i + 2]
      s3 += weights[i + 3]
    }
  }
  if (s0 + s1 + s2 + s3 === 0) return -1
  let best = 0
  let max = s0
  if (s1 > max) (best = 1), (max = s1)
  if (s2 > max) (best = 2), (max = s2)
  if (s3 > max) best = 3
  return best
}

/** The palette index on top of cell (cx, cz), or NO_TEXTURE. */
export function cellTexture(weights: Uint8Array, chunkSlots: Uint8Array, splatRes: number, chunksPerSide: number, cx: number, cz: number): number {
  const k = cellPredominant(weights, splatRes, cx, cz)
  if (k < 0) return NO_TEXTURE
  const chunk = Math.floor(cz / CHUNK_CELLS) * chunksPerSide + Math.floor(cx / CHUNK_CELLS)
  return chunkSlots[chunk * SLOTS + k]
}

/** How many tufts a cell grows for an effect's density: the game's amount runs 0 to 24, mostly 8. */
export const MAX_TUFTS_PER_CELL = 16
/** The View menu's density: the share of the game's amount drawn per cell. */
export type DensityLevel = 'sparse' | 'normal' | 'full'
export const DENSITY_FACTORS: Record<DensityLevel, number> = { sparse: 0.25, normal: 0.5, full: 1 }
export function densityFactor(level: string): number {
  return DENSITY_FACTORS[level as DensityLevel] ?? DENSITY_FACTORS.normal
}
export function tuftsPerCell(density: number, factor = DENSITY_FACTORS.normal): number {
  return Math.min(MAX_TUFTS_PER_CELL, Math.max(0, Math.round(density * factor)))
}

/** A building's footprint: its position and turn on the map, and its box in its own space. */
export interface CoverBox {
  x: number
  z: number
  rotY: number
  scale: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/**
 * Marks in `out` (one byte per cell of a `cells`-a-side map) every cell whose centre lies inside one
 * of the boxes, as the game's tiles mark the cells under a building so no grass grows through its
 * floor. The bytes already set stay set.
 */
export function coverCells(boxes: readonly CoverBox[], cellSize: number, cells: number, out: Uint8Array) {
  for (const b of boxes) {
    const c = Math.cos(b.rotY)
    const s = Math.sin(b.rotY)
    // The box's reach on the map: the turned box's corners, so only the cells near it are tried.
    let lo = Infinity
    let hi = -Infinity
    let loZ = Infinity
    let hiZ = -Infinity
    for (const [lx, lz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) {
      const wx = b.x + (lx * c + lz * s) * b.scale
      const wz = b.z + (-lx * s + lz * c) * b.scale
      lo = Math.min(lo, wx)
      hi = Math.max(hi, wx)
      loZ = Math.min(loZ, wz)
      hiZ = Math.max(hiZ, wz)
    }
    const cx0 = Math.max(0, Math.floor(lo / cellSize))
    const cx1 = Math.min(cells - 1, Math.floor(hi / cellSize))
    const cz0 = Math.max(0, Math.floor(loZ / cellSize))
    const cz1 = Math.min(cells - 1, Math.floor(hiZ / cellSize))
    for (let cz = cz0; cz <= cz1; cz++) {
      const dz = (cz + 0.5) * cellSize - b.z
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * cellSize - b.x
        // The cell centre in the box's own space: turned back and unscaled.
        const lx = (dx * c - dz * s) / b.scale
        const lz = (dx * s + dz * c) / b.scale
        if (lx >= b.minX && lx <= b.maxX && lz >= b.minZ && lz <= b.maxZ) out[cz * cells + cx] = 1
      }
    }
  }
}

/**
 * The no-doodad bits (or the hole cells) of paint chunk (gx, gz) of a `cells`-a-side map from a per-cell map: one byte
 * per cell row, bit n for cell n, as the tile's header holds them; null when none is set.
 */
export function chunkNoEffect(blocked: Uint8Array, cells: number, gx: number, gz: number): number[] | null {
  let any = false
  const rows = new Array<number>(CHUNK_CELLS).fill(0)
  for (let r = 0; r < CHUNK_CELLS; r++) {
    const base = (gz * CHUNK_CELLS + r) * cells + gx * CHUNK_CELLS
    for (let c = 0; c < CHUNK_CELLS; c++) {
      if (blocked[base + c]) {
        rows[r] |= 1 << c
        any = true
      }
    }
  }
  return any ? rows : null
}

/** A hash of three integers to [0, 1), stable across frames so tufts stand still. */
export function hash01(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** One tuft of a cell: where in the cell (0..1 each way), which doodad, its turn and its size. */
export interface Tuft {
  u: number
  v: number
  doodad: number
  rotY: number
  scale: number
}

/**
 * The tufts of cell (cx, cz): `count` of them, spread over the cell at hashed spots, each one of
 * `doodads` models (hashed, so neighbours differ), turned at random and sized 0.85 to 1.15. Written
 * into `out[0..count)`, which is reused across cells.
 */
export function cellTufts(cx: number, cz: number, count: number, doodads: number, out: Tuft[]): number {
  for (let i = 0; i < count; i++) {
    const t = out[i] ?? (out[i] = { u: 0, v: 0, doodad: 0, rotY: 0, scale: 1 })
    // A jittered grid keeps tufts from piling up: each gets a sub-cell, then a random spot in it.
    const cols = count > 4 ? 3 : 2
    const col = i % cols
    const row = Math.floor(i / cols)
    const rows = Math.ceil(count / cols)
    t.u = (col + hash01(cx, cz, i * 4)) / cols
    t.v = (row + hash01(cx, cz, i * 4 + 1)) / rows
    t.doodad = Math.min(doodads - 1, Math.floor(hash01(cx, cz, i * 4 + 2) * doodads))
    t.rotY = hash01(cx, cz, i * 4 + 3) * Math.PI * 2
    t.scale = 0.85 + hash01(cz, cx, i) * 0.3
  }
  return count
}

/** The effect IDs the client's tiles use, with how many textures use each, most used first, for a chooser. */
export function knownEffects(tables: GroundEffectTables): Array<{ id: number; uses: number }> {
  const uses = new Map<number, number>()
  for (const id of Object.values(tables.textures)) if (id && tables.effects[id]) uses.set(id, (uses.get(id) ?? 0) + 1)
  return [...uses].map(([id, n]) => ({ id, uses: n })).sort((a, b) => b.uses - a.uses || a.id - b.id)
}
