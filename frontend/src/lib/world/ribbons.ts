import * as THREE from 'three'
import type { AnimTrack, MeshRibbon } from '../wow/api'
import { VERTEX_FLOATS, type ParticleBlend } from './particles'
import { sampleTrack } from './uvAnim'

// M2 ribbons (B-183), ported from Benilla's ribbons.rs (MIT/Apache): while its gate is on, a ribbon
// lays edges behind its point at edgesPerSecond, each spanning the frame's +Y axis from `above` over
// to `below` under the point, and keeps each for edgeLifetime seconds in world space, so a moving
// bone draws a trail (a still one draws nothing). The strip runs from the point back through the
// edges, its texture's U from 0 at the point to 1 at an edge's end of life.

/** The cap on one ribbon's live edges. */
export const MAX_EDGES = 512
/** Floats an edge takes: top xyz, bottom xyz, birth time, age. */
const EDGE = 8

/** How a ribbon draws, by its material's blend (Benilla folds mod and mod2x to opaque). */
export function ribbonBlend(blend: number): ParticleBlend {
	if (blend === 3 || blend === 4) return 'add'
	if (blend === 2) return 'alpha'
	if (blend === 1) return 'alphaKey'
	return 'opaque'
}

/** The rise of an edge over a frame: summed over its life it is gravity · t² at any frame rate. */
export function gravityStep(gravity: number, age: number, dt: number): number {
	return gravity * (age + age + dt) * dt
}

const one = [0]
const rgb = [1, 1, 1]

function scalar(t: AnimTrack | undefined, ms: number, fallback: number): number {
	if (!t) return fallback
	sampleTrack(t, ms, 1, one)
	return one[0]
}

const node = new THREE.Vector3()
const axis = new THREE.Vector3()

/** One ribbon's trail. */
export class RibbonTrail {
	readonly def: MeshRibbon
	/** Live edges, oldest first, in a ring from `first`. */
	count = 0
	private first = 0
	private edges = new Float32Array(0)
	private acc = 0
	/** The trail's own clock, in seconds; it stops while the trail is out of view. */
	private clock = 0
	private on = false
	private top = new THREE.Vector3()
	private bottom = new THREE.Vector3()
	private rgba = [1, 1, 1, 1]

	constructor(def: MeshRibbon) {
		this.def = def
	}

	private at(i: number): number {
		return ((this.first + i) % MAX_EDGES) * EDGE
	}

	/**
	 * Advances the trail by dt seconds at `ms` on the model's clock: edges past their life go, the rest
	 * rise by gravity, and new ones are laid at the point `m` (the ribbon's frame to world) puts it.
	 */
	step(dt: number, ms: number, m: THREE.Matrix4) {
		const d = this.def
		const now = (this.clock += dt)
		const e = this.edges
		while (this.count && now - e[this.at(0) + 6] >= d.edgeLifetime) {
			this.first = (this.first + 1) % MAX_EDGES
			this.count--
		}
		for (let i = 0; i < this.count; i++) {
			const o = this.at(i)
			const rise = gravityStep(d.gravity, e[o + 7], dt)
			e[o + 1] += rise
			e[o + 4] += rise
			e[o + 7] += dt
		}
		this.on = !d.on || scalar(d.on, ms, 1) > 0.5
		if (d.color) sampleTrack(d.color, ms, 3, rgb)
		else rgb[0] = rgb[1] = rgb[2] = 1
		this.rgba[0] = rgb[0]
		this.rgba[1] = rgb[1]
		this.rgba[2] = rgb[2]
		this.rgba[3] = Math.max(0, scalar(d.alpha, ms, 1))
		if (!this.on) return
		node.setFromMatrixPosition(m)
		axis.setFromMatrixColumn(m, 1).normalize()
		this.top.copy(node).addScaledVector(axis, Math.max(0, scalar(d.above, ms, 0)))
		this.bottom.copy(node).addScaledVector(axis, -Math.max(0, scalar(d.below, ms, 0)))
		this.acc += d.edgesPerSecond * dt
		let n = Math.max(0, Math.floor(this.acc))
		this.acc -= n
		n = Math.min(n, MAX_EDGES - this.count)
		if (n && !e.length) this.edges = new Float32Array(MAX_EDGES * EDGE)
		for (let k = 0; k < n; k++) {
			// A frame's edges are spread back over it, so a fast swing still makes a smooth strip.
			const back = (dt * (n - 1 - k)) / n
			const o = this.at(this.count++)
			this.top.toArray(this.edges, o)
			this.bottom.toArray(this.edges, o + 3)
			this.edges[o + 6] = now - back
			this.edges[o + 7] = back
		}
	}

	/** Floats `expand` can write at most. */
	get floats(): number {
		return (this.count + 1) * 4 * VERTEX_FLOATS
	}

	/** Writes the strip into `out` from float `at`, from the point back through the edges; returns the floats written. */
	expand(out: Float32Array, at: number): number {
		if (!this.on || this.count < 1) return 0
		const d = this.def
		const start = at
		const cell = Math.min(d.slot, d.rows * d.cols - 1)
		const u0 = (cell % d.cols) / d.cols
		const u1 = ((cell % d.cols) + 1) / d.cols
		const v0 = Math.floor(cell / d.cols) / d.rows
		const v1 = (Math.floor(cell / d.cols) + 1) / d.rows
		const e = this.edges
		const now = this.clock
		// The previous pair along the strip, starting at the point itself.
		let tx = this.top.x
		let ty = this.top.y
		let tz = this.top.z
		let bx = this.bottom.x
		let by = this.bottom.y
		let bz = this.bottom.z
		let ua = u0
		for (let i = this.count - 1; i >= 0; i--) {
			const o = this.at(i)
			const ub = u0 + (u1 - u0) * Math.min(1, Math.max(0, (now - e[o + 6]) / d.edgeLifetime))
			at = vertex(out, at, bx, by, bz, ua, v1, this.rgba)
			at = vertex(out, at, e[o + 3], e[o + 4], e[o + 5], ub, v1, this.rgba)
			at = vertex(out, at, e[o], e[o + 1], e[o + 2], ub, v0, this.rgba)
			at = vertex(out, at, tx, ty, tz, ua, v0, this.rgba)
			tx = e[o]
			ty = e[o + 1]
			tz = e[o + 2]
			bx = e[o + 3]
			by = e[o + 4]
			bz = e[o + 5]
			ua = ub
		}
		return at - start
	}
}

function vertex(out: Float32Array, at: number, x: number, y: number, z: number, u: number, v: number, col: number[]): number {
	out[at] = x
	out[at + 1] = y
	out[at + 2] = z
	out[at + 3] = u
	out[at + 4] = v
	out[at + 5] = col[0]
	out[at + 6] = col[1]
	out[at + 7] = col[2]
	out[at + 8] = col[3]
	return at + VERTEX_FLOATS
}
