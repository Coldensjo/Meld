import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { HOLE_BLOCK, HOLE_CELL, HOLE_NONE, WALL_FADE_FAR, WALL_FADE_NEAR, bandOf, findWalls, revealRadius, snapToBlocks, type CellRect, type Wall } from '../terrain/holes'

/** A wall's band grown to whole hole blocks. */
const snapBand = (r: CellRect | null, size: number) => (r ? snapToBlocks(r, size) : null)
import { TerrainStroke } from './brush'
import type { ToolContext } from './Tool'
import { setViewportHint } from '../state/editor.svelte'

/**
 * The edges of the holes in the ground as handles. Every straight run of boundary between hole and
 * ground is a wall, drawn as a ribbon along the edge. Hovering a wall highlights it; dragging it
 * across moves the whole wall by whole 2x2-cell blocks, as the client keeps holes (out into the
 * ground to widen the hole, in to put ground back), and a + and a − badge follow the cursor along the
 * wall: + puts the hole block there back, − cuts the ground block there. Each drag or badge click is
 * one undo step.
 *
 * The Select tool and the Sculpt tool's Hole mode both drive one of these from their pointer
 * handlers; `active` tells them the cursor is on a wall or a badge, so the press is the wall's.
 */

/** How far (grid units) the cursor may be from a wall's line to grab it. */
const GRAB = 0.3
const LIFT = 0.12
/** Line widths as a share of the camera's distance, so they stay a few pixels at any zoom. */
const LINE = 0.0022
const HOVER_LINE = 0.0045
const GLOW = 0.014
// The ribbons' fade (holes.ts, wallFade), per fragment.
const FADE_VERTEX = /* glsl */ `#include <project_vertex>
  vWallWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
const FADE_FRAGMENT = /* glsl */ `{
    float wallFar = 1.0 - smoothstep(${WALL_FADE_NEAR.toFixed(1)}, ${WALL_FADE_FAR.toFixed(1)}, distance(vWallWorld, cameraPosition));
    float wallNear = wallCursor.w > 0.0 ? 1.0 - smoothstep(wallCursor.w, wallCursor.w * 1.5, distance(vWallWorld.xz, wallCursor.xz)) : 0.0;
    diffuseColor.a *= max(wallFar, wallNear);
  }
  #include <alphatest_fragment>`

