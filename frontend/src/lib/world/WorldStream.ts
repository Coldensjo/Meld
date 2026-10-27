import * as THREE from 'three'
import { fetchImage, textureAnisotropy } from '../wow/api'
import { tileKey } from '../io/mapTiles'
import { TILE_YARDS } from '../terrain/Terrain'
import { groundHeight, groundMesh, groundStride, keepReach, parseGround, tileDistance, wantedTiles, GROUND_CELLS, TileModelShare, type GroundStride, type TileGround, type TileModel } from './worldGround'
import type { ObjectLayer } from './ObjectLayer'
import { WorldHorizon } from '../../../wailsjs/go/main/App'
import { horizonMesh, packHorizon, type HorizonTile } from './horizonMesh'
import { parsePaint, PAINT_DROP, PAINT_REACH, type TilePaintIn } from './worldPaint'
import { WorldPainter, type PaintedTile } from './WorldPainter'
import { liquidMesh, parseLiquids, type TileLiquid } from './worldLiquid'
import { liquidType } from '../water/liquids'
import { KIND_INDEX, liquidLayerMaterial, wantLiquid } from '../water/liquidMaterial'
import type { WorldTileData } from './worldDetail'

/** How many tiles are read at once. */
const LOADS = 3
/** How many tiles' texture layers are read at once, beside the tiles. */
const PAINT_LOADS = 2
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
	/** Drawn in the minimap's colour (`colour`) or, near the camera, in the tile's texture layers (`paint`). */
	mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null
	/** The minimap image's material, which the mesh keeps while it isn't painted. */
	colour: THREE.MeshLambertMaterial | null
	/** The tile's texture layers, read; drawn once its textures have loaded (`waiting`). */
	paint: PaintedTile | null
	/** The texture layers as read, for View › Detail info (their weights are the paint's own texture's bytes). */
	paintIn: TilePaintIn | null
	/** Its texture layers are being read. */
	painting: boolean
	/** Its texture layers could not be read or had no room in the palette: not tried again until the tile is let go of. */
	paintFailed: boolean
	/** Counts the paint's reads and drops, as `gen` the tile's. */
	paintGen: number
	/** The stride the mesh is drawn at (groundStride). */
	stride: GroundStride
	/** The tile's liquid layers (MCLQ), read with its ground. */
	liquids: TileLiquid[] | null
	/** Its liquids drawn at the ground's stride, null for none. */
	liquidMesh: THREE.Mesh | null
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

/** The shader's kind of a tile's liquid type, whose frames are asked for as it is drawn. */
function liquidKind(type: number): number {
	const kind = liquidType(type).kind
	wantLiquid(kind)
	return KIND_INDEX[kind]
}

/** The geometry of a tile's liquids at `stride` (liquidMesh), in the tile's own frame; null for none. */
function liquidGeometryOf(liquids: readonly TileLiquid[], stride: GroundStride): THREE.BufferGeometry | null {
	const m = liquidMesh(liquids, stride, liquidKind)
	if (!m) return null
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
	g.setAttribute('depth', new THREE.BufferAttribute(m.depth, 1))
	g.setAttribute('kind', new THREE.BufferAttribute(m.kind, 1))
	g.setIndex(new THREE.BufferAttribute(m.index, 1))
	g.computeBoundingSphere()
	return g
}

/**
 * The world view's ground (#15): the client's tiles of one map within the reach of the camera, read
 * one at a time nearest first (`/wow/ground`, the heights and holes; the minimap image as the
 * colour; `/wow/groundmodels`, the models), and let go of once the camera is a tile further off. A
 * tile is drawn at a coarser stride the further it is (`groundStride`), redrawn when that changes. The
 * ground is drawn lit, as the props are, with the scene's fog; within PAINT_REACH of the camera a tile
 * is drawn in its own texture layers instead (`/wow/groundpaint`, through the terrain shader as a
 * region's ground: `WorldPainter`), once their textures have loaded. The models are placed in the document's
 * own `ObjectLayer`, so they are drawn, culled, lit and animated as a region's are. The tiles are the
 * client's as it reads them now, Meld's patch included; nothing here edits them: a block is edited in
 * a region tab (io/region.ts `editWorldHere`). Past the ground it draws, and where a tile is still
 * being read, the map's WDL horizon stands in, as a region's far horizon does (`HorizonLayer`). Each
 * tile's liquids (`/wow/groundliquids`, its MCLQ layers) are read with its ground and drawn in `water`
 * with a region's liquid material, at the ground's stride (`liquidMesh`).
 */
