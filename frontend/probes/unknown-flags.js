// A region opened without the client's liquids or chunk data (a .wmap older than version 4 or 5) keeps saying so across a save (#525): saved through the Go side and opened again, MapDocument.liquidsKnown and chunkDataKnown stay false, the file's header has liquidsUnknown and chunkDataUnknown, and Map Properties names them under "The client's"; a region that has them writes neither flag. Such a region still compiles its holes, in chunk headers without an area ID, impassable flag or no-tuft rows (#644).
const { editor, ui } = await P.state()
const { toMapData, fromMapData } = await P.app('/src/lib/io/mapData.ts')
const { mapToTiles } = await P.app('/src/lib/io/vmangosExport.ts')
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

// Known (a region opened from the client): neither flag is written.
const known = await roundTrip()
if (known.liquidsUnknown || known.chunkDataUnknown) bad.push(`a known region wrote liquidsUnknown ${known.liquidsUnknown}, chunkDataUnknown ${known.chunkDataUnknown}`)
if (!P.e.activeDocument().liquidsKnown || !P.e.activeDocument().chunkDataKnown) bad.push('a known region came back unknown')

// Unknown, as a version 3 file opens: saved twice, it stays unknown.
P.e.activeDocument().liquidsKnown = false
P.e.activeDocument().chunkDataKnown = false
for (const pass of [1, 2]) {
	const raw = await roundTrip()
	if (raw.version !== 6) bad.push(`pass ${pass}: read back as version ${raw.version}`)
	if (!raw.liquidsUnknown || !raw.chunkDataUnknown) bad.push(`pass ${pass}: header has liquidsUnknown ${raw.liquidsUnknown}, chunkDataUnknown ${raw.chunkDataUnknown}`)
	const d = P.e.activeDocument()
	if (d.liquidsKnown || d.chunkDataKnown) bad.push(`pass ${pass}: reopened with liquidsKnown ${d.liquidsKnown}, chunkDataKnown ${d.chunkDataKnown}`)
	if (!P.e.regionLiquids().partial) bad.push(`pass ${pass}: the region's liquids would replace the client's`)
	if (P.e.exportInput().headers) bad.push(`pass ${pass}: the export sends chunk headers`)
}

// Its holes still go, in headers that keep the client's zone, flag and no-tuft cells (#644). Cell
// (8, 8) is the first tile's chunk 17, row 0, bit 0; the tab is closed below, so no undo is needed.
const t = P.e.terrain
t.holes[8 * t.size + 8] = 1
const headers = mapToTiles(P.e.exportInput()).tiles[0].Headers
const h17 = headers?.[17]
if (!h17) bad.push('a region without chunk data compiles no chunk headers, so its holes are dropped')
else {
	if (h17.holes?.[0] !== 1) bad.push(`chunk 17 sends holes ${JSON.stringify(h17.holes)}`)
	if (h17.areaId !== 0 || 'impassable' in h17 || 'noEffect' in h17) bad.push(`chunk 17's header overwrites the client's chunk data: ${JSON.stringify({ ...h17, holes: undefined, shadow: undefined })}`)
}

// Map Properties says what the region leaves to the client.
ui.dialog = 'mapProps'
await P.frames(2)
const dialog = P.dialog('Map Properties')
const text = dialog?.textContent ?? ''
if (!dialog) bad.push('Map Properties did not open')
else if (!text.includes("The client's") || !text.includes('liquids') || !text.includes('no-tuft cells')) bad.push(`Map Properties does not name the client's liquids and chunk data: ${text.slice(0, 200)}`)
ui.dialog = null
await P.frames(1)

for (const id of opened) P.e.closeDocument(id)
return { ok: bad.length === 0, bad, region: editor.region }
