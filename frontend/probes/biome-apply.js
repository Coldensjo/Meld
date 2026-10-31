// Paint › Apply Biome (#957) over a selected area on a Hills map: the biome's textures go into the palette and paint only inside the area (rock on the steep ground), its ground effect becomes the map's own, its doodad brush scatters only inside, and one undo takes all of it back, palette and models too; redo brings it back. Then the Biomes dialog opens from Paint › Biomes….
// touches: frontend/src/lib/terrain/biome.ts, frontend/src/lib/terrain/autoPaint.ts, frontend/src/lib/engine/terrainOps.ts, frontend/src/components/BiomesDialog.svelte, frontend/src/lib/state/historyCore.ts, frontend/src/lib/terrain/activeBiome.ts
const e = P.e
const { editor, prefs, ui } = await P.state()
e.newDocument(128, 'mountains', 5, 'Probe')
await P.frames(1)
const t = e.terrain
const R = t.splatRes
const tpc = R / t.size
const cs = t.cellSize
const sel = { x0: 32, z0: 32, x1: 96, z1: 96 }
editor.selection = { ...sel }
await P.frames(1)

// Colour swatches stand in for the client's textures; helper cubes for its models.
const textures = ['#a03030', '', '#3030a0', '#808080', '', '']
const biome = {
	name: 'Probe biome',
	textures,
	rules: { rock: [25, 35], dirt: [15, 22], lush: 0.5, variation: 260, sand: 1.2, snow: null },
	effects: { '#a03030': 0 },
	scatter: [{ brush: { name: 'Cubes', spacing: 1, entries: [{ type: 'helper:cube:1', weight: 10, scaleMin: 1, scaleMax: 1, sink: 0, tilt: 0, align: 0 }] }, density: 30, clumps: false }],
}
const paletteBefore = [...editor.palette]
const weightsBefore = Uint8Array.from(t.weights)
const objectsBefore = e.objects.objects.size
const steps = e.history.position
const status = await e.applyBiome(biome, false)
await P.frames(1)
const palette = [...editor.palette]
const red = palette.indexOf('#a03030')
const grey = palette.indexOf('#808080')
const blue = palette.indexOf('#3030a0')

// Texels changed outside the area's chunks (none may), and the share of the area's middle painted red or grey.
let outside = 0
let inner = 0
let biomeTex = 0
const per = R / t.paintChunksPerSide
for (let z = 0; z < R; z++) {
	for (let x = 0; x < R; x++) {
		const b = (z * R + x) * 4
		let same = true
		for (let k = 0; k < 4; k++) if (t.weights[b + k] !== weightsBefore[b + k]) same = false
		const inChunks = x >= Math.floor((sel.x0 * tpc) / per) * per && x < Math.ceil((sel.x1 * tpc) / per) * per && z >= Math.floor((sel.z0 * tpc) / per) * per && z < Math.ceil((sel.z1 * tpc) / per) * per
		if (!same && !inChunks) outside++
		if (x > (sel.x0 + 8) * tpc && x < (sel.x1 - 8) * tpc && z > (sel.z0 + 8) * tpc && z < (sel.z1 - 8) * tpc) {
			inner++
			const c = Math.floor(z / per) * t.paintChunksPerSide + Math.floor(x / per)
			let best = 0
			for (let k = 1; k < 4; k++) if (t.weights[b + k] > t.weights[b + best]) best = k
			const tex = t.chunkSlots[c * 4 + best]
			if (tex === red || tex === grey || tex === blue) biomeTex++
		}
	}
}
let placedOutside = 0
const placed = []
for (const o of e.objects.objects.values()) {
	if (o.type !== 'helper:cube:1') continue
	placed.push(o.id)
	if (o.x < sel.x0 * cs || o.z < sel.z0 * cs || o.x > sel.x1 * cs || o.z > sel.z1 * cs) placedOutside++
}
const oneStep = e.history.position === steps + 1
const label = e.history.peek()?.label
const effect = editor.textureEffects['#a03030']

e.history.undo()
await P.frames(1)
let undone = 0
for (let i = 0; i < t.weights.length; i++) if (t.weights[i] !== weightsBefore[i]) undone++
const undo = { weights: undone, palette: JSON.stringify(editor.palette) === JSON.stringify(paletteBefore), objects: e.objects.objects.size === objectsBefore, effect: editor.textureEffects['#a03030'] }
e.history.redo()
await P.frames(1)
const redo = { palette: editor.palette.includes('#a03030'), objects: e.objects.objects.size === objectsBefore + placed.length }

// The tile scope: the effect goes to the tiles the area touches (tile 0,0 of this 128-cell map), not the map's own, in one undo step.
const tileBiome = { ...biome, name: 'Probe tile biome', tileEffects: true, effects: { '#a03030': 7 }, scatter: [] }
const tileSteps = e.history.position
await e.applyBiome(tileBiome, false)
await P.frames(1)
const tileScope = { step: e.history.position === tileSteps + 1, tile: editor.scopedEffects.tiles['0,0']?.['#a03030'], map: editor.textureEffects['#a03030'] }
e.history.undo()
await P.frames(1)
tileScope.undone = editor.scopedEffects.tiles['0,0'] === undefined
e.history.redo()
await P.frames(1)
tileScope.redone = editor.scopedEffects.tiles['0,0']?.['#a03030'] === 7
e.history.undo()
await P.frames(1)

// The dialog opens from the menu and lists the biome.
const wasBiomes = prefs.biomes
prefs.biomes = [biome]
prefs.biome = biome.name
ui.dialog = 'biomes'
await P.frames(2)
const dialog = !!P.dialog('Biomes')
ui.dialog = null
prefs.biomes = wasBiomes
editor.selection = null
await P.frames(1)

return {
	ok:
		red >= 0 &&
		grey >= 0 &&
		outside === 0 &&
		biomeTex > inner * 0.9 &&
		placed.length > 5 &&
		placedOutside === 0 &&
		oneStep &&
		effect === 0 &&
		undo.weights === 0 &&
		undo.palette &&
		undo.objects &&
		undo.effect === undefined &&
		redo.palette &&
		redo.objects &&
		tileScope.step &&
		tileScope.tile === 7 &&
		tileScope.map === 0 &&
		tileScope.undone &&
		tileScope.redone &&
		dialog,
	status,
	label,
	outside,
	inner,
	biomeTex,
	placed: placed.length,
	placedOutside,
	oneStep,
	effect,
	undo,
	redo,
	tileScope,
	dialog,
}
