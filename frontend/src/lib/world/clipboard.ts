import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from './ObjectLayer'
import type { Command } from '../state/history'
import { TerrainStroke, type Rect } from '../tools/brush'
import {
  CHUNK_CELLS,
  MAX_PALETTE,
  NO_TEXTURE,
  SLOTS,
  SPLAT_PER_CELL,
  acquireSlot,
  chunkOf,
  normalizeTexel,
  paletteIndex,
} from '../terrain/chunkPaint'

/** A rectangular piece of a map, copied for pasting into any open map. */
export interface MapClip {
  /** Size in cells. */
  w: number
  h: number
  /** (w+1)*(h+1) vertex heights. */
  heights: Float32Array
  /** w*h cells: 1 where the ground is a hole. */
  holes: Uint8Array
  /** Splat texels (SPLAT_PER_CELL per cell): SLOTS weights per texel. */
  weights: Uint8Array
  /** SLOTS indices into `palette` per texel (NO_TEXTURE where the slot is empty). */
  slots: Uint8Array
  /** The textures the clip uses, indexed as in `slots`. Copied with the clip, so paste works across maps. */
  palette: string[]
  /**
   * Objects: roots have positions relative to the clip's corner; attached
   * objects keep their local transform and reference their parent by `cid`.
   */
  objects: Array<Omit<WorldObject, 'id' | 'parent'> & { cid: number; cparent?: number }>
}

export interface PasteOptions {
  terrain: boolean
  textures: boolean
  objects: boolean
  /** Cells over which the pasted edge fades into the existing map (0 = hard). */
  blend: number
  heightOffset: number
}

/** A stand-in colour for a clip texture that isn't in the palette it came from. */
const MISSING = '#808080'

/** Splat texels per paint chunk along one side. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

/** Copy the cell rect (inclusive vertex corners x0..x1, z0..z1). */
export function copyRegion(terrain: Terrain, objects: ObjectLayer, r: Rect, palette: readonly string[]): MapClip {
  const w = r.x1 - r.x0
  const h = r.z1 - r.z0
  const V = terrain.verts
  const heights = new Float32Array((w + 1) * (h + 1))
  for (let z = 0; z <= h; z++) {
    for (let x = 0; x <= w; x++) heights[z * (w + 1) + x] = terrain.heights[(r.z0 + z) * V + r.x0 + x]
  }
  const holes = new Uint8Array(w * h)
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) holes[z * w + x] = terrain.holes[(r.z0 + z) * terrain.size + r.x0 + x]
  }

  // Texels keep their own slots, which index a palette local to the clip, so the clip doesn't
  // depend on the map it came from.
  const T = SPLAT_PER_CELL
  const R = terrain.splatRes
  const side = terrain.paintChunksPerSide
  const tw = w * T
  const th = h * T
  const weights = new Uint8Array(tw * th * SLOTS)
  const slots = new Uint8Array(tw * th * SLOTS).fill(NO_TEXTURE)
  const clipPalette: string[] = []
  const localOf = new Map<number, number>()
  for (let z = 0; z < th; z++) {
    const gz = r.z0 * T + z
    for (let x = 0; x < tw; x++) {
      const gx = r.x0 * T + x
      const texel = gz * R + gx
      const chunk = chunkOf(Math.floor(gx / TEXELS_PER_CHUNK), Math.floor(gz / TEXELS_PER_CHUNK), side)
      for (let k = 0; k < SLOTS; k++) {
        const global = terrain.chunkSlots[chunk * SLOTS + k]
        const wt = terrain.weights[texel * SLOTS + k]
        if (global === NO_TEXTURE || wt === 0) continue
        let local = localOf.get(global)
        if (local === undefined) {
          local = clipPalette.length
          localOf.set(global, local)
          clipPalette.push(palette[global] ?? MISSING)
        }
        const i = (z * tw + x) * SLOTS + k
        slots[i] = local
        weights[i] = wt
      }
    }
  }

  const cs = terrain.cellSize
  const ox = r.x0 * cs
  const oz = r.z0 * cs
  const tmp = new THREE.Vector3()
  const picked = objects.list().filter((o) => {
    const p = objects.worldPosition(o, tmp)
    return p.x >= ox && p.x <= r.x1 * cs && p.z >= oz && p.z <= r.z1 * cs
  })
  const ids = new Set(picked.map((o) => o.id))
  const inside = picked.map((o) => {
    if (o.parent !== undefined && ids.has(o.parent)) {
      // Attached within the selection: keep the local transform.
      const { id, parent, ...rest } = o
      return { ...rest, cid: id, cparent: parent }
    }
    // Free-standing (or attached to something outside): store as a root.
    const w = objects.worldPlacement(o)
    return {
      type: o.type,
      cid: o.id,
      x: w.pos.x - ox,
      z: w.pos.z - oz,
      yOff: w.pos.y - terrain.heightAt(w.pos.x, w.pos.z),
      rotY: w.rot,
      tiltX: o.tiltX,
      tiltZ: o.tiltZ,
      scale: w.scale,
    }
  })
  return { w, h, heights, holes, weights, slots, palette: clipPalette, objects: inside }
}

