import * as THREE from 'three'
import { fbm } from '../engine/noise'
import { snowLine as snowLineOf, type CoastShape, type PresetId, type ShapeOptions } from './presets'
import { generateHeights, imageGroundHeights, type ImageGround } from './generate'
import { createTerrainMaterial } from './TerrainMaterial'
import { LAYER_COUNT } from './layers'
import { PaletteArray } from './paletteArray'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, chunksPerSide, packRoles } from './chunkPaint'
import { rayMarchGround } from './rayMarch'
import { heightAt as heightField } from './heightField'
import { holeTriangle, triangleIsHole, writeCellIndex } from './holes'
import { DirtyRegion, uploadRect, type DirtyRect } from './dirtyRect'
import { CHUNK_IMPASSABLE, areaColor } from './chunkFlags'
import { SHADOW_PER_CELL, unpackShadowBits } from './bakedShadows'
import { TILE_YARDS, TILE_CELLS } from '../wow/format'

export type { DirtyRect } from './dirtyRect'

/** A 1.12 tile is 1600/3 yards across: 128 cells of this size, the grid the server's maps use. */
export { TILE_YARDS }
/** Default cell size in yards: 128 cells make one tile. */
export const CELL_SIZE = TILE_YARDS / TILE_CELLS
export { OCEAN_FLOOR } from './presets'
const CHUNK = 32 // render chunk side, in cells (independent of the 1.12 paint chunks)

/** A starting shape (see presets.ts). */
export type GenerateKind = PresetId

/**
 * Heightmap terrain split into chunks. Heights live in a flat Float32Array of
 * (size+1)^2 vertices; edits mark a dirty rect and only touched chunks are
 * re-uploaded on the next `update()`.
 *
 * Paint follows the 1.12 chunk rules (see chunkPaint.ts): each paint chunk of CHUNK_CELLS cells
 * names up to SLOTS palette textures in `chunkSlots`, and each texel's weights for those are in
 * `weights`.
 */
