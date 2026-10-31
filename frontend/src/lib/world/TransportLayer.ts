import * as THREE from 'three'
import { editorPoint } from '../io/portCoords'
import { rayNearSegment, routeLines, type Vec3 } from './taxiRoute'
import { DOCK, type LegShape } from './transportRoute'

// Boats and zeppelins (#954): the routes of the transports that sail on the open map, drawn while
// Show › Transports is on or World › Transports is open. Each transport's legs on this map are the
// curves it sails (the server's, taxiRoute.ts), its docks are posts topped by a marker, and its name
// stands over its first dock here (or the middle of its route, without one). The picked one is drawn
// over everything in yellow. Read only: nothing here edits a route (#955 will).

/** A transport as the layer draws it (vmangos.Transport, server coordinates). */
export interface TransportShape {
	entry: number
	name: string
	legs: LegShape[]
}

/** How high a dock's marker stands over the dock, yards. */
export const DOCK_POST = 10
/** Pieces a route's curve is drawn in between two points. */
const PIECES = 6

const ROUTE = new THREE.Color(0x8fd0ff)
const PICKED = new THREE.Color(0xffd23f)
const DOCK_COLOR = new THREE.Color(0x58e0a0)

export class TransportLayer {
	readonly group = new THREE.Group()
	/** What `set` drew. */
	transports: TransportShape[] = []
	mapId = -1
	tileX = 0
	tileY = 0
	picked: number | null = null
	/** Each transport's curve on this map as line segments (editor points), by entry: drawn and picked from. */
	private lines = new Map<number, number[]>()
	private readonly markGeo = new THREE.OctahedronGeometry(2.6)
	private marks: THREE.InstancedMesh
	/** The transport each dock marker belongs to, by instance. */
	private markOwner: number[] = []
	private posts: THREE.LineSegments
	private all: THREE.LineSegments
	private pick: THREE.LineSegments
	private labels = new THREE.Group()
	private tmpM = new THREE.Matrix4()

