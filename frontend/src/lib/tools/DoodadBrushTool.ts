import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, prefs, setStatus, setViewportHint } from '../state/editor.svelte'
import { addedCommand, removedCommand } from '../world/objectCommands'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { getAsset } from '../models/assets'
import { GhostPool } from './ghosts'
import { grow } from './typedArray'
import { groundNormal, groundSlopeDeg, tiltToNormal } from '../world/groundTilt'
import { placementEuler } from '../world/placement'
import { MAX_ATTEMPTS, SpacingGrid, attemptRate, candidate, fillAttempts, fits, fitsOn, newBrush, pickEntry, rulesAllow, uniqueName, type DoodadBrush, type GroundProbe } from './doodadBrush'
import { ToolGround } from './toolGround'
import { InputsKey } from './inputsKey'
import type { SpawnBrushTool } from './SpawnBrushTool'

/** The brush the Doodad tool paints with: the preference's pick, else the first one; null with none made. */
export function activeDoodadBrush(): DoodadBrush | null {
	const list = prefs.doodadBrushes
	return list.find((b) => b.name === prefs.doodadBrush) ?? list[0] ?? null
}

/** Adds a new, empty brush under a free name and makes it the one painted with. Returns the stored (reactive) brush. */
export function addDoodadBrush(name = 'New brush'): DoodadBrush {
	const b = newBrush(
		uniqueName(
			name,
			prefs.doodadBrushes.map((x) => x.name),
		),
	)
	prefs.doodadBrushes = [...prefs.doodadBrushes, b]
	prefs.doodadBrush = b.name
	return prefs.doodadBrushes[prefs.doodadBrushes.length - 1]
}

/** Models with a footprint under this are spaced as if this wide, so tufts of grass don't pile onto one spot. */
const MIN_FOOTPRINT = 0.8

/** Where the On props ray starts: above anything a map holds. */
const RAY_TOP = 10000

/** Most models the preview shows (and the press puts down first): a quarter second of the brush, at least one. */
const MAX_PREVIEW = 32

/** How `DoodadBrushTool.fill` runs, besides the area and mask. */
export interface FillOptions {
	/** How many points it tries; by default as many as the brush's strength makes over the area. */
	attempts?: number
	/** The chance (0 to 1) a point at (x, z) is tried, for clumps; every point when missing. */
	keep?: (x: number, z: number) => number
	/** The brush's rules alone, with a random turn each: the options bar's Max slope, Avoid water, Random rotation and Follow ground don't apply. */
	own?: boolean
	/** The undo step's name. */
	label?: string
}

/** One placement drawn ahead of time, relative to the brush centre. */
interface Planned {
	dx: number
	dz: number
	entry: number
	scale: number
	rotY: number
	/** The entry's random tilt (Follow ground rotation replaces it at placement). */
	tiltX: number
	tiltZ: number
	/** The footprint at this scale, for the spacing. */
	size: number
}

/**
 * The Doodad brush: while the button is held, the brush's models land at random points under it,
 * drawn by their weights, each sized, sunk and tilted as its entry says, and never closer to another
 * model than the brush's spacing allows. The falloff thins the placements toward the edge, and the
 * strength sets how fast they come. With Shift held the spacing is ignored, so models stack on top
 * of each other. Ctrl+drag erases the brush's models under it instead. A stroke is one undo step.
 *
 * While the brush hovers, the next placements are drawn ahead (`plan`) and shown as ghost models
 * under it; the press puts those down first, then goes on at random, and a new plan is drawn when
 * the stroke ends or the brush changes. Ctrl+scroll (or R) spins the planned cluster about the
 * brush centre. A model still loading (or one that failed) shows no ghost rather than a placeholder.
 *
 * Two surface rules in the options bar: Max slope keeps the models off ground steeper than that many
 * degrees (90 allows any), and On props lets a placement land on a prop under the brush (attached to
 * it, as the Place tool attaches), found by a ray straight down at the point. A model on a prop keeps
 * its entry's random tilt and is spaced only against what else stands on that prop.
 */
