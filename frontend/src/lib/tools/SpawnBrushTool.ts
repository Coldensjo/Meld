import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import type { Tool, ToolContext } from './Tool'
import { editor, prefs, setStatus } from '../state/editor.svelte'
import type { Command } from '../state/history'
import { getAsset } from '../models/assets'
import { GhostPool } from './ghosts'
import { grow } from './typedArray'
import { spawnType } from '../world/spawnInfo'
import { spawnAdd, spawnDelete, spawnsBatch } from '../world/spawnEdits'
import { spawnKey, spawnOrientation } from '../world/SpawnLayer'
import { groundSlopeDeg } from '../world/groundTilt'
import { rulesAllow, rulesEmpty } from './doodadBrush'
import { ToolGround } from './toolGround'
import { InputsKey } from './inputsKey'
import { brushLevels, facingTurn, pickSpawnEntry, spacedOut, targetCount, type SpawnBrush, type SpawnBrushEntry } from './spawnBrush'

/** What the spawn brush needs from the Engine. */
export interface SpawnBrushHooks {
	/**
	 * A new creature spawn of template `e` at (x, y, z) facing `orientation` (the server's), with a guid
	 * of its own; null while the template's look or the next guid is still being read (asked for then).
	 */
	newCreature(e: SpawnBrushEntry, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn | null
	/** What the creature of `e` looks like, as a spawn type for its ghost; '' while it loads. */
	ghostType(e: SpawnBrushEntry): string
	/** The size the creature of `e` is drawn at once placed (#672): its template's scale times its display's. */
	ghostScale(e: SpawnBrushEntry): number
}

/** Most placements tried a frame while the button is held. */
const ATTEMPTS = 6
/** Most creatures the preview shows. */
const MAX_PREVIEW = 12

/** One creature drawn ahead, relative to the brush centre. */
interface Planned {
	dx: number
	dz: number
	entry: number
	turn: number
}

/**
 * The Doodad tool's Creatures mode (#171): while the button is held, the brush fills the ground under it
 * with creatures of its templates (drawn by weight) up to its density, each at least its spacing from
 * every creature, on ground its slope and water rules allow, with the brush's level, wander, movement
 * and respawn. Ctrl+drag deletes the brush's templates' creatures under it. A stroke is one undo step,
 * and the spawns are unsaved spawn edits like any placed creature. While it hovers, the next creatures
 * show as ghosts, and the press puts those down first.
 */
export class SpawnBrushTool implements Tool {
	readonly usesBrush = true
	private cmds: Command[] | null = null
	private erasing = false
	/** Creature positions near the brush (x, z pairs) the spacing keeps away from. */
	private near = new Float32Array(2 * 256)
	private nearCount = 0
	private plan: Planned[] = []
	private planKey = new InputsKey()
	private ghosts = new GhostPool()
	/** The model types of the ghosts shown now, which the Engine poses (#328). */
	private ghostTypes = new Set<string>()
	private ray = new THREE.Raycaster()

	constructor(private hooks: SpawnBrushHooks) {}

	activate(ctx: ToolContext) {
		this.ghosts.attach(ctx.scene)
	}

	deactivate(ctx: ToolContext) {
		this.ghosts.detach(ctx.scene)
		this.ghostTypes.clear()
		this.plan = []
		this.planKey.reset()
	}

	/** Whether a ghost of model `type` shows under the brush, so its idle plays though no spawn of it is in view. */
	previewing(type: string): boolean {
		return this.ghostTypes.has(type)
	}

	private get brush(): SpawnBrush {
		return prefs.spawnBrush
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		if (!hit) return
		const brush = this.brush
		if (!brush.entries.length) {
			setStatus("The spawn brush has no creatures yet: pick some in the browser's Creatures tab below.", 6000)
			return
		}
		this.cmds = []
		this.erasing = e.ctrlKey
		if (this.erasing) {
			this.erase(ctx, hit)
			return
		}
		// The previewed creatures land first, so a click puts down what was shown.
		this.gatherNear(ctx, hit)
		for (const p of this.plan) this.place(ctx, hit, p.dx, p.dz, p.entry, p.turn)
		this.plan = []
		this.planKey.reset()
	}

	tick(ctx: ToolContext, _dt: number, hit: THREE.Vector3 | null) {
		if (!hit || !this.cmds) return
		if (this.erasing) {
			this.erase(ctx, hit)
			return
		}
		const brush = this.brush
		const radius = editor.brush.radius
		let missing = targetCount(brush.density, radius) - this.countUnder(ctx, hit, radius)
		if (missing <= 0) return
		this.gatherNear(ctx, hit)
		for (let a = 0; a < ATTEMPTS && missing > 0; a++) {
			const p = this.roll(hit, radius)
			if (p && this.place(ctx, hit, p.dx, p.dz, p.entry, p.turn)) missing--
		}
	}

