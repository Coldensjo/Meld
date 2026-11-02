// The Biome Brush (#958): paints biomes (terrain/biome.ts) onto the map's biome map (terrain/biomeMap.ts)
// and repaints the ground from it, blending where two meet. A stroke marks the cells under the brush
// with the biome (Ctrl takes it off them, leaving their paint), repaints the chunks within the border's
// reach of them from the paint they had when the stroke began, and on release scatters the biome's
// doodad brushes over the cells it newly took, thinning to none at its border, and sets its ground
// effects as the map's own: all one undo step. The chunks where a texture had to go for the
// four-texture limit stay outlined until the next stroke.
import * as THREE from 'three'
import { editor as liveEditor, prefs, setStatus } from '../state/editor.svelte'
import { History, type Command } from '../state/history'
import { fbm } from '../engine/noise'
import { biomeLayer, biomeSeed, copyBiome, roleTextures, withoutAddedBiome, type Biome } from '../terrain/biome'
import { BiomeBlend, BiomeRepainter, MAX_MAP_BIOMES, NO_BIOME, Repaint, biomeBounds, chunksReached, readChunkPaint, writeChunkPaint, type BiomeLayer } from '../terrain/biomeMap'
import { MAX_PALETTE, SLOTS, chunkTexelRect, paletteIndex } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'
import { loadAsset } from '../models/assets'
import { BrushTool, editor } from './BrushTool'
import { TerrainStroke, type Rect } from './brush'
import type { DoodadBrushTool } from './DoodadBrushTool'
import type { ToolContext } from './Tool'
import { tileKey, withTileEffect, type ScopedEffects } from '../world/groundEffects'
import { TILE_CELLS } from '../wow/format'

/** The biome the Biome Brush and Apply Biome lay: `prefs.biome` (the map's own copy first), else the first one; null with none. */
export function brushBiome(): Biome | null {
	const name = prefs.biome
	return liveEditor.mapBiomes.find((b) => b.name === name) ?? prefs.biomes.find((b) => b.name === name) ?? prefs.biomes[0] ?? liveEditor.mapBiomes[0] ?? null
}

/** The names the Biome Brush offers: the preferences' biomes, then the map's own that they lack. */
export function biomeNames(): string[] {
	const names = prefs.biomes.map((b) => b.name)
	for (const b of liveEditor.mapBiomes) if (!names.includes(b.name)) names.push(b.name)
	return names
}

/**
 * Sets biome `b`'s ground effects (#957): as the map's own, or with its `tileEffects` for the tiles
 * `area` (cells, the far edges exclusive) touches only, pushing the step to `h`. Apply Biome and the
 * Biome Brush share it.
 */
export function setBiomeEffects(b: Biome, area: { x0: number; z0: number; x1: number; z1: number }, h: History) {
	const textures = roleTextures(b)
	const effects = Object.entries(b.effects).filter(([p, id]) => textures.includes(p) && (b.tileEffects || liveEditor.textureEffects[p] !== id))
	if (effects.length && b.tileEffects) {
		// Only for the tiles the area touches (a tile's choice comes before the map's).
		const before = structuredClone(plainScoped(liveEditor.scopedEffects))
		let next = structuredClone(before)
		for (let tz = Math.floor(area.z0 / TILE_CELLS); tz <= Math.floor((area.z1 - 1) / TILE_CELLS); tz++)
			for (let tx = Math.floor(area.x0 / TILE_CELLS); tx <= Math.floor((area.x1 - 1) / TILE_CELLS); tx++) for (const [p, id] of effects) next = withTileEffect(next, tileKey(tx, tz), p, id)
		liveEditor.scopedEffects = structuredClone(next)
		h.push({ label: 'Set ground effects of the tiles', undo: () => (liveEditor.scopedEffects = structuredClone(before)), redo: () => (liveEditor.scopedEffects = structuredClone(next)) })
	} else if (effects.length) {
		const before = { ...liveEditor.textureEffects }
		liveEditor.textureEffects = { ...before, ...Object.fromEntries(effects) }
		const after = { ...liveEditor.textureEffects }
		h.push({ label: 'Set ground effects', undo: () => (liveEditor.textureEffects = { ...before }), redo: () => (liveEditor.textureEffects = { ...after }) })
	}
}

