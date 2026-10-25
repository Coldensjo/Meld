// The client's portal flood for a placed WMO: which of its groups it draws this frame, and
// which of them take the room's fog. Ported from Benilla's `wmo_portal/mod.rs` (`compute_pvs_traced`,
// `Flood::walk`, `portal_screen_rect`; MIT/Apache-2.0), which follows the 1.12 client's recursion
// (0x6b41c0): from the camera's groups (the down-ray's seeds, `wmoRoom.ts`) it crosses each portal
// whose front side the eye is on, projects the portal to a screen rect, intersects it with the rect
// it carries and goes on with the overlap, ending a branch when the overlap collapses.
//
// - Pass 1 floods from the camera's groups, or, with the camera outside the building, from every
//   exterior group. Inside, a portal it crosses onto an exterior group (0x8) leaves a deferred
//   window: its rect.
// - Pass 2, per window, floods again from every exterior group inside the view narrowed to it, so
//   from inside the building's shell is drawn only through its doorways.
// - Pass 3 draws each callback group (0x10000) in the view, whatever the flood reached.
// - A group takes the room's fog when the flood reached it from the camera's groups through true
//   interiors only (no 0x8 or 0x40 on the way, nor on it).
//
// The windows of the building the camera is in gate the open world (Engine.cullInstances, #116).
// Its sky windows, the doorways onto any group open to the sky (0x8, 0x40 or 0x100), gate the
// weather (Engine.updateWeather, #244): the client's weather flag is any such group in view.
// The epsilons are the client's: the side test at exactly 0, the rect collapse at 0.001, the w clamp.

import * as THREE from 'three'
import { EXTERIOR, type RoomSeeds, type WmoNav } from './wmoRoom'

/** MOGP 0x40: lit as outdoors, which breaks the interior fog chain as 0x8 does. */
export const EXTERIOR_LIT = 0x40
/** MOGP 0x10000: drawn in the third pass against the whole view. */
export const CALLBACK_PASS = 0x10000
/** The flags of a group the client's weather shows in (`0x6b42d9`, Benilla's `exterior_visible`). */
export const SKY_GROUP = 0x148
const DEPTH_CAP = 10
const MAX_ITERS = 1 << 16
const RECT_EPS = 0.001
const ON_PLANE_EPS = 0.01
const W_CLAMP_BAND = 0.001
const W_CLAMP_SUB = 1e-5

/** One frame's answer, per group: drawn, and drawn with the room's fog. */
export interface RoomPvs {
	visible: Uint8Array
	fog: Uint8Array
}

/**
 * Runs the flood for a camera at `eye` (model space, WoW axes) seeded by `seeds`. `clipFromLocal`
 * takes the WMO's editor-space local frame to clip space (projection · view · the placement); a
 * WoW-axes point (x, y, z) is (x, z, -y) there. Reuses `out` when it has room.
 */
export class RoomFlood {
	private visible = new Uint8Array(0)
	private fog = new Uint8Array(0)
	private pushed = new Uint8Array(0)
	private pushedSky = new Uint8Array(0)
	/** The walk's stack, eight numbers a step: group, came-from, rect x0 y0 x1 y1, depth and chain. */
	private stack: number[] = []
	private windows: number[] = []
	private sky: number[] = []
	/**
	 * The last run's doorways onto a group open to the sky (SKY_GROUP), as `exteriorWindows`, recorded
	 * on the inside leg only: where the weather shows from a true interior.
	 */
	get skyWindows(): readonly number[] {
		return this.sky
	}
	/**
	 * The last run's deferred exterior windows, four numbers (NDC x0 y0 x1 y1) each: the doorways the
	 * open world may be seen through. Empty for a sealed room, or when the run had no seed.
	 */
	get exteriorWindows(): readonly number[] {
		return this.windows
	}
	private roots: number[] = []
	private iters = 0
	private nav!: WmoNav
	private eye: [number, number, number] = [0, 0, 0]
	private m = new Float64Array(16)
	// Clip-space polygon buffers for the side-plane clip (4 floats a vertex).
	private polyA = new Float64Array(64)
	private polyB = new Float64Array(64)
	private rectOut = [0, 0, 0, 0]
	private frustum = new THREE.Frustum()
	private narrow = new THREE.Matrix4()
	private box = new THREE.Box3()

