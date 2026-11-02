import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { editorPoint } from '../io/portCoords'

// Graveyards (#947): the open map's WorldSafeLocs rows, where a dead player's ghost goes, drawn while
// World › Graveyards edits them. Each is a post topped by a cross coloured by whom its zone links are
// for, with a line along the ground the way a ghost faces when it arrives; the picked one is yellow.

/** A graveyard in the server's coordinates (vmangos.Graveyard): its spot, facing (radians) and links' factions. */
export interface GraveyardShape {
	id: number
	x: number
	y: number
	z: number
	o: number
	links: readonly { zone: number; faction: number }[]
}

/** The factions of a link (game_graveyard_zone.faction). */
export const ANYONE = 0
export const HORDE = 67
export const ALLIANCE = 469

/** How high the cross stands over the graveyard, yards. */
export const GRAVE_POST = 5
/** How long the facing line is, yards. */
const FACING = 6

const ALLIANCE_COLOR = new THREE.Color(0x4d8dff)
const HORDE_COLOR = new THREE.Color(0xff5a4d)
const BOTH_COLOR = new THREE.Color(0x7ee081)
const UNLINKED = new THREE.Color(0x8a8a8a)
const PICKED = new THREE.Color(0xffd23f)

/** A graveyard's colour: by whom its links serve (green for anyone or both sides, grey with no link). */
export function graveyardColor(links: readonly { faction: number }[]): THREE.Color {
	let horde = false
	let alliance = false
	for (const l of links) {
		if (l.faction === HORDE) horde = true
		else if (l.faction === ALLIANCE) alliance = true
		else horde = alliance = true
	}
	return horde && alliance ? BOTH_COLOR : alliance ? ALLIANCE_COLOR : horde ? HORDE_COLOR : UNLINKED
}

/** The server point `length` yards from (x, y, z) along facing `o`: the server faces (cos o, sin o). */
export function facingTip(g: { x: number; y: number; z: number; o: number }, length = FACING): { x: number; y: number; z: number } {
	return { x: g.x + Math.cos(g.o) * length, y: g.y + Math.sin(g.o) * length, z: g.z }
}

/** A cross of two boxes, its foot at the origin. */
function crossGeometry(): THREE.BufferGeometry {
	const upright = new THREE.BoxGeometry(0.6, 3, 0.6).translate(0, 1.5, 0)
	const bar = new THREE.BoxGeometry(2, 0.6, 0.6).translate(0, 2.1, 0)
	const g = mergeGeometries([upright, bar])
	upright.dispose()
	bar.dispose()
	return g
}

export class GraveyardLayer {
	readonly group = new THREE.Group()
	/** What set last drew, for picking. */
	graveyards: readonly GraveyardShape[] = []
	selected: number | null = null
	private readonly crossGeo = crossGeometry()
	private marks: THREE.InstancedMesh
	private lines: THREE.LineSegments
	private picked: THREE.LineSegments
	private tmpM = new THREE.Matrix4()
	private tmpQ = new THREE.Quaternion()
	private tmpP = new THREE.Vector3()
	private tmpS = new THREE.Vector3(1, 1, 1)
	private up = new THREE.Vector3(0, 1, 0)

	constructor() {
		const onTop = { depthTest: false, transparent: true, fog: false }
		this.marks = new THREE.InstancedMesh(this.crossGeo, new THREE.MeshBasicMaterial(onTop), 16)
		this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.75, fog: false }))
		this.picked = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PICKED, ...onTop }))
		this.picked.renderOrder = 10
		this.marks.renderOrder = 11
		for (const o of [this.marks, this.lines, this.picked]) o.frustumCulled = false
		this.marks.count = 0
		this.group.add(this.lines, this.picked, this.marks)
		this.group.visible = false
	}

	/** Draws `list` (server coordinates) in the block whose first tile is (tileX, tileY), `selected` highlighted. */
	set(list: readonly GraveyardShape[], tileX: number, tileY: number, selected: number | null) {
		this.graveyards = list
		this.selected = selected
		if (list.length > this.marks.instanceMatrix.count) {
			const next = new THREE.InstancedMesh(this.crossGeo, this.marks.material, list.length * 2)
			next.renderOrder = this.marks.renderOrder
			next.frustumCulled = false
			this.group.remove(this.marks)
			this.marks.dispose()
			this.marks = next
			this.group.add(next)
		}
		const rest: number[] = []
		const sel: number[] = []
		list.forEach((g, i) => {
			const p = editorPoint(g, tileX, tileY)
			const tip = editorPoint(facingTip(g), tileX, tileY)
			// The cross's bar across the facing: turned about the vertical to face along it.
			this.tmpQ.setFromAxisAngle(this.up, Math.atan2(tip.x - p.x, tip.z - p.z))
			this.marks.setMatrixAt(i, this.tmpM.compose(this.tmpP.set(p.x, p.y + GRAVE_POST, p.z), this.tmpQ, this.tmpS))
			this.marks.setColorAt(i, g.id === selected ? PICKED : graveyardColor(g.links))
			const out = g.id === selected ? sel : rest
			out.push(p.x, p.y, p.z, p.x, p.y + GRAVE_POST, p.z, p.x, p.y + 0.2, p.z, tip.x, tip.y + 0.2, tip.z)
		})
		this.marks.count = list.length
		this.marks.instanceMatrix.needsUpdate = true
		if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true
		this.marks.computeBoundingSphere()
		this.lines.geometry.dispose()
		this.lines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rest, 3))
		this.picked.geometry.dispose()
		this.picked.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sel, 3))
	}

	/** The graveyard whose cross the ray hits, or null. */
	pick(raycaster: THREE.Raycaster): number | null {
		if (!this.group.visible || !this.marks.count) return null
		const hit = raycaster.intersectObject(this.marks, false)[0]
		return hit?.instanceId !== undefined ? (this.graveyards[hit.instanceId]?.id ?? null) : null
	}

	dispose() {
		for (const l of [this.lines, this.picked]) {
			l.geometry.dispose()
			;(l.material as THREE.Material).dispose()
		}
		;(this.marks.material as THREE.Material).dispose()
		this.marks.dispose()
		this.crossGeo.dispose()
	}
}