/** Edge fade factor for a point `d` cells from the nearest pasted edge. */
const fade = (d: number, blend: number) => (blend <= 0 ? 1 : Math.min(1, Math.max(0, d / blend)))

/**
 * Paste `clip` with its corner at cell (px, pz), clipped to the map. Mutates
 * the terrain, objects and palette, and returns one undoable command.
 *
 * Textures merge into the target: a clip texture the map lacks is added to the palette (while there
 * is room), and each texel blends into the chunk's four slots. A texel whose texture can't fit in its
 * chunk keeps the chunk's own textures for that part.
 */
export function pasteRegion(
  terrain: Terrain,
  objects: ObjectLayer,
  currentPalette: readonly string[],
  /** Writes the map's palette (looked up at call time, so undo stays correct across tab switches). */
  setPalette: (t: string[]) => void,
  clip: MapClip,
  px: number,
  pz: number,
  opts: PasteOptions,
  onHeights: (r: Rect) => void,
): Command | null {
  const stroke = new TerrainStroke(terrain, 'Paste', { heights: opts.terrain, splat: opts.textures, holes: opts.terrain }, onHeights)
  const V = terrain.verts
  const size = terrain.size

  if (opts.terrain) {
    const x0 = Math.max(0, px)
    const z0 = Math.max(0, pz)
    const x1 = Math.min(size, px + clip.w)
    const z1 = Math.min(size, pz + clip.h)
    if (x1 >= x0 && z1 >= z0) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const cx = x - px
          const cz = z - pz
          const d = Math.min(cx, cz, clip.w - cx, clip.h - cz)
          const f = fade(d, opts.blend)
          const i = z * V + x
          const src = clip.heights[cz * (clip.w + 1) + cx] + opts.heightOffset
          terrain.heights[i] += (src - terrain.heights[i]) * f
        }
      }
      const r = { x0, z0, x1, z1 }
      terrain.markDirty(x0, z0, x1, z1)
      stroke.touchHeights(r)
      onHeights(r)
      // Holes come along with the ground, cell for cell (the edge blend doesn't apply to them).
      const cx1 = Math.min(size - 1, px + clip.w - 1)
      const cz1 = Math.min(size - 1, pz + clip.h - 1)
      if (cx1 >= x0 && cz1 >= z0) {
        for (let z = z0; z <= cz1; z++) {
          for (let x = x0; x <= cx1; x++) terrain.holes[z * size + x] = clip.holes[(z - pz) * clip.w + (x - px)]
        }
        stroke.touchHoles({ x0, z0, x1: cx1, z1: cz1 })
      }
    }
  }

  const paletteBefore = [...currentPalette]
  const palette = [...currentPalette]
  // The palette index a clip texture paints with in this map, adding it if there's room.
  const indexOf = (path: string): number => {
    const i = paletteIndex(palette, path)
    if (i >= 0) return i
    if (palette.length >= MAX_PALETTE) return -1
    palette.push(path)
    return palette.length - 1
  }
  const clipIndex = new Map<number, number>()

  if (opts.textures) {
    const T = SPLAT_PER_CELL
    const R = terrain.splatRes
    const side = terrain.paintChunksPerSide
    const tw = clip.w * T
    const th = clip.h * T
    const tx0 = px * T
    const tz0 = pz * T
    const cur: Array<[number, number]> = []
    const src: Array<[number, number]> = []
    const mix = new Map<number, number>()
    const w4 = new Float32Array(SLOTS)
    let rect: Rect | null = null
    for (let z = 0; z < th; z++) {
      const gz = tz0 + z
      if (gz < 0 || gz >= R) continue
      for (let x = 0; x < tw; x++) {
        const gx = tx0 + x
        if (gx < 0 || gx >= R) continue
        const d = Math.min(x + 0.5, z + 0.5, tw - x - 0.5, th - z - 0.5) / T
        const f = fade(d, opts.blend)
        const texel = gz * R + gx
        const chunk = chunkOf(Math.floor(gx / TEXELS_PER_CHUNK), Math.floor(gz / TEXELS_PER_CHUNK), side)

        // The texel's current mix, and the clip's mix, as palette index and weight pairs.
        cur.length = 0
        src.length = 0
        for (let k = 0; k < SLOTS; k++) {
          const g = terrain.chunkSlots[chunk * SLOTS + k]
          if (g !== NO_TEXTURE) cur.push([g, terrain.weights[texel * SLOTS + k]])
        }
        const sp = (z * tw + x) * SLOTS
        for (let k = 0; k < SLOTS; k++) {
          const local = clip.slots[sp + k]
          const wt = clip.weights[sp + k]
          if (local === NO_TEXTURE || wt === 0) continue
          let g = clipIndex.get(local)
          if (g === undefined) {
            g = indexOf(clip.palette[local])
            clipIndex.set(local, g)
          }
          if (g >= 0) src.push([g, wt])
        }
        if (src.length === 0) continue

        mix.clear()
        for (const [g, wt] of cur) mix.set(g, (mix.get(g) ?? 0) + wt * (1 - f))
        for (const [g, wt] of src) mix.set(g, (mix.get(g) ?? 0) + wt * f)

        // Fit the mix into the chunk's slots. A texture the chunk can't take is dropped.
        w4.fill(0)
        let sum = 0
        for (const [g, wt] of mix) {
          if (wt <= 0) continue
          const k = acquireSlot(terrain.chunkSlots, chunk, g)
          if (k < 0) continue
          w4[k] += wt
          sum += wt
        }
        if (sum <= 0) continue
        const dp = texel * SLOTS
        for (let k = 0; k < SLOTS; k++) terrain.weights[dp + k] = Math.round((w4[k] * 255) / sum)
        normalizeTexel(terrain.weights, dp)

        if (!rect) rect = { x0: gx, z0: gz, x1: gx, z1: gz }
        else {
          rect.x0 = Math.min(rect.x0, gx)
          rect.z0 = Math.min(rect.z0, gz)
          rect.x1 = Math.max(rect.x1, gx)
          rect.z1 = Math.max(rect.z1, gz)
        }
      }
    }
    if (rect) {
      terrain.markSplatDirty()
      stroke.touchSplat(rect)
    }
  }
  const paletteChanged = paletteBefore.length !== palette.length || paletteBefore.some((p, i) => p !== palette[i])
  if (paletteChanged) setPalette(palette)

  const added: WorldObject[] = []
  if (opts.objects) {
    const cs = terrain.cellSize
    const idMap = new Map<number, number>()
    // Parents before children; skip children whose parent wasn't pasted.
    let pending = [...clip.objects]
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: typeof pending = []
      for (const o of pending) {
        const { cid, cparent, ...rest } = o
        if (cparent === undefined) {
          const x = o.x + px * cs
          const z = o.z + pz * cs
          if (!terrain.contains(x, z)) continue
          const n = objects.add({ ...rest, x, z })
          idMap.set(cid, n.id)
          added.push(n)
        } else if (idMap.has(cparent)) {
          const n = objects.add({ ...rest, parent: idMap.get(cparent) })
          idMap.set(cid, n.id)
          added.push(n)
        } else {
          next.push(o)
        }
      }
      if (next.length === pending.length) break
      pending = next
    }
  }

  const terrainCmd = stroke.finish()
  if (!terrainCmd && !added.length && !paletteChanged) return null
  const saved = added.map((o) => ({ ...o }))
  return {
    label: 'Paste',
    undo: () => {
      terrainCmd?.undo()
      for (const o of saved) objects.remove(o.id)
      if (paletteChanged) setPalette(paletteBefore)
    },
    redo: () => {
      terrainCmd?.redo()
      for (const o of saved) objects.add({ ...o })
      if (paletteChanged) setPalette(palette)
    },
  }
}