// The scoped effects as plain JSON first: `editor`'s are a Svelte proxy, which structuredClone refuses.
const plainScoped = (s: ScopedEffects): ScopedEffects => JSON.parse(JSON.stringify(s)) as ScopedEffects

/** A step that sets `editor.palette` or `editor.mapBiomes` back and forth, writing through the editor at call time. */
function listStep<T>(label: string, set: (v: T[]) => void, before: T[], after: T[]): Command {
	return { label, undo: () => set([...before]), redo: () => set([...after]) }
}

/** Takes the biome `name` out of the map's list (`withoutAddedBiome`), leaving it where it must stay. */
export function dropAddedBiome(t: Terrain, name: string): void {
	const list = withoutAddedBiome(liveEditor.mapBiomes, t.biomeMap, name)
	if (list) liveEditor.mapBiomes = list
}

/** The step of a stroke adding the biome `biome` to the map's list: undo drops just that biome, redo appends it again where missing. */
function addBiomeStep(t: Terrain, biome: Biome): Command {
	return {
		label: 'Add biome',
		undo: () => dropAddedBiome(t, biome.name),
		redo: () => {
			if (!liveEditor.mapBiomes.some((b) => b.name === biome.name) && liveEditor.mapBiomes.length < MAX_MAP_BIOMES) liveEditor.mapBiomes = [...liveEditor.mapBiomes, copyBiome(biome)]
		},
	}
}

/**
 * Adds to the palette the textures the map's biomes paint with that it lacks, pushing the step to `h`
 * when there is one. Returns false, adding none, when the palette has no room for them.
 */
export function addBiomeTextures(biomes: readonly Biome[], h: History | null): boolean {
	const missing = [...new Set(biomes.flatMap((b) => roleTextures(b)).filter((p) => p && paletteIndex(liveEditor.palette, p) < 0))]
	if (!missing.length) return true
	if (liveEditor.palette.length + missing.length > MAX_PALETTE) return false
	const before = [...liveEditor.palette]
	liveEditor.palette = [...before, ...missing]
	h?.push(listStep('Add textures', (v) => (liveEditor.palette = v), before, [...liveEditor.palette]))
	return true
}

/** The map's biomes' paint on `t`, made on first use per biome (`id` 1-based, as the cells hold it). */
export function biomeLayers(t: Terrain, biomes: readonly Biome[]): (id: number) => BiomeLayer | null {
	const made = new Map<number, BiomeLayer | null>()
	return (id) => {
		let l = made.get(id)
		if (l === undefined) {
			const b = biomes[id - 1]
			l = b ? biomeLayer(b, t, liveEditor.palette, liveEditor.waterLevel, liveEditor.waterEnabled) : null
			made.set(id, l)
		}
		return l
	}
}

/**
 * Paint › Repaint Biomes (#958): repaints every chunk a biome reaches from the biome map, with the map's
 * biomes as they are now, over a border `border` yards wide, as one step pushed to `history`. Returns
 * the chunks it painted and those where a texture had to go.
 */
