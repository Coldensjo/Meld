// A liquid layer's kind is kept in the map file (#540): a layer of row 30, which no 1.12 client table holds, given the kind magma, is saved through the Go side with the header's liquidKinds {"30": "magma"}, reads back with that kind and the layer's ID, and exports as magma (type 3) rather than as water; a map without such a layer writes no liquidKinds.
// touches: frontend/src/lib/io/mapData.ts, frontend/src/lib/water/liquids.ts, internal/mapfile/*
const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
const liquids = await P.app('/src/lib/water/liquids.ts')
const App = window.go.main.App
const bad = []

await P.scene(P.BENCH)
const opened = []
/** Saves the active map through Go and opens it again in a new tab; gives the raw MapData read back. */
async function roundTrip() {
	const path = await App.SaveSceneMap(toMapData(P.e.snapshot()))
	const raw = await App.LoadMap(path)
	P.e.openDocument(fromMapData(raw), '')
	opened.push(P.e.activeDocumentId())
	await P.frames(1)
	return raw
}

// A copy of the bench map, which has no building liquid: no kinds are written.
const plain = await roundTrip()
if (plain.liquidKinds) bad.push(`a map without building liquids wrote liquidKinds ${JSON.stringify(plain.liquidKinds)}`)

// In the copy (closed below, so no undo is needed), chunk 0 gets a layer of row 30 as magma.
if (liquids.LIQUID_TYPES.some((t) => t.id === 30)) bad.push('the client table holds row 30; pick another ID for the probe')
liquids.rememberLiquidKinds({ 30: 'magma' })
const d = P.e.activeDocument()
const layer = liquids.newLayer(30, P.e.terrain.heights[0] + 2)
layer.cells.fill(1)
d.liquids.set(0, [...d.liquids.layers(0).filter((l) => l.id !== 30), layer])
const raw = await roundTrip()
if (raw.liquidKinds?.['30'] !== 'magma') bad.push(`the header's liquidKinds is ${JSON.stringify(raw.liquidKinds)}, not {"30":"magma"}`)
const back = fromMapData(raw)
if (back.liquidKinds?.[30] !== 'magma') bad.push(`read back as ${JSON.stringify(back.liquidKinds)}`)
const reopened = P.e
	.activeDocument()
	.liquids.layers(0)
	.find((l) => l.id === 30)
if (!reopened) bad.push('the reopened map lost the row 30 layer')
const exported = liquids
	.liquidsToAdt(P.e.activeDocument().liquids)
	.filter((a) => a.indexX === 0 && a.indexY === 0)
	.map((a) => a.type)
if (!exported.includes(liquids.LIQUID_MAGMA)) bad.push(`chunk 0 exports types ${JSON.stringify(exported)}, not magma (3)`)

for (const id of opened) P.e.closeDocument(id)
return { ok: bad.length === 0, bad, kinds: raw.liquidKinds, exported }
