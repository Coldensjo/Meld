import * as THREE from 'three'
import type { AnimTrack, MeshEmitter } from '../wow/api'
import { sampleTrack } from './uvAnim'

// M2 particle emitters (B-182), ported from Benilla (MIT/Apache): benilla-formats particles.rs (the
// over-life ramps, flipbook cells, spline chain) and benilla-world particles/ (emit.rs, the spawn
// kernels; sim.rs, the integrator and emission; quads.rs, the quad writer), which cite the client's
// own functions. A pool keeps one emitter's live particles. In world mode (file flag 0x10 clear) a
// particle is born into world space and stays where it was born; in model mode it lives in the
// emitter's spawn space and rides the emitter. Spawn space is the record's WoW axes (Z up) before
// the client's 90° turn about +Z, which the emitter's frame (`MeshEmitter.frame`) holds.
// Not ported: geometry-model and recursion particles, the ground snap (0x2000), following and
// inheriting the emitter's motion (0x4000, 0x40), the emission's density setting and transports.

/** The client's cap on one emitter's live particles. */
export const MAX_PARTICLES = 1024
/** Floats a vertex takes in the quad stream: position, uv, rgba. */
export const VERTEX_FLOATS = 9
/** Floats one particle can write: a head and a tail quad. */
export const PARTICLE_FLOATS = 2 * 4 * VERTEX_FLOATS

/** Scratch for sortQuads, grown as needed. */
const sortScratch = { keys: new Float32Array(0), order: new Uint32Array(0), data: new Float32Array(0) }

/**
 * Orders the quads in `data[0..floats)` back to front from the eye at (ex, ey, ez), by each quad's
 * centre, as the client sorts an alpha-blended cloud (0x7b3a10). Returns the array that now holds
 * them: `data` itself, or `spare` (as large) with the quads written in order.
 */
export function sortQuads(data: Float32Array, floats: number, ex: number, ey: number, ez: number, spare: Float32Array): Float32Array {
	const quadFloats = 4 * VERTEX_FLOATS
	const n = floats / quadFloats
	if (n < 2) return data
	const s = sortScratch
	if (s.keys.length < n) {
		s.keys = new Float32Array(n * 2)
		s.order = new Uint32Array(n * 2)
	}
	const keys = s.keys
	for (let q = 0; q < n; q++) {
		const o = q * quadFloats
		// The centre of the quad's first and third corners, its diagonal.
		const cx = (data[o] + data[o + 2 * VERTEX_FLOATS]) * 0.5 - ex
		const cy = (data[o + 1] + data[o + 2 * VERTEX_FLOATS + 1]) * 0.5 - ey
		const cz = (data[o + 2] + data[o + 2 * VERTEX_FLOATS + 2]) * 0.5 - ez
		keys[q] = cx * cx + cy * cy + cz * cz
	}
	const order = s.order.subarray(0, n)
	for (let q = 0; q < n; q++) order[q] = q
	order.sort((a, b) => keys[b] - keys[a])
	for (let q = 0; q < n; q++) spare.set(data.subarray(order[q] * quadFloats, (order[q] + 1) * quadFloats), q * quadFloats)
	return spare
}

// The nine parameter tracks, in MeshEmitter.params order, and the values a keyless one holds.
const SPEED = 0
const SPEED_VAR = 1
const VERTICAL = 2
const HORIZONTAL = 3
const GRAVITY = 4
const LIFESPAN = 5
const AREA_LENGTH = 6
const AREA_WIDTH = 7
const Z_SOURCE = 8
const PARAM_DEFAULTS = [0, 0, 0, 0, 0, 1, 0, 0, 0]

const FLAG_UNLIT = 0x1
const FLAG_NO_FOG = 0x8
const FLAG_MODEL_SPACE = 0x10
const FLAG_SCALE_SIZE = 0x20
const FLAG_KILL_OUTBOUND = 0x80
const FLAG_SPHERE_UP = 0x100
const FLAG_TAIL_AGE = 0x400
const FLAG_XY_QUAD = 0x1000
const FLAG_GROUND_SNAP = 0x2000
const FLAG_INHERIT = 0x40
const FLAG_FOLLOW = 0x4000
/** The inherit trigger's period: the emitter's motion is sampled 30 times a second (0x7b5230). */
const INHERIT_INTERVAL = 1 / 30
/** How far below a birth the ground snap looks, in yards. */
export const GROUND_SNAP_REACH = 20
const FLAG_BURST = 0x8000

const SHAPE_SPHERE = 2
const SHAPE_SPLINE = 3

/** How a particle draws, by the record's blend byte (Benilla's ParticleBlend). */
export type ParticleBlend = 'add' | 'alpha' | 'alphaKey' | 'opaque'

export function blendOf(e: MeshEmitter): ParticleBlend {
	switch (e.blend) {
		case 3:
		case 4:
			return 'add'
		case 2:
		case 5: // mod and mod2x: no modulate path, drawn as alpha (as Benilla does)
		case 6:
			return 'alpha'
		case 1:
			return 'alphaKey'
		default:
			return 'opaque'
	}
}

