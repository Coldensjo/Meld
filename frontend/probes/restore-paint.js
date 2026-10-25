// Terrain › Restore the Client's Paint (#645): in a throwaway client, a spot of an Azeroth 31_50 chunk (a tile not in
// Meld's patch) is painted and compiled, so the patch holds that chunk rewritten. The region is opened again from the
// patch, the painted chunk selected and restored: one undo step, which undo takes back and redo puts again. Compiled
// once more, every chunk's layers and alpha bytes are the client's own, as they were before the first compile. The
// real client is left alone.
// touches: frontend/src/lib/terrain/restorePaint.ts, frontend/src/lib/io/region.ts, frontend/src/lib/io/compile.ts, internal/vmangos/region.go
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

/** The chunks of `a` whose layers or alpha bytes differ from `b`'s. */
function differing(a, b) {
	const out = []
	for (const c of a) {
		const o = b.find((d) => d.x === c.x && d.y === c.y)
		const same = o && c.layers.join('|') === o.layers.join('|') && c.maps.every((m, l) => m.every((v, i) => v === o.maps[l][i]))
		if (!same) out.push(`${c.x},${c.y}`)
	}
	return out
}

/** Opens Azeroth 31_50 in a new tab, closing any tab of it first. */
async function open() {
	for (const d of [...P.e.documents]) if (d.meta.region?.mapName === 'Azeroth' && d.meta.region.x === 31) P.e.closeDocument(d.id)
	regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
	await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')
}

const before = await read()
await open()
// Paint a 4x4-texel spot of a chunk with three layers or more to its base texture, and compile it.
const target = before.find((c) => c.layers.length >= 3 && c.x > 0 && c.y > 0) ?? before.find((c) => c.layers.length >= 2)
const res = 16 * 32
const paintSpot = () => {
	const t = P.e.terrain
	for (let v = 6; v < 10; v++) for (let u = 10; u < 14; u++) t.weights.set([255, 0, 0, 0], ((target.y * 32 + v) * res + target.x * 32 + u) * 4)
}
paintSpot()
await compileIo.compileRegion(P.e, 'client')
const painted = differing(await read(), before)
if (!painted.includes(`${target.x},${target.y}`)) bad.push(`the first compile did not change chunk ${target.x},${target.y} (${painted.join(' ')})`)

// Open it again from the patch, and restore the painted chunk.
await open()
const t = P.e.terrain
const weightsOf = () => t.weights.slice(((target.y * 32 + 6) * res + target.x * 32) * 4, ((target.y * 32 + 10) * res + target.x * 32 + 32) * 4)
const patched = weightsOf()
editor.selection = { x0: target.x * 8, z0: target.y * 8, x1: target.x * 8 + 8, z1: target.y * 8 + 8 }
await regionIo.restoreClientPaint(P.e)
const restored = weightsOf()
if (restored.every((v, i) => v === patched[i])) bad.push('the restore changed nothing in the painted chunk')
P.e.history.undo()
if (!weightsOf().every((v, i) => v === patched[i])) bad.push('one undo did not take the restore back')
P.e.history.redo()
if (!weightsOf().every((v, i) => v === restored[i])) bad.push('redo did not put the restore back')
editor.selection = null

await compileIo.compileRegion(P.e, 'client')
const left = differing(await read(), before)
if (left.length) bad.push(`after the restore and compile, chunks differ from the client's own: ${left.slice(0, 8).join(' ')}`)

const end = await P.endSandbox()
if (!end.realUnchanged) bad.push('the real client patch changed')
return { ok: bad.length === 0, bad: bad.slice(0, 8), target: { x: target.x, y: target.y, layers: target.layers.length }, painted, sandbox: sb.dataDir }
