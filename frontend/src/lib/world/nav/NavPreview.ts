// View › Walkable ground (#175): the server's navmesh as VMaNGOS would build it, drawn over the
// ground around the camera, and a path test between two clicked points. Tiles (navBuild.ts) are
// built nearest first within RANGE of the camera's target, a few each frame within BUDGET_MS, and
// built again QUIET_MS after the ground or the models stop changing. Nothing runs while the view is
// off: the Engine calls `update` only while it is on, and `clear` frees the WASM side when it goes off.
// In server mode (#240, navServer.ts) the tiles are instead the server's own, one a client tile, read
// from its movement maps, and nothing is built.

import * as THREE from 'three'
import type * as RecastModule from 'recast-navigation'
import type { NavMesh, NavMeshQuery, Vector3 } from 'recast-navigation'
import { fetchCollision, fetchNavTile } from '../../wow/api'
import { isHelper } from '../../models/helpers'
import type { ObjectLayer } from '../ObjectLayer'
import type { Terrain } from '../../terrain/Terrain'
import type { LiquidMap } from '../../water/liquids'
import {
	AREA_MAGMA,
	AREA_SLIME,
	AREA_STEEP,
	AREA_WATER,
	AREA_WATER_TRANSITION,
	NAV_GROUND,
	NAV_MAGMA,
	NAV_SLIME,
	NAV_WATER,
	TileBuilder,
	loadRecast,
	vmangosSettings,
	type NavSettings,
	type Recast,
} from './navBuild'
import { TileGatherer, placeFaces, type PlacedCollision } from './navGeometry'
import { NavLiquids } from './navLiquids'
import { ADT_YARDS, detourSurface, navPoint, parseNavTile } from './navServer'

/** How far around the camera's target tiles are built (yd), and how far they are kept. */
export const RANGE = 160
const KEEP = 320
/** Models further than this from the target bring no faces (a big WMO's origin can sit far from its walls). */
const MODEL_REACH = KEEP + 400
/** Time a frame may spend building tiles (ms). */
const BUDGET_MS = 6
/** How long the ground and the models must stay unchanged before the tiles are built again (ms). */
const QUIET_MS = 400
/** The drawn surface's lift over the ground (yd), against z-fighting. */
const LIFT = 0.08
/** How far from a clicked point the path test looks for the navmesh (yd). */
const PICK_EXTENTS = { x: 2, y: 6, z: 2 }
/** Tiles the navmesh holds at once (Detour's tile bits) and polygons a tile may hold. */
const MAX_TILES = 1024
const MAX_POLYS = 4096
/**
 * The same for the server's tiles, one a client tile: the largest of map 0's has 26,526 polygons. 64
 * tiles and 32,768 polygons leave Detour's 32-bit refs the 11 salt bits it needs (10 at least).
 */
const SERVER_MAX_TILES = 64
const SERVER_MAX_POLYS = 32768

const GROUND_COLOR = new THREE.Color(0.15, 0.85, 0.35)
const STEEP_COLOR = new THREE.Color(1, 0.55, 0.1)
const SHALLOW_COLOR = new THREE.Color(0.2, 0.85, 0.85)
const WATER_COLOR = new THREE.Color(0.2, 0.45, 1)
const MAGMA_COLOR = new THREE.Color(0.95, 0.15, 0.1)
const SLIME_COLOR = new THREE.Color(0.75, 0.9, 0.1)

function areaColor(area: number): THREE.Color {
	switch (area) {
		case AREA_STEEP:
			return STEEP_COLOR
		case AREA_WATER_TRANSITION:
			return SHALLOW_COLOR
		case AREA_WATER:
			return WATER_COLOR
		case AREA_MAGMA:
			return MAGMA_COLOR
		case AREA_SLIME:
			return SLIME_COLOR
		default:
			return GROUND_COLOR
	}
}

