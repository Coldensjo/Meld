// A copy-on-write snapshot of a 2D array, saved block by block, for recording what a stroke changes.
// Only the blocks a stroke is about to write are copied, so starting a stroke on a large map no longer
// copies the whole weights array (268 MB for a 16-tile region). Kept free of three.js and the terrain
// class so it can be tested on its own.

/** An inclusive rect of cells (vertices or texels). */
export interface SnapRect {
  x0: number
  z0: number
  x1: number
  z1: number
}

type Grid = Float32Array | Uint8Array

/**
 * Snapshots `src`, a row-major `width` by `height` grid with `channels` values per cell, in square blocks
 * of `block` cells. `reserve` copies the blocks under a rect before they are written; `extract` then
 * reads what a rect held, from the copies where there are any and from `src` elsewhere, which is the
 * same thing for blocks nothing wrote.
 */
export class BlockSnapshot<T extends Grid> {
  private blocks = new Map<number, T>()
  private readonly src: T
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly block: number
  /** Blocks across the grid. */
  private readonly cols: number

  constructor(src: T, width: number, height: number, channels: number, block: number) {
    this.src = src
    this.width = width
    this.height = height
    this.channels = channels
    this.block = block
    this.cols = Math.ceil(width / block)
  }

  /** How many blocks are saved. */
  get size() {
    return this.blocks.size
  }

  private clip(r: SnapRect): SnapRect | null {
    const c = { x0: Math.max(0, r.x0), z0: Math.max(0, r.z0), x1: Math.min(this.width - 1, r.x1), z1: Math.min(this.height - 1, r.z1) }
    return c.x1 < c.x0 || c.z1 < c.z0 ? null : c
  }

  /** Saves the blocks under `rect` that are not saved yet. Call it before writing them. */
  reserve(rect: SnapRect) {
    const r = this.clip(rect)
    if (!r) return
    const b = this.block
    for (let bz = Math.floor(r.z0 / b); bz <= Math.floor(r.z1 / b); bz++) {
      for (let bx = Math.floor(r.x0 / b); bx <= Math.floor(r.x1 / b); bx++) {
        const key = bz * this.cols + bx
        if (!this.blocks.has(key)) this.blocks.set(key, this.copyBlock(bx, bz))
      }
    }
  }

  /** Whether every block under `rect` is saved. */
  covers(rect: SnapRect): boolean {
    const r = this.clip(rect)
    if (!r) return true
    const b = this.block
    for (let bz = Math.floor(r.z0 / b); bz <= Math.floor(r.z1 / b); bz++) {
      for (let bx = Math.floor(r.x0 / b); bx <= Math.floor(r.x1 / b); bx++) {
        if (!this.blocks.has(bz * this.cols + bx)) return false
      }
    }
    return true
  }

  private copyBlock(bx: number, bz: number): T {
    const b = this.block
    const w = Math.min(b, this.width - bx * b)
    const h = Math.min(b, this.height - bz * b)
    const ch = this.channels
    const out = new (this.src.constructor as new (n: number) => T)(w * h * ch)
    for (let z = 0; z < h; z++) {
      const s = ((bz * b + z) * this.width + bx * b) * ch
      out.set(this.src.subarray(s, s + w * ch) as T, z * w * ch)
    }
    return out
  }

  /**
   * The values `rect` (clipped to the grid) held when its blocks were saved: row-major over the clipped
   * rect, `channels` per cell. Blocks never saved are read from the live array.
   */
  extract(rect: SnapRect): T {
    const r = this.clip(rect)
    const ch = this.channels
    if (!r) return new (this.src.constructor as new (n: number) => T)(0)
    const w = r.x1 - r.x0 + 1
    const h = r.z1 - r.z0 + 1
    const out = new (this.src.constructor as new (n: number) => T)(w * h * ch)
    const b = this.block
    const bx0 = Math.floor(r.x0 / b)
    const bx1 = Math.floor(r.x1 / b)
    for (let z = r.z0; z <= r.z1; z++) {
      const bz = Math.floor(z / b)
      const dstRow = (z - r.z0) * w * ch
      for (let bx = bx0; bx <= bx1; bx++) {
        const xs = Math.max(r.x0, bx * b)
        const bw = Math.min(b, this.width - bx * b)
        const xe = Math.min(r.x1, bx * b + bw - 1)
        const n = (xe - xs + 1) * ch
        const saved = this.blocks.get(bz * this.cols + bx)
        let seg: T
        if (saved) {
          const s = ((z - bz * b) * bw + (xs - bx * b)) * ch
          seg = saved.subarray(s, s + n) as T
        } else {
          const s = (z * this.width + xs) * ch
          seg = this.src.subarray(s, s + n) as T
        }
        out.set(seg, dstRow + (xs - r.x0) * ch)
      }
    }
    return out
  }

  /** Drops the saved blocks. */
  clear() {
    this.blocks.clear()
  }
}
