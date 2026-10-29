import { pressed } from '../ui/commands'
import * as THREE from 'three'
import { editor, prefs, setStatus, setViewportHint, ui } from '../state/editor.svelte'
import { selectObjects } from '../state/selection'
import { getAsset } from '../models/assets'
import type { WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import type { FitOptions } from '../terrain/fitGround'
import type { Tool, ToolContext } from './Tool'
import { groundNormal, tiltToNormal } from '../world/groundTilt'
import { GhostPool } from './ghosts'
import { clampScale, placementEuler, stepTilt } from '../world/placement'
import { SpacingGrid } from './doodadBrush'
import { addedCommand } from '../world/objectCommands'

const TILT_LIMIT = (8 * Math.PI) / 180

/** A tilt in whole tenths of a degree, for the viewport hint. */
export function tiltDeg(r: number): number {
	return Math.round((r * 1800) / Math.PI) / 10
}

/** A random tilt each way, up to TILT_LIMIT, when random tilt is on; nothing otherwise. */
function randomTilt(): { tiltX?: number; tiltZ?: number } {
	if (!editor.placeRandomTilt) return {}
	return { tiltX: (Math.random() * 2 - 1) * TILT_LIMIT, tiltZ: (Math.random() * 2 - 1) * TILT_LIMIT }
}

/** One Shift+scroll notch scales the placement preview by this much. */
const SCALE_STEP = 1.1

/**
 * The size the creature or game object template being placed is drawn at (#672): a creature's
 * template scale times its display's, an object's template size, as `newCreatureSpawn` and
 * `newObjectSpawn` give the spawn; null when a model is placed.
 */
function placingSpawnScale(): number | null {
	const c = ui.placeCreature
	if (c) return (c.scale || 1) * (c.displayScale || 1)
	const o = ui.placeObject
	return o ? o.size || 1 : null
}

export class PlaceTool implements Tool {
	get usesBrush() {
		return editor.placeScatter
	}

	/** The preview of the next placement: one ghost. */
	private ghosts = new GhostPool()
	private ghostType = ''
	/** The preview mesh (the probes read it). */
	get ghost() {
		return this.ghosts.at(0)
	}
	private rot = 0
	private scale = 1
	private tilt: { tiltX?: number; tiltZ?: number } = {}
	/** A tilt set by hand (hold Z and scroll, #344): replaces Random tilt and Follow ground rotation while set. */
	private handTilt: { tiltX: number; tiltZ: number } | null = null
	private scattering: WorldObject[] | null = null
	/** The stroke's scattered props by place, for the spacing between them. */
	private scatterGrid: SpacingGrid | null = null
	private scatterSize = new THREE.Vector3()
	private scatterAcc = 0
	private normal = { x: 0, y: 1, z: 0 }
	private ghostTilt = { tiltX: 0, tiltZ: 0 }
	/** Alt is held: the preview steps aside so the pipette can see what is under the pointer. */
	hidePreview = false
	private point = new THREE.Vector3()

	constructor(
		private hooks: {
			/** Spawns the creature or object template being placed (ui.placeCreature / ui.placeObject) at a point. */
			placeSpawn: (at: THREE.Vector3, rotY?: number) => void
			/** Fits the ground under the model `id` just placed (Fit ground, #207), already applied; null when nothing changed. */
			fitGround: (id: number, fit: FitOptions) => Command | null
		},
	) {
		this.ghosts.grow(1)
	}

	/**
	 * The tilt a model turned `rotY` needs to stand on the ground at (x, z) with Follow ground rotation on,
	 * the same as the Select tool's drag. Written into `out`.
	 */
	private groundTilt(ctx: ToolContext, x: number, z: number, rotY: number, out: { tiltX: number; tiltZ: number }) {
		const t = ctx.terrain
		groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
		return tiltToNormal(this.normal.x, this.normal.y, this.normal.z, rotY, out)
	}

	activate(ctx: ToolContext) {
		this.ghosts.attach(ctx.scene)
	}

	/**
	 * Where a placement goes for the surface under the cursor: the arrows' offset away from it (on open
	 * ground, back on the ground there) and the height above it. Written into `this.point`.
	 */
	private placePoint(ctx: ToolContext, surf: { point: THREE.Vector3; parent: number | null }) {
		const p = this.point.copy(surf.point)
		const { x, z } = editor.placeOffset
		if (x !== 0 || z !== 0) {
			p.x += x
			p.z += z
			if (surf.parent === null && ctx.terrain.contains(p.x, p.z)) p.y = ctx.terrain.heightAt(p.x, p.z)
		}
		p.y += editor.placeHeight
		return p
	}

	/** Moves the preview's offset from the cursor by (right, forward) in the camera's view. */
	private moveOffset(ctx: ToolContext, right: number, forward: number) {
		const yaw = ctx.cameraYaw()
		const fx = -Math.sin(yaw)
		const fz = -Math.cos(yaw)
		const o = editor.placeOffset
		const x = Math.round((o.x + fx * forward - fz * right) * 100) / 100
		const z = Math.round((o.z + fz * forward + fx * right) * 100) / 100
		editor.placeOffset = { x, z }
		setViewportHint(`Offset ${Math.hypot(x, z).toFixed(2)} from the cursor`)
	}

	deactivate(ctx: ToolContext) {
		this.ghosts.detach(ctx.scene)
	}

	/** Rotate the placement preview (Ctrl+scroll). The next click uses this rotation. */
	rotatePreview(radians: number) {
		this.rot += radians
		// Shown as a compass heading in 0..360, rounded so 15° notches read as whole degrees.
		const deg = Math.round(THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(this.rot), 360))
		setViewportHint(`Rotation ${deg % 360}°`)
	}

	/**
	 * Tilt (forward or back) or roll (to a side, `roll`) the placement preview by `degrees` (hold Z and
	 * scroll). The next clicks use this tilt instead of Random tilt and Follow ground rotation, until
	 * both angles are scrolled back to 0.
	 */
	tiltPreview(degrees: number, roll: boolean) {
		const t = this.handTilt ?? { tiltX: 0, tiltZ: 0 }
		if (roll) t.tiltZ = stepTilt(t.tiltZ, degrees)
		else t.tiltX = stepTilt(t.tiltX, degrees)
		this.handTilt = t.tiltX === 0 && t.tiltZ === 0 ? null : t
		setViewportHint(this.handTilt ? `Tilt ${tiltDeg(t.tiltX)}°, roll ${tiltDeg(t.tiltZ)}°` : 'Upright (Random tilt and Follow ground rotation apply again)')
	}

	/**
	 * Scale the placement preview by `steps` notches (Shift+scroll), within the Properties panel's range.
	 * The scale sits on a ladder of powers of SCALE_STEP, so step 0 is exactly 1 and scrolling back always
	 * returns to it; a random scale snaps to the nearest rung on the first notch. The next click uses
	 * this scale. A WMO stays at 1: the 1.12 client draws buildings at full size only (MODF has no
	 * scale), while a doodad's MDDF scale is honoured.
	 */
	scalePreview(steps: number) {
		if (editor.prefab.startsWith('wmo:')) {
			setStatus('Buildings (WMOs) cannot be scaled: the 1.12 client always draws them at full size.', 3000)
			return
		}
		if (placingSpawnScale() !== null) {
			setStatus('A creature or game object takes its size from its template, not from the Place tool.', 3000)
			return
		}
		const rung = Math.round(Math.log(this.scale) / Math.log(SCALE_STEP)) + steps
		this.scale = rung === 0 ? 1 : clampScale(SCALE_STEP ** rung)
		setViewportHint(`Scale ×${this.scale.toFixed(2)}`)
	}

	private reroll() {
		this.rot = editor.placeRandomRot ? Math.random() * Math.PI * 2 : this.rot
		this.scale = editor.placeRandomScale ? 0.8 + Math.random() * 0.45 : 1
		this.tilt = randomTilt()
	}

	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (this.ghostType !== editor.prefab) {
			this.ghostType = editor.prefab
			this.reroll()
		}
		// Async models swap from placeholder to the real mesh when loaded.
		const ghost = this.ghosts.show(0, getAsset(editor.prefab))
		// The preview sits on whatever is under the cursor: terrain, a building, another prop.
		// A creature or object template stands on a floor (#660), a model goes on whatever is hit.
		const surf = hit ? (ui.placeCreature || ui.placeObject ? ctx.floor() : ctx.surface()) : null
		ghost.visible = !!surf && !editor.placeScatter && !!editor.prefab && !this.hidePreview
		if (surf && hit) {
			const p = this.placePoint(ctx, surf)
			ghost.position.copy(p)
			// On open ground with Follow ground rotation, the preview leans to the slope it will land on.
			if (this.handTilt) {
				placementEuler(ghost.rotation, this.rot, this.handTilt.tiltX, this.handTilt.tiltZ)
			} else if (editor.followGround && surf.parent === null) {
				this.groundTilt(ctx, p.x, p.z, this.rot, this.ghostTilt)
				placementEuler(ghost.rotation, this.rot, this.ghostTilt.tiltX, this.ghostTilt.tiltZ)
			} else {
				placementEuler(ghost.rotation, this.rot)
			}
			ghost.scale.setScalar(placingSpawnScale() ?? this.scale)
		}
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		if (!hit) return
		// A creature or object template from the browser's spawn tabs is spawned, not placed as a model.
		if (ui.placeCreature || ui.placeObject) {
			const surf = ctx.floor() ?? { point: hit.clone(), parent: null }
			this.hooks.placeSpawn(this.placePoint(ctx, surf).clone().setY(surf.point.y), this.rot)
			return
		}
		if (!editor.prefab) {
			setStatus('Pick a model in the palette first.')
			return
		}
		if (editor.placeScatter || e.shiftKey) {
			this.scattering = []
			this.scatterGrid = new SpacingGrid()
			this.scatterAcc = 1
			return
		}
		// Attach to the building/prop under the cursor, or sit on the ground.
		const surf = ctx.surface() ?? { point: hit.clone(), parent: null }
		const p = this.placePoint(ctx, surf)
		// A hand tilt wins; otherwise on open ground Follow ground rotation replaces Random tilt with the slope's tilt.
		const tilt = this.handTilt ? { ...this.handTilt } : editor.followGround && surf.parent === null ? this.groundTilt(ctx, p.x, p.z, this.rot, { tiltX: 0, tiltZ: 0 }) : this.tilt
		const o = ctx.objects.add({ type: editor.prefab, x: p.x, z: p.z, yOff: 0, rotY: this.rot, scale: this.scale, ...tilt })
		ctx.objects.place(o, surf.parent, {
			pos: p.clone(),
			rot: this.rot,
			scale: this.scale,
		})
		const add = addedCommand(ctx.objects, [o], surf.parent !== null ? 'Place (attached)' : 'Place')
		// With Fit ground on, a model on open ground has the ground fitted under it in the same undo step.
		const fit = prefs.placeFitGround && surf.parent === null ? this.hooks.fitGround(o.id, { ...prefs.fitGround }) : null
		ctx.history.push(
			fit
				? {
						label: 'Place and fit ground',
						undo: () => {
							fit.undo()
							add.undo()
						},
						redo: () => {
							add.redo()
							fit.redo()
						},
					}
				: add,
		)
		// The new object stays selected so it can be nudged/spun with the keys.
		selectObjects(ctx.objects, [o.id])
		this.reroll()
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (!this.scattering || !this.scatterGrid || !hit) return
		const { radius, strength } = editor.brush
		const size = getAsset(editor.prefab).bbox.getSize(this.scatterSize)
		const spacing = Math.max(0.8, Math.max(size.x, size.z) * 0.8)
		this.scatterAcc += dt * (2 + strength * 20)
		while (this.scatterAcc >= 1) {
			this.scatterAcc -= 1
			const a = Math.random() * Math.PI * 2
			const r = Math.sqrt(Math.random()) * radius
			const x = hit.x + Math.cos(a) * r
			const z = hit.z + Math.sin(a) * r
			if (!ctx.terrain.contains(x, z)) continue
			// Keep a minimum spacing between same-type props in this stroke.
			if (!this.scatterGrid.fits(x, z, 1, spacing)) continue
			const rotY = Math.random() * Math.PI * 2
			const o = ctx.objects.add({
				type: editor.prefab,
				x,
				z,
				yOff: 0,
				rotY,
				scale: editor.placeRandomScale ? 0.75 + Math.random() * 0.5 : 1,
				...(editor.followGround ? this.groundTilt(ctx, x, z, rotY, { tiltX: 0, tiltZ: 0 }) : randomTilt()),
			})
			this.scattering.push(o)
			this.scatterGrid.add(x, z, 1)
		}
	}

	onUp(ctx: ToolContext) {
		if (this.scattering?.length) ctx.history.push(addedCommand(ctx.objects, this.scattering, 'Scatter'))
		this.scattering = null
		this.scatterGrid = null
	}

	/**
	 * Keys for the preview. With an object selected the engine's selection keys come first (R spins
	 * it, the arrows and PgUp / PgDn move it), so these act on the preview when nothing is selected.
	 */
	onKey(ctx: ToolContext, e: KeyboardEvent) {
		if (pressed('spin', e)) {
			this.rot += (e.shiftKey ? -1 : 1) * (Math.PI / 4)
			return true
		}
		if (!editor.prefab || editor.placeScatter) return false
		const step = e.shiftKey ? 4 : 0.5
		const lift = e.shiftKey ? 1 : 0.25
		if (pressed('nudgeLeft', e)) this.moveOffset(ctx, -step, 0)
		else if (pressed('nudgeRight', e)) this.moveOffset(ctx, step, 0)
		else if (pressed('nudgeForward', e)) this.moveOffset(ctx, 0, step)
		else if (pressed('nudgeBack', e)) this.moveOffset(ctx, 0, -step)
		else if (pressed('liftUp', e) || pressed('liftDown', e)) {
			editor.placeHeight = Math.round((editor.placeHeight + (pressed('liftUp', e) ? lift : -lift)) * 100) / 100
			setViewportHint(`Height ${editor.placeHeight >= 0 ? '+' : ''}${editor.placeHeight.toFixed(2)}`)
		} else return false
		return true
	}
}
