// Benchmark maps (#322): generated maps that each stress one system (instancing, draw calls, WMOs,
// lights, skinning, terrain paint, liquids), and one that mixes them, for measuring performance
// work (docs/TESTS.md, "Benchmark maps"). The same kind, count and seed always give the same map.
// Models are picked from the user's own client by path, so nothing of Blizzard's is in the repo.
import type { Engine } from '../engine/Engine'
import type { MapDocument } from '../engine/MapDocument'
import { mulberry32 } from '../engine/noise'
import { editor, prefs, setStatus } from '../state/editor.svelte'
import { CHUNK_CELLS, SLOTS } from '../terrain/chunkPaint'
import type { GenerateKind } from '../terrain/Terrain'
import { LIQUID_CELLS, LIQUID_MAGMA, LIQUID_OCEAN, LIQUID_SLIME, LIQUID_VERTS, LIQUID_WATER, newLayer, type LiquidLayer } from '../water/liquids'
import { listAssets } from '../wow/api'
import { vmangos } from '../../../wailsjs/go/models'
import { ListDisplays } from '../../../wailsjs/go/main/App'

export type BenchKind = 'objects-same' | 'objects-mixed' | 'wmo' | 'lights' | 'creatures' | 'terrain' | 'water' | 'everything'

export interface BenchMap {
	kind: BenchKind
	/** The menu's name for it. */
	label: string
	/** What it stresses, for the probe's line and the docs. */
	stresses: string
	/** How many of its main thing it places by default (objects, buildings, lights, creatures; chunks for terrain and water). */
	count: number
	/** The map's side in cells (128 a tile). */
	size: number
	terrain: GenerateKind
	/** The hour it is measured at: night for the lights, so they show. */
	hour: number
}

export const BENCH_MAPS: readonly BenchMap[] = [
	{ kind: 'objects-same', label: 'Objects: one model', stresses: 'instancing: copies of one tree', count: 5000, size: 256, terrain: 'flat', hour: 13 },
	{ kind: 'objects-mixed', label: 'Objects: many models', stresses: 'draw calls and loading: doodads of many models', count: 3000, size: 256, terrain: 'flat', hour: 13 },
	{ kind: 'wmo', label: 'Buildings', stresses: 'WMO groups, portals and doodad sets', count: 120, size: 512, terrain: 'flat', hour: 13 },
	{ kind: 'lights', label: 'Lights and fires', stresses: 'the light pool, flames and particles, at night', count: 600, size: 256, terrain: 'flat', hour: 0 },
	{ kind: 'creatures', label: 'Creatures', stresses: 'skinning and animation: creatures of many displays', count: 2000, size: 256, terrain: 'flat', hour: 13 },
	{ kind: 'terrain', label: 'Terrain', stresses: 'the splat shader and tile drawing: four layers on every chunk, holes', count: 0, size: 512, terrain: 'mountains', hour: 13 },
	{ kind: 'water', label: 'Water', stresses: 'the liquid shader: water, ocean, magma and slime layers, overlapping', count: 0, size: 256, terrain: 'lakeland', hour: 13 },
	{ kind: 'everything', label: 'Everything', stresses: 'a moderate mix of all of the above', count: 1500, size: 512, terrain: 'lakeland', hour: 13 },
]

/**
 * Help › Benchmark maps' sizes (`prefs.benchScale`): how many times the default count a map places. A
 * fast GPU draws the normal maps at the screen's rate, which says nothing; the larger ones bring the
 * frame time over it.
 */
export const BENCH_SCALES: readonly [string, number][] = [
	['Normal', 1],
	['Heavy (4x)', 4],
	['Extreme (16x)', 16],
]

/** The largest map side the sizes grow a map to, in cells: 8x8 tiles, whose paint takes 64 MB. */
const MAX_SIZE = 1024

/**
 * Map `m`'s side at `scale`: the maps whose thing fills the ground (the buildings' grid, the terrain,
 * the water) grow by the scale's square root, up to MAX_SIZE; the rest keep theirs and get denser.
 */
