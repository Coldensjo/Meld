import * as THREE from 'three'
import { setStatus, ui } from '../state/editor.svelte'
import type { MapDocument } from './MapDocument'
import type { CameraController } from './CameraController'
import { DocOverlay } from './docOverlay'
import { TaxiLayer, type TaxiHooks, type TaxiPick, type TaxiRouteShape, type TaxiStopShape } from '../world/TaxiLayer'
import { airPoint, flightAt, segmentLengths, type Vec3 } from '../world/taxiRoute'
import { serverSpot } from '../io/portCoords'
import type { vmangos } from '../../../wailsjs/go/models'
import { TaxiNetwork } from '../../../wailsjs/go/main/App'

/** The camera's view and hour, as Engine.sceneView gives it. */
export interface CameraView {
	target: [number, number, number]
	yaw: number
	pitch: number
	distance: number
	hour: number
}

/** What TaxiEditing needs of the Engine. */
export interface TaxiHost {
	/** The active tab, whose map's stops are drawn. */
	readonly doc: MapDocument
	/** The camera the view is drawn and picked with. */
	readonly camera: THREE.Camera
	/** The 3D view's camera, which a fly-along moves. */
	readonly persp: THREE.PerspectiveCamera
	readonly raycaster: THREE.Raycaster
	/** The pointer in normalized device coordinates. */
	readonly ndc: THREE.Vector2
	readonly controller: CameraController
	readonly timer: THREE.Timer
	/** The open map's client map ID, null while it isn't known yet. */
	openMapId(): number | null
	/** The ground, water or model surface under the pointer. */
	surfaceHit(): { point: THREE.Vector3 } | null
	sceneView(): CameraView
	setSceneView(v: CameraView): void
}

const NO_PICK: TaxiPick = { stop: null, route: null, point: -1 }

/**
 * The flight paths over the map (#180), out of Engine (#556): View › Flight paths' read of the open
 * map's stops and routes, and the Flight Paths window's editing in the viewport (a press on a stop or
 * a route point, its drag, a drawn point) and a route's fly-along preview. Engine forwards the public
 * names the window calls.
 */
export class TaxiEditing {
	/** The open map's flight stops and routes, drawn with View › Flight paths or while the Flight Paths window edits them. */
	readonly layer = new TaxiLayer()
	/** The client's stops and routes of the open map, read once per document. */
	private overlay: DocOverlay<MapDocument, vmangos.TaxiNetwork>
	/** The Flight Paths window's hooks while it draws its own (edited) stops and routes. */
	private hooks: TaxiHooks | null = null
	/** A press on a stop or a route point that may become a drag: what, and (for a point) the plane it moves on and the press's offset from it. */
	private drag: { kind: 'stop'; id: number; moved: boolean } | { kind: 'point'; route: number; index: number; height: boolean; plane: THREE.Plane; offset: THREE.Vector3; moved: boolean } | null = null
	/** A route's fly-along preview: its curve (editor points), segment lengths, start time, and the view and ground following to go back to. */
	private flight: { pts: Vec3[]; lengths: number[]; start: number; view: CameraView; follow: boolean } | null = null
	private at = { x: 0, y: 0, z: 0 }
	private ahead = { x: 0, y: 0, z: 0 }
	private behind = { x: 0, y: 0, z: 0 }
	private dragPoint = new THREE.Vector3()

	/** The ground's height under an editor point of the open map, NaN off it (or in a building-only map). */
	private readonly ground = (x: number, z: number) => {
		const d = this.host.doc
		return !d.meta.region?.wmoOnly && d.terrain.contains(x, z) ? d.terrain.heightAt(x, z) : NaN
	}

	constructor(private host: TaxiHost) {
		this.overlay = new DocOverlay({
			what: 'flight paths',
			current: () => host.doc,
			load: () => {
				const id = host.openMapId()
				return id === null ? null : TaxiNetwork(id)
			},
			apply: (doc, n) => {
				const reg = doc.meta.region
				this.layer.set(n?.nodes ?? [], n?.routes ?? [], reg?.x ?? 0, reg?.y ?? 0, NO_PICK, this.ground)
			},
			failed: (err) => setStatus(`View › Flight paths: the map's flight paths could not be read: ${err instanceof Error ? err.message : err}`, 8000),
		})
	}

