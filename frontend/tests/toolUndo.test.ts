// Run with: bun test tests/toolUndo.test.ts
// Every edit must be undoable through History (CLAUDE.md), and a stroke is one step (#438). Each row
// drives a tool the way the Engine does (onDown, onMove and tick per frame, onUp) on a small real map,
// then checks that the stroke changed the map, left exactly one new History step, that Undo brings
// back every array of the snapshot taken before it, and that Redo brings back the stroke's result.
// The Select tool's drags, the spawn brush and the hole wall handles have rows too (#694); the gizmo's
// handles are GizmoDrag's, checked in gizmoDrag.test.ts and by the gizmo-undo probe.
import './runes.ts'
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { editor, prefs, ui } from '../src/lib/state/editor.svelte.ts'
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
import { PlaceTool, SelectTool } from '../src/lib/tools/ObjectTools.ts'
import { DoodadBrushTool } from '../src/lib/tools/DoodadBrushTool.ts'
import { newStackItem } from '../src/lib/tools/brushStack.ts'
import { DEFAULT_ENTRY } from '../src/lib/tools/doodadBrush.ts'
import { SpawnBrushTool } from '../src/lib/tools/SpawnBrushTool.ts'
import { HoleWalls } from '../src/lib/tools/HoleWalls.ts'
import { SpawnLayer, cloneSpawn } from '../src/lib/world/SpawnLayer.ts'
import { selectObjects } from '../src/lib/state/selection.ts'
import { areaCells, areaShape } from '../src/lib/state/areaSelection.ts'
import { copyObjects, copyRegion, pasteObjects, pasteRegion, type MapClip, type ObjectClip } from '../src/lib/world/clipboard.ts'
import { vmangos } from '../wailsjs/go/models'
import type { SpawnPaths } from '../src/lib/world/SpawnPaths.ts'
import type { SculptMode } from '../src/lib/state/editor.svelte.ts'
import type { CullView } from '../src/lib/world/instanceCull.ts'

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
const uiDefaults = structuredClone(ui)

/**
 * Puts the editor, prefs and ui back to those defaults, with nothing selected: the defaults are taken
 * when this file loads, after the files before it in a whole `bun test` run, which may have left a
 * selection behind.
 */
function reset() {
	Object.assign(editor, structuredClone(editorDefaults))
	Object.assign(prefs, structuredClone(prefsDefaults))
	Object.assign(ui, structuredClone(uiDefaults))
	editor.selectedIds = []
	editor.selected = null
	editor.selection = null
	editor.selectedSpawn = null
}

/** A creature of the region, for the Select tool's spawn and path rows. */
function creature(guid: number, x: number, z: number, y = 10, entry = 100): vmangos.WorldSpawn {
	return vmangos.WorldSpawn.createFrom({
		kind: 'monster',
		guid,
		entry,
		name: 'Kobold',
		x,
		y,
		z,
		orientation: 0,
		model: '',
		waypoints: [],
		leader: 0,
		pool: 0,
		motherPool: 0,
	})
}

interface World {
	terrain: Terrain
	objects: ObjectLayer
	spawns: SpawnLayer
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
	for (const [x, z] of [
		[60, 62],
		[66, 64],
		[72, 66],
	])
		objects.add({ type: CUBE, x, z, yOff: 0, rotY: 0, scale: 1 })
	const liquids = new LiquidMap(t.size)
	const pond = newLiquidBrush()
	Object.assign(pond, { x: 64, y: 12, z: 64, radius: 10, id: 1, add: true })
	paintLiquid(liquids, t, pond)
	const spawns = new SpawnLayer()
	const kobold = creature(1, 40, 40, t.heightAt(40, 40))
	const point = (x: number, z: number) => vmangos.Waypoint.createFrom({ x, y: t.heightAt(x, z), z, orientation: 0, waitMs: 0, wanderDistance: 0, scriptId: 0 })
	kobold.waypoints = [point(40, 40), point(50, 44)]
	spawns.set([kobold])
	const history = new History({ dirty() {}, sync() {} })
	const cursor = new THREE.Vector3()
	// Made on first use, with a canvas for its badges, as the Engine makes it once.
	let walls: HoleWalls | null = null
	const ctx: ToolContext = {
		terrain: t,
		objects,
		spawns,
		paths: {} as SpawnPaths,
		history,
		liquids,
		scene: new THREE.Scene(),
		raycaster: new THREE.Raycaster(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(0, -1, 0)),
		get holeWalls() {
			if (!walls) withCanvas(() => (walls = new HoleWalls()))
			return walls!
		},
		surface: () => ({ point: cursor.clone(), parent: null }),
		floor: () => ({ point: cursor.clone(), parent: null }),
		pressure: () => 1,
		radiusPressure: () => 1,
		cameraYaw: () => 0,
	}
	return { terrain: t, objects, spawns, liquids, history, ctx, cursor }
}

