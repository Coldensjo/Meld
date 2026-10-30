import * as THREE from 'three'
import { getAsset, type ModelAsset } from '../models/assets'
import { baseType } from '../models/wmoSet'
import { fetchWmoNav } from '../wow/api'
import { LoadCache } from '../wow/loadCache'
import type { ObjectLayer, WorldObject } from './ObjectLayer'
import { EXTERIOR_LIT } from './wmoFlood'
import { selectWmoFog, type FogTarget } from './wmoFog'
import { collideSphere, decodeWmoNav, downRayPick, EXTERIOR, nearestFaceDist, toModel, walkFloorZ, type RoomSeeds, type WmoNav } from './wmoRoom'

/** The WMO room the camera is in. */
export interface CameraRoom {
	/** The placed WMO's object id and client path. */
	id: number
	path: string
	/** The layer it is placed in: the map's own, or the world streamed around a region (#897). */
	layer: RoomLayer
	nav: WmoNav
	group: number
	/** The group across the portal the probe crossed, or null. */
	across: number | null
	/** The eye in the WMO's model space (WoW axes). */
	eye: [number, number, number]
	/** The probe's verdict, the portal flood's seeds. */
	seeds: RoomSeeds
	/** The placement's world matrix and origin, as the probe saw them. */
	matrix: THREE.Matrix4
	origin: THREE.Vector3
	/** The room's fog, or null where the WMO keeps the scene's. */
	fog: FogTarget | null
}

/**
 * What `WmoRooms` reads of the object layer: the placed objects, the hidden set and the layer's own
 * visibility (View › Layers), the change counters and each object's world matrix. `ObjectLayer` is
 * one; the unit tests pass a fake (tests/wmoRooms.test.ts).
 */
export type RoomLayer = Pick<ObjectLayer, 'group' | 'objects' | 'shapeVersion' | 'moveSeq' | 'movedSince' | 'isHidden' | 'matrixOf'>

/** The camera has to move this far (yd) before the probe runs again. */
const MOVE_EPS = 0.01
/** How far (yd) from the camera a building is flooded from outside. */
const OUTSIDE_RANGE = 400
/**
 * How far (yd) from the eye a WMO's faces are looked for (`wallDist`): beyond the near plane's reach
 * (0.5 yd straight ahead, about 0.8 yd to a corner of a wide view), with room to spare.
 */
export const WALL_REACH = 2

/** A placed WMO with portals in view that the camera is not in, flooded from outside. */
export interface OutsideWmo {
	id: number
	nav: WmoNav
	/** The placement's world matrix and origin. */
	matrix: THREE.Matrix4
	origin: THREE.Vector3
	/** Its distance from the camera, nearest first. */
	dist: number
}

/**
 * A placed WMO as `WmoRooms` keeps it (#523): its world matrix, inverse and largest scale, and its
 * world box, so the per-frame scans invert no matrix. Kept with the WMO list, recomputed for a moved one.
 */
interface PlacedWmo {
	id: number
	/** The client path, for `nav`. */
	path: string
	/** The model, or the placeholder while it loads: its `ready` and `bbox` are read at use. */
	asset: ModelAsset
	matrix: THREE.Matrix4
	inverse: THREE.Matrix4
	scale: number
	/** The model's box in the world, or empty while it loads. */
	box: THREE.Box3
	/** The camera is over it rather than in it, as of the last probe (`WmoRooms.over`). */
	over: boolean
}

/**
 * One object layer's placed WMOs as of `sync`: the map's own, or the world streamed around a region
 * (#897), whose ids are a count of their own. Entries are reused through `placedPool`.
 */
interface RoomPart {
	layer: RoomLayer | null
	/** The placed WMOs that are not hidden. */
	placed: PlacedWmo[]
	byId: Map<number, PlacedWmo>
	version: number
	moves: number
}

type LivePart = RoomPart & { layer: RoomLayer }

const newPart = (): RoomPart => ({ layer: null, placed: [], byId: new Map(), version: -1, moves: 0 })
/** Whether a part's WMOs count: it has a layer, and the layer is shown (View › Layers). */
const live = (p: RoomPart): p is LivePart => !!p.layer && p.layer.group.visible

