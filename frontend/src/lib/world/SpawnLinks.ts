import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import type { SpawnLayer } from './SpawnLayer'
import { creatureOf, followersOf, follows, groupOptions, leads, slotPosition } from './formations'
import { poolHue, topPool } from './pools'

/** How far above the ground the lines and rings are drawn, so they aren't buried in it. */
const LIFT = 0.4
const FORMATION_COLOR = 0xff9d3c
/** A follower further than this from its slot gets a faint line from the slot to where it stands. */
const APART = 0.5
const RING_SEGMENTS = 20
/** How tall the post over a pooled spawn's ring stands, so the pool's spots read from far off too. */
const POST = 6

/**
 * Draws the spawns' formations and pools (#172): for a selected creature in a formation, a line from
 * the leader to each follower's slot (where the server keeps it while the group walks), a marker on
 * the slot and a faint line on to where the follower stands when that is elsewhere (for a group that
 * doesn't walk together, a line to each follower); and with View ›
 * Spawn pools, a ring and a post round every pooled spawn in its pool's colour (its mother pool's
 * when it has one), so the spots that take turns read at a glance.
 */
export class SpawnLinks {
	readonly group = new THREE.Group()
	private lines: THREE.LineSegments
	private apart: THREE.LineSegments
	private rings: THREE.LineSegments
	private slots: THREE.InstancedMesh
	private readonly slotGeo = new THREE.OctahedronGeometry(0.45)
	private builtFor: SpawnLayer | null = null
	private builtVersion = -1
	private builtMoves = 0
	/** The spawns the last build drew lines or rings for, so a move of one of them redraws. */
	private involved = new Set<vmangos.WorldSpawn>()
	private builtSel: vmangos.WorldSpawn | null = null
	private builtPools = false
	private tmpM = new THREE.Matrix4()
	private tmpP = { x: 0, z: 0 }
	private color = new THREE.Color()

	constructor() {
		this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: FORMATION_COLOR, depthTest: false, transparent: true }))
		this.lines.renderOrder = 10
		this.apart = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: FORMATION_COLOR, depthTest: false, transparent: true, opacity: 0.35 }))
		this.apart.renderOrder = 10
		this.rings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }))
		this.slots = new THREE.InstancedMesh(this.slotGeo, new THREE.MeshBasicMaterial({ color: FORMATION_COLOR, depthTest: false, transparent: true }), 16)
		this.slots.renderOrder = 11
		this.slots.count = 0
		for (const o of [this.lines, this.apart, this.rings, this.slots]) o.frustumCulled = false
		this.group.add(this.lines, this.apart, this.rings, this.slots)
	}

	/**
	 * Rebuilds what changed since the last call: the spawns (the layer's version), the selected spawn
	 * (a new copy whenever it is selected or edited) or the View › Spawn pools choice. Cheap when
	 * nothing did; call once per frame.
	 */
	update(layer: SpawnLayer, selected: vmangos.WorldSpawn | null, showPools: boolean) {
		if (layer === this.builtFor && layer.version === this.builtVersion && selected === this.builtSel && showPools === this.builtPools) {
			if (layer.moveSeq === this.builtMoves) return
			// Spawns moved in place: redraw only when one of them is in a drawn formation or pool.
			const moved = layer.movedSince(this.builtMoves)
			this.builtMoves = layer.moveSeq
			if (moved && !moved.some((s) => this.involved.has(s) || leads(s) || follows(s) || (showPools && topPool(s)))) return
		}
		this.builtFor = layer
		this.builtVersion = layer.version
		this.builtMoves = layer.moveSeq
		this.involved.clear()
		this.builtSel = selected
		this.builtPools = showPools
		this.buildFormation(layer, selected)
		this.buildRings(layer, showPools)
	}

	private buildFormation(layer: SpawnLayer, selected: vmangos.WorldSpawn | null) {
		const spawns = layer.spawns
		const sel = selected && selected.kind !== 'object' ? creatureOf(spawns, selected.guid) : undefined
		const leader = !sel ? undefined : leads(sel) ? sel : follows(sel) ? creatureOf(spawns, sel.leader) : undefined
		const members = leader ? followersOf(spawns, leader.guid) : []
		if (leader) this.involved.add(leader)
		for (const m of members) this.involved.add(m)
		// A group that doesn't walk in formation (only fights or respawns together) has no slots: its
		// lines go to the followers themselves.
		const walks = !!leader && (groupOptions(spawns, leader) & 0x001) !== 0
		let n = 0
		const near: number[] = []
		const far: number[] = []
		if (members.length > this.slots.instanceMatrix.count) {
			this.group.remove(this.slots)
			const mat = this.slots.material
			this.slots.dispose()
			this.slots = new THREE.InstancedMesh(this.slotGeo, mat, members.length * 2)
			this.slots.renderOrder = 11
			this.slots.frustumCulled = false
			this.group.add(this.slots)
		}
		for (const m of members) {
			const y = m.y + LIFT
			if (!walks || m.followDist < 0.05) {
				near.push(leader!.x, leader!.y + LIFT, leader!.z, m.x, y, m.z)
				continue
			}
			const p = slotPosition(leader!, m.followDist, m.followAngle, this.tmpP)
			near.push(leader!.x, leader!.y + LIFT, leader!.z, p.x, y, p.z)
			if (Math.hypot(m.x - p.x, m.z - p.z) > APART) far.push(p.x, y, p.z, m.x, y, m.z)
			this.slots.setMatrixAt(n++, this.tmpM.makeTranslation(p.x, y, p.z))
		}
		this.slots.count = n
		this.slots.instanceMatrix.needsUpdate = true
		this.slots.computeBoundingSphere()
		setPositions(this.lines.geometry, near)
		setPositions(this.apart.geometry, far)
	}

	private buildRings(layer: SpawnLayer, showPools: boolean) {
		const pos: number[] = []
		const col: number[] = []
		if (showPools) {
			for (const s of layer.spawns) {
				const pool = topPool(s)
				if (!pool || !layer.eventShown(s)) continue
				this.involved.add(s)
				this.color.setHSL(poolHue(pool), 0.85, 0.6)
				const r = s.kind === 'object' ? 2 : Math.min(4, 1.4 * Math.max(1, s.scale || 1))
				const y = s.y + LIFT
				pos.push(s.x, y, s.z, s.x, y + POST, s.z)
				col.push(this.color.r, this.color.g, this.color.b, this.color.r, this.color.g, this.color.b)
				for (let k = 0; k < RING_SEGMENTS; k++) {
					const a0 = (k / RING_SEGMENTS) * Math.PI * 2
					const a1 = ((k + 1) / RING_SEGMENTS) * Math.PI * 2
					pos.push(s.x + Math.cos(a0) * r, y, s.z + Math.sin(a0) * r, s.x + Math.cos(a1) * r, y, s.z + Math.sin(a1) * r)
					col.push(this.color.r, this.color.g, this.color.b, this.color.r, this.color.g, this.color.b)
				}
			}
		}
		setPositions(this.rings.geometry, pos)
		this.rings.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
	}

	dispose() {
		for (const l of [this.lines, this.apart, this.rings]) {
			l.geometry.dispose()
			;(l.material as THREE.Material).dispose()
		}
		;(this.slots.material as THREE.Material).dispose()
		this.slots.dispose()
		this.slotGeo.dispose()
	}
}

function setPositions(g: THREE.BufferGeometry, v: number[]) {
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
	g.computeBoundingSphere()
}
