// Run with: bun test tests/toolUndo.test.ts
// Every edit must be undoable through History (CLAUDE.md), and a stroke is one step (#438). Each row
// drives a tool the way the Engine does (onDown, onMove and tick per frame, onUp) on a small real map,
// then checks that the stroke changed the map, left exactly one new History step, that Undo brings
// back every array of the snapshot taken before it, and that Redo brings back the stroke's result.
// Select's drags, the spawn brush and the hole wall handles are still to come (#694).
import './runes.ts'
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { editor, prefs } from '../src/lib/state/editor.svelte.ts'
import { History } from '../src/lib/state/historyCore.ts'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { HOLE_CELL, fillHoles } from '../src/lib/terrain/holes.ts'
import { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'
import { LiquidMap, newLiquidBrush, paintLiquid } from '../src/lib/water/liquids.ts'
import { newPath } from '../src/lib/terrain/paths.ts'
import type { Tool, ToolContext } from '../src/lib/tools/Tool.ts'
import { PaintTool, RoadTool, SculptTool, WaterTool } from '../src/lib/tools/TerrainTools.ts'
import { ClearTool } from '../src/lib/tools/ClearTool.ts'
import { MapDataTool } from '../src/lib/tools/MapDataTool.ts'
import { StampTool } from '../src/lib/tools/StampTool.ts'
import { PathTool } from '../src/lib/tools/PathTool.ts'
import { PlaceTool } from '../src/lib/tools/ObjectTools.ts'
import { DoodadBrushTool } from '../src/lib/tools/DoodadBrushTool.ts'
import { newStackItem } from '../src/lib/tools/brushStack.ts'
import { DEFAULT_ENTRY } from '../src/lib/tools/doodadBrush.ts'
import type { SpawnLayer } from '../src/lib/world/SpawnLayer.ts'
import type { SpawnPaths } from '../src/lib/world/SpawnPaths.ts'
import type { SculptMode } from '../src/lib/state/editor.svelte.ts'

/** The map's side in cells (8 paint chunks) and a cell's size in yards: 128 yards a side. */
const SIZE = 64
const CELL = 2
const CUBE = 'helper:cube:4'

/**
 * Runs `fn` with a stand-in `document` whose canvas draws nothing, for Sculpt's hole walls, which
 * draw their badges on one when made (the Stamp tool makes its Sculpt tools on its first stroke). It
 * goes again after, since every test file runs in one process and another checks the code without a
 * document (uiScale).
 */
function withCanvas(fn: () => void) {
	const g = globalThis as Record<string, unknown>
	if (g.document !== undefined) return fn()
	const noDraw = new Proxy({}, { get: () => () => {}, set: () => true })
	g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noDraw }) }
	try {
		fn()
	} finally {
		delete g.document
	}
}

// The defaults every row starts from, so one row's settings never reach the next.
const editorDefaults = structuredClone(editor)
const prefsDefaults = structuredClone(prefs)

interface World {
	terrain: Terrain
	objects: ObjectLayer
	liquids: LiquidMap
	history: History
	ctx: ToolContext
	/** Where the pointer is: what `surface` and `floor` report. */
	cursor: THREE.Vector3
}

/**
 * A rolling map with paint, holes, a pond and a few models to edit: the left half's paint chunks
 * hold a second texture (faint in the odd columns, which Clear's faint mode drops), a hole block sits
 * under the strokes, and three cubes stand in their path.
 */
function world(): World {
	const t = new Terrain(SIZE, CELL)
	const V = t.verts
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) t.heights[z * V + x] = 10 + 3 * Math.sin(x * 0.3) + 2 * Math.cos(z * 0.2)
	const side = t.paintChunksPerSide
	const per = t.splatRes / side
	for (let cz = 0; cz < side; cz++) {
		for (let cx = 0; cx < side / 2; cx++) {
			const c = cz * side + cx
			t.chunkSlots[c * SLOTS + 1] = 2
			const most = cx % 2 ? 20 : 200
			for (let z = cz * per; z < (cz + 1) * per; z++) {
				for (let x = cx * per; x < (cx + 1) * per; x++) {
					const p = (z * t.splatRes + x) * SLOTS
					const v = Math.round((most * (x - cx * per)) / (per - 1))
					t.weights[p] = 255 - v
					t.weights[p + 1] = v
				}
			}
		}
	}
	fillHoles(t.holes, t.size, 30, 30, 32, 32, HOLE_CELL)
	const objects = new ObjectLayer(t)
	for (const [x, z] of [[60, 62], [66, 64], [72, 66]]) objects.add({ type: CUBE, x, z, yOff: 0, rotY: 0, scale: 1 })
	const liquids = new LiquidMap(t.size)
	const pond = newLiquidBrush()
	Object.assign(pond, { x: 64, y: 12, z: 64, radius: 10, id: 1, add: true })
	paintLiquid(liquids, t, pond)
	const history = new History({ dirty() {}, sync() {} })
	const cursor = new THREE.Vector3()
	const ctx: ToolContext = {
		terrain: t,
		objects,
		spawns: {} as SpawnLayer,
		paths: {} as SpawnPaths,
		history,
		liquids,
		scene: new THREE.Scene(),
		raycaster: new THREE.Raycaster(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(0, -1, 0)),
		surface: () => ({ point: cursor.clone(), parent: null }),
		floor: () => ({ point: cursor.clone(), parent: null }),
		pressure: () => 1,
		radiusPressure: () => 1,
		cameraYaw: () => 0,
	}
	return { terrain: t, objects, liquids, history, ctx, cursor }
}