/** Whether the scene light shades the quads: bit 0x1 clear, and not a mod blend (0x70bb00). */
export function litOf(e: MeshEmitter): boolean {
	return (e.flags & FLAG_UNLIT) === 0 && e.blend !== 5 && e.blend !== 6
}

/** The fog a cloud takes: none for flag 0x8, black for an additive one (it adds nothing), else the scene's. */
export function fogOf(e: MeshEmitter): 'off' | 'black' | 'scene' {
	if (e.flags & FLAG_NO_FOG) return 'off'
	return blendOf(e) === 'add' ? 'black' : 'scene'
}

// ---- random numbers: xorshift32, as Benilla draws its jitter ----

export interface Rng {
	rng: number
}

export function nextU32(s: Rng): number {
	let x = s.rng
	x ^= x << 13
	x >>>= 0
	x ^= x >>> 17
	x ^= x << 5
	x >>>= 0
	s.rng = x
	return x
}

/** Uniform in [0, 1). */
export function rand01(s: Rng): number {
	return (nextU32(s) >>> 8) / 16777216
}

/** Uniform in (-1, 1), the client's S11 draw. */
function randS11(s: Rng): number {
	return rand01(s) * 2 - 1
}

// ---- tracks ----

const one = [0]

function scalar(t: AnimTrack | null | undefined, ms: number, fallback: number): number {
	if (!t) return fallback
	sampleTrack(t, ms, 1, one)
	return one[0]
}

/** The nine parameter tracks at `ms` into `out`. */
export function sampleParams(e: MeshEmitter, ms: number, out: Float32Array): Float32Array {
	for (let i = 0; i < 9; i++) out[i] = scalar(e.params[i], ms, PARAM_DEFAULTS[i])
	return out
}

/** Whether the enabled gate is on at `ms` (no gate: always). */
export function emitting(e: MeshEmitter, ms: number): boolean {
	return scalar(e.on, ms, 1) > 0.5
}

/** Particles a second at `ms`, never below 0. */
export function rateAt(e: MeshEmitter, ms: number): number {
	return Math.max(0, scalar(e.rate, ms, 0))
}

/**
 * Births owed this frame, into `acc` (sim.rs accumulate_emission): a pour adds rate·dt; a burst
 * emitter (flag 0x8000) puts down trunc(rate) at once when the gate first opens. Returns the burst.
 */
export function accumulate(burst: boolean, rate: number, on: boolean, scale: number, dt: number, st: { acc: number; gatePrev: boolean }): number {
	if (!on) st.acc = 0
	const r = on ? Math.max(0, rate) : 0
	const gate = r > 0
	let n = 0
	if (burst) {
		if (gate && !st.gatePrev) {
			n = Math.trunc(r * scale)
			st.acc = n
		}
	} else if (gate) st.acc += r * scale * dt
	st.gatePrev = gate
	return n
}

// ---- over-life ramps ----

/** The flipbook cell at segment fraction t for an authored (begin, end) pair, wrapping mod 256. */
export function cellAt(begin: number, end: number, t: number): number {
	const [base, span] = end >= begin ? [begin, end - begin + 1] : [begin + 1, end - begin - 1]
	return Math.floor(base + span * t) & 0xff
}

/** One evaluation of the over-life ramps. */
export interface LifeSample {
	color: [number, number, number, number]
	size: number
	head: number
	tail: number
}

/**
 * The colour, size and flipbook cells at normalised age u (0x7b9b10): two linear segments split at
 * `mid`, each segment's time squeezed to t·0.99 + 0.005, the cells cycling `repeat` times.
 */
export function overLife(e: MeshEmitter, u: number, out: LifeSample): LifeSample {
	u = Math.min(1, Math.max(0, u))
	const mid = Math.min(1, Math.max(1e-3, e.mid))
	let k0 = 0
	let t: number
	let seg = 0
	if (u <= mid) t = u / mid
	else {
		k0 = 1
		seg = 1
		t = (u - mid) / Math.max(1 - mid, 1e-3)
	}
	t = Math.min(1, Math.max(0, t)) * 0.99 + 0.005
	const a = e.colors[k0]
	const b = e.colors[k0 + 1]
	for (let c = 0; c < 4; c++) out.color[c] = a[c] + (b[c] - a[c]) * t
	out.size = e.sizes[k0] + (e.sizes[k0 + 1] - e.sizes[k0]) * t
	const rep = e.repeat[seg]
	let ct = t
	if (rep !== 1) {
		const x = t * rep
		ct = x - Math.trunc(x)
	}
	out.head = cellAt(e.headCells[seg * 2], e.headCells[seg * 2 + 1], ct)
	out.tail = cellAt(e.tailCells[seg * 2], e.tailCells[seg * 2 + 1], ct)
	return out
}

// ---- spline emitters ----