function scaledSize(m: BenchMap, scale: number): number {
	if (m.kind !== 'wmo' && m.kind !== 'terrain' && m.kind !== 'water') return m.size
	return Math.min(MAX_SIZE, m.size * Math.max(1, Math.round(Math.sqrt(scale))))
}

export function benchMap(kind: BenchKind): BenchMap {
	const m = BENCH_MAPS.find((b) => b.kind === kind)
	if (!m) throw new Error(`no benchmark map ${kind}`)
	return m
}

/** The one model `objects-same` copies, and the lights' models by preference (each falls back to a pattern). */
const SAME_TREE = 'World\\Azeroth\\Elwynn\\PassiveDoodads\\Trees\\ElwynnTreeCanopy01.m2'
const LIGHT_MODEL = /\\(braziers?|torches|bonfire|campfire|lamppost|lanterns?|lamps|fire)\\/i
const NOT_LIGHT = /off\.m2$|firewood|fireworks|noomni|broken/i
const DOODAD_ROOT = /^world\\(generic|azeroth|kalimdor|khazmodan|lordaeron)\\/i
const NOT_DOODAD = /sky|stars|volumetric|worldtree|\\lights?\\|detail\\|test|zz/i
const BUILDING = /\\wmo\\(azeroth|kalimdor|khazmodan|lorderon|lordaeron)\\buildings\\/i

/** Every `step`-th entry of the sorted list, from a seeded start: a spread of the client's models, the same each run. */
function spread(paths: string[], n: number, rand: () => number): string[] {
	const sorted = [...paths].sort()
	if (sorted.length <= n) return sorted
	const step = sorted.length / n
	const start = rand() * step
	return Array.from({ length: n }, (_, i) => sorted[Math.floor(start + i * step)])
}

async function pick(kind: 'm2' | 'wmo', match: (p: string) => boolean, n: number, rand: () => number, what: string): Promise<string[]> {
	const all = (await listAssets(kind)).filter(match)
	if (!all.length) throw new Error(`benchmark map: the client has no ${what} (is the WoW folder set?)`)
	return spread(all, n, rand)
}

/** Where the camera stands on a map `w` yards wide (`benchView`): over a corner, a fifth of the way in. */
const viewSpot = (w: number) => w * 0.18
/** Yards round the camera's spot that nothing stands in, so the view isn't inside a tree. */
const CLEARING = 60

/** A random point on the map, `margin` from its edges and outside the camera's clearing. */
function spot(d: MapDocument, rand: () => number, margin: number): [number, number] {
	const w = d.terrain.worldSize
	const v = viewSpot(w)
	for (;;) {
		const x = margin + rand() * (w - 2 * margin)
		const z = margin + rand() * (w - 2 * margin)
		if (Math.hypot(x - v, z - v) > CLEARING) return [x, z]
	}
}

/** Places `n` objects of `types` over the map, each on the ground, turned and sized at random. */
function scatter(d: MapDocument, types: string[], n: number, rand: () => number, margin = 8, scale: [number, number] = [0.8, 1.3]) {
	for (let i = 0; i < n; i++) {
		const [x, z] = spot(d, rand, margin)
		d.objects.add({
			type: `m2:${types[Math.floor(rand() * types.length)]}`,
			x,
			z,
			yOff: 0,
			rotY: rand() * Math.PI * 2,
			scale: scale[0] + rand() * (scale[1] - scale[0]),
		})
	}
}

