import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from './ObjectLayer'
import type { Command } from '../state/history'
import { addedCommand } from './objectCommands'
import { TerrainStroke, type Rect } from '../tools/brush'
import { LiquidStroke } from '../water/liquidStroke'
import { ChunkDataStroke } from '../tools/chunkDataStroke'
import { copyChunkData, pasteChunkData } from './clipChunkData'
import { copyShadows, pasteShadows } from './clipShadows'
import { ShadowStroke } from '../tools/shadowStroke'
import { pastedHeight, type PasteHeightMode } from './pasteHeight'
import { copyLiquidCells, pasteLiquidCells, type LiquidClip, type LiquidMap } from '../water/liquids'
import { insideDistance } from '../terrain/areaShape'
import { pasteLandings, type Landing } from './pasteLanding'
import { CHUNK_CELLS, MAX_PALETTE, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, acquireSlot, chunkOf, normalizeTexel, paletteIndex } from '../terrain/chunkPaint'

/** A rectangular piece of a map, copied for pasting into any open map. */
export interface MapClip {
	/** Size in cells. */
	w: number
	h: number
	/** (w+1)*(h+1) vertex heights. */
	heights: Float32Array
	/** w*h cells: 1 where the ground is a hole. */
	holes: Uint8Array
	/** Splat texels (SPLAT_PER_CELL per cell): SLOTS weights per texel. */
	weights: Uint8Array
	/** SLOTS indices into `palette` per texel (NO_TEXTURE where the slot is empty). */
	slots: Uint8Array
	/** The textures the clip uses, indexed as in `slots`. Copied with the clip, so paste works across maps. */
	palette: string[]
	/**
	 * Objects: roots have positions relative to the clip's corner; attached
	 * objects keep their local transform and reference their parent by `cid`.
	 */
	objects: Array<Omit<WorldObject, 'id' | 'parent'> & { cid: number; cparent?: number }>
	/** The painted liquid of the area, cell by cell (absent in a clip made before liquids were copied). */
	liquids?: LiquidClip
	/**
	 * The chunk data under each of the w*h cells: the zone and flags of the chunk the cell is in, and
	 * the cell's no-tuft byte (absent in a clip made before they were copied).
	 */
	chunkData?: { areas: Uint32Array; flags: Uint8Array; noEffect: Uint8Array }
	/**
	 * The baked shadows under the area, w*8 by h*8 texels (world/clipShadows.ts); absent when the map
	 * had none of its own, or in a clip made before they were copied.
	 */
	shadows?: Uint8Array
	/**
	 * A free-form area's shape (#183): w*h cells, 1 where the area is. A paste lays only these cells (and
	 * the corners of their ground) and fades from the shape's edge; absent, the whole rect.
	 */
	cells?: Uint8Array
}

export interface PasteOptions {
	terrain: boolean
	textures: boolean
	objects: boolean
	/** Cells over which the pasted edge fades into the existing map (0 = hard). */
	blend: number
	heightOffset: number
	/** How the heights meet the map's; `set` when absent. */
	heightMode?: PasteHeightMode
}

export type { PasteHeightMode }

/** A copied object: roots relative to the clip's anchor, attached ones in their parent's local space. */
export type ClipObject = MapClip['objects'][number]

/** Copied models only (no ground), for pasting at the cursor. */
export interface ObjectClip {
	objects: ClipObject[]
}

/**
 * Encodes `picked` for a clip whose anchor is world (ax, az): an object attached to another picked
 * object keeps its local transform; the rest become roots with positions relative to the anchor
 * and their height above the ground.
 */
function encodeObjects(terrain: Terrain, objects: ObjectLayer, picked: WorldObject[], ax: number, az: number): ClipObject[] {
	const ids = new Set(picked.map((o) => o.id))
	return picked.map((o) => {
		if (o.parent !== undefined && ids.has(o.parent)) {
			const { id, parent, ...rest } = o
			return { ...rest, cid: id, cparent: parent }
		}
		const w = objects.worldPlacement(o)
		return {
			type: o.type,
			cid: o.id,
			x: w.pos.x - ax,
			z: w.pos.z - az,
			yOff: w.pos.y - terrain.heightAt(w.pos.x, w.pos.z),
			rotY: w.rot,
			tiltX: o.tiltX,
			tiltZ: o.tiltZ,
			scale: w.scale,
		}
	})
}

