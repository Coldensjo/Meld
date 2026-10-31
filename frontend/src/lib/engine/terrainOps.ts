// The terrain batch operations (#559): the menu commands that edit a whole map, area, tile or set of
// paint chunks as one undo step. Each takes the map's terrain, history and objects rather than reading
// the Engine, so Bun tests run them on a small Terrain; the Engine's methods pass the active
// document's, check what the editor state allows and word the status line from what these return.
import * as THREE from 'three'
import type { Command, History } from '../state/historyCore'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { TerrainStroke, paintPixel, type Rect } from '../tools/brush'
import { ShadowStroke } from '../tools/shadowStroke'
import { INSIDE } from '../terrain/areaShape'
import { countHoles, fillHoles, snapToBlocks } from '../terrain/holes'
import { fitHeights, type FitOptions } from '../terrain/fitGround'
import { SHADOW_PER_CELL } from '../terrain/bakedShadows'
import { SETTLED_FULL, settledMask } from '../terrain/erodeArea'
import { layAlphamapChunk } from '../terrain/alphamap'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, clearPalette, compactChunk, findSlot, hasEmptySlot, mergeDuplicateSlots, removeSlot, replaceInChunk, replacePalette, resetTexel } from '../terrain/chunkPaint'
import { TILE_CELLS, TILE_CHUNKS } from '../wow/format'
import { paintBiome, type BiomePaint, type BiomePaintResult } from '../terrain/biome'
import { groupTransformCommand, removedCommand } from '../world/objectCommands'

/** How many cells of level ground Fit ground keeps around a building before its ring (#210). */
export const FIT_APRON_CELLS = 2

/** The callback a heights stroke calls with the vertices it changed, so the models standing there re-snap to the ground. */
export function resnapper(t: Terrain, objects: ObjectLayer): (r: Rect) => void {
	const cs = t.cellSize
	return (r) => objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
}

/** The whole map's vertices. */
function allVerts(t: Terrain): Rect {
	return { x0: 0, z0: 0, x1: t.size, z1: t.size }
}

/** The whole map's splat texels (inclusive). */
function allTexels(t: Terrain): Rect {
	return { x0: 0, z0: 0, x1: t.splatRes - 1, z1: t.splatRes - 1 }
}

// ---------------------------------------------------------------- heights

/**
 * Replaces every height with `next` (one vertex per entry) as one undoable step. Objects on the ground
 * are re-snapped, as they are after sculpting.
 */
export function setHeights(t: Terrain, history: History, objects: ObjectLayer, next: Float32Array, label: string) {
	const resnap = resnapper(t, objects)
	const stroke = new TerrainStroke(t, label, { heights: true }, resnap)
	const whole = allVerts(t)
	stroke.reserveHeights(whole)
	t.heights.set(next)
	t.markAllDirty()
	stroke.touchHeights(whole)
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	resnap(whole)
}

/** The lowest and highest ground over the vertices of `r` (inclusive), or the whole map. */
export function heightRange(t: Terrain, r: Rect | null = null): [number, number] {
	const side = t.verts
	const x0 = r ? r.x0 : 0
	const z0 = r ? r.z0 : 0
	const x1 = r ? Math.min(side - 1, r.x1) : side - 1
	const z1 = r ? Math.min(side - 1, r.z1) : side - 1
	let lo = Infinity,
		hi = -Infinity
	for (let z = z0; z <= z1; z++) {
		for (let x = x0; x <= x1; x++) {
			const h = t.heights[z * side + x]
			lo = Math.min(lo, h)
			hi = Math.max(hi, h)
		}
	}
	return [lo, hi]
}

/**
 * Writes an eroded patch back (Terrain › Erode, #165): `work` holds the heights of the vertices of `r`
 * (inclusive, `w` by `h`) in cells, as erodePatch left them, and `weights` which of them the area
 * holds. One undo step named `label`, pushed onto `history`. With `mask` (#242) the paint mask becomes
 * where the ground settled, in the same step. Returns the most a vertex moved, in yards, and how many
 * mask texels the sediment set.
 */