interface NavTile {
	tx: number
	tz: number
	mesh: THREE.Mesh | null
	/** The build generation the tile was last built for; -1 for never. */
	stamp: number
	/** Its tile in the navmesh, 0 for none. */
	ref: number
}

/** One of the server's tiles (#240), a client tile, `ax` its column and `ay` its row on the map. */
interface ServerNavTile {
	ax: number
	ay: number
	state: 'loading' | 'done' | 'missing' | 'failed'
	mesh: THREE.Mesh | null
	ref: number
	/** Its Detour data in the WASM heap, which the navmesh reads from while the tile is in it. */
	data: RecastModule.UnsignedCharArray | null
}

/** Where the server's tiles come from: the open map's ID and its first client tile. */
export interface ServerSource {
	mapId: number
	tileX: number
	tileY: number
}

interface Placed {
	type: string
	matrix: Float32Array
	faces: PlacedCollision
}

/** What the path test found, for the status bar. */
export type PathResult =
	| { kind: 'start' }
	| { kind: 'path'; yards: number; straight: number }
	/** Only a creature that swims gets there; one that can't stops at deep water. */
	| { kind: 'swim'; yards: number; straight: number }
	| { kind: 'short'; yards: number; short: number }
	| { kind: 'none'; reason: 'start' | 'end' | 'unreached' }