/** A spline emitter's cubic Bézier chain (3K+1 points), walked by normalised arc length. */
export class SplineChain {
	private knots: number[] = [0]
	private p: number[]

	constructor(p: number[]) {
		this.p = p
		const k = (p.length / 3 - 1) / 3
		const a = new THREE.Vector3()
		const b = new THREE.Vector3()
		for (let s = 0; s < k; s++) {
			let len = 0
			this.bezier(s, 0, a)
			for (let i = 1; i <= 16; i++) {
				this.bezier(s, i / 16, b)
				len += a.distanceTo(b)
				a.copy(b)
			}
			this.knots.push(this.knots[s] + len)
		}
		const total = this.knots[this.knots.length - 1]
		if (total > 0) for (let i = 0; i < this.knots.length; i++) this.knots[i] /= total
	}

	/** Whether the points make at least one segment. */
	static valid(p: number[] | undefined): p is number[] {
		if (!p) return false
		const n = p.length / 3
		return n >= 4 && (n - 1) % 3 === 0
	}

	private bezier(seg: number, u: number, out: THREE.Vector3) {
		const w0 = (1 - u) ** 3
		const w1 = 3 * u * (1 - u) ** 2
		const w2 = 3 * u * u * (1 - u)
		const w3 = u ** 3
		const o = seg * 9
		const p = this.p
		return out.set(w0 * p[o] + w1 * p[o + 3] + w2 * p[o + 6] + w3 * p[o + 9], w0 * p[o + 1] + w1 * p[o + 4] + w2 * p[o + 7] + w3 * p[o + 10], w0 * p[o + 2] + w1 * p[o + 5] + w2 * p[o + 8] + w3 * p[o + 11])
	}

	private locate(t: number): [number, number] {
		const k = this.knots.length - 1
		let seg = k - 1
		for (let i = 1; i < k; i++) {
			if (t < this.knots[i]) {
				seg = i - 1
				break
			}
		}
		const a = this.knots[seg]
		const b = this.knots[seg + 1]
		return [seg, Math.min(1, Math.max(0, (t - a) / Math.max(b - a, 1e-6)))]
	}

	/** The point at arc fraction t, clamped to the end points. */
	eval(t: number, out: THREE.Vector3): THREE.Vector3 {
		const p = this.p
		if (t <= 0) return out.set(p[0], p[1], p[2])
		if (t >= 1) return out.fromArray(p, p.length - 3)
		const [seg, u] = this.locate(t)
		return this.bezier(seg, u, out)
	}

	/** The (unnormalised) tangent at arc fraction t. */
	tangent(t: number, out: THREE.Vector3): THREE.Vector3 {
		const [seg, u] = this.locate(Math.min(1, Math.max(0, t)))
		const w0 = -3 * (1 - u) ** 2
		const w1 = 3 * (1 - u) * (1 - 3 * u)
		const w2 = 3 * u * (2 - 3 * u)
		const w3 = 3 * u * u
		const o = seg * 9
		const p = this.p
		return out.set(w0 * p[o] + w1 * p[o + 3] + w2 * p[o + 6] + w3 * p[o + 9], w0 * p[o + 1] + w1 * p[o + 4] + w2 * p[o + 7] + w3 * p[o + 10], w0 * p[o + 2] + w1 * p[o + 5] + w2 * p[o + 8] + w3 * p[o + 11])
	}
}

// ---- the spawn kernels (emit.rs emit_local) ----

const Z = new THREE.Vector3(0, 0, 1)
const kTan = new THREE.Vector3()
const kTmp = new THREE.Vector3()

/**
 * One birth's position and direction in spawn space (relative to the emitter's origin): on a plane
 * (0x7b8890), uniform in the area rectangle, in a cone about +Z; on a sphere (0x7b8d70), on a shell
 * between the two radii, radial (or straight up with flag 0x100); on a spline (0x7b9500), on the
 * chain. A z source turns the direction radial from (0, 0, zSource).
 */
