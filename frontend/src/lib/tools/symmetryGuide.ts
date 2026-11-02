import * as THREE from 'three'
import { mirrorsOf, symmetryCenter, type SymmetryState } from './symmetry'

/** The ground the guide is draped over. */
interface GuideGround {
	readonly worldSize: number
	readonly cellSize: number
	heightAt(x: number, z: number): number
}

/** How high over the ground the guide floats, in yards. */
const LIFT = 0.4
/** Redraw the guide this often (seconds) while it shows, so it follows the ground a stroke reshapes. */
const REDRAW = 1

/**
 * The symmetry guide (#182): dashed lines over the ground while a brush tool with symmetry on is
 * active, the mirror axes through the centre (Mirror X, Z, or both), or spokes from it to the map's
 * edge (Radial, one per copy), or a small star on it (Point). Drawn over everything, as the lasso is,
 * and built again only when the symmetry, the map or the time to follow the ground comes round.
 */
export class SymmetryGuide {
	readonly lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x7fd6ff, dashSize: 3, gapSize: 2, depthTest: false, transparent: true, opacity: 0.9 }))
	/** What the guide was built for: the symmetry's fields and the map's size (no string made each frame). */
	private last = { mode: '', count: 0, cx: NaN, cz: NaN, ws: 0 }
	private ground: GuideGround | null = null
	private age = 0
	private pts: number[] = []

	constructor() {
		this.lines.renderOrder = 30
		this.lines.frustumCulled = false
		this.lines.visible = false
	}

	/** Shows the guide for symmetry `s` over `ground` (or hides it with `show` false); call every frame. */
	update(scene: THREE.Scene, ground: GuideGround, s: SymmetryState, show: boolean, dt: number) {
		const on = show && s.mode !== 'off'
		if (!on) {
			if (this.lines.visible) this.lines.visible = false
			return
		}
		if (this.lines.parent !== scene) scene.add(this.lines)
		this.lines.visible = true
		this.age += dt
		const l = this.last
		const cx = s.center?.x ?? NaN
		const cz = s.center?.z ?? NaN
		const same = l.mode === s.mode && l.count === s.count && Object.is(l.cx, cx) && Object.is(l.cz, cz) && l.ws === ground.worldSize
		if (same && ground === this.ground && this.age < REDRAW) return
		l.mode = s.mode
		l.count = s.count
		l.cx = cx
		l.cz = cz
		l.ws = ground.worldSize
		this.ground = ground
		this.age = 0
		this.build(ground, s)
	}

	private build(g: GuideGround, s: SymmetryState) {
		const ws = g.worldSize
		const c = symmetryCenter(s, ws)
		const pts = this.pts
		pts.length = 0
		const step = Math.max(2, g.cellSize * 2)
		/** A draped line from (x0, z0) to (x1, z1), clipped to the map, as segment pairs. */
		const line = (x0: number, z0: number, x1: number, z1: number) => {
			const len = Math.hypot(x1 - x0, z1 - z0)
			const n = Math.max(1, Math.ceil(len / step))
			let px = x0
			let pz = z0
			for (let i = 1; i <= n; i++) {
				const x = x0 + ((x1 - x0) * i) / n
				const z = z0 + ((z1 - z0) * i) / n
				pts.push(px, g.heightAt(px, pz) + LIFT, pz, x, g.heightAt(x, z) + LIFT, z)
				px = x
				pz = z
			}
		}
		/** From the centre toward direction (dx, dz) until the map's edge. */
		const ray = (dx: number, dz: number) => {
			let t = Infinity
			if (dx > 1e-9) t = Math.min(t, (ws - c.x) / dx)
			if (dx < -1e-9) t = Math.min(t, -c.x / dx)
			if (dz > 1e-9) t = Math.min(t, (ws - c.z) / dz)
			if (dz < -1e-9) t = Math.min(t, -c.z / dz)
			if (!(t > 0) || !Number.isFinite(t)) return
			line(c.x, c.z, c.x + dx * t, c.z + dz * t)
		}
		if (s.mode === 'x' || s.mode === 'xz') line(c.x, 0, c.x, ws)
		if (s.mode === 'z' || s.mode === 'xz') line(0, c.z, ws, c.z)
		if (s.mode === 'point') {
			const r = Math.max(6, ws * 0.02)
			for (let i = 0; i < 4; i++) {
				const a = (i * Math.PI) / 4
				line(c.x - Math.cos(a) * r, c.z - Math.sin(a) * r, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r)
			}
		}
		if (s.mode === 'radial') {
			// The wedges' borders: half a copy's turn either side of the +x spoke, then every copy's turn on.
			const mirrors = mirrorsOf(s.mode, s.count)
			const half = Math.PI / mirrors.length
			for (const m of mirrors) {
				// The +x direction turned by the copy, then by half a wedge, the way the copies turn.
				const a = Math.atan2(m.m10, m.m00) - half
				ray(Math.cos(a), Math.sin(a))
			}
		}
		const geo = this.lines.geometry
		const attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined
		if (attr && attr.array.length === pts.length) {
			;(attr.array as Float32Array).set(pts)
			attr.needsUpdate = true
		} else geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
		geo.computeBoundingSphere()
		this.lines.computeLineDistances()
	}

	detach() {
		this.lines.removeFromParent()
		this.lines.visible = false
		this.last.mode = ''
	}

	dispose() {
		this.lines.geometry.dispose()
		;(this.lines.material as THREE.Material).dispose()
	}
}