function badgeTexture(glyph: string, color: string): THREE.CanvasTexture {
	const c = document.createElement('canvas')
	c.width = c.height = 64
	const g = c.getContext('2d')!
	// A flat disc with a soft shadow and a thin light ring, the glyph drawn as bars (crisper than text).
	g.shadowColor = 'rgba(0,0,0,0.45)'
	g.shadowBlur = 6
	g.shadowOffsetY = 2
	g.beginPath()
	g.arc(32, 31, 25, 0, Math.PI * 2)
	g.fillStyle = color
	g.fill()
	g.shadowColor = 'transparent'
	g.lineWidth = 2
	g.strokeStyle = 'rgba(255,255,255,0.85)'
	g.stroke()
	g.fillStyle = '#fff'
	g.fillRect(21, 28.5, 22, 5)
	if (glyph === '+') g.fillRect(29.5, 20, 5, 22)
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
	private hoverGlow: THREE.Mesh
	/** The camera's distance the ribbons were last built for, quantised; they are rebuilt when it changes a lot. */
	private widthKey = -1
	private dist = 50
	private plus: THREE.Sprite
	private minus: THREE.Sprite
	private hovered: Wall | null = null
	/** Where along the hovered wall the cursor is (grid units along the wall's axis). */
	private hoverAt = 0
	private ground = new THREE.Vector3()
	private hasGround = false
	private drag: { wall: Wall; stroke: TerrainStroke; orig: Uint8Array; moved: number; rect: Rect | null } | null = null
	/** The ribbons' fade uniform: the cursor's ground point (x, z) and its reveal radius (w, 0 with no ground under the cursor). */
	private readonly cursor = { value: new THREE.Vector4() }

	constructor() {
		const mat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
		const ribbonMat = mat(0xf2f5fa, 0.6)
		ribbonMat.onBeforeCompile = (shader) => {
			shader.uniforms.wallCursor = this.cursor
			shader.vertexShader = 'varying vec3 vWallWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', FADE_VERTEX)
			shader.fragmentShader = 'varying vec3 vWallWorld;\nuniform vec4 wallCursor;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', FADE_FRAGMENT)
		}
		ribbonMat.customProgramCacheKey = () => 'holeWallFade'
		this.ribbons = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat)
		this.hoverRibbon = new THREE.Mesh(new THREE.BufferGeometry(), mat(0x4b9cf5, 1))
		this.hoverGlow = new THREE.Mesh(new THREE.BufferGeometry(), mat(0x4b9cf5, 0.22))
		this.hoverRibbon.visible = this.hoverGlow.visible = false
		const sprite = (glyph: string, color: string) => {
			const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(glyph, color), depthTest: false, depthWrite: false, transparent: true }))
			s.visible = false
			return s
		}
		this.plus = sprite('+', '#2f9e55')
		this.minus = sprite('−', '#d9483f')
		this.group.add(this.ribbons, this.hoverGlow, this.hoverRibbon, this.plus, this.minus)
		this.group.traverse((o) => (o.renderOrder = 950))
	}

	attach(scene: THREE.Scene) {
		if (!this.group.parent) scene.add(this.group)
	}

	detach(scene: THREE.Scene) {
		scene.remove(this.group)
		this.hovered = null
		this.hoverRibbon.visible = this.hoverGlow.visible = this.plus.visible = this.minus.visible = false
	}

	/** The cursor is on a wall or a badge, or a drag is on: a press belongs to the walls. */
	get active() {
		return this.hovered !== null || this.drag !== null
	}

	/** Rebuilds the walls when the holes changed, and finds the wall under the cursor. */
	frame(ctx: ToolContext) {
		const t = ctx.terrain
		this.hasGround = t.raycast(ctx.raycaster.ray, this.ground, 4000, true)
		// Widths follow the camera's distance to the ground under the cursor (else to where it looks).
		const cam = ctx.raycaster.camera
		if (cam) this.dist = this.hasGround ? cam.position.distanceTo(this.ground) : Math.max(5, Math.abs(cam.position.y) * 2)
		if (this.hasGround) this.cursor.value.set(this.ground.x, this.ground.y, this.ground.z, revealRadius(this.dist))
		else this.cursor.value.w = 0
		const key = Math.round(Math.log(this.dist) * 3)
		if (this.builtTerrain !== t || this.builtVersion !== t.holesVersion || key !== this.widthKey) {
			this.widthKey = key
			this.build(t)
		}
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
			this.setCells(ctx, fill ? 'Fill a hole block' : 'Cut a hole block', [c], fill ? HOLE_NONE : HOLE_CELL)
			setViewportHint(fill ? 'Put one 2×2 block of ground back' : 'Cut one 2×2 block')
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
		// Outward is from the hole into the ground: moving the wall that way widens the hole. It moves by
		// whole 2x2-cell blocks, as the client keeps holes.
		const n = Math.round(((across - w.line) * -w.side) / HOLE_BLOCK) * HOLE_BLOCK
		if (n === d.moved) return
		// Put back what the last position wrote, then write this one, from the holes as they were.
		const old = snapBand(bandOf(w, Math.abs(d.moved), d.moved > 0, t.size), t.size)
		const band = snapBand(bandOf(w, Math.abs(n), n > 0, t.size), t.size)
		const rect = old && band ? grow({ ...old }, band) : (old ?? band)
		if (rect) {
			d.stroke.reserveHoles(rect)
			inject(t.holes, d.orig, t.size, rect)
			if (band) {
				const value = n > 0 ? HOLE_CELL : HOLE_NONE
				for (let z = band.z0; z <= band.z1; z++) for (let x = band.x0; x <= band.x1; x++) t.holes[z * t.size + x] = value
			}
			d.stroke.touchHoles(rect)
			t.touchHoles(rect)
			t.markDirty(rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1)
			d.rect = grow(d.rect, rect)
		}
		d.moved = n
		setViewportHint(n === 0 ? 'Hole edge: as it was' : n > 0 ? `Hole widened by ${n} cells` : `Ground back: ${-n} cells`)
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
			// The cell's whole 2x2 block.
			const r = snapToBlocks({ x0: c.x, z0: c.z, x1: c.x, z1: c.z }, t.size)
			stroke.reserveHoles(r)
			for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) t.holes[z * t.size + x] = value
			stroke.touchHoles(r)
			rect = grow(rect, r)
		}
		if (!rect) return
		t.touchHoles(rect)
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
		this.ribbons.geometry = ribbonGeometry(this.walls, t, this.dist * LINE)
		this.hovered = null
		this.drawHover(t)
	}

	private drawHover(t: Terrain) {
		this.hoverRibbon.geometry.dispose()
		this.hoverGlow.geometry.dispose()
		const w = this.hovered
		this.hoverRibbon.geometry = w ? ribbonGeometry([w], t, this.dist * HOVER_LINE) : new THREE.BufferGeometry()
		this.hoverGlow.geometry = w ? ribbonGeometry([w], t, this.dist * GLOW) : new THREE.BufferGeometry()
		this.hoverRibbon.visible = this.hoverGlow.visible = w !== null
	}

	private placeBadges(t: Terrain) {
		const w = this.hovered
		const show = w !== null && !this.drag
		this.plus.visible = this.minus.visible = show
		if (!w || !show) return
		const cs = t.cellSize
		// Small discs just either side of the edge at the cursor: + over the hole, − over the ground.
		const size = THREE.MathUtils.clamp(this.dist * 0.038, 0.3, 6)
		const off = Math.min(0.45 * cs, size * 0.8)
		for (const [sprite, inside] of [
			[this.plus, true],
			[this.minus, false],
		] as const) {
			const c = this.badgeCell(w, inside)
			const along = (this.hoverAt + 0.5) * cs
			const across = w.line * cs + (inside ? w.side : -w.side) * off
			const x = w.axis === 'x' ? across : along
			const z = w.axis === 'x' ? along : across
			sprite.position.set(x, t.heightAt(x, z) + size * 0.55, z)
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

/** A ribbon `halfWidth` (world units) to each side of every wall, following the ground's height, as one geometry. */
function ribbonGeometry(walls: Wall[], t: Terrain, halfWidth: number): THREE.BufferGeometry {
	const cs = t.cellSize
	const pos: number[] = []
	const idx: number[] = []
	const hw = Math.max(0.01, halfWidth)
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