export class Terrain {
	readonly size: number
	readonly verts: number
	readonly cellSize: number
	readonly worldSize: number
	readonly splatRes: number
	/** Paint chunks along one side of the map. */
	readonly paintChunksPerSide: number
	readonly heights: Float32Array
	/** One byte per cell: non-zero where the ground is cut out (see holes.ts). A hole draws nothing and isn't picked. */
	readonly holes: Uint8Array
	/** Counts the edits of `holes`, so a view of them (the hole walls) knows when to rebuild. */
	holesVersion = 0
	/**
	 * For a map made for the client whose tiles aren't its whole square (#46, terrain/tileMask.ts): a byte
	 * a 128-cell tile, row by row, 1 where the tile is the map's. A tile left out is drawn nowhere and
	 * counts as a hole (`isHole`), so it is never picked, grows no tufts and takes no model; its ground
	 * stays. Null for every tile. Set through `setTileMask`.
	 */
	tileMask: Uint8Array | null = null
	/**
	 * One byte per cell: non-zero where the client's tile grows no ground effect doodads (its
	 * noEffectDoodad bits, under roads and buildings). Read from a region, painted with the Map data
	 * tool, and kept in the map file.
	 */
	readonly noEffect: Uint8Array
	/** One AreaTable.dbc ID per paint chunk (an MCNK), 0 for none, which the chunk's header names. */
	readonly areaIds: Uint32Array
	/** One byte of flags per paint chunk: CHUNK_IMPASSABLE (chunkFlags.ts) where players can't walk it. */
	readonly chunkFlags: Uint8Array
	/** Counts the edits of `noEffect`, `areaIds` and `chunkFlags`, so their overlay knows when to redraw. */
	chunkDataVersion = 0
	/**
	 * The Map data tool's overlay, made on first use: a texel per chunk (its zone's colour, and the
	 * impassable flag in alpha) and a texel per cell (the no-effect cells, in `cellTex`'s red). `update`
	 * rewrites and uploads only the chunks and cells `touchChunkData` marked (#530). `chunkDataSrc` and
	 * `cellSrc` are never-bound views of the same arrays, for the sub-rect uploads (see uploadRect).
	 */
	private chunkDataTex: THREE.DataTexture | null = null
	private chunkDataSrc: THREE.DataTexture | null = null
	/**
	 * A texel per cell, made on first use, shared so the shader spends one sampler on both (#394): red
	 * is `noEffect` for the Map data overlay, green the selected area's shape (`setAreaShape`).
	 */
	private cellTex: THREE.DataTexture | null = null
	private cellSrc: THREE.DataTexture | null = null
	/** The shape last written into `cellTex`'s green, so an unchanged one isn't copied again. */
	private areaCells: Uint8Array | null = null
	/** What changed in the chunk data since the overlay's last upload: chunks, and cells. */
	private chunkDataDirty = new DirtyRegion()
	private cellDataDirty = new DirtyRegion()
	/** SLOTS weights per splat texel, for the chunk's slots; each texel sums to 255. */
	readonly weights: Uint8Array
	/** SLOTS palette indices per paint chunk (NO_TEXTURE for an empty slot). */
	readonly chunkSlots: Uint8Array
	readonly weightTex: THREE.DataTexture
	readonly slotTex: THREE.DataTexture
	/** The map's texture palette, bound to the shader. */
	readonly palette: PaletteArray
	/** Paint mask (0-255 per splat texel); texture fills apply to it. Not saved. */
	readonly mask: Uint8Array
	readonly maskTex: THREE.DataTexture
	/** The baked shadows' texture, over `shadow`'s bytes; null without. */
	private bakedTex: THREE.DataTexture | null = null
	/**
	 * The baked shadows (MCSH), a byte per texel (255 in shadow), `shadowSide` texels a side; null while
	 * the map has none of its own (a region then keeps the client's). Read from a region or the map
	 * file, baked or painted (B-057), saved in the map file and sent on export. Write it through
	 * `ensureShadow` and report the rows with `touchShadow`.
	 */
	shadow: Uint8Array | null = null
	readonly shadowSide: number
	/** Whether the Engine has asked the client for this terrain's baked shadows (once per terrain). */
	bakedRequested = false
	/**
	 * How far each cell's middle (its MCVT inner height) lies above its four corners' mean in the
	 * client's tile, a float a cell, `size` a row; null for a map of its own or until read. The grid
	 * keeps only the corners, so this is the walkable-ground view's alone (#284): the server's ground
	 * has four triangles a cell about that middle, which the export keeps while the cell's corners keep
	 * the client's heights (`innerBase`) and puts at the corners' mean once one has moved (#380). Read
	 * from the client once per terrain (`Engine.updateInnerLift`), never saved.
	 */
	innerLift: Float32Array | null = null
	/** The client's corner heights `innerLift` is over (`heights`' layout), to tell a sculpted cell. */
	innerBase: Float32Array | null = null
	/** Whether the Engine has asked the client for `innerLift`, and whether the answer is still on its way. */
	innerRequested = false
	innerPending = false
	/** Bumped whenever the mask is marked dirty, so a scan of it can be skipped when nothing changed. */
	maskVersion = 0
	private maskDirty = new DirtyRegion()
	/**
	 * CPU-side views of the weights and the mask, never bound to a material. A sub-rect upload reads
	 * the changed texels straight from the arrays through them (see uploadRect).
	 */
	private weightSrc: THREE.DataTexture
	private maskSrc: THREE.DataTexture
	/**
	 * The heights as a float texture, one texel a vertex, made on first use (the sea reads the ground's
	 * depth from it), and what changed in it since its last upload. `heightSrc` is its CPU-side view.
	 */
	private heightTex: THREE.DataTexture | null = null
	private heightSrc: THREE.DataTexture | null = null
	private heightTexDirty = new DirtyRegion()
	readonly material: THREE.ShaderMaterial
	readonly group = new THREE.Group()

	/** Incremented whenever heights reach the GPU (lets other views resync). */
	heightsVersion = 0
	private chunks: THREE.Mesh[] = []
	private chunksPerSide: number
	private dirty = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
	private splatDirty = new DirtyRegion()
	/** Scratch for uploadRegion. */
	private uploadBox = new THREE.Box2()
	private uploadPos = new THREE.Vector2()

