import * as THREE from 'three'
import { editorPoint } from '../io/portCoords'
import { rayNearSegment, routeLines, type Vec3 } from './taxiRoute'

// Flight paths (#180): the open map's flight stops (TaxiNodes.dbc) and the routes from or to them
// (TaxiPath.dbc, through TaxiPathNode.dbc's points), drawn while View › Flight paths is on or the
// Flight Paths window edits them. The stops are posts topped by a marker coloured by who can fly
// from them; the routes are the curves a flight flies, red where they run under the ground. The
// picked route is drawn over everything with a marker on each point (the picked one yellow) and a
// line down to the ground under it, so its height can be read.

/** A flight stop in the server's coordinates (vmangos.TaxiNode). */
export interface TaxiStopShape extends Vec3 {
	id: number
	hordeMount: number
	allianceMount: number
}

/** A route in the server's coordinates (vmangos.TaxiRoute). */
export interface TaxiRouteShape {
	id: number
	from: number
	to: number
	points: Vec3[]
}

/** What the Flight Paths window has picked: a stop, a route and one of its points (-1 for none). */
export interface TaxiPick {
	stop: number | null
	route: number | null
	point: number
}

/**
 * How the Flight Paths window hears of the viewport's clicks (Engine.showTaxi): a pick, a stop or
 * route point moved by a drag (server coordinates; `index` -1 for a stop), and a point a click
 * added to a route while `drawing` says clicks draw.
 */
export interface TaxiHooks {
	drawing(): boolean
	pick(p: TaxiPick): void
	moved(kind: 'stop' | 'point', id: number, index: number, at: Vec3): void
	added(route: number, index: number, at: Vec3): void
}

/** The ground's height under an editor point, NaN where the open map has none. */
export type GroundAt = (x: number, z: number) => number

/** How high a stop's marker stands over it, yards. */
export const STOP_POST = 6
/** Pieces a route's curve is drawn in between two points. */
const PIECES = 8

const ALLIANCE = new THREE.Color(0x4d8dff)
const HORDE = new THREE.Color(0xff5a4d)
const BOTH = new THREE.Color(0x7ee081)
const NOBODY = new THREE.Color(0x8a8a8a)
const PICKED = new THREE.Color(0xffd23f)
const ROUTE = new THREE.Color(0x6fd3ff)
const PICKED_ROUTE = new THREE.Color(0xc9f1ff)
const UNDERGROUND = new THREE.Color(0xff3b30)

/** The colour of a stop's marker: by the sides that have a mount there. */
export function stopColor(s: { hordeMount: number; allianceMount: number }): THREE.Color {
	return s.hordeMount && s.allianceMount ? BOTH : s.allianceMount ? ALLIANCE : s.hordeMount ? HORDE : NOBODY
}

/**
 * Colours the line segments of `lines` (pairs of editor points) into `colors`: `base`, or red where
 * either end runs more than half a yard under the ground.
 */
export function underground(lines: readonly number[], ground: GroundAt, base: THREE.Color, colors: number[] = []): number[] {
	for (let i = 0; i < lines.length; i += 6) {
		let under = false
		for (const o of [0, 3]) {
			const g = ground(lines[i + o], lines[i + o + 2])
			if (lines[i + o + 1] < g - 0.5) under = true
		}
		const c = under ? UNDERGROUND : base
		colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
	}
	return colors
}

export class TaxiLayer {
	readonly group = new THREE.Group()
	/** What set last drew (the window's copy, which a drag moves before the window hears of it). */
	stops: TaxiStopShape[] = []
	routes: TaxiRouteShape[] = []
	tileX = 0
	tileY = 0
	pick: TaxiPick = { stop: null, route: null, point: -1 }
	private ground: GroundAt = () => NaN
	private readonly stopGeo = new THREE.OctahedronGeometry(2.2)
	private readonly pointGeo = new THREE.OctahedronGeometry(1.3)
	private stopMarks: THREE.InstancedMesh
	private pointMarks: THREE.InstancedMesh
	private posts: THREE.LineSegments
	private all: THREE.LineSegments
	private picked: THREE.LineSegments
	private drops: THREE.LineSegments
	private tmpM = new THREE.Matrix4()