export class WorldStream {
	readonly group = new THREE.Group()
	/** The loaded tiles' liquids, beside `group` so View › Water shows them as a region's (`LiquidRenderer`). */
	readonly water = new THREE.Group()
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
	/** A dropped tile took models away since `takeDropped` was last asked. */
	private dropped = false
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
	/** Draws the near tiles in their texture layers. */
	private painter: WorldPainter
	/** The tiles whose texture layers to read, nearest first; worked out again with the plan or when a tile lands. */
	private paintQueue: StreamTile[] = []
	private paintLoads = 0
	/** The plan or the tiles drawn changed since the paint's queue was worked out. */
	private paintDirty = true
	/** The tiles whose paint is read but whose textures are still loading. */
	private waiting = new Set<StreamTile>()

	/**
	 * `objects` is the world view's document's layer, whose terrain is a flat stand-in: `groundAt` is
	 * its height, which a model's height above it (`yOff`) is taken from. `terrainMaterial` is the
	 * stand-in's material, whose light the painted tiles share.
	 */
	constructor(
		readonly mapName: string,
		private objects: ObjectLayer,
		private groundAt: (x: number, z: number) => number,
		terrainMaterial: THREE.ShaderMaterial,
	) {
		this.painter = new WorldPainter(terrainMaterial)
		this.group.name = 'world'
		this.water.name = 'world liquids'
		// Drawn after the terrain and models, as a region's liquids.
		this.water.renderOrder = 10
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
					this.tiles.set(key, {
						key,
						x: t.X,
						y: t.Y,
						file: t.File ?? '',
						ground: null,
						mesh: null,
						colour: null,
						paint: null,
						paintIn: null,
						painting: false,
						paintFailed: false,
						paintGen: 0,
						stride: 1,
						liquids: null,
						liquidMesh: null,
						loading: false,
						failed: false,
						gen: 0,
					})
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
					this.drawLiquids(t)
				}
			}
			this.horizonDirty = true
			this.paintDirty = true
		}
		while (this.loads < LOADS && this.queue.length) {
			const t = tiles.get(this.queue.shift()!)
			if (t && !t.ground && !t.loading && !t.failed) void this.load(t)
		}
		if (this.paintDirty) this.planPaint(tiles)
		while (this.paintLoads < PAINT_LOADS && this.paintQueue.length) {
			const t = this.paintQueue.shift()!
			if (t.mesh && !t.paint && !t.painting && !t.paintFailed) void this.loadPaint(t)
		}
		for (const t of this.waiting) {
			if (!t.paint?.ready() || !t.mesh) continue
			this.waiting.delete(t)
			t.mesh.material = t.paint.material
			// The models' shadows fall on the painted ground, as on a region's.
			t.mesh.receiveShadow = true
		}
		if (this.horizonDirty && this.horizonFull && performance.now() - this.horizonPacked >= HORIZON_EVERY) this.packHorizon()
	}

	/**
	 * Works out which drawn tiles to read the texture layers of (those within PAINT_REACH of the eye,
	 * nearest first), and lets go of the paint of those past PAINT_DROP.
	 */
	private planPaint(tiles: Map<number, StreamTile>) {
		this.paintDirty = false
		const want: Array<{ t: StreamTile; d: number }> = []
		for (const t of tiles.values()) {
			if (!t.mesh) continue
			const d = tileDistance(this.eyeX, this.eyeZ, t.x, t.y)
			if (d >= PAINT_DROP) this.dropPaint(t)
			else if (d < PAINT_REACH && !t.paint && !t.painting && !t.paintFailed) want.push({ t, d })
		}
		want.sort((a, b) => a.d - b.d)
		this.paintQueue = want.map((w) => w.t)
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
		const n = packHorizon(
			this.horizonFull!,
			list.length,
			(k) => {
				const t = list[k]
				const on = !tiles?.get(t.key)?.mesh && tileDistance(this.eyeX, this.eyeZ, t.x, t.y) <= far
				if (on) shown++
				return on
			},
			index.array as Uint32Array,
		)
		this.horizonShown = shown
		g.setDrawRange(0, n)
		index.clearUpdateRanges()
		index.addUpdateRange(0, n)
		index.needsUpdate = true
	}

	/**
	 * Whether a dropped tile took models away since the last call: the engine then lets go of the
	 * models no object uses any more (`Engine.updateWorld`), so a long flight does not keep every model
	 * it passed.
	 */
	takeDropped(): boolean {
		const d = this.dropped
		this.dropped = false
		return d
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

	/** The loaded tile under the world point (x, z), with what has been read of it, or null for none. */
	tileAt(x: number, z: number): WorldTileData | null {
		const tx = Math.floor(x / TILE_YARDS)
		const ty = Math.floor(z / TILE_YARDS)
		if (tx < 0 || ty < 0 || tx > 63 || ty > 63) return null
		const t = this.tiles?.get(tileKey(tx, ty))
		if (!t?.ground) return null
		return { x: t.x, y: t.y, ground: t.ground, paint: t.paintIn, liquids: t.liquids }
	}

	/**
	 * What is loaded, for the probes: tiles drawn, being read, waiting to be read, failed, the map's
	 * count, the models placed, the tiles drawn at each stride ("1", "2", "4"), the horizon's tiles
	 * drawn, and the paint: tiles drawn in their texture layers, their layers being read or waiting
	 * to be (`painting`, the reads and the queue), read but their textures still loading
	 * (`paintWaiting`), and failed; and the tiles whose liquids are drawn (`wet`) with their triangles.
	 */
	stats(): {
		loaded: number
		loading: number
		queued: number
		tiles: number
		failed: number
		models: number
		strides: Record<GroundStride, number>
		horizon: number
		painted: number
		painting: number
		paintWaiting: number
		paintFailed: number
		wet: number
		liquidTriangles: number
	} {
		let loaded = 0
		let failed = 0
		let painted = 0
		let paintFailed = 0
		let wet = 0
		let liquidTriangles = 0
		const strides: Record<GroundStride, number> = { 1: 0, 2: 0, 4: 0 }
		for (const t of this.tiles?.values() ?? []) {
			if (t.mesh) {
				loaded++
				strides[t.stride]++
				if (t.paint && !this.waiting.has(t)) painted++
			}
			if (t.failed) failed++
			if (t.paintFailed) paintFailed++
			if (t.liquidMesh) {
				wet++
				liquidTriangles += (t.liquidMesh.geometry.index?.count ?? 0) / 3
			}
		}
		const painting = this.paintLoads + this.paintQueue.filter((t) => t.mesh && !t.paint && !t.painting && !t.paintFailed).length + (this.paintDirty ? 1 : 0)
		const queued = this.queue.filter((k) => {
			const t = this.tiles?.get(k)
			return !!t && !t.ground && !t.loading && !t.failed
		}).length
		return {
			loaded,
			loading: this.loads,
			queued,
			tiles: this.have.size,
			failed,
			models: this.models.count,
			strides,
			horizon: this.horizonShown,
			painted,
			painting,
			paintWaiting: this.waiting.size,
			paintFailed,
			wet,
			liquidTriangles,
		}
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
			// So are the liquids; a tile whose liquids fail shows its ground dry.
			const liquids = fetch(`/wow/groundliquids?${query}`)
				.then(async (r) => {
					if (!r.ok) throw new Error((await r.text()).trim() || `${r.status}`)
					return parseLiquids(await r.arrayBuffer())
				})
				.catch((err): TileLiquid[] => {
					console.warn(`the liquids of tile ${this.mapName} ${t.x}_${t.y} not read`, err)
					return []
				})
			const res = await fetch(`/wow/ground?${query}`)
			if (!res.ok) throw new Error((await res.text()).trim() || `${res.status}`)
			const ground = parseGround(await res.arrayBuffer())
			const image = t.file ? await fetchImage(t.file).catch(() => null) : null
			const placed = await models
			const wet = await liquids
			// Let go of while it was read (the camera moved off, or the tab closed).
			if (this.disposed || t.gen !== gen) return
			t.ground = ground
			// The stride for where the camera is now, which the plan keeps up to date from here on.
			t.stride = groundStride(tileDistance(this.eyeX, this.eyeZ, t.x, t.y))
			t.mesh = this.meshOf(t, ground, image)
			this.group.add(t.mesh)
			t.liquids = wet
			this.drawLiquids(t)
			this.horizonDirty = true
			this.paintDirty = true
			this.models.add(t.key, placed, (m) => this.place(m))
		} catch (err) {
			if (t.gen === gen) t.failed = true
			console.warn(`tile ${this.mapName} ${t.x}_${t.y} not read`, err)
		} finally {
			if (t.gen === gen) t.loading = false
			this.loads--
		}
	}

	/** Reads tile `t`'s texture layers; they are drawn once their textures have loaded (`waiting`). */
	private async loadPaint(t: StreamTile) {
		const gen = ++t.paintGen
		t.painting = true
		this.paintLoads++
		try {
			const res = await fetch(`/wow/groundpaint?map=${encodeURIComponent(this.mapName)}&x=${t.x}&y=${t.y}`)
			if (!res.ok) throw new Error((await res.text()).trim() || `${res.status}`)
			const p = parsePaint(await res.arrayBuffer())
			// Let go of while it was read (the camera moved off, the tile was dropped or the tab closed).
			if (this.disposed || t.paintGen !== gen || !t.mesh) return
			const painted = this.painter.paint(t.x, t.y, p)
			if (!painted) throw new Error("the world view's palette is full")
			t.paint = painted
			t.paintIn = p
			this.waiting.add(t)
		} catch (err) {
			if (t.paintGen === gen) t.paintFailed = true
			console.warn(`the paint of tile ${this.mapName} ${t.x}_${t.y} not read`, err)
		} finally {
			if (t.paintGen === gen) t.painting = false
			this.paintLoads--
		}
	}

	/** Draws tile `t` in its minimap colour again and lets go of its paint. */
	private dropPaint(t: StreamTile) {
		t.paintGen++
		t.painting = false
		this.waiting.delete(t)
		if (!t.paint) return
		if (t.mesh && t.colour) {
			t.mesh.material = t.colour
			t.mesh.receiveShadow = false
		}
		this.painter.drop(t.paint)
		t.paint = null
		t.paintIn = null
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
		t.colour = new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : BARE })
		const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(g, t.colour)
		mesh.name = `world tile ${t.x}_${t.y}`
		mesh.position.set(t.x * TILE_YARDS, 0, t.y * TILE_YARDS)
		mesh.matrixAutoUpdate = false
		mesh.updateMatrix()
		return mesh
	}

	/** (Re)draws tile `t`'s liquids at its stride, or takes them away when it has none. */
	private drawLiquids(t: StreamTile) {
		const g = t.liquids?.length ? liquidGeometryOf(t.liquids, t.stride) : null
		if (t.liquidMesh) {
			t.liquidMesh.geometry.dispose()
			if (g) {
				t.liquidMesh.geometry = g
				return
			}
			this.water.remove(t.liquidMesh)
			t.liquidMesh = null
		}
		if (!g) return
		const mesh = new THREE.Mesh(g, liquidLayerMaterial())
		mesh.name = `world liquids ${t.x}_${t.y}`
		mesh.renderOrder = 10
		mesh.position.set(t.x * TILE_YARDS, 0, t.y * TILE_YARDS)
		mesh.matrixAutoUpdate = false
		mesh.updateMatrix()
		t.liquidMesh = mesh
		this.water.add(mesh)
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
		t.liquids = null
		if (t.liquidMesh) {
			this.water.remove(t.liquidMesh)
			t.liquidMesh.geometry.dispose()
			t.liquidMesh = null
		}
		this.dropPaint(t)
		t.paintFailed = false
		this.models.drop(t.key, (id) => {
			this.objects.remove(id)
			this.dropped = true
		})
		if (!t.mesh) return
		this.horizonDirty = true
		this.group.remove(t.mesh)
		t.mesh.geometry.dispose()
		t.colour?.map?.dispose()
		t.colour?.dispose()
		t.colour = null
		t.mesh = null
	}

	dispose() {
		this.disposed = true
		for (const t of this.tiles?.values() ?? []) this.drop(t)
		this.horizon.geometry.dispose()
		this.horizon.material.dispose()
		this.painter.dispose()
	}
}