	constructor(size: number, cellSize = CELL_SIZE) {
		if (size % CHUNK_CELLS !== 0) throw new Error(`map size ${size} is not a multiple of ${CHUNK_CELLS}`)
		this.size = size
		this.verts = size + 1
		this.cellSize = cellSize
		this.worldSize = size * cellSize
		this.splatRes = size * SPLAT_PER_CELL
		this.paintChunksPerSide = chunksPerSide(size)
		this.heights = new Float32Array(this.verts * this.verts)
		this.holes = new Uint8Array(size * size)
		this.noEffect = new Uint8Array(size * size)
		this.shadowSide = size * SHADOW_PER_CELL
		this.areaIds = new Uint32Array(this.paintChunksPerSide * this.paintChunksPerSide)
		this.chunkFlags = new Uint8Array(this.paintChunksPerSide * this.paintChunksPerSide)
		this.weights = new Uint8Array(this.splatRes * this.splatRes * SLOTS)
		this.chunkSlots = new Uint8Array(this.paintChunksPerSide * this.paintChunksPerSide * SLOTS).fill(NO_TEXTURE)
		// Every texel starts as palette entry 0, the first ground texture.
		for (let i = 0; i < this.weights.length; i += SLOTS) this.weights[i] = 255
		for (let c = 0; c < this.paintChunksPerSide * this.paintChunksPerSide; c++) this.chunkSlots[c * SLOTS] = 0

		this.weightTex = this.makeDataTexture(this.weights, this.splatRes, this.splatRes)
		this.slotTex = this.makeDataTexture(this.chunkSlots, this.paintChunksPerSide, this.paintChunksPerSide)
		this.palette = new PaletteArray((t) => (this.material.uniforms.palette.value = t))
		this.mask = new Uint8Array(this.splatRes * this.splatRes)
		this.maskTex = new THREE.DataTexture(this.mask, this.splatRes, this.splatRes, THREE.RedFormat, THREE.UnsignedByteType)
		this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter
		// Linear filtering never reads mipmaps; without this a partial upload would rebuild them.
		this.maskTex.generateMipmaps = false
		this.maskTex.needsUpdate = true
		this.weightSrc = new THREE.DataTexture(this.weights, this.splatRes, this.splatRes, THREE.RGBAFormat)
		this.maskSrc = new THREE.DataTexture(this.mask, this.splatRes, this.splatRes, THREE.RedFormat, THREE.UnsignedByteType)
		this.material = createTerrainMaterial(this.palette.texture, this.slotTex, this.weightTex, this.worldSize, this.cellSize, CHUNK_CELLS * this.cellSize, this.paintChunksPerSide)
		this.material.uniforms.maskTex.value = this.maskTex
		this.chunksPerSide = Math.ceil(size / CHUNK)
		this.buildChunks()
		this.group.name = 'terrain'
	}

	/** Nearest-sampled RGBA texture over a byte array of four values per texel. */
	private makeDataTexture(data: Uint8Array, w: number, h: number) {
		const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
		t.magFilter = THREE.NearestFilter
		t.minFilter = THREE.NearestFilter
		t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
		t.generateMipmaps = false
		t.needsUpdate = true
		return t
	}

	/** Draws a line at every tile edge, for a map of client tiles: `cells` is a tile's width in cells, 0 to hide them. */
	setTileBorders(cells: number) {
		this.material.uniforms.tileWorld.value = cells * this.cellSize
	}

	/** Sets the map's texture palette (see PaletteArray). */
	setPalette(paths: string[]) {
		this.palette.set(paths)
	}

	private buildChunks() {
		for (let cz = 0; cz < this.chunksPerSide; cz++) {
			for (let cx = 0; cx < this.chunksPerSide; cx++) {
				const cells = Math.min(CHUNK, this.size - cx * CHUNK)
				const cellsZ = Math.min(CHUNK, this.size - cz * CHUNK)
				const vx = cells + 1
				const vz = cellsZ + 1
				const pos = new Float32Array(vx * vz * 3)
				const nor = new Float32Array(vx * vz * 3)
				// The index has room for every cell; hole cells are left out when the chunk is written.
				const idx = new Uint32Array(cells * cellsZ * 6)
				const geo = new THREE.BufferGeometry()
				geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
				geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
				geo.setIndex(new THREE.BufferAttribute(idx, 1))
				const mesh = new THREE.Mesh(geo, this.material)
				mesh.userData = { cx, cz, vx, vz, cells, cellsZ, ox: cx * CHUNK, oz: cz * CHUNK }
				mesh.matrixAutoUpdate = false
				mesh.castShadow = true
				mesh.receiveShadow = true
				this.chunks.push(mesh)
				this.group.add(mesh)
				this.writeChunk(mesh)
			}
		}
	}

	/**
	 * Shows only the chunks that meet one of `frustums` (the doorways of the WMO room the camera is
	 * in), or every chunk for null.
	 */
	gate(frustums: THREE.Frustum[] | null) {
		for (const c of this.chunks) {
			if (!frustums) {
				c.visible = true
				continue
			}
			const g = c.geometry
			if (!g.boundingBox) g.computeBoundingBox()
			let seen = false
			for (let k = 0; !seen && k < frustums.length; k++) seen = frustums[k].intersectsBox(g.boundingBox!)
			c.visible = seen
		}
	}