export function applyErosion(t: Terrain, history: History, objects: ObjectLayer, r: Rect, w: number, h: number, work: Float32Array, weights: Float32Array, mask: boolean, label: string): { most: number; settled: number } {
	const V = t.verts
	const cs = t.cellSize
	const resnap = resnapper(t, objects)
	const stroke = new TerrainStroke(t, label, { heights: true, mask }, resnap)
	stroke.reserveHeights(r)
	let most = 0
	// With the mask, each vertex's rise in yards: where the drops left their load and scree slid to.
	const gain = mask ? work : null
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const k = z * w + x
			const i = (r.z0 + z) * V + r.x0 + x
			const d = weights[k] ? work[k] * cs - t.heights[i] : 0
			if (gain) gain[k] = d
			if (!d) continue
			if (Math.abs(d) > most) most = Math.abs(d)
			t.heights[i] += d
		}
	}
	t.markDirty(r.x0, r.z0, r.x1, r.z1)
	stroke.touchHeights(r)
	resnap(r)
	let settled = 0
	if (gain) {
		// The sediment map takes the mask's place, so Fill Mask lays a texture only where the ground settled.
		const R = t.splatRes
		const all = allTexels(t)
		stroke.reserveMask(all)
		t.mask.fill(0)
		settled = settledMask(gain, w, h, r.x0, r.z0, R / t.size, SETTLED_FULL, t.mask, R)
		stroke.touchMask(all)
		t.markMaskDirty()
	}
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return { most, settled }
}

// ---------------------------------------------------------------- paint mask

/** The bounds (inclusive texels) of the paint mask's set texels, or null when the mask is empty. */
export function maskBounds(t: Terrain): Rect | null {
	return maskBoundsOf(t.mask, t.splatRes)
}

/** The bounds (inclusive texels) of the set texels of `m`, a mask of R by R texels, or null when it is empty. */
export function maskBoundsOf(m: Uint8Array, R: number): Rect | null {
	let x0 = R,
		z0 = R,
		x1 = -1,
		z1 = -1
	for (let z = 0; z < R; z++) {
		for (let x = 0; x < R; x++) {
			if (!m[z * R + x]) continue
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			if (z > z1) z1 = z
		}
	}
	return x1 < 0 ? null : { x0, z0, x1, z1 }
}

/** The cells (end-exclusive, as the selected area) that cover the paint mask, or null when it is empty. */
export function maskCells(t: Terrain): Rect | null {
	const b = maskBounds(t)
	if (!b) return null
	const tpc = t.splatRes / t.size
	return { x0: Math.floor(b.x0 / tpc), z0: Math.floor(b.z0 / tpc), x1: Math.ceil((b.x1 + 1) / tpc), z1: Math.ceil((b.z1 + 1) / tpc) }
}

/** Sets to 255, in `m` (a mask of the map's splat texels), every texel of the area `s`, or with `shape` of its cells only. */
export function markAreaTexels(t: Terrain, s: Rect, shape: Uint8Array | null, m: Uint8Array) {
	const R = t.splatRes
	const size = t.size
	const tpc = R / size
	for (let z = s.z0 * tpc; z < s.z1 * tpc; z++) {
		for (let x = s.x0 * tpc; x < s.x1 * tpc; x++) if (!shape || shape[Math.floor(z / tpc) * size + Math.floor(x / tpc)]) m[z * R + x] = 255
	}
}

/**
 * Paints texture slot `layer` over the whole mask (soft mask edges blend) as one undo step. Returns
 * how many texels refused it (their chunk already has four textures), or null when the mask is empty.
 */
export function fillMask(t: Terrain, history: History, layer: number): number | null {
	const b = maskBounds(t)
	if (!b) return null
	const R = t.splatRes
	const m = t.mask
	const stroke = new TerrainStroke(t, 'Fill mask', { splat: true })
	stroke.reserveSplat(b)
	let refused = 0
	for (let z = b.z0; z <= b.z1; z++) {
		for (let x = b.x0; x <= b.x1; x++) {
			const p = z * R + x
			if (m[p] && !paintPixel(t, p, layer, m[p] / 255)) refused++
		}
	}
	stroke.touchSplat(b)
	t.markSplatDirty(b)
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return refused
}

/**
 * Paints a biome (terrain/biome.ts `paintBiome`) over `mask` (a value per splat texel) as one undo step
 * pushed to `history`. Returns what it painted; a mask with nothing set pushes no step.
 */