/** Buildings on a jittered grid, so they stand apart: `n` of `types`, less those that would stand in the camera's clearing. */
function buildings(d: MapDocument, types: string[], n: number, rand: () => number) {
	const side = Math.ceil(Math.sqrt(n))
	const cell = (d.terrain.worldSize - 40) / side
	const v = viewSpot(d.terrain.worldSize)
	for (let i = 0; i < n; i++) {
		const gx = i % side
		const gz = Math.floor(i / side)
		const x = 20 + (gx + 0.5 + (rand() - 0.5) * 0.3) * cell
		const z = 20 + (gz + 0.5 + (rand() - 0.5) * 0.3) * cell
		const turn = rand() * Math.PI * 2
		// A cell's building can reach most of the cell out from its middle (a 4x grid's cells are ~90 yd).
		if (Math.hypot(x - v, z - v) < CLEARING + cell * 0.7) continue
		d.objects.add({
			type: `wmo:${types[i % types.length]}`,
			x,
			z,
			yOff: 0,
			rotY: turn,
			scale: 1,
		})
	}
}

/**
 * `n` creatures of up to `kinds` client displays, as spawns of the document's own layer. Nothing of
 * the world database is read or written: the displays come dressed from the client's tables
 * (`ListDisplays`, which needs no database), and the spawns exist only in this tab.
 */
async function pickDisplays(kinds: number): Promise<vmangos.DisplayEntry[]> {
	const displays = ((await ListDisplays()) ?? []).filter((s) => s.model && s.uses > 0).sort((a, b) => a.id - b.id)
	if (!displays.length) throw new Error('benchmark map: the client has no creature displays (is the WoW folder set?)')
	const step = Math.max(1, displays.length / kinds)
	return Array.from({ length: Math.min(kinds, displays.length) }, (_, i) => displays[Math.floor(i * step)])
}

function creatures(d: MapDocument, n: number, chosen: vmangos.DisplayEntry[], rand: () => number): vmangos.WorldSpawn[] {
	const out: vmangos.WorldSpawn[] = []
	for (let i = 0; i < n; i++) {
		const s = chosen[Math.floor(rand() * chosen.length)]
		const [x, z] = spot(d, rand, 8)
		out.push(
			vmangos.WorldSpawn.createFrom({
				kind: 'monster',
				guid: i + 1,
				entry: 0,
				name: s.names?.[0] ?? `Display ${s.id}`,
				subname: '',
				levelMin: 1,
				levelMax: 1,
				faction: 0,
				npcFlags: 0,
				rank: 0,
				type: s.type,
				x,
				y: d.terrain.heightAt(x, z),
				z,
				orientation: rand() * Math.PI * 2,
				tilt: [],
				respawnSecs: 300,
				respawnMaxSecs: 300,
				display: s.id,
				model: s.model,
				look: s.look,
				anim: 0,
				scale: s.scale || 1,
				displayScale: s.scale || 1,
				equipment: 0,
				equipItems: [],
				standState: 0,
				emoteState: 0,
				sheathState: 0,
				movementType: 0,
				wanderDistance: 0,
				waypoints: [],
				pathFromTemplate: false,
				events: [],
				pool: 0,
				poolLimit: 0,
				poolName: '',
				poolChance: 0,
				poolElsewhere: 0,
				motherPool: 0,
				motherLimit: 0,
				motherSize: 0,
				motherName: '',
				leader: 0,
				followDist: 0,
				followAngle: 0,
				groupFlags: 0,
			}),
		)
	}
	return out
}

