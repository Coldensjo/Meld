import * as THREE from 'three'

// Lifts and elevators (#956): a type 11 game object moves along a loop of keyframes in
// TransportAnimation.dbc (internal/vmangos/lifts.go), keyed by its template's entry. A frame is a time
// in milliseconds since the loop's start and an offset in yards from the spawn, in the server's axes
// before the spawn's rotation; between two frames the lift moves in a straight line at an even speed,
// two frames at one offset are a wait, and after the last frame (whose time is the loop's length) it
// starts again at the first. The client's evaluator (Benilla's elevators.rs `elevator_sample`) is
// `liftOffset`; `liftPoint` puts an offset in the editor's axes from a spawn.

/** A keyframe of a lift's loop (vmangos.LiftFrame). */
export interface LiftFrame {
	time: number
	x: number
	y: number
	z: number
	seq: number
}

/** Where a lift stands: a spawn's editor position, facing and tilt (vmangos.WorldSpawn's fields). */
export interface LiftOrigin {
	x: number
	y: number
	z: number
	orientation: number
	tilt?: number[] | null
}

/** Offset (yards) and times (ms) closer than this are the same. */
const SAME = 1e-3

/** The loop's length in milliseconds: its last frame's time. */
export function liftPeriod(frames: readonly LiftFrame[]): number {
	return frames.at(-1)?.time ?? 0
}

/** Whether two frames stand at one offset. */
export function samePlace(a: LiftFrame, b: LiftFrame): boolean {
	return Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME && Math.abs(a.z - b.z) < SAME
}

/**
 * The lift's offset `ms` milliseconds into its loop (wrapped round the loop), written to `out`, as the
 * client works it out: the frames either side of the time, and the even move between them.
 */
export function liftOffset(frames: readonly LiftFrame[], ms: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
	const n = frames.length
	if (!n) return Object.assign(out, { x: 0, y: 0, z: 0 })
	const period = liftPeriod(frames)
	const t = period > 0 ? ((ms % period) + period) % period : 0
	let hi = 0
	while (hi < n && frames[hi].time <= t) hi++
	const prev = frames[Math.max(0, hi - 1)]
	const next = frames[Math.min(hi, n - 1)]
	const span = next.time - prev.time
	const k = span > 0 ? (t - prev.time) / span : 0
	out.x = prev.x + (next.x - prev.x) * k
	out.y = prev.y + (next.y - prev.y) * k
	out.z = prev.z + (next.z - prev.z) * k
	return out
}

const UP = new THREE.Vector3(0, 1, 0)
const tmpQ = new THREE.Quaternion()
const tmpTilt = new THREE.Quaternion()

/**
 * A spawn's rotation in the editor's axes without the model's quarter turn (spawnTilt.ts's
 * `spawnQuaternion` before it): what the server turns a lift's offsets by.
 */
export function liftRotation(o: LiftOrigin, out: THREE.Quaternion): THREE.Quaternion {
	out.setFromAxisAngle(UP, o.orientation)
	const t = o.tilt
	if (t && t.length === 4) out.multiply(tmpTilt.set(-t[1], t[2], -t[0], t[3]).normalize())
	return out
}

/**
 * The editor point of a lift standing at offset `off` (server axes) from its spawn `o`, written to
 * `out`: the server's (x, y, z) is the editor's (-y, z, -x), turned by the spawn's rotation.
 */
export function liftPoint(o: LiftOrigin, off: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
	out.set(-off.y, off.z, -off.x).applyQuaternion(liftRotation(o, tmpQ))
	return out.set(out.x + o.x, out.y + o.y, out.z + o.z)
}

/** Why the client and the server would not move a lift along `frames` (CheckLiftFrames' twin), or '' when they would. */
export function liftProblem(frames: readonly LiftFrame[]): string {
	if (frames.length < 2) return 'The loop needs at least two frames.'
	if (frames[0].time !== 0) return 'The loop starts at time 0.'
	for (let i = 1; i < frames.length; i++) if (frames[i].time <= frames[i - 1].time) return `Frame ${i + 1} needs a later time than the frame before it.`
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i]
		if (![f.x, f.y, f.z].every(Number.isFinite)) return `Frame ${i + 1} has an offset that is not a number.`
		if (Math.max(Math.abs(f.x), Math.abs(f.y), Math.abs(f.z)) > 5000) return `Frame ${i + 1} is more than 5000 yards from the spawn.`
	}
	if (liftPeriod(frames) > 24 * 3600 * 1000) return 'The loop takes longer than a day.'
	return ''
}

/** A new lift's loop: it waits 5 s at the bottom, rises `rise` yards in 6 s, waits 5 s at the top and comes back down in 6 s. */
export function defaultLiftFrames(rise = 20): LiftFrame[] {
	return [
		{ time: 0, x: 0, y: 0, z: 0, seq: 0 },
		{ time: 5000, x: 0, y: 0, z: 0, seq: 0 },
		{ time: 11000, x: 0, y: 0, z: rise, seq: 0 },
		{ time: 16000, x: 0, y: 0, z: rise, seq: 0 },
		{ time: 22000, x: 0, y: 0, z: 0, seq: 0 },
	]
}

/** The stops of a loop: each run of frames at one offset, with how long the lift waits there (ms) and the frame it starts at. */
export function liftStops(frames: readonly LiftFrame[]): { frame: number; wait: number; at: LiftFrame }[] {
	const out: { frame: number; wait: number; at: LiftFrame }[] = []
	let still = false
	for (let i = 0; i + 1 < frames.length; i++) {
		const waits = samePlace(frames[i], frames[i + 1])
		const span = frames[i + 1].time - frames[i].time
		if (waits && still) out[out.length - 1].wait += span
		else if (waits) out.push({ frame: i, wait: span, at: frames[i] })
		still = waits
	}
	return out
}