	/** A press is being dragged (a stop or a route point). */
	get dragging(): boolean {
		return this.drag !== null
	}

	/** A fly-along preview is moving the camera. */
	get flying(): boolean {
		return this.flight !== null
	}

	/** Draws the Flight Paths window's stops and routes (server coordinates), `pick` highlighted, and lets `hooks` take its clicks until endEdit. */
	show(stops: TaxiStopShape[], routes: TaxiRouteShape[], pick: TaxiPick, hooks: TaxiHooks) {
		this.hooks = hooks
		this.overlay.edited = true
		const r = this.host.doc.meta.region
		this.layer.set(stops, routes, r?.x ?? 0, r?.y ?? 0, pick, this.ground)
	}

	/** The Flight Paths window closed: View › Flight paths reads the map's stops again (they may have been saved). */
	endEdit() {
		this.hooks = null
		this.drag = null
		this.overlay.edited = false
		this.overlay.reset()
		this.stopFlight()
	}

	/** Shows the stops and routes while asked for (`shown`, View › Flight paths) or edited, reading the open map's once per document. */
	update(shown: boolean, topDown: boolean) {
		const on = this.hooks !== null || shown
		this.layer.group.visible = on && !topDown
		this.overlay.update(on)
	}

	/** An editor point in the server's coordinates of the block the stops are drawn in. */
	private server(p: Vec3): Vec3 {
		const L = this.layer
		const s = serverSpot(p, 0, L.tileX, L.tileY)
		return { x: s.x, y: s.y, z: s.z }
	}

	/**
	 * A left press while the Flight Paths window is open: on a point of the picked route it picks the
	 * point and may drag it (level, or with Shift up and down); on a stop it picks the stop and may drag
	 * it over the ground; elsewhere, while the window draws, it adds a point after the picked one, at
	 * that one's height (`airPoint`), and may drag it. Returns false when the press is the tool's.
	 */
	press(e: PointerEvent): boolean {
		const hooks = this.hooks
		const L = this.layer
		const h = this.host
		if (!hooks || !L.group.visible) return false
		h.raycaster.setFromCamera(h.ndc, h.camera)
		const route = L.routes.find((r) => r.id === L.pick.route)
		const index = route ? L.pickPoint(h.raycaster) : -1
		if (route && index >= 0) {
			L.pick = { ...L.pick, point: index }
			L.drawPicked()
			hooks.pick(L.pick)
			this.startPointDrag(route.id, index, e.shiftKey)
			return true
		}
		const stop = L.pickStop(h.raycaster)
		if (stop !== null) {
			L.pick = { ...L.pick, stop, point: -1 }
			L.drawStops()
			L.drawPicked()
			hooks.pick(L.pick)
			this.drag = { kind: 'stop', id: stop, moved: false }
			return true
		}
		if (!hooks.drawing()) {
			const hit = L.pickRoute(h.raycaster)
			if (hit !== null) {
				if (hit !== L.pick.route) {
					L.pick = { ...L.pick, route: hit, point: -1 }
					L.drawRoutes()
					hooks.pick(L.pick)
				}
				return true
			}
		}
		if (!route || !hooks.drawing() || !route.points.length) return false
		const after = L.pick.point >= 0 && L.pick.point < route.points.length ? L.pick.point : route.points.length - 1
		const height = L.editor(route.points[after]).y
		const ground = h.surfaceHit()?.point ?? null
		h.raycaster.setFromCamera(h.ndc, h.camera)
		const at = airPoint(h.raycaster.ray.origin, h.raycaster.ray.direction, height, ground)
		if (!at) return true
		const s = this.server(at)
		route.points.splice(after + 1, 0, { ...route.points[after], x: s.x, y: s.y, z: s.z })
		L.pick = { ...L.pick, point: after + 1 }
		L.drawPicked()
		hooks.added(route.id, after + 1, s)
		this.startPointDrag(route.id, after + 1, false)
		return true
	}

