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
    return out.set(
      w0 * p[o] + w1 * p[o + 3] + w2 * p[o + 6] + w3 * p[o + 9],
      w0 * p[o + 1] + w1 * p[o + 4] + w2 * p[o + 7] + w3 * p[o + 10],
      w0 * p[o + 2] + w1 * p[o + 5] + w2 * p[o + 8] + w3 * p[o + 11],
    )
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
    return out.set(
      w0 * p[o] + w1 * p[o + 3] + w2 * p[o + 6] + w3 * p[o + 9],
      w0 * p[o + 1] + w1 * p[o + 4] + w2 * p[o + 7] + w3 * p[o + 10],
      w0 * p[o + 2] + w1 * p[o + 5] + w2 * p[o + 8] + w3 * p[o + 11],
    )
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
      dir.copy(Z).multiplyScalar(c).add(kTmp.crossVectors(kTan, Z).multiplyScalar(s)).addScaledVector(kTan, kTan.z * (1 - c))
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
  acc = 0
  gatePrev = false
  rng: number
  readonly def: MeshEmitter
  readonly anchored: boolean
  private spline: SplineChain | null

  constructor(def: MeshEmitter, seed: number) {
    this.def = def
    this.rng = (seed >>> 0) | 1
    this.anchored = (def.flags & FLAG_MODEL_SPACE) === 0
    this.spline = def.shape === SHAPE_SPLINE && SplineChain.valid(def.spline) ? new SplineChain(def.spline) : null
  }

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
    if (this.anchored) mOrigin.setFromMatrixPosition(m)
    else mOrigin.set(0, 0, 0)
    const { pos, vel, age } = this
    let n = this.count
    for (let i = 0; i < n; ) {
      age[i] += dt
      if (age[i] >= this.life[i]) {
        this.move(--n, i)
        continue
      }
      const o = i * 3
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
      i++
    }
    this.count = n

    const burst = (e.flags & FLAG_BURST) !== 0
    accumulate(burst, rateAt(e, ms), emitting(e, ms), lod, dt, this)
    if (this.acc < 1) return
    m3.setFromMatrix4(m)
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
      const i = this.count++
      bPos.toArray(this.pos, i * 3)
      bDir.toArray(this.vel, i * 3)
      // Births of one frame start a little apart, so a stream does not come out in clumps.
      this.age[i] = burst ? 0 : rand01(this) * Math.min(dt, 0.1)
      this.life[i] = now[LIFESPAN]
      this.phase[i] = nextU32(this)
    }
    // A full pool owes no backlog: the client's would pour out all at once as particles die.
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
          perp
            .copy(upv)
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
