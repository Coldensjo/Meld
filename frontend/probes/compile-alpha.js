// Compile keeps the client's alpha maps where nothing was painted (#526): in a throwaway client, Azeroth 31_50 (not in
// Meld's patch) is opened, a 2x2-texel spot of one chunk is painted to its base texture (straight into the weights) and
// the region is compiled to the client. Read back, every other chunk's layers and alpha bytes are the client's as they
// were, and the painted chunk's differ only in the spot's 4x4 alpha texels (the editor's texels are 2x2 of the
// client's); before #526 every layered chunk came back at half resolution. The real client is left alone.
// touches: frontend/src/lib/io/region.ts, frontend/src/lib/io/compile.ts, frontend/src/lib/terrain/alphamap.ts, app.go, internal/adt/*, internal/vmangos/region.go
const { editor, prefs } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
const App = window.go.main.App
const bad = []
const sb = await P.sandboxClient()
prefs.checkBeforeCompile = false

/** The region's chunks as LoadRegion reads them from the (throwaway) client: each chunk's textures and alpha maps. */
async function read() {
	const view = await App.LoadRegion('Azeroth', 31, 50, 1)
	const alpha = view.alphaUrl ? new Uint8Array(await (await fetch(view.alphaUrl)).arrayBuffer()) : new Uint8Array(0)
	let at = 0
	return view.chunks.map((c) => {
		const layers = (c.layers ?? []).map((l) => l.texture)
		const maps = layers.slice(1).map(() => alpha.subarray(at, (at += 4096)))
		return { x: c.indexX, y: c.indexY, layers, maps }
	})
}

const before = await read()
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

// Paint a 2x2-texel spot of a chunk with three layers or more to its base texture.
const target = before.find((c) => c.layers.length >= 3 && c.x > 0 && c.y > 0) ?? before.find((c) => c.layers.length >= 2)
const t = P.e.terrain
const res = 16 * 32
const [u0, v0] = [10, 6]
for (let v = v0; v < v0 + 2; v++) {
	for (let u = u0; u < u0 + 2; u++) {
		const i = ((target.y * 32 + v) * res + target.x * 32 + u) * 4
		t.weights.set([255, 0, 0, 0], i)
	}
}
await compileIo.compileRegion(P.e, 'client')
const after = await read()

let keptChunks = 0
let changedTexels = 0
for (const a of after) {
	const b = before.find((c) => c.x === a.x && c.y === a.y)
	if (a.layers.join('|') !== b.layers.join('|')) {
		bad.push(`chunk ${a.x},${a.y} layers ${a.layers.length} were ${b.layers.length}`)
		continue
	}
	const painted = a === after.find((c) => c.x === target.x && c.y === target.y)
	let differ = 0
	for (let l = 0; l < a.maps.length; l++) {
		for (let i = 0; i < 4096; i++) {
			if (a.maps[l][i] === b.maps[l][i]) continue
			const x = i % 64
			const y = Math.floor(i / 64)
			const inSpot = x >= u0 * 2 && x < (u0 + 2) * 2 && y >= v0 * 2 && y < (v0 + 2) * 2
			if (!painted || !inSpot) differ++
			else changedTexels++
		}
	}
	if (differ) bad.push(`chunk ${a.x},${a.y}${painted ? ' (painted, outside the spot)' : ''}: ${differ} alpha texels changed`)
	else if (!painted) keptChunks++
}
if (!changedTexels) bad.push('the painted spot did not change')

const end = await P.endSandbox()
if (!end.realUnchanged) bad.push('the real client patch changed')
return { ok: bad.length === 0, bad: bad.slice(0, 8), target: { x: target.x, y: target.y, layers: target.layers.length }, keptChunks, changedTexels, sandbox: sb.dataDir }