/**
 * Tracks which room of which placed WMO the camera is in (`wmoRoom.ts`'s probe), loading each WMO's
 * room data from the client the first time the camera enters its box. The probe reruns only when
 * the camera moves or the objects change.
 */
export class WmoRooms {
	current: CameraRoom | null = null
	/**
	 * The placed WMOs the camera is over rather than in (#300): the eye is above the building's
	 * footprint but in none of its rooms, either because the down-ray found none or because the eye
	 * is above the top of the room it found. The client's camera stays near the player, inside a room
	 * or beside the building; Meld's flying camera goes over it, where the client's flood (from a
	 * room far below, or from outside through the exterior groups, which in Stormwind are one shell
	 * around streets that are lit interiors) left holes to the sky. They are drawn whole, left out of
	 * `outside` as a WMO-only building is. Their ids, of either layer, for the readouts; `outside`
	 * reads each WMO's own flag.
	 */
	readonly over: number[] = []
	/**
	 * The distance (yd) from the eye to the nearest collision face of any placed WMO, or Infinity when
	 * none lies within WALL_REACH. The Engine pulls the near plane in by it (#304), so a wall the flying
	 * camera is closer to than 0.5 yd is not clipped away to show the sky or the street behind it.
	 */
	wallDist = Infinity
	/**
	 * Each WMO's room data by lower-case path, read the first time the camera comes near it. A failure is
	 * warned and retried (#515); the Engine sets `onFail` to say so in the status bar.
	 */
	readonly navs: LoadCache<WmoNav>
	/** The map's own WMOs, then those of the world around a region (#897), as of the last `update`. */
	private parts: [RoomPart, RoomPart] = [newPart(), newPart()]
	private placedPool: PlacedWmo[] = []
	/** Set by `sync` when a list was rebuilt or a WMO moved, so `update` runs the probe again. */
	private placedChanged = false
	/** Which of the parts' layers were shown at the last `update`, a bit each. */
	private shown = 0
	/** The part `current` is placed in. */
	private currentPart: RoomPart | null = null
	private lastEye = new THREE.Vector3(NaN, NaN, NaN)
	private seenLoaded = -1
	private local = new THREE.Vector3()
	private eyeModel: [number, number, number] = [0, 0, 0]
	private groundModel: [number, number, number] = [0, 0, 0]
	private pool: OutsideWmo[] = []
	private found: OutsideWmo[] = []
	private fromModel: [number, number, number] = [0, 0, 0]
	private toModelPt: [number, number, number] = [0, 0, 0]
	private fromLocal = new THREE.Vector3()

	/**
	 * `assetOf` gives a placed WMO's model (or the placeholder while it loads), `loadNav` reads its room
	 * data from the client; the tests hand in their own.
	 */
	constructor(
		private assetOf: (type: string) => ModelAsset = getAsset,
		loadNav: (path: string) => Promise<WmoNav> = async (path) => decodeWmoNav(await fetchWmoNav(path)),
	) {
		this.navs = new LoadCache<WmoNav>('WMO room data', loadNav)
	}

	/**
	 * The nearest `max` placed WMOs with a portal graph that meet `frustum` within OUTSIDE_RANGE of
	 * `eye`, other than the one the camera is in; one whose room data is still loading is left out
	 * (and starts loading). `whole`, a WMO-only map's building (#271), is left out too, so it is drawn
	 * whole from outside: a dungeon's groups are all interior, and with no exterior to flood from it
	 * would not show at all; so are the WMOs the camera is `over`. The list and its entries are reused
	 * by the next call.
	 */
	outside(objects: RoomLayer, frustum: THREE.Frustum, eye: THREE.Vector3, max: number, whole: number | null = null): readonly OutsideWmo[] {
		const found = this.found
		found.length = 0
		if (objects !== this.parts[0].layer) return found
		// A hidden Objects layer (View › Layers) gates nothing.
		for (const p of this.parts) if (live(p)) this.outsideOf(p, frustum, eye, whole)
		found.sort((a, b) => a.dist - b.dist)
		if (found.length > max) found.length = max
		return found
	}