export function emitLocal(e: MeshEmitter, now: Float32Array, rng: Rng, spline: SplineChain | null, pos: THREE.Vector3, dir: THREE.Vector3) {
	const zs = now[Z_SOURCE]
	if (e.shape === SHAPE_SPLINE && spline) {
		const t0 = Math.min(1, Math.max(0, now[AREA_LENGTH]))
		const t1 = Math.min(1, Math.max(0, now[AREA_WIDTH]))
		const t = t0 + rand01(rng) * (t1 - t0)
		spline.eval(t, pos)
		if (zs !== 0) unitOr(dir.copy(pos).setZ(pos.z - zs))
		else if (now[VERTICAL] !== 0) {
			unitOr(spline.tangent(t, kTan))
			const a = randS11(rng) * now[VERTICAL]
			const s = Math.sin(a)
			const c = Math.cos(a)
			// +Z turned about the tangent by a.
			dir.copy(Z)
				.multiplyScalar(c)
				.add(kTmp.crossVectors(kTan, Z).multiplyScalar(s))
				.addScaledVector(kTan, kTan.z * (1 - c))
			if (now[HORIZONTAL] !== 0) pos.addScaledVector(dir, rand01(rng) * now[HORIZONTAL])
		} else dir.set(0, 0, 0)
		return
	}
	let sphere = false
	if (e.shape === SHAPE_SPHERE) {
		sphere = true
		const r = now[AREA_LENGTH] + rand01(rng) * Math.max(0, now[AREA_WIDTH] - now[AREA_LENGTH])
		const lat = randS11(rng) * now[VERTICAL]
		const lon = randS11(rng) * now[HORIZONTAL]
		// The unit shell point is the direction too, so a sphere of radius 0 still sprays.
		dir.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
		pos.copy(dir).multiplyScalar(r)
	} else pos.set(randS11(rng) * 0.5 * now[AREA_LENGTH], randS11(rng) * 0.5 * now[AREA_WIDTH], 0)
	if (zs !== 0) unitOr(dir.copy(pos).setZ(pos.z - zs))
	else if (sphere) {
		if (e.flags & FLAG_SPHERE_UP) dir.copy(Z)
	} else {
		const th = randS11(rng) * now[VERTICAL]
		const ph = randS11(rng) * now[HORIZONTAL]
		dir.set(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th))
	}
}

/** Normalises v, or makes it +Z when it has no length. */
function unitOr(v: THREE.Vector3) {
	const l = v.length()
	if (l > 1e-9) v.multiplyScalar(1 / l)
	else v.copy(Z)
}

// ---- twinkle and spin (quads.rs) ----

/** The client's 128-entry twinkle noise table: uniform in [0, 1), on a fixed seed. */
const TWINKLE = (() => {
	const s = { rng: 0xc0ffee11 }
	const t = new Float32Array(128)
	for (let i = 0; i < 128; i++) t[i] = rand01(s)
	return t
})()

function twinkleNoise(speed: number, age: number, phase: number): number {
	return TWINKLE[((Math.min(255, Math.max(0, speed * age)) | 0) + phase) & 0x7f]
}

/** spin·age, turned back on half the particles of a negative spin (0x7b2dda). */
export function spinAngle(spin: number, age: number, phase: number): number {
	const a = spin * age
	return a < 0 && phase & 0x20 ? -a : a
}

// ---- the pool ----

const bPos = new THREE.Vector3()
const bDir = new THREE.Vector3()
const mOrigin = new THREE.Vector3()
const m3 = new THREE.Matrix3()
const toStored = new THREE.Matrix3()
const delta = new THREE.Vector3()
const follow = new THREE.Vector3()
const inherit = new THREE.Vector3()

/**
 * The share of the emitter's motion its live particles follow (file flag 0x4000, 0x7b2744), from
 * its speed in yd/s: the line through the record's two (speed, fraction) samples, clamped to 0..1;
 * 0 without the flag or with equal sample speeds (Benilla's follow_fraction).
 */
export function followFraction(e: MeshEmitter, speed: number): number {
	const f = e.follow
	if (!(e.flags & FLAG_FOLLOW) || !f || Math.abs(f[2] - f[0]) < 1e-6) return 0
	const slope = (f[3] - f[1]) / (f[2] - f[0])
	return Math.min(1, Math.max(0, slope * speed + f[1] - slope * f[0]))
}
const life: LifeSample = { color: [0, 0, 0, 0], size: 0, head: 0, tail: 0 }
const c = new THREE.Vector3()
const r = new THREE.Vector3()
const u = new THREE.Vector3()
const br = new THREE.Vector3()
const bu = new THREE.Vector3()
const tail = new THREE.Vector3()
const perp = new THREE.Vector3()
const v3 = new THREE.Vector3()
const params = new Float32Array(9)
const childParams = new Float32Array(9)
/** File flag 0x200 on a geometry emitter: each tumble axis's sign is random. */
const FLAG_TUMBLE_SIGN = 0x200
/** Takes the model's editor axes to its WoW axes: +90 degrees about X, (x, y, z) to (x, -z, y). */
const EDITOR_TO_WOW = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
const birthQuat = new THREE.Quaternion()
const rotOnly = new THREE.Matrix4()
const spinQ = new THREE.Quaternion()
const spinAxis = new THREE.Vector3()
const tq = new THREE.Quaternion()

/** One step of a geometry particle's tumble (0x7b28e0): a body-frame turn, skipped under 1e-4 rad/s. */
export function tumble(quat: Float32Array, spin: Float32Array, i: number, dt: number) {
	const wx = spin[i * 3],
		wy = spin[i * 3 + 1],
		wz = spin[i * 3 + 2]
	const theta = Math.hypot(wx, wy, wz)
	if (theta <= 1e-4) return
	spinQ.setFromAxisAngle(spinAxis.set(wx / theta, wy / theta, wz / theta), theta * dt)
	tq.fromArray(quat, i * 4)
		.multiply(spinQ)
		.normalize()
		.toArray(quat, i * 4)
}

