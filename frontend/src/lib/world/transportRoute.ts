import { segmentLengths, splinePoint, type Vec3 } from './taxiRoute'

// Boats and zeppelins (#954): how VMaNGOS moves a transport round its route
// (TransportMgr::GenerateWaypoints), for World › Transports' preview. The route is legs of points,
// one a map (vmangos.TransportLeg); each leg is the server's Catmull-Rom curve through its points
// (taxiRoute.ts), and after a leg's last point the transport jumps to the next leg's first. A point
// with flags 2 is a dock: the transport comes to a stop there and waits its delay. From one dock to
// the next it speeds up at `accel` yd/s² to `speed` yd/s and slows down again into the dock, or, when
// the docks are too close for that, turns round half way; a jump between maps covers no distance, so
// it sails on at the speed it had. The points are in whatever space they are given in.

/** A point of a leg: the server's TaxiPoint, its flags and delay with it. */
export interface LegPoint extends Vec3 {
	flags: number
	delay: number
}

/** A leg of a route on one map (vmangos.TransportLeg). */
export interface LegShape {
	mapId: number
	points: LegPoint[]
}

/** The action flag of a dock (the server's IsStopFrame). */
export const DOCK = 2

/** A point of the route, flattened across the legs. */
interface Frame {
	leg: number
	index: number
	/** The distance along the route to this point from the route's first point. */
	at: number
	/** The distance to the next point of the same leg; 0 at a leg's end, which jumps. */
	next: number
	dock: boolean
	delay: number
}

/** A stretch of the round trip: a wait at a dock or a run from one dock to the next. */
interface Phase {
	start: number
	seconds: number
	/** The run's start along the route and its length; a wait has length 0. */
	from: number
	length: number
}

/** Where `at` found the transport: its leg (-1 when the route has none) and whether it waits at a dock. */
export interface Whereabouts {
	leg: number
	docked: boolean
}

/** How far ahead and behind a point the heading is measured, yards. */
const HEADING_SPAN = 2

export class TransportMotion {
	readonly legs: readonly LegShape[]
	/** The seconds of a whole round trip, the waits included. */
	readonly cycle: number
	/** The route's length, yards. */
	readonly length: number
	private frames: Frame[] = []
	private phases: Phase[] = []
	private lengths: number[][]
	/** Each leg's first and last point's distance along the route. */
	private legFrom: number[] = []
	private legTo: number[] = []
	private speed: number
	private accel: number
	private ahead: Vec3 = { x: 0, y: 0, z: 0 }
	private behind: Vec3 = { x: 0, y: 0, z: 0 }
	private where: Whereabouts = { leg: -1, docked: false }

	constructor(legs: readonly LegShape[], speed: number, accel: number) {
		this.legs = legs
		this.speed = Math.max(0.1, speed)
		this.accel = accel
		this.lengths = legs.map((l) => segmentLengths(l.points))
		let at = 0
		legs.forEach((l, leg) => {
			this.legFrom.push(at)
			l.points.forEach((p, index) => {
				const next = this.lengths[leg][index] ?? 0
				this.frames.push({ leg, index, at, next, dock: p.flags === DOCK, delay: p.delay })
				at += next
			})
			this.legTo.push(at)
		})
		this.length = at
		const docks = this.frames.filter((f) => f.dock)
		let t = 0
		if (!docks.length) {
			// No dock: round and round at full speed.
			this.phases.push({ start: 0, seconds: at / this.speed, from: 0, length: at })
			t = at / this.speed
		}
		docks.forEach((d, i) => {
			this.phases.push({ start: t, seconds: d.delay, from: d.at, length: 0 })
			t += d.delay
			const next = docks[(i + 1) % docks.length]
			let run = next.at - d.at
			if (run <= 0) run += at
			const seconds = this.runSeconds(run)
			this.phases.push({ start: t, seconds, from: d.at, length: run })
			t += seconds
		})
		this.cycle = t
	}

	/** The seconds a run of `d` yards from a standing start to a stop takes. */
	runSeconds(d: number): number {
		const v = this.speed
		const a = this.accel
		if (a <= 0) return d / v
		const accelDist = (0.5 * v * v) / a
		return d < 2 * accelDist ? 2 * Math.sqrt(d / a) : d / v + v / a
	}

	/** How far a run of `d` yards has gone `t` seconds after it left. */
	private runDistance(d: number, t: number): number {
		const v = this.speed
		const a = this.accel
		if (a <= 0) return Math.min(d, v * t)
		const total = this.runSeconds(d)
		t = Math.min(Math.max(0, t), total)
		const accelDist = (0.5 * v * v) / a
		if (d < 2 * accelDist) {
			const half = total / 2
			return t <= half ? 0.5 * a * t * t : d - 0.5 * a * (total - t) * (total - t)
		}
		const ta = v / a
		if (t <= ta) return 0.5 * a * t * t
		if (t <= total - ta) return accelDist + v * (t - ta)
		return d - 0.5 * a * (total - t) * (total - t)
	}

	/** The seconds after a run left that it has gone `s` yards (runDistance's inverse). */
	private runTime(d: number, s: number): number {
		const v = this.speed
		const a = this.accel
		if (a <= 0) return s / v
		const total = this.runSeconds(d)
		s = Math.min(Math.max(0, s), d)
		const accelDist = (0.5 * v * v) / a
		if (d < 2 * accelDist) return s <= d / 2 ? Math.sqrt((2 * s) / a) : total - Math.sqrt((2 * (d - s)) / a)
		if (s <= accelDist) return Math.sqrt((2 * s) / a)
		if (s <= d - accelDist) return v / a + (s - accelDist) / v
		return total - Math.sqrt((2 * (d - s)) / a)
	}