	private writeChunk(mesh: THREE.Mesh) {
		const { vx, vz, cells, cellsZ, ox, oz } = mesh.userData as { vx: number; vz: number; cells: number; cellsZ: number; ox: number; oz: number }
		const geo = mesh.geometry
		const pos = geo.attributes.position.array as Float32Array
		const nor = geo.attributes.normal.array as Float32Array
		const idx = geo.index!
		const count = writeCellIndex(idx.array as Uint32Array, cells, cellsZ, vx, ox, oz, this.holes, this.size)
		// A render chunk lies inside one tile (CHUNK divides TILE_CELLS), so a tile left out draws none of it.
		geo.setDrawRange(0, this.tileOff(ox, oz) ? 0 : count)
		idx.needsUpdate = true
		const V = this.verts
		const h = this.heights
		const cs = this.cellSize
		for (let z = 0; z < vz; z++) {
			const gz = oz + z
			for (let x = 0; x < vx; x++) {
				const gx = ox + x
				const i = (z * vx + x) * 3
				const hc = h[gz * V + gx]
				pos[i] = gx * cs
				pos[i + 1] = hc
				pos[i + 2] = gz * cs
				const hl = h[gz * V + Math.max(gx - 1, 0)]
				const hr = h[gz * V + Math.min(gx + 1, V - 1)]
				const hd = h[Math.max(gz - 1, 0) * V + gx]
				const hu = h[Math.min(gz + 1, V - 1) * V + gx]
				let nx = hl - hr
				let ny = 2 * cs
				let nz = hd - hu
				const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
				nx /= len
				ny /= len
				nz /= len
				nor[i] = nx
				nor[i + 1] = ny
				nor[i + 2] = nz
			}
		}
		geo.attributes.position.needsUpdate = true
		geo.attributes.normal.needsUpdate = true
		geo.computeBoundingSphere()
		geo.computeBoundingBox()
	}

	/**
	 * Says `holes` changed (every writer of it calls this, TerrainStroke for the undoable ones), in the
	 * inclusive cell rect `r` when given and anywhere when not.
	 */
	touchHoles(r?: { x0: number; z0: number; x1: number; z1: number } | null) {
		this.holesVersion++
		if (r) this.growGroundChange(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
		else this.growGroundChange(0, 0, this.size, this.size)
	}

	/** Bumped whenever heights or paint change, for layers that rebuild from them (the ground effects). */
	heightVersion = 0
	paintVersion = 0

	/**
	 * The vertex rect (inclusive) whose heights or holes changed since the walkable-ground view last
	 * took it (`takeGroundChange`), so it builds again only the tiles there (#620). Empty when x0 > x1.
	 */
	private groundChange = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }

	private growGroundChange(x0: number, z0: number, x1: number, z1: number) {
		const g = this.groundChange
		g.x0 = Math.min(g.x0, x0)
		g.z0 = Math.min(g.z0, z0)
		g.x1 = Math.max(g.x1, x1)
		g.z1 = Math.max(g.z1, z1)
	}

	/** Copies into `out` the vertex rect changed since the last call and starts a new one; false when nothing changed. */
	takeGroundChange(out: { x0: number; z0: number; x1: number; z1: number }): boolean {
		const g = this.groundChange
		const any = g.x0 <= g.x1 && g.z0 <= g.z1
		out.x0 = g.x0
		out.z0 = g.z0
		out.x1 = g.x1
		out.z1 = g.z1
		g.x0 = g.z0 = Infinity
		g.x1 = g.z1 = -Infinity
		return any
	}

	/** Mark a vertex-space rect (inclusive) as changed. */
	markDirty(x0: number, z0: number, x1: number, z1: number) {
		this.heightVersion++
		this.growGroundChange(x0, z0, x1, z1)
		const d = this.dirty
		d.x0 = Math.min(d.x0, x0 - 1)
		d.z0 = Math.min(d.z0, z0 - 1)
		d.x1 = Math.max(d.x1, x1 + 1)
		d.z1 = Math.max(d.z1, z1 + 1)
	}

	markAllDirty() {
		this.markDirty(0, 0, this.size, this.size)
		this.markSplatDirty()
	}

	/**
	 * The weights (and chunk slots) changed. With `rect`, an inclusive texel rect, only those texels are
	 * uploaded on the next update; without one the whole weights texture is.
	 */
	markSplatDirty(rect?: DirtyRect | null) {
		this.paintVersion++
		this.splatDirty.mark(rect)
	}

	/** The mask changed, in the inclusive texel `rect` or (without one) anywhere. */
	markMaskDirty(rect?: DirtyRect | null) {
		this.maskVersion++
		this.maskDirty.mark(rect)
	}

	/**
	 * Uploads what `region` says changed in `dst`: its rect from `src`, a never-bound view of the same
	 * array, when the renderer is there and the rect is small enough, else the whole texture. `res` is
	 * the texture's side.
	 */
	private uploadRegion(renderer: THREE.WebGLRenderer | undefined, region: DirtyRegion, src: THREE.DataTexture, dst: THREE.DataTexture, res = this.splatRes) {
		const r = renderer && region.rect ? uploadRect(region.rect, res) : 'whole'
		if (r === null) return
		if (r === 'whole') {
			dst.needsUpdate = true
			return
		}
		this.uploadBox.min.set(r.x0, r.z0)
		this.uploadBox.max.set(r.x1 + 1, r.z1 + 1)
		this.uploadPos.set(r.x0, r.z0)
		try {
			renderer!.copyTextureToTexture(src, dst, this.uploadBox, this.uploadPos)
		} catch (err) {
			// A context that can't take a sub-rect upload still gets the whole texture.
			console.warn('partial texture upload failed; uploading the whole texture', err)
			dst.needsUpdate = true
		}
	}