	/** Adds part `p`'s WMOs to `outside`'s list; `whole` is only ever one of the map's own. */
	private outsideOf(p: LivePart, frustum: THREE.Frustum, eye: THREE.Vector3, whole: number | null) {
		const found = this.found
		this.sync(p)
		const own = p === this.parts[0]
		for (const w of p.placed) {
			const id = w.id
			if ((p === this.currentPart && id === this.current?.id) || (own && id === whole) || !w.asset.ready || w.over) continue
			const dist = w.box.distanceToPoint(eye)
			if (dist > OUTSIDE_RANGE || !frustum.intersectsBox(w.box)) continue
			const nav = this.nav(w.path)
			if (!nav || !nav.portals.length) continue
			let e = this.pool[found.length]
			if (!e) {
				e = { id: 0, nav, matrix: new THREE.Matrix4(), origin: new THREE.Vector3(), dist: 0 }
				this.pool.push(e)
			}
			e.id = id
			e.nav = nav
			e.matrix.copy(w.matrix)
			e.origin.setFromMatrixPosition(w.matrix)
			e.dist = dist
			found.push(e)
		}
	}

	/**
	 * Runs the probe for an eye at `eye` (world space), finding `current` and `over`. `groundAt`
	 * gives the terrain's height under a point, or null where there is none (off the map, or a hole).
	 * While the Objects layer is hidden (View › Layers) the camera is in no room, so a building the
	 * author can't see never gates the view. `around` is the world streamed around a region (#897): its
	 * buildings have rooms, walls and floors as the map's own do, and are shown and hidden with them.
	 */
	update(objects: RoomLayer, eye: THREE.Vector3, groundAt: (x: number, z: number) => number | null, around: RoomLayer | null = null) {
		this.bind(this.parts[0], objects)
		this.bind(this.parts[1], around)
		const shown = (live(this.parts[0]) ? 1 : 0) | (live(this.parts[1]) ? 2 : 0)
		if (shown !== this.shown) {
			this.shown = shown
			this.placedChanged = true
		}
		if (!shown) {
			this.current = null
			this.currentPart = null
			this.over.length = 0
			this.wallDist = Infinity
			this.lastEye.set(NaN, NaN, NaN) // look again once the layer is shown
			return
		}
		for (const p of this.parts) if (live(p)) this.sync(p)
		if (!this.placedChanged && eye.distanceToSquared(this.lastEye) < MOVE_EPS * MOVE_EPS && this.navs.settled === this.seenLoaded) return
		this.placedChanged = false
		this.lastEye.copy(eye)
		this.seenLoaded = this.navs.settled
		this.current = null
		this.currentPart = null
		this.over.length = 0
		this.wallDist = Infinity
		const ground = groundAt(eye.x, eye.z)
		for (const p of this.parts) if (live(p)) this.probe(p, eye, ground)
	}