	onUp(ctx: ToolContext) {
		const cmds = this.cmds
		this.cmds = null
		if (!cmds?.length) return
		const n = cmds.length
		const label = this.erasing ? `Erase ${n} creature${n === 1 ? '' : 's'}` : `Spawn brush (${n} creature${n === 1 ? '' : 's'})`
		ctx.history.push({
			label,
			undo: () =>
				spawnsBatch(ctx.spawns, () => {
					for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo()
				}),
			redo: () =>
				spawnsBatch(ctx.spawns, () => {
					for (const c of cmds) c.redo()
				}),
		})
		setStatus(`${label}. Save them with File › Save Spawns.`, 4000)
	}

	/** Shows the next creatures the press would put down, under the hovering brush. */
	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		const brush = this.brush
		this.ghostTypes.clear()
		if (!hit || this.cmds || !brush.entries.length) {
			this.ghosts.hideAll()
			return
		}
		this.ensurePlan(ctx, hit)
		this.ghosts.grow(this.plan.length)
		for (let i = 0; i < this.ghosts.length; i++) {
			this.ghosts.at(i).visible = false
			const p = this.plan[i]
			if (!p) continue
			const x = hit.x + p.dx
			const z = hit.z + p.dz
			const y = this.groundAllows(ctx, x, z) ? this.surfaceY(ctx, hit, x, z) : null
			const type = y === null ? '' : this.hooks.ghostType(brush.entries[p.entry])
			const asset = type ? getAsset(type) : null
			if (!asset?.ready || y === null) continue
			const g = this.ghosts.show(i, asset)
			g.visible = true
			this.ghostTypes.add(type)
			g.position.set(x, y, z)
			g.rotation.set(0, p.turn, 0)
			g.scale.setScalar(this.hooks.ghostScale(brush.entries[p.entry]))
		}
	}

	/** Draws the next creatures again when the brush moved a quarter of its radius, or the brush or the spawns changed. */
	private ensurePlan(ctx: ToolContext, hit: THREE.Vector3) {
		const brush = this.brush
		const radius = editor.brush.radius
		const step = Math.max(1, radius * 0.25)
		const key = this.planKey
			.begin()
			.add(Math.round(hit.x / step))
			.add(Math.round(hit.z / step))
			.add(radius)
			.add(ctx.spawns.changeStamp)
		key.add(brush.density).add(brush.spacing).add(brush.facing).add(brush.maxSlope).add(brush.avoidWater)
		for (const e of brush.entries) key.add(e.entry).add(e.weight)
		if (!key.changed()) return
		this.plan = []
		const want = Math.min(MAX_PREVIEW, targetCount(brush.density, radius) - this.countUnder(ctx, hit, radius))
		if (want <= 0) return
		this.gatherNear(ctx, hit)
		for (let a = 0; a < want * 8 && this.plan.length < want; a++) {
			const p = this.roll(hit, radius)
			if (!p) continue
			const x = hit.x + p.dx
			const z = hit.z + p.dz
			if (!this.groundAllows(ctx, x, z) || !spacedOut(x, z, brush.spacing, this.near, this.nearCount)) continue
			this.plan.push(p)
			this.pushNear(x, z)
		}
	}

	/** A creature drawn by weight at a uniform point of the brush circle, facing as the brush says. */
	private roll(hit: THREE.Vector3, radius: number): Planned | null {
		const brush = this.brush
		const i = pickSpawnEntry(brush.entries, Math.random())
		if (i < 0) return null
		const a = Math.random() * Math.PI * 2
		const r = radius * Math.sqrt(Math.random())
		const dx = Math.cos(a) * r
		const dz = Math.sin(a) * r
		return { dx, dz, entry: i, turn: facingTurn(brush.facing, hit.x + dx, hit.z + dz, hit.x, hit.z, Math.random()) }
	}

