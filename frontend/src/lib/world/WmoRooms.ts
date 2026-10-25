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
}

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
	 * `outside` as a WMO-only building is.
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
	/** The placed WMOs that are not hidden, as of `sync`; entries are reused through `placedPool`. */
	private placed: PlacedWmo[] = []
	private placedPool: PlacedWmo[] = []
	private placedById = new Map<number, PlacedWmo>()
	/** Set by `sync` when the list was rebuilt or a WMO moved, so `update` runs the probe again. */
	private placedChanged = false
	private layer: RoomLayer | null = null
	private objectsVersion = -1
	private objectsMoves = 0
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
		// A hidden Objects layer (View › Layers) gates nothing.
		if (objects !== this.layer || !objects.group.visible) return found
		this.sync(objects)
		for (const w of this.placed) {
			const id = w.id
			if (id === this.current?.id || id === whole || !w.asset.ready || this.over.includes(id)) continue
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
		found.sort((a, b) => a.dist - b.dist)
		if (found.length > max) found.length = max
		return found
	}

	/**
	 * Runs the probe for an eye at `eye` (world space), finding `current` and `over`. `groundAt`
	 * gives the terrain's height under a point, or null where there is none (off the map, or a hole).
	 * While the Objects layer is hidden (View › Layers) the camera is in no room, so a building the
	 * author can't see never gates the view.
	 */
	update(objects: RoomLayer, eye: THREE.Vector3, groundAt: (x: number, z: number) => number | null) {
		if (!objects.group.visible) {
			this.current = null
			this.over.length = 0
			this.wallDist = Infinity
			this.lastEye.set(NaN, NaN, NaN) // look again once the layer is shown
			return
		}
		if (objects !== this.layer) {
			this.layer = objects
			this.objectsVersion = -1
		}
		this.sync(objects)
		if (!this.placedChanged && eye.distanceToSquared(this.lastEye) < MOVE_EPS * MOVE_EPS && this.navs.settled === this.seenLoaded) return
		this.placedChanged = false
		this.lastEye.copy(eye)
		this.seenLoaded = this.navs.settled
		this.current = null
		this.over.length = 0
		this.wallDist = Infinity
		const ground = groundAt(eye.x, eye.z)
		for (const w of this.placed) {
			const id = w.id
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
			this.current = {
				id,
				path,
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
		if (objects !== this.layer || !objects.group.visible) return
		this.sync(objects)
		for (const w of this.placed) {
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
		if (objects !== this.layer || !objects.group.visible) return best
		this.sync(objects)
		for (const w of this.placed) {
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
	private sync(objects: RoomLayer) {
		if (objects.shapeVersion === this.objectsVersion) {
			if (objects.moveSeq === this.objectsMoves) return
			const moved = objects.movedSince(this.objectsMoves)
			if (moved) {
				this.objectsMoves = objects.moveSeq
				for (const id of moved) {
					const w = this.placedById.get(id)
					const o = w && objects.objects.get(id)
					if (!w || !o) continue
					this.placeOf(objects, o, w)
					this.placedChanged = true
				}
				return
			}
		}
		this.objectsVersion = objects.shapeVersion
		this.objectsMoves = objects.moveSeq
		for (const w of this.placed) this.placedPool.push(w)
		this.placed.length = 0
		this.placedById.clear()
		for (const o of objects.objects.values()) {
			if (!o.type.startsWith('wmo:') || objects.isHidden(o.id)) continue
			const asset = this.assetOf(o.type)
			const w = this.placedPool.pop() ?? { id: 0, path: '', asset, matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), scale: 1, box: new THREE.Box3() }
			w.id = o.id
			w.path = baseType(o.type).slice('wmo:'.length)
			w.asset = asset
			this.placeOf(objects, o, w)
			this.placed.push(w)
			this.placedById.set(o.id, w)
		}
		this.placedChanged = true
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
