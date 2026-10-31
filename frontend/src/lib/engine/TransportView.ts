import * as THREE from 'three'
import { setStatus, ui } from '../state/editor.svelte'
import type { MapDocument } from './MapDocument'
import type { CameraController } from './CameraController'
import type { CameraView } from './TaxiEditing'
import { DocOverlay } from './docOverlay'
import { TransportLayer, type TransportShape } from '../world/TransportLayer'
import { previewTime, TransportMotion } from '../world/transportRoute'
import { spawnQuaternion } from '../world/spawnTilt'
import { spawnType } from '../world/spawnInfo'
import { getAsset } from '../models/assets'
import { GhostPool } from '../tools/ghosts'
import type { vmangos } from '../wails/models'
import { Transports } from '../wails/App'

/** What TransportView needs of the Engine. */
export interface TransportHost {
	/** The active tab, whose map's transports are drawn. */
	readonly doc: MapDocument
	readonly camera: THREE.Camera
	/** The 3D view's camera, which a followed preview moves. */
	readonly persp: THREE.PerspectiveCamera
	readonly raycaster: THREE.Raycaster
	/** The pointer in normalized device coordinates. */
	readonly ndc: THREE.Vector2
	readonly controller: CameraController
	readonly timer: THREE.Timer
	/** The open map's client map ID, null while it isn't known yet. */
	openMapId(): number | null
	sceneView(): CameraView
	setSceneView(v: CameraView): void
}

/** How World › Transports hears of a click on a transport's route or dock in the viewport. */
export interface TransportHooks {
	pick(entry: number): void
}

/** How a preview sails: the playback speed (1 is the server's own) and whether the camera rides along behind. */
export interface SailOptions {
	rate: number
	follow: boolean
}

/** How far behind and above the transport a followed preview's camera rides, yards. */
const CHASE_BACK = 120
const CHASE_UP = 45

/**
 * The boats and zeppelins over the map (#954): Show › Transports' read of the transports whose route
 * touches the open map, World › Transports' picks in the viewport, and its preview, which sails the
 * transport's model along its route on this map as the server times it (transportRoute.ts), the other
 * maps' stretches skipped. Read only. Engine forwards the public names the window calls.
 */
export class TransportView {
	readonly layer = new TransportLayer()
	/** The preview's model. */
	private ghosts = new GhostPool()
	private overlay: DocOverlay<MapDocument, vmangos.Transport[]>
	private hooks: TransportHooks | null = null
	private sail: {
		doc: MapDocument
		type: string
		size: number
		motion: TransportMotion
		windows: [number, number][]
		start: number
		rate: number
		follow: boolean
		view: CameraView
		followGround: boolean
		/** The editor point of the server's origin: the server's (x, y, z) is the editor's (ox - y, z, oz - x). */
		ox: number
		oz: number
	} | null = null
	private at = { x: 0, y: 0, z: 0 }
	private q = new THREE.Quaternion()
	private spawnTurn = { orientation: 0 }
	private behind = new THREE.Vector3()
	private pos = new THREE.Vector3()

	constructor(private host: TransportHost) {
		this.ghosts.grow(1)
		this.ghosts.hideAll()
		this.ghosts.group.renderOrder = 0
		this.overlay = new DocOverlay({
			what: 'transports',
			current: () => host.doc,
			load: () => {
				const id = host.openMapId()
				return id === null ? null : Transports(id)
			},
			apply: (doc, list) => {
				this.layer.set((list ?? []) as TransportShape[], host.openMapId() ?? -1, doc.meta.region, null)
			},
			failed: (err) => setStatus(`Show › Transports: the map's boats and zeppelins could not be read: ${err instanceof Error ? err.message : err}`, 8000),
		})
	}

	/** The groups to add to the scene: the routes and the preview's model. */
	get groups(): THREE.Object3D[] {
		return [this.layer.group, this.ghosts.group]
	}

	/** A preview is sailing. */
	get sailing(): boolean {
		return this.sail !== null
	}

	/** Draws World › Transports' list (server coordinates), `picked` highlighted, and lets `hooks` take the viewport's clicks on them until endEdit. */
	show(list: TransportShape[], picked: number | null, hooks: TransportHooks) {
		this.hooks = hooks
		this.overlay.edited = true
		this.layer.set(list, this.host.openMapId() ?? -1, this.host.doc.meta.region, picked)
	}