export function paintBiomeOver(t: Terrain, history: History, mask: Uint8Array, p: BiomePaint): BiomePaintResult {
	const b = maskBoundsOf(mask, t.splatRes)
	if (!b) return { chunks: 0, replaced: 0, bounds: null }
	const stroke = new TerrainStroke(t, 'Paint biome', { splat: true })
	stroke.reserveSplat(b)
	const r = paintBiome(t, mask, b, p)
	if (r.bounds) {
		stroke.touchSplat(r.bounds)
		t.markSplatDirty(r.bounds)
	}
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return r
}

// ---------------------------------------------------------------- holes

/**
 * Cuts the area `s` (cells, end-exclusive; with `shape` its cells only) out of the ground (`hole`
 * true) or fills it in again, in whole 2x2-cell blocks as the client keeps holes, as one undo step.
 * Returns how many cells changed: 0 changes nothing and pushes no step.
 */
export function cutHoles(t: Terrain, history: History, s: Rect, shape: Uint8Array | null, hole: boolean): number {
	const stroke = new TerrainStroke(t, hole ? 'Cut hole' : 'Fill hole', { holes: true })
	// The area grows out to the blocks it touches.
	const r = snapToBlocks({ x0: s.x0, z0: s.z0, x1: s.x1 - 1, z1: s.z1 - 1 }, t.size)
	stroke.reserveHoles(r)
	const n = shape ? fillShapeHoles(t.holes, t.size, shape, r, hole ? 1 : 0) : fillHoles(t.holes, t.size, r.x0, r.z0, r.x1 + 1, r.z1 + 1, hole ? 1 : 0)
	if (!n) return 0
	stroke.touchHoles(r)
	t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return n
}

/** How many cells of the area `s` (with `shape`, of its cells only) are holes. */
export function holesInArea(t: Terrain, s: Rect, shape: Uint8Array | null): number {
	if (!shape) return countHoles(t.holes, t.size, s.x0, s.z0, s.x1, s.z1)
	let n = 0
	for (let z = s.z0; z < s.z1; z++) for (let x = s.x0; x < s.x1; x++) if (shape[z * t.size + x] && t.holes[z * t.size + x]) n++
	return n
}

/** Sets (`value` 1) or clears the holes of every 2x2 block of `r` (inclusive) that has a cell of `shape`. Returns the cells changed. */
export function fillShapeHoles(holes: Uint8Array, size: number, shape: Uint8Array, r: Rect, value: 0 | 1): number {
	let n = 0
	for (let bz = r.z0; bz <= r.z1; bz += 2) {
		for (let bx = r.x0; bx <= r.x1; bx += 2) {
			let any = false
			for (let z = bz; z < Math.min(size, bz + 2) && !any; z++) for (let x = bx; x < Math.min(size, bx + 2); x++) if (shape[z * size + x] === INSIDE) any = true
			if (!any) continue
			for (let z = bz; z < Math.min(size, bz + 2); z++) {
				for (let x = bx; x < Math.min(size, bx + 2); x++) {
					if (holes[z * size + x] === value) continue
					holes[z * size + x] = value
					n++
				}
			}
		}
	}
	return n
}

// ---------------------------------------------------------------- fit ground

/**
 * Fits (or with `stamp`, stamps) the ground to the models `ids` and returns the change as one
 * command, already applied but not pushed, with how many models changed the ground and how many
 * were left out because they are still loading. Shared by Fit Ground and the Place tool's Fit ground.
 * A model on the ground keeps its place in the world: it gets its `yOff` back for the ground that
 * moved under it.
 */
