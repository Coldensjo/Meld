// Run with: node --import ./tests/register.mjs --test tests/particles.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { AnimTrack, MeshEmitter } from '../src/lib/wow/api.ts'
import { accumulate, blendOf, cellAt, emitLocal, fogOf, litOf, overLife, ParticlePool, PARTICLE_FLOATS, SplineChain, spinAngle, VERTEX_FLOATS, type LifeSample } from '../src/lib/world/particles.ts'

const k = (v: number): AnimTrack => ({ t: [0], v: [v], loop: 0 })

/** A plain emitter: a 2 x 4 plane at the origin, a narrow cone, 10 a second for 1 s. */
function def(over: Partial<MeshEmitter> = {}): MeshEmitter {
  return {
    frame: new THREE.Matrix4().toArray(),
    bone: -1,
    flags: 0,
    shape: 1,
    blend: 2,
    texture: 'x.blp',
    rows: 1,
    cols: 1,
    headTail: 0,
    rate: k(10),
    params: [k(1), null, k(0.5), k(0.5), null, k(1), k(2), k(4), null],
    drag: 0,
    tailTime: 0,
    spin: 0,
    twinkle: [0, 1, 1, 1],
    mid: 0.5,
    colors: [
      [1, 0, 0, 1],
      [0, 1, 0, 0.5],
      [0, 0, 1, 0],
    ],
    sizes: [1, 2, 3],
    headCells: [0, 0, 0, 0],
    tailCells: [0, 0, 0, 0],
    repeat: [1, 1],
    ...over,
  }
}

const now = (over: Partial<Record<number, number>> = {}) => {
  const p = new Float32Array([1, 0, 0.5, 0.5, 0, 1, 2, 4, 0])
  for (const [i, v] of Object.entries(over)) p[Number(i)] = v!
  return p
}

test('blend, lighting and fog follow the record (flag 0x1 unlit, 0x8 no fog)', () => {
  assert.equal(blendOf(def({ blend: 4 })), 'add')
  assert.equal(blendOf(def({ blend: 3 })), 'add')
  assert.equal(blendOf(def({ blend: 6 })), 'alpha', 'mod draws as alpha')
  assert.equal(blendOf(def({ blend: 1 })), 'alphaKey')
  assert.equal(blendOf(def({ blend: 0 })), 'opaque')
  assert.ok(litOf(def({ flags: 0x2, blend: 2 })), "the Elwynn waterfall's spray is lit")
  assert.ok(!litOf(def({ flags: 0x29, blend: 4 })), 'bit 0x1 is unlit')
  assert.ok(!litOf(def({ blend: 5 })), 'a mod blend never lights')
  assert.equal(fogOf(def({ blend: 4 })), 'black')
  assert.equal(fogOf(def({ blend: 2 })), 'scene')
  assert.equal(fogOf(def({ flags: 0x8 })), 'off')
})

test('a flipbook ramp runs from its first cell to its last either way and wraps past 255', () => {
  const t = (x: number) => x * 0.99 + 0.005
  assert.equal(cellAt(0, 15, t(0)), 0)
  assert.equal(cellAt(0, 15, t(1)), 15)
  assert.equal(cellAt(15, 0, t(0)), 15, 'a decreasing pair plays backwards')
  assert.equal(cellAt(15, 0, t(1)), 0)
  assert.equal(cellAt(250, 260, t(1)), 4, 'mod 256, not a clamp')
})

test('the over-life ramps split at mid and hit their keys at the ends', () => {
  const s: LifeSample = { color: [0, 0, 0, 0], size: 0, head: 0, tail: 0 }
  const e = def()
  overLife(e, 0, s)
  assert.ok(Math.abs(s.color[0] - 1) < 0.01 && Math.abs(s.size - 1) < 0.01)
  overLife(e, 0.5, s)
  assert.ok(Math.abs(s.color[1] - 1) < 0.01 && Math.abs(s.size - 2) < 0.01, 'the middle key at mid')
  overLife(e, 1, s)
  assert.ok(Math.abs(s.color[2] - 1) < 0.01 && Math.abs(s.size - 3) < 0.01 && s.color[3] < 0.01)
  // A repeat cycles the cells only.
  const r = def({ headCells: [0, 3, 0, 3], repeat: [2, 1] })
  overLife(r, 0.24, s)
  const early = s.head
  overLife(r, 0.26, s)
  assert.ok(s.head < early, `the cells start over halfway through the segment: ${early} then ${s.head}`)
})

