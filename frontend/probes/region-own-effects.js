// A region's compile keeps each chunk's own ground effects (#1033): in a throwaway client, Azeroth 28_50 (2x2, none
// of its tiles in the owner's patch) opens as it is, and its edit, with the no-tuft cells under buildings left out
// (those the page adds on purpose, the owner's choice (a) on #1033), builds to no tile at all: the page marks every
// texture's effect as only its usual one, and the compile keeps the chunk's own. The tufts read the chunk's own too:
// the block's chunk 0 grows the effects 28_50's chunk 0 has in the client, not each texture's usual one. The real
// client is left alone. The block saved to a file and opened again reads the chunks' own effects from the client
// too (#1056), which a file does not hold: its chunk 0 grows the same.
// touches: internal/adt/rewrite.go, internal/adt/effects.go, internal/adt/clientalpha.go, internal/vmangos/region.go, frontend/src/lib/io/vmangosExport.ts, frontend/src/lib/io/compile.ts, frontend/src/lib/world/groundEffects.ts, frontend/src/lib/world/GroundEffectLayer.ts, frontend/src/lib/io/region.ts, app_region.go
const { editor } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
const App = window.go.main.App
const bad = []
const sb = await P.sandboxClient()
let tiles = []
let chunk0 = []
let reopened = []
try {
	await regionIo.openWowRegion(P.e, 'Azeroth', 28, 50, 2)
	await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 28 && P.e.activeRegion()?.size === 2) || null, 180000, 'the Azeroth 28_50 2x2 tab')
	const region = P.e.activeRegion()
	// The paint and chunk headers the edit carries settle some frames after the tab opens.
	let last = ''
	for (let i = 0; i < 40; i++) {
		const now = JSON.stringify(compileIo.regionEdit(P.e, region))
		if (now === last) break
		last = now
		await P.frames(10)
	}
	const edit = compileIo.regionEdit(P.e, region)
	if (!edit.paint.every((p) => p.ownEffects?.length === p.textures.length && p.ownEffects.every(Boolean))) bad.push("a layer is not marked to keep its chunk's own effect, with no choice of the map")
	for (const p of edit.paint) delete p.noEffect
	for (const h of edit.headers) delete h.noEffect
	const res = await App.RegionPending(edit)
	tiles = (res.list ?? []).filter((f) => f.group === 'tile').map((f) => `${f.tile}: ${f.reason}`)
	if (tiles.length) bad.push(`the untouched block rewrites ${tiles.join('; ')}`)

	const grows = () => {
		const out = []
		const t = P.e.terrain
		for (let k = 0; k < 4; k++) {
			const tex = t.chunkSlots[k]
			if (tex !== 255) out.push(P.e.chunkEffect(tex, 0))
		}
		return out
	}
	const want = [3818, 473, 4118, 4158]
	chunk0 = grows()
	if ([...chunk0].sort().join() !== [...want].sort().join()) bad.push(`chunk 0 grows ${chunk0}, want the client's ${want}`)

	// The block from a file: the snapshot has no chunk effects, so the tab reads them from the client.
	const raw = await App.LoadMap(await App.SaveSceneMap(toMapData(P.e.snapshot())))
	P.e.openDocument(fromMapData(raw), '')
	const d = P.e.activeDocument()
	if (d.meta.region?.x !== 28) bad.push('the reopened tab is not the Azeroth 28_50 block')
	await P.until(() => d.clientEffects || null, 30000, "the reopened block's client effects")
	reopened = grows()
	if ([...reopened].sort().join() !== [...want].sort().join()) bad.push(`chunk 0 of the block from a file grows ${reopened}, want the client's ${want}`)
} finally {
	const end = await P.endSandbox()
	if (!end.realUnchanged) bad.push('the real client patch changed')
}
return { ok: bad.length === 0, bad, tiles, chunk0, reopened, sandbox: sb.dataDir }
