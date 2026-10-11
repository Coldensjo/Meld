import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'

/** A palette entry that's a colour rather than a texture. */
const isColor = (entry: string) => /^#[0-9a-fA-F]{6}$/.test(entry)

// Splits a map into the 1.12 tiles the client and server read: each tile is 128 cells square, and the
// map's heights, paint and models are cut to fit them. The output is the Go side's MapSpec (see
// internal/vmangos/export.go), with the paint's weights as base64.

/** Cells in a 1.12 tile a side. */
export const TILE_CELLS = 128
/** Paint chunks in a tile a side. */
const CHUNKS_PER_TILE = TILE_CELLS / CHUNK_CELLS
/** Splat texels in a chunk a side. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

export interface ExportObject {
  /** 'm2:<path>' or 'wmo:<path>'. */
  type: string
  /** World position in yards, the map's own coordinates. */
  x: number
  y: number
  z: number
  rotY: number
  scale: number
}

export interface ExportInput {
  /** Cells a side of the map; a multiple of TILE_CELLS. */
  size: number
  /** Yards a cell. */
  cellSize: number
  /** (size+1)^2 heights. */
  heights: Float32Array
  /** SPLAT_PER_CELL * size texels a side, four weights per texel. */
  weights: Uint8Array
  /** Four palette indices per paint chunk, for the map's (size/CHUNK_CELLS) chunks a side. */
  chunkSlots: Uint8Array
  /** The palette: a WoW tileset path or a colour per index. */
  palette: readonly string[]
  objects: readonly ExportObject[]
}

export interface PaintOut {
  Chunk: number
  Textures: string[]
  Weights: string
}

export interface ObjectOut {
  Type: string
  X: number
  Y: number
  Z: number
  RotY: number
  Scale: number
}

export interface TileOut {
  X: number
  Y: number
  Outer: number[]
  Paint: PaintOut[]
  Objects: ObjectOut[]
}

export interface ExportOut {
  tiles: TileOut[]
  /** Chunks whose paint uses a colour rather than a texture, which the client can't show, so it isn't written. */
  colorChunks: number
  /** Models outside the map, which aren't written. */
  outside: number
}

/**
 * The map as tiles. Throws when the map's size doesn't cut into whole tiles. Every tile of the map
 * is written, since each one needs its file for the client to walk it.
 */
export function mapToTiles(input: ExportInput): ExportOut {
  if (input.size % TILE_CELLS !== 0) throw new Error(`the map is ${input.size} cells, not a whole number of 128-cell tiles`)
  const tilesPerSide = input.size / TILE_CELLS
  const V = input.size + 1
  const tileYards = TILE_CELLS * input.cellSize
  const splatRes = input.size * SPLAT_PER_CELL
  const paintSide = input.size / CHUNK_CELLS
  const tiles: TileOut[] = []
  let colorChunks = 0

  // Models, by the tile they stand in.
  const objectsOf = (tx: number, ty: number): ObjectOut[] =>
    input.objects
      .filter((o) => Math.floor(o.x / tileYards) === tx && Math.floor(o.z / tileYards) === ty)
      .map((o) => ({
        Type: o.type,
        X: o.x - tx * tileYards,
        Y: o.y,
        Z: o.z - ty * tileYards,
        RotY: o.rotY,
        Scale: o.scale,
      }))
  const extent = input.size * input.cellSize
  const outside = input.objects.filter((o) => o.x < 0 || o.z < 0 || o.x >= extent || o.z >= extent).length

  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const outer: number[] = new Array(129 * 129)
      for (let r = 0; r <= TILE_CELLS; r++) {
        for (let c = 0; c <= TILE_CELLS; c++) {
          outer[r * 129 + c] = input.heights[(ty * TILE_CELLS + r) * V + tx * TILE_CELLS + c]
        }
      }

      const paint: PaintOut[] = []
      for (let cy = 0; cy < CHUNKS_PER_TILE; cy++) {
        for (let cx = 0; cx < CHUNKS_PER_TILE; cx++) {
          const gx = tx * CHUNKS_PER_TILE + cx
          const gz = ty * CHUNKS_PER_TILE + cy
          const chunk = gz * paintSide + gx
          // The chunk's textures that are in use, in slot order. A slot without one is dropped.
          const used: number[] = []
          for (let k = 0; k < SLOTS; k++) {
            const i = input.chunkSlots[chunk * SLOTS + k]
            if (i !== NO_TEXTURE) used.push(k)
          }
          if (used.length === 0) continue
          const names = used.map((k) => input.palette[input.chunkSlots[chunk * SLOTS + k]] ?? '')
          if (names.some((n) => !n || isColor(n))) {
            colorChunks++
            continue
          }
          // Four weights per texel, in the used slots' order.
          const weights = new Uint8Array(TEXELS_PER_CHUNK * TEXELS_PER_CHUNK * SLOTS)
          for (let v = 0; v < TEXELS_PER_CHUNK; v++) {
            for (let u = 0; u < TEXELS_PER_CHUNK; u++) {
              const z = gz * TEXELS_PER_CHUNK + v
              const x = gx * TEXELS_PER_CHUNK + u
              const src = (z * splatRes + x) * SLOTS
              const dst = (v * TEXELS_PER_CHUNK + u) * SLOTS
              used.forEach((k, j) => (weights[dst + j] = input.weights[src + k]))
            }
          }
          paint.push({ Chunk: cy * CHUNKS_PER_TILE + cx, Textures: names, Weights: toBase64(weights) })
        }
      }

      tiles.push({ X: tx, Y: ty, Outer: outer, Paint: paint, Objects: objectsOf(tx, ty) })
    }
  }
  return { tiles, colorChunks, outside }
}

/** Base64 of bytes, in chunks, so large weight arrays don't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}
