import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from './ObjectLayer'
import type { Command } from '../state/history'
import { TerrainStroke, type Rect } from '../tools/brush'

/** A rectangular piece of a map, copied for pasting into any open map. */
export interface MapClip {
  /** Size in cells. */
  w: number
  h: number
  /** (w+1)*(h+1) vertex heights. */
  heights: Float32Array
  /** Splat texels (2 per cell): (2w)*(2h)*4 per texture. */
  splatA: Uint8Array
  splatB: Uint8Array
  /** Texture path of each source slot, used to remap into the target map. */
  layerTextures: string[]
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

const TPC = 2 // splat texels per cell

/** Copy the cell rect (inclusive vertex corners x0..x1, z0..z1). */
export function copyRegion(terrain: Terrain, objects: ObjectLayer, r: Rect, layerTextures: string[]): MapClip {
  const w = r.x1 - r.x0
  const h = r.z1 - r.z0
  const V = terrain.verts
  const heights = new Float32Array((w + 1) * (h + 1))
  for (let z = 0; z <= h; z++) {
    for (let x = 0; x <= w; x++) heights[z * (w + 1) + x] = terrain.heights[(r.z0 + z) * V + r.x0 + x]
  }
  const R = terrain.splatRes
  const tw = w * TPC
  const th = h * TPC
  const splatA = new Uint8Array(tw * th * 4)
  const splatB = new Uint8Array(tw * th * 4)
  for (let z = 0; z < th; z++) {
    const src = ((r.z0 * TPC + z) * R + r.x0 * TPC) * 4
    splatA.set(terrain.splatA.subarray(src, src + tw * 4), z * tw * 4)
    splatB.set(terrain.splatB.subarray(src, src + tw * 4), z * tw * 4)
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
      scale: w.scale,
    }
  })
  return { w, h, heights, splatA, splatB, layerTextures: [...layerTextures], objects: inside }
}

/** Edge fade factor for a point `d` cells from the nearest pasted edge. */
const fade = (d: number, blend: number) => (blend <= 0 ? 1 : Math.min(1, Math.max(0, d / blend)))

/**
 * Paste `clip` with its corner at cell (px, pz), clipped to the map. Mutates
 * the terrain/objects/layer textures and returns one undoable command.
 */
export function pasteRegion(
  terrain: Terrain,
  objects: ObjectLayer,
  currentTextures: readonly string[],
  /** Writes the map's slot textures (looked up at call time, so undo stays correct across tab switches). */
  setTextures: (t: string[]) => void,
  clip: MapClip,
  px: number,
  pz: number,
  opts: PasteOptions,
  onHeights: (r: Rect) => void,
): Command | null {
  const stroke = new TerrainStroke(terrain, 'Paste', { heights: opts.terrain, splat: opts.textures }, onHeights)
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
    }
  }

  // Remap source texture slots onto the target map's slots.
  const texturesBefore = [...currentTextures]
  const layerTextures = [...currentTextures]
  if (opts.textures) {
    const used = new Array(8).fill(false)
    for (let p = 0; p < clip.splatA.length; p += 4) {
      for (let k = 0; k < 4; k++) {
        if (clip.splatA[p + k]) used[k] = true
        if (clip.splatB[p + k]) used[k + 4] = true
      }
    }
    const usage = slotUsage(terrain)
    const total = usage.reduce((a, b) => a + b, 0) || 1
    const slotMap = new Array(8).fill(-1)
    for (let s = 0; s < 8; s++) {
      if (!used[s]) continue
      const path = clip.layerTextures[s] ?? ''
      let t = path ? layerTextures.findIndex((p) => p.toLowerCase() === path.toLowerCase()) : -1
      if (t < 0 && path) {
        // Prefer an empty, unused slot; then any unused slot.
        t = layerTextures.findIndex((p, i) => !p && usage[i] / total < 0.0005 && !slotMap.includes(i))
        if (t < 0) t = layerTextures.findIndex((_, i) => usage[i] / total < 0.0005 && !slotMap.includes(i))
        if (t >= 0) layerTextures[t] = path
      }
      slotMap[s] = t >= 0 ? t : s // no room: fall back to the same slot index
    }

    const R = terrain.splatRes
    const tw = clip.w * TPC
    const th = clip.h * TPC
    const tx0 = px * TPC
    const tz0 = pz * TPC
    const w = new Float32Array(8)
    const cur = new Float32Array(8)
    let rect: Rect | null = null
    for (let z = 0; z < th; z++) {
      const gz = tz0 + z
      if (gz < 0 || gz >= R) continue
      for (let x = 0; x < tw; x++) {
        const gx = tx0 + x
        if (gx < 0 || gx >= R) continue
        const sp = (z * tw + x) * 4
        w.fill(0)
        for (let k = 0; k < 4; k++) {
          w[slotMap[k] < 0 ? k : slotMap[k]] += clip.splatA[sp + k]
          w[slotMap[k + 4] < 0 ? k + 4 : slotMap[k + 4]] += clip.splatB[sp + k]
        }
        const d = Math.min(x + 0.5, z + 0.5, tw - x - 0.5, th - z - 0.5) / TPC
        const f = fade(d, opts.blend)
        const dp = (gz * R + gx) * 4
        for (let k = 0; k < 4; k++) {
          cur[k] = terrain.splatA[dp + k]
          cur[k + 4] = terrain.splatB[dp + k]
        }
        let sum = 0
        for (let k = 0; k < 8; k++) {
          cur[k] += (w[k] - cur[k]) * f
          sum += cur[k]
        }
        const scale = sum > 0 ? 255 / sum : 0
        for (let k = 0; k < 4; k++) {
          terrain.splatA[dp + k] = Math.round(cur[k] * scale)
          terrain.splatB[dp + k] = Math.round(cur[k + 4] * scale)
        }
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
  const texturesAfter = [...layerTextures]
  const texturesChanged = texturesBefore.some((p, i) => p !== texturesAfter[i])
  if (texturesChanged) setTextures(texturesAfter)

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
  if (!terrainCmd && !added.length && !texturesChanged) return null
  const saved = added.map((o) => ({ ...o }))
  return {
    label: 'Paste',
    undo: () => {
      terrainCmd?.undo()
      for (const o of saved) objects.remove(o.id)
      if (texturesChanged) setTextures(texturesBefore)
    },
    redo: () => {
      terrainCmd?.redo()
      for (const o of saved) objects.add({ ...o })
      if (texturesChanged) setTextures(texturesAfter)
    },
  }
}

function slotUsage(t: Terrain): number[] {
  const usage = new Array(8).fill(0)
  for (let p = 0; p < t.splatA.length; p += 28) {
    for (let k = 0; k < 4; k++) {
      usage[k] += t.splatA[p + k]
      usage[k + 4] += t.splatB[p + k]
    }
  }
  return usage
}