export function repaintBiomeMap(t: Terrain, history: History, biomes: readonly Biome[], border: number): { chunks: number; replaced: number[] } {
	const out = { chunks: 0, replaced: [] as number[] }
	const bounds = biomeBounds(t.biomeMap, t.size)
	if (!bounds) return out
	const stroke = new TerrainStroke(t, 'Repaint biomes', { splat: true })
	const blend = new BiomeBlend(t.size, t.splatRes, border / t.cellSize)
	const painter = new BiomeRepainter(t, blend, biomeLayers(t, biomes))
	const per = t.splatRes / t.paintChunksPerSide
	const w = new Uint8Array(per * per * SLOTS)
	const s = new Uint8Array(SLOTS)
	// Compared with no biome anywhere, every texel a biome reaches is repainted; the rest keeps its paint.
	const none = new Uint8Array(t.size * t.size)
	for (const c of chunksReached(t.size, t.paintChunksPerSide, bounds, blend.reach, [])) {
		const { x0, z0 } = chunkTexelRect(t.paintChunksPerSide, t.splatRes, c)
		const rect = { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
		readChunkPaint(t, c, w, s)
		stroke.reserveSplat(rect)
		const r = painter.chunk(c, none, w, s)
		if (r === Repaint.Same) continue
		out.chunks++
		if (r === Repaint.Replaced) out.replaced.push(c)
		stroke.touchSplat(rect)
		t.markSplatDirty(rect)
	}
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
	return out
}

/** The chunks a stroke left outlined: where a texture had to go for the four-texture limit. */
class ChunkOutline {
	readonly line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff8a3d, depthTest: false, transparent: true, opacity: 0.9 }))
	terrain: Terrain | null = null

	constructor() {
		this.line.renderOrder = 30
		this.line.frustumCulled = false
		this.line.visible = false
	}

	/** Outlines chunks `chunks` of `t` over its ground; none hides it. */
	set(t: Terrain, chunks: Iterable<number>) {
		const list = [...chunks]
		this.terrain = list.length ? t : null
		this.line.visible = list.length > 0
		if (!list.length) return
		const side = t.paintChunksPerSide
		const n = t.size / side
		const yards = n * t.cellSize
		const pos = new Float32Array(list.length * 4 * n * 6)
		let o = 0
		const put = (x: number, z: number) => {
			pos[o++] = x
			pos[o++] = t.heightAt(x, z) + 0.6
			pos[o++] = z
		}
		for (const c of list) {
			const wx = (c % side) * yards
			const wz = Math.floor(c / side) * yards
			for (let k = 0; k < n; k++) {
				const a = (k / n) * yards
				const b = ((k + 1) / n) * yards
				put(wx + a, wz)
				put(wx + b, wz)
				put(wx + a, wz + yards)
				put(wx + b, wz + yards)
				put(wx, wz + a)
				put(wx, wz + b)
				put(wx + yards, wz + a)
				put(wx + yards, wz + b)
			}
		}
		this.line.geometry.dispose()
		this.line.geometry = new THREE.BufferGeometry()
		this.line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	}

	clear() {
		this.terrain = null
		this.line.visible = false
	}

	dispose() {
		this.line.geometry.dispose()
		this.line.material.dispose()
	}
}

/** A stroke's state: the biome, the map as it began, and the old paint of each chunk it repainted. */
interface BiomeStroke {
	terrain: Terrain
	biome: Biome | null
	/** The biome's cell value, or NO_BIOME while erasing. */
	id: number
	before: Uint8Array
	/** The cells it changed (inclusive), or null. */
	cells: Rect | null
	blend: BiomeBlend
	painter: BiomeRepainter
	bases: Map<number, { w: Uint8Array; s: Uint8Array }>
	replaced: Set<number>
	/** The palette and the map's biomes before the stroke added to them, null where it added nothing. */
	palette: string[] | null
	biomes: Biome[] | null
}

export interface BiomeBrushDeps {
	/** The Doodad Brush tool, whose fill scatters a biome's brushes. */
	doodads: DoodadBrushTool
}

export class BiomeBrushTool extends BrushTool {
	protected label = 'Biome brush'
	protected records = { splat: true }
	private s: BiomeStroke | null = null
	private outline = new ChunkOutline()
	private chunkList: number[] = []
	/** The biome (and its scatter list) whose models were last asked for, so a change of biome loads the new one's. */
	private preloaded: Biome | null = null
	private preloadedScatter: Biome['scatter'] | null = null

	constructor(private deps: BiomeBrushDeps) {
		super()
	}

	activate(ctx: ToolContext) {
		ctx.scene.add(this.outline.line)
	}

	deactivate(ctx: ToolContext) {
		this.outline.clear()
		ctx.scene.remove(this.outline.line)
	}

