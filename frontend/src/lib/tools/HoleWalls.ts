import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { HOLE_CELL, HOLE_NONE, bandOf, findWalls, type Wall } from '../terrain/holes'
import { TerrainStroke } from './brush'
import type { ToolContext } from './Tool'
import { setViewportHint } from '../state/editor.svelte'

/**
 * The edges of the holes in the ground as handles. Every straight run of boundary between hole and
 * ground is a wall, drawn as a ribbon along the edge. Hovering a wall highlights it; dragging it
 * across moves the whole wall by whole cells (out into the ground to widen the hole, in to put
 * ground back), and a + and a − badge follow the cursor along the wall: + puts the one hole cell
 * there back, − cuts the one ground cell there. Each drag or badge click is one undo step.
 *
 * The Select tool and the Sculpt tool's Hole mode both drive one of these from their pointer
 * handlers; `active` tells them the cursor is on a wall or a badge, so the press is the wall's.
 */

/** How far (grid units) the cursor may be from a wall's line to grab it. */
const GRAB = 0.3
const RIBBON = 0.12
const LIFT = 0.12

function badgeTexture(glyph: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(32, 32, 28, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.stroke()
  g.fillStyle = '#fff'
  g.font = 'bold 44px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(glyph, 32, 34)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class HoleWalls {
  readonly group = new THREE.Group()
  private walls: Wall[] = []
  private builtVersion = -1
  private builtTerrain: Terrain | null = null
  private ribbons: THREE.Mesh
  private hoverRibbon: THREE.Mesh
  private plus: THREE.Sprite
  private minus: THREE.Sprite
  private hovered: Wall | null = null
  /** Where along the hovered wall the cursor is (grid units along the wall's axis). */
  private hoverAt = 0
  private ground = new THREE.Vector3()
  private hasGround = false
  private drag: { wall: Wall; stroke: TerrainStroke; orig: Uint8Array; moved: number; rect: Rect | null } | null = null

  constructor() {
    const mat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    this.ribbons = new THREE.Mesh(new THREE.BufferGeometry(), mat(0xf2f5fa, 0.55))
    this.hoverRibbon = new THREE.Mesh(new THREE.BufferGeometry(), mat(0x4b9cf5, 0.95))
    this.hoverRibbon.visible = false
    const sprite = (glyph: string, color: string) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(glyph, color), depthTest: false, depthWrite: false, transparent: true }))
      s.visible = false
      return s
    }
    this.plus = sprite('+', '#3fa65b')
    this.minus = sprite('−', '#d9534f')
    this.group.add(this.ribbons, this.hoverRibbon, this.plus, this.minus)
    this.group.traverse((o) => (o.renderOrder = 950))
  }

  attach(scene: THREE.Scene) {
    if (!this.group.parent) scene.add(this.group)
  }

  detach(scene: THREE.Scene) {
    scene.remove(this.group)
    this.hovered = null
    this.hoverRibbon.visible = this.plus.visible = this.minus.visible = false
  }

  /** The cursor is on a wall or a badge, or a drag is on: a press belongs to the walls. */
  get active() {
    return this.hovered !== null || this.drag !== null
  }

  /** Rebuilds the walls when the holes changed, and finds the wall under the cursor. */
  frame(ctx: ToolContext) {
    const t = ctx.terrain
    if (this.builtTerrain !== t || this.builtVersion !== t.holesVersion) this.build(t)
    this.hasGround = t.raycast(ctx.raycaster.ray, this.ground, 4000, true)
    if (this.drag) return
    // On a badge, the wall stays hovered: the badges sit half a cell off the wall's line.
    if (this.hovered && this.onBadge(ctx)) return
    const was = this.hovered
    this.hovered = null
    if (this.hasGround && this.walls.length) {
      const gx = this.ground.x / t.cellSize
      const gz = this.ground.z / t.cellSize
      let best = GRAB
      for (const w of this.walls) {
        const across = w.axis === 'x' ? gx : gz
        const along = w.axis === 'x' ? gz : gx
        const d = Math.abs(across - w.line)
        if (d < best && along >= w.from - 0.2 && along < w.to + 0.2) {
          best = d
          this.hovered = w
          this.hoverAt = Math.min(w.to - 1, Math.max(w.from, Math.floor(along)))
        }
      }
    }
    if (this.hovered !== was) this.drawHover(t)
    this.placeBadges(t)
  }

  /** A press: on a badge, puts one cell back or cuts one; on a wall, starts moving it. Returns false when the press is not the walls'. */
  onDown(ctx: ToolContext): boolean {
    const w = this.hovered
    if (!w) return false
    const t = ctx.terrain
    const hit = this.onBadge(ctx)
    if (hit) {
      const fill = hit === this.plus
      const c = this.badgeCell(w, fill)
      this.setCells(ctx, fill ? 'Fill a cell' : 'Cut a cell', [c], fill ? HOLE_NONE : HOLE_CELL)
      setViewportHint(fill ? 'Put one cell of ground back' : 'Cut one cell')
      return true
    }
    this.drag = { wall: w, stroke: new TerrainStroke(t, 'Move hole edge', { holes: true }), orig: t.holes.slice(), moved: 0, rect: null }
    return true
  }

  /** The badge under the cursor's ray, if any. A sprite's raycast needs the raycaster's camera (set by setFromCamera, as the Engine's pick does). */
  private onBadge(ctx: ToolContext): THREE.Sprite | null {
    if (!ctx.raycaster.camera || !this.plus.visible) return null
    const hit = ctx.raycaster.intersectObjects([this.plus, this.minus], false)[0]
    return hit ? (hit.object as THREE.Sprite) : null
  }

  /** Moves the dragged wall to the cursor, by whole cells. */
  onMove(ctx: ToolContext) {
    const d = this.drag
    if (!d || !this.hasGround) return
    const t = ctx.terrain
    const w = d.wall
    const across = (w.axis === 'x' ? this.ground.x : this.ground.z) / t.cellSize
    // Outward is from the hole into the ground: moving the wall that way widens the hole.
    const n = Math.round((across - w.line) * -w.side)
    if (n === d.moved) return
    // Put back what the last position wrote, then write this one, from the holes as they were.
    const old = bandOf(w, Math.abs(d.moved), d.moved > 0, t.size)
    const band = bandOf(w, Math.abs(n), n > 0, t.size)
    const rect = old && band ? grow({ ...old }, band) : old ?? band
    if (rect) {
      d.stroke.reserveHoles(rect)
      inject(t.holes, d.orig, t.size, rect)
      if (band) {
        const value = n > 0 ? HOLE_CELL : HOLE_NONE
        for (let z = band.z0; z <= band.z1; z++) for (let x = band.x0; x <= band.x1; x++) t.holes[z * t.size + x] = value
      }
      d.stroke.touchHoles(rect)
      t.touchHoles()
      t.markDirty(rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1)
      d.rect = grow(d.rect, rect)
    }
    d.moved = n
    setViewportHint(n === 0 ? 'Hole edge: as it was' : n > 0 ? `Hole widened by ${n} ${n === 1 ? 'cell' : 'cells'}` : `Ground back: ${-n} ${n === -1 ? 'cell' : 'cells'}`)
  }

  onUp(ctx: ToolContext) {
    const d = this.drag
    if (!d) return
    this.drag = null
    const cmd = d.stroke.finish()
    if (cmd) ctx.history.push(cmd)
    this.build(ctx.terrain)
  }

  /** The cell a badge acts on: the hole cell just inside the wall at the cursor (+), or the ground cell just outside (−). */
  private badgeCell(w: Wall, inside: boolean): { x: number; z: number } {
    const across = inside ? (w.side === -1 ? w.line - 1 : w.line) : w.side === -1 ? w.line : w.line - 1
    return w.axis === 'x' ? { x: across, z: this.hoverAt } : { x: this.hoverAt, z: across }
  }

  private setCells(ctx: ToolContext, label: string, cells: Array<{ x: number; z: number }>, value: number) {
    const t = ctx.terrain
    const stroke = new TerrainStroke(t, label, { holes: true })
    let rect: Rect | null = null
    for (const c of cells) {
      if (c.x < 0 || c.z < 0 || c.x >= t.size || c.z >= t.size) continue
      const r = { x0: c.x, z0: c.z, x1: c.x, z1: c.z }
      stroke.reserveHoles(r)
      t.holes[c.z * t.size + c.x] = value
      stroke.touchHoles(r)
      rect = grow(rect, r)
    }
    if (!rect) return
    t.touchHoles()
    t.markDirty(rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1)
    const cmd = stroke.finish()
    if (cmd) ctx.history.push(cmd)
    this.build(t)
  }

  private build(t: Terrain) {
    this.builtTerrain = t
    this.builtVersion = t.holesVersion
    this.walls = findWalls(t.holes, t.size)
    this.ribbons.geometry.dispose()
    this.ribbons.geometry = ribbonGeometry(this.walls, t)
    this.hovered = null
    this.drawHover(t)
  }

  private drawHover(t: Terrain) {
    this.hoverRibbon.geometry.dispose()
    this.hoverRibbon.geometry = this.hovered ? ribbonGeometry([this.hovered], t, RIBBON * 1.6) : new THREE.BufferGeometry()
    this.hoverRibbon.visible = this.hovered !== null
  }

  private placeBadges(t: Terrain) {
    const w = this.hovered
    const show = w !== null && !this.drag
    this.plus.visible = this.minus.visible = show
    if (!w || !show) return
    const cs = t.cellSize
    const size = THREE.MathUtils.clamp(cs * 0.55, 0.5, 6)
    for (const [sprite, inside] of [[this.plus, true], [this.minus, false]] as const) {
      const c = this.badgeCell(w, inside)
      const x = (c.x + 0.5) * cs
      const z = (c.z + 0.5) * cs
      sprite.position.set(x, t.heightAt(x, z) + size * 0.6, z)
      sprite.scale.setScalar(size)
      sprite.visible = c.x >= 0 && c.z >= 0 && c.x < t.size && c.z < t.size
      // Placed now, so a press in the same frame finds it where it is drawn.
      sprite.updateMatrixWorld()
    }
  }
}

interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

function grow(r: Rect | null, by: Rect): Rect {
  if (!r) return { ...by }
  r.x0 = Math.min(r.x0, by.x0)
  r.z0 = Math.min(r.z0, by.z0)
  r.x1 = Math.max(r.x1, by.x1)
  r.z1 = Math.max(r.z1, by.z1)
  return r
}

/** Copies `src`'s cells of `r` into `dst` (both `size` a side). */
function inject(dst: Uint8Array, src: Uint8Array, size: number, r: Rect) {
  for (let z = r.z0; z <= r.z1; z++) {
    const row = z * size
    for (let x = r.x0; x <= r.x1; x++) dst[row + x] = src[row + x]
  }
}

/** A ribbon along each wall, following the ground's height, as one geometry. */
function ribbonGeometry(walls: Wall[], t: Terrain, halfWidth = RIBBON): THREE.BufferGeometry {
  const cs = t.cellSize
  const pos: number[] = []
  const idx: number[] = []
  const hw = halfWidth * cs
  for (const w of walls) {
    for (let k = w.from; k <= w.to; k++) {
      const x = w.axis === 'x' ? w.line * cs : k * cs
      const z = w.axis === 'x' ? k * cs : w.line * cs
      const y = t.heightAt(x, z) + LIFT
      const base = pos.length / 3
      if (w.axis === 'x') pos.push(x - hw, y, z, x + hw, y, z)
      else pos.push(x, y, z - hw, x, y, z + hw)
      if (k > w.from) idx.push(base - 2, base - 1, base, base - 1, base + 1, base)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}