/** Everything a tool may edit, copied. */
function snapshot(w: World) {
	const t = w.terrain
	const liquids: unknown[] = []
	for (let c = 0; c < w.liquids.side * w.liquids.side; c++) {
		const layers = w.liquids.layers(c)
		if (layers.length) liquids.push([c, layers.map((l) => ({ id: l.id, heights: [...l.heights], depth: [...l.depth], cells: [...l.cells] }))])
	}
	const objects = [...w.objects.objects.values()].map((o) => ({ ...o })).sort((a, b) => a.id - b.id)
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
		spawns: JSON.stringify([...w.spawns.spawns].sort((a, b) => a.guid - b.guid)),
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
	tool: (w: World) => Tool
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

/** A pointer event; `clientX` moves 8 pixels a frame, so a Select drag passes its threshold (DRAG_PX). */
function pointer(keys: Keys = {}, movementY = 0, clientX = 0): PointerEvent {
	return { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, button: 0, detail: 1, clientX, clientY: 0, movementX: 0, movementY, ...keys } as unknown as PointerEvent
}

/**
 * The ground point under (x, z), where the Engine's terrain pick would put the hit, with the pick ray
 * straight down onto it (the Select tool picks models and spawns along the ray).
 */
function at(w: World, x: number, z: number) {
	w.ctx.raycaster.ray.origin.set(x, 1000, z)
	w.ctx.raycaster.ray.direction.set(0, -1, 0)
	return w.cursor.set(x, w.terrain.heightAt(x, z), z).clone()
}

// A frustum with no planes set holds everything.
const VIEW: CullView = { frustums: [new THREE.Frustum()], eye: new THREE.Vector3(0, 1e6, 0), pxPerUnit: 1, cutoffPx: 0 }

/** What the Engine's frame does to the models before the input: they are drawn, so a pick finds them where they are. */
function draw(w: World) {
	w.objects.update()
	w.objects.cull(VIEW)
}

/** A stroke as the Engine drives one: down, then each frame a move and a tick, then up. */
function stroke(w: World, tool: Tool, row: Pick<Row, 'from' | 'to' | 'ticks' | 'keys' | 'movementY'>) {
	const [x0, z0] = row.from ?? [56, 60]
	const [x1, z1] = row.to ?? [76, 68]
	const n = row.ticks ?? 20
	draw(w)
	tool.onDown?.(w.ctx, at(w, x0, z0), pointer(row.keys, row.movementY))
	for (let i = 1; i <= n; i++) {
		draw(w)
		const hit = at(w, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n)
		tool.onMove?.(w.ctx, hit, pointer(row.keys, row.movementY, i * 8))
		tool.tick?.(w.ctx, 0.05, hit)
	}
	tool.onUp?.(w.ctx, at(w, x1, z1), pointer(row.keys, row.movementY, n * 8))
}

const sculpt = (mode: SculptMode, more: (w: World) => void = () => {}): Row => ({
	name: `Sculpt ${mode}`,
	tool: () => new SculptTool(),
	setup: (w) => {
		editor.sculptMode = mode
		more(w)
	},
})

/** What the Select tool pastes, set by a paste row (and cleared before each row). */
const paste: { objects: ObjectClip | null; area: MapClip | null } = { objects: null, area: null }

/** The Select tool, its hooks doing what the Engine's do (`Engine.commitPaste` for a paste). */
function selectTool(w: World): SelectTool {
	const tool: SelectTool = new SelectTool({
		clipSize: () => (paste.area ? { w: paste.area.w, h: paste.area.h } : null),
		objectClip: () => paste.objects,
		commitPaste: () => {
			const at = tool.pasteWorld
			if (paste.objects && at) {
				const r = pasteObjects(w.terrain, w.objects, paste.objects, at.x, at.z, tool.pasteOnModel)
				if (r) {
					w.history.push(r.cmd)
					selectObjects(
						w.objects,
						r.added.map((o) => o.id),
					)
				}
			} else if (paste.area && tool.pasteAt) {
				const cmd = pasteRegion(
					w.terrain,
					w.objects,
					editor.palette,
					(t) => (editor.palette = t),
					paste.area,
					tool.pasteAt.x,
					tool.pasteAt.z,
					{ ...editor.paste },
					() => {},
					w.liquids,
				)
				if (cmd) w.history.push(cmd)
			}
			ui.pasting = false
		},
		cancelPaste: () => (ui.pasting = false),
		placeSpawn: () => {},
		pickSpawn: () => {},
	})
	return tool
}

/** The creature template the spawn brush rows paint with. */
const KOBOLD = { entry: 200, name: 'Kobold', subname: '', levelMin: 1, levelMax: 2, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 1, scale: 1, equipment: 0, weight: 1 }

/** The Doodad tool in Creatures mode, its spawn brush making creatures as `SpawnActions.brushCreature` does, with guids of their own. */
function spawnBrush(): Tool {
	let guid = 1000
	const tool = new DoodadBrushTool()
	tool.spawns = new SpawnBrushTool({
		newCreature: (e, x, y, z, o) => Object.assign(creature(guid++, x, z, y, e.entry), { orientation: o }),
		ghostType: () => '',
		ghostScale: (e) => e.scale,
	})
	return tool
}

const spawnBrushSetup = () => {
	editor.doodadMode = 'creatures'
	editor.brush.radius = 10
	prefs.spawnBrush = { ...prefs.spawnBrush, entries: [KOBOLD], density: 300, spacing: 2, avoidWater: false, maxSlope: 90 }
}

/** The hole wall handles the Select tool and Sculpt's Hole mode share (`ctx.holeWalls`). */
const wallsOf = (w: World) => w.ctx.holeWalls
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000)
camera.up.set(0, 0, -1)
const centre = new THREE.Vector2()

