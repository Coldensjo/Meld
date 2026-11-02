// The Biome Brush (#958) on a flat map: two biomes painted side by side go into the map's biomes and its biome map, their border blends over the border width instead of stepping, every chunk keeps four textures at most, the first biome's scatter lands only on its own cells, one undo takes a stroke back (cells, paint and the biome it added) and redo brings it back, Ctrl takes a biome off and leaves the paint, Update Biomes from Mine and Repaint repaints with a changed biome as one step, and the biomes and biome map survive a save through Go (format 9).
// touches: frontend/src/lib/tools/BiomeBrushTool.ts, frontend/src/lib/terrain/biomeMap.ts, frontend/src/lib/terrain/biome.ts, frontend/src/lib/io/mapData.ts, frontend/src/components/options/BiomeOptions.svelte, internal/mapfile/mapfile.go
const e = P.e
const { editor, prefs } = await P.state()
e.newDocument(128, 'flat', 1, 'Probe')
await P.frames(1)
editor.waterEnabled = false
const t = e.terrain
const R = t.splatRes
const S = t.size
const side = t.paintChunksPerSide
const per = R / side
const ts = t.worldSize / R
const cs = t.cellSize

// Colour swatches stand in for the client's textures; helper cubes for its models.
const rules = { rock: [25, 35], dirt: [15, 22], lush: 0.5, variation: 260, sand: 1.2, snow: null }
const A = {
	name: 'Probe red',
	textures: ['#a03030', '', '', '#808080', '', ''],
	rules,
	effects: {},
	scatter: [{ brush: { name: 'Cubes', spacing: 1, entries: [{ type: 'helper:cube:1', weight: 10, scaleMin: 1, scaleMax: 1, sink: 0, tilt: 0, align: 0 }] }, density: 30, clumps: false }],
}
const B = { name: 'Probe blue', textures: ['#3030a0', '#30a030', '#a0a030', '#a030a0', '', ''], rules, effects: {}, scatter: [] }
const was = { biomes: prefs.biomes, biome: prefs.biome, border: prefs.biomeBorder, scatter: prefs.biomeScatter, radius: editor.brush.radius, shape: editor.brush.shape }
prefs.biomes = [A, B]
prefs.biomeBorder = 16
prefs.biomeScatter = true
editor.brush.radius = 40
editor.brush.shape = 'circle'
editor.tool = 'biome'
await P.frames(2)
const tool = e.debug.tools.biome

/** The palette index of the texture with the most weight at world (x, z), and the weight of `tex` there. */
const texel = (x, z) => Math.min(R - 1, Math.floor(z / ts)) * R + Math.min(R - 1, Math.floor(x / ts))
function weightOf(p, tex) {
	const c = Math.floor(Math.floor(p / R) / per) * side + Math.floor((p % R) / per)
	for (let k = 0; k < 4; k++) if (t.chunkSlots[c * 4 + k] === tex) return t.weights[p * 4 + k]
	return 0
}
function dominant(x, z) {
	const p = texel(x, z)
	const c = Math.floor(Math.floor(p / R) / per) * side + Math.floor((p % R) / per)
	let best = 0
	for (let k = 1; k < 4; k++) if (t.weights[p * 4 + k] > t.weights[p * 4 + best]) best = k
	return editor.palette[t.chunkSlots[c * 4 + best]]
}
const cubes = () => e.objects.list().filter((o) => o.type === 'helper:cube:1')
const count = (v) => t.biomeMap.reduce((n, x) => n + (x === v ? 1 : 0), 0)

// Biome A along z = 200, then B along z = 270: B's circle takes A's cells from about z = 230.
prefs.biome = A.name
const strokeA = await P.stroke(tool, { x: 100, z: 200 }, { x: 260, z: 200 }, 16)
const afterA = { cells: count(1), cubes: cubes(), label: e.history.peek()?.label }
const cubesOff = afterA.cubes.filter((o) => t.biomeMap[Math.floor(o.z / cs) * S + Math.floor(o.x / cs)] !== 1).length
const weightsA = Uint8Array.from(t.weights)
const steps = e.history.position
prefs.biome = B.name
const strokeB = await P.stroke(tool, { x: 100, z: 270 }, { x: 260, z: 270 }, 16)
const oneStep = e.history.position === steps + 1
const red = editor.palette.indexOf('#a03030')
const blue = editor.palette.indexOf('#3030a0')
const painted = { biomes: editor.mapBiomes.map((b) => b.name), a: count(1), b: count(2), deepA: dominant(180, 190), deepB: dominant(180, 290) }