	run(nav: WmoNav, seeds: RoomSeeds, eye: [number, number, number], clipFromLocal: THREE.Matrix4): RoomPvs {
		const n = nav.groups.length
		if (this.visible.length < n) {
			this.visible = new Uint8Array(n)
			this.fog = new Uint8Array(n)
		}
		if (this.pushed.length < nav.portals.length) {
			this.pushed = new Uint8Array(nav.portals.length)
			this.pushedSky = new Uint8Array(nav.portals.length)
		}
		this.visible.fill(0)
		this.fog.fill(0)
		this.pushed.fill(0)
		this.pushedSky.fill(0)
		this.nav = nav
		this.eye = eye
		this.iters = 0
		for (let i = 0; i < 16; i++) this.m[i] = clipFromLocal.elements[i]
		const out: RoomPvs = { visible: this.visible.subarray(0, n), fog: this.fog.subarray(0, n) }
		this.windows.length = 0
		this.sky.length = 0
		this.stack.length = 0
		let insideLeg = false
		if (seeds.inGroup !== null) {
			// Pass 1 from the camera's groups, full screen each. It records windows only on the inside
			// leg: a seed group that is not exterior.
			this.push(this.stack, seeds.inGroup, -1, -1, -1, 1, 1, 0, true)
			if (seeds.across !== null) this.push(this.stack, seeds.across, -1, -1, -1, 1, 1, 0, true)
			insideLeg = (nav.groups[seeds.inGroup].flags & EXTERIOR) === 0
		} else {
			// The outside leg: every exterior group a full-screen root, with no interior chain, so no
			// room fog; an interior is drawn only where a doorway shows it.
			for (let g = 0; g < n; g++) if (nav.groups[g].flags & EXTERIOR) this.push(this.stack, g, -1, -1, -1, 1, 1, 0, false)
		}
		this.walk(this.stack, insideLeg)

		// Pass 2: per window, every exterior group (not a callback one) in the view narrowed to it.
		const windows = this.windows
		for (let w = 0; w + 4 <= windows.length; w += 4) {
			const x0 = windows[w],
				y0 = windows[w + 1],
				x1 = windows[w + 2],
				y1 = windows[w + 3]
			this.setFrustum(clipFromLocal, x0, y0, x1, y1)
			this.roots.length = 0
			for (let g = 0; g < n; g++) {
				if ((nav.groups[g].flags & (EXTERIOR | CALLBACK_PASS)) !== EXTERIOR) continue
				if (this.groupInView(g)) this.push(this.roots, g, -1, x0, y0, x1, y1, 0, false)
			}
			this.walk(this.roots, false)
		}

		// Pass 3: the callback groups against the whole view.
		this.frustum.setFromProjectionMatrix(clipFromLocal)
		for (let g = 0; g < n; g++) {
			if (this.visible[g] || !(nav.groups[g].flags & CALLBACK_PASS)) continue
			if (this.groupInView(g)) this.visible[g] = 1
		}
		return out
	}

	private push(stack: number[], g: number, came: number, x0: number, y0: number, x1: number, y1: number, depth: number, chain: boolean) {
		stack.push(g, came, x0, y0, x1, y1, depth, chain ? 1 : 0)
	}

	private walk(stack: number[], recordWindows: boolean) {
		const nav = this.nav
		const groups = nav.groups
		const [ex, ey, ez] = this.eye
		while (stack.length) {
			const chain = stack.pop()! === 1
			const depth = stack.pop()!
			const y1 = stack.pop()!,
				x1 = stack.pop()!,
				y0 = stack.pop()!,
				x0 = stack.pop()!
			const came = stack.pop()!
			const g = stack.pop()!
			if (++this.iters > MAX_ITERS || g >= groups.length) continue
			this.visible[g] = 1
			const interior = (groups[g].flags & (EXTERIOR | EXTERIOR_LIT)) === 0
			if (chain && interior) this.fog[g] = 1
			if (depth >= DEPTH_CAP) continue
			const chainOn = chain && interior
			const start = groups[g].refStart
			const end = Math.min(start + groups[g].refCount, nav.refs.length)
			for (let r = start; r < end; r++) {
				const ref = nav.refs[r]
				const to = ref.group
				if (to === 0xffff || to === came) continue
				const p = nav.portals[ref.portal]
				if (!p) continue
				// The front side of the side-oriented plane: skip only on d < 0.
				let d = p.plane[0] * ex + p.plane[1] * ey + p.plane[2] * ez + p.plane[3]
				if (ref.side < 0) d = -d
				if (d < 0) continue
				let px0 = -1,
					py0 = -1,
					px1 = 1,
					py1 = 1
				// An eye in the portal gets the whole screen, or crossing a doorway would clip the room ahead.
				if (!this.eyeOnPortal(ref.portal)) {
					const rect = this.portalRect(ref.portal)
					if (!rect) continue
					;[px0, py0, px1, py1] = rect
				}
				const ix0 = Math.max(x0, px0),
					iy0 = Math.max(y0, py0),
					ix1 = Math.min(x1, px1),
					iy1 = Math.min(y1, py1)
				if (ix1 - ix0 < RECT_EPS || iy1 - iy0 < RECT_EPS) continue
				// A portal onto an exterior group leaves a window, once a frame.
				if (recordWindows && to < groups.length && groups[to].flags & EXTERIOR && !this.pushed[ref.portal]) {
					this.pushed[ref.portal] = 1
					this.windows.push(ix0, iy0, ix1, iy1)
				}
				if (recordWindows && to < groups.length && groups[to].flags & SKY_GROUP && !this.pushedSky[ref.portal]) {
					this.pushedSky[ref.portal] = 1
					this.sky.push(ix0, iy0, ix1, iy1)
				}
				this.push(stack, to, g, ix0, iy0, ix1, iy1, depth + 1, chainOn)
			}
		}
	}

