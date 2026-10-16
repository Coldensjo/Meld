import * as THREE from 'three'
import { editorPoint } from '../io/portCoords'

// Area triggers (#141): the client's AreaTrigger.dbc volumes of the open map, which tell the server a
// player walked in (a dungeon portal teleports them). Drawn as wire spheres and boxes, the selected
// one brighter, while View › Area triggers is on or the Portals dialog is open.

/** A trigger's volume in the server's coordinates (vmangos.AreaTrigger's geometry). */
export interface TriggerShape {
	id: number
	x: number
	y: number
	z: number
	radius: number
	boxX: number
	boxY: number
	boxZ: number
	boxYaw: number
}

/** Segments a circle of a sphere is drawn with. */
const CIRCLE_SEGMENTS = 32

/**
 * The line segments (pairs of editor-space points, three numbers each) that draw a trigger in the
 * editor's map of a block whose first tile is (tileX, tileY): three great circles of a sphere, or a
 * box's twelve edges.
 */
export function triggerLines(t: TriggerShape, tileX: number, tileY: number, out: number[] = []): number[] {
	const push = (p: { x: number; y: number; z: number }) => out.push(p.x, p.y, p.z)
	if (t.radius > 0) {
		const c = editorPoint(t, tileX, tileY)
		const r = t.radius
		for (let axis = 0; axis < 3; axis++) {
			for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
				for (const k of [i, i + 1]) {
					const a = (k / CIRCLE_SEGMENTS) * Math.PI * 2
					const u = Math.cos(a) * r, v = Math.sin(a) * r
					push(axis === 0 ? { x: c.x + u, y: c.y + v, z: c.z } : axis === 1 ? { x: c.x, y: c.y + u, z: c.z + v } : { x: c.x + u, y: c.y, z: c.z + v })
				}
			}
		}
		return out
	}
	// The box's corners on the server, turned by its yaw about Z, then each taken to the editor.
	const cos = Math.cos(t.boxYaw), sin = Math.sin(t.boxYaw)
	const hx = t.boxX / 2, hy = t.boxY / 2, hz = t.boxZ / 2
	const corner = (i: number) => {
		const lx = i & 1 ? hx : -hx, ly = i & 2 ? hy : -hy, lz = i & 4 ? hz : -hz
		return editorPoint({ x: t.x + lx * cos - ly * sin, y: t.y + lx * sin + ly * cos, z: t.z + lz }, tileX, tileY)
	}
	for (let i = 0; i < 8; i++) {
		for (const bit of [1, 2, 4]) {
			if (i & bit) continue
			push(corner(i))
			push(corner(i | bit))
		}
	}
	return out
}

/** Draws a map's triggers as wire volumes: the selected one in yellow, the others in violet. */
export class AreaTriggerLayer {
	readonly group = new THREE.Group()
	private all: THREE.LineSegments
	private picked: THREE.LineSegments

	constructor() {
		this.all = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.8, fog: false }))
		this.picked = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, fog: false }))
		this.picked.renderOrder = 10
		this.group.add(this.all, this.picked)
		this.group.visible = false
	}

	/** Draws `triggers` (server coordinates) in the block whose first tile is (tileX, tileY), `selected` highlighted. */
	set(triggers: readonly TriggerShape[], tileX: number, tileY: number, selected: number | null) {
		const rest: number[] = []
		const sel: number[] = []
		for (const t of triggers) triggerLines(t, tileX, tileY, t.id === selected ? sel : rest)
		this.all.geometry.dispose()
		this.all.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rest, 3))
		this.picked.geometry.dispose()
		this.picked.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sel, 3))
	}

	dispose() {
		this.all.geometry.dispose()
		this.picked.geometry.dispose()
		;(this.all.material as THREE.Material).dispose()
		;(this.picked.material as THREE.Material).dispose()
	}
}