	constructor() {
		const onTop = { depthTest: false, transparent: true, fog: false }
		this.marks = new THREE.InstancedMesh(this.markGeo, new THREE.MeshBasicMaterial(onTop), 16)
		this.posts = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.7, fog: false }))
		this.all = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ROUTE, transparent: true, opacity: 0.75, fog: false }))
		this.pick = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PICKED, ...onTop }))
		this.pick.renderOrder = 10
		this.marks.renderOrder = 11
		this.labels.renderOrder = 12
		for (const o of [this.marks, this.posts, this.all, this.pick]) o.frustumCulled = false
		this.marks.count = 0
		this.group.add(this.posts, this.all, this.pick, this.marks, this.labels)
		this.group.visible = false
	}

	/** The editor point of a server point in this block. */
	editor(p: Vec3): Vec3 {
		return editorPoint(p, this.tileX, this.tileY)
	}

	/**
	 * Draws the legs on map `mapId` of `transports` (server coordinates) in the block whose first tile is
	 * `block` (a region's; null for a map of its own), `picked` (an entry) highlighted. Only the
	 * highlight is redrawn when nothing else changed.
	 */
	set(transports: TransportShape[], mapId: number, block: { x: number; y: number } | null, picked: number | null) {
		const tileX = block?.x ?? 0
		const tileY = block?.y ?? 0
		const all = transports !== this.transports || mapId !== this.mapId || tileX !== this.tileX || tileY !== this.tileY
		this.transports = transports
		this.mapId = mapId
		this.tileX = tileX
		this.tileY = tileY
		if (all) {
			this.picked = picked
			this.drawAll()
		} else if (picked !== this.picked) {
			this.picked = picked
			this.drawPicked()
		}
	}

	/** The legs of `t` on this map. */
	private legsHere(t: TransportShape): LegShape[] {
		return t.legs.filter((l) => l.mapId === this.mapId)
	}

	private drawAll() {
		this.lines.clear()
		const rest: number[] = []
		const posts: number[] = []
		const docks: { at: Vec3; owner: number }[] = []
		for (const c of this.labels.children) disposeLabel(c as THREE.Sprite)
		this.labels.clear()
		for (const t of this.transports) {
			const mine: number[] = []
			let labelAt: Vec3 | null = null
			for (const leg of this.legsHere(t)) {
				const pts = leg.points.map((p) => this.editor(p))
				routeLines(pts, PIECES, mine)
				leg.points.forEach((p, i) => {
					if (p.flags !== DOCK) return
					const at = pts[i]
					docks.push({ at, owner: t.entry })
					posts.push(at.x, at.y, at.z, at.x, at.y + DOCK_POST, at.z)
					labelAt ??= at
				})
				labelAt ??= pts[Math.floor(pts.length / 2)] ?? null
			}
			if (!mine.length && !labelAt) continue
			this.lines.set(t.entry, mine)
			for (const v of mine) rest.push(v)
			if (labelAt) {
				const s = makeLabel(t.name)
				s.position.set(labelAt.x, labelAt.y + DOCK_POST + 6, labelAt.z)
				this.labels.add(s)
			}
		}
		setLines(this.all.geometry, rest)
		setLines(this.posts.geometry, posts)
		this.marks = this.fit(this.marks, docks.length)
		this.markOwner = docks.map((d) => d.owner)
		docks.forEach((d, i) => {
			this.marks.setMatrixAt(i, this.tmpM.makeTranslation(d.at.x, d.at.y + DOCK_POST, d.at.z))
			this.marks.setColorAt(i, DOCK_COLOR)
		})
		this.marks.count = docks.length
		this.marks.instanceMatrix.needsUpdate = true
		if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true
		this.marks.computeBoundingSphere()
		this.drawPicked()
	}

	private drawPicked() {
		setLines(this.pick.geometry, this.picked !== null ? (this.lines.get(this.picked) ?? []) : [])
		for (let i = 0; i < this.markOwner.length; i++) this.marks.setColorAt(i, this.markOwner[i] === this.picked ? PICKED : DOCK_COLOR)
		if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true
	}

	/** The transport whose dock marker the ray hits, or whose curve passes within `tolerance` (the tangent of the angle off the ray) of it, the nearest in angle; null for none. */
	pickTransport(raycaster: THREE.Raycaster, tolerance = 0.012): number | null {
		if (this.marks.count) {
			const hit = raycaster.intersectObject(this.marks, false)[0]
			if (hit?.instanceId !== undefined) return this.markOwner[hit.instanceId] ?? null
		}
		const { origin, direction } = raycaster.ray
		let best = tolerance
		let found: number | null = null
		const a = { x: 0, y: 0, z: 0 }
		const b = { x: 0, y: 0, z: 0 }
		for (const [entry, lines] of this.lines) {
			for (let i = 0; i < lines.length; i += 6) {
				a.x = lines[i]
				a.y = lines[i + 1]
				a.z = lines[i + 2]
				b.x = lines[i + 3]
				b.y = lines[i + 4]
				b.z = lines[i + 5]
				const d = rayNearSegment(origin, direction, a, b)
				if (d < best) {
					best = d
					found = entry
				}
			}
		}
		return found
	}

	/** How many transports have a curve drawn here (the probes read it). */
	get drawn(): number {
		let n = 0
		for (const l of this.lines.values()) if (l.length) n++
		return n
	}

	/** How many docks are drawn. */
	get docks(): number {
		return this.marks.count
	}

	/** An instanced mesh with room for n, replacing `m` when it has too little. */
	private fit(m: THREE.InstancedMesh, n: number): THREE.InstancedMesh {
		if (n <= m.instanceMatrix.count) return m
		const next = new THREE.InstancedMesh(m.geometry, m.material, Math.max(16, n * 2))
		next.renderOrder = m.renderOrder
		next.frustumCulled = false
		this.group.remove(m)
		m.dispose()
		this.group.add(next)
		return next
	}

	dispose() {
		for (const l of [this.posts, this.all, this.pick]) {
			l.geometry.dispose()
			;(l.material as THREE.Material).dispose()
		}
		;(this.marks.material as THREE.Material).dispose()
		this.marks.dispose()
		this.markGeo.dispose()
		for (const c of this.labels.children) disposeLabel(c as THREE.Sprite)
	}
}

/** A name drawn at a fixed size on screen, over everything. */
function makeLabel(text: string): THREE.Sprite {
	const font = 28
	const c = document.createElement('canvas')
	const g = c.getContext('2d')!
	g.font = `600 ${font}px sans-serif`
	const w = Math.ceil(g.measureText(text).width) + 16
	c.width = w
	c.height = font + 14
	g.font = `600 ${font}px sans-serif`
	g.fillStyle = 'rgba(10, 14, 20, 0.7)'
	g.fillRect(0, 0, c.width, c.height)
	g.fillStyle = '#cfeaff'
	g.textBaseline = 'middle'
	g.fillText(text, 8, c.height / 2 + 1)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }))
	// About 18 px high at the usual view height.
	const h = 0.035
	s.scale.set((h * c.width) / c.height, h, 1)
	s.renderOrder = 12
	s.name = text
	return s
}

function disposeLabel(s: THREE.Sprite) {
	s.material.map?.dispose()
	s.material.dispose()
}

function setLines(g: THREE.BufferGeometry, v: number[]) {
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
	g.computeBoundingSphere()
}