test('a plane spawns in its rectangle within a symmetric cone about +Z', () => {
  const e = def()
  const rng = { rng: 12345 }
  const p = new THREE.Vector3()
  const d = new THREE.Vector3()
  let neg = false
  let pos = false
  for (let i = 0; i < 256; i++) {
    emitLocal(e, now(), rng, null, p, d)
    assert.ok(Math.abs(p.x) <= 1 + 1e-6 && Math.abs(p.y) <= 2 + 1e-6 && p.z === 0, `in the 2 x 4 area: ${p.toArray()}`)
    assert.ok(d.z > 0)
    neg ||= d.x < -1e-3
    pos ||= d.x > 1e-3
  }
  assert.ok(neg && pos)
})

test("a sphere's area length and width are its radii, its direction radial; at radius 0 it still sprays", () => {
  const e = def({ shape: 2 })
  const rng = { rng: 99 }
  const p = new THREE.Vector3()
  const d = new THREE.Vector3()
  for (let i = 0; i < 256; i++) {
    emitLocal(e, now(), rng, null, p, d)
    const r = p.length()
    assert.ok(r >= 2 - 1e-4 && r <= 4 + 1e-4, `radius ${r}`)
    assert.ok(p.clone().normalize().dot(d) > 0.999)
  }
  let up = false
  let down = false
  for (let i = 0; i < 256; i++) {
    emitLocal(e, now({ 2: Math.PI, 3: 0, 6: 0, 7: 0 }), rng, null, p, d)
    assert.equal(p.length(), 0)
    assert.ok(Math.abs(d.length() - 1) < 1e-5)
    up ||= d.z > 0.5
    down ||= d.z < -0.5
  }
  assert.ok(up && down, 'the fan covers the full ring')
  emitLocal(def({ shape: 2, flags: 0x100 }), now(), rng, null, p, d)
  assert.deepEqual(d.toArray(), [0, 0, 1], 'flag 0x100: straight up')
})

test('a spline chain is walked by arc length and spawns on it', () => {
  const x = (v: number) => [v, 0, 0]
  const pts = [...x(0), ...x(1 / 3), ...x(2 / 3), ...x(1), ...x(2), ...x(3), ...x(4)]
  assert.ok(SplineChain.valid(pts))
  const s = new SplineChain(pts)
  const v = new THREE.Vector3()
  assert.ok(Math.abs(s.eval(0.25, v).x - 1) < 1e-4, 'the 1 yd segment ends a quarter along')
  assert.ok(Math.abs(s.eval(0.625, v).x - 2.5) < 1e-4)
  assert.equal(s.eval(-1, v).x, 0)
  assert.equal(s.eval(2, v).x, 4)
  const e = def({ shape: 3, spline: pts })
  const p = new THREE.Vector3()
  const d = new THREE.Vector3()
  for (let i = 0; i < 64; i++) {
    emitLocal(e, now({ 2: 0, 6: 0.25, 7: 0.75 }), { rng: 31 + i }, s, p, d)
    assert.ok(p.x >= 1 - 1e-3 && p.x <= 3 + 1e-3 && p.y === 0, `on the chain: ${p.x}`)
    assert.deepEqual(d.toArray(), [0, 0, 0], 'no spin and no z source: the flame stands')
  }
  assert.ok(!SplineChain.valid([0, 0, 0]))
})

test('a pour owes rate·dt; a burst puts its particles down once as the gate opens', () => {
  const st = { acc: 0, gatePrev: false }
  accumulate(false, 10, true, 1, 0.25, st)
  assert.equal(st.acc, 2.5)
  accumulate(false, 10, false, 1, 0.25, st)
  assert.equal(st.acc, 0, 'a closed gate clears the debt')
  const b = { acc: 0, gatePrev: false }
  assert.equal(accumulate(true, 30, true, 1, 0.1, b), 30)
  b.acc = 0
  assert.equal(accumulate(true, 30, true, 1, 0.1, b), 0, 'not again while it stays open')
  accumulate(true, 0, true, 1, 0.1, b)
  assert.equal(accumulate(true, 30, true, 1, 0.1, b), 30, 're-armed once the rate fell')
})

