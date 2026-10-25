import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import type { SpawnLayer } from './SpawnLayer'

/** How far above its point a path is drawn, so it isn't buried in the ground it follows. */
const LIFT = 0.4
const PATH_COLOR = 0x6fb7ff
const POINT_COLOR = new THREE.Color(0x6fb7ff)
const PICKED_COLOR = new THREE.Color(0xffd34d)

/**
 * Draws the creatures' waypoint paths: the selected creature's brightly, over everything, with a
 * marker on each point (the picked one yellow) that `pickPoint` finds; and with Show all paths, every
 * other path faintly. A path loops: the creature walks from its last point back to its first.
 */
export class SpawnPaths {
	readonly group = new THREE.Group()
	private all: THREE.LineSegments
	private selected: THREE.LineSegments
	private markers: THREE.InstancedMesh
	private readonly markerGeo = new THREE.OctahedronGeometry(0.7)
	private built = ''
	private builtFor: SpawnLayer | null = null
	private builtMoves = 0
	/** The spawns whose paths the last build drew, so a move of one of them (or an edit that emptied its path) redraws. */
	private pathed = new Set<vmangos.WorldSpawn>()
	private tmpM = new THREE.Matrix4()

	constructor() {
		this.all = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.35 }))
		const selMat = new THREE.LineBasicMaterial({ color: PATH_COLOR, depthTest: false, transparent: true })
		this.selected = new THREE.LineSegments(new THREE.BufferGeometry(), selMat)
		this.selected.renderOrder = 10
		const markMat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true })
		this.markers = new THREE.InstancedMesh(this.markerGeo, markMat, 1)
		this.markers.renderOrder = 11
		this.markers.count = 0
		for (const o of [this.all, this.selected, this.markers]) o.frustumCulled = false
		this.group.add(this.all, this.selected, this.markers)
	}

	/**
	 * Rebuilds what changed since the last call: the spawns (their version), the selected spawn,
	 * its picked point or the Show all paths choice. Cheap when nothing did; call once per frame.
	 */
	update(layer: SpawnLayer, selectedKey: string | null, picked: number, showAll: boolean) {
		const state = `${layer.version}|${selectedKey}|${picked}|${showAll}`
		const sel = selectedKey ? layer.get(selectedKey) : undefined
		if (state === this.built && layer === this.builtFor) {
			if (layer.moveSeq === this.builtMoves) return
			// Spawns moved in place: redraw only when one of them has a path.
			const moved = layer.movedSince(this.builtMoves)
			this.builtMoves = layer.moveSeq
			if (moved && !moved.some((s) => s === sel || s.waypoints?.length || this.pathed.has(s))) return
		}
		this.built = state
		this.builtFor = layer
		this.builtMoves = layer.moveSeq
		this.pathed.clear()
		const others: number[] = []
		if (showAll) {
			for (const s of layer.spawns)
				if (s !== sel && s.waypoints?.length && layer.eventShown(s)) {
					pushLoop(others, s)
					this.pathed.add(s)
				}
		}
		setPositions(this.all.geometry, others)
		const mine: number[] = []
		if (sel?.waypoints?.length) pushLoop(mine, sel)
		setPositions(this.selected.geometry, mine)

		const points = sel?.waypoints ?? []
		if (points.length > this.markers.instanceMatrix.count) {
			this.group.remove(this.markers)
			this.markers.dispose()
			this.markers = new THREE.InstancedMesh(this.markerGeo, this.markers.material, Math.max(16, points.length * 2))
			this.markers.renderOrder = 11
			this.markers.frustumCulled = false
			this.group.add(this.markers)
		}
		points.forEach((p, i) => {
			this.markers.setMatrixAt(i, this.tmpM.makeTranslation(p.x, p.y + LIFT, p.z))
			this.markers.setColorAt(i, i === picked ? PICKED_COLOR : POINT_COLOR)
		})
		this.markers.count = points.length
		this.markers.instanceMatrix.needsUpdate = true
		if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true
		this.markers.computeBoundingSphere()
	}

	/** The index of the selected path's point under the ray, or -1. */
	pickPoint(raycaster: THREE.Raycaster): number {
		if (this.markers.count === 0) return -1
		const hit = raycaster.intersectObject(this.markers, false)[0]
		return hit?.instanceId ?? -1
	}

	dispose() {
		this.all.geometry.dispose()
		this.selected.geometry.dispose()
		;(this.all.material as THREE.Material).dispose()
		;(this.selected.material as THREE.Material).dispose()
		;(this.markers.material as THREE.Material).dispose()
		this.markers.dispose()
		this.markerGeo.dispose()
	}
}

/** Adds a spawn's path to `out` as line segments: from the spawn to its first point, then point to point, and back to the first. */
function pushLoop(out: number[], s: vmangos.WorldSpawn) {
	const pts = s.waypoints
	const seg = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => out.push(a.x, a.y + LIFT, a.z, b.x, b.y + LIFT, b.z)
	seg(s, pts[0])
	for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i])
	if (pts.length > 2) seg(pts[pts.length - 1], pts[0])
}

function setPositions(g: THREE.BufferGeometry, v: number[]) {
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
	g.computeBoundingSphere()
}