	/** Runs `update`'s probe over part `p`'s WMOs, for an eye at `eye` over ground at `ground` (or none). */
	private probe(p: LivePart, eye: THREE.Vector3, ground: number | null) {
		for (const w of p.placed) {
			const id = w.id
			w.over = false
			if (!w.asset.ready) {
				this.lastEye.set(NaN, NaN, NaN) // look again once it has loaded
				continue
			}
			this.local.copy(eye).applyMatrix4(w.inverse)
			const b = w.asset.bbox
			const l = this.local
			const path = w.path
			// Within WALL_REACH of the building's box: how near its walls the eye is.
			const scale = w.scale
			const r = WALL_REACH / scale
			if (l.x >= b.min.x - r && l.x <= b.max.x + r && l.y >= b.min.y - r && l.y <= b.max.y + r && l.z >= b.min.z - r && l.z <= b.max.z + r) {
				const nav = this.nav(path)
				if (nav) {
					const [ex, ey, ez] = toModel(l, this.eyeModel)
					this.wallDist = Math.min(this.wallDist, nearestFaceDist(nav, ex, ey, ez, r) * scale)
				}
			}
			// Over the footprint, not below the building (the editor's local frame is Y up).
			if (l.x < b.min.x || l.x > b.max.x || l.z < b.min.z || l.z > b.max.z || l.y < b.min.y) continue
			const nav = this.nav(path)
			if (!nav) continue
			if (this.current || l.y > b.max.y) {
				w.over = true
				this.over.push(id)
				continue
			}
			toModel(this.local, this.eyeModel)
			let groundZ: number | null = null
			if (ground !== null) {
				this.local.set(eye.x, ground, eye.z).applyMatrix4(w.inverse)
				groundZ = toModel(this.local, this.groundModel)[2]
			}
			const [ex, ey, ez] = this.eyeModel
			const seeds = downRayPick(nav, ex, ey, ez, groundZ)
			if (seeds.inGroup === null || ez > nav.groups[seeds.inGroup].max[2]) {
				w.over = true
				this.over.push(id)
				continue
			}
			// The fog comes from the first of the camera's groups that is a true interior (no 0x48).
			let fog: FogTarget | null = null
			for (const g of [seeds.inGroup, seeds.across]) {
				if (g === null || nav.groups[g].flags & (EXTERIOR | EXTERIOR_LIT)) continue
				fog = selectWmoFog(nav.fogs, nav.groups[g].fogs, this.eyeModel)
				break
			}
			const matrix = w.matrix.clone()
			this.currentPart = p
			this.current = {
				id,
				path,
				layer: p.layer,
				nav,
				group: seeds.inGroup,
				across: seeds.across,
				eye: [ex, ey, ez],
				seeds,
				matrix,
				origin: new THREE.Vector3().setFromMatrixPosition(matrix),
				fog,
			}
		}
	}

	/**
	 * Camera collision with the placed WMOs (#305): moves `to`, where the flying camera's eye is going
	 * from `from` (world space), so that it stops `radius` yd off every WMO's collision faces and slides
	 * along them (`wmoRoom.ts` `collideSphere`), as the client's camera never stands in a wall. A WMO
	 * still loading, hidden, or on a hidden Objects layer doesn't stop it. Uses the WMO list of the last
	 * `update`, for the same layer.
	 */
	collide(objects: RoomLayer, from: THREE.Vector3, to: THREE.Vector3, radius: number) {
		if (objects !== this.parts[0].layer) return
		for (const p of this.parts) if (live(p)) this.collideWith(p, from, to, radius)
	}

	/** `collide` against part `p`'s WMOs. */
	private collideWith(p: LivePart, from: THREE.Vector3, to: THREE.Vector3, radius: number) {
		this.sync(p)
		for (const w of p.placed) {
			if (!w.asset.ready) continue
			const r = radius / w.scale
			const a = this.fromLocal.copy(from).applyMatrix4(w.inverse)
			const b = this.local.copy(to).applyMatrix4(w.inverse)
			const bb = w.asset.bbox
			if (Math.max(a.x, b.x) < bb.min.x - r || Math.min(a.x, b.x) > bb.max.x + r) continue
			if (Math.max(a.y, b.y) < bb.min.y - r || Math.min(a.y, b.y) > bb.max.y + r) continue
			if (Math.max(a.z, b.z) < bb.min.z - r || Math.min(a.z, b.z) > bb.max.z + r) continue
			const nav = this.nav(w.path)
			if (!nav) continue
			const end = toModel(b, this.toModelPt)
			if (!collideSphere(nav, toModel(a, this.fromModel), end, r)) continue
			// Back from WoW axes to the local frame, then to the world.
			to.set(end[0], end[2], -end[1]).applyMatrix4(w.matrix)
		}
	}

	/**
	 * The world height of the highest WMO floor (a walking face) at or below `eye`, or -Infinity where
	 * no placed WMO has one (#310). Camera collision keeps the flying camera above it as it does above
	 * the terrain, since under a city the terrain lies below the streets. A WMO still loading, hidden,
	 * or on a hidden Objects layer has no floor. Uses the WMO list of the last `update`, for the same layer.
	 */
	floorAt(objects: RoomLayer, eye: THREE.Vector3): number {
		let best = -Infinity
		if (objects !== this.parts[0].layer) return best
		for (const p of this.parts) if (live(p)) best = Math.max(best, this.floorIn(p, eye))
		return best
	}