export class NavPreview {
	readonly group = new THREE.Group()
	private r: Recast | null = null
	private loading = false
	private settings: NavSettings | null = null
	private builder: TileBuilder | null = null
	private gather = new TileGatherer()
	private nav: NavMesh | null = null
	private query: NavMeshQuery | null = null
	private terrain: Terrain | null = null
	private objects: ObjectLayer | null = null
	private liquidMap: LiquidMap | null = null
	private liquids = new NavLiquids()
	private continent = true
	private tiles = new Map<number, NavTile>()
	private queue: NavTile[] = []
	/** Collision faces by model type: null while loading or when the model has none. */
	private collisions = new Map<string, Float32Array | null>()
	private pending = 0
	private loaded = 0
	private placed = new Map<number, Placed>()
	private placedList: PlacedCollision[] = []
	private signature = ''
	private sea: number | null = null
	private changedAt = 0
	private dirty = false
	private stamp = 0
	/** The tile the focus was last in; in server mode the focus itself (yd from the map's corner). */
	private focusTile = { x: NaN, z: NaN }
	private m =new THREE.Matrix4()
	private material = new THREE.MeshBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.45,
		depthWrite: false,
		side: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -4,
	})
	private pathStart: THREE.Vector3 | null = null
	/** Whether the test has its two points (a path drawn or not). */
	private pathDone = false
	private pathLine: THREE.Line | null = null
	private markers: THREE.Mesh[] = []
	/** Server mode's source (null for the browser's build), its tiles, and the group that turns them into the editor's frame. */
	private server: ServerSource | null = null
	private serverTiles = new Map<number, ServerNavTile>()
	private serverGroup = new THREE.Group()
	/** Counts resets, so a tile that arrives after one is dropped. */
	private serverGen = 0
	private serverPending = 0
	/** Why a server tile failed, for the status bar; '' when none has. */
	serverError = ''
	private groundAt = (x: number, z: number): number | null => {
		const t = this.terrain!
		return !t.contains(x, z) || t.isHole(x, z) ? null : t.heightAt(x, z)
	}

	constructor() {
		this.group.name = 'walkable ground'
		this.serverGroup.name = "the server's navmesh"
		this.serverGroup.matrixAutoUpdate = false
	}

	/** Whether the view shows the server's own tiles (#240). */
	get serverMode(): boolean {
		return this.server !== null
	}

	/**
	 * For the status bar and the probes: the tiles around the target, how many are built for the
	 * ground and models as they are, whether collision (or the WASM) is still loading, and whether a
	 * change waits to settle.
	 */
	get counts() {
		let done = 0
		let missing = 0
		if (this.server) {
			for (const t of this.serverTiles.values()) {
				if (t.state !== 'loading') done++
				if (t.state === 'missing') missing++
			}
			return { done, total: this.serverTiles.size, loading: this.serverPending + (this.r ? 0 : 1), settling: false, missing }
		}
		for (const t of this.tiles.values()) if (t.stamp === this.stamp) done++
		return { done, total: this.tiles.size, loading: this.pending + (this.r ? 0 : 1), settling: this.dirty, missing }
	}

	/**
	 * Builds what the view needs around `focus` this frame, with the map's `liquids` and the sea at
	 * `sea` yards (null for none). `continent` picks the server's settings for maps 0 and 1. A new
	 * terrain or object layer (another tab) starts over. With `server` the tiles are the server's
	 * movement maps for that map instead (#240), and a switch between the two starts over too.
	 */
	update(terrain: Terrain, objects: ObjectLayer, liquids: LiquidMap, sea: number | null, focus: THREE.Vector3, continent: boolean, now: number, server: ServerSource | null = null) {
		if (!this.r) {
			if (!this.loading) {
				this.loading = true
				loadRecast()
					.then((r) => (this.r = r))
					.catch((e) => console.error('walkable ground: recast did not load', e))
			}
			return
		}
		if (terrain !== this.terrain || objects !== this.objects || continent !== this.continent || !this.nav || !sameSource(server, this.server)) {
			this.reset()
			this.terrain = terrain
			this.objects = objects
			this.continent = continent
			this.server = server && { ...server }
			this.start()
		}
		if (this.server) {
			this.followServer(focus)
			return
		}
		const sig = `${terrain.heightVersion}|${terrain.holesVersion}|${objects.version}|${this.loaded}|${liquids.version}|${sea}`
		if (sig !== this.signature) {
			this.signature = sig
			this.changedAt = now
			this.dirty = true
		}
		this.liquidMap = liquids
		this.sea = sea
		// The first build doesn't wait for the models to settle.
		if (this.dirty && (this.stamp === 0 || now - this.changedAt > QUIET_MS)) {
			this.dirty = false
			this.refreshModels(focus)
			this.liquids.reset(this.liquidMap, terrain, this.sea)
			this.stamp++
			this.queue.length = 0
			for (const t of this.tiles.values()) this.queue.push(t)
			this.focusTile.x = NaN
		}
		this.followFocus(focus)
		// Wait for the models' faces, and for a change to settle, so no tile is built twice.
		if (this.pending > 0 || this.dirty) return
		const t0 = performance.now()
		while (this.queue.length && performance.now() - t0 < BUDGET_MS) this.buildTile(this.queue.pop()!)
	}

	/** Frees the navmesh, the tiles and the path; the collision faces stay for next time. */
	clear() {
		this.reset()
		this.terrain = null
		this.objects = null
		this.liquidMap = null
		this.placed.clear()
		this.placedList.length = 0
		this.signature = ''
	}

	dispose() {
		this.clear()
		this.material.dispose()
	}

	private start() {
		const r = this.r!
		if (this.server) {
			// Initialised with the server's params when its first tile arrives.
			this.nav = new r.NavMesh()
			this.group.add(this.serverGroup)
			const s = this.server
			this.serverGroup.matrix.makeScale(-1, 1, -1).setPosition(32 * ADT_YARDS - s.tileX * ADT_YARDS, 0, 32 * ADT_YARDS - s.tileY * ADT_YARDS)
			this.serverGroup.matrixWorldNeedsUpdate = true
			return
		}
		const s = (this.settings = vmangosSettings(this.continent))
		this.builder = new TileBuilder(r, s)
		this.nav = new r.NavMesh()
		this.nav.initTiled(r.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: s.tileYards, tileHeight: s.tileYards, maxTiles: MAX_TILES, maxPolys: MAX_POLYS }))
		this.query = new r.NavMeshQuery(this.nav)
		this.stamp = 0
		this.dirty = true
	}

	private reset() {
		for (const t of this.tiles.values()) this.dropMesh(t)
		this.tiles.clear()
		for (const t of this.serverTiles.values()) this.dropServerTile(t)
		this.serverTiles.clear()
		this.serverGen++
		this.serverPending = 0
		this.serverError = ''
		this.group.remove(this.serverGroup)
		this.server = null
		this.queue.length = 0
		this.clearPath()
		this.query?.destroy()
		this.nav?.destroy()
		this.builder?.destroy()
		this.query = null
		this.nav = null
		this.builder = null
		this.focusTile.x = NaN
	}

	/** The placed models' faces in world space: reused where an object's type and matrix are unchanged. */
	private refreshModels(focus: THREE.Vector3) {
		const objects = this.objects!
		const keep = new Set<number>()
		for (const o of objects.objects.values()) {
			if (isHelper(o.type) || objects.isHidden(o.id)) continue
			if (!o.type.startsWith('m2:') && !o.type.startsWith('wmo:')) continue
			objects.matrixOf(o, this.m)
			const e = this.m.elements
			if (Math.hypot(e[12] - focus.x, e[14] - focus.z) > MODEL_REACH) continue
			const local = this.collision(o.type)
			if (!local || local.length === 0) continue
			keep.add(o.id)
			const old = this.placed.get(o.id)
			if (old && old.type === o.type && sameMatrix(old.matrix, e)) continue
			this.placed.set(o.id, { type: o.type, matrix: new Float32Array(e), faces: placeFaces(local, e) })
		}
		for (const id of this.placed.keys()) if (!keep.has(id)) this.placed.delete(id)
		this.placedList.length = 0
		for (const p of this.placed.values()) this.placedList.push(p.faces)
	}

	/** A model type's collision faces, fetched on first ask (null until they arrive). */
	private collision(type: string): Float32Array | null {
		const got = this.collisions.get(type)
		if (got !== undefined) return got
		this.collisions.set(type, null)
		this.pending++
		fetchCollision(type.slice(type.indexOf(':') + 1))
			.then((f) => this.collisions.set(type, f))
			.catch(() => {})
			.finally(() => {
				this.pending--
				this.loaded++
			})
		return null
	}

	/** Adds the tiles within RANGE of the focus and drops those past KEEP, when the focus enters another tile. */
	private followFocus(focus: THREE.Vector3) {
		const s = this.settings!
		const fx = Math.floor(focus.x / s.tileYards)
		const fz = Math.floor(focus.z / s.tileYards)
		if (fx === this.focusTile.x && fz === this.focusTile.z) return
		this.focusTile.x = fx
		this.focusTile.z = fz
		const t = this.terrain!
		const last = Math.ceil(t.worldSize / s.tileYards) - 1
		const reach = Math.ceil(RANGE / s.tileYards)
		const dist = (tile: NavTile) => Math.hypot((tile.tx + 0.5) * s.tileYards - focus.x, (tile.tz + 0.5) * s.tileYards - focus.z)
		for (const [key, tile] of this.tiles) {
			// A tile past KEEP goes, and so does a stale one outside RANGE, which would show old ground.
			if (dist(tile) <= (tile.stamp === this.stamp ? KEEP : RANGE)) continue
			if (tile.ref) this.nav!.removeTile(tile.ref)
			this.dropMesh(tile)
			this.tiles.delete(key)
		}
		for (let tz = Math.max(0, fz - reach); tz <= Math.min(last, fz + reach); tz++) {
			for (let tx = Math.max(0, fx - reach); tx <= Math.min(last, fx + reach); tx++) {
				const key = tz * 4096 + tx
				if (this.tiles.has(key)) continue
				const tile: NavTile = { tx, tz, mesh: null, stamp: -1, ref: 0 }
				if (dist(tile) > RANGE) continue
				this.tiles.set(key, tile)
			}
		}
		this.queue.length = 0
		for (const tile of this.tiles.values()) if (tile.stamp !== this.stamp && dist(tile) <= RANGE) this.queue.push(tile)
		// Nearest last, since the builder pops.
		this.queue.sort((a, b) => dist(b) - dist(a))
	}

	private buildTile(tile: NavTile) {
		const s = this.settings!
		const nav = this.nav!
		const border = s.borderSize * s.cs
		const x0 = tile.tx * s.tileYards - border
		const z0 = tile.tz * s.tileYards - border
		const x1 = (tile.tx + 1) * s.tileYards + border
		const z1 = (tile.tz + 1) * s.tileYards + border
		const input = this.gather.gather(this.terrain!, this.placedList, x0, z0, x1, z1, this.groundAt, this.liquids)
		const built = this.builder!.build(input, tile.tx, tile.tz)
		tile.stamp = this.stamp
		if (tile.ref) nav.removeTile(tile.ref)
		tile.ref = 0
		if (built?.data) {
			const added = nav.addTile(built.data, this.r!.Detour.DT_TILE_FREE_DATA, 0)
			if (this.r!.statusFailed(added.status)) built.data.destroy()
			else tile.ref = added.tileRef
		}
		this.dropMesh(tile)
		if (!built || built.areas.length === 0) return
		tile.mesh = this.surfaceMesh(built)
		this.group.add(tile.mesh)
	}

	/** A tile's surface to draw, each triangle its area's colour, lifted off the ground. */
	private surfaceMesh(built: { tris: Float32Array; areas: Uint8Array; polys: Uint16Array }): THREE.Mesh {
		const n = built.areas.length
		const pos = new Float32Array(n * 9)
		const col = new Float32Array(n * 9)
		const c = new THREE.Color()
		for (let k = 0; k < n; k++) {
			c.copy(areaColor(built.areas[k]))
			// Each polygon a shade apart, so their edges read.
			c.multiplyScalar(0.8 + 0.2 * (((built.polys[k] * 2654435761) >>> 28) / 15))
			for (let v = 0; v < 3; v++) {
				const o = k * 9 + v * 3
				pos[o] = built.tris[o]
				pos[o + 1] = built.tris[o + 1] + LIFT
				pos[o + 2] = built.tris[o + 2]
				col[o] = c.r
				col[o + 1] = c.g
				col[o + 2] = c.b
			}
		}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
		geo.computeBoundingSphere()
		const mesh = new THREE.Mesh(geo, this.material)
		mesh.renderOrder = 5
		mesh.matrixAutoUpdate = false
		return mesh
	}

	/**
	 * Server mode: asks for the client tiles of the open map within RANGE of the focus, and drops
	 * those past KEEP. A tile is drawn and added to the navmesh when it arrives.
	 */
	private followServer(focus: THREE.Vector3) {
		const s = this.server!
		const fx = focus.x + s.tileX * ADT_YARDS
		const fz = focus.z + s.tileY * ADT_YARDS
		// Looked at again only once the focus has moved a few yards.
		if (Math.abs(fx - this.focusTile.x) < 8 && Math.abs(fz - this.focusTile.z) < 8) return
		this.focusTile.x = fx
		this.focusTile.z = fz
		for (const [key, t] of this.serverTiles) {
			if (tileDistance(t.ax, t.ay, fx, fz) <= KEEP) continue
			this.dropServerTile(t)
			this.serverTiles.delete(key)
		}
		const side = Math.ceil(this.terrain!.worldSize / ADT_YARDS - 1e-3)
		const ax0 = Math.max(s.tileX, Math.floor((fx - RANGE) / ADT_YARDS))
		const ax1 = Math.min(s.tileX + side - 1, 63, Math.floor((fx + RANGE) / ADT_YARDS))
		const ay0 = Math.max(s.tileY, Math.floor((fz - RANGE) / ADT_YARDS))
		const ay1 = Math.min(s.tileY + side - 1, 63, Math.floor((fz + RANGE) / ADT_YARDS))
		for (let ay = ay0; ay <= ay1; ay++) {
			for (let ax = ax0; ax <= ax1; ax++) {
				const key = ay * 64 + ax
				if (this.serverTiles.has(key) || tileDistance(ax, ay, fx, fz) > RANGE) continue
				const tile: ServerNavTile = { ax, ay, state: 'loading', mesh: null, ref: 0, data: null }
				this.serverTiles.set(key, tile)
				this.loadServerTile(tile, key)
			}
		}
	}

	private loadServerTile(tile: ServerNavTile, key: number) {
		const gen = this.serverGen
		this.serverPending++
		fetchNavTile(this.server!.mapId, tile.ax, tile.ay)
			.then((buf) => {
				if (gen !== this.serverGen || this.serverTiles.get(key) !== tile) return
				if (!buf) {
					tile.state = 'missing'
					return
				}
				const t = parseNavTile(buf)
				const r = this.r!
				const nav = this.nav!
				if (!this.query) {
					const ok = nav.initTiled(r.NavMeshParams.create({ orig: t.orig, tileWidth: t.tileWidth, tileHeight: t.tileHeight, maxTiles: SERVER_MAX_TILES, maxPolys: SERVER_MAX_POLYS }))
					if (!ok) throw new Error("Detour didn't take the server's navmesh params")
					this.query = new r.NavMeshQuery(nav)
				}
				const surface = detourSurface(t.data)
				const data = new r.UnsignedCharArray()
				data.copy(t.data)
				// Not DT_TILE_FREE_DATA: the array stays ours, freed once the tile is out (dropServerTile).
				const added = nav.addTile(data, 0, 0)
				if (r.statusFailed(added.status)) {
					data.destroy()
					throw new Error(`Detour didn't take the tile (${r.statusToReadableString(added.status)})`)
				}
				tile.ref = added.tileRef
				tile.data = data
				tile.state = 'done'
				if (surface.areas.length === 0) return
				tile.mesh = this.surfaceMesh(surface)
				this.serverGroup.add(tile.mesh)
			})
			.catch((e: unknown) => {
				if (gen !== this.serverGen) return
				tile.state = 'failed'
				this.serverError = e instanceof Error ? e.message : String(e)
				console.error(`walkable ground: the server's tile ${tile.ax}_${tile.ay}`, e)
			})
			.finally(() => {
				if (gen === this.serverGen) this.serverPending--
			})
	}

	private dropServerTile(t: ServerNavTile) {
		if (t.ref) this.nav?.removeTile(t.ref)
		t.ref = 0
		t.data?.destroy()
		t.data = null
		if (t.mesh) {
			this.serverGroup.remove(t.mesh)
			t.mesh.geometry.dispose()
			t.mesh = null
		}
	}

	private dropMesh(tile: NavTile) {
		if (!tile.mesh) return
		this.group.remove(tile.mesh)
		tile.mesh.geometry.dispose()
		tile.mesh = null
	}

	/**
	 * The path test: the first point is the start, the second the end, and the path a creature
	 * would take between them is drawn (steep slopes allowed, as for the server's creatures): one that
	 * walks (PathInfo::createFilter's NAV_GROUND, which shallow water has too), or where that one
	 * can't get there, one that also swims (creatures take magma and slime as well).
	 */
	pathPoint(p: THREE.Vector3): PathResult {
		if (!this.pathStart || this.pathDone) {
			this.clearPath()
			this.pathStart = p.clone()
			this.addMarker(p, 0x40c0ff)
			return { kind: 'start' }
		}
		const start = this.pathStart
		this.addMarker(p, 0xff4060)
		this.pathDone = true
		const q = this.query
		if (!q) return { kind: 'none', reason: 'start' }
		const a = q.findNearestPoly(this.toNav(start), { halfExtents: PICK_EXTENTS })
		if (!a.success || !a.nearestRef) return { kind: 'none', reason: 'start' }
		const b = q.findNearestPoly(this.toNav(p), { halfExtents: PICK_EXTENTS })
		if (!b.success || !b.nearestRef) return { kind: 'none', reason: 'end' }
		const walker = this.creaturePath(a.nearestPoint, b.nearestPoint, NAV_GROUND)
		let res = walker
		let swims = false
		if (!walker.reaches) {
			const swimmer = this.creaturePath(a.nearestPoint, b.nearestPoint, NAV_GROUND | NAV_WATER | NAV_MAGMA | NAV_SLIME)
			if (swimmer.reaches) {
				res = swimmer
				swims = true
			}
		}
		if (!res.path) return { kind: 'none', reason: 'unreached' }
		const pts = res.path.map((v) => {
			const w = this.toNav(v)
			return new THREE.Vector3(w.x, w.y + 0.3, w.z)
		})
		const line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
		)
		line.renderOrder = 6
		this.pathLine = line
		this.group.add(line)
		let yards = 0
		for (let i = 1; i < pts.length; i++) yards += pts[i].distanceTo(pts[i - 1])
		if (!res.reaches) return { kind: 'short', yards, short: res.short }
		return { kind: swims ? 'swim' : 'path', yards, straight: start.distanceTo(p) }
	}

	/** The path for a creature that may cross polygons with any of `include`'s flags, and how far short it stops. */
	private creaturePath(from: Vector3, to: Vector3, include: number) {
		const r = this.r!
		const filter = new r.QueryFilter()
		filter.includeFlags = include
		const res = this.query!.computePath(from, to, { filter, halfExtents: PICK_EXTENTS, maxPathPolys: 2048, maxStraightPathPoints: 512 })
		r.Raw.destroy(filter.raw)
		if (!res.success || res.path.length < 2) return { path: null, reaches: false, short: Infinity }
		const end = res.path[res.path.length - 1]
		const short = Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z)
		return { path: res.path, reaches: short <= 0.5, short }
	}

	/** A point of the editor's map in the navmesh's frame, and back: the server's tiles are in its own (navPoint). */
	private toNav(p: Vector3): Vector3 {
		const s = this.server
		if (!s) return { x: p.x, y: p.y, z: p.z }
		return navPoint(p, s.tileX, s.tileY, { x: 0, y: 0, z: 0 })
	}

	/** Whether the path test has its start and waits for the end. */
	get pathPending(): boolean {
		return this.pathStart !== null && !this.pathDone
	}

	clearPath() {
		this.pathStart = null
		this.pathDone = false
		if (this.pathLine) {
			this.group.remove(this.pathLine)
			this.pathLine.geometry.dispose()
			;(this.pathLine.material as THREE.Material).dispose()
			this.pathLine = null
		}
		for (const m of this.markers) {
			this.group.remove(m)
			m.geometry.dispose()
			;(m.material as THREE.Material).dispose()
		}
		this.markers.length = 0
	}

	private addMarker(p: THREE.Vector3, color: number) {
		const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }))
		m.position.set(p.x, p.y + 1.5, p.z)
		m.renderOrder = 6
		this.markers.push(m)
		this.group.add(m)
	}
}

function sameSource(a: ServerSource | null, b: ServerSource | null): boolean {
	if (!a || !b) return a === b
	return a.mapId === b.mapId && a.tileX === b.tileX && a.tileY === b.tileY
}

/** How far a point of the map (x, z from the map's corner) is from client tile (ax, ay), 0 inside it. */
function tileDistance(ax: number, ay: number, x: number, z: number): number {
	const dx = Math.max(ax * ADT_YARDS - x, 0, x - (ax + 1) * ADT_YARDS)
	const dz = Math.max(ay * ADT_YARDS - z, 0, z - (ay + 1) * ADT_YARDS)
	return Math.hypot(dx, dz)
}

function sameMatrix(a: Float32Array, b: ArrayLike<number>): boolean {
	for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false
	return true
}
