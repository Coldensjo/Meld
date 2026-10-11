import * as THREE from 'three'
import { fetchImage } from '../wow/api'

// The map's texture palette as one array texture: layer i is palette entry i. Each entry is a WoW
// tileset path, or a '#rrggbb' colour that stands in for a texture while none is set. WoW
// textures are resampled to PALETTE_RES, so one array holds them all.

export const PALETTE_RES = 256

/** Colour entries are '#' followed by six hex digits. */
export function isColor(entry: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(entry)
}

/** Layers the array is allocated with, in powers of two so it only grows now and then. */
function depthFor(count: number): number {
  let d = 8
  while (d < count) d *= 2
  return d
}

function solid(hex: string): Uint8Array {
  const n = PALETTE_RES * PALETTE_RES
  const out = new Uint8Array(n * 4)
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  for (let i = 0; i < n; i++) {
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

/** Nearest-neighbour resample of RGBA pixels to PALETTE_RES square. */
function resample(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(PALETTE_RES * PALETTE_RES * 4)
  for (let y = 0; y < PALETTE_RES; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / PALETTE_RES))
    for (let x = 0; x < PALETTE_RES; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / PALETTE_RES))
      const s = (sy * w + sx) * 4
      const d = (y * PALETTE_RES + x) * 4
      out[d] = pixels[s]
      out[d + 1] = pixels[s + 1]
      out[d + 2] = pixels[s + 2]
      out[d + 3] = pixels[s + 3]
    }
  }
  return out
}

export class PaletteArray {
  /** The array texture the terrain shader samples. Replaced when the palette outgrows it. */
  texture: THREE.DataArrayTexture
  private data: Uint8Array
  private paths: string[] = []
  /** Resampled pixels of every entry loaded so far, by entry. */
  private loaded = new Map<string, Uint8Array>()
  private loading = new Set<string>()

  /** Called with the new texture whenever it's replaced, so the material can pick it up. */
  constructor(private onReplace: (t: THREE.DataArrayTexture) => void) {
    this.data = new Uint8Array(PALETTE_RES * PALETTE_RES * 4 * 8).fill(128)
    this.texture = this.make(8)
  }

  get entries(): readonly string[] {
    return this.paths
  }

  /** Sets the palette. Entries keep their index; a new entry's texture loads in the background. */
  set(paths: string[]) {
    this.paths = paths.slice()
    const depth = depthFor(Math.max(1, paths.length))
    if (depth !== this.texture.depth) {
      this.texture.dispose()
      this.texture = this.make(depth)
      this.onReplace(this.texture)
    }
    paths.forEach((p, i) => this.fill(i, p))
    this.texture.needsUpdate = true
  }

  private make(depth: number): THREE.DataArrayTexture {
    this.data = new Uint8Array(PALETTE_RES * PALETTE_RES * 4 * depth).fill(128)
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255
    const t = new THREE.DataArrayTexture(this.data, PALETTE_RES, PALETTE_RES, depth)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    // Re-fill from the cache: a new array starts grey.
    this.paths.forEach((p, i) => {
      const px = this.loaded.get(p)
      if (px) this.write(i, px)
    })
    return t
  }

  private write(layer: number, px: Uint8Array) {
    if (layer >= this.texture.depth) return
    this.data.set(px, layer * PALETTE_RES * PALETTE_RES * 4)
  }

  private fill(layer: number, path: string) {
    if (!path) return
    const px = this.loaded.get(path)
    if (px) {
      this.write(layer, px)
      return
    }
    if (isColor(path)) {
      const c = solid(path)
      this.loaded.set(path, c)
      this.write(layer, c)
      return
    }
    if (this.loading.has(path)) return
    this.loading.add(path)
    fetchImage(path)
      .then((img) => {
        this.loading.delete(path)
        const px = resample(img.pixels, img.width, img.height)
        this.loaded.set(path, px)
        // Every layer that shows this path gets it, whichever slot it sits in now.
        this.paths.forEach((p, i) => {
          if (p === path) this.write(i, px)
        })
        this.texture.needsUpdate = true
      })
      .catch(() => {
        this.loading.delete(path)
        // Keep the grey placeholder and drop the failed path from the cache so it can be retried.
      })
  }

  dispose() {
    this.texture.dispose()
  }
}