test('a world-space pool falls on world up and stays put as the emitter moves; a model-space one rides it', () => {
  const at = new THREE.Matrix4().makeTranslation(10, 0, 0)
  const world = new ParticlePool(def({ params: [null, null, null, null, k(10), k(5), null, null, null] }), 7)
  world.step(0.1, 0, at, 1)
  assert.equal(world.count, 1)
  assert.ok(Math.abs(world.pos[0] - 10) < 1e-6, 'born at the emitter, in world space')
  world.step(0.1, 100, new THREE.Matrix4().makeTranslation(50, 0, 0), 1)
  assert.ok(Math.abs(world.pos[0] - 10) < 1e-6, 'the first particle stays where it was born')
  assert.ok(world.pos[1] < 0 && world.pos[2] === 0, 'gravity pulls along -Y')
  const model = new ParticlePool(def({ flags: 0x10, params: [null, null, null, null, k(10), k(5), null, null, null] }), 7)
  model.step(0.1, 0, at, 1)
  model.step(0.1, 100, at, 1)
  assert.ok(model.pos[2] < 0 && model.pos[1] === 0 && model.pos[0] === 0, 'spawn-space gravity pulls along -Z')
})

test('particles die at their lifespan; drag slows them; the pool stops at its cap', () => {
  const pool = new ParticlePool(def({ rate: k(10), params: [k(5), null, null, null, null, k(0.3), null, null, null], drag: 2 }), 3)
  const id = new THREE.Matrix4()
  pool.step(0.1, 0, id, 1)
  const v0 = Math.hypot(pool.vel[0], pool.vel[1], pool.vel[2])
  pool.step(0.1, 100, id, 1)
  assert.ok(Math.hypot(pool.vel[0], pool.vel[1], pool.vel[2]) < v0, 'drag')
  for (let i = 0; i < 10; i++) pool.step(0.1, 200 + i * 100, id, 1)
  assert.ok(pool.count <= 4, `0.3 s lives at 10 a second: ${pool.count}`)
  const flood = new ParticlePool(def({ rate: k(1e6), params: [null, null, null, null, null, k(100), null, null, null] }), 5)
  flood.step(0.1, 0, id, 1)
  assert.equal(flood.count, 1024)
})

test('a head quad faces the camera at its size; a tail streaks back along the velocity', () => {
  const pool = new ParticlePool(def({ rate: k(1), params: [k(0), null, null, null, null, k(10), null, null, null], sizes: [0.5, 0.5, 0.5], headTail: 2, tailTime: 2 }), 9)
  const id = new THREE.Matrix4()
  pool.step(1, 0, id, 1)
  assert.equal(pool.count, 1)
  pool.vel.set([0, 3, 0])
  const out = new Float32Array(PARTICLE_FLOATS)
  const n = pool.expand(id, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), out, 0)
  assert.equal(n, 8 * VERTEX_FLOATS, 'a head and a tail')
  const c = [out[0], out[1], out[2]]
  assert.deepEqual(c, [-0.5, -0.5, 0], 'the head spans ±size')
  assert.deepEqual([out[9 * 2], out[9 * 2 + 1]], [0.5, 0.5])
  // The tail's far corners lie velocity · tailTime behind it.
  const tailY = out[4 * VERTEX_FLOATS + 2 * VERTEX_FLOATS + 1]
  assert.ok(Math.abs(tailY - -6) < 1e-5, `tail end at ${tailY}`)
  // Twinkle percent below the noise hides the quad.
  const hidden = new ParticlePool(def({ rate: k(1), twinkle: [0, -1, 1, 1] }), 9)
  hidden.step(1, 0, id, 1)
  assert.equal(hidden.expand(id, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), out, 0), 0)
})

test('a negative spin turns back on the particles with bit 5 of their phase', () => {
  assert.equal(spinAngle(-3, 0.5, 0x20), 1.5)
  assert.equal(spinAngle(-3, 0.5, 0x1f), -1.5)
  assert.equal(spinAngle(3, 0.5, 0x20), 1.5)
})