	/**
	 * Push pending edits to the GPU. Call once per frame. With the renderer, paint and mask edits upload
	 * only the texels that changed; without it the whole textures are re-uploaded.
	 */
	update(renderer?: THREE.WebGLRenderer) {
		const d = this.dirty
		if (d.x1 >= d.x0) {
			const c0x = Math.max(0, Math.floor(d.x0 / CHUNK))
			const c0z = Math.max(0, Math.floor(d.z0 / CHUNK))
			const c1x = Math.min(this.chunksPerSide - 1, Math.floor(d.x1 / CHUNK))
			const c1z = Math.min(this.chunksPerSide - 1, Math.floor(d.z1 / CHUNK))
			for (let cz = c0z; cz <= c1z; cz++) {
				for (let cx = c0x; cx <= c1x; cx++) {
					this.writeChunk(this.chunks[cz * this.chunksPerSide + cx])
				}
			}
			if (this.heightTex) this.heightTexDirty.mark({ x0: d.x0, z0: d.z0, x1: d.x1, z1: d.z1 })
			d.x0 = d.z0 = Infinity
			d.x1 = d.z1 = -Infinity
			this.heightsVersion++
		}
		if (this.heightTexDirty.dirty) {
			this.uploadRegion(renderer, this.heightTexDirty, this.heightSrc!, this.heightTex!, this.verts)
			this.heightTexDirty.clear()
		}
		if (this.maskDirty.dirty) {
			this.uploadRegion(renderer, this.maskDirty, this.maskSrc, this.maskTex)
			this.maskDirty.clear()
		}
		if (this.chunkDataTex && this.chunkDataDirty.dirty) {
			const side = this.paintChunksPerSide
			const r = this.chunkDataDirty.rect
			const px = this.chunkDataTex.image.data as Uint8Array
			const x0 = r ? Math.max(0, r.x0) : 0
			const z0 = r ? Math.max(0, r.z0) : 0
			const x1 = r ? Math.min(side - 1, r.x1) : side - 1
			const z1 = r ? Math.min(side - 1, r.z1) : side - 1
			for (let cz = z0; cz <= z1; cz++) {
				for (let cx = x0; cx <= x1; cx++) {
					const c = cz * side + cx
					areaColor(this.areaIds[c], px, c * 4)
					px[c * 4 + 3] = this.chunkFlags[c] & CHUNK_IMPASSABLE ? 255 : 0
				}
			}
			this.uploadRegion(renderer, this.chunkDataDirty, this.chunkDataSrc!, this.chunkDataTex, side)
			this.chunkDataDirty.clear()
		}
		if (this.chunkDataTex && this.cellDataDirty.dirty) {
			const n = this.size
			const r = this.cellDataDirty.rect
			const tex = this.cellTexture()
			const cells = tex.image.data as Uint8Array
			const ne = this.noEffect
			const x0 = r ? Math.max(0, r.x0) : 0
			const z0 = r ? Math.max(0, r.z0) : 0
			const x1 = r ? Math.min(n - 1, r.x1) : n - 1
			const z1 = r ? Math.min(n - 1, r.z1) : n - 1
			for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells[(z * n + x) * 2] = ne[z * n + x]
			this.uploadRegion(renderer, this.cellDataDirty, this.cellSrc!, tex, n)
			this.cellDataDirty.clear()
		}
		if (this.splatDirty.dirty) {
			this.uploadRegion(renderer, this.splatDirty, this.weightSrc, this.weightTex)
			// The slot table is small, and painting can rename a slot anywhere in a touched chunk.
			this.slotTex.needsUpdate = true
			this.splatDirty.clear()
		}
	}

	/**
	 * Marks the area IDs, chunk flags or no-effect cells as edited, for their overlay and the tufts.
	 * With `rect`, an inclusive rect of paint chunks (or, with `cells`, of cells), only those are
	 * redrawn in the overlay; without one all of it is.
	 */
	touchChunkData(rect?: DirtyRect | null, cells = false) {
		this.chunkDataVersion++
		// Before the overlay is first shown there is nothing to redraw: making it draws all of it.
		if (!this.chunkDataTex) return
		if (!rect) {
			this.chunkDataDirty.mark()
			this.cellDataDirty.mark()
		} else if (cells) this.cellDataDirty.mark(rect)
		else this.chunkDataDirty.mark(rect)
	}

