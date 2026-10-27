import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import { TerrainStroke } from '../tools/brush'
import { groupTransformCommand } from '../tools/ObjectTools'
import { addedCommand, removedCommand } from '../world/objectCommands'
import { clampScale } from '../world/placement'
import type { ScriptHost, ScriptImage, ScriptModel } from '../script/scriptApi'
import { CHUNK_CELLS, MAX_PALETTE, NO_TEXTURE, SLOTS, paletteIndex, removeSlot } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { fillHoles, snapToBlocks } from '../terrain/holes'
import { ChunkDataStroke } from '../tools/chunkDataStroke'
import { autoOpacity, newLiquidBrush, paintLiquid, type LiquidMap } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'

// The script API's host for the active map (#28): what a Lua script reads and writes of its terrain and
// models, with every change gathered into one undo step (`finish`). Rotations cross as Noggit Red gives
// them, in degrees: y the file's yaw (the editor's turn plus 90, as adt.EditorTurn reads it), x and z the
// tilts. Chunks, texture layers, holes, zones and water (#760) go into the same step: a chunk's layers
// are its paint slots that hold a texture, in order, the first the base, as Noggit Red's texture layers.

/** What the host reads of the editor besides the map's terrain and models. */
export interface ScriptView {
	print(text: string): void
	camera(): { x: number; y: number; z: number; pitch: number; yaw: number }
	target(): { x: number; y: number; z: number }
	mapId: number
	areaAt(x: number, z: number): number
	/** The Select tool's area as a vertex rect, or null. */
	area: { x0: number; z0: number; x1: number; z1: number } | null
	/** Reads a PNG for load_png (io/scriptFiles.ts). */
	loadImage(path: string): Promise<ScriptImage | string>
	/** The map's texture palette (editor.palette), and setting it (a new entry at the end). */
	palette(): readonly string[]
	setPalette(p: string[]): void
	/** The ground effect ID palette texture `tex` grows in paint chunk `chunk`, as the export writes it. */
	effect(tex: number, chunk: number): number
}

const DEG = 180 / Math.PI

/** The client path a model type names: `m2:World\x.m2` and `wmo:World\x.wmo?set=1` give `World\x...`. */
function fileOf(type: string): string {
	return type.slice(type.indexOf(':') + 1).replace(/\?set=\d+$/, '')
}

const isModel = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')

export class EngineScriptHost implements ScriptHost {
	private stroke: TerrainStroke
	private heightsChanged = false
	/** Models the script added that are still there. */
	private added = new Set<number>()
	/** The map's own models the script moved, turned or scaled, as they were before. */
	private before = new Map<number, WorldObject>()
	/** The map's own models the script removed, as they were when removed (attached ones with them). */
	private removed = new Map<number, WorldObject>()
	private pos = new THREE.Vector3()
	/** Whether the script changed the paint, the holes, the chunks' zones and flags, or the palette. */
	private groundChanged = false
	private chunkData: ChunkDataStroke | null = null
	private water: LiquidStroke | null = null
	private paletteBefore: string[] | null = null

	constructor(
		private ground: Terrain,
		private objects: ObjectLayer,
		private liquids: LiquidMap,
		private view: ScriptView,
		private label: string,
	) {
		const cs = ground.cellSize
		// settle: false keeps a layer add_texture added before anything is painted on it.
		this.stroke = new TerrainStroke(ground, label, { heights: true, splat: true, holes: true, settle: false }, (q) => objects.markRegionDirty(q.x0 * cs, q.z0 * cs, q.x1 * cs, q.z1 * cs))
	}

	print(text: string) {
		this.view.print(text)
	}

	terrain() {
		return { verts: this.ground.verts, cell: this.ground.cellSize, tex: this.ground.splatRes }
	}

	heights(x0: number, z0: number, x1: number, z1: number): number[] {
		const t = this.ground
		const V = t.verts
		const out: number[] = []
		for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(t.heights[z * V + x])
		return out
	}