/**
 * Adds the clip's objects with the anchor at world (ax, az), parents before children, and returns
 * them. A root that would land outside the map is left out, as is anything attached to it. With
 * `landings`, a root that lands on a model is attached to it, its height above the ground now above
 * that model's surface.
 */
function decodeObjects(terrain: Terrain, objects: ObjectLayer, list: readonly ClipObject[], ax: number, az: number, landings?: Map<number, Landing>): WorldObject[] {
	const added: WorldObject[] = []
	const idMap = new Map<number, number>()
	// Pasted models form groups of their own, apart from the ones they were copied from.
	const groups = new Map<number, number>()
	const group = (g: number | undefined) => {
		if (!g) return undefined
		let n = groups.get(g)
		if (n === undefined) groups.set(g, (n = objects.newGroup()))
		return n
	}
	let pending = [...list]
	for (let pass = 0; pass < 8 && pending.length; pass++) {
		const next: typeof pending = []
		for (const o of pending) {
			const { cid, cparent, ...rest } = o
			if (cparent === undefined) {
				const x = o.x + ax
				const z = o.z + az
				if (!terrain.contains(x, z)) continue
				const n = objects.add({ ...rest, x, z, group: group(rest.group) })
				const land = landings?.get(cid)
				if (land && land.parent !== null) objects.place(n, land.parent, { pos: new THREE.Vector3(x, land.y + rest.yOff, z), rot: rest.rotY, scale: rest.scale })
				idMap.set(cid, n.id)
				added.push(n)
			} else if (idMap.has(cparent)) {
				const n = objects.add({ ...rest, parent: idMap.get(cparent), group: group(rest.group) })
				idMap.set(cid, n.id)
				added.push(n)
			} else {
				next.push(o)
			}
		}
		if (next.length === pending.length) break
		pending = next
	}
	return added
}

/** Copies `picked` with the anchor at the middle of their world positions. */
export function copyObjects(terrain: Terrain, objects: ObjectLayer, picked: WorldObject[]): ObjectClip {
	const tmp = new THREE.Vector3()
	let ax = 0
	let az = 0
	for (const o of picked) {
		const p = objects.worldPosition(o, tmp)
		ax += p.x
		az += p.z
	}
	ax /= Math.max(1, picked.length)
	az /= Math.max(1, picked.length)
	return { objects: encodeObjects(terrain, objects, picked, ax, az) }
}

/**
 * Pastes an object clip with its anchor at world (x, z). With `onModels` (the anchor is on a model,
 * #191), each root stands on the model under it, attached to it. Returns the new objects and one
 * undoable command, or null when nothing landed on the map.
 */
export function pasteObjects(terrain: Terrain, objects: ObjectLayer, clip: ObjectClip, x: number, z: number, onModels = false): { added: WorldObject[]; cmd: Command } | null {
	const landings = onModels ? pasteLandings(objects, terrain, clip.objects, x, z) : undefined
	const added = decodeObjects(terrain, objects, clip.objects, x, z, landings)
	if (!added.length) return null
	return { added, cmd: addedCommand(objects, added, added.length === 1 ? 'Paste model' : `Paste ${added.length} models`) }
}

/** A stand-in colour for a clip texture that isn't in the palette it came from. */
const MISSING = '#808080'

/** Splat texels per paint chunk along one side. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

/**
 * Copy the cell rect (inclusive vertex corners x0..x1, z0..z1), with its painted liquid when `liquids` is
 * given. With `inside` (the rect's cells, 1 in), the clip is that shape: only the models and liquid on its
 * cells come along, and a paste lays only them.
 */