	/**
	 * Shows the Map data overlay: 0 off, 1 the chunks' zones, 2 the impassable chunks, 3 the cells that
	 * grow no tufts. Its textures are made the first time it is shown. Cheap to call every frame.
	 */
	setMapDataOverlay(mode: number) {
		const u = this.material.uniforms
		if (u.mapDataMode.value === mode) return
		u.mapDataMode.value = mode
		if (!mode || this.chunkDataTex) return
		const side = this.paintChunksPerSide
		this.chunkDataTex = new THREE.DataTexture(new Uint8Array(side * side * 4), side, side, THREE.RGBAFormat)
		this.chunkDataTex.magFilter = this.chunkDataTex.minFilter = THREE.NearestFilter
		this.chunkDataTex.generateMipmaps = false
		u.chunkDataTex.value = this.chunkDataTex
		this.chunkDataSrc = new THREE.DataTexture(this.chunkDataTex.image.data, side, side, THREE.RGBAFormat)
		this.chunkDataDirty.mark()
		this.cellDataDirty.mark()
	}

	/** Names the zone the Map data tool paints, whose chunks the Area overlay stripes; 0 for none. Cheap to call every frame. */
	setMapDataZone(id: number) {
		if (id === this.zoneShown) return
		this.zoneShown = id
		areaColor(id, this.zoneRgb, 0)
		;(this.material.uniforms.mapDataZone.value as THREE.Vector3).set(this.zoneRgb[0] / 255, this.zoneRgb[1] / 255, this.zoneRgb[2] / 255)
	}
	private zoneShown = 0
	private zoneRgb = new Uint8Array(3)

	/** `cellTex`, made the first time the overlay or a shaped area needs it. */
	private cellTexture(): THREE.DataTexture {
		if (!this.cellTex) {
			const t = new THREE.DataTexture(new Uint8Array(this.size * this.size * 2), this.size, this.size, THREE.RGFormat, THREE.UnsignedByteType)
			t.magFilter = t.minFilter = THREE.NearestFilter
			t.generateMipmaps = false
			t.needsUpdate = true
			this.cellTex = t
			this.cellSrc = new THREE.DataTexture(t.image.data, this.size, this.size, THREE.RGFormat, THREE.UnsignedByteType)
			this.material.uniforms.cellTex.value = t
		}
		return this.cellTex
	}

	/**
	 * The selected area's shape (a byte per cell, INSIDE where selected; `areaSelection.areaShape`) for
	 * the shader's outline (selMode 3). Copied into `cellTex`'s green only when it is another array, as
	 * a new shape always is. Cheap to call every frame.
	 */
	setAreaShape(cells: Uint8Array) {
		if (cells === this.areaCells) return
		this.areaCells = cells
		const tex = this.cellTexture()
		const px = tex.image.data as Uint8Array
		for (let i = 0; i < cells.length; i++) px[i * 2 + 1] = cells[i]
		tex.needsUpdate = true
	}

	/** The heights as a float texture, one texel a vertex, kept up to date by `update`. */
	heightTexture(): THREE.DataTexture {
		if (!this.heightTex) {
			const make = () => {
				const t = new THREE.DataTexture(this.heights, this.verts, this.verts, THREE.RedFormat, THREE.FloatType)
				t.minFilter = t.magFilter = THREE.NearestFilter
				t.generateMipmaps = false
				return t
			}
			this.heightTex = make()
			this.heightTex.needsUpdate = true
			this.heightSrc = make()
		}
		return this.heightTex
	}

	/**
	 * Sets which tiles of the square are the map's (`tileMask`), or every tile for null, and redraws the
	 * ground. A mask that doesn't fit the square's tiles is taken as every tile.
	 */
	setTileMask(mask: Uint8Array | null) {
		const n = this.size / TILE_CELLS
		this.tileMask = mask && Number.isInteger(n) && mask.length === n * n && mask.includes(0) ? mask.slice() : null
		this.touchHoles()
		this.markDirty(0, 0, this.size, this.size)
	}

	/** Whether cell (cx, cz), inside the map, is on a tile left out of it (`tileMask`). */
	tileOff(cx: number, cz: number): boolean {
		const m = this.tileMask
		if (!m) return false
		const n = this.size / TILE_CELLS
		return m[Math.floor(cz / TILE_CELLS) * n + Math.floor(cx / TILE_CELLS)] === 0
	}

	/** Whether height vertex (vx, vz) touches no cell of a present tile: a vertex on the edge with a present tile is kept. */
	vertexOff(vx: number, vz: number): boolean {
		const n = this.size
		for (let cz = vz - 1; cz <= vz; cz++) {
			for (let cx = vx - 1; cx <= vx; cx++) {
				if (cx >= 0 && cz >= 0 && cx < n && cz < n && !this.tileOff(cx, cz)) return false
			}
		}
		return true
	}

	/** Whether splat texel (tx, tz) lies in a cell on a tile left out of the map. */
	texelOff(tx: number, tz: number): boolean {
		return this.tileOff(Math.floor(tx / SPLAT_PER_CELL), Math.floor(tz / SPLAT_PER_CELL))
	}