/** Points the pick ray, from a camera 30 yards above, at (x, y, z) (y: the ground there), as a hover there would. */
function look(w: World, x: number, z: number, y = w.terrain.heightAt(x, z)) {
	camera.position.set(x, y + 30, z)
	camera.lookAt(x, y, z)
	camera.updateMatrixWorld()
	w.ctx.raycaster.setFromCamera(centre, camera)
}

/**
 * Hovers the wall at x = 60 yards, the hole block's west side (cells 30 and 31 are holes), and,
 * with `badge` (3 for +, 4 for −), the badge the walls show there, as the Engine's frame does.
 */
function hoverWall(w: World, tool: Tool, badge?: 3 | 4) {
	const walls = wallsOf(w)
	look(w, 60.1, 62.5)
	tool.frame?.(w.ctx, null)
	expect(walls.active, 'the wall is hovered').toBe(true)
	if (!badge) return
	const b = walls.group.children[badge].position
	look(w, b.x, b.z, b.y)
	tool.frame?.(w.ctx, null)
}

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
			p.points = [
				{ x: 20, y: 10, z: 20 },
				{ x: 40, y: 10, z: 30 },
			]
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
	// The Select tool: a press on the middle cube (66, 64) drags it.
	{ name: 'Select, drag a model', tool: selectTool, from: [66, 64], to: [80, 90], ticks: 10 },
	{ name: 'Select, drag a model on a level plane (Follow cursor off)', tool: selectTool, setup: () => (editor.moveFollowCursor = false), from: [66, 64], to: [80, 90], ticks: 10 },
	{ name: 'Select, drag a model with Follow the Ground', tool: selectTool, setup: () => (editor.followGround = true), from: [66, 64], to: [80, 90], ticks: 10 },
	{ name: 'Select, drag three models', tool: selectTool, setup: (w) => selectObjects(w.objects, [...w.objects.objects.keys()]), from: [66, 64], to: [80, 90], ticks: 10 },
	{
		name: 'Select, drag three models onto the ground (Snap group)',
		tool: selectTool,
		setup: (w) => ((editor.moveSnapGroup = true), selectObjects(w.objects, [...w.objects.objects.keys()])),
		from: [66, 64],
		to: [80, 90],
		ticks: 10,
	},
	{
		// Picking a spawn needs its drawn model; the layer's pick stands in for it (pickNearest.test.ts checks the choice).
		name: 'Select, drag a creature',
		tool: selectTool,
		setup: (w) => (w.spawns.pickHit = () => ({ spawn: w.spawns.spawns[0], distance: 1 })),
		from: [40, 40],
		to: [30, 20],
		ticks: 10,
	},
	{
		name: 'Select, drag a path point',
		tool: selectTool,
		setup: (w) => {
			editor.selectedSpawn = cloneSpawn(w.spawns.spawns[0])
			ui.pathEdit = true
			Object.assign(w.ctx.paths, { pickPoint: () => 1 })
		},
		from: [50, 44],
		to: [30, 50],
		ticks: 10,
	},
	{
		name: 'Select, add a path point',
		tool: selectTool,
		setup: (w) => {
			editor.selectedSpawn = cloneSpawn(w.spawns.spawns[0])
			ui.pathEdit = true
			Object.assign(w.ctx.paths, { pickPoint: () => -1 })
		},
		from: [20, 20],
		ticks: 0,
	},
	{
		name: 'Select, paste models',
		tool: selectTool,
		setup: (w, tool) => {
			paste.objects = copyObjects(w.terrain, w.objects, [...w.objects.objects.values()])
			ui.pasting = true
			;(tool as SelectTool).pasteWorld = new THREE.Vector3(30, w.terrain.heightAt(30, 100), 100)
		},
		from: [30, 100],
		ticks: 0,
	},
	{
		name: 'Select, paste an area',
		tool: selectTool,
		setup: (w, tool) => {
			paste.area = copyRegion(w.terrain, w.objects, { x0: 26, z0: 26, x1: 36, z1: 36 }, editor.palette, w.liquids)
			ui.pasting = true
			;(tool as SelectTool).pasteAt = { x: 4, z: 40 }
		},
		from: [20, 90],
		ticks: 0,
	},
	{
		name: 'Select, drag a hole wall',
		tool: selectTool,
		act: (w, tool) => {
			hoverWall(w, tool)
			tool.onDown?.(w.ctx, null, pointer())
			for (const x of [58, 56, 54]) {
				look(w, x, 62.5)
				tool.frame?.(w.ctx, null)
				tool.onMove?.(w.ctx, null, pointer({}, 0, 40))
			}
			tool.onUp?.(w.ctx, null, pointer({}, 0, 40))
		},
	},
	...(
		[
			[3, 'the + badge'],
			[4, 'the − badge'],
		] as const
	).map(([badge, name]): Row => ({
		name: `Select, ${name} of a hole wall`,
		tool: selectTool,
		act: (w, tool) => {
			hoverWall(w, tool, badge)
			tool.onDown?.(w.ctx, null, pointer())
			tool.onUp?.(w.ctx, null, pointer())
		},
	})),
	{ name: 'Spawn brush', tool: spawnBrush, setup: spawnBrushSetup, from: [20, 100], to: [40, 110] },
	{
		name: 'Spawn brush, erase (Ctrl)',
		tool: spawnBrush,
		setup: (w) => {
			spawnBrushSetup()
			w.spawns.set([...w.spawns.spawns, ...[60, 66, 72].map((x, i) => creature(2000 + i, x, 63, w.terrain.heightAt(x, 63), KOBOLD.entry))])
		},
		keys: { ctrlKey: true },
	},
]