	dispose() {
		this.outline.dispose()
	}

	frame(ctx: ToolContext) {
		if (this.outline.terrain && this.outline.terrain !== ctx.terrain) this.outline.clear()
		// The biome's models load ahead of the stroke that scatters them, since the spacing reads their size.
		const b = brushBiome()
		if (b !== this.preloaded || (b && b.scatter !== this.preloadedScatter)) {
			this.preloaded = b
			this.preloadedScatter = b?.scatter ?? null
			for (const t of this.modelTypes(b)) void this.load(t)
		}
	}

	/** The model types loaded (or failed) since the tool was made: a stroke scatters at once only when its brushes' are all in. */
	private loaded = new Set<string>()

	private load(type: string): Promise<unknown> {
		return loadAsset(type)
			.catch(() => null)
			.finally(() => this.loaded.add(type))
	}

	private modelTypes(b: Biome | null): string[] {
		return b && prefs.biomeScatter ? [...new Set(b.scatter.flatMap((s) => s.brush.entries.map((e) => e.type)))] : []
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		if (!hit) return
		const t = ctx.terrain
		const erase = !!e?.ctrlKey
		const pick = brushBiome()
		if (!pick && !erase) {
			setStatus('Make a biome first in Paint › Biomes…, then paint it with the Biome Brush.', 6000)
			return
		}
		const biomesBefore = liveEditor.mapBiomes
		let index = pick ? biomesBefore.findIndex((b) => b.name === pick.name) : -1
		if (!erase && index < 0) {
			if (biomesBefore.length >= MAX_MAP_BIOMES) {
				setStatus(`This map already holds ${MAX_MAP_BIOMES} biomes, the most it can.`, 6000)
				return
			}
			liveEditor.mapBiomes = [...biomesBefore, copyBiome(pick!)]
			index = biomesBefore.length
		}
		const biome = index >= 0 ? liveEditor.mapBiomes[index] : null
		const undoLists = () => {
			if (liveEditor.mapBiomes !== biomesBefore) liveEditor.mapBiomes = biomesBefore
		}
		if (!erase && !roleTextures(biome!)[0]) {
			undoLists()
			setStatus(`The biome "${biome!.name}" has no base texture. Give it one in Paint › Biomes….`, 6000)
			return
		}
		const paletteBefore = liveEditor.palette
		if (!addBiomeTextures(liveEditor.mapBiomes, null)) {
			undoLists()
			setStatus(`This map's texture palette has no room for the biomes' textures (${MAX_PALETTE} at most).`, 6000)
			return
		}
		const blend = new BiomeBlend(t.size, t.splatRes, Math.max(0, prefs.biomeBorder) / t.cellSize)
		this.s = {
			terrain: t,
			biome,
			id: erase ? NO_BIOME : index + 1,
			before: t.biomeMap.slice(),
			cells: null,
			blend,
			painter: new BiomeRepainter(t, blend, biomeLayers(t, liveEditor.mapBiomes)),
			bases: new Map(),
			replaced: new Set(),
			palette: liveEditor.palette !== paletteBefore ? [...paletteBefore] : null,
			biomes: liveEditor.mapBiomes !== biomesBefore ? biomesBefore : null,
		}
		this.label = erase ? 'Erase biome' : `Paint biome "${biome!.name}"`
		this.outline.clear()
		super.onDown(ctx, hit)
	}