export function copyRegion(terrain: Terrain, objects: ObjectLayer, r: Rect, palette: readonly string[], liquids?: LiquidMap, inside?: Uint8Array): MapClip {
	const w = r.x1 - r.x0
	const h = r.z1 - r.z0
	const V = terrain.verts
	const heights = new Float32Array((w + 1) * (h + 1))
	for (let z = 0; z <= h; z++) {
		for (let x = 0; x <= w; x++) heights[z * (w + 1) + x] = terrain.heights[(r.z0 + z) * V + r.x0 + x]
	}
	const holes = new Uint8Array(w * h)
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) holes[z * w + x] = terrain.holes[(r.z0 + z) * terrain.size + r.x0 + x]
	}

	// Texels keep their own slots, which index a palette local to the clip, so the clip doesn't
	// depend on the map it came from.
	const T = SPLAT_PER_CELL
	const R = terrain.splatRes
	const side = terrain.paintChunksPerSide
	const tw = w * T
	const th = h * T
	const weights = new Uint8Array(tw * th * SLOTS)
	const slots = new Uint8Array(tw * th * SLOTS).fill(NO_TEXTURE)
	const clipPalette: string[] = []
	const localOf = new Map<number, number>()
	for (let z = 0; z < th; z++) {
		const gz = r.z0 * T + z
		for (let x = 0; x < tw; x++) {
			const gx = r.x0 * T + x
			const texel = gz * R + gx
			const chunk = chunkOf(Math.floor(gx / TEXELS_PER_CHUNK), Math.floor(gz / TEXELS_PER_CHUNK), side)
			for (let k = 0; k < SLOTS; k++) {
				const global = terrain.chunkSlots[chunk * SLOTS + k]
				const wt = terrain.weights[texel * SLOTS + k]
				if (global === NO_TEXTURE || wt === 0) continue
				let local = localOf.get(global)
				if (local === undefined) {
					local = clipPalette.length
					localOf.set(global, local)
					clipPalette.push(palette[global] ?? MISSING)
				}
				const i = (z * tw + x) * SLOTS + k
				slots[i] = local
				weights[i] = wt
			}
		}
	}

	const cs = terrain.cellSize
	const ox = r.x0 * cs
	const oz = r.z0 * cs
	const tmp = new THREE.Vector3()
	const picked = objects.list().filter((o) => {
		const p = objects.worldPosition(o, tmp)
		if (!(p.x >= ox && p.x <= r.x1 * cs && p.z >= oz && p.z <= r.z1 * cs)) return false
		if (!inside) return true
		const cx = Math.min(w - 1, Math.floor((p.x - ox) / cs))
		const cz = Math.min(h - 1, Math.floor((p.z - oz) / cs))
		return !!inside[cz * w + cx]
	})
	const clip: MapClip = { w, h, heights, holes, weights, slots, palette: clipPalette, objects: encodeObjects(terrain, objects, picked, ox, oz), chunkData: copyChunkData(terrain, r) }
	if (inside) clip.cells = inside
	if (liquids) {
		clip.liquids = copyLiquidCells(liquids, r)
		if (inside) clip.liquids.cells = clip.liquids.cells.filter((c) => inside[c.z * w + c.x])
	}
	const shadows = copyShadows(terrain, r)
	if (shadows) clip.shadows = shadows
	return clip
}

/** Edge fade factor for a point `d` cells from the nearest pasted edge. */
const fade = (d: number, blend: number) => (blend <= 0 ? 1 : Math.min(1, Math.max(0, d / blend)))

/**
 * Paste `clip` with its corner at cell (px, pz), clipped to the map. Mutates
 * the terrain, objects and palette, and returns one undoable command.
 *
 * Textures merge into the target: a clip texture the map lacks is added to the palette (while there
 * is room), and each texel blends into the chunk's four slots. A texel whose texture can't fit in its
 * chunk keeps the chunk's own textures for that part.
 */
