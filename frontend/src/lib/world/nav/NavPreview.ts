// View › Walkable ground (#175): the server's navmesh as VMaNGOS would build it, drawn over the
// ground around the camera, and a path test between two clicked points. Tiles (navBuild.ts) are
// built nearest first within RANGE of the camera's target, a few each frame within BUDGET_MS, and
// built again QUIET_MS after the ground or the models stop changing. Nothing runs while the view is
// off: the Engine calls `update` only while it is on, and `clear` frees the WASM side when it goes off.

import * as THREE from 'three'
import type { NavMesh, NavMeshQuery } from 'recast-navigation'
import { fetchCollision } from '../../wow/api'
import { isHelper } from '../../models/helpers'
import type { ObjectLayer } from '../ObjectLayer'
import type { Terrain } from '../../terrain/Terrain'
import { AREA_STEEP, TileBuilder, loadRecast, vmangosSettings, type NavSettings, type Recast } from './navBuild'
import { TileGatherer, placeFaces, type PlacedCollision } from './navGeometry'

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

const GROUND_COLOR = new THREE.Color(0.15, 0.85, 0.35)
const STEEP_COLOR = new THREE.Color(1, 0.55, 0.1)

interface NavTile {
	tx: number
	tz: number
	mesh: THREE.Mesh | null
	/** The build generation the tile was last built for; -1 for never. */
	stamp: number
	/** Its tile in the navmesh, 0 for none. */
	ref: number
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
	private changedAt = 0
	private dirty = false
	private stamp = 0
	private focusTile = { x: NaN, z: NaN }
	private m = new THREE.Matrix4()
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
	private groundAt = (x: number, z: number): number | null => {
		const t = this.terrain!
		return !t.contains(x, z) || t.isHole(x, z) ? null : t.heightAt(x, z)
	}

	constructor() {
		this.group.name = 'walkable ground'
	}

	/**
	 * For the status bar and the probes: the tiles around the target, how many are built for the
	 * ground and models as they are, whether collision (or the WASM) is still loading, and whether a
	 * change waits to settle.
	 */
	get counts() {
		let done = 0
		for (const t of this.tiles.values()) if (t.stamp === this.stamp) done++
		return { done, total: this.tiles.size, loading: this.pending + (this.r ? 0 : 1), settling: this.dirty }
	}

	/**
	 * Builds what the view needs around `focus` this frame. `continent` picks the server's settings for
	 * maps 0 and 1. A new terrain or object layer (another tab) starts over.
	 */
	update(terrain: Terrain, objects: ObjectLayer, focus: THREE.Vector3, continent: boolean, now: number) {
		if (!this.r) {
			if (!this.loading) {
				this.loading = true
				loadRecast()
					.then((r) => (this.r = r))
					.catch((e) => console.error('walkable ground: recast did not load', e))
			}
			return
		}
		if (terrain !== this.terrain || objects !== this.objects || continent !== this.continent || !this.nav) {
			this.reset()
			this.terrain = terrain
			this.objects = objects
			this.continent = continent
			this.start()
		}
		const sig = `${terrain.heightVersion}|${terrain.holesVersion}|${objects.version}|${this.loaded}`
		if (sig !== this.signature) {
			this.signature = sig
			this.changedAt = now
			this.dirty = true
		}
		// The first build doesn't wait for the models to settle.
		if (this.dirty && (this.stamp === 0 || now - this.changedAt > QUIET_MS)) {
			this.dirty = false
			this.refreshModels(focus)
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
		const input = this.gather.gather(this.terrain!, this.placedList, x0, z0, x1, z1, this.groundAt)
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
		const n = built.areas.length
		const pos = new Float32Array(n * 9)
		const col = new Float32Array(n * 9)
		const c = new THREE.Color()
		for (let k = 0; k < n; k++) {
			c.copy(built.areas[k] === AREA_STEEP ? STEEP_COLOR : GROUND_COLOR)
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
		tile.mesh = mesh
		this.group.add(mesh)
	}

	private dropMesh(tile: NavTile) {
		if (!tile.mesh) return
		this.group.remove(tile.mesh)
		tile.mesh.geometry.dispose()
		tile.mesh = null
	}

	/**
	 * The path test: the first point is the start, the second the end, and the path a creature
	 * would take between them is drawn (steep slopes allowed, as for the server's creatures).
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
		const a = q.findNearestPoly(start, { halfExtents: PICK_EXTENTS })
		if (!a.success || !a.nearestRef) return { kind: 'none', reason: 'start' }
		const b = q.findNearestPoly(p, { halfExtents: PICK_EXTENTS })
		if (!b.success || !b.nearestRef) return { kind: 'none', reason: 'end' }
		const res = q.computePath(a.nearestPoint, b.nearestPoint, { halfExtents: PICK_EXTENTS, maxPathPolys: 2048, maxStraightPathPoints: 512 })
		if (!res.success || res.path.length < 2) return { kind: 'none', reason: 'unreached' }
		const pts = res.path.map((v) => new THREE.Vector3(v.x, v.y + 0.3, v.z))
		const line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
		)
		line.renderOrder = 6
		this.pathLine = line
		this.group.add(line)
		let yards = 0
		for (let i = 1; i < pts.length; i++) yards += pts[i].distanceTo(pts[i - 1])
		const end = res.path[res.path.length - 1]
		const short = Math.hypot(end.x - b.nearestPoint.x, end.y - b.nearestPoint.y, end.z - b.nearestPoint.z)
		if (short > 0.5) return { kind: 'short', yards, short }
		return { kind: 'path', yards, straight: start.distanceTo(p) }
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

function sameMatrix(a: Float32Array, b: ArrayLike<number>): boolean {
	for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false
	return true
}