export function fitGroundCommand(t: Terrain, objects: ObjectLayer, ids: number[], stamp: boolean, fit: FitOptions): { cmd: Command | null; fitted: number; loading: number } {
	const cs = t.cellSize
	const V = t.verts
	const opts: FitOptions = stamp ? { ...fit, margin: 0, mode: 'both', holes: false } : fit
	const resnap = resnapper(t, objects)
	const stroke = new TerrainStroke(t, stamp ? 'Stamp model into ground' : 'Fit ground to model', { heights: true, holes: true }, resnap)
	const box = new THREE.Box3()
	const moved: Array<{ before: WorldObject; after: WorldObject }> = []
	let fitted = 0
	let loading = 0
	for (const id of ids) {
		if (!objects.surfaceBox(id, box)) {
			loading++
			continue
		}
		// The window reaches past the apron, the ring and the cell the smoothing takes beyond it.
		const apron = stamp ? 0 : FIT_APRON_CELLS * cs
		const reach = opts.falloff + apron + cs
		const x0 = Math.max(0, Math.floor((box.min.x - reach) / cs))
		const z0 = Math.max(0, Math.floor((box.min.z - reach) / cs))
		const x1 = Math.min(t.size, Math.ceil((box.max.x + reach) / cs))
		const z1 = Math.min(t.size, Math.ceil((box.max.z + reach) / cs))
		if (x1 <= x0 || z1 <= z0) continue
		const w = x1 - x0 + 1
		const h = z1 - z0 + 1
		const ground = new Float32Array(w * h)
		const floor = new Float32Array(w * h).fill(NaN)
		const under = new Float32Array(w * h).fill(NaN)
		const from = box.min.y - 1
		let lowFloor = Infinity
		let lowUnder = Infinity
		for (let z = 0; z < h; z++) {
			for (let x = 0; x < w; x++) {
				const vx = x0 + x
				const vz = z0 + z
				ground[z * w + x] = t.heights[vz * V + vx]
				const wx = vx * cs
				const wz = vz * cs
				if (wx < box.min.x || wx > box.max.x || wz < box.min.z || wz > box.max.z) continue
				const u = objects.surfaceAt(id, wx, wz, false, from)
				under[z * w + x] = u
				if (u < lowUnder) lowUnder = u
				if (stamp) continue
				const f = objects.surfaceAt(id, wx, wz, true, from)
				floor[z * w + x] = f
				if (f < lowFloor) lowFloor = f
			}
		}
		if (stamp) {
			// Stamp: the ground takes the underside's shape, both ways.
			floor.set(under)
		} else {
			// A floor or underside counts only near the model's lowest one (#208), whatever the ground
			// does under it: a stable's hayloft and a roof's eaves are far above them, a floor raised on
			// a foundation is not.
			for (let i = 0; i < floor.length; i++) {
				if (floor[i] > lowFloor + fit.reach) floor[i] = NaN
				if (under[i] > lowUnder + fit.reach) under[i] = NaN
			}
		}
		// A fit levels the ground to the model's base and keeps an apron level around it (#210); a
		// stamp takes the underside's shape and blends straight out. The base is the origin, raised by
		// the depth a model on the ground was sunk to (a negative height, from the Place tool's PgDn or
		// the Inspector), so a farmhouse's stone footing sunk 2 yd stays 2 yd underground.
		const o = objects.objects.get(id)!
		const sunk = o.parent === undefined ? Math.max(0, -o.yOff) : 0
		const base = stamp ? NaN : objects.worldPlacement(o).pos.y + sunk
		const r = fitHeights(ground, floor, under, w, h, x0, z0, cs, opts, base, apron)
		if (!r.changed) continue
		fitted++
		// The models on the ground under this one would ride the ground: note where each stood.
		const before = o.parent === undefined ? t.heightAt(o.x, o.z) : 0
		const rect = { x0, z0, x1, z1 }
		stroke.reserveHeights(rect)
		for (let z = 0; z < h; z++) t.heights.set(r.heights.subarray(z * w, z * w + w), (z0 + z) * V + x0)
		stroke.touchHeights(rect)
		t.markDirty(x0, z0, x1, z1)
		if (r.holes.some((v) => v)) {
			const cr = { x0, z0, x1: x1 - 1, z1: z1 - 1 }
			stroke.reserveHoles(cr)
			for (let z = 0; z < h - 1; z++) for (let x = 0; x < w - 1; x++) if (r.holes[z * (w - 1) + x]) t.holes[(z0 + z) * t.size + x0 + x] = 1
			stroke.touchHoles(cr)
		}
		if (o.parent === undefined) {
			const dy = before - t.heightAt(o.x, o.z)
			if (dy !== 0) {
				const prev = { ...o }
				o.yOff += dy
				objects.touch(o.id)
				moved.push({ before: prev, after: { ...o } })
			}
		}
	}
	const terrainCmd = stroke.finish()
	if (!terrainCmd) return { cmd: null, fitted, loading }
	resnap(allVerts(t))
	const moves = moved.length
		? groupTransformCommand(
				objects,
				moved.map((m) => m.before),
				moved.map((m) => m.after),
			)
		: null
	return {
		cmd: {
			label: terrainCmd.label,
			undo: () => {
				moves?.undo()
				terrainCmd.undo()
			},
			redo: () => {
				terrainCmd.redo()
				moves?.redo()
			},
		},
		fitted,
		loading,
	}
}

