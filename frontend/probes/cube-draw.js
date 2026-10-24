// Drawing cube worlds (#30): the fixture (crates/world/tests/fixtures/small.world) and a themed world draw their chunks' meshes (lib/cubes/CubeLayer.ts, built a few a frame, merged in batches of 4 x 4 chunks, #67) with as many triangles as the mesher gives, the camera's bounds fit the world, and the layer slice (ui.cubeSlice, View › Layer slice) moved through every layer in both directions shows only the layers it leaves, capping the cut layer, and changes the picture. Paths are relative to the Go process, which runs in editor/.
const e = P.e
const App = window.go?.main?.App
if (!App?.LoadWorld) throw new Error('no Go bindings on the page (cube worlds need the backend)')
const mapio = await P.app('/src/lib/io/mapio.ts')
const mesher = await P.app('/src/lib/cubes/mesher.ts')
const { CubeWorld, LAYER_COUNT } = await P.app('/src/lib/cubes/world.ts')
const { ui } = await P.state()

/** The triangles the mesher gives the whole world, chunk by chunk. */
function expected(w, layers = null, cap = null) {
	let n = 0
	for (const key of w.chunks.keys()) {
		const cx = key % w.chunksX
		const cz = Math.floor(key / w.chunksX) % w.chunksZ
		const l = Math.floor(key / (w.chunksX * w.chunksZ))
		if (layers && !layers(l)) continue
		n += mesher.triangles(mesher.meshChunk(w, cx, cz, l))
		if (cap && l === cap.layer) n += mesher.triangles(mesher.meshChunk(w, cx, cz, l, cap.kind))
	}
	return n
}

const r = {}
ui.cubeSlice = { mode: 'off', layer: 10 }

// The fixture: five chunks, drawn once the frames have built them.
await mapio.openPath(e, '../crates/world/tests/fixtures/small.world')
await P.frames(3)
let d = e.activeDocument()
r.fixtureInScene = !!d.cubes && d.cubes.group.parent === e.scene && d.cubes.pending === 0
r.fixtureTriangles = d.cubes.drawn().triangles === expected(d.world) && d.cubes.drawn().triangles > 0
r.bounds = Math.abs(e.controller.bounds - d.cubes.extent) < 1e-6 && d.cubes.extent === 32 * 3

// A themed world 4 x 4 chunks: built a few chunks a frame, so it may take more than one.
const w = CubeWorld.create(4, 4, true)
e.openWorld(w, 'Probe slice', '')
d = e.activeDocument()
const cubes = d.cubes
await P.until(() => cubes.pending === 0, 60_000, 'the themed world built')
await P.frames(1)
r.themedTriangles = cubes.drawn().triangles === expected(w)
// Batched (#67): a mesh a part for each 4 x 4 chunks of a layer, so ten times fewer than a mesh a chunk part.
let chunkMeshes = 0
for (const key of w.chunks.keys()) chunkMeshes += mesher.meshChunk(w, key % w.chunksX, Math.floor(key / w.chunksX) % w.chunksZ, Math.floor(key / (w.chunksX * w.chunksZ))).filter((p) => p).length
r.meshes = { batched: cubes.drawn().meshes, chunkParts: chunkMeshes }
r.batched = cubes.drawn().meshes * 10 <= chunkMeshes
// The other tab's meshes left the scene with it.
r.oneWorldInScene = e.scene.children.filter((c) => c.name === 'cubes').length === 1
const whole = await P.shot()

// Every layer, both ways: the drawn triangles are the kept layers' plus the cut layer's caps.
const wrong = []
for (const mode of ['below', 'above']) {
	for (let n = 0; n < LAYER_COUNT; n++) {
		cubes.update({ mode, layer: n }, 0)
		const keep = mode === 'below' ? (l) => l >= n : (l) => l <= n
		const capKind = mode === 'below' ? mesher.CAP_TOP : mesher.CAP_BOTTOM
		const edge = mode === 'below' ? n === 0 : n === LAYER_COUNT - 1
		const want = expected(w, keep, edge ? null : { layer: n, kind: capKind })
		const got = cubes.drawn()
		if (got.triangles !== want) wrong.push(`${mode} ${n}: ${got.triangles} != ${want}`)
	}
}
r.everyLayer = wrong.length === 0
if (wrong.length) r.wrong = wrong.slice(0, 5)

// Through the engine's frame: layer 16 and below shows the stone's cut top, a whole layer of squares.
ui.cubeSlice = { mode: 'below', layer: 16 }
await P.frames(1)
r.capped = cubes.drawn().caps === 16 * 256 * 2
const sliced = await P.shot()
P.save(whole, 'whole')
P.save(sliced, 'below-16')
r.pictureChanged = P.diff(whole, sliced).off > 0.05
ui.cubeSlice = { mode: 'off', layer: 16 }
await P.frames(1)
r.offAgain = cubes.drawn().caps === 0 && cubes.drawn().triangles === expected(w)
e.closeDocument(d.id)
r.disposed = !cubes.group.parent
return { ok: Object.values(r).every((v) => typeof v !== 'boolean' || v), ...r }
