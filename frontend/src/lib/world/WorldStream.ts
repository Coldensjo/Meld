import * as THREE from 'three'
import { fetchImage, textureAnisotropy } from '../wow/api'
import { tileKey } from '../io/mapTiles'
import { TILE_YARDS } from '../terrain/Terrain'
import { groundHeight, groundMesh, groundStride, keepReach, parseGround, tileDistance, wantedTiles, GROUND_CELLS, TileModelShare, type GroundStride, type TileGround, type TileModel } from './worldGround'
import type { ObjectLayer } from './ObjectLayer'
import { WorldHorizon } from '../../../wailsjs/go/main/App'
import { horizonMesh, packHorizon, type HorizonTile } from './horizonMesh'

/** How many tiles are read at once. */
const LOADS = 3
/** The colour of a tile with no minimap image (every tile of an instance). */
const BARE = 0x8a9078
/** How many tiles past the reach the horizon reaches, as a region's does (`RegionHorizon`). */
const HORIZON_TILES = 5
/** The least time between two packings of the horizon, in ms: tiles land a few a second while streaming. */
const HORIZON_EVERY = 250

interface StreamTile {
	key: number
	x: number
	y: number
	/** The tile's minimap image in the client, '' for none. */
	file: string
	ground: TileGround | null
	mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null
	/** The stride the mesh is drawn at (groundStride). */
	stride: GroundStride
	/** A read is under way; `loads` counts them. */
	loading: boolean
	/** The read failed, so it is not tried again this session. */
	failed: boolean
	/** Counts the reads and drops, so a read that lands after its tile was let go of is thrown away. */
	gen: number
}

/** The geometry of a tile's ground at `stride` (groundMesh), in the tile's own frame. */
function geometryOf(ground: TileGround, stride: GroundStride): THREE.BufferGeometry {
	const m = groundMesh(ground, stride)
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
	g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
	g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
	g.setIndex(new THREE.BufferAttribute(m.index, 1))
	g.computeBoundingBox()
	g.computeBoundingSphere()
	return g
}

/**
 * The world view's ground (#15): the client's tiles of one map within the reach of the camera, read
 * one at a time nearest first (`/wow/ground`, the heights and holes; the minimap image as the
 * colour; `/wow/groundmodels`, the models), and let go of once the camera is a tile further off. A
 * tile is drawn at a coarser stride the further it is (`groundStride`), redrawn when that changes. The
 * ground is drawn lit, as the props are, with the scene's fog; the models are placed in the document's
 * own `ObjectLayer`, so they are drawn, culled, lit and animated as a region's are. The tiles are the
 * client's as it reads them now, Meld's patch included; nothing here edits them: a block is edited in
 * a region tab (io/mapio.ts `editWorldHere`). Past the ground it draws, and where a tile is still
 * being read, the map's WDL horizon stands in, as a region's far horizon does (`HorizonLayer`).
 */
