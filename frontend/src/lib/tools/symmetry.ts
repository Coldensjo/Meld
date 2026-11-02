// Symmetry painting (#182): a brush stroke applied at every mirrored (or, radially, turned) copy of the
// point under the cursor, in the same stroke and undo step, for symmetric battlegrounds and arenas. Kept
// free of the editor state and three.js scenes so it can be tested on its own: the tools pass in
// `editor.symmetry` and the terrain.

/** Off; mirrored left to right (x flips) or front to back (z flips); both (four copies); turned half way about the centre; or turned `count` ways. */
export type SymmetryMode = 'off' | 'x' | 'z' | 'xz' | 'point' | 'radial'

/** The radial mode's copies, 2 to 8. */
export const MIN_RADIAL = 2
export const MAX_RADIAL = 8

/** The symmetry the brush tools apply (`editor.symmetry`, per map): the mode, the radial count, and the centre in world x, z (null: the map's centre). */
export interface SymmetryState {
	mode: SymmetryMode
	count: number
	center: { x: number; z: number } | null
}

/**
 * One copy of a stroke: a point p goes to c + M (p - c), M the 2x2 matrix (m00 m01; m10 m11) over
 * (x, z). `flip` is a reflection (an x or z mirror). A model's heading `rotY` (the editor's, turned
 * about world up, facing its own +x) goes to `base - rotY` for a reflection and `rotY + base` for a
 * turn, which keeps a gate facing the centre facing it on every copy.
 */
export interface Mirror {
	m00: number
	m01: number
	m10: number
	m11: number
	flip: boolean
	base: number
}

export const IDENTITY: Mirror = Object.freeze({ m00: 1, m01: 0, m10: 0, m11: 1, flip: false, base: 0 })
/** x flips (the axis runs along z through the centre). */
const MIRROR_X: Mirror = Object.freeze({ m00: -1, m01: 0, m10: 0, m11: 1, flip: true, base: Math.PI })
/** z flips (the axis runs along x). */
const MIRROR_Z: Mirror = Object.freeze({ m00: 1, m01: 0, m10: 0, m11: -1, flip: true, base: 0 })

/**
 * A turn by `a` radians about world up, the way three.js turns a model by its rotation.y (and so the
 * way `rotY` turns): (x, z) goes to (x cos a + z sin a, -x sin a + z cos a).
 */
function turn(a: number): Mirror {
	const c = Math.cos(a)
	const s = Math.sin(a)
	return Object.freeze({ m00: c, m01: s, m10: -s, m11: c, flip: false, base: a })
}

const cache = new Map<string, readonly Mirror[]>()

/** The copies a mode makes, the stroke itself (IDENTITY) first. Cached: the same array every call. */
export function mirrorsOf(mode: SymmetryMode, count: number): readonly Mirror[] {
	const n = mode === 'radial' ? Math.max(MIN_RADIAL, Math.min(MAX_RADIAL, Math.round(count) || MIN_RADIAL)) : 0
	const key = mode === 'radial' ? `radial${n}` : mode
	let list = cache.get(key)
	if (list) return list
	if (mode === 'x') list = [IDENTITY, MIRROR_X]
	else if (mode === 'z') list = [IDENTITY, MIRROR_Z]
	else if (mode === 'xz') list = [IDENTITY, MIRROR_X, MIRROR_Z, turn(Math.PI)]
	else if (mode === 'point') list = [IDENTITY, turn(Math.PI)]
	else if (mode === 'radial') list = [IDENTITY, ...Array.from({ length: n - 1 }, (_, i) => turn(((i + 1) * 2 * Math.PI) / n))]
	else list = [IDENTITY]
	cache.set(key, list)
	return list
}

/** The centre the copies are made about: the set one, or the middle of a map `worldSize` across. */
export function symmetryCenter(s: SymmetryState, worldSize: number): { x: number; z: number } {
	return s.center ?? { x: worldSize / 2, z: worldSize / 2 }
}

/**
 * A picked centre snapped to the nearest half cell: on a vertex or a cell's middle, the copies of a
 * vertex land on vertices too, so a mirrored stroke gives the same heights on both sides.
 */
export function snapCenter(x: number, z: number, cellSize: number): { x: number; z: number } {
	const h = cellSize / 2
	return { x: Math.round(x / h) * h, z: Math.round(z / h) * h }
}

/** Point (x, z) as copy `m` about centre (cx, cz), into `out` [x, z]. */
export function mirrorPoint(m: Mirror, cx: number, cz: number, x: number, z: number, out: Float64Array | number[]) {
	if (m === IDENTITY) {
		// Exactly the point, not cx + (x - cx), which can be off by a rounding.
		out[0] = x
		out[1] = z
		return
	}
	const dx = x - cx
	const dz = z - cz
	out[0] = cx + m.m00 * dx + m.m01 * dz
	out[1] = cz + m.m10 * dx + m.m11 * dz
}

/** An offset (dx, dz) as copy `m` (no centre), into `out` [x, z]. */
export function mirrorOffset(m: Mirror, dx: number, dz: number, out: Float64Array | number[]) {
	out[0] = m.m00 * dx + m.m01 * dz
	out[1] = m.m10 * dx + m.m11 * dz
}

/** The point copy `m` came from: (x, z) taken back through the inverse (M is orthogonal, so its transpose). */
export function unmirrorPoint(m: Mirror, cx: number, cz: number, x: number, z: number, out: Float64Array | number[]) {
	const dx = x - cx
	const dz = z - cz
	out[0] = cx + m.m00 * dx + m.m10 * dz
	out[1] = cz + m.m01 * dx + m.m11 * dz
}