/** One emitter's live particles and emission state. */
/** The height of the surface under a world point, or null where there is none in reach. */
export type GroundProbe = (x: number, y: number, z: number) => number | null

const snapLife: LifeSample = { color: [0, 0, 0, 0], size: 0, head: 0, tail: 0 }

export class ParticlePool implements Rng {
	/** Live particles. */
	count = 0
	pos = new Float32Array(0)
	vel = new Float32Array(0)
	age = new Float32Array(0)
	life = new Float32Array(0)
	phase = new Uint32Array(0)
	/** 1 for a particle not yet stepped, which the follow skips. */
	fresh = new Uint8Array(0)
	acc = 0
	/** The emitter's world origin last step, for its motion; the inherit trigger's clock and velocity. */
	private prev = new THREE.Vector3()
	private hasPrev = false
	private inheritAcc = 0
	private inheritVel = new THREE.Vector3()
	gatePrev = false
	rng: number
	readonly def: MeshEmitter
	readonly anchored: boolean
	private spline: SplineChain | null

	/**
	 * `anchored` overrides the record's own space: a recursion child keeps its particles in its
	 * parent's frame (world or the parent's spawn space).
	 */
	constructor(def: MeshEmitter, seed: number, anchored?: boolean) {
		this.def = def
		this.rng = (seed >>> 0) | 1
		this.anchored = anchored ?? (def.flags & FLAG_MODEL_SPACE) === 0
		this.spline = def.shape === SHAPE_SPLINE && SplineChain.valid(def.spline) ? new SplineChain(def.spline) : null
		// A recursion model's first four emitters, born at this pool's live particles (+0x20).
		let childSeed = (this.rng << 7) | (this.rng >>> 25) | 1
		this.children = (def.children ?? []).slice(0, 4).map((c) => {
			childSeed = Math.imul(childSeed, 0x9e3779b9) | 1
			return new ParticlePool(c, childSeed, this.anchored)
		})
		this.geometry = !!def.geometry
	}

	/** The recursion children, stepped by this pool, each drawn with its own look. */
	readonly children: ParticlePool[]
	/** A geometry emitter's particles are models: each keeps an orientation and a tumble. */
	readonly geometry: boolean
	/** Per particle, for a geometry emitter: its orientation (x y z w, in the particles' frame) and spin (rad/s, body axes). */
	quat = new Float32Array(0)
	spin = new Float32Array(0)

	private grow(n: number) {
		if (n <= this.age.length) return
		const cap = Math.min(MAX_PARTICLES, Math.max(16, this.age.length * 2, n))
		const f = (a: Float32Array, k: number) => {
			const b = new Float32Array(cap * k)
			b.set(a)
			return b
		}
		this.pos = f(this.pos, 3)
		this.vel = f(this.vel, 3)
		this.age = f(this.age, 1)
		this.life = f(this.life, 1)
		const p = new Uint32Array(cap)
		p.set(this.phase)
		this.phase = p
		const fr = new Uint8Array(cap)
		fr.set(this.fresh)
		this.fresh = fr
		if (this.geometry) {
			this.quat = f(this.quat, 4)
			this.spin = f(this.spin, 3)
		}
	}