	/** World › Transports closed: Show › Transports reads the map's again. */
	endEdit() {
		this.hooks = null
		this.overlay.edited = false
		this.overlay.reset()
		this.stopSail()
	}

	/** Shows the routes while asked for (`shown`, Show › Transports) or while the window is open, reading the open map's once per document. */
	update(shown: boolean, topDown: boolean) {
		const on = this.hooks !== null || shown
		this.layer.group.visible = on && !topDown
		this.overlay.update(on && this.hooks === null)
	}

	/** A left press while World › Transports is open: on a transport's dock or curve it picks the transport. Returns false when the press is the tool's. */
	press(): boolean {
		const h = this.host
		if (!this.hooks || !this.layer.group.visible) return false
		h.raycaster.setFromCamera(h.ndc, h.camera)
		const hit = this.layer.pickTransport(h.raycaster)
		if (hit === null) return false
		this.hooks.pick(hit)
		return true
	}

	/**
	 * Sails transport `t`'s model along its route's stretches on the open map, from the first one's
	 * start, round and round until stopSail (or Esc in the window); false when its route has none here.
	 */
	startSail(t: vmangos.Transport, o: SailOptions): boolean {
		const h = this.host
		const mapId = h.openMapId()
		this.stopSail()
		if (mapId === null) return false
		const motion = new TransportMotion(t.legs, t.speed, t.accel)
		const windows = motion.windows(mapId)
		if (!windows.length) return false
		const view = h.sceneView()
		const followGround = h.controller.followGround
		if (o.follow) h.controller.setFollowGround(false)
		const origin = this.layer.editor({ x: 0, y: 0, z: 0 })
		this.sail = {
			ox: origin.x,
			oz: origin.z,
			doc: h.doc,
			type: spawnType({ model: t.model }),
			size: t.size > 0 ? t.size : 1,
			motion,
			windows,
			start: h.timer.getElapsed(),
			rate: o.rate,
			follow: o.follow,
			view,
			followGround,
		}
		ui.transportSailing = t.entry
		return true
	}

	/** Changes a sailing preview's speed without a jump in where it is. */
	setRate(rate: number) {
		const s = this.sail
		if (!s || rate === s.rate) return
		const now = this.host.timer.getElapsed()
		const played = (now - s.start) * s.rate
		s.rate = rate
		s.start = now - played / rate
	}

	/** Ends the preview: the model goes, and a followed preview puts the camera back where it was. */
	stopSail() {
		const s = this.sail
		if (!s) return
		this.sail = null
		ui.transportSailing = null
		this.ghosts.hideAll()
		if (s.follow) {
			const h = this.host
			h.controller.setFollowGround(s.followGround)
			h.setSceneView({ ...s.view, hour: h.sceneView().hour })
		}
	}

	/** Moves the preview's model to where the transport is now, and a followed preview's camera behind it. */
	updateSail() {
		const s = this.sail
		if (!s) return
		const h = this.host
		if (h.doc !== s.doc) {
			this.stopSail()
			return
		}
		const played = (h.timer.getElapsed() - s.start) * s.rate
		const t = previewTime(s.windows, played)
		s.motion.at(t, this.at)
		const p = this.pos.set(s.ox - this.at.y, this.at.z, s.oz - this.at.x)
		const yaw = s.motion.heading(t)
		// The server turns the model to face back along the way it runs (InitialOrientation's + π).
		this.spawnTurn.orientation = yaw + Math.PI
		spawnQuaternion(this.spawnTurn, this.q)
		const mesh = s.type ? this.ghosts.show(0, getAsset(s.type)) : this.ghosts.at(0)
		mesh.visible = s.type !== ''
		mesh.position.copy(p)
		mesh.quaternion.copy(this.q)
		mesh.scale.setScalar(s.size)
		if (!s.follow) return
		// Behind along the way it runs: the server's heading is in its own axes, the editor's x is -server y and z is -server x.
		const fx = -Math.sin(yaw)
		const fz = -Math.cos(yaw)
		this.behind.set(p.x - fx * CHASE_BACK, p.y + CHASE_UP, p.z - fz * CHASE_BACK)
		h.persp.position.copy(this.behind)
		h.persp.lookAt(p.x, p.y + 10, p.z)
	}

	/** The preview's model as drawn (the probes read it). */
	get model(): THREE.Mesh {
		return this.ghosts.at(0)
	}

	dispose() {
		this.stopSail()
		this.layer.dispose()
	}
}