export function pasteRegion(
	terrain: Terrain,
	objects: ObjectLayer,
	currentPalette: readonly string[],
	/** Writes the map's palette (looked up at call time, so undo stays correct across tab switches). */
	setPalette: (t: string[]) => void,
	clip: MapClip,
	px: number,
	pz: number,
	opts: PasteOptions,
	onHeights: (r: Rect) => void,
	/** The map's liquids: the clip's painted liquid lands in them with the ground. */
	liquids?: LiquidMap,
): Command | null {
	const stroke = new TerrainStroke(terrain, 'Paste', { heights: opts.terrain, splat: opts.textures, holes: opts.terrain }, onHeights)
	let liquidCmd: Command | null = null
	// The chunks' zones, flags and no-tuft cells come along with the ground.
	let chunkCmd: Command | null = null
	if (opts.terrain && clip.chunkData) {
		const cs = new ChunkDataStroke(terrain, 'Paste')
		pasteChunkData(terrain, clip, px, pz, cs)
		chunkCmd = cs.finish()
	}
	// The baked shadows come along with the ground too.
	let shadowCmd: Command | null = null
	if (opts.terrain && clip.shadows) {
		const ss = new ShadowStroke(terrain, 'Paste')
		pasteShadows(terrain, clip.shadows, clip.w, clip.h, px, pz, ss, clip.cells)
		shadowCmd = ss.finish()
	}
	if (opts.terrain && liquids && clip.liquids) {
		const ls = new LiquidStroke(liquids, 'Paste')
		pasteLiquidCells(liquids, clip.liquids, px, pz, ls.reserve, clip.cells)
		liquidCmd = ls.finish()
	}
	const V = terrain.verts
	const size = terrain.size
	// A free-form clip: how far each of its cells is from the shape's edge, which the blend fades over.
	const shape = clip.cells
	const dist = shape ? insideDistance(shape, clip.w, clip.h) : null
	/** For a free-form clip, a corner's distance from the shape's edge: -1 when no cell of the shape touches it. */
	const cornerDist = (cx: number, cz: number) => {
		let d = -1
		for (let dz = -1; dz <= 0; dz++) {
			for (let dx = -1; dx <= 0; dx++) {
				const x = cx + dx
				const z = cz + dz
				if (x < 0 || z < 0 || x >= clip.w || z >= clip.h || !shape![z * clip.w + x]) continue
				d = Math.max(d, dist![z * clip.w + x] - 0.5)
			}
		}
		return d
	}

	if (opts.terrain) {
		const x0 = Math.max(0, px)
		const z0 = Math.max(0, pz)
		const x1 = Math.min(size, px + clip.w)
		const z1 = Math.min(size, pz + clip.h)
		if (x1 >= x0 && z1 >= z0) {
			stroke.reserveHeights({ x0, z0, x1, z1 })
			const mode = opts.heightMode ?? 'set'
			let clipLow = Infinity
			if (mode === 'add' || mode === 'subtract') for (const v of clip.heights) clipLow = Math.min(clipLow, v)
			for (let z = z0; z <= z1; z++) {
				for (let x = x0; x <= x1; x++) {
					const cx = x - px
					const cz = z - pz
					let d = Math.min(cx, cz, clip.w - cx, clip.h - cz)
					if (shape) {
						d = cornerDist(cx, cz)
						if (d < 0) continue
					}
					const f = fade(d, opts.blend)
					const i = z * V + x
					const target = pastedHeight(mode, terrain.heights[i], clip.heights[cz * (clip.w + 1) + cx], clipLow, opts.heightOffset)
					terrain.heights[i] += (target - terrain.heights[i]) * f
				}
			}
			const r = { x0, z0, x1, z1 }
			terrain.markDirty(x0, z0, x1, z1)
			stroke.touchHeights(r)
			onHeights(r)
			// Holes come along with the ground, cell for cell (the edge blend doesn't apply to them).
			const cx1 = Math.min(size - 1, px + clip.w - 1)
			const cz1 = Math.min(size - 1, pz + clip.h - 1)
			if (cx1 >= x0 && cz1 >= z0) {
				stroke.reserveHoles({ x0, z0, x1: cx1, z1: cz1 })
				for (let z = z0; z <= cz1; z++) {
					for (let x = x0; x <= cx1; x++) {
						const i = (z - pz) * clip.w + (x - px)
						if (!shape || shape[i]) terrain.holes[z * size + x] = clip.holes[i]
					}
				}
				stroke.touchHoles({ x0, z0, x1: cx1, z1: cz1 })
			}
		}
	}

	const paletteBefore = [...currentPalette]
	const palette = [...currentPalette]
	// The palette index a clip texture paints with in this map, adding it if there's room.
	const indexOf = (path: string): number => {
		const i = paletteIndex(palette, path)
		if (i >= 0) return i
		if (palette.length >= MAX_PALETTE) return -1
		palette.push(path)
		return palette.length - 1
	}
	const clipIndex = new Map<number, number>()

	if (opts.textures) {
		const T = SPLAT_PER_CELL
		const R = terrain.splatRes
		const side = terrain.paintChunksPerSide
		const tw = clip.w * T
		const th = clip.h * T
		const tx0 = px * T
		const tz0 = pz * T
		const cur: Array<[number, number]> = []
		const src: Array<[number, number]> = []
		const mix = new Map<number, number>()
		const w4 = new Float32Array(SLOTS)
		let rect: Rect | null = null
		stroke.reserveSplat({ x0: Math.max(0, tx0), z0: Math.max(0, tz0), x1: Math.min(R - 1, tx0 + tw - 1), z1: Math.min(R - 1, tz0 + th - 1) })
		for (let z = 0; z < th; z++) {
			const gz = tz0 + z
			if (gz < 0 || gz >= R) continue
			for (let x = 0; x < tw; x++) {
				const gx = tx0 + x
				if (gx < 0 || gx >= R) continue
				let d = Math.min(x + 0.5, z + 0.5, tw - x - 0.5, th - z - 0.5) / T
				if (shape) {
					const cell = Math.floor(z / T) * clip.w + Math.floor(x / T)
					if (!shape[cell]) continue
					d = dist![cell]
				}
				const f = fade(d, opts.blend)
				const texel = gz * R + gx
				const chunk = chunkOf(Math.floor(gx / TEXELS_PER_CHUNK), Math.floor(gz / TEXELS_PER_CHUNK), side)

				// The texel's current mix, and the clip's mix, as palette index and weight pairs.
				cur.length = 0
				src.length = 0
				for (let k = 0; k < SLOTS; k++) {
					const g = terrain.chunkSlots[chunk * SLOTS + k]
					if (g !== NO_TEXTURE) cur.push([g, terrain.weights[texel * SLOTS + k]])
				}
				const sp = (z * tw + x) * SLOTS
				for (let k = 0; k < SLOTS; k++) {
					const local = clip.slots[sp + k]
					const wt = clip.weights[sp + k]
					if (local === NO_TEXTURE || wt === 0) continue
					let g = clipIndex.get(local)
					if (g === undefined) {
						g = indexOf(clip.palette[local])
						clipIndex.set(local, g)
					}
					if (g >= 0) src.push([g, wt])
				}
				if (src.length === 0) continue

				mix.clear()
				for (const [g, wt] of cur) mix.set(g, (mix.get(g) ?? 0) + wt * (1 - f))
				for (const [g, wt] of src) mix.set(g, (mix.get(g) ?? 0) + wt * f)

				// Fit the mix into the chunk's slots. A texture the chunk can't take is dropped.
				w4.fill(0)
				let sum = 0
				for (const [g, wt] of mix) {
					if (wt <= 0) continue
					const k = acquireSlot(terrain.chunkSlots, chunk, g)
					if (k < 0) continue
					w4[k] += wt
					sum += wt
				}
				if (sum <= 0) continue
				const dp = texel * SLOTS
				for (let k = 0; k < SLOTS; k++) terrain.weights[dp + k] = Math.round((w4[k] * 255) / sum)
				normalizeTexel(terrain.weights, dp)

				if (!rect) rect = { x0: gx, z0: gz, x1: gx, z1: gz }
				else {
					rect.x0 = Math.min(rect.x0, gx)
					rect.z0 = Math.min(rect.z0, gz)
					rect.x1 = Math.max(rect.x1, gx)
					rect.z1 = Math.max(rect.z1, gz)
				}
			}
		}
		if (rect) {
			terrain.markSplatDirty(rect)
			stroke.touchSplat(rect)
		}
	}
	const paletteChanged = paletteBefore.length !== palette.length || paletteBefore.some((p, i) => p !== palette[i])
	if (paletteChanged) setPalette(palette)

	const cs = terrain.cellSize
	const added = opts.objects ? decodeObjects(terrain, objects, clip.objects, px * cs, pz * cs) : []

	const terrainCmd = stroke.finish()
	if (!terrainCmd && !liquidCmd && !chunkCmd && !shadowCmd && !added.length && !paletteChanged) return null
	const objectsCmd = added.length ? addedCommand(objects, added, 'Paste') : null
	return {
		label: 'Paste',
		bytes: (terrainCmd?.bytes ?? 0) + (liquidCmd?.bytes ?? 0) + (chunkCmd?.bytes ?? 0) + (shadowCmd?.bytes ?? 0),
		undo: () => {
			terrainCmd?.undo()
			liquidCmd?.undo()
			chunkCmd?.undo()
			shadowCmd?.undo()
			objectsCmd?.undo()
			if (paletteChanged) setPalette(paletteBefore)
		},
		redo: () => {
			terrainCmd?.redo()
			liquidCmd?.redo()
			chunkCmd?.redo()
			shadowCmd?.redo()
			objectsCmd?.redo()
			if (paletteChanged) setPalette(palette)
		},
	}
}