	setHeights(x0: number, z0: number, w: number, h: number, hs: number[]) {
		const t = this.ground
		const V = t.verts
		const r = { x0: Math.max(0, x0), z0: Math.max(0, z0), x1: Math.min(V - 1, x0 + w - 1), z1: Math.min(V - 1, z0 + h - 1) }
		if (r.x0 > r.x1 || r.z0 > r.z1) return
		this.stroke.reserveHeights(r)
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				const v = hs[(z - z0) * w + x - x0]
				if (Number.isFinite(v)) t.heights[z * V + x] = v
			}
		}
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		this.stroke.touchHeights(r)
		const cs = t.cellSize
		this.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		this.heightsChanged = true
	}

	/** The model as the script sees it. */
	private model(o: WorldObject): ScriptModel {
		const w = this.objects.worldPlacement(o)
		return {
			id: o.id,
			file: fileOf(o.type),
			x: w.pos.x,
			y: w.pos.y,
			z: w.pos.z,
			rx: (o.tiltX ?? 0) * DEG,
			ry: w.rot * DEG + 90,
			rz: (o.tiltZ ?? 0) * DEG,
			scale: w.scale,
		}
	}

	models(x0: number, z0: number, x1: number, z1: number): ScriptModel[] {
		const out: ScriptModel[] = []
		for (const o of this.objects.list()) {
			if (!isModel(o.type)) continue
			const p = this.objects.worldPosition(o, this.pos)
			if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(this.model(o))
		}
		return out
	}

	/** Puts `o` at a world placement, in degrees as the script gives it, keeping what it hangs on. */
	private put(o: WorldObject, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) {
		this.objects.place(o, o.parent ?? null, { pos: new THREE.Vector3(x, y, z), rot: (ry - 90) / DEG, scale: clampScale(scale) })
		if (rx) o.tiltX = rx / DEG
		else delete o.tiltX
		if (rz) o.tiltZ = rz / DEG
		else delete o.tiltZ
		this.objects.touch(o.id)
	}

	addModel(kind: 'm2' | 'wmo', file: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number): ScriptModel | string {
		const path = file.replace(/\//g, '\\').replace(/\.md[xl]$/i, '.m2')
		const ext = kind === 'wmo' ? '.wmo' : '.m2'
		if (!path.toLowerCase().endsWith(ext)) return `add_${kind}: ${file} is not a ${ext} file`
		if (![x, y, z, rx, ry, rz, scale].every(Number.isFinite)) return `add_${kind}: the position, turn and scale must be numbers`
		if (!this.ground.contains(x, z)) return `add_${kind}: (${x.toFixed(1)}, ${z.toFixed(1)}) is off the map`
		const o = this.objects.add({ type: `${kind}:${path}`, x, z, yOff: 0, rotY: 0, scale: 1 })
		this.put(o, x, y, z, rx, ry, rz, scale)
		this.added.add(o.id)
		return this.model(o)
	}

	setModel(id: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) {
		const o = this.objects.objects.get(id)
		if (!o || ![x, y, z, rx, ry, rz, scale].every(Number.isFinite)) return
		if (!this.added.has(id) && !this.before.has(id)) this.before.set(id, { ...o })
		this.put(o, x, y, z, rx, ry, rz, scale)
	}

	removeModel(id: number) {
		if (!this.objects.objects.has(id)) return
		for (const d of this.objects.descendantIds(id)) {
			const o = this.objects.objects.get(d)
			if (!o) continue
			if (this.added.has(d)) this.added.delete(d)
			else this.removed.set(d, { ...o })
			this.objects.remove(d)
		}
	}

	replaceModel(id: number, file: string): ScriptModel | string {
		const o = this.objects.objects.get(id)
		if (!o) return 'replace: the model is gone'
		const m = this.model(o)
		const kind = /\.wmo$/i.test(file) ? 'wmo' : 'm2'
		const added = this.addModel(kind, file, m.x, m.y, m.z, m.rx, m.ry, m.rz, m.scale)
		if (typeof added !== 'string') this.removeModel(id)
		return added
	}

	// ---- Chunks and texture layers (#760) ----

	/** Whether `c` is a paint chunk of the map. */
	private isChunk(c: number): boolean {
		const side = this.ground.paintChunksPerSide
		return Number.isInteger(c) && c >= 0 && c < side * side
	}

	/** The slots of chunk c that hold a texture, in order: its layers. */
	private layers(c: number): number[] {
		const s = this.ground.chunkSlots
		const out: number[] = []
		for (let k = 0; k < SLOTS; k++) if (s[c * SLOTS + k] !== NO_TEXTURE) out.push(k)
		return out
	}

	/** Chunk c's texel rect (inclusive). */
	private chunkTexels(c: number) {
		const t = this.ground
		const side = t.paintChunksPerSide
		const per = t.splatRes / side
		const x0 = (c % side) * per
		const z0 = Math.floor(c / side) * per
		return { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
	}

	/** Moves chunk c's layers down to its first slots, keeping their order and weights, so a new one goes on top. */
	private packChunk(c: number) {
		const t = this.ground
		const L = this.layers(c)
		if (L.every((k, i) => k === i)) return
		const r = this.chunkTexels(c)
		const R = t.splatRes
		const w = t.weights
		const tmp = new Uint8Array(SLOTS)
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				const b = (z * R + x) * SLOTS
				tmp.fill(0)
				let sum = 0
				L.forEach((k, i) => {
					tmp[i] = w[b + k]
					sum += w[b + k]
				})
				// Weight parked in an empty slot (removeSlot leaves the last one's in slot 0) goes to the base.
				if (L.length && sum < 255) tmp[0] += 255 - sum
				w.set(tmp, b)
			}
		}
		const slots = L.map((k) => t.chunkSlots[c * SLOTS + k])
		for (let i = 0; i < SLOTS; i++) t.chunkSlots[c * SLOTS + i] = i < slots.length ? slots[i] : NO_TEXTURE
	}

	/** Says chunk c's paint changed (after `stroke.reserveSplat` of it). */
	private touchChunk(c: number) {
		const r = this.chunkTexels(c)
		this.stroke.touchSplat(r)
		this.ground.markSplatDirty(r)
		this.groundChanged = true
	}

	chunkTextures(c: number): string[] {
		if (!this.isChunk(c)) return []
		const palette = this.view.palette()
		return this.layers(c).map((k) => palette[this.ground.chunkSlots[c * SLOTS + k]] ?? '')
	}

	chunkAddTexture(c: number, file: string): number | string {
		if (!this.isChunk(c)) return 'add_texture: no such chunk'
		const path = file.replace(/\//g, '\\')
		if (!/\.blp$/i.test(path)) return `add_texture: ${file} is not a .blp texture`
		const palette = this.view.palette()
		let tex = paletteIndex(palette, path)
		const L = this.layers(c)
		if (tex >= 0) {
			// A chunk holds a texture once in Meld: adding it again gives the layer it has.
			const have = L.findIndex((k) => this.ground.chunkSlots[c * SLOTS + k] === tex)
			if (have >= 0) return have
		}
		if (L.length >= SLOTS) return -1
		if (tex < 0) {
			if (palette.length >= MAX_PALETTE) return `add_texture: the map's texture palette is full (${MAX_PALETTE} textures)`
			this.paletteBefore ??= [...palette]
			this.view.setPalette([...palette, path])
			tex = palette.length
		}
		const t = this.ground
		this.stroke.reserveSplat(this.chunkTexels(c))
		this.packChunk(c)
		t.chunkSlots[c * SLOTS + L.length] = tex
		if (L.length === 0) {
			// A chunk's first texture covers it, as the base layer does.
			const r = this.chunkTexels(c)
			for (let z = r.z0; z <= r.z1; z++) {
				for (let x = r.x0; x <= r.x1; x++) {
					const b = (z * t.splatRes + x) * SLOTS
					t.weights.fill(0, b, b + SLOTS)
					t.weights[b] = 255
				}
			}
		}
		this.touchChunk(c)
		return L.length
	}

	chunkRemoveTexture(c: number, layer: number) {
		if (!this.isChunk(c)) return
		const L = this.layers(c)
		if (!(layer >= 0 && layer < L.length)) return
		const t = this.ground
		const r = this.chunkTexels(c)
		this.stroke.reserveSplat(r)
		// Each texel's weight in it goes to its strongest other layer. Not removeSlot: that also drops the
		// chunk's unpainted layers, which a script keeps.
		const slot = L[layer]
		const rest = L.filter((k) => k !== slot)
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				const b = (z * t.splatRes + x) * SLOTS
				const w = t.weights[b + slot]
				t.weights[b + slot] = 0
				if (!w || !rest.length) continue
				let to = rest[0]
				for (const k of rest) if (t.weights[b + k] > t.weights[b + to]) to = k
				t.weights[b + to] += w
			}
		}
		t.chunkSlots[c * SLOTS + slot] = NO_TEXTURE
		this.packChunk(c)
		this.touchChunk(c)
	}

	chunkClearTextures(c: number) {
		if (!this.isChunk(c) || !this.layers(c).length) return
		const t = this.ground
		this.stroke.reserveSplat(this.chunkTexels(c))
		for (let k = SLOTS - 1; k >= 0; k--) removeSlot(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, k)
		this.touchChunk(c)
	}

	chunkEffect(c: number, layer: number): number {
		if (!this.isChunk(c)) return 0
		const L = this.layers(c)
		if (!(layer >= 0 && layer < L.length)) return 0
		return this.view.effect(this.ground.chunkSlots[c * SLOTS + L[layer]], c)
	}

	/** Makes the cells of a rect (inclusive) holes or ground. */
	private fillCells(r: { x0: number; z0: number; x1: number; z1: number }, hole: boolean) {
		const t = this.ground
		this.stroke.reserveHoles(r)
		if (!fillHoles(t.holes, t.size, r.x0, r.z0, r.x1 + 1, r.z1 + 1, hole ? 1 : 0)) return
		this.stroke.touchHoles(r)
		// The chunk rebuild runs off vertices; a cell's far corner is one past it.
		t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
		this.groundChanged = true
	}

	chunkSetHole(c: number, hole: boolean) {
		if (!this.isChunk(c)) return
		const side = this.ground.paintChunksPerSide
		const x0 = (c % side) * CHUNK_CELLS
		const z0 = Math.floor(c / side) * CHUNK_CELLS
		this.fillCells({ x0, z0, x1: x0 + CHUNK_CELLS - 1, z1: z0 + CHUNK_CELLS - 1 }, hole)
	}

	setHole(vx: number, vz: number, hole: boolean) {
		const n = this.ground.size
		if (!(vx >= 0 && vz >= 0 && vx <= n && vz <= n)) return
		// The hole block (2 by 2 cells, as a 1.12 tile keeps holes) of the cell the vertex is the first corner of.
		const cx = Math.min(n - 1, Math.floor(vx))
		const cz = Math.min(n - 1, Math.floor(vz))
		this.fillCells(snapToBlocks({ x0: cx, z0: cz, x1: cx, z1: cz }, n), hole)
	}

	chunkArea(c: number): number {
		return this.isChunk(c) ? this.ground.areaIds[c] : 0
	}

	/** Chunk c as a chunk rect, its zone and flags about to change. */
	private chunkRect(c: number) {
		this.chunkData ??= new ChunkDataStroke(this.ground, this.label)
		const side = this.ground.paintChunksPerSide
		return { x0: c % side, z0: Math.floor(c / side), x1: c % side, z1: Math.floor(c / side) }
	}

	chunkSetArea(c: number, id: number) {
		if (!this.isChunk(c) || !Number.isFinite(id) || id < 0) return
		const r = this.chunkRect(c)
		this.ground.areaIds[c] = id >>> 0
		this.ground.touchChunkData(r)
		this.groundChanged = true
	}

	chunkSetImpassable(c: number, on: boolean) {
		if (!this.isChunk(c)) return
		const r = this.chunkRect(c)
		const f = this.ground.chunkFlags
		f[c] = on ? f[c] | CHUNK_IMPASSABLE : f[c] & ~CHUNK_IMPASSABLE
		this.ground.touchChunkData(r)
		this.groundChanged = true
	}

	alphas(x0: number, z0: number, x1: number, z1: number): number[] {
		const t = this.ground
		const R = t.splatRes
		const per = R / t.paintChunksPerSide
		const out: number[] = []
		let last = -1
		let L: number[] = []
		for (let z = z0; z <= z1; z++) {
			for (let x = x0; x <= x1; x++) {
				if (x < 0 || z < 0 || x >= R || z >= R) {
					out.push(0, 0, 0, 0)
					continue
				}
				const c = Math.floor(z / per) * t.paintChunksPerSide + Math.floor(x / per)
				if (c !== last) {
					last = c
					L = this.layers(c)
				}
				const b = (z * R + x) * SLOTS
				// One texture covers its chunk whatever its weight says.
				for (let i = 0; i < SLOTS; i++) out.push(L.length === 1 ? (i === 0 ? 1 : 0) : i < L.length ? t.weights[b + L[i]] / 255 : 0)
			}
		}
		return out
	}

	setAlphas(x0: number, z0: number, w: number, h: number, a: number[]) {
		const t = this.ground
		const R = t.splatRes
		const per = R / t.paintChunksPerSide
		const r = { x0: Math.max(0, x0), z0: Math.max(0, z0), x1: Math.min(R - 1, x0 + w - 1), z1: Math.min(R - 1, z0 + h - 1) }
		if (r.x0 > r.x1 || r.z0 > r.z1) return
		this.stroke.reserveSplat(r)
		let last = -1
		let L: number[] = []
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				const c = Math.floor(z / per) * t.paintChunksPerSide + Math.floor(x / per)
				if (c !== last) {
					last = c
					L = this.layers(c)
				}
				// A chunk with one texture (or none) has no alpha to set, as in Noggit Red.
				if (L.length < 2) continue
				const b = (z * R + x) * SLOTS
				const at = ((z - z0) * w + x - x0) * SLOTS
				// The layers above the base keep their alphas, in order, while they fit; the base takes the rest.
				let total = 0
				for (let i = 1; i < L.length; i++) {
					const v = a[at + i]
					let byte = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v * 255))) : t.weights[b + L[i]]
					if (total + byte > 255) byte = 255 - total
					total += byte
					t.weights[b + L[i]] = byte
				}
				t.weights[b + L[0]] = 255 - total
			}
		}
		this.stroke.touchSplat(r)
		t.markSplatDirty(r)
		this.groundChanged = true
	}

	setWater(vx: number, vz: number, type: number, height: number) {
		const t = this.ground
		if (!(vx >= 0 && vz >= 0 && vx <= t.size && vz <= t.size) || !Number.isFinite(height)) return
		this.water ??= new LiquidStroke(this.liquids, this.label)
		const b = newLiquidBrush()
		const id = Math.floor(type)
		b.x = vx * t.cellSize
		b.z = vz * t.cellSize
		b.y = height
		b.radius = 1
		b.add = id > 0
		b.id = id > 0 ? id : 1
		// As Noggit Red's set_water: the surface locked at the height, over whatever liquid is there.
		b.lock = true
		b.origin = { x: b.x, y: height, z: b.z }
		b.overrideHeight = true
		b.overrideId = true
		b.opacity = autoOpacity(b.id)
		paintLiquid(this.liquids, t, b, this.water.reserve)
	}

	camera() {
		return this.view.camera()
	}

	target() {
		return this.view.target()
	}

	mapId() {
		return this.view.mapId
	}

	areaId(x: number, z: number) {
		return this.view.areaAt(x, z)
	}

	area() {
		const a = this.view.area
		const cs = this.ground.cellSize
		return a ? { x0: a.x0 * cs, z0: a.z0 * cs, x1: a.x1 * cs, z1: a.z1 * cs } : null
	}

	loadImage(path: string): Promise<ScriptImage | string> {
		return this.view.loadImage(path)
	}

	/** Whether the script changed anything. */
	get changed(): boolean {
		return this.heightsChanged || this.groundChanged || !!this.water || this.added.size > 0 || this.before.size > 0 || this.removed.size > 0
	}

	/** Everything the run changed as one undo step (already applied), or null for nothing. */
	finish(label: string): Command | null {
		const parts: Command[] = []
		// The palette first, so undo takes its new entries away after the paint that used them.
		const pBefore = this.paletteBefore
		if (pBefore) {
			const pAfter = [...this.view.palette()]
			const view = this.view
			parts.push({ label, undo: () => view.setPalette([...pBefore]), redo: () => view.setPalette([...pAfter]) })
		}
		const terrain = this.heightsChanged || this.groundChanged ? this.stroke.finish() : null
		if (terrain) parts.push(terrain)
		const chunkData = this.chunkData?.finish()
		if (chunkData) parts.push(chunkData)
		const water = this.water?.finish()
		if (water) parts.push(water)
		const objects = this.objects
		if (this.before.size) {
			const ids = [...this.before.keys()]
			const after = ids.map((id) => this.removed.get(id) ?? objects.objects.get(id)!)
			parts.push(groupTransformCommand(objects, [...this.before.values()], after))
		}
		if (this.removed.size) parts.push(removedCommand(objects, [...this.removed.values()]))
		const added = [...this.added].map((id) => objects.objects.get(id)).filter((o): o is WorldObject => !!o)
		if (added.length) parts.push(addedCommand(objects, added, label))
		if (!parts.length) return null
		return {
			label,
			bytes: (terrain?.bytes ?? 0) + (chunkData?.bytes ?? 0) + (water?.bytes ?? 0),
			undo: () => {
				for (let i = parts.length - 1; i >= 0; i--) parts[i].undo()
			},
			redo: () => {
				for (const p of parts) p.redo()
			},
		}
	}
}