for (const row of rows) {
	test(`${row.name}: one History step, and Undo restores the map`, () => {
		withCanvas(() => {
			reset()
			paste.objects = paste.area = null
			const w = world()
			const tool = row.tool(w)
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

// A selection is no edit: an area drag, a lasso, the selection brush and a click on a model select
// without a History step and leave the map as it was (Undo would otherwise skip back over nothing).
const selections: Array<{ name: string; setup?: () => void; path: Array<[number, number]>; selected: (w: World) => boolean }> = [
	{
		name: 'a rectangle',
		path: [
			[50, 50],
			[70, 60],
			[80, 80],
		],
		selected: () => editor.selection !== null && editor.selectedIds.length > 0,
	},
	{
		name: 'a lasso',
		setup: () => (editor.selectShape = 'lasso'),
		path: [
			[50, 50],
			[80, 50],
			[80, 80],
			[50, 80],
		],
		selected: () => editor.selection !== null && editor.selectedIds.length > 0,
	},
	{
		name: 'the selection brush',
		setup: () => ((editor.selectBrush = true), (editor.brush.radius = 4)),
		path: [
			[56, 62],
			[76, 66],
		],
		selected: () => editor.selectedIds.length > 0,
	},
	{ name: 'a click on a model', path: [[66, 64]], selected: () => editor.selectedIds.length === 1 },
]

for (const s of selections) {
	test(`Select, ${s.name}: a selection is no History step`, () => {
		withCanvas(() => {
			reset()
			const w = world()
			const tool = selectTool(w)
			tool.activate(w.ctx)
			s.setup?.()
			const before = snapshot(w)
			const [first, ...rest] = s.path
			draw(w)
			tool.onDown(w.ctx, at(w, ...first), pointer())
			rest.forEach(([x, z], i) => {
				const hit = at(w, x, z)
				tool.onMove(w.ctx, hit, pointer({}, 0, (i + 1) * 8))
				tool.frame(w.ctx, hit)
			})
			const [x, z] = s.path[s.path.length - 1]
			tool.onUp(w.ctx, at(w, x, z), pointer({}, 0, rest.length * 8))
			expect(s.selected(w), 'it selected something').toBe(true)
			expect(w.history.position).toBe(0)
			expect(differ(before, snapshot(w))).toEqual([])
			tool.deactivate(w.ctx)
		})
	})
}

// #712: the rectangle adds with Shift and subtracts with Ctrl, as the lasso does, the models following.
test('Select, a rectangle: Shift adds to the area and Ctrl takes from it, with the models in it', () => {
	withCanvas(() => {
		reset()
		const w = world()
		const tool = selectTool(w)
		tool.activate(w.ctx)
		draw(w)
		const drag = (from: [number, number], to: [number, number], keys: Keys = {}) => {
			tool.onDown(w.ctx, at(w, ...from), pointer(keys))
			const hit = at(w, ...to)
			tool.onMove(w.ctx, hit, pointer(keys, 0, 8))
			tool.frame(w.ctx, hit)
			tool.onUp(w.ctx, hit, pointer(keys, 0, 8))
		}
		const cubesAt = () => editor.selectedIds.map((id) => w.objects.objects.get(id)!.x).sort((a, b) => a - b)
		const cells = () => areaCells(w.terrain, w.terrain.size)!.reduce((n, v) => n + (v ? 1 : 0), 0)
		drag([50, 50], [64, 80])
		expect(editor.selection).toEqual({ x0: 25, z0: 25, x1: 32, z1: 40 })
		expect(cubesAt()).toEqual([60])
		// A Shift drag beside it: the two make one plain rect, with all three cubes.
		drag([64, 50], [80, 80], { shiftKey: true })
		expect(editor.selection).toEqual({ x0: 25, z0: 25, x1: 40, z1: 40 })
		expect(areaShape(w.terrain, w.terrain.size)).toBeNull()
		expect(cubesAt()).toEqual([60, 66, 72])
		// A Ctrl drag inside it: a hole in the area, and the cube there leaves the selection.
		drag([70, 60], [76, 70], { ctrlKey: true })
		expect(editor.selection).toEqual({ x0: 25, z0: 25, x1: 40, z1: 40 })
		expect(cells()).toBe(15 * 15 - 3 * 5)
		expect(cubesAt()).toEqual([60, 66])
		// A Shift or Ctrl click leaves it; a plain click clears it.
		drag([90, 90], [90, 90], { shiftKey: true })
		expect(cells()).toBe(15 * 15 - 3 * 5)
		drag([90, 90], [90, 90])
		expect(editor.selection).toBeNull()
		expect(w.history.position).toBe(0)
		tool.deactivate(w.ctx)
	})
})