// Every chunk keeps four textures at most; the border chunks hold both bases.
let over4 = 0
let bothBases = 0
for (let c = 0; c < side * side; c++) {
	const used = new Set()
	for (let k = 0; k < 4; k++) if (t.chunkSlots[c * 4 + k] !== 255) used.add(t.chunkSlots[c * 4 + k])
	if (used.size > 4) over4++
	if (used.has(red) && used.has(blue)) bothBases++
}
// Down the column x = 180, the red falls from full to none over several texels, not in one step.
let blended = 0
let fullAbove = 0
for (let z = 180; z < 290; z += ts) {
	const w = weightOf(texel(180, z), red)
	if (w > 40 && w < 215) blended++
	if (z < 200 && w === 255) fullAbove++
}

e.history.undo()
await P.frames(1)
let undone = 0
for (let i = 0; i < t.weights.length; i++) if (t.weights[i] !== weightsA[i]) undone++
const undo = { weights: undone, cellsB: count(2), biomes: editor.mapBiomes.length }
e.history.redo()
await P.frames(1)
const redo = { cellsB: count(2), biomes: editor.mapBiomes.length }

// Ctrl takes biome A off a spot deep inside it: the cells go, the paint there stays.
const before = Uint8Array.from(t.weights)
const V3 = e.controller.target.constructor
editor.brush.radius = 10
tool.onDown(e.debug.ctx, new V3(180, 0, 190), { ctrlKey: true })
tool.tick(e.debug.ctx, 0.05, new V3(180, 0, 190))
await P.frames(1)
tool.onUp(e.debug.ctx)
await P.frames(1)
const erased = { cell: t.biomeMap[Math.floor(190 / cs) * S + Math.floor(180 / cs)], same: weightOf(texel(180, 190), red) === 255 && before[texel(180, 190) * 4] === t.weights[texel(180, 190) * 4] }

// The preferences' A gets a teal base: Update Biomes from Mine and Repaint takes it, as one step.
prefs.biomes = [{ ...A, textures: ['#30a0a0', '', '', '#808080', '', ''] }, B]
const repaintSteps = e.history.position
const repaintStatus = e.repaintBiomes(prefs.biomeBorder, prefs.biomes)
await P.frames(1)
const repaint = { step: e.history.position === repaintSteps + 1, deepA: dominant(240, 200), base: editor.mapBiomes[0].textures[0] }
e.history.undo()
await P.frames(1)
repaint.undone = dominant(240, 200) === '#a03030' && editor.mapBiomes[0].textures[0] === '#a03030'

// The biomes and the biome map through a save and a load in Go (format 9).
const map = Uint8Array.from(t.biomeMap)
const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
const App = window.go.main.App
const raw = await App.LoadMap(await App.SaveSceneMap(toMapData(e.snapshot())))
e.openDocument(fromMapData(raw), '')
await P.frames(1)
const t2 = e.terrain
let mapSame = t2 !== t && t2.biomeMap.length === map.length
for (let i = 0; mapSame && i < map.length; i++) if (t2.biomeMap[i] !== map[i]) mapSame = false
const saved = { version: raw.version, biomes: editor.mapBiomes.map((b) => b.name), mapSame }

prefs.biomes = was.biomes
prefs.biome = was.biome
prefs.biomeBorder = was.border
prefs.biomeScatter = was.scatter
editor.brush.radius = was.radius
editor.brush.shape = was.shape
editor.tool = 'select'
await P.frames(1)

return {
	ok:
		afterA.cells > 100 &&
		afterA.cubes.length > 5 &&
		cubesOff === 0 &&
		oneStep &&
		painted.biomes.join() === `${A.name},${B.name}` &&
		painted.b > 100 &&
		painted.deepA === '#a03030' &&
		(painted.deepB === '#3030a0' || painted.deepB === '#30a030') &&
		over4 === 0 &&
		bothBases > 0 &&
		blended >= 4 &&
		fullAbove > 0 &&
		undo.weights === 0 &&
		undo.cellsB === 0 &&
		undo.biomes === 1 &&
		redo.cellsB === painted.b &&
		redo.biomes === 2 &&
		erased.cell === 0 &&
		erased.same &&
		repaint.step &&
		repaint.deepA === '#30a0a0' &&
		repaint.base === '#30a0a0' &&
		repaint.undone &&
		saved.version === 9 &&
		saved.biomes.length === 2 &&
		saved.mapSame,
	label: afterA.label,
	strokeMs: { a: strokeA.tickMs, b: strokeB.tickMs },
	afterA: { cells: afterA.cells, cubes: afterA.cubes.length, cubesOff },
	painted,
	over4,
	bothBases,
	blended,
	fullAbove,
	undo,
	redo,
	erased,
	repaintStatus,
	repaint,
	saved,
}