/** Four of the `palette` tilesets on every paint chunk, blended by overlapping waves, and holes in a share of the cells. */
function heavyPaint(d: MapDocument, palette: string[], rand: () => number, holeShare: number) {
	d.meta.palette = palette
	const t = d.terrain
	const chunks = t.paintChunksPerSide
	for (let c = 0; c < chunks * chunks; c++) {
		const first = Math.floor(rand() * palette.length)
		for (let k = 0; k < SLOTS; k++) t.chunkSlots[c * SLOTS + k] = (first + k * 2) % palette.length
	}
	const R = t.splatRes
	const f = (Math.PI * 2 * 9) / R
	for (let j = 0; j < R; j++) {
		for (let i = 0; i < R; i++) {
			// Four overlapping waves, so every texel blends all four layers by a different amount.
			const w = [1.2 + Math.sin(i * f), 1.2 + Math.cos(j * f), 1.2 + Math.sin((i + j) * f * 0.7), 1.2 + Math.cos((i - j) * f * 1.3)]
			const sum = w[0] + w[1] + w[2] + w[3]
			const o = (j * R + i) * SLOTS
			let left = 255
			for (let k = 0; k < SLOTS - 1; k++) {
				const v = Math.round((w[k] / sum) * 255)
				t.weights[o + k] = v
				left -= v
			}
			t.weights[o + SLOTS - 1] = Math.max(0, left)
		}
	}
	t.markSplatDirty()
	// Holes in clusters of a paint chunk's quarter, as caves and pits would cut them.
	const cells = t.size
	const quarter = CHUNK_CELLS / 2
	const clusters = Math.round((cells / quarter) * (cells / quarter) * holeShare)
	for (let n = 0; n < clusters; n++) {
		const x0 = Math.floor(rand() * (cells / quarter)) * quarter
		const z0 = Math.floor(rand() * (cells / quarter)) * quarter
		for (let z = z0; z < z0 + quarter; z++) for (let x = x0; x < x0 + quarter; x++) t.holes[z * cells + x] = 1
	}
	t.touchHoles()
	t.markAllDirty()
}

const LIQUIDS = [LIQUID_WATER, LIQUID_OCEAN, LIQUID_MAGMA, LIQUID_SLIME]

/**
 * Liquid layers on `share` of the chunks, every type, and a second layer over half of those, as
 * overlapping pools would be. Each surface lies a few yards over the chunk's highest ground.
 */
function liquids(d: MapDocument, share: number, rand: () => number) {
	const map = d.liquids
	const t = d.terrain
	const span = LIQUID_CELLS * t.cellSize
	for (let r = 0; r < map.side; r++) {
		for (let c = 0; c < map.side; c++) {
			if (rand() > share) continue
			let top = -Infinity
			for (let v = 0; v < LIQUID_VERTS; v++) for (let u = 0; u < LIQUID_VERTS; u++) top = Math.max(top, t.heightAt(c * span + (u / 8) * span, r * span + (v / 8) * span))
			const id = LIQUIDS[(r + c) % LIQUIDS.length]
			const layers: LiquidLayer[] = [newLayer(id, top + 2)]
			if (rand() < 0.5) layers.push(newLayer(LIQUIDS[(r + c + 1) % LIQUIDS.length], top + 4))
			for (const l of layers) {
				l.cells.fill(1)
				// Ripple the surface so the shader's depth and slope aren't one flat value.
				for (let i = 0; i < l.heights.length; i++) l.heights[i] += Math.sin(i + r * 3 + c) * 0.4
			}
			map.set(r * map.side + c, layers)
		}
	}
}

/**
 * Opens benchmark map `kind` in a new tab: `count` of its main thing (its default times `scale` when
 * left out, see BENCH_SCALES), placed from `seed`. Resolves once the map is built; its models are
 * still loading.
 */