	/** Whether the eye lies in the portal: within ON_PLANE_EPS of its plane and inside its polygon. */
	private eyeOnPortal(i: number): boolean {
		const p = this.nav.portals[i]
		const [nx, ny, nz, d] = p.plane
		const [ex, ey, ez] = this.eye
		if (Math.abs(nx * ex + ny * ey + nz * ez + d) > ON_PLANE_EPS) return false
		const v = this.nav.portalVerts
		if (p.count < 3 || (p.start + p.count) * 3 > v.length) return false
		const ax = Math.abs(nx),
			ay = Math.abs(ny),
			az = Math.abs(nz)
		const [u, w] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1]
		const pu = this.eye[u],
			pw = this.eye[w]
		let inside = false
		let prev = p.start + p.count - 1
		for (let k = p.start; k < p.start + p.count; k++) {
			const cu = v[k * 3 + u],
				cw = v[k * 3 + w],
				qu = v[prev * 3 + u],
				qw = v[prev * 3 + w]
			if (cw > pw !== qw > pw && pu < ((qu - cu) * (pw - cw)) / (qw - cw) + cu) inside = !inside
			prev = k
		}
		return inside
	}

	/**
	 * The portal's screen rect (the client's 0x6b46f0): its polygon to clip space, clipped against the
	 * four side planes only, then the NDC bounds, where |w| < 0.001 becomes 1e-5 and a vertex behind
	 * the eye divides by its own negative w. Null when fully clipped.
	 */
	private portalRect(i: number): number[] | null {
		const p = this.nav.portals[i]
		const v = this.nav.portalVerts
		if (p.count < 3 || (p.start + p.count) * 3 > v.length) return null
		const m = this.m
		// Each clipping plane adds at most one vertex.
		if (this.polyA.length < (p.count + 4) * 4) {
			this.polyA = new Float64Array((p.count + 4) * 8)
			this.polyB = new Float64Array((p.count + 4) * 8)
		}
		let a = this.polyA
		let b = this.polyB
		let count = 0
		for (let k = p.start; k < p.start + p.count; k++) {
			// WoW axes to the editor's local frame, then to clip space.
			const x = v[k * 3],
				y = v[k * 3 + 2],
				z = -v[k * 3 + 1]
			a[count * 4] = m[0] * x + m[4] * y + m[8] * z + m[12]
			a[count * 4 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
			a[count * 4 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
			a[count * 4 + 3] = m[3] * x + m[7] * y + m[11] * z + m[15]
			count++
		}
		// Sutherland–Hodgman against w+x, w-x, w+y, w-y >= 0.
		for (let plane = 0; plane < 4; plane++) {
			const axis = plane < 2 ? 0 : 1
			const sign = plane % 2 === 0 ? 1 : -1
			let out = 0
			for (let k = 0; k < count; k++) {
				const j = (k + 1) % count
				const fa = a[k * 4 + 3] + sign * a[k * 4 + axis]
				const fb = a[j * 4 + 3] + sign * a[j * 4 + axis]
				if (fa >= 0) {
					for (let c = 0; c < 4; c++) b[out * 4 + c] = a[k * 4 + c]
					out++
				}
				if (fa >= 0 !== fb >= 0) {
					const t = fa / (fa - fb)
					for (let c = 0; c < 4; c++) b[out * 4 + c] = a[k * 4 + c] + (a[j * 4 + c] - a[k * 4 + c]) * t
					out++
				}
			}
			count = out
			if (count < 3) return null
			const swap = a
			a = b
			b = swap
		}
		let x0 = Infinity,
			y0 = Infinity,
			x1 = -Infinity,
			y1 = -Infinity
		for (let k = 0; k < count; k++) {
			let w = a[k * 4 + 3]
			if (Math.abs(w) < W_CLAMP_BAND) w = W_CLAMP_SUB
			const x = a[k * 4] / w,
				y = a[k * 4 + 1] / w
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (y < y0) y0 = y
			if (y > y1) y1 = y
		}
		const r = this.rectOut
		r[0] = x0
		r[1] = y0
		r[2] = x1
		r[3] = y1
		return r
	}

	/** The view narrowed to an NDC rect, depth untouched, in the WMO's local frame. */
	private setFrustum(clipFromLocal: THREE.Matrix4, x0: number, y0: number, x1: number, y1: number) {
		const w = x1 - x0,
			h = y1 - y0
		// three's Matrix4.set takes rows.
		this.narrow.set(2 / w, 0, 0, -(x0 + x1) / w, 0, 2 / h, 0, -(y0 + y1) / h, 0, 0, 1, 0, 0, 0, 0, 1).multiply(clipFromLocal)
		this.frustum.setFromProjectionMatrix(this.narrow)
	}

	/** Whether group g's box (MOGI, WoW axes, taken to the local frame) meets the current frustum. */
	private groupInView(g: number): boolean {
		const { min, max } = this.nav.groups[g]
		if (min[0] > max[0]) return false
		this.box.min.set(min[0], min[2], -max[1])
		this.box.max.set(max[0], max[2], -min[1])
		return this.frustum.intersectsBox(this.box)
	}
}