// ---------------------------------------------------------------- baked shadows

/** The area `s` (cells, end-exclusive) as shadow texels (inclusive), or the whole map without one. */
export function shadowRect(t: Terrain, s: Rect | null): Rect {
	const n = SHADOW_PER_CELL
	if (s && s.x1 > s.x0 && s.z1 > s.z0) return { x0: s.x0 * n, z0: s.z0 * n, x1: s.x1 * n - 1, z1: s.z1 * n - 1 }
	return { x0: 0, z0: 0, x1: t.shadowSide - 1, z1: t.shadowSide - 1 }
}

/**
 * Lights the baked shadow texels of `r` (inclusive; with `shape`, of its cells only) as one undo step
 * named `label`. Returns null when the map has no baked shadows, else whether anything changed.
 */
export function clearShadowRect(t: Terrain, history: History, r: Rect, shape: Uint8Array | null, label: string): boolean | null {
	if (!t.shadow) return null
	const stroke = new ShadowStroke(t, label)
	stroke.reserve(r)
	const data = t.shadow
	const side = t.shadowSide
	const n = SHADOW_PER_CELL
	for (let z = r.z0; z <= r.z1; z++) {
		if (!shape) {
			data.fill(0, z * side + r.x0, z * side + r.x1 + 1)
			continue
		}
		// A free-form area: only the texels of its cells.
		for (let x = r.x0; x <= r.x1; x++) if (shape[Math.floor(z / n) * t.size + Math.floor(x / n)]) data[z * side + x] = 0
	}
	stroke.touch(r)
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return cmd !== null
}

/** A copy of the shadow texels of the inclusive rect `r`, row by row. */
export function shadowTexels(data: Uint8Array, side: number, r: Rect): Uint8Array {
	const w = r.x1 - r.x0 + 1
	const out = new Uint8Array(w * (r.z1 - r.z0 + 1))
	for (let z = r.z0; z <= r.z1; z++) out.set(data.subarray(z * side + r.x0, z * side + r.x1 + 1), (z - r.z0) * w)
	return out
}

/**
 * Puts back, from `kept` (shadowTexels' copy of `r`), every texel of `r` outside the cells of `shape`
 * (`perCell` texels a cell side). Returns how many texels inside the shape differ from `kept`.
 */
export function restoreOutsideShape(data: Uint8Array, side: number, r: Rect, kept: Uint8Array, shape: Uint8Array, size: number, perCell: number): number {
	const w = r.x1 - r.x0 + 1
	let changed = 0
	for (let z = r.z0; z <= r.z1; z++) {
		for (let x = r.x0; x <= r.x1; x++) {
			const before = kept[(z - r.z0) * w + (x - r.x0)]
			const i = z * side + x
			if (!shape[Math.floor(z / perCell) * size + Math.floor(x / perCell)]) data[i] = before
			else if (data[i] !== before) changed++
		}
	}
	return changed
}

// ---------------------------------------------------------------- models

/** What makes two models duplicates: their type, place, turn, size and parent, the numbers to a hundredth. */
export function duplicateKey(o: WorldObject): string {
	return [o.type, o.x, o.z, o.yOff, o.rotY, o.scale, o.parent ?? ''].map((v) => (typeof v === 'number' ? Math.round(v * 100) : v)).join('|')
}

/** The models of `objs` that stand exactly where an earlier one of the same type stands (duplicateKey). */
export function duplicateModels(objs: Iterable<WorldObject>): WorldObject[] {
	const seen = new Set<string>()
	const dupes: WorldObject[] = []
	for (const o of objs) {
		const key = duplicateKey(o)
		if (seen.has(key)) dupes.push(o)
		else seen.add(key)
	}
	return dupes
}

/** Removes `gone` as one undo step, labelled `label` when given. */
export function removeModels(objects: ObjectLayer, history: History, gone: WorldObject[], label?: string) {
	const cmd = removedCommand(objects, gone)
	if (label) cmd.label = label
	cmd.redo()
	history.push(cmd)
}

// ---------------------------------------------------------------- client tiles

/** A client tile of the map: its index and its first vertex. */
export interface MapTile {
	tx: number
	tz: number
	x0: number
	z0: number
	cells: number
}