	constructor() {
		const onTop = { depthTest: false, transparent: true, fog: false }
		this.stopMarks = new THREE.InstancedMesh(this.stopGeo, new THREE.MeshBasicMaterial(onTop), 16)
		this.pointMarks = new THREE.InstancedMesh(this.pointGeo, new THREE.MeshBasicMaterial(onTop), 32)
		this.posts = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.7, fog: false }))
		this.all = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, fog: false }))
		this.picked = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, ...onTop }))
		this.drops = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false, fog: false }))
		this.picked.renderOrder = this.drops.renderOrder = 10
		this.stopMarks.renderOrder = this.pointMarks.renderOrder = 11
		for (const o of [this.stopMarks, this.pointMarks, this.posts, this.all, this.picked, this.drops]) o.frustumCulled = false
		this.stopMarks.count = this.pointMarks.count = 0
		this.group.add(this.posts, this.all, this.picked, this.drops, this.stopMarks, this.pointMarks)
		this.group.visible = false
	}

	/**
	 * Draws `stops` and `routes` (server coordinates) in the block whose first tile is (tileX, tileY),
	 * with `pick` highlighted. Only what differs from the last call is redrawn (#588): the Flight Paths
	 * window hands over its whole network on every pick and edit, and after a drag, which the layer
	 * has drawn already, so a pick redraws the stops or the picked route and a release nothing.
	 */
	set(stops: TaxiStopShape[], routes: TaxiRouteShape[], tileX: number, tileY: number, pick: TaxiPick, ground: GroundAt) {
		const all = tileX !== this.tileX || tileY !== this.tileY || ground !== this.ground
		const stopsChanged = all || pick.stop !== this.pick.stop || !sameStops(stops, this.stops)
		let routesChanged = all || pick.route !== this.pick.route || routes.length !== this.routes.length
		let pickedChanged = routesChanged || pick.point !== this.pick.point
		if (!routesChanged) {
			for (let i = 0; i < routes.length; i++) {
				if (sameRoute(routes[i], this.routes[i])) continue
				if (routes[i].id === pick.route && this.routes[i].id === pick.route) pickedChanged = true
				else {
					routesChanged = true
					break
				}
			}
		}
		this.stops = stops
		this.routes = routes
		this.tileX = tileX
		this.tileY = tileY
		this.pick = pick
		this.ground = ground
		if (stopsChanged) this.drawStops()
		if (routesChanged) this.drawRoutes()
		else if (pickedChanged) this.drawPicked()
	}

	/** The editor point of a server point in this block. */
	editor(p: Vec3): Vec3 {
		return editorPoint(p, this.tileX, this.tileY)
	}

	private editorPoints(r: TaxiRouteShape): Vec3[] {
		return r.points.map((p) => this.editor(p))
	}

	/** Redraws the stops (after one moved). */
	drawStops() {
		this.stopMarks = this.fit(this.stopMarks, this.stops.length)
		const posts: number[] = []
		this.stops.forEach((s, i) => {
			const p = this.editor(s)
			this.stopMarks.setMatrixAt(i, this.tmpM.makeTranslation(p.x, p.y + STOP_POST, p.z))
			this.stopMarks.setColorAt(i, s.id === this.pick.stop ? PICKED : stopColor(s))
			posts.push(p.x, p.y, p.z, p.x, p.y + STOP_POST, p.z)
		})
		this.finish(this.stopMarks, this.stops.length)
		setLines(this.posts.geometry, posts)
	}

	/** Redraws every route; the picked one's with its points. */
	drawRoutes() {
		const rest: number[] = []
		for (const r of this.routes) if (r.id !== this.pick.route) routeLines(this.editorPoints(r), PIECES, rest)
		setLines(this.all.geometry, rest, underground(rest, this.ground, ROUTE))
		this.drawPicked()
	}

	/** Redraws only the picked route (after one of its points moved). */
	drawPicked() {
		const r = this.routes.find((x) => x.id === this.pick.route)
		const pts = r ? this.editorPoints(r) : []
		const lines = routeLines(pts, PIECES)
		setLines(this.picked.geometry, lines, underground(lines, this.ground, PICKED_ROUTE))
		const drops: number[] = []
		this.pointMarks = this.fit(this.pointMarks, pts.length)
		pts.forEach((p, i) => {
			this.pointMarks.setMatrixAt(i, this.tmpM.makeTranslation(p.x, p.y, p.z))
			this.pointMarks.setColorAt(i, i === this.pick.point ? PICKED : ROUTE)
			const g = this.ground(p.x, p.z)
			if (Number.isFinite(g)) drops.push(p.x, p.y, p.z, p.x, g, p.z)
		})
		this.finish(this.pointMarks, pts.length)
		setLines(this.drops.geometry, drops)
	}

	/** The stop whose marker the ray hits, or null. */
	pickStop(raycaster: THREE.Raycaster): number | null {
		if (!this.stopMarks.count) return null
		const hit = raycaster.intersectObject(this.stopMarks, false)[0]
		return hit?.instanceId !== undefined ? (this.stops[hit.instanceId]?.id ?? null) : null
	}

	/** The picked route's point whose marker the ray hits, or -1. */
	pickPoint(raycaster: THREE.Raycaster): number {
		if (!this.pointMarks.count) return -1
		const hit = raycaster.intersectObject(this.pointMarks, false)[0]
		return hit?.instanceId ?? -1
	}

	/** The route whose drawn curve passes within `tolerance` (the tangent of the angle off the ray) of the ray, the nearest in angle, or null. */
	pickRoute(raycaster: THREE.Raycaster, tolerance = 0.012): number | null {
		const { origin, direction } = raycaster.ray
		let best = tolerance
		let found: number | null = null
		const lines: number[] = []
		const a = { x: 0, y: 0, z: 0 }
		const b = { x: 0, y: 0, z: 0 }
		for (const r of this.routes) {
			lines.length = 0
			routeLines(this.editorPoints(r), PIECES, lines)
			for (let i = 0; i < lines.length; i += 6) {
				a.x = lines[i]
				a.y = lines[i + 1]
				a.z = lines[i + 2]
				b.x = lines[i + 3]
				b.y = lines[i + 4]
				b.z = lines[i + 5]
				const d = rayNearSegment(origin, direction, a, b)
				if (d < best) {
					best = d
					found = r.id
				}
			}
		}
		return found
	}

	/** An instanced mesh with room for n, replacing `m` when it has too little. */
	private fit(m: THREE.InstancedMesh, n: number): THREE.InstancedMesh {
		if (n <= m.instanceMatrix.count) return m
		const next = new THREE.InstancedMesh(m.geometry, m.material, Math.max(16, n * 2))
		next.renderOrder = m.renderOrder
		next.frustumCulled = false
		this.group.remove(m)
		m.dispose()
		this.group.add(next)
		return next
	}

	private finish(m: THREE.InstancedMesh, n: number) {
		m.count = n
		m.instanceMatrix.needsUpdate = true
		if (m.instanceColor) m.instanceColor.needsUpdate = true
		m.computeBoundingSphere()
	}

	dispose() {
		for (const l of [this.posts, this.all, this.picked, this.drops]) {
			l.geometry.dispose()
			;(l.material as THREE.Material).dispose()
		}
		for (const m of [this.stopMarks, this.pointMarks]) {
			;(m.material as THREE.Material).dispose()
			m.dispose()
		}
		this.stopGeo.dispose()
		this.pointGeo.dispose()
	}
}

/** Whether two lists of stops draw the same: the same stops in order, at the same spots, with the same mounts. */
export function sameStops(a: readonly TaxiStopShape[], b: readonly TaxiStopShape[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		const s = a[i]
		const t = b[i]
		if (s.id !== t.id || s.x !== t.x || s.y !== t.y || s.z !== t.z || s.hordeMount !== t.hordeMount || s.allianceMount !== t.allianceMount) return false
	}
	return true
}

/** Whether two routes draw the same: the same ID and points. */
export function sameRoute(a: TaxiRouteShape, b: TaxiRouteShape): boolean {
	if (a.id !== b.id || a.points.length !== b.points.length) return false
	for (let i = 0; i < a.points.length; i++) {
		const p = a.points[i]
		const q = b.points[i]
		if (p.x !== q.x || p.y !== q.y || p.z !== q.z) return false
	}
	return true
}

function setLines(g: THREE.BufferGeometry, v: number[], colors?: number[]) {
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
	if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	g.computeBoundingSphere()
}
