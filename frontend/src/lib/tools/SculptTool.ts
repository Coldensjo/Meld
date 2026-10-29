import * as THREE from 'three'
import { HOLE_CELL, HOLE_NONE, fillHoles, snapToBlocks } from '../terrain/holes'
import { setStatus, type SculptLimit, type SculptMode } from '../state/editor.svelte'
import { slopeDegrees, slopeWeights } from '../terrain/roles'
import { copyRect, tentBlur } from '../terrain/blur'
import { fbm, ridged } from '../engine/noise'
import type { ToolContext } from './Tool'
import { BrushTool, editor, keeps } from './BrushTool'
import { VertexMode } from './vertexMode'
import { TerrainStroke, brushDist, forEachTexel, forEachVertex, paintPixel, type Rect } from './brush'
import { Eroder, talusSlope } from '../terrain/erosion'
import { angledHeight, creviceDig, creviceRidge, mountainHeight, ridgeScale, terraceHeight, terraceLevel } from './sculptShapes'
import { NO_TEXTURE, SLOTS, chunkOfTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'

const RAISE_RATE = 18 // world units per second at strength 1
/** Mountain builds much faster than Raise, since a peak is a few hundred units tall. */
const MOUNTAIN_RATE = RAISE_RATE * 4
/** Crevice digs at this rate (the ridges rise with what was dug); faster than Raise since a dragged brush passes each spot briefly. */
const CREVICE_RATE = RAISE_RATE * 2
/** Erode's water drops a cell of the brush a second at strength 1. */
const DROPS_RATE = 0.5
/** Erode's thermal mode: passes' worth a second at strength 1. */
const THERMAL_RATE = 8

/** Weighted mean height under the brush: the flatten target when it averages. */
function averageHeight(t: Terrain, x: number, z: number, radius: number, falloff: number): number {
	const h = t.heights
	let sum = 0
	let weight = 0
	forEachVertex(t, x, z, radius, falloff, (i, w) => {
		sum += h[i] * w
		weight += w
	})
	return weight > 0 ? sum / weight : t.heightAt(x, z)
}

/** The sculpt modes that shape the ground under the brush, and so paint it too with Paint texture on. */
const SHAPING_MODES = new Set<SculptMode>(['raise', 'lower', 'smooth', 'blur', 'flatten', 'noise', 'mountain', 'crevice', 'terrace', 'erode'])

export class SculptTool extends BrushTool {
	protected label = 'Sculpt'
	/** With Paint texture on, a shaping stroke records the splat too, so the paint undoes with the heights. */
	protected get records() {
		return { heights: true, splat: editor.sculptPaint !== 'off' && SHAPING_MODES.has(editor.sculptMode) }
	}
	private slopeW = new Float32Array(2)
	/** Blur's scratch space between its two passes. */
	private blurTmp = new Float32Array(0)
	imageShaped() {
		return SHAPING_MODES.has(editor.sculptMode)
	}
	/** Hole mode works on the triangle under the cursor, not a brush footprint. */
	get usesBrush() {
		return editor.sculptMode !== 'hole'
	}
	/** Hole mode: whether this stroke restores ground (else it cuts), and the cell rect it touched. */
	private holeFilling = false
	private holeCell = { x0: 0, z0: 0, x1: 0, z1: 0 }
	/** Whether Hole mode shows the wall handles (`ctx.holeWalls`) now. */
	private wallsShown = false
	private flattenTarget = 0
	/** Terrace with Shift: the level every vertex of the stroke goes to, the step under the first click; null without. */
	private terraceSame: number | null = null
	private terraceShift = false
	private scratch = new Float32Array(0)
	/** Erode: the drops and slides, the brush's patch in cell units, its heights before and its weights, and the drops owed. */
	private eroder = new Eroder()
	private erodeWork = new Float32Array(0)
	private erodeBefore = new Float32Array(0)
	private erodeMask = new Float32Array(0)
	private dropsOwed = 0

	/** Vertex mode: the selection, its markers and its slope (vertexMode.ts). */
	private vertex = new VertexMode((ctx, r) => this.heightsChanged(ctx, r))

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		this.vertex.recordOrient()
		if (editor.sculptMode === 'hole') {
			if (ctx.holeWalls.onDown(ctx)) return
			if (!hit) return
			this.holeFilling = editor.holeFill !== !!e?.shiftKey
			this.stroke = new TerrainStroke(ctx.terrain, this.holeFilling ? 'Fill hole' : 'Cut hole', { holes: true })
			this.paintHole(ctx, hit)
			return
		}
		if (editor.sculptMode === 'flatten' && e?.altKey) {
			// Alt+click locks the flatten height (and the angled plane's pivot) to the point under the cursor.
			if (!hit) return
			const lock = editor.flattenLock
			lock.x = hit.x
			lock.y = hit.y
			lock.z = hit.z
			lock.on = true
			setStatus(`Flatten locked at height ${hit.y.toFixed(2)}. Every stroke now levels to it.`)
			return
		}
		// Before the stroke is made (in super.onDown), which takes the label as it is then (#190).
		this.label = 'Sculpt: ' + editor.sculptMode
		const vertex = editor.sculptMode === 'vertex'
		this.terraceShift = editor.sculptMode === 'terrace' && !!e?.shiftKey
		this.vertex.moving = vertex && !!e?.shiftKey
		this.vertex.deselecting = vertex && !!(e?.ctrlKey || e?.altKey)
		super.onDown(ctx, hit)
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (editor.sculptMode === 'hole') {
			if (ctx.holeWalls.active) ctx.holeWalls.onMove(ctx)
			else if (this.stroke && hit) this.paintHole(ctx, hit)
			return
		}
		super.tick(ctx, dt, hit)
	}

	/** Cuts or restores the 2x2-cell hole block under `hit`, as part of the stroke's hole edit. */
	private paintHole(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const gx = hit.x / t.cellSize
		const gz = hit.z / t.cellSize
		const cx = Math.floor(gx)
		const cz = Math.floor(gz)
		if (cx < 0 || cz < 0 || cx >= t.size || cz >= t.size) return
		// The whole 2x2-cell block under the cursor, as the client keeps holes.
		const r = this.holeCell
		r.x0 = r.x1 = cx
		r.z0 = r.z1 = cz
		snapToBlocks(r, t.size)
		const value = this.holeFilling ? HOLE_NONE : HOLE_CELL
		let changed = false
		for (let z = r.z0; z <= r.z1 && !changed; z++) for (let x = r.x0; x <= r.x1; x++) if (t.holes[z * t.size + x] !== value) changed = true
		if (!changed) return
		this.stroke?.reserveHoles(r)
		fillHoles(t.holes, t.size, r.x0, r.z0, r.x1 + 1, r.z1 + 1, value)
		t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
		this.stroke?.touchHoles(r)
	}

	onMove(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		if (!this.vertex.moving || !this.stroke) return
		this.vertex.move(ctx, this.stroke, e)
	}

	onUp(ctx: ToolContext) {
		ctx.holeWalls.onUp(ctx)
		super.onUp(ctx)
		if (editor.sculptMode === 'vertex' && !this.vertex.moving) this.vertex.strokeEnded(ctx.terrain)
		this.vertex.moving = false
	}

	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		// The hole walls show in Hole mode only.
		const hole = editor.sculptMode === 'hole'
		if (hole !== this.wallsShown) {
			this.wallsShown = hole
			if (hole) ctx.holeWalls.attach(ctx.scene)
			else ctx.holeWalls.detach(ctx.scene)
		}
		if (hole) ctx.holeWalls.frame(ctx)
		this.vertex.frame(ctx, hit, editor.sculptMode === 'vertex')
	}

	dispose() {
		this.vertex.dispose()
	}

	deactivate(ctx: ToolContext) {
		this.vertex.hide(ctx)
		ctx.holeWalls.detach(ctx.scene)
		this.wallsShown = false
	}

	onKey(ctx: ToolContext, e: KeyboardEvent) {
		if (editor.sculptMode !== 'vertex' || e.key !== ' ') return false
		this.vertex.onKey(ctx)
		return true
	}

	/** Vertex mode actions from the options bar: flatten the selection to its mean height, or clear it. */
	vertexAction(ctx: ToolContext, action: 'flatten' | 'clear') {
		this.vertex.action(ctx, action)
	}

	protected begin(ctx: ToolContext, hit: THREE.Vector3) {
		const { radius, falloff } = editor.brush
		this.flattenTarget = editor.flattenLock.on ? editor.flattenLock.y : editor.flattenTarget === 'average' ? averageHeight(ctx.terrain, hit.x, hit.z, radius, falloff) : ctx.terrain.heightAt(hit.x, hit.z)
		// Each stroke starts the drops from the same seed, so the same stroke erodes the same way.
		this.eroder.seed(editor.erode.seed)
		this.dropsOwed = 0
		const tr = editor.terrace
		this.terraceSame = this.terraceShift && tr.step > 0 ? terraceLevel(hit.y, tr.step, tr.offset) : null
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const t = ctx.terrain
		const h = t.heights
		const { radius, falloff } = editor.brush
		const rate = editor.brush.strength * ctx.pressure() * dt
		const mode = editor.sculptMode
		// The edit limit compares each vertex with the height under the cursor.
		const limit = editor.sculptLimit
		const cursorY = hit.y
		let rect: Rect | null = null

		if (mode === 'vertex') {
			// The brush selects vertices (Ctrl or Alt deselects); a Shift stroke moves them in onMove instead.
			this.vertex.brush(t, hit, radius)
			return
		}

		switch (mode) {
			case 'raise':
			case 'lower': {
				const s = (mode === 'raise' ? 1 : -1) * RAISE_RATE * rate
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (keeps(h[i], limit, cursorY)) h[i] += s * w
					},
					this.stroke,
				)
				break
			}
			case 'flatten': {
				const k = Math.min(1, rate * 8)
				const target = this.flattenTarget
				const dir = editor.flattenDir
				// Angled: the target is a plane through the stroke's start (or the locked point), pivoting there like noggit's.
				const ang = editor.flattenAngled
				const angled = ang.on && ang.angle !== 0
				const lock = editor.flattenLock
				const ox = lock.on ? lock.x : this.strokeStart.x
				const oz = lock.on ? lock.z : this.strokeStart.z
				const cs = t.cellSize
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						const d = (angled ? angledHeight(x * cs, z * cs, ox, target, oz, ang.angle, ang.orientation) : target) - h[i]
						// Raise-only and lower-only leave ground on the far side of the target alone.
						if ((dir === 'raise' && d <= 0) || (dir === 'lower' && d >= 0)) return
						if (keeps(h[i], limit, cursorY)) h[i] += d * w * k
					},
					this.stroke,
				)
				break
			}
			case 'terrace': {
				// Toward the step each vertex stands on (or, with Shift, the first click's), blended as Flatten blends.
				const k = Math.min(1, rate * 8)
				const { step, offset, sharpness } = editor.terrace
				const same = this.terraceSame
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (!keeps(h[i], limit, cursorY)) return
						const target = same ?? terraceHeight(h[i], step, offset, sharpness)
						h[i] += (target - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'smooth': {
				// Box-blur from a snapshot so the result is order independent.
				const V = t.verts
				const cs = t.cellSize
				if (this.scratch.length !== h.length) this.scratch = new Float32Array(h.length)
				// Only the brush rect and the ring the filter reads around it, not the whole map.
				copyRect(
					h,
					V,
					{
						x0: Math.max(0, Math.floor((hit.x - radius) / cs)),
						z0: Math.max(0, Math.floor((hit.z - radius) / cs)),
						x1: Math.min(V - 1, Math.ceil((hit.x + radius) / cs)),
						z1: Math.min(V - 1, Math.ceil((hit.z + radius) / cs)),
					},
					1,
					this.scratch,
				)
				const src = this.scratch
				const k = Math.min(1, rate * 10)
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						let sum = 0,
							n = 0
						for (let dz = -1; dz <= 1; dz++) {
							const zz = z + dz
							if (zz < 0 || zz >= V) continue
							for (let dx = -1; dx <= 1; dx++) {
								const xx = x + dx
								if (xx < 0 || xx >= V) continue
								sum += src[zz * V + xx]
								n++
							}
						}
						h[i] += (sum / n - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'blur': {
				// Toward the tent average over the brush's width (terrain/blur.ts), from a snapshot of before.
				const V = t.verts
				const cs = t.cellSize
				if (this.scratch.length !== h.length) this.scratch = new Float32Array(h.length)
				const r = {
					x0: Math.max(0, Math.floor((hit.x - radius) / cs)),
					z0: Math.max(0, Math.floor((hit.z - radius) / cs)),
					x1: Math.min(V - 1, Math.ceil((hit.x + radius) / cs)),
					z1: Math.min(V - 1, Math.ceil((hit.z + radius) / cs)),
				}
				this.blurTmp = tentBlur(h, V, r, radius / cs, this.scratch, this.blurTmp)
				const blurred = this.scratch
				const k = Math.min(1, rate * 8)
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (keeps(h[i], limit, cursorY)) h[i] += (blurred[i] - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'noise': {
				const s = RAISE_RATE * rate * 0.6
				const cs = t.cellSize
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						if (keeps(h[i], limit, cursorY)) h[i] += (fbm(x * cs * 0.08, z * cs * 0.08, 4, 5) - 0.5) * 2 * s * w
					},
					this.stroke,
				)
				break
			}
			case 'mountain': {
				// A peak the size of the brush: the ridge noise is sampled in world space, so holding the
				// brush in place keeps piling the same ridges higher, and its features scale with the brush.
				const s = MOUNTAIN_RATE * rate
				const cs = t.cellSize
				const f = 1.2 / radius
				const ridges = editor.mountain.ridges
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					1,
					(i, _w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						const wx = x * cs
						const wz = z * cs
						const n = ridged(wx * f, wz * f, 5, 13)
						h[i] += mountainHeight(brushDist(wx - hit.x, wz - hit.z, radius), n * n, ridges) * s
					},
					this.stroke,
				)
				break
			}
			case 'crevice': {
				// Dig the solid centre and pile the dug ground onto the falloff band, so dragging the brush
				// ploughs a path with ridges along both sides. Pass one sums the two profiles over the brush
				// so the ridge can hold exactly what the trench loses.
				const s = CREVICE_RATE * rate
				const cs = t.cellSize
				let dig = 0
				let ridge = 0
				forEachVertex(t, hit.x, hit.z, radius, 0, (i, _w, x, z) => {
					if (!keeps(h[i], limit, cursorY)) return
					const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
					dig += creviceDig(d, falloff)
					ridge += creviceRidge(d, falloff)
				})
				const k = ridgeScale(dig, ridge) * editor.crevice.ridge
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					0,
					(i, _w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
						h[i] += (creviceRidge(d, falloff) * k - creviceDig(d, falloff)) * s
					},
					this.stroke,
				)
				break
			}
			case 'erode':
				rect = this.erode(ctx, hit, radius, falloff, rate, limit, cursorY)
				break
		}
		this.heightsChanged(ctx, rect)

		// Painting while shaping, over as much of the brush as the mode shapes: one texture, or the rock
		// and dirt roles by the slope the ground now has (rock on the steep, dirt rimming its foot).
		if (rect && editor.sculptPaint !== 'off' && SHAPING_MODES.has(mode)) {
			const pf = mode === 'mountain' ? 1 : mode === 'crevice' ? 0 : falloff
			const amt = Math.min(1, editor.brush.strength * ctx.pressure() * dt * 5)
			let refused = 0
			let sr: Rect | null = null
			if (editor.sculptPaint === 'texture') {
				sr = forEachTexel(
					t,
					hit.x,
					hit.z,
					radius,
					pf,
					(p, w) => {
						if (!paintPixel(t, p, editor.sculptPaintLayer, amt * w)) refused++
					},
					this.stroke,
				)
			} else {
				const { rock, dirt } = editor.roles
				if (rock < 0 && dirt < 0) {
					setStatus("By-slope painting needs the map's rock and dirt textures: set them in File › Map Properties.", 4000)
				} else {
					const { rockDeg, dirtDeg, restoreBase } = editor.slopePaint
					const R = t.splatRes
					const side = t.paintChunksPerSide
					const ts = t.worldSize / R
					const e = ts
					const sw = this.slopeW
					sr = forEachTexel(
						t,
						hit.x,
						hit.z,
						radius,
						pf,
						(p, w) => {
							const x = ((p % R) + 0.5) * ts
							const z = (Math.floor(p / R) + 0.5) * ts
							const deg = slopeDegrees((t.heightAt(x + e, z) - t.heightAt(x - e, z)) / (2 * e), (t.heightAt(x, z + e) - t.heightAt(x, z - e)) / (2 * e))
							slopeWeights(deg, rockDeg, dirtDeg, sw)
							if (rock >= 0 && sw[0] > 0.001 && !paintPixel(t, p, rock, amt * w * sw[0])) refused++
							if (dirt >= 0 && sw[1] > 0.001 && !paintPixel(t, p, dirt, amt * w * sw[1])) refused++
							// Ground gentler than the dirt gets its chunk's base (first) texture back, so a hill
							// lowered again loses its rock; never where the base is the rock or the dirt itself.
							const flat = 1 - sw[0] - sw[1]
							if (restoreBase && flat > 0.001) {
								const base = t.chunkSlots[chunkOfTexel(side, R, p) * SLOTS]
								if (base !== NO_TEXTURE && base !== rock && base !== dirt) paintPixel(t, p, base, amt * w * flat)
							}
						},
						this.stroke,
					)
				}
			}
			if (refused) this.chunkFull()
			this.splatChanged(ctx, sr)
		}
	}

	/**
	 * Sculpt › Erode (#165): copies the heights under the brush into a patch, runs water drops started
	 * under the brush (or one thermal slide) over it (terrain/erosion.ts), and blends the change back by
	 * the brush's weight, so the falloff, the brush image and the edit limit apply as in the other modes
	 * and nothing outside the brush (which undo saved) changes. A drop that runs off the patch is gone.
	 */
	private erode(ctx: ToolContext, hit: THREE.Vector3, radius: number, falloff: number, rate: number, limit: SculptLimit, cursorY: number): Rect | null {
		const t = ctx.terrain
		const h = t.heights
		const cs = t.cellSize
		const V = t.verts
		const x0 = Math.max(0, Math.floor((hit.x - radius) / cs))
		const z0 = Math.max(0, Math.floor((hit.z - radius) / cs))
		const x1 = Math.min(t.size, Math.ceil((hit.x + radius) / cs))
		const z1 = Math.min(t.size, Math.ceil((hit.z + radius) / cs))
		const w = x1 - x0 + 1
		const ph = z1 - z0 + 1
		if (w < 3 || ph < 3) return null
		const n = w * ph
		if (this.erodeMask.length < n) {
			this.erodeMask = new Float32Array(n)
			this.erodeWork = new Float32Array(n)
			this.erodeBefore = new Float32Array(n)
		}
		const mask = this.erodeMask
		const work = this.erodeWork
		const before = this.erodeBefore
		const thermal = editor.erode.kind === 'thermal'
		let drops = 0
		if (!thermal) {
			this.dropsOwed += rate * DROPS_RATE * Math.PI * (radius / cs) ** 2
			drops = Math.floor(this.dropsOwed)
			this.dropsOwed -= drops
			if (!drops) return null
		}
		mask.fill(0, 0, n)
		const r = forEachVertex(
			t,
			hit.x,
			hit.z,
			radius,
			falloff,
			(i, wt, x, z) => {
				if (keeps(h[i], limit, cursorY)) mask[(z - z0) * w + x - x0] = wt
			},
			this.stroke,
		)
		if (!r) return null
		for (let z = 0; z < ph; z++) {
			for (let x = 0; x < w; x++) {
				const v = h[(z0 + z) * V + x0 + x]
				before[z * w + x] = v
				work[z * w + x] = v / cs
			}
		}
		if (thermal) this.eroder.thermal(work, w, ph, talusSlope(editor.erode.talus), Math.min(1, rate * THERMAL_RATE))
		else this.eroder.droplets(work, w, ph, drops, mask)
		for (let z = 0; z < ph; z++) {
			for (let x = 0; x < w; x++) {
				const k = z * w + x
				if (mask[k] > 0) h[(z0 + z) * V + x0 + x] = before[k] + (work[k] * cs - before[k]) * mask[k]
			}
		}
		return r
	}
}