	/** Starts dragging point `index` of route `route`: on its level plane, or with `height` up and down on an upright one facing the camera. */
	private startPointDrag(route: number, index: number, height: boolean) {
		const h = this.host
		const r = this.layer.routes.find((x) => x.id === route)
		if (!r) return
		const p = this.layer.editor(r.points[index])
		const at = new THREE.Vector3(p.x, p.y, p.z)
		const plane = new THREE.Plane()
		if (height) {
			const n = h.camera.getWorldDirection(new THREE.Vector3()).setY(0)
			if (n.lengthSq() < 1e-6) n.set(0, 0, 1)
			plane.setFromNormalAndCoplanarPoint(n.normalize(), at)
		} else plane.set(new THREE.Vector3(0, 1, 0), -p.y)
		h.raycaster.setFromCamera(h.ndc, h.camera)
		const hit = new THREE.Vector3()
		const offset = h.raycaster.ray.intersectPlane(plane, hit) ? at.sub(hit) : new THREE.Vector3()
		this.drag = { kind: 'point', route, index, height, plane, offset, moved: false }
	}

	/** Moves what the press took to under the cursor: the layer's copy, which the window hears of on release. */
	moveDrag() {
		const d = this.drag
		const L = this.layer
		const h = this.host
		if (!d) return
		if (d.kind === 'stop') {
			const s = L.stops.find((x) => x.id === d.id)
			const hit = h.surfaceHit()
			if (!s || !hit) return
			Object.assign(s, this.server(hit.point))
			d.moved = true
			L.drawStops()
			return
		}
		const p = L.routes.find((x) => x.id === d.route)?.points[d.index]
		h.raycaster.setFromCamera(h.ndc, h.camera)
		if (!p || !h.raycaster.ray.intersectPlane(d.plane, this.dragPoint)) return
		const e = L.editor(p)
		const to = this.dragPoint.add(d.offset)
		Object.assign(p, this.server(d.height ? { x: e.x, y: to.y, z: e.z } : { x: to.x, y: e.y, z: to.z }))
		d.moved = true
		L.drawPicked()
	}

	/** A drag ended: the window takes where the stop or point went, as one edit. */
	endDrag() {
		const d = this.drag
		this.drag = null
		const L = this.layer
		if (!d?.moved || !this.hooks) return
		if (d.kind === 'stop') {
			const s = L.stops.find((x) => x.id === d.id)
			if (s) this.hooks.moved('stop', d.id, -1, { x: s.x, y: s.y, z: s.z })
			return
		}
		const p = L.routes.find((x) => x.id === d.route)?.points[d.index]
		if (p) this.hooks.moved('point', d.route, d.index, { x: p.x, y: p.y, z: p.z })
	}

	/** Flies the camera along a route's points (server coordinates) at a flight's speed, then puts the view back; Esc or stopFlight ends it early. */
	fly(points: readonly Vec3[]) {
		const h = this.host
		const pts = points.map((p) => this.layer.editor(p))
		if (pts.length < 2) return
		this.stopFlight()
		const follow = h.controller.followGround
		h.controller.setFollowGround(false)
		this.flight = { pts, lengths: segmentLengths(pts), start: h.timer.getElapsed(), view: h.sceneView(), follow }
		ui.taxiFlying = true
	}

	/** Ends a fly-along preview and puts the camera back where it was, at the hour it is now. */
	stopFlight() {
		const f = this.flight
		if (!f) return
		this.flight = null
		ui.taxiFlying = false
		const h = this.host
		h.controller.setFollowGround(f.follow)
		h.setSceneView({ ...f.view, hour: h.sceneView().hour })
	}

	/** A chase view of the flight: from the rider's point a moment ago, 3 yd up, towards where it will be. */
	updateFlight() {
		const f = this.flight
		if (!f) return
		const h = this.host
		const t = h.timer.getElapsed() - f.start
		const flying = flightAt(f.pts, f.lengths, t, this.at)
		flightAt(f.pts, f.lengths, t + 0.8, this.ahead)
		flightAt(f.pts, f.lengths, Math.max(0, t - 0.35), this.behind)
		h.persp.position.set(this.behind.x, this.behind.y + 3, this.behind.z)
		h.persp.lookAt(this.ahead.x, this.ahead.y + 1.5, this.ahead.z)
		if (!flying) this.stopFlight()
	}

	dispose() {
		this.layer.dispose()
	}
}