	/**
	 * Advances the pool by dt seconds at `ms` on the model's clock: ages and moves the live particles
	 * (0x7b2680: gravity on world or spawn-space up, then drag), then emits what the rate owes. `m` is
	 * the emitter's matrix (spawn space to world); `lod` scales the rate (the client's distance LOD).
	 * `ground` gives the height of the surface under a world point (within GROUND_SNAP_REACH below
	 * it), or null, for the ground snap.
	 */
	step(dt: number, ms: number, m: THREE.Matrix4, lod: number, ground?: GroundProbe) {
		const e = this.def
		const now = sampleParams(e, ms, params)
		const g = now[GRAVITY]
		const drag = Math.min(dt * e.drag, 1)
		const up = this.anchored ? 1 : 2
		const kill = e.shape === SHAPE_SPHERE && (e.flags & FLAG_KILL_OUTBOUND) !== 0
		// The emitter's motion this step, for the follow and the inherit, taken to the particles' own
		// frame: world space for an anchored emitter, else the emitter's spawn space.
		mOrigin.setFromMatrixPosition(m)
		if (this.hasPrev) delta.subVectors(mOrigin, this.prev)
		else delta.set(0, 0, 0)
		this.prev.copy(mOrigin)
		this.hasPrev = true
		if (!this.anchored) toStored.setFromMatrix4(m).invert()
		const frac = dt > 0 ? followFraction(e, delta.length() / dt) : 0
		follow.copy(delta).multiplyScalar(frac)
		if (!this.anchored) follow.applyMatrix3(toStored)
		const following = frac > 0 && follow.lengthSq() > 0
		if (e.flags & FLAG_INHERIT) {
			this.inheritAcc += dt
			if (this.inheritAcc > INHERIT_INTERVAL) {
				if (this.count > 0) this.inheritVel.copy(delta).multiplyScalar((INHERIT_INTERVAL / this.inheritAcc) * (e.inherit ?? 0))
				else this.inheritVel.set(0, 0, 0)
				this.inheritAcc = 0
			}
		}
		if (!this.anchored) mOrigin.set(0, 0, 0)
		const { pos, vel, age } = this
		let n = this.count
		for (let i = 0; i < n;) {
			age[i] += dt
			if (age[i] >= this.life[i]) {
				this.move(--n, i)
				continue
			}
			const o = i * 3
			// The follow moves every particle but one born since the last step (0x7b2744).
			if (this.fresh[i]) this.fresh[i] = 0
			else if (following) {
				pos[o] += follow.x
				pos[o + 1] += follow.y
				pos[o + 2] += follow.z
			}
			const vx = vel[o]
			const vy = vel[o + 1]
			const vz = vel[o + 2]
			pos[o] += vx * dt
			pos[o + 1] += vy * dt
			pos[o + 2] += vz * dt
			pos[o + up] -= 0.5 * g * dt * dt
			vel[o + up] -= g * dt
			if (e.drag !== 0) {
				vel[o] -= drag * vel[o]
				vel[o + 1] -= drag * vel[o + 1]
				vel[o + 2] -= drag * vel[o + 2]
			}
			const out = kill && vx * (pos[o] - mOrigin.x) + vy * (pos[o + 1] - mOrigin.y) + vz * (pos[o + 2] - mOrigin.z) > 0
			if (out) {
				this.move(--n, i)
				continue
			}
			if (this.geometry) tumble(this.quat, this.spin, i, dt)
			i++
		}
		this.count = n

		const burst = (e.flags & FLAG_BURST) !== 0
		accumulate(burst, rateAt(e, ms), emitting(e, ms), lod, dt, this)
		m3.setFromMatrix4(m)
		if (this.geometry && this.anchored) birthQuat.setFromRotationMatrix(rotOnly.extractRotation(m)).multiply(EDITOR_TO_WOW)
		while (this.acc >= 1 && this.count < MAX_PARTICLES) {
			this.acc -= 1
			this.grow(this.count + 1)
			emitLocal(e, now, this, this.spline, bPos, bDir)
			const speed = now[SPEED] * (1 + now[SPEED_VAR] * randS11(this))
			bDir.multiplyScalar(speed)
			if (this.anchored) {
				bPos.applyMatrix4(m)
				bDir.applyMatrix3(m3)
				// The ground snap (file flag 0x2000, 0x7b2140): a world-space birth over a surface within
				// 20 yd stands on it, lifted by its birth size (0x7b9e20).
				if (e.flags & FLAG_GROUND_SNAP && ground) {
					const h = ground(bPos.x, bPos.y, bPos.z)
					if (h !== null && h <= bPos.y && bPos.y - h <= GROUND_SNAP_REACH) bPos.y = h + overLife(e, 0, snapLife).size
				}
			}
			// The inherit (flag 0x40): (1 + S11 · speed variation) of the held emitter motion.
			if (e.flags & FLAG_INHERIT && this.inheritVel.lengthSq() > 0) {
				inherit.copy(this.inheritVel)
				if (!this.anchored) inherit.applyMatrix3(toStored)
				bDir.addScaledVector(inherit, 1 + now[SPEED_VAR] * randS11(this))
			}
			const i = this.count++
			this.fresh[i] = 1
			if (this.geometry) this.birthTumble(i)
			bPos.toArray(this.pos, i * 3)
			bDir.toArray(this.vel, i * 3)
			// Births of one frame start a little apart, so a stream does not come out in clumps.
			this.age[i] = burst ? 0 : rand01(this) * Math.min(dt, 0.1)
			this.life[i] = now[LIFESPAN]
			this.phase[i] = nextU32(this)
		}
		// A full pool owes no backlog: the client's would pour out all at once as particles die.
		if (this.count >= MAX_PARTICLES) this.acc = Math.min(this.acc, 1)
		for (const c of this.children) c.driveFrom(this, dt, ms, m, lod)
	}

	/**
	 * A geometry particle's birth orientation and tumble (0x7b2420): the emitter's frame (the model's
	 * editor axes turned to its WoW axes), and a spin whose X is min + u * range but whose Y and Z are
	 * a [1, 2) mantissa times the range, as the client rolls them; flag 0x200 flips each axis's sign
	 * with probability one half.
	 */
	private birthTumble(i: number) {
		const e = this.def
		const lo = e.spinMin ?? [0, 0, 0]
		const hi = e.spinMax ?? [0, 0, 0]
		const w = [lo[0] + rand01(this) * (hi[0] - lo[0]), (1 + rand01(this)) * (hi[1] - lo[1]), (1 + rand01(this)) * (hi[2] - lo[2])]
		if (e.flags & FLAG_TUMBLE_SIGN) for (let k = 0; k < 3; k++) if ((nextU32(this) & 1) === 0) w[k] = -w[k]
		const q = this.anchored ? birthQuat : EDITOR_TO_WOW
		this.quat[i * 4] = q.x
		this.quat[i * 4 + 1] = q.y
		this.quat[i * 4 + 2] = q.z
		this.quat[i * 4 + 3] = q.w
		// Spin about the body's WoW axes, in the model's editor axes: (x, z, -y).
		this.spin[i * 3] = w[0]
		this.spin[i * 3 + 1] = w[2]
		this.spin[i * 3 + 2] = -w[1]
	}