	/** Whether world position (x, z) is on the map but on a tile left out of it (`tileMask`). */
	isOff(x: number, z: number): boolean {
		if (!this.tileMask) return false
		const cx = Math.floor(x / this.cellSize)
		const cz = Math.floor(z / this.cellSize)
		if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false
		return this.tileOff(cx, cz)
	}

	/**
	 * Whether the ground under world position (x, z) is a hole: its cell's triangle there is cut, or its
	 * tile is left out of the map (`tileMask`). Outside the map counts as solid.
	 */
	isHole(x: number, z: number): boolean {
		const gx = x / this.cellSize
		const gz = z / this.cellSize
		const cx = Math.floor(gx)
		const cz = Math.floor(gz)
		if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false
		if (this.tileMask && this.tileOff(cx, cz)) return true
		const v = this.holes[cz * this.size + cx]
		return v !== 0 && triangleIsHole(v, holeTriangle(cx, cz, gx - cx, gz - cz))
	}

	/** Whether any cell of the map is a hole. */
	hasHoles(): boolean {
		return this.holes.some((v) => v !== 0)
	}

	/** Bilinear height at world position. */
	heightAt(x: number, z: number): number {
		return heightField(this.heights, this.size, this.cellSize, x, z)
	}

	contains(x: number, z: number) {
		return x >= 0 && z >= 0 && x <= this.worldSize && z <= this.worldSize
	}

	/** Scratch for `raycast`, which runs several times a frame. The y range is wide enough for any height. */
	private readonly rayBox = new THREE.Box3(new THREE.Vector3(0, -1e5, 0), new THREE.Vector3(0, 1e5, 0))
	private readonly rayHit = new THREE.Vector3()

	/**
	 * Where `ray` meets the ground, in `out`: a ray-march of the heightmap (`rayMarch.ts`), much cheaper
	 * than triangle raycasts. The ray passes through holes and keeps passing under the ground after one,
	 * so what is below a cave mouth can be picked, unless `solid` is set, which the Hole mode's Fill needs
	 * to aim at a hole.
	 */
	raycast(ray: THREE.Ray, out: THREE.Vector3, maxDist = 4000, solid = false): boolean {
		return rayMarchGround(this, this.rayBox, this.rayHit, ray, out, maxDist, solid)
	}

	/**
	 * Procedural starting terrain from a preset (see presets.ts and generate.ts), its coast following
	 * `shape`'s tiles when given, shaped by `opts` (relief, roughness, erosion; none erodes by default).
	 */
	generate(kind: GenerateKind, seed: number, shape?: CoastShape | null, opts?: Partial<ShapeOptions>) {
		generateHeights(this.heights, this.size, this.cellSize, kind, seed, shape, opts)
		this.markAllDirty()
	}

	/** The ground from a heightmap image (#745), eroded at `erosion` (0 to 1). */
	generateFromImage(g: ImageGround, erosion: number, seed: number) {
		imageGroundHeights(this.heights, this.size, this.cellSize, g, erosion, seed)
		this.markAllDirty()
	}

	/**
	 * Paint sand/grass/rock/snow based on height and slope. Role r of the procedural layers is
	 * palette entry roleTex[r]. Each paint chunk keeps the four roles that fit it best. `shores`, when
	 * given, is the lake level near each vertex (`shoreLevels`, water/lakes.ts, #759; NaN away from
	 * any): the lakes' shores take the sand as the sea's do.
	 */
	autoPaint(waterLevel: number, waterEnabled: boolean, roleTex: number[] = [0, 1, 2, 3, 4, 5, 6, 7], shores?: Float32Array | null) {
		const R = this.splatRes
		const roles = LAYER_COUNT
		const w = new Float32Array(roles)
		let maxH = -Infinity
		for (let i = 0; i < this.heights.length; i++) maxH = Math.max(maxH, this.heights[i])
		const snowLine = snowLineOf(waterLevel, maxH)
		const packed = packRoles(this.paintChunksPerSide, R, roles, (i, j, out) => {
			const x = ((i + 0.5) / R) * this.worldSize
			const z = ((j + 0.5) / R) * this.worldSize
			const y = this.heightAt(x, z)
			const e = 0.6
			const slope = Math.hypot(this.heightAt(x + e, z) - this.heightAt(x - e, z), this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e)
			w.fill(0)
			const n = fbm(x * 0.03, z * 0.03, 3, 99)
			w[n > 0.55 ? 1 : 0] = 1
			if (n > 0.62) w[2] = 0.4
			if (waterEnabled && y < waterLevel + 1.2) {
				const t = THREE.MathUtils.clamp((waterLevel + 1.2 - y) / 1.2, 0, 1)
				w[4] += t * 3
			}
			if (shores) {
				const lake = shores[Math.round(z / this.cellSize) * this.verts + Math.round(x / this.cellSize)]
				if (y < lake + 1.2) w[4] += THREE.MathUtils.clamp((lake + 1.2 - y) / 1.2, 0, 1) * 3
			}
			if (y > snowLine) w[5] += THREE.MathUtils.clamp((y - snowLine) / 6, 0, 1) * 4
			if (slope > 0.7) w[3] += THREE.MathUtils.clamp((slope - 0.7) * 3, 0, 4)
			for (let k = 0; k < roles; k++) out[k] = w[k] * 255
		})
		this.weights.set(packed.weights)
		for (let k = 0; k < packed.chunkSlots.length; k++) {
			const role = packed.chunkSlots[k]
			this.chunkSlots[k] = role === NO_TEXTURE ? NO_TEXTURE : (roleTex[role] ?? 0)
		}
		this.markSplatDirty()
	}