	/** Puts a creature of entry `i` down at the brush point (dx, dz) when the ground and spacing allow it. Returns whether it did. */
	private place(ctx: ToolContext, hit: THREE.Vector3, dx: number, dz: number, i: number, turn: number): boolean {
		const brush = this.brush
		const e = brush.entries[i]
		if (!e) return false
		const x = hit.x + dx
		const z = hit.z + dz
		if (!this.groundAllows(ctx, x, z) || !spacedOut(x, z, brush.spacing, this.near, this.nearCount)) return false
		const y = this.surfaceY(ctx, hit, x, z)
		if (y === null) return false
		const s = this.hooks.newCreature(e, x, y, z, spawnOrientation(turn))
		if (!s) return false
		const lv = brushLevels(brush, e)
		s.levelMin = lv.min
		s.levelMax = lv.max
		s.movementType = brush.movement === 'random' && brush.wander > 0 ? 1 : 0
		s.wanderDistance = s.movementType ? brush.wander : 0
		s.respawnSecs = s.respawnMaxSecs = Math.max(0, Math.round(brush.respawnSecs))
		this.cmds!.push(spawnAdd(ctx.spawns, s, `Add ${e.name}`))
		this.pushNear(x, z)
		return true
	}

	/**
	 * The height a creature at (x, z) stands at: the ground, or, when the brush is on a model (a mine's
	 * floor, a bridge), the model's floor under the point near the brush's height (a ceiling passed
	 * through, #660). Null where a brush under the ground finds no floor (past a cave's wall), since
	 * the ground there is far overhead.
	 */
	private surfaceY(ctx: ToolContext, hit: THREE.Vector3, x: number, z: number): number | null {
		const ground = ctx.terrain.heightAt(x, z)
		if (Math.abs(hit.y - ground) < 0.5 && !ctx.terrain.isHole(hit.x, hit.z)) return ground
		this.ray.ray.origin.set(x, hit.y + 4, z)
		this.ray.ray.direction.set(0, -1, 0)
		this.ray.far = 12
		const s = ctx.objects.raycastFloor(this.ray)
		if (s) return s.point.y
		return ground > hit.y + 4 ? null : ground
	}

	/** Whether the brush's rules let a creature stand at (x, z): on the map, no hole, not too steep, and out of water if asked. */
	/** The ground the placement rules look at, reused for every check. */
	private ground = new ToolGround()

	private groundAllows(ctx: ToolContext, x: number, z: number): boolean {
		const t = ctx.terrain
		const brush = this.brush
		if (!t.contains(x, z)) return false
		const g = t.heightAt(x, z)
		if (brush.maxSlope < 90 && groundSlopeDeg((px, pz) => t.heightAt(px, pz), x, z, t.cellSize) > brush.maxSlope) return false
		if (brush.avoidWater && ((editor.waterEnabled && g < editor.waterLevel) || ctx.liquids.covers(x, z, t.cellSize, g))) return false
		if (brush.rules && !rulesEmpty(brush.rules)) {
			this.ground.at(ctx, x, z)
			if (!rulesAllow(brush.rules, this.ground)) return false
		}
		return true
	}

	/** How many creatures of the brush's templates stand in the circle. */
	private countUnder(ctx: ToolContext, hit: THREE.Vector3, radius: number): number {
		const entries = new Set(this.brush.entries.map((e) => e.entry))
		const r2 = radius * radius
		let n = 0
		for (const s of ctx.spawns.spawns) {
			if (s.kind === 'object' || !entries.has(s.entry)) continue
			const dx = s.x - hit.x
			const dz = s.z - hit.z
			if (dx * dx + dz * dz <= r2) n++
		}
		return n
	}

	/** Gathers every creature within the brush and its spacing around it into `near`. */
	private gatherNear(ctx: ToolContext, hit: THREE.Vector3) {
		const reach = editor.brush.radius + this.brush.spacing
		const r2 = reach * reach
		this.nearCount = 0
		for (const s of ctx.spawns.spawns) {
			if (s.kind === 'object') continue
			const dx = s.x - hit.x
			const dz = s.z - hit.z
			if (dx * dx + dz * dz <= r2) this.pushNear(s.x, s.z)
		}
	}

	private pushNear(x: number, z: number) {
		const n = this.nearCount
		this.near = grow(this.near, n * 2 + 2)
		this.near[n * 2] = x
		this.near[n * 2 + 1] = z
		this.nearCount = n + 1
	}

	/** Deletes the creatures of the brush's templates under it. */
	private erase(ctx: ToolContext, hit: THREE.Vector3) {
		const entries = new Set(this.brush.entries.map((e) => e.entry))
		const r2 = editor.brush.radius * editor.brush.radius
		const gone = ctx.spawns.spawns.filter((s) => s.kind !== 'object' && entries.has(s.entry) && (s.x - hit.x) ** 2 + (s.z - hit.z) ** 2 <= r2)
		for (const s of gone) {
			const c = spawnDelete(ctx.spawns, spawnKey(s), `Delete ${s.name}`)
			if (c) this.cmds!.push(c)
		}
	}
}