export async function buildBenchMap(engine: Engine, kind: BenchKind, count?: number, seed = 1, scale = 1): Promise<MapDocument> {
	const m = benchMap(kind)
	const n = count ?? Math.round(m.count * scale)
	const size = scaledSize(m, scale)
	const wmoCount = Math.round(40 * scale)
	const rand = mulberry32(seed * 7919 + BENCH_MAPS.indexOf(m))
	// Everything that reads the client happens first, so the tab opens whole.
	const isDoodad = (p: string) => DOODAD_ROOT.test(p) && !NOT_DOODAD.test(p) && !LIGHT_MODEL.test(p)
	const isLight = (p: string) => LIGHT_MODEL.test(p) && !NOT_LIGHT.test(p)
	const isBuilding = (p: string) => BUILDING.test(p)
	let same: string[] = []
	let doodads: string[] = []
	let lights: string[] = []
	let wmos: string[] = []
	if (kind === 'objects-same') {
		const all = await listAssets('m2')
		same = all.some((p) => p.toLowerCase() === SAME_TREE.toLowerCase()) ? [SAME_TREE] : await pick('m2', isDoodad, 1, rand, 'doodads')
	}
	if (kind === 'objects-mixed') doodads = await pick('m2', isDoodad, 400, rand, 'doodads')
	if (kind === 'everything') doodads = await pick('m2', isDoodad, 150, rand, 'doodads')
	if (kind === 'lights' || kind === 'everything') lights = await pick('m2', isLight, 24, rand, 'light models')
	if (kind === 'wmo' || kind === 'everything') wmos = await pick('wmo', isBuilding, 40, rand, 'buildings')
	const displays = kind === 'creatures' ? await pickDisplays(60) : kind === 'everything' ? await pickDisplays(30) : []
	let palette: string[] = []
	if (kind === 'terrain') {
		const tilesets = (await listAssets('tileset')).filter((p) => !/expansion|\\pvp\\/i.test(p))
		if (!tilesets.length) throw new Error('benchmark map: the client has no tilesets (is the WoW folder set?)')
		palette = spread(tilesets, 8, rand)
	}

	let spawns: vmangos.WorldSpawn[] = []
	const d = engine.newDocument(size, m.terrain, seed, `Bench ${m.label}${scale > 1 ? ` ${scale}x` : ''}`, (d) => {
		switch (kind) {
			case 'objects-same':
				scatter(d, same, n, rand)
				break
			case 'objects-mixed':
				scatter(d, doodads, n, rand)
				break
			case 'wmo':
				buildings(d, wmos, n, rand)
				break
			case 'lights':
				scatter(d, lights, n, rand, 8, [0.9, 1.1])
				break
			case 'creatures':
				spawns = creatures(d, n, displays, rand)
				break
			case 'terrain':
				// The sea would cover the low ground the paint is on.
				d.meta.waterEnabled = false
				heavyPaint(d, palette, rand, 0.02)
				break
			case 'water':
				d.meta.waterEnabled = true
				liquids(d, 0.7, rand)
				break
			case 'everything':
				buildings(d, wmos, wmoCount, rand)
				scatter(d, doodads, n, rand)
				scatter(d, lights, Math.round(n / 10), rand, 8, [0.9, 1.1])
				liquids(d, 0.15, rand)
				spawns = creatures(d, Math.round(n / 4), displays, rand)
				break
		}
	})
	if (spawns.length) engine.setSpawns(d, spawns)
	return d
}

/**
 * The view a benchmark map is measured from: the camera flying over a corner, looking across the
 * map's middle from a third of its width away, so most of what it holds is in view and in the
 * distance. With `followGround` off, the camera stands where the view's point is.
 */
export function benchView(engine: Engine, kind: BenchKind) {
	const m = benchMap(kind)
	const t = engine.terrain
	const w = t.worldSize
	const x = viewSpot(w)
	const z = x
	const ground = t.heightAt(x, z)
	const c = engine.controller
	c.setFollowGround(false)
	// yaw: where the camera sits from what it looks at; -3π/4 puts it at -x, -z, looking to the middle.
	const floor = editor.waterEnabled ? Math.max(ground, editor.waterLevel) : ground
	c.setView(x, floor + (m.kind === 'creatures' ? 30 : 70), z, (-3 * Math.PI) / 4, 0.3, 1)
}

/**
 * Help › Benchmark Maps: opens benchmark map `kind` in a new tab, at its hour (which sets the time of
 * day pref, as loading a scene does) and from its view. The tab can be saved as any map.
 */
export async function openBenchMap(engine: Engine, kind: BenchKind, scale = 1) {
	const m = benchMap(kind)
	setStatus(`Building the ${m.label} benchmark map…`, 0)
	try {
		await buildBenchMap(engine, kind, undefined, 1, scale)
		prefs.dayCycle = false
		prefs.timeOfDay = m.hour
		benchView(engine, kind)
		setStatus(`${m.label} benchmark map: ${m.stresses}. Help › Copy Performance Report measures it.`)
	} catch (err) {
		setStatus(`Couldn't build the ${m.label} benchmark map: ${err instanceof Error ? err.message : err}`)
	}
}