/** The client tile at world (x, z), or null off the map. */
export function tileAt(t: Terrain, x: number, z: number): MapTile | null {
	const tiles = Math.max(1, Math.round(t.size / TILE_CELLS))
	const tx = Math.floor(x / (TILE_CELLS * t.cellSize))
	const tz = Math.floor(z / (TILE_CELLS * t.cellSize))
	if (tx < 0 || tz < 0 || tx >= tiles || tz >= tiles) return null
	return { tx, tz, x0: tx * TILE_CELLS, z0: tz * TILE_CELLS, cells: TILE_CELLS }
}

/** The vertices of tile (tx, tz), inclusive. */
export function tileVerts(t: Terrain, tx: number, tz: number): Rect {
	return { x0: tx * TILE_CELLS, z0: tz * TILE_CELLS, x1: Math.min(t.size, (tx + 1) * TILE_CELLS), z1: Math.min(t.size, (tz + 1) * TILE_CELLS) }
}

/** The models standing on tile (tx, tz) that are not attached to another. */
export function tileRoots(t: Terrain, objects: ObjectLayer, tx: number, tz: number): WorldObject[] {
	const yards = TILE_CELLS * t.cellSize
	const x0 = tx * yards,
		z0 = tz * yards
	return [...objects.objects.values()].filter((o) => o.parent === undefined && o.x >= x0 && o.x < x0 + yards && o.z >= z0 && o.z < z0 + yards)
}

/** `roots` with everything attached to them. */
export function withDescendants(objects: ObjectLayer, roots: WorldObject[]): WorldObject[] {
	const ids = new Set<number>()
	for (const o of roots) {
		ids.add(o.id)
		for (const d of objects.descendantIds(o.id)) ids.add(d)
	}
	return [...ids].map((id) => objects.objects.get(id)!).filter(Boolean)
}

/** Sets the ground of tile (tx, tz) to height 0, as one undo step named `label`. */
export function clearTileHeights(t: Terrain, history: History, objects: ObjectLayer, tx: number, tz: number, label: string) {
	const r = tileVerts(t, tx, tz)
	const resnap = resnapper(t, objects)
	const stroke = new TerrainStroke(t, label, { heights: true }, resnap)
	stroke.reserveHeights(r)
	for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) t.heights[z * t.verts + x] = 0
	t.markDirty(r.x0, r.z0, r.x1, r.z1)
	stroke.touchHeights(r)
	const yards = TILE_CELLS * t.cellSize
	objects.markRegionDirty(tx * yards, tz * yards, (tx + 1) * yards, (tz + 1) * yards)
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
}

/** The shadow texels of tile (tx, tz), inclusive. */
export function tileShadowRect(tx: number, tz: number): Rect {
	const n = TILE_CELLS * SHADOW_PER_CELL
	return { x0: tx * n, z0: tz * n, x1: (tx + 1) * n - 1, z1: (tz + 1) * n - 1 }
}

/** The paint chunks of tile (tx, tz). */
export function tileChunks(t: Terrain, tx: number, tz: number): number[] {
	const side = t.paintChunksPerSide
	const chunks: number[] = []
	for (let cz = tz * TILE_CHUNKS; cz < (tz + 1) * TILE_CHUNKS && cz < side; cz++) {
		for (let cx = tx * TILE_CHUNKS; cx < (tx + 1) * TILE_CHUNKS && cx < side; cx++) chunks.push(cz * side + cx)
	}
	return chunks
}

// ---------------------------------------------------------------- paint chunks

/** Every paint chunk of the map. */
export function allChunks(t: Terrain): number[] {
	const side = t.paintChunksPerSide
	return Array.from({ length: side * side }, (_, c) => c)
}

/** The paint chunks the area `s` (cells, end-exclusive; with `shape`, its cells only) touches. */
export function chunksInArea(t: Terrain, s: Rect, shape: Uint8Array | null): number[] {
	if (s.x1 <= s.x0 || s.z1 <= s.z0) return []
	const side = t.paintChunksPerSide
	const cx0 = Math.max(0, Math.floor(s.x0 / CHUNK_CELLS))
	const cz0 = Math.max(0, Math.floor(s.z0 / CHUNK_CELLS))
	const cx1 = Math.min(side - 1, Math.floor((s.x1 - 1) / CHUNK_CELLS))
	const cz1 = Math.min(side - 1, Math.floor((s.z1 - 1) / CHUNK_CELLS))
	const out: number[] = []
	for (let cz = cz0; cz <= cz1; cz++) {
		for (let cx = cx0; cx <= cx1; cx++) if (!shape || chunkInShape(shape, t.size, cx, cz)) out.push(cz * side + cx)
	}
	return out
}