	/**
	 * Sets the baked shadows from their bits (`side` texels a side, see terrain/bakedShadows.ts), which
	 * must be this terrain's `shadowSide`; null drops them (the map then has none of its own).
	 */
	setBakedShadows(bits: Uint8Array | null, side: number) {
		if (bits && side !== this.shadowSide) throw new Error(`baked shadows are ${side} texels a side, want ${this.shadowSide}`)
		this.setShadow(bits ? unpackShadowBits(bits, side) : null)
	}

	/** Sets the baked shadows to `bytes` (a byte per texel, kept), or none. */
	setShadow(bytes: Uint8Array | null) {
		if (this.disposed) return
		this.bakedTex?.dispose()
		this.bakedTex = null
		this.shadow = bytes
		if (bytes) {
			const side = this.shadowSide
			const t = new THREE.DataTexture(bytes, side, side, THREE.RedFormat, THREE.UnsignedByteType)
			t.magFilter = t.minFilter = THREE.LinearFilter
			t.generateMipmaps = false
			t.needsUpdate = true
			// Until three has uploaded it whole, a row update must not narrow that first upload.
			this.shadowUploaded = false
			t.onUpdate = () => (this.shadowUploaded = true)
			this.bakedTex = t
		}
		this.material.uniforms.bakedShadowTex.value = this.bakedTex
		this.shadowVersion++
	}

	/** The baked shadows to write into, made all lit first when the map has none. */
	ensureShadow(): Uint8Array {
		if (!this.shadow) this.setShadow(new Uint8Array(this.shadowSide * this.shadowSide))
		return this.shadow!
	}

	/** Bumped by every change of the baked shadows. */
	shadowVersion = 0
	private shadowUploaded = false

	/**
	 * After the WebGL context came back (#209): three uploads every texture again by itself, so a row
	 * update made while it was gone must not narrow that upload to the row.
	 */
	contextRestored() {
		this.bakedTex?.clearUpdateRanges()
		this.shadowUploaded = false
	}

	/** Uploads the shadow texel rows z0 to z1 (inclusive) after they were written. */
	touchShadow(z0: number, z1: number) {
		const t = this.bakedTex
		if (!t) return
		const side = this.shadowSide
		if (this.shadowUploaded) t.addUpdateRange(z0 * side, (z1 - z0 + 1) * side)
		t.needsUpdate = true
		this.shadowVersion++
	}

	/**
	 * Drapes the reference image (terrain/referenceImage.ts) over the ground: `tex` at `opacity` (0 or
	 * no texture hides it) over `place`, with corner handles `edit` world units across while it is
	 * being placed (0 for none). Cheap to call every frame; the texture is the document's, not disposed here.
	 */
	setReference(tex: THREE.Texture | null, opacity: number, place: { x: number; z: number; w: number; h: number; turn: number } | null, edit: number) {
		const u = this.material.uniforms
		u.refTex.value = tex
		u.refOpacity.value = tex && place ? opacity : 0
		u.refEdit.value = place ? edit : 0
		if (!place) return
		u.refCentre.value.set(place.x, place.z)
		u.refHalf.value.set(place.w / 2, place.h / 2)
		u.refRot.value.set(Math.cos(place.turn), Math.sin(place.turn))
	}

	/** Draws the baked shadows (when the terrain has any) or not. */
	showBakedShadows(on: boolean) {
		this.material.uniforms.bakedShadowOn.value = on && this.bakedTex ? 1 : 0
	}

	/** Set by dispose: a late shadow set (a client read that outlived its tab) then makes no texture. */
	private disposed = false

	dispose() {
		this.disposed = true
		for (const c of this.chunks) c.geometry.dispose()
		this.bakedTex?.dispose()
		this.material.dispose()
		this.weightTex.dispose()
		this.slotTex.dispose()
		this.palette.dispose()
		this.maskTex.dispose()
		this.weightSrc.dispose()
		this.maskSrc.dispose()
		this.heightTex?.dispose()
		this.heightSrc?.dispose()
		this.chunkDataTex?.dispose()
		this.chunkDataSrc?.dispose()
		this.cellTex?.dispose()
		this.cellSrc?.dispose()
	}
}