export class DoodadBrushTool implements Tool {
	readonly usesBrush = true
	private placed: WorldObject[] | null = null
	/** The ids placed in this stroke: a placement never lands on one of them. */
	private placedIds = new Set<number>()
	private erased: WorldObject[] | null = null
	/** The object layer the stroke started on: undo must restore that map, not whichever tab is active then. */
	private objects: ObjectLayer | null = null
	private acc = 0
	/** Shift is held: placements ignore the spacing and pile up. Read on every pointer event. */
	private stacking = false
	private point = new Float32Array(2)
	/** The models already standing near the brush this tick: x, z and footprint each. */
	private near = new Float32Array(3 * 256)
	private nearCount = 0
	/** The models standing on props near the brush: world x, z, footprint and the parent's id each. */
	private nearOn = new Float32Array(4 * 64)
	private nearOnCount = 0
	/** Casts straight down at a point for the prop under it (On props). */
	private ray = new THREE.Raycaster()
	/** The models that may stand under the brush (On props): ids, `propCount` of them, gathered about `propCentre`. */
	private props = new Int32Array(256)
	private propCount = 0
	private propCentre = new THREE.Vector3()
	private propReach = 0
	private propLayer: ObjectLayer | null = null
	private propVersion = -1
	private pos = new THREE.Vector3()
	/** Scratch for the layer's `rootsNear` and `attachedObjects`. */
	private found: WorldObject[] = []
	private normal = { x: 0, y: 1, z: 0 }
	private tilt = { tiltX: 0, tiltZ: 0 }
	private size = new THREE.Vector3()
	/** The placements drawn ahead, shown as ghosts and put down first on the press. */
	private plan: Planned[] = []
	/** What the plan was drawn for; a change of brush or settings draws a new one. */
	private planKey = new InputsKey()
	/** How far the plan has been spun (for the hint); a new plan starts afresh. */
	private spun = 0
	/** The spacing check while a fill runs (`fill`), in place of `near`. */
	private grid: SpacingGrid | null = null
	private fillLabel = 'Fill with doodad brush'
	/** While a fill with its own rules runs (`FillOptions.own`): the options bar's settings don't apply. */
	private own = false
	/** The ground under a placement, as the brush's rules see it. */
	private ground = new ToolGround()
	private ghosts = new GhostPool()

	/** The spawn brush, which takes the tool's input in Creatures mode (`editor.doodadMode`, #171); set by the Engine. */
	spawns: SpawnBrushTool | null = null

	/** Whether the spawn brush has the input now. */
	private get creatures() {
		return editor.doodadMode === 'creatures' && !!this.spawns
	}

	activate(ctx: ToolContext) {
		this.ghosts.attach(ctx.scene)
		this.spawns?.activate(ctx)
	}

	deactivate(ctx: ToolContext) {
		this.ghosts.detach(ctx.scene)
		this.spawns?.deactivate(ctx)
		this.plan = []
		this.planKey.reset()
	}

