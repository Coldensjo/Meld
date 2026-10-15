// Turning a copied area (see clipboard.ts). Kept apart from the clipboard module, which pulls in the
// terrain stroke, so it can be tested on its own under node.
import type { MapClip } from './clipboard'
import { SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'
import { rotateLiquidClip } from '../water/liquids'

/**
 * The clip turned a quarter turn clockwise seen from above (the turn a model's yaw makes for +90°):
 * what was at (x, z) lands at (z, w - x), so a w by h clip becomes h by w. Heights, holes, texels,
 * liquids and models turn together; a model's own yaw turns too. A hole of one triangle keeps its
 * value, so it may land on the other triangle of its cell. noggit's chunk mover has the same turn.
 */
export function rotateClip(clip: MapClip, cellSize: number): MapClip {
  const { w, h } = clip
  const nw = h
  const nh = w
  const heights = new Float32Array((nw + 1) * (nh + 1))
  for (let z = 0; z <= h; z++) for (let x = 0; x <= w; x++) heights[(w - x) * (nw + 1) + z] = clip.heights[z * (w + 1) + x]
  const holes = new Uint8Array(nw * nh)
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) holes[(w - 1 - x) * nw + z] = clip.holes[z * w + x]
  const T = SPLAT_PER_CELL
  const tw = w * T
  const th = h * T
  const ntw = nw * T
  const weights = new Uint8Array(clip.weights.length)
  const slots = new Uint8Array(clip.slots.length)
  for (let z = 0; z < th; z++) {
    for (let x = 0; x < tw; x++) {
      const from = (z * tw + x) * SLOTS
      const to = ((tw - 1 - x) * ntw + z) * SLOTS
      for (let k = 0; k < SLOTS; k++) {
        weights[to + k] = clip.weights[from + k]
        slots[to + k] = clip.slots[from + k]
      }
    }
  }
  const W = w * cellSize
  const objects = clip.objects.map((o) => (o.cparent === undefined ? { ...o, x: o.z, z: W - o.x, rotY: o.rotY + Math.PI / 2 } : { ...o }))
  const out: MapClip = { w: nw, h: nh, heights, holes, weights, slots, palette: [...clip.palette], objects }
  if (clip.liquids) out.liquids = rotateLiquidClip(clip.liquids)
  return out
}