/** Everything a tool may edit, copied. */
function snapshot(w: World) {
	const t = w.terrain
	const liquids: unknown[] = []
	for (let c = 0; c < w.liquids.side * w.liquids.side; c++) {
		const layers = w.liquids.layers(c)
		if (layers.length) liquids.push([c, layers.map((l) => ({ id: l.id, heights: [...l.heights], depth: [...l.depth], cells: [...l.cells] }))])
	}
	const objects = [...w.objects.objects.values()]
		.map((o) => ({ ...o }))
		.sort((a, b) => a.id - b.id)
	return {
		heights: t.heights.slice(),
		holes: t.holes.slice(),
		weights: t.weights.slice(),
		chunkSlots: t.chunkSlots.slice(),
		mask: t.mask.slice(),
		noEffect: t.noEffect.slice(),
		areaIds: t.areaIds.slice(),
		chunkFlags: t.chunkFlags.slice(),
		shadow: t.shadow ? t.shadow.slice() : null,
		liquids: JSON.stringify(liquids),
		objects: JSON.stringify(objects),
		paths: JSON.stringify(editor.paths),
	}
}

type Snapshot = ReturnType<typeof snapshot>

/** The fields that differ between two snapshots, with the first differing index of an array. */
function differ(a: Snapshot, b: Snapshot): string[] {
	const out: string[] = []
	for (const k of Object.keys(a) as Array<keyof Snapshot>) {
		const x = a[k]
		const y = b[k]
		if (typeof x === 'string' || typeof y === 'string' || x === null || y === null) {
			if (x !== y) out.push(k)
			continue
		}
		if (x.length !== y.length) {
			out.push(`${k} (length ${x.length} and ${y.length})`)
			continue
		}
		for (let i = 0; i < x.length; i++) {
			if (x[i] !== y[i]) {
				out.push(`${k}[${i}] ${x[i]} and ${y[i]}`)
				break
			}
		}
	}
	return out
}

type Keys = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }

interface Row {
	name: string
	tool: () => Tool
	/** The settings and the map's state the row needs, set after the map is built and before the snapshot. */
	setup?: (w: World, tool: Tool) => void
	/** The stroke runs from `from` to `to` (x, z in yards), over `ticks` frames (0 for a click). */
	from?: [number, number]
	to?: [number, number]
	ticks?: number
	keys?: Keys
	/** The pointer's movementY each frame (Sculpt's vertex move). */
	movementY?: number
	/** In place of the stroke: what the row does (a key, an action). */
	act?: (w: World, tool: Tool) => void
}

function pointer(keys: Keys = {}, movementY = 0): PointerEvent {
	return { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, button: 0, movementX: 0, movementY, ...keys } as unknown as PointerEvent
}

/** The ground point under (x, z), where the Engine's terrain pick would put the hit. */
function at(w: World, x: number, z: number) {
	return w.cursor.set(x, w.terrain.heightAt(x, z), z).clone()
}

/** A stroke as the Engine drives one: down, then each frame a move and a tick, then up. */
function stroke(w: World, tool: Tool, row: Pick<Row, 'from' | 'to' | 'ticks' | 'keys' | 'movementY'>) {
	const [x0, z0] = row.from ?? [56, 60]
	const [x1, z1] = row.to ?? [76, 68]
	const n = row.ticks ?? 20
	const e = pointer(row.keys, row.movementY)
	tool.onDown?.(w.ctx, at(w, x0, z0), e)
	for (let i = 1; i <= n; i++) {
		const hit = at(w, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n)
		tool.onMove?.(w.ctx, hit, e)
		tool.tick?.(w.ctx, 0.05, hit)
	}
	tool.onUp?.(w.ctx, at(w, x1, z1), e)
}