/** Whether paint chunk (cx, cz) has a cell of `shape`. */
export function chunkInShape(shape: Uint8Array, size: number, cx: number, cz: number): boolean {
	for (let z = cz * CHUNK_CELLS; z < Math.min(size, (cz + 1) * CHUNK_CELLS); z++) {
		for (let x = cx * CHUNK_CELLS; x < Math.min(size, (cx + 1) * CHUNK_CELLS); x++) if (shape[z * size + x]) return true
	}
	return false
}

/** Edits the splat of each chunk in `chunks` through `edit(c)` and returns the step, applied but not pushed, for a caller that adds to it. */
export function chunkStroke(t: Terrain, label: string, chunks: number[], edit: (c: number) => void): Command | null {
	const side = t.paintChunksPerSide
	const per = t.splatRes / side
	const stroke = new TerrainStroke(t, label, { splat: true })
	for (const c of chunks) {
		if (c < 0 || c >= side * side) continue
		const x0 = (c % side) * per
		const z0 = Math.floor(c / side) * per
		const rect = { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
		stroke.reserveSplat(rect)
		edit(c)
		stroke.touchSplat(rect)
		t.markSplatDirty(rect)
	}
	return stroke.finish()
}

/** Edits the splat of each chunk in `chunks` through `edit(c)`, as one undo step named `label`. */
export function editChunks(t: Terrain, history: History, label: string, chunks: number[], edit: (c: number) => void) {
	const cmd = chunkStroke(t, label, chunks, edit)
	if (cmd) history.push(cmd)
}

/** Calls `fn` with the weights offset of every splat texel of chunk `c`. */
function forChunkTexels(t: Terrain, c: number, fn: (o: number) => void) {
	const side = t.paintChunksPerSide
	const per = t.splatRes / side
	const px = (c % side) * per,
		pz = Math.floor(c / side) * per
	for (let z = pz; z < pz + per; z++) for (let x = px; x < px + per; x++) fn((z * t.splatRes + x) * SLOTS)
}

/** Puts each of `chunks` back to its base texture alone (Clean up › Clear textures), as one undo step. */
export function clearChunkTextures(t: Terrain, history: History, chunks: number[], label: string) {
	editChunks(t, history, label, chunks, (c) => forChunkTexels(t, c, (o) => resetTexel(t.weights, o, 1)))
}

/** Makes each of `chunks` palette texture `tex` alone, as its base (Clean up › Set base), as one undo step. */
export function setChunkBase(t: Terrain, history: History, chunks: number[], tex: number, label: string) {
	editChunks(t, history, label, chunks, (c) => {
		t.chunkSlots[c * SLOTS] = tex
		for (let k = 1; k < SLOTS; k++) t.chunkSlots[c * SLOTS + k] = NO_TEXTURE
		forChunkTexels(t, c, (o) => {
			t.weights[o] = 255
			t.weights[o + 1] = t.weights[o + 2] = t.weights[o + 3] = 0
		})
	})
}

/** Whether chunk `c` holds a texture in two of its slots. */
function hasDuplicateSlot(t: Terrain, c: number): boolean {
	const s = t.chunkSlots.subarray(c * SLOTS, c * SLOTS + SLOTS)
	return s.some((tex, k) => tex !== NO_TEXTURE && s.indexOf(tex) !== k)
}

/**
 * Merges the duplicate texture layers of `chunks` (Clean up › Remove texture duplicates) as one undo
 * step. Returns how many layers merged; 0 pushes no step.
 */
export function mergeChunkDuplicates(t: Terrain, history: History, chunks: number[], label: string): number {
	const dupes = chunks.filter((c) => hasDuplicateSlot(t, c))
	if (!dupes.length) return 0
	let merged = 0
	editChunks(t, history, label, dupes, (c) => (merged += mergeDuplicateSlots(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c)))
	return merged
}

/**
 * Frees the texture layers of `scope` whose weight is 0 everywhere in their chunk, as one undo step.
 * Returns how many chunks and layers it freed; no chunks pushes no step.
 */
export function removeEmptyLayers(t: Terrain, history: History, scope: number[]): { chunks: number; layers: number } {
	const side = t.paintChunksPerSide
	const chunks = scope.filter((c) => hasEmptySlot(side, t.splatRes, t.chunkSlots, t.weights, c))
	if (!chunks.length) return { chunks: 0, layers: 0 }
	let layers = 0
	editChunks(t, history, `Remove empty layers in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`, chunks, (c) => {
		for (let k = 0; k < SLOTS; k++) if (t.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) layers++
		compactChunk(side, t.splatRes, t.chunkSlots, t.weights, c)
		for (let k = 0; k < SLOTS; k++) if (t.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) layers--
	})
	return { chunks: chunks.length, layers }
}

/** Replaces palette texture `tex` with palette texture `index` in `chunks` only, as one undo step. */
export function replaceTextureInChunks(t: Terrain, history: History, chunks: number[], tex: number, index: number) {
	editChunks(t, history, chunks.length === 1 ? 'Replace texture here' : `Replace texture in ${chunks.length} chunks`, chunks, (c) => {
		const slot = findSlot(t.chunkSlots, c, tex)
		if (slot >= 0) replaceInChunk(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, slot, index)
	})
}

/** Removes palette texture `tex` from `chunks`, as one undo step: its layer there is empty afterwards. */
export function deleteTextureInChunks(t: Terrain, history: History, chunks: number[], tex: number) {
	editChunks(t, history, chunks.length === 1 ? 'Delete texture here' : `Delete texture in ${chunks.length} chunks`, chunks, (c) => {
		const slot = findSlot(t.chunkSlots, c, tex)
		if (slot >= 0) removeSlot(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, slot)
	})
}

/** Empties every layer of `chunks`, so they have no textures at all, as one undo step. */
export function clearChunks(t: Terrain, history: History, chunks: number[]) {
	editChunks(t, history, chunks.length === 1 ? 'Delete all textures here' : `Delete all textures in ${chunks.length} chunks`, chunks, (c) => {
		for (let k = SLOTS - 1; k >= 0; k--) removeSlot(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, k)
	})
}

/**
 * Lays an alphamap (splatRes squared values, 0 to 1) into palette texture `tex` over the whole map as
 * one undo step named `label` (terrain/alphamap.ts). Returns how many chunks refused it for want of a free slot.
 */
export function importAlphamap(t: Terrain, history: History, tex: number, values: Float32Array, label: string): number {
	let refused = 0
	editChunks(t, history, label, allChunks(t), (c) => {
		if (layAlphamapChunk(t, c, tex, values)) refused++
	})
	return refused
}

/** Runs `fn` on the whole map's splat as one undo step named `label`. */
function editWholeSplat(t: Terrain, history: History, label: string, fn: () => void) {
	const all = allTexels(t)
	const stroke = new TerrainStroke(t, label, { splat: true })
	stroke.reserveSplat(all)
	fn()
	stroke.touchSplat(all)
	t.markSplatDirty()
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
}

/** Replaces palette texture `from` with `to` across the whole map, as one undo step. */
export function swapTexture(t: Terrain, history: History, from: number, to: number) {
	editWholeSplat(t, history, 'Replace texture', () => replacePalette(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, from, to))
}

/** Makes the whole map one texture, `to`, as one undo step. */
export function fillTextures(t: Terrain, history: History, to: number) {
	editWholeSplat(t, history, 'Fill map with texture', () => clearPalette(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, to))
}

/** Paints the map again by height and slope (Terrain.autoPaint) for the sea at `waterLevel`, as one undo step. */
export function regenerateAutoPaint(t: Terrain, history: History, waterLevel: number, waterEnabled: boolean) {
	const before = { w: t.weights.slice(), s: t.chunkSlots.slice() }
	t.autoPaint(waterLevel, waterEnabled)
	const after = { w: t.weights.slice(), s: t.chunkSlots.slice() }
	const apply = (s: typeof before) => {
		t.weights.set(s.w)
		t.chunkSlots.set(s.s)
		t.markSplatDirty()
	}
	history.push({ label: 'Auto paint', undo: () => apply(before), redo: () => apply(after) })
}
