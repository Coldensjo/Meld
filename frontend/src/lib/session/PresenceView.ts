// Draws the other members of a shared session in the 3D view (#1004): a cone at each one's camera,
// pointing where it looks, with their name over it, and their brush circle on the ground while they hold
// a brush tool. One marker per member, made once and updated in place a few times a second (from the
// session's timer, not the frame loop); nothing here is reactive state.
import * as THREE from 'three'
import { brushOf, memberColor, type PresenceBook } from './presence'

/** What the view needs of the session map's ground. */
export interface PresenceGround {
	heightAt(x: number, z: number): number
}

/** The ring's points around a circle; a square brush uses four corners of them. */
const RING_POINTS = 64
/** The camera cone's length and the radius of its open end, in yards. */
const CONE_LENGTH = 4
const CONE_RADIUS = 1.6

interface Marker {
	group: THREE.Group
	cone: THREE.Mesh
	label: THREE.Sprite
	name: string
	ring: THREE.LineLoop
	pos: Float32Array
}

/** The cone's geometry, shared: its tip at the origin and its open end toward +Z, where `lookAt` turns it. */
function coneGeometry() {
	const g = new THREE.ConeGeometry(CONE_RADIUS, CONE_LENGTH, 4, 1, true)
	// The cone's tip is +Y: turned to -Z, then moved so the tip sits at the camera and it opens toward the view.
	g.rotateX(-Math.PI / 2)
	g.translate(0, 0, CONE_LENGTH / 2)
	return g
}

/** A member's name drawn at a fixed size on screen, in its colour, over everything. */
function makeLabel(text: string, color: string): THREE.Sprite {
	const font = 28
	const c = document.createElement('canvas')
	const g = c.getContext('2d')!
	g.font = `600 ${font}px sans-serif`
	c.width = Math.ceil(g.measureText(text).width) + 16
	c.height = font + 14
	g.font = `600 ${font}px sans-serif`
	g.fillStyle = 'rgba(10, 14, 20, 0.75)'
	g.fillRect(0, 0, c.width, c.height)
	g.fillStyle = color
	g.fillRect(0, c.height - 4, c.width, 4)
	g.textBaseline = 'middle'
	g.fillText(text, 8, c.height / 2)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }))
	const h = 0.035
	s.scale.set((h * c.width) / c.height, h, 1)
	s.center.set(0.5, 0)
	s.renderOrder = 31
	return s
}

function disposeLabel(s: THREE.Sprite) {
	s.material.map?.dispose()
	s.material.dispose()
}

export class PresenceView {
	/** Every marker, added to the scene once. */
	readonly group = new THREE.Group()
	private markers = new Map<number, Marker>()
	private geometry = coneGeometry()
	private look = new THREE.Vector3()

	constructor() {
		this.group.name = 'session presence'
		this.group.visible = false
	}

	/**
	 * Puts every member in `book` on `ground` (or hides them all with null, while the session's map is not
	 * the active tab), named by `names`. Markers of members gone from the book are removed.
	 */
	update(book: PresenceBook, ground: PresenceGround | null, names: (id: number) => string) {
		this.group.visible = !!ground && book.size > 0
		for (const [id, m] of this.markers) if (!book.get(id)) this.remove(id, m)
		if (!ground) return
		for (const [id, p] of book.entries()) {
			const m = this.markers.get(id) ?? this.add(id)
			const name = names(id)
			if (name !== m.name) {
				m.group.remove(m.label)
				disposeLabel(m.label)
				m.label = makeLabel(name, memberColor(id))
				m.label.position.set(0, 1.5, 0)
				m.group.add(m.label)
				m.name = name
			}
			m.group.position.set(p.cam[0], p.cam[1], p.cam[2])
			// The cone opens the way the camera looks; a direction rounded to nothing keeps the last turn.
			this.look.set(p.dir[0], p.dir[1], p.dir[2])
			if (this.look.lengthSq() > 1e-4) m.cone.lookAt(this.look.add(m.group.position))
			const b = brushOf(p)
			m.ring.visible = !!b
			if (b) drape(m.pos, b.x, b.z, b.r, b.square, ground)
			if (b) m.ring.geometry.getAttribute('position').needsUpdate = true
		}
	}

	/** Where member `id`'s camera marker stands, or null for none shown: for the probes. */
	markerAt(id: number): { cam: [number, number, number]; dir: [number, number, number]; ring: [number, number] | null; visible: boolean } | null {
		const m = this.markers.get(id)
		if (!m) return null
		const p = m.group.position
		const ring = m.ring.visible ? ringCentre(m.pos) : null
		// The way the cone opens: its local +Z.
		const d = m.cone.getWorldDirection(new THREE.Vector3())
		return { cam: [p.x, p.y, p.z], dir: [d.x, d.y, d.z], ring, visible: this.group.visible }
	}

	private add(id: number): Marker {
		const color = new THREE.Color(memberColor(id))
		const group = new THREE.Group()
		const cone = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, fog: false }))
		cone.renderOrder = 30
		const label = makeLabel('', memberColor(id))
		group.add(cone, label)
		const pos = new Float32Array(RING_POINTS * 3)
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		const ring = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, fog: false }))
		ring.renderOrder = 30
		ring.frustumCulled = false
		ring.visible = false
		const m: Marker = { group, cone, label, name: '', ring, pos }
		this.markers.set(id, m)
		this.group.add(group, ring)
		return m
	}

	private remove(id: number, m: Marker) {
		this.group.remove(m.group, m.ring)
		disposeLabel(m.label)
		;(m.cone.material as THREE.Material).dispose()
		m.ring.geometry.dispose()
		;(m.ring.material as THREE.Material).dispose()
		this.markers.delete(id)
	}

	/** Removes every marker. */
	clear() {
		for (const [id, m] of this.markers) this.remove(id, m)
		this.group.visible = false
	}

	dispose() {
		this.clear()
		this.geometry.dispose()
	}
}

/** Lays a ring of RING_POINTS points around (x, z) on the ground, half a yard above it: a circle, or a square's sides. */
function drape(pos: Float32Array, x: number, z: number, r: number, square: boolean, ground: PresenceGround) {
	const side = RING_POINTS / 4
	for (let i = 0; i < RING_POINTS; i++) {
		let px: number
		let pz: number
		if (square) {
			// Each side is a quarter of the points, from one corner to the next.
			const k = Math.floor(i / side)
			const f = (i % side) / side
			const a = -r + 2 * r * f
			px = k === 0 ? x + a : k === 1 ? x + r : k === 2 ? x - a : x - r
			pz = k === 0 ? z - r : k === 1 ? z + a : k === 2 ? z + r : z - a
		} else {
			const a = (i / RING_POINTS) * Math.PI * 2
			px = x + Math.cos(a) * r
			pz = z + Math.sin(a) * r
		}
		const h = ground.heightAt(px, pz)
		pos[i * 3] = px
		pos[i * 3 + 1] = (Number.isFinite(h) ? h : 0) + 0.5
		pos[i * 3 + 2] = pz
	}
}

/** The ring's centre from its points, for the probes. */
function ringCentre(pos: Float32Array): [number, number] {
	let x = 0
	let z = 0
	for (let i = 0; i < RING_POINTS; i++) {
		x += pos[i * 3]
		z += pos[i * 3 + 2]
	}
	return [x / RING_POINTS, z / RING_POINTS]
}