	/** `floorAt` among part `p`'s WMOs. */
	private floorIn(p: LivePart, eye: THREE.Vector3): number {
		let best = -Infinity
		this.sync(p)
		for (const w of p.placed) {
			if (!w.asset.ready) continue
			const l = this.local.copy(eye).applyMatrix4(w.inverse)
			const bb = w.asset.bbox
			if (l.x < bb.min.x || l.x > bb.max.x || l.z < bb.min.z || l.z > bb.max.z || l.y < bb.min.y) continue
			const nav = this.nav(w.path)
			if (!nav) continue
			const [ex, ey, ez] = toModel(l, this.eyeModel)
			const z = walkFloorZ(nav, ex, ey, ez)
			if (z === -Infinity) continue
			const y = l.set(ex, z, -ey).applyMatrix4(w.matrix).y
			if (y > best) best = y
		}
		return best
	}

	/**
	 * Brings the WMO list up to `objects` (the layer of the last `update`): rebuilt when what is placed
	 * changed (`shapeVersion`: added, removed, hidden, a model loaded), and only the moved WMOs'
	 * matrices recomputed when objects moved (#511's move log; attached ones are logged with their
	 * parent), since a drag or a sculpt stroke moves objects every frame. Either sets `placedChanged`.
	 */
	private sync(p: LivePart) {
		const objects = p.layer
		if (objects.shapeVersion === p.version) {
			if (objects.moveSeq === p.moves) return
			const moved = objects.movedSince(p.moves)
			if (moved) {
				p.moves = objects.moveSeq
				for (const id of moved) {
					const w = p.byId.get(id)
					const o = w && objects.objects.get(id)
					if (!w || !o) continue
					this.placeOf(objects, o, w)
					this.placedChanged = true
				}
				return
			}
		}
		p.version = objects.shapeVersion
		p.moves = objects.moveSeq
		this.release(p)
		for (const o of objects.objects.values()) {
			if (!o.type.startsWith('wmo:') || objects.isHidden(o.id)) continue
			const asset = this.assetOf(o.type)
			const w = this.placedPool.pop() ?? { id: 0, path: '', asset, matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), scale: 1, box: new THREE.Box3(), over: false }
			w.id = o.id
			w.path = baseType(o.type).slice('wmo:'.length)
			w.asset = asset
			w.over = false
			this.placeOf(objects, o, w)
			p.placed.push(w)
			p.byId.set(o.id, w)
		}
		this.placedChanged = true
	}

	/** Points part `p` at `layer` (null for none): another layer's WMOs are listed anew at the next `sync`. */
	private bind(p: RoomPart, layer: RoomLayer | null) {
		if (p.layer === layer) return
		p.layer = layer
		p.version = -1
		this.release(p)
		this.placedChanged = true
	}

	/** Gives part `p`'s entries back to the pool. */
	private release(p: RoomPart) {
		for (const w of p.placed) this.placedPool.push(w)
		p.placed.length = 0
		p.byId.clear()
	}

	/** Sets a placed WMO's matrix, inverse, scale and world box from where `o` is now. */
	private placeOf(objects: RoomLayer, o: WorldObject, w: PlacedWmo) {
		objects.matrixOf(o, w.matrix)
		w.inverse.copy(w.matrix).invert()
		w.scale = w.matrix.getMaxScaleOnAxis()
		if (w.asset.ready) w.box.copy(w.asset.bbox).applyMatrix4(w.matrix)
		else w.box.makeEmpty()
	}

	/** Forgets the room data of the WMOs at `paths` (#505: the buildings of a closed map nothing else places). */
	forget(paths: Iterable<string>) {
		for (const p of paths) this.navs.forget(p.toLowerCase())
	}

	/**
	 * The room data of a WMO, or null while it loads or after it failed (#515: a server error or a
	 * body `decodeWmoNav` rejects is warned, counted in `failed` and retried after RETRY_MS).
	 */
	private nav(path: string): WmoNav | null {
		return this.navs.get(path.toLowerCase(), path)
	}
}