	protected apply(_ctx: ToolContext, _dt: number, hit: THREE.Vector3) {
		const s = this.s
		if (!s || !this.stroke) return
		const t = s.terrain
		const S = t.size
		const cs = t.cellSize
		const r = editor.brush.radius
		const square = editor.brush.shape === 'square'
		const cx0 = Math.max(0, Math.floor((hit.x - r) / cs))
		const cz0 = Math.max(0, Math.floor((hit.z - r) / cs))
		const cx1 = Math.min(S - 1, Math.floor((hit.x + r) / cs))
		const cz1 = Math.min(S - 1, Math.floor((hit.z + r) / cs))
		let changed: Rect | null = null
		for (let z = cz0; z <= cz1; z++) {
			for (let x = cx0; x <= cx1; x++) {
				const dx = (x + 0.5) * cs - hit.x
				const dz = (z + 0.5) * cs - hit.z
				if (square ? Math.max(Math.abs(dx), Math.abs(dz)) > r : dx * dx + dz * dz > r * r) continue
				const i = z * S + x
				if (t.biomeMap[i] === s.id || t.tileOff(x, z)) continue
				t.biomeMap[i] = s.id
				if (!changed) changed = { x0: x, z0: z, x1: x, z1: z }
				else {
					changed.x0 = Math.min(changed.x0, x)
					changed.x1 = Math.max(changed.x1, x)
					changed.z0 = Math.min(changed.z0, z)
					changed.z1 = Math.max(changed.z1, z)
				}
			}
		}
		if (!changed) return
		// For a shared session (#1036): the cells go out as the map data's do.
		t.touchBiomeMap(changed)
		s.cells = s.cells ? { x0: Math.min(s.cells.x0, changed.x0), z0: Math.min(s.cells.z0, changed.z0), x1: Math.max(s.cells.x1, changed.x1), z1: Math.max(s.cells.z1, changed.z1) } : { ...changed }
		const per = t.splatRes / t.paintChunksPerSide
		for (const c of chunksReached(S, t.paintChunksPerSide, changed, s.blend.reach, this.chunkList)) {
			let base = s.bases.get(c)
			if (!base) {
				base = { w: new Uint8Array(per * per * SLOTS), s: new Uint8Array(SLOTS) }
				readChunkPaint(t, c, base.w, base.s)
				s.bases.set(c, base)
			}
			const { x0, z0 } = chunkTexelRect(t.paintChunksPerSide, t.splatRes, c)
			const rect = { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
			this.stroke.reserveSplat(rect)
			const res = s.painter.chunk(c, s.before, base.w, base.s)
			// Nothing within reach differs from the stroke's start: the chunk's paint is its own again.
			if (res === Repaint.Same) writeChunkPaint(t, c, base.w, base.s)
			if (res === Repaint.Replaced) s.replaced.add(c)
			else s.replaced.delete(c)
			t.markSplatDirty(rect)
			this.stroke.touchSplat(rect)
		}
	}

	onUp(ctx: ToolContext) {
		const s = this.s
		const stroke = this.stroke
		this.s = null
		this.stroke = null
		if (!stroke) return
		if (!s || !s.cells) {
			// The stroke changed no cell: take back the palette and the biome it added.
			stroke.finish()
			if (s?.palette) liveEditor.palette = s.palette
			if (s?.biomes && s.biome) dropAddedBiome(s.terrain, s.biome.name)
			return
		}
		const types = s.id === NO_BIOME ? [] : this.modelTypes(s.biome)
		const ready = types.every((type) => this.loaded.has(type))
		const placed = { n: 0 }
		const cmd = History.batch(this.label, (h) => {
			if (s.palette) h.push(listStep('Add textures', (v) => (liveEditor.palette = v), s.palette, [...liveEditor.palette]))
			if (s.biomes && s.biome) h.push(addBiomeStep(s.terrain, s.biome))
			const paint = stroke.finish()
			if (paint) h.push(paint)
			h.push(this.cellsStep(s))
			if (s.biome && s.id !== NO_BIOME) setBiomeEffects(s.biome, { x0: s.cells!.x0, z0: s.cells!.z0, x1: s.cells!.x1 + 1, z1: s.cells!.z1 + 1 }, h)
			if (ready) placed.n = this.scatter(ctx, s, h)
		})
		if (cmd) ctx.history.push(cmd)
		this.outline.set(s.terrain, s.replaced)
		this.say(s, placed.n)
		if (!ready && types.length) {
			// The models were still loading: they scatter once loaded, as a step of their own.
			setStatus(`Loading the models of "${s.biome!.name}" to scatter them…`, 0)
			void Promise.all(types.map((type) => this.load(type))).then(() => {
				if (ctx.terrain !== s.terrain) return setStatus("The map changed before the biome's models loaded; nothing was scattered.", 6000)
				const n = { v: 0 }
				const more = History.batch(`Scatter "${s.biome!.name}"`, (h) => (n.v = this.scatter(ctx, s, h)))
				if (more) ctx.history.push(more)
				this.say(s, n.v)
			})
		}
	}

	private say(s: BiomeStroke, placed: number) {
		const name = s.biome?.name ?? ''
		let msg = s.id === NO_BIOME ? 'Took the biome off the cells under the brush; their paint stays.' : `Painted "${name}"${placed ? `, ${placed} models scattered` : ''}.`
		if (s.replaced.size) msg += ` In ${s.replaced.size} chunks a texture had to go (four a chunk at most); they are outlined.`
		setStatus(msg, 6000)
	}

	/** The undo step of the stroke's cells in the biome map. */
	private cellsStep(s: BiomeStroke): Command {
		const t = s.terrain
		const c = s.cells!
		const w = c.x1 - c.x0 + 1
		const before = new Uint8Array(w * (c.z1 - c.z0 + 1))
		const after = new Uint8Array(before.length)
		for (let z = c.z0; z <= c.z1; z++) {
			const row = z * t.size
			before.set(s.before.subarray(row + c.x0, row + c.x1 + 1), (z - c.z0) * w)
			after.set(t.biomeMap.subarray(row + c.x0, row + c.x1 + 1), (z - c.z0) * w)
		}
		const put = (from: Uint8Array) => {
			for (let z = c.z0; z <= c.z1; z++) t.biomeMap.set(from.subarray((z - c.z0) * w, (z - c.z0 + 1) * w), z * t.size + c.x0)
			t.touchBiomeMap(c)
		}
		return { label: 'Biome map', bytes: before.length * 2, undo: () => put(before), redo: () => put(after) }
	}

	/**
	 * Scatters the biome's doodad brushes over the cells the stroke gave it, each brush at its density
	 * (doubled in clumps, as Apply Biome's), thinning from full half the border in to none on its edge.
	 */
	private scatter(ctx: ToolContext, s: BiomeStroke, h: History): number {
		const b = s.biome
		if (!b || !prefs.biomeScatter || s.id === NO_BIOME || !b.scatter.length) return 0
		const t = s.terrain
		const c = s.cells!
		const area = { x0: c.x0, z0: c.z0, x1: c.x1 + 1, z1: c.z1 + 1 }
		const cs = t.cellSize
		const yd2 = (area.x1 - area.x0) * (area.z1 - area.z0) * cs * cs
		const ts = t.worldSize / t.splatRes
		const fresh = (x: number, z: number) => {
			const cx = Math.min(t.size - 1, Math.floor(x / cs))
			const cz = Math.min(t.size - 1, Math.floor(z / cs))
			const i = cz * t.size + cx
			if (t.biomeMap[i] !== s.id || s.before[i] === s.id || t.isOff(x, z)) return 0
			const w = s.blend.share(t.biomeMap, Math.floor(x / ts), Math.floor(z / ts), s.id)
			return Math.max(0, 2 * w - 1)
		}
		const seed = biomeSeed(b.name)
		const tctx: ToolContext = Object.create(ctx, { history: { value: h } })
		let placed = 0
		for (const [i, sc] of b.scatter.entries()) {
			if (!sc.brush.entries.length || sc.density <= 0) continue
			const keep = sc.clumps ? (x: number, z: number) => fresh(x, z) * THREE.MathUtils.smoothstep(fbm(x * 0.006, z * 0.006, 3, seed + 7 + i), 0.38, 0.62) : fresh
			const attempts = Math.round(((sc.density * yd2) / 1e4) * (sc.clumps ? 2 : 1))
			placed += this.deps.doodads.fill(tctx, sc.brush, area, null, { attempts, keep, own: true, label: `Scatter ${sc.brush.name}` })
		}
		return placed
	}
}