export class WorldStream {
	readonly group = new THREE.Group()
	/** The map's tiles with an ADT, by tileKey; null until /wow/tiles answers. */
	private tiles: Map<number, StreamTile> | null = null
	private have = new Set<number>()
	private loads = 0
	/** The tiles to load, nearest first; worked out again when the camera crosses a tile or the reach changes. */
	private queue: number[] = []
	/** The quarter tile the camera was in, and the reach, when the queue was last worked out; NaN to work it out again. */
	private planX = NaN
	private planZ = NaN
	private planReach = NaN
	/** Where the camera's eye was at the last `update` (a tile is read only after one). */
	private eyeX = 0
	private eyeZ = 0
	private disposed = false
	/** Why the map's tile list could not be read, '' when it was. */
	error = ''
	/** The loaded tiles' models in `objects`, each placed once however many tiles list it. */
	private models = new TileModelShare()
	/** The map's WDL tiles (View › Far Horizon), unlit in the fog's colour; its index holds the tiles shown. */
	readonly horizon = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ fog: false }))
	/** The horizon tiles' map coordinates, in the mesh's order, and every tile's triangles. */
	private horizonTiles: Array<{ x: number; y: number; key: number }> = []
	private horizonFull: Uint32Array | null = null
	/** The tiles shown changed since the horizon was last packed, and when that was (performance.now). */
	private horizonDirty = false
	private horizonPacked = 0
	/** How many horizon tiles are drawn, for the probes. */
	private horizonShown = 0

	/**
	 * `objects` is the world view's document's layer, whose terrain is a flat stand-in: `groundAt` is
	 * its height, which a model's height above it (`yOff`) is taken from.
	 */
	constructor(
		readonly mapName: string,
		private objects: ObjectLayer,
		private groundAt: (x: number, z: number) => number,
	) {
		this.group.name = 'world'
		this.horizon.name = 'world horizon'
		this.horizon.frustumCulled = false
		this.horizon.visible = false
		this.group.add(this.horizon)
		WorldHorizon(mapName)
			.then((tiles) => {
				if (!this.disposed) this.setHorizon((tiles ?? []) as HorizonTile[])
			})
			.catch((err) => console.warn(`the horizon of ${mapName} not read`, err))
		fetch(`/wow/tiles?map=${encodeURIComponent(mapName)}`)
			.then(async (res) => {
				if (!res.ok) throw new Error((await res.text()).trim() || `${res.status}`)
				return ((await res.json()) as Array<{ X: number; Y: number; File: string }> | null) ?? []
			})
			.then((list) => {
				if (this.disposed) return
				this.tiles = new Map()
				for (const t of list) {
					const key = tileKey(t.X, t.Y)
					this.tiles.set(key, { key, x: t.X, y: t.Y, file: t.File ?? '', ground: null, mesh: null, stride: 1, loading: false, failed: false, gen: 0 })
					this.have.add(key)
				}
				this.planX = NaN
			})
			.catch((err) => {
				this.error = String(err)
				console.warn(`the tiles of ${mapName} not read`, err)
			})
	}

	/** The map's tiles with an ADT (tileKey); empty until read. */
	get tileKeys(): ReadonlySet<number> {
		return this.have
	}

	/**
	 * Keeps the tiles within `reach` yards of the camera's eye at (x, z) loaded, each at the stride for
	 * its distance, and lets go of those a tile further. Cheap while the camera stays in a quarter of a
	 * tile: called every frame.
	 */
	update(x: number, z: number, reach: number) {
		const tiles = this.tiles
		if (!tiles) return
		this.eyeX = x
		this.eyeZ = z
		const q = TILE_YARDS / 4
		const qx = Math.floor(x / q)
		const qz = Math.floor(z / q)
		if (qx !== this.planX || qz !== this.planZ || reach !== this.planReach) {
			this.planX = qx
			this.planZ = qz
			this.planReach = reach
			this.queue = wantedTiles(x, z, reach, this.have)
			const keep = keepReach(reach)
			for (const t of tiles.values()) {
				if (!t.ground && !t.loading) continue
				const d = tileDistance(x, z, t.x, t.y)
				if (d > keep) this.drop(t)
				else if (t.mesh && t.ground && groundStride(d) !== t.stride) {
					t.stride = groundStride(d)
					t.mesh.geometry.dispose()
					t.mesh.geometry = geometryOf(t.ground, t.stride)
				}
			}
			this.horizonDirty = true
		}
		while (this.loads < LOADS && this.queue.length) {
			const t = tiles.get(this.queue.shift()!)
			if (t && !t.ground && !t.loading && !t.failed) void this.load(t)
		}
		if (this.horizonDirty && this.horizonFull && performance.now() - this.horizonPacked >= HORIZON_EVERY) this.packHorizon()
	}

	/** Shows the horizon (View › Far Horizon, where it can be seen) in `color`, the fog's. */
	showHorizon(on: boolean, color: THREE.Color) {
		this.horizon.material.color.copy(color)
		this.horizon.visible = on && this.horizonShown > 0
	}

	private setHorizon(tiles: HorizonTile[]) {
		if (!tiles.length) return
		// The tiles' own coordinates as the offsets from tile 0_0 place them where the ground is.
		const { positions, indices } = horizonMesh(tiles, TILE_YARDS)
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
		g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices.length), 1))
		g.setDrawRange(0, 0)
		this.horizon.geometry.dispose()
		this.horizon.geometry = g
		this.horizonFull = indices
		this.horizonTiles = tiles.map((t) => ({ x: t.dx, y: t.dy, key: tileKey(t.dx, t.dy) }))
		this.horizonDirty = true
	}

	/** Packs the horizon's index with the tiles near enough to draw that have no ground drawn. */
	private packHorizon() {
		this.horizonDirty = false
		this.horizonPacked = performance.now()
		const g = this.horizon.geometry
		const index = g.index!
		const far = this.planReach + HORIZON_TILES * TILE_YARDS
		const tiles = this.tiles
		const list = this.horizonTiles
		let shown = 0
		const n = packHorizon(this.horizonFull!, list.length, (k) => {
			const t = list[k]
			const on = !tiles?.get(t.key)?.mesh && tileDistance(this.eyeX, this.eyeZ, t.x, t.y) <= far
			if (on) shown++
			return on
		}, index.array as Uint32Array)
		this.horizonShown = shown
		g.setDrawRange(0, n)
		index.clearUpdateRanges()
		index.addUpdateRange(0, n)
		index.needsUpdate = true
	}

	/** The ground's height at (x, z), NaN where no tile is loaded. */
	heightAt(x: number, z: number): number {
		const tx = Math.floor(x / TILE_YARDS)
		const ty = Math.floor(z / TILE_YARDS)
		if (tx < 0 || ty < 0 || tx > 63 || ty > 63) return NaN
		const g = this.tiles?.get(tileKey(tx, ty))?.ground
		if (!g) return NaN
		return groundHeight(g, (x / TILE_YARDS - tx) * GROUND_CELLS, (z / TILE_YARDS - ty) * GROUND_CELLS)
	}

	/**
	 * What is loaded, for the probes: tiles drawn, being read, waiting to be read, failed, the map's
	 * count, the models placed, the tiles drawn at each stride ("1", "2", "4") and the horizon's tiles drawn.
	 */
	stats(): { loaded: number; loading: number; queued: number; tiles: number; failed: number; models: number; strides: Record<GroundStride, number>; horizon: number } {
		let loaded = 0
		let failed = 0
		const strides: Record<GroundStride, number> = { 1: 0, 2: 0, 4: 0 }
		for (const t of this.tiles?.values() ?? []) {
			if (t.mesh) {
				loaded++
				strides[t.stride]++
			}
			if (t.failed) failed++
		}
		const queued = this.queue.filter((k) => {
			const t = this.tiles?.get(k)
			return !!t && !t.ground && !t.loading && !t.failed
		}).length
		return { loaded, loading: this.loads, queued, tiles: this.have.size, failed, models: this.models.count, strides, horizon: this.horizonShown }
	}

	private async load(t: StreamTile) {
		const gen = ++t.gen
		t.loading = true
		this.loads++
		try {
			const query = `map=${encodeURIComponent(this.mapName)}&x=${t.x}&y=${t.y}`
			// The models are read beside the ground; a tile whose models fail still shows its ground.
			const models = fetch(`/wow/groundmodels?${query}`)
				.then(async (r) => {
					if (!r.ok) throw new Error((await r.text()).trim() || `${r.status}`)
					return ((await r.json()) as TileModel[] | null) ?? []
				})
				.catch((err): TileModel[] => {
					console.warn(`the models of tile ${this.mapName} ${t.x}_${t.y} not read`, err)
					return []
				})
			const res = await fetch(`/wow/ground?${query}`)
			if (!res.ok) throw new Error((await res.text()).trim() || `${res.status}`)
			const ground = parseGround(await res.arrayBuffer())
			const image = t.file ? await fetchImage(t.file).catch(() => null) : null
			const placed = await models
			// Let go of while it was read (the camera moved off, or the tab closed).
			if (this.disposed || t.gen !== gen) return
			t.ground = ground
			// The stride for where the camera is now, which the plan keeps up to date from here on.
			t.stride = groundStride(tileDistance(this.eyeX, this.eyeZ, t.x, t.y))
			t.mesh = this.meshOf(t, ground, image)
			this.group.add(t.mesh)
			this.horizonDirty = true
			this.models.add(t.key, placed, (m) => this.place(m))
		} catch (err) {
			if (t.gen === gen) t.failed = true
			console.warn(`tile ${this.mapName} ${t.x}_${t.y} not read`, err)
		} finally {
			if (t.gen === gen) t.loading = false
			this.loads--
		}
	}

	private meshOf(t: StreamTile, ground: TileGround, image: { width: number; height: number; pixels: Uint8Array } | null) {
		const g = geometryOf(ground, t.stride)
		let map: THREE.DataTexture | null = null
		if (image) {
			map = new THREE.DataTexture(image.pixels, image.width, image.height, THREE.RGBAFormat)
			map.colorSpace = THREE.SRGBColorSpace
			map.generateMipmaps = true
			map.minFilter = THREE.LinearMipmapLinearFilter
			map.magFilter = THREE.LinearFilter
			map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
			map.anisotropy = textureAnisotropy()
			map.needsUpdate = true
		}
		const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : BARE }))
		mesh.name = `world tile ${t.x}_${t.y}`
		mesh.position.set(t.x * TILE_YARDS, 0, t.y * TILE_YARDS)
		mesh.matrixAutoUpdate = false
		mesh.updateMatrix()
		return mesh
	}

	/** Places one of a tile's models in the document's layer, at its height in the client. */
	private place(m: TileModel): number {
		return this.objects.add({
			type: m.type,
			x: m.x,
			z: m.z,
			yOff: m.y - this.groundAt(m.x, m.z),
			rotY: m.rotY,
			scale: m.scale,
			tiltX: m.tiltX,
			tiltZ: m.tiltZ,
		}).id
	}

	private drop(t: StreamTile) {
		// A read under way is thrown away when it lands (`load` sees the generation moved on).
		t.gen++
		t.loading = false
		t.ground = null
		this.models.drop(t.key, (id) => this.objects.remove(id))
		if (!t.mesh) return
		this.horizonDirty = true
		this.group.remove(t.mesh)
		t.mesh.geometry.dispose()
		t.mesh.material.map?.dispose()
		t.mesh.material.dispose()
		t.mesh = null
	}

	dispose() {
		this.disposed = true
		for (const t of this.tiles?.values() ?? []) this.drop(t)
		this.horizon.geometry.dispose()
		this.horizon.material.dispose()
	}
}