	/**
	 * Steps a recursion child (0x7b5b9f): its own particles age and move, and its rate is owed once
	 * per live particle of `parent`, each birth landing at that particle with the child's spawn
	 * offset and velocity turned by the parent's frame (none in model space); child flag 0x40 adds
	 * (1 + S11 * speed variation) of the parent particle's velocity. A child never emits on its own.
	 */
	private driveFrom(parent: ParticlePool, dt: number, ms: number, m: THREE.Matrix4, lod: number) {
		const e = this.def
		const now = sampleParams(e, ms, childParams)
		const g = now[GRAVITY]
		const drag = Math.min(dt * e.drag, 1)
		const up = this.anchored ? 1 : 2
		const { pos, vel, age } = this
		let n = this.count
		for (let i = 0; i < n;) {
			age[i] += dt
			if (age[i] >= this.life[i]) {
				this.move(--n, i)
				continue
			}
			const o = i * 3
			pos[o] += vel[o] * dt
			pos[o + 1] += vel[o + 1] * dt
			pos[o + 2] += vel[o + 2] * dt
			pos[o + up] -= 0.5 * g * dt * dt
			vel[o + up] -= g * dt
			if (e.drag !== 0) {
				vel[o] -= drag * vel[o]
				vel[o + 1] -= drag * vel[o + 1]
				vel[o + 2] -= drag * vel[o + 2]
			}
			i++
		}
		this.count = n
		const burst = (e.flags & FLAG_BURST) !== 0
		const rate = rateAt(e, ms)
		const on = emitting(e, ms)
		m3.setFromMatrix4(m)
		for (let p = 0; p < parent.count; p++) {
			accumulate(burst, rate, on, lod, dt, this)
			while (this.acc >= 1 && this.count < MAX_PARTICLES) {
				this.acc -= 1
				this.grow(this.count + 1)
				emitLocal(e, now, this, this.spline, bPos, bDir)
				bDir.multiplyScalar(now[SPEED] * (1 + now[SPEED_VAR] * randS11(this)))
				if (this.anchored) {
					bPos.applyMatrix3(m3)
					bDir.applyMatrix3(m3)
				}
				const po = p * 3
				bPos.x += parent.pos[po]
				bPos.y += parent.pos[po + 1]
				bPos.z += parent.pos[po + 2]
				if (e.flags & FLAG_INHERIT) {
					const k = 1 + now[SPEED_VAR] * randS11(this)
					bDir.x += k * parent.vel[po]
					bDir.y += k * parent.vel[po + 1]
					bDir.z += k * parent.vel[po + 2]
				}
				const i = this.count++
				this.fresh[i] = 1
				bPos.toArray(this.pos, i * 3)
				bDir.toArray(this.vel, i * 3)
				this.age[i] = burst ? 0 : rand01(this) * Math.min(dt, 0.1)
				this.life[i] = now[LIFESPAN]
				this.phase[i] = nextU32(this)
			}
		}
		if (this.count >= MAX_PARTICLES) this.acc = Math.min(this.acc, 1)
	}

	private move(from: number, to: number) {
		if (from === to) return
		for (let k = 0; k < 3; k++) {
			this.pos[to * 3 + k] = this.pos[from * 3 + k]
			this.vel[to * 3 + k] = this.vel[from * 3 + k]
		}
		this.age[to] = this.age[from]
		this.life[to] = this.life[from]
		this.phase[to] = this.phase[from]
		this.fresh[to] = this.fresh[from]
		if (this.geometry) {
			for (let k = 0; k < 4; k++) this.quat[to * 4 + k] = this.quat[from * 4 + k]
			for (let k = 0; k < 3; k++) this.spin[to * 3 + k] = this.spin[from * 3 + k]
		}
	}

	/** Drops every particle. */
	clear() {
		this.count = 0
		this.acc = 0
		this.gatePrev = false
	}