	/** The point `d` yards along the route (wrapping round), into `out`; returns its frame, or null for an empty route. */
	private pointAt(d: number, out: Vec3): Frame | null {
		d = this.wrap(d)
		const f = this.frameAt(d)
		if (!f) return null
		const pts = this.legs[f.leg].points
		const u = f.next > 0 ? Math.min(1, Math.max(0, (d - f.at) / f.next)) : 0
		if (f.next > 0) splinePoint(pts, f.index, u, out)
		else {
			const p = pts[f.index]
			out.x = p.x
			out.y = p.y
			out.z = p.z
		}
		return f
	}

	/** A distance along the route brought round into [0, length). */
	private wrap(d: number): number {
		return this.length > 0 ? ((d % this.length) + this.length) % this.length : 0
	}

	/** The frame whose stretch holds the distance `d` along the route (wrapped). */
	private frameAt(d: number): Frame | null {
		const fr = this.frames
		if (!fr.length) return null
		d = this.wrap(d)
		// The last frame at or before d.
		let lo = 0
		let hi = fr.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if (fr[mid].at <= d) lo = mid
			else hi = mid - 1
		}
		// At a jump the leg's end and the next leg's start are at the same distance: the start is taken, where the route goes on.
		return fr[lo]
	}

	/** Where the round trip is at `t` seconds (wrapping): the position into `out`, and the leg and whether it waits. Allocates nothing. */
	at(t: number, out: Vec3): Whereabouts {
		const w = this.where
		w.leg = -1
		w.docked = false
		if (!this.phases.length || this.cycle <= 0) {
			const f = this.pointAt(0, out)
			if (f) w.leg = f.leg
			return w
		}
		t = ((t % this.cycle) + this.cycle) % this.cycle
		let ph = this.phases[this.phases.length - 1]
		for (const p of this.phases) {
			if (t < p.start + p.seconds) {
				ph = p
				break
			}
		}
		const s = ph.length > 0 ? this.runDistance(ph.length, t - ph.start) : 0
		const f = this.pointAt(ph.from + s, out)
		if (f) w.leg = f.leg
		w.docked = ph.length === 0
		return w
	}

	/**
	 * The heading at `t` seconds: the angle, in the plane of x and y, of the way the route runs there
	 * (atan2 of y over x), measured over a couple of yards of its own leg.
	 */
	heading(t: number): number {
		const d = this.wrap(this.distanceAt(t))
		const f = this.frameAt(d)
		if (!f) return 0
		const first = this.legFrom[f.leg]
		const last = this.legTo[f.leg]
		const a = Math.max(first, Math.min(last, d - HEADING_SPAN))
		const b = Math.max(first, Math.min(last, d + HEADING_SPAN))
		if (b - a < 1e-6) return 0
		this.pointAt(a, this.behind)
		this.pointAt(b - 1e-4, this.ahead)
		return Math.atan2(this.ahead.y - this.behind.y, this.ahead.x - this.behind.x)
	}

	/** The distance along the route at `t` seconds. */
	distanceAt(t: number): number {
		if (!this.phases.length || this.cycle <= 0) return 0
		t = ((t % this.cycle) + this.cycle) % this.cycle
		for (const p of this.phases) if (t < p.start + p.seconds) return p.from + (p.length > 0 ? this.runDistance(p.length, t - p.start) : 0)
		return 0
	}

	/** The second of the round trip the route reaches `d` yards along it (on a run; at a dock, the arrival, or with `leaving` the departure). */
	timeAt(d: number, leaving = false): number {
		const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
		if (leaving) for (const p of this.phases) if (p.length === 0 && near(p.from, d)) return p.start + p.seconds
		for (const p of this.phases) {
			if (p.length === 0) {
				if (near(p.from, d)) return p.start
				continue
			}
			let s = d - p.from
			if (s < -1e-6) s += this.length
			if (s >= -1e-6 && s <= p.length + 1e-6) return p.start + this.runTime(p.length, s)
		}
		return 0
	}

	/**
	 * The stretches of the round trip spent on map `mapId`, in seconds from the trip's start, in order:
	 * [start, end] a leg, with end past `cycle` when the leg runs over the trip's start.
	 */
	windows(mapId: number): [number, number][] {
		const out: [number, number][] = []
		this.legs.forEach((l, leg) => {
			if (l.mapId !== mapId || !l.points.length) return
			const start = this.timeAt(this.legFrom[leg])
			let end = this.timeAt(this.legTo[leg], true)
			if (end <= start) end += this.cycle
			out.push([start, end])
		})
		return out.sort((a, b) => a[0] - b[0])
	}

	/** The docks of the route: each one's leg, its point and its wait. */
	docks(): { leg: number; index: number; point: LegPoint }[] {
		return this.frames.filter((f) => f.dock).map((f) => ({ leg: f.leg, index: f.index, point: this.legs[f.leg].points[f.index] }))
	}
}

/**
 * A preview's play of map `mapId`'s stretches only: `seconds` into it, the round trip's second (the
 * stretches played one after the other, round and round), or NaN when the route has none there.
 */
export function previewTime(windows: readonly [number, number][], seconds: number): number {
	let total = 0
	for (const [a, b] of windows) total += b - a
	if (total <= 0) return NaN
	let left = ((seconds % total) + total) % total
	for (const [a, b] of windows) {
		if (left <= b - a) return a + left
		left -= b - a
	}
	return windows[windows.length - 1][1]
}