const sculpt = (mode: SculptMode, more: (w: World) => void = () => {}): Row => ({
	name: `Sculpt ${mode}`,
	tool: () => new SculptTool(),
	setup: (w) => {
		editor.sculptMode = mode
		more(w)
	},
})

const rows: Row[] = [
	...(['raise', 'lower', 'smooth', 'blur', 'flatten', 'noise', 'mountain', 'crevice', 'terrace', 'erode'] as SculptMode[]).map((m) => sculpt(m)),
	{ ...sculpt('erode', () => ((editor.erode.kind = 'thermal'), (editor.erode.talus = 10))), name: 'Sculpt erode, thermal' },
	{ ...sculpt('flatten', () => (editor.flattenTarget = 'average')), name: 'Sculpt flatten to the average' },
	{ ...sculpt('raise', () => (editor.brush.shape = 'square')), name: 'Sculpt raise, square brush' },
	{ ...sculpt('raise', () => ((editor.sculptPaint = 'texture'), (editor.sculptPaintLayer = 1))), name: 'Sculpt raise with Paint texture' },
	{ ...sculpt('mountain', () => ((editor.sculptPaint = 'slope'), (editor.roles = { ...editor.roles, rock: 3, dirt: 2 }))), name: 'Sculpt mountain with Paint by slope' },
	{ ...sculpt('hole'), name: 'Sculpt hole, cut', from: [70, 70], to: [80, 74] },
	{ ...sculpt('hole', () => (editor.holeFill = true)), name: 'Sculpt hole, fill', from: [61, 61], to: [62, 62], ticks: 2 },
	{
		name: 'Sculpt vertex, Shift move',
		tool: () => new SculptTool(),
		setup: (w, tool) => {
			editor.sculptMode = 'vertex'
			// A plain stroke picks the vertices, and is no edit; the Shift drag then moves them.
			stroke(w, tool, { ticks: 4 })
		},
		keys: { shiftKey: true },
		movementY: -5,
		ticks: 6,
	},
	{ name: 'Paint texture', tool: () => new PaintTool(), setup: () => (editor.paintLayer = 1) },
	{ name: 'Paint spray', tool: () => new PaintTool(), setup: () => ((editor.paintLayer = 1), (editor.paintSpray = true), (editor.spray.pressure = 10)) },
	{ name: 'Paint swap, brush', tool: () => new PaintTool(), setup: () => ((editor.paintMode = 'swap'), (editor.paintLayer = 1)) },
	{ name: 'Paint swap, entire chunk', tool: () => new PaintTool(), setup: () => ((editor.paintMode = 'swap'), (editor.paintLayer = 1), (editor.swap.scope = 'chunk')) },
	{ name: 'Paint swap, entire tile', tool: () => new PaintTool(), setup: () => ((editor.paintMode = 'swap'), (editor.paintLayer = 1), (editor.swap.scope = 'tile')) },
	{ name: 'Paint mask', tool: () => new PaintTool(), setup: () => (editor.paintMode = 'mask') },
	{
		name: 'Paint mask, erase',
		tool: () => new PaintTool(),
		setup: (w) => {
			editor.paintMode = 'mask'
			editor.maskErase = true
			w.terrain.mask.fill(255)
		},
	},
	{ name: 'Mask wand by texture', tool: () => new PaintTool(), setup: () => ((editor.paintMode = 'mask'), (editor.maskSelect.by = 'texture')), from: [20, 20], ticks: 0 },
	{ name: 'Mask wand by height', tool: () => new PaintTool(), setup: () => ((editor.paintMode = 'mask'), (editor.maskSelect.by = 'height')), ticks: 0 },
	{ name: 'Road', tool: () => new RoadTool(), setup: () => (editor.paintLayer = 1) },
	{ name: 'Water paint', tool: () => new WaterTool(), from: [20, 90], to: [40, 100] },
	{ name: 'Water remove (Ctrl)', tool: () => new WaterTool(), keys: { ctrlKey: true } },
	{ name: 'Water dig lake', tool: () => new WaterTool(), setup: () => (editor.waterMode = 'dig') },
	{ name: 'Water raise shore', tool: () => new WaterTool(), setup: () => ((editor.waterMode = 'shore'), (editor.waterLevel = 12)) },
	...(['models', 'textures', 'faint', 'heights', 'liquids'] as const).map((m): Row => ({ name: `Clear ${m}`, tool: () => new ClearTool(), setup: () => (editor.clearMode = m) })),
	{ name: 'Clear holes', tool: () => new ClearTool(), setup: () => (editor.clearMode = 'holes'), from: [58, 58], to: [66, 66] },
	{ name: 'Map data zone', tool: () => new MapDataTool(), setup: () => ((editor.mapDataMode = 'area'), (editor.mapDataArea = 12)) },
	{
		name: 'Map data zone, clear',
		tool: () => new MapDataTool(),
		setup: (w) => {
			editor.mapDataMode = 'area'
			editor.mapDataClear = true
			w.terrain.areaIds.fill(12)
		},
	},
	{ name: 'Map data impassable', tool: () => new MapDataTool(), setup: () => (editor.mapDataMode = 'impassable') },
	{ name: 'Map data no tufts', tool: () => new MapDataTool(), setup: () => (editor.mapDataMode = 'noTufts') },
	{ name: 'Map data shadow, on a map without shadows', tool: () => new MapDataTool(), setup: () => (editor.mapDataMode = 'shadow') },
	{
		name: 'Map data shadow, light',
		tool: () => new MapDataTool(),
		setup: (w) => {
			editor.mapDataMode = 'shadow'
			editor.mapDataClear = true
			w.terrain.ensureShadow().fill(255)
		},
	},
	{
		name: 'Stamp',
		tool: () => new StampTool(),
		setup: () => {
			const paint = newStackItem('paint', editor.palette[1])
			prefs.brushStacks = [{ name: 'Stack', items: [newStackItem('sculpt'), { ...newStackItem('sculpt'), mode: 'smooth' }, paint] }]
		},
	},
	{ name: 'Path, new path', tool: () => new PathTool(), ticks: 4 },
	{
		name: 'Path, add a point',
		tool: () => new PathTool(),
		setup: () => {
			const p = newPath([], 'road', editor.palette[1])
			p.points = [{ x: 20, y: 10, z: 20 }, { x: 40, y: 10, z: 30 }]
			editor.paths = [p]
			editor.pathId = p.id
			editor.pathPoint = 1
		},
		from: [100, 100],
		to: [104, 108],
		ticks: 4,
	},
	{
		name: 'Path, apply (Enter)',
		tool: () => new PathTool(),
		setup: (w) => {
			const p = newPath([], 'road', editor.palette[1])
			p.points = [20, 50, 90].map((x, i) => ({ x, y: w.terrain.heightAt(x, 60 + i * 4) + 1, z: 60 + i * 4 }))
			editor.paths = [p]
			editor.pathId = p.id
		},
		act: (w, tool) => tool.onKey?.(w.ctx, { key: 'Enter' } as KeyboardEvent),
	},
	{ name: 'Place', tool: () => new PlaceTool({ placeSpawn: () => {}, fitGround: () => null }), setup: () => (editor.prefab = CUBE), from: [20, 100], ticks: 0 },
	{
		name: 'Place, scatter',
		tool: () => new PlaceTool({ placeSpawn: () => {}, fitGround: () => null }),
		setup: () => ((editor.prefab = CUBE), (editor.placeScatter = true), (editor.brush.radius = 16)),
		from: [20, 100],
		to: [40, 110],
	},
	{
		name: 'Doodad brush',
		tool: () => new DoodadBrushTool(),
		setup: () => (prefs.doodadBrushes = [{ name: 'Cubes', spacing: 1, entries: [{ type: CUBE, ...DEFAULT_ENTRY }] }]),
		from: [20, 100],
		to: [40, 110],
	},
	{
		name: 'Doodad brush, erase (Ctrl)',
		tool: () => new DoodadBrushTool(),
		setup: () => (prefs.doodadBrushes = [{ name: 'Cubes', spacing: 1, entries: [{ type: CUBE, ...DEFAULT_ENTRY }] }]),
		keys: { ctrlKey: true },
	},
]

for (const row of rows) {
	test(`${row.name}: one History step, and Undo restores the map`, () => {
		withCanvas(() => {
			Object.assign(editor, structuredClone(editorDefaults))
			Object.assign(prefs, structuredClone(prefsDefaults))
			const w = world()
			const tool = row.tool()
			tool.activate?.(w.ctx)
			row.setup?.(w, tool)
			const steps = w.history.position
			const before = snapshot(w)
			if (row.act) row.act(w, tool)
			else stroke(w, tool, row)
			const after = snapshot(w)
			expect(differ(before, after).length, 'the stroke changed the map').toBeGreaterThan(0)
			expect(w.history.position, 'exactly one new step').toBe(steps + 1)
			expect(w.history.steps().length).toBe(steps + 1)
			w.history.undo()
			expect(differ(before, snapshot(w)), 'Undo restores the snapshot').toEqual([])
			w.history.redo()
			expect(differ(after, snapshot(w)), 'Redo restores the stroke').toEqual([])
			tool.deactivate?.(w.ctx)
		})
	})
}