	/** Turns the planned placements about the brush centre by `radians`, each model facing along. */
	spinPreview(radians: number) {
		this.spun += radians
		const c = Math.cos(radians)
		const s = Math.sin(radians)
		for (const p of this.plan) {
			const dx = p.dx * c - p.dz * s
			const dz = p.dx * s + p.dz * c
			p.dx = dx
			p.dz = dz
			p.rotY -= radians
		}
		const deg = Math.round(THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(this.spun), 360))
		setViewportHint(`Spin ${deg % 360}°`)
	}

	onKey(_ctx: ToolContext, e: KeyboardEvent) {
		if (this.creatures) return false
		if (e.key === 'r' || e.key === 'R') {
			this.spinPreview((e.shiftKey ? -1 : 1) * (Math.PI / 4))
			return true
		}
		return false
	}

	/** Whether the preview shows a model of `type`, for the engine to animate it as the placed copies will. */
	previewing(type: string): boolean {
		if (this.creatures) return this.spawns?.previewing(type) ?? false
		if (this.placed || this.erased) return false
		const brush = activeDoodadBrush()
		if (!brush) return false
		for (const p of this.plan) if (brush.entries[p.entry]?.type === type) return true
		return false
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		if (this.creatures) {
			this.spawns!.onDown(ctx, hit, e)
			return
		}
		if (!hit) return
		const brush = activeDoodadBrush()
		if (!brush) {
			setStatus('Make a doodad brush first: Edit brush in the options bar, then pick models in the browser below.', 6000)
			return
		}
		this.objects = ctx.objects
		this.stacking = e.shiftKey
		if (e.ctrlKey) {
			this.erased = []
			this.erase(ctx, hit, brush)
			return
		}
		if (brush.entries.length === 0) {
			setStatus(`The brush "${brush.name}" has no models yet. Pick some in the browser below while editing it.`, 6000)
			return
		}
		this.placed = []
		this.placedIds.clear()
		// The previewed placements land first, so a click puts down what was shown.
		this.ensurePlan(brush)
		this.prepareNear(ctx, hit, brush)
		for (const p of this.plan) this.place(ctx, brush, hit, p)
		this.plan = []
		this.planKey.reset()
		this.acc = 0
	}

	onMove(_ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		this.stacking = e.shiftKey
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (this.creatures) {
			this.spawns!.tick(ctx, dt, hit)
			return
		}
		if (!hit) return
		const brush = activeDoodadBrush()
		if (!brush) return
		if (this.erased) this.erase(ctx, hit, brush)
		else if (this.placed) this.scatter(ctx, hit, brush, dt)
	}

	onUp(ctx: ToolContext) {
		// A stroke ends where it began, even if the mode was switched under it.
		this.spawns?.onUp(ctx)
		const objects = this.objects
		if (objects && this.placed?.length) ctx.history.push(addedCommand(objects, this.placed, this.grid ? this.fillLabel : 'Doodad brush'))
		if (objects && this.erased?.length) ctx.history.push(removedCommand(objects, this.erased, 'Erase doodads'))
		this.placed = this.erased = this.objects = null
		this.placedIds.clear()
	}

	/** Shows the planned placements as ghost models under the hovering brush. */
	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		// Each mode shows only its own ghosts.
		this.spawns?.frame(ctx, this.creatures ? hit : null)
		const brush = activeDoodadBrush()
		const hovering = !this.creatures && !!hit && !this.placed && !this.erased && !!brush && brush.entries.length > 0
		if (!hovering) {
			this.ghosts.hideAll()
			return
		}
		this.ensurePlan(brush)
		this.ghosts.grow(this.plan.length)
		const t = ctx.terrain
		for (let i = 0; i < this.ghosts.length; i++) {
			this.ghosts.at(i).visible = false
			const p = this.plan[i]
			if (!p) continue
			const x = hit.x + p.dx
			const z = hit.z + p.dz
			const parent = this.propAt(ctx, x, z)
			if (parent === null && !this.groundAllows(ctx, brush, x, z)) continue
			const y = parent !== null ? this.pos.y : t.heightAt(x, z)
			const e = brush.entries[p.entry]
			const asset = getAsset(e.type)
			// A model still loading shows nothing rather than the placeholder box.
			if (!asset.ready) continue
			const g = this.ghosts.show(i, asset)
			g.visible = true
			g.position.set(x, y + e.sink, z)
			if (parent === null && this.groundTilt(t, x, z, p, e.align)) placementEuler(g.rotation, p.rotY, this.tilt.tiltX, this.tilt.tiltZ)
			else placementEuler(g.rotation, p.rotY, p.tiltX, p.tiltZ)
			g.scale.setScalar(p.scale)
		}
	}

	/** Draws the plan again when the brush or the settings it depends on changed. */
	private ensurePlan(brush: DoodadBrush) {
		const { radius, strength, falloff, curve } = editor.brush
		const key = this.planKey.begin().add(brush.name).add(brush.spacing).add(radius).add(strength).add(falloff).add(curve).add(editor.doodad.randomRot)
		for (const e of brush.entries) key.add(e.type).add(e.weight).add(e.scaleMin).add(e.scaleMax).add(e.tilt).add(e.align)
		if (!key.changed()) return
		this.plan = []
		this.spun = 0
		const want = Math.max(1, Math.min(MAX_PREVIEW, Math.round(attemptRate(radius, strength) / 4)))
		// The planned models keep the spacing among themselves (the press also checks the map).
		this.nearCount = 0
		let attempts = MAX_ATTEMPTS
		while (this.plan.length < want && attempts-- > 0) {
			const p = this.roll(brush, radius, falloff, curve)
			if (!p) continue
			if (!fits(p.dx, p.dz, p.size, brush.spacing, this.near, this.nearCount)) continue
			this.plan.push(p)
			this.pushNear(p.dx, p.dz, p.size)
		}
	}

	/** One placement drawn at random, relative to the brush centre; null when the falloff drops the point. */
	private roll(brush: DoodadBrush, radius: number, falloff: number, curve: typeof editor.brush.curve): Planned | null {
		if (!candidate(0, 0, radius, falloff, curve, Math.random, this.point)) return null
		const p = this.draw(brush)
		if (p) {
			p.dx = this.point[0]
			p.dz = this.point[1]
		}
		return p
	}

	/** One entry drawn by weight with its random scale, turn and tilt, at the brush centre; null for a brush without weight. */
	private draw(brush: DoodadBrush): Planned | null {
		const i = pickEntry(brush, Math.random())
		if (i < 0) return null
		const e = brush.entries[i]
		const scale = e.scaleMin + Math.random() * (e.scaleMax - e.scaleMin)
		const lim = (e.tilt * Math.PI) / 180
		return {
			dx: 0,
			dz: 0,
			entry: i,
			scale,
			rotY: this.own || editor.doodad.randomRot ? Math.random() * Math.PI * 2 : 0,
			tiltX: lim > 0 ? (Math.random() * 2 - 1) * lim : 0,
			tiltZ: lim > 0 ? (Math.random() * 2 - 1) * lim : 0,
			size: this.footprint(e.type, scale),
		}
	}

	/** The wider side of a model's footprint at `scale`, in yards. */
	private footprint(type: string, scale: number): number {
		const s = getAsset(type).bbox.getSize(this.size)
		return Math.max(MIN_FOOTPRINT, Math.max(s.x, s.z) * scale)
	}

	/** Fills `near` with what a placement under the brush must keep away from (nothing while stacking). */
	private prepareNear(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush) {
		// Models of a brush are at most a few yards wide; what stands a little beyond the brush still
		// keeps a placement at the edge away.
		if (this.stacking) this.nearCount = 0
		else this.gatherNear(ctx, hit, editor.brush.radius + 8 * Math.max(1, brush.spacing))
	}

	/**
	 * Gathers the root models within `reach` of the brush into `near`, and with On props the attached
	 * ones into `nearOn` (at their world position and world scale).
	 */
	private gatherNear(ctx: ToolContext, hit: THREE.Vector3, reach: number) {
		let n = 0
		let m = 0
		const L = ctx.objects
		// The roots from the layer's cells around the brush (#512).
		for (const o of L.rootsNear(hit.x, hit.z, reach, this.found)) {
			this.near = grow(this.near, n * 3 + 3)
			this.near[n * 3] = o.x
			this.near[n * 3 + 1] = o.z
			this.near[n * 3 + 2] = this.footprint(o.type, o.scale)
			n++
		}
		if (editor.doodad.onProps) {
			const r2 = reach * reach
			for (const o of L.attachedObjects(this.found)) {
				const w = L.worldPosition(o, this.pos)
				const dx = w.x - hit.x
				const dz = w.z - hit.z
				if (dx * dx + dz * dz > r2) continue
				this.nearOn = grow(this.nearOn, m * 4 + 4)
				this.nearOn[m * 4] = w.x
				this.nearOn[m * 4 + 1] = w.z
				// Spaced by its size on the map: its own scale times its parents'.
				this.nearOn[m * 4 + 2] = this.footprint(o.type, L.worldScale(o))
				this.nearOn[m * 4 + 3] = o.parent!
				m++
			}
		}
		this.found.length = 0
		this.nearCount = n
		this.nearOnCount = m
	}

	private pushNearOn(x: number, z: number, size: number, parent: number) {
		const m = this.nearOnCount
		this.nearOn = grow(this.nearOn, m * 4 + 4)
		this.nearOn[m * 4] = x
		this.nearOn[m * 4 + 1] = z
		this.nearOn[m * 4 + 2] = size
		this.nearOn[m * 4 + 3] = parent
		this.nearOnCount = m + 1
	}

	/**
	 * Whether the ground at (x, z) takes a placement: on the map, no hole (unless the brush's rules
	 * allow one), above the sea and not too steep, and within the brush's placement rules.
	 */
	private groundAllows(ctx: ToolContext, brush: DoodadBrush, x: number, z: number): boolean {
		const t = ctx.terrain
		if (!t.contains(x, z)) return false
		const rules = brush.rules
		if (t.isHole(x, z) && (rules?.avoidHoles ?? true)) return false
		if (!this.own) {
			const sea = editor.doodad.avoidWater && editor.waterEnabled ? editor.waterLevel : -Infinity
			if (t.heightAt(x, z) < sea) return false
			const max = editor.doodad.maxSlope
			if (max < 90 && groundSlopeDeg((px, pz) => t.heightAt(px, pz), x, z, t.cellSize) > max) return false
		}
		if (!rules) return true
		this.ground.at(ctx, x, z)
		return rulesAllow(rules, this.ground)
	}

	/**
	 * The tilt of a placement on the ground at (x, z), into `this.tilt`, when the ground sets it: Follow
	 * ground stands the model square to the ground, else the entry's `align` (0 to 1) leans it that far
	 * toward the slope on top of its own random tilt. Returns false when the ground has no say.
	 */
	private groundTilt(t: ToolContext['terrain'], x: number, z: number, p: Planned, align: number | undefined): boolean {
		const follow = editor.followGround && !this.own
		const amount = follow ? 1 : (align ?? 0)
		if (amount <= 0) return false
		groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
		tiltToNormal(this.normal.x, this.normal.y, this.normal.z, p.rotY, this.tilt)
		if (follow) return true
		this.tilt.tiltX = this.tilt.tiltX * amount + p.tiltX
		this.tilt.tiltZ = this.tilt.tiltZ * amount + p.tiltZ
		return true
	}

	/**
	 * With On props, the id of the prop whose surface is straight below the sky at (x, z) and above the
	 * ground, with its surface point left in `pos`; null for open ground. What this stroke placed never
	 * counts, so a brush doesn't pile onto its own models.
	 */
	private propAt(ctx: ToolContext, x: number, z: number): number | null {
		// A fill (which sets `grid`) lands on the ground only.
		if (!editor.doodad.onProps || this.grid) return null
		this.ensureProps(ctx, x, z)
		this.ray.ray.origin.set(x, RAY_TOP, z)
		this.ray.ray.direction.set(0, -1, 0)
		const hit = ctx.objects.raycastAmong(this.ray.ray, this.props, this.propCount, this.placedIds)
		if (!hit) return null
		const t = ctx.terrain
		if (t.contains(x, z) && hit.point.y < t.heightAt(x, z)) return null
		this.pos.copy(hit.point)
		return hit.id
	}

	/**
	 * Keeps `props` holding every model whose box may reach over the brush around (x, z): gathered again
	 * only when the point leaves the margin it was gathered with, or the map's models changed, so the
	 * per-point ray tests a handful of models, not every instance on the map.
	 */
	private ensureProps(ctx: ToolContext, x: number, z: number) {
		const layer = ctx.objects
		const margin = this.propReach * 0.25
		const dx = x - this.propCentre.x
		const dz = z - this.propCentre.z
		if (layer === this.propLayer && layer.version === this.propVersion && dx * dx + dz * dz <= margin * margin) return
		const reach = (editor.brush.radius + 8) * 1.5
		this.propLayer = layer
		this.propVersion = layer.version
		this.propReach = reach
		this.propCentre.set(x, 0, z)
		let n = 0
		// The roots whose box reaches over the brush, from the layer's cells (#512), then the attached
		// ones: the box's half diagonal across the ground, at the model's world scale, as its reach.
		for (const o of layer.rootsNear(x, z, reach, this.found, true)) n = this.pushProp(n, o.id)
		for (const o of layer.attachedObjects(this.found)) {
			const half = layer.groundReach(o.type, layer.worldScale(o))
			const w = layer.worldPosition(o, this.pos)
			const ox = w.x - x
			const oz = w.z - z
			const r = reach + half
			if (ox * ox + oz * oz <= r * r) n = this.pushProp(n, o.id)
		}
		this.found.length = 0
		this.propCount = n
	}

	private pushProp(n: number, id: number): number {
		this.props = grow(this.props, n + 1)
		this.props[n] = id
		return n + 1
	}

	private pushNear(x: number, z: number, size: number) {
		const n = this.nearCount
		this.near = grow(this.near, n * 3 + 3)
		this.near[n * 3] = x
		this.near[n * 3 + 1] = z
		this.near[n * 3 + 2] = size
		this.nearCount = n + 1
	}

	/**
	 * Puts a planned placement down at the brush at `hit`, unless it lands off the map, in a hole, under
	 * the sea, on too steep a slope, or (unless stacking) too close to what `near` holds. With On props
	 * it lands on the prop under the point instead, attached to it. Returns whether it was placed.
	 */
	private place(ctx: ToolContext, brush: DoodadBrush, hit: THREE.Vector3, p: Planned): boolean {
		const t = ctx.terrain
		const x = hit.x + p.dx
		const z = hit.z + p.dz
		const e = brush.entries[p.entry]
		const parent = this.propAt(ctx, x, z)
		if (parent !== null) {
			if (!this.stacking && !fitsOn(x, z, p.size, brush.spacing, this.nearOn, this.nearOnCount, parent)) return false
			const tilt = p.tiltX !== 0 || p.tiltZ !== 0 ? { tiltX: p.tiltX, tiltZ: p.tiltZ } : {}
			const o = ctx.objects.add({ type: e.type, x, z, yOff: e.sink, rotY: p.rotY, scale: p.scale, ...tilt })
			ctx.objects.place(o, parent, { pos: this.pos.clone().setY(this.pos.y + e.sink), rot: p.rotY, scale: p.scale })
			this.placed!.push(o)
			this.placedIds.add(o.id)
			if (!this.stacking) this.pushNearOn(x, z, p.size, parent)
			return true
		}
		if (!this.groundAllows(ctx, brush, x, z)) return false
		if (!this.stacking && !(this.grid ? this.grid.fits(x, z, p.size, brush.spacing) : fits(x, z, p.size, brush.spacing, this.near, this.nearCount))) return false
		let tilt: { tiltX?: number; tiltZ?: number } = {}
		if (this.groundTilt(t, x, z, p, e.align)) {
			tilt = { ...this.tilt }
		} else if (p.tiltX !== 0 || p.tiltZ !== 0) {
			tilt = { tiltX: p.tiltX, tiltZ: p.tiltZ }
		}
		const o = ctx.objects.add({ type: e.type, x, z, yOff: e.sink, rotY: p.rotY, scale: p.scale, ...tilt })
		this.placed!.push(o)
		this.placedIds.add(o.id)
		if (this.grid) this.grid.add(x, z, p.size)
		else if (!this.stacking) this.pushNear(x, z, p.size)
		return true
	}

	/**
	 * Terrain › Fill Selection / Fill Mask with Doodad Brush (#169): runs the brush over the whole area
	 * at once, as many attempts as holding the brush there at its strength would make, each point
	 * uniform in the area (with the mask, kept by the mask's value there), within the brush's rules and
	 * spacing. Lands on the ground only (not on props). One undo step. Returns how many were placed.
	 * `opts` set the attempts, a keep chance by place and the brush's rules alone (a new world's trees, #758).
	 */
	fill(ctx: ToolContext, brush: DoodadBrush, area: { x0: number; z0: number; x1: number; z1: number }, mask: Uint8Array | null, opts: FillOptions = {}): number {
		if (!brush.entries.length) return 0
		const t = ctx.terrain
		const cs = t.cellSize
		const wx0 = area.x0 * cs
		const wz0 = area.z0 * cs
		const w = (area.x1 - area.x0) * cs
		const h = (area.z1 - area.z0) * cs
		if (w <= 0 || h <= 0) return 0
		const R = t.splatRes
		const ts = t.worldSize / R
		this.objects = ctx.objects
		this.placed = []
		this.placedIds.clear()
		this.stacking = false
		this.grid = new SpacingGrid()
		this.own = !!opts.own
		this.fillLabel = opts.label ?? 'Fill with doodad brush'
		// What already stands in or near the area keeps the new models away.
		const pad = 8 * Math.max(1, brush.spacing)
		for (const o of ctx.objects.objects.values()) {
			if (o.parent !== undefined || o.x < wx0 - pad || o.z < wz0 - pad || o.x > wx0 + w + pad || o.z > wz0 + h + pad) continue
			this.grid.add(o.x, o.z, this.footprint(o.type, o.scale))
		}
		try {
			const at = new THREE.Vector3()
			let attempts = opts.attempts ?? fillAttempts(w * h, editor.brush.strength)
			const keep = opts.keep
			while (attempts-- > 0) {
				const x = wx0 + Math.random() * w
				const z = wz0 + Math.random() * h
				if (mask) {
					const tx = Math.min(R - 1, Math.floor(x / ts))
					const tz = Math.min(R - 1, Math.floor(z / ts))
					if (Math.random() * 255 >= mask[tz * R + tx]) continue
				}
				if (keep && Math.random() >= keep(x, z)) continue
				const p = this.draw(brush)
				if (!p) continue
				this.place(ctx, brush, at.set(x, 0, z), p)
			}
			const n = this.placed.length
			this.onUp(ctx)
			return n
		} finally {
			this.grid = null
			this.placed = null
			this.own = false
		}
	}

	private scatter(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush, dt: number) {
		const { radius, strength, falloff, curve } = editor.brush
		this.acc += attemptRate(radius, strength * ctx.pressure()) * dt
		let attempts = Math.min(MAX_ATTEMPTS, Math.floor(this.acc))
		if (attempts <= 0) return
		this.acc -= attempts
		this.prepareNear(ctx, hit, brush)
		while (attempts-- > 0) {
			const p = this.roll(brush, radius, falloff, curve)
			if (p) this.place(ctx, brush, hit, p)
		}
	}

	/** Removes the brush's models (with anything attached to them) whose ground point is under the brush. */
	private erase(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush) {
		const types = new Set(brush.entries.map((e) => e.type))
		const gone = new Set<number>()
		for (const o of ctx.objects.rootsNear(hit.x, hit.z, editor.brush.radius, this.found)) {
			if (types.has(o.type) && ctx.objects.pickable(o.id)) gone.add(o.id)
		}
		this.found.length = 0
		ctx.objects.descendantsOf(gone, gone)
		for (const id of gone) {
			const o = ctx.objects.objects.get(id)
			if (!o) continue
			this.erased!.push({ ...o })
			ctx.objects.remove(id)
			if (editor.selected?.id === id) editor.selected = null
		}
	}
}