	/**
	 * Writes the live particles as quads (0x7b2a50 head, 0x7b3041 tail) into `out` from float `at`, for
	 * a camera with world axes right and up; returns the floats written. A head quad faces the camera
	 * (or lies in the emitter's XY plane, flag 0x1000), spun by spin·age; a tail is a streak back along
	 * the velocity, tailTime long. `out` must have room for count · PARTICLE_FLOATS more.
	 */
	expand(m: THREE.Matrix4, right: THREE.Vector3, upv: THREE.Vector3, out: Float32Array, at: number): number {
		const e = this.def
		const start = at
		m3.setFromMatrix4(m)
		const scale = e.flags & FLAG_SCALE_SIZE ? Math.max(1e-4, v3.setFromMatrixColumn(m, 0).length()) : 1
		const xy = (e.flags & FLAG_XY_QUAD) !== 0
		const cols = e.cols
		const rows = e.rows
		const shift = Math.log2(cols)
		const [tw, tp, tmin, tmax] = e.twinkle
		const steady = Math.abs(tmax - tmin) < 1e-6
		const { pos, vel } = this
		for (let i = 0; i < this.count; i++) {
			const age = this.age[i]
			const phase = this.phase[i]
			const noise = twinkleNoise(tw, age, phase)
			if (tp < 1 && noise > tp) continue
			overLife(e, age / this.life[i], life)
			const half = life.size * (steady ? 1 : noise * (tmax - tmin) + tmin) * scale
			c.fromArray(pos, i * 3)
			if (!this.anchored) c.applyMatrix4(m)
			const col = life.color
			if (e.headTail !== 1) {
				setCell(life.head, cols, rows, shift)
				if (xy) {
					br.set(1, 0, 0).applyMatrix3(m3)
					bu.set(0, 1, 0).applyMatrix3(m3)
				} else {
					br.copy(right)
					bu.copy(upv)
				}
				if (e.spin !== 0) {
					const a = spinAngle(e.spin, age, phase)
					const s = Math.sin(a)
					const k = Math.cos(a)
					r.copy(br).multiplyScalar(k).addScaledVector(bu, s).multiplyScalar(half)
					u.copy(bu).multiplyScalar(k).addScaledVector(br, -s).multiplyScalar(half)
				} else {
					r.copy(br).multiplyScalar(half)
					u.copy(bu).multiplyScalar(half)
				}
				at = billboard(out, at, col)
			}
			if (e.headTail >= 1) {
				setCell(life.tail, cols, rows, shift)
				tail.fromArray(vel, i * 3)
				if (!this.anchored) tail.applyMatrix3(m3)
				const t = e.flags & FLAG_TAIL_AGE ? Math.min(e.tailTime, age) : e.tailTime
				tail.multiplyScalar(-t)
				const tr = tail.dot(right)
				const tu = tail.dot(upv)
				const l2 = tr * tr + tu * tu
				if (l2 < 7.7e-4) {
					// Seen end on: a plain billboard (0x7b33fa).
					r.copy(right).multiplyScalar(half)
					u.copy(upv).multiplyScalar(half)
					at = billboard(out, at, col)
				} else {
					perp.copy(upv)
						.multiplyScalar(tr)
						.addScaledVector(right, -tu)
						.multiplyScalar(half / Math.sqrt(l2))
					at = vertex(out, at, v3.copy(c).sub(perp), cu0, cv1, col)
					at = vertex(out, at, v3.copy(c).add(perp), cu0, cv0, col)
					at = vertex(out, at, v3.copy(c).add(tail).add(perp), cu1, cv0, col)
					at = vertex(out, at, v3.copy(c).add(tail).sub(perp), cu1, cv1, col)
				}
			}
		}
		return at - start
	}
}

// The cell being drawn: set by the expand loop for the vertex writers.
let cu0 = 0
let cu1 = 1
let cv0 = 0
let cv1 = 1

/**
 * Picks flipbook cell idx of a cols x rows atlas (0x7b2bd5): column idx & (cols - 1), row idx >> log2(cols),
 * the row never clamped, so a cell past the last wraps to the top through the repeating texture.
 */
function setCell(idx: number, cols: number, rows: number, shift: number) {
	const cx = idx & (cols - 1)
	const cy = idx >> shift
	cu0 = cx / cols
	cu1 = (cx + 1) / cols
	cv0 = cy / rows
	cv1 = (cy + 1) / rows
}

/** The quad c ± r ± u, corners in perimeter order. */
function billboard(out: Float32Array, at: number, col: number[]): number {
	at = vertex(out, at, v3.copy(c).sub(r).sub(u), cu0, cv1, col)
	at = vertex(out, at, v3.copy(c).add(r).sub(u), cu1, cv1, col)
	at = vertex(out, at, v3.copy(c).add(r).add(u), cu1, cv0, col)
	return vertex(out, at, v3.copy(c).sub(r).add(u), cu0, cv0, col)
}

function vertex(out: Float32Array, at: number, p: THREE.Vector3, uu: number, vv: number, col: number[]): number {
	out[at] = p.x
	out[at + 1] = p.y
	out[at + 2] = p.z
	out[at + 3] = uu
	out[at + 4] = vv
	out[at + 5] = col[0]
	out[at + 6] = col[1]
	out[at + 7] = col[2]
	out[at + 8] = col[3]
	return at + VERTEX_FLOATS
}