/** A direction in radians over (x, z) (0 is +x, π/2 is +z, as Flatten's and the water's angled planes), as copy `m`. */
export function mirrorDirection(m: Mirror, rad: number): number {
	if (m === IDENTITY) return rad
	const c = Math.cos(rad)
	const s = Math.sin(rad)
	return Math.atan2(m.m10 * c + m.m11 * s, m.m00 * c + m.m01 * s)
}

/** A model's heading (`rotY`) as copy `m`. */
export function mirrorHeading(m: Mirror, rotY: number): number {
	return m.flip ? m.base - rotY : rotY + m.base
}

/**
 * A model's roll (`tiltZ`, about its own forward axis) as copy `m`: a reflection rolls it the other
 * way; its tilt forward or back (`tiltX`) stays (placementEuler's order, worked out for a model that is
 * the same on its left and right).
 */
export function mirrorRoll(m: Mirror, tiltZ: number): number {
	return m.flip ? -tiltZ : tiltZ
}

/** Scratch for one copy's point. */
const tmp = new Float64Array(2)

/**
 * The brush centres for one tick of a symmetric stroke at (x, z), into `out` as (x, z, copy index)
 * triples; returns how many. With `merge`, copies whose centres land within `radius` of a centre
 * before them become one dab at their mean (on the axis for a mirror, at the centre for a turn), so a
 * stroke along the axis does not paint, raise or dig twice there; tools whose dabs set a value rather
 * than add to it (clearing, the zone, the liquids, models) pass false, and only copies on the same
 * spot (within 5 cm) are dropped. A merged dab keeps its first copy's index.
 */
export function symmetricCenters(mirrors: readonly Mirror[], cx: number, cz: number, x: number, z: number, radius: number, merge: boolean, out: Float64Array, scratch: Float64Array): number {
	const r = merge ? Math.max(radius, 1e-3) : 0.05
	const r2 = r * r
	// scratch: per cluster, the first centre's x, z, the sums of x and z, and the member count.
	let n = 0
	const p = tmp
	for (let k = 0; k < mirrors.length; k++) {
		mirrorPoint(mirrors[k], cx, cz, x, z, p)
		const px = p[0]
		const pz = p[1]
		let j = 0
		for (; j < n; j++) {
			const dx = px - scratch[j * 5]
			const dz = pz - scratch[j * 5 + 1]
			if (dx * dx + dz * dz < r2) break
		}
		if (j < n) {
			scratch[j * 5 + 2] += px
			scratch[j * 5 + 3] += pz
			scratch[j * 5 + 4]++
			continue
		}
		scratch[n * 5] = px
		scratch[n * 5 + 1] = pz
		scratch[n * 5 + 2] = px
		scratch[n * 5 + 3] = pz
		scratch[n * 5 + 4] = 1
		out[n * 3 + 2] = k
		n++
	}
	for (let j = 0; j < n; j++) {
		const c = scratch[j * 5 + 4]
		// A copy left alone keeps its exact point (a merge of one would round it through the sum).
		out[j * 3] = c === 1 || !merge ? scratch[j * 5] : scratch[j * 5 + 2] / c
		out[j * 3 + 1] = c === 1 || !merge ? scratch[j * 5 + 1] : scratch[j * 5 + 3] / c
	}
	return n
}

/** Room for `symmetricCenters`: its out and scratch arrays, for the most copies a mode makes. */
export function centerBuffers(): { out: Float64Array; scratch: Float64Array } {
	return { out: new Float64Array(MAX_RADIAL * 3), scratch: new Float64Array(MAX_RADIAL * 5) }
}

/** The ground a copy's dab lands on: what `eachMirror` reads off the terrain. */
export interface MirrorGround {
	readonly worldSize: number
	heightAt(x: number, z: number): number
}

/** A copy's dab for `eachMirror`'s callback: where it lands (y on the ground there), its copy and its index. */
export interface MirrorDab {
	x: number
	y: number
	z: number
	mirror: Mirror
	index: number
}

const dab: MirrorDab = { x: 0, y: 0, z: 0, mirror: IDENTITY, index: 0 }
const bufs = centerBuffers()

/**
 * Runs `fn` once for each dab of a symmetric stroke at `hit` (once, at `hit`, with symmetry off: one
 * check). The dab passed is reused between calls; its y is `hit.y` for the stroke's own unmoved dab and
 * the ground's height for the others. Not reentrant.
 */
export function eachMirror(s: SymmetryState, ground: MirrorGround, hit: { x: number; y: number; z: number }, radius: number, merge: boolean, fn: (d: MirrorDab) => void) {
	if (s.mode === 'off') {
		dab.x = hit.x
		dab.y = hit.y
		dab.z = hit.z
		dab.mirror = IDENTITY
		dab.index = 0
		fn(dab)
		return
	}
	const mirrors = mirrorsOf(s.mode, s.count)
	const c = symmetryCenter(s, ground.worldSize)
	const n = symmetricCenters(mirrors, c.x, c.z, hit.x, hit.z, radius, merge, bufs.out, bufs.scratch)
	const xs = bufs.out
	for (let i = 0; i < n; i++) {
		const x = xs[i * 3]
		const z = xs[i * 3 + 1]
		const k = xs[i * 3 + 2]
		dab.x = x
		dab.z = z
		dab.y = x === hit.x && z === hit.z ? hit.y : ground.heightAt(x, z)
		dab.mirror = mirrors[k]
		dab.index = k
		fn(dab)
	}
}

/** How many copies a stroke makes, for the status line and the guide; 1 with symmetry off. */
export function copyCount(s: SymmetryState): number {
	return mirrorsOf(s.mode, s.count).length
}
