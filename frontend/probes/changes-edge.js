// The Changes window tells an edited tile from one rewritten only for its neighbour's edge (#976): in a throwaway
// client, Azeroth 28_50 (2x2, none of its tiles in the owner's patch) is opened and compiled once as it is, so the
// patch holds the block as the editor rebuilds it (a block's first compile rewrites its tiles for float noise in the
// heights, which would hide the edge). Then one vertex of 28_50 one in from its east border rises: RegionPending
// lists 28_50 as changed in the region and 29_50, whose heights stay but whose west edge's normals take 28_50's, as
// rewritten only for its edge's normals; the window shows both lines. The real client is left alone.
// touches: internal/adt/write.go, internal/vmangos/changes.go, app_region.go, frontend/src/lib/io/changeList.ts
const { editor, ui } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
const App = window.go.main.App
const bad = []
const sb = await P.sandboxClient()
let lines = []
let windowText = ''
try {
	await regionIo.openWowRegion(P.e, 'Azeroth', 28, 50, 2)
	await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 28 && P.e.activeRegion()?.size === 2) || null, 180000, 'the Azeroth 28_50 2x2 tab')
	const region = P.e.activeRegion()
	// The paint and chunk headers the edit carries settle some frames after the tab opens; an edit taken before
	// then differs from the one compiled, and every tile would read as changed.
	let last = ''
	for (let i = 0; i < 40; i++) {
		const now = JSON.stringify(compileIo.regionEdit(P.e, region))
		if (now === last) break
		last = now
		await P.frames(10)
	}
	await App.SaveRegion(compileIo.regionEdit(P.e, region))

	// The block's outer grid is 257 a side; 28_50 is its first 129 columns and rows. Column 127 is one in from its
	// east border, so 29_50's heights stay and only its west edge's normals follow.
	const side = 2 * 128 + 1
	const raised = Float32Array.from(P.e.terrain.heights)
	raised[64 * side + 127] += 5
	P.e.setHeights(raised, 'Probe raise')

	const res = await App.RegionPending(compileIo.regionEdit(P.e, region))
	lines = (res.list ?? []).filter((f) => f.group === 'tile').map((f) => `${f.tile}: ${f.reason}`)
	const reason = (tile) => (res.list ?? []).find((f) => f.tile === tile)?.reason ?? '(not listed)'
	if (reason('28_50') !== 'changed in the region') bad.push(`28_50: ${reason('28_50')}`)
	if (!reason('29_50').startsWith("only its edge's normals")) bad.push(`29_50: ${reason('29_50')}`)

	ui.dialog = 'changes'
	const box = () => [...document.querySelectorAll('[data-ui="Modal"] header h2')].find((h) => h.textContent.trim().startsWith('Changes'))?.closest('.dialog') ?? null
	await P.until(() => box()?.textContent.includes('29_50') || null, 60000, 'the Changes window lists the tiles')
	windowText = box()?.textContent ?? ''
	if (!windowText.includes("29_50: only its edge's normals")) bad.push('the window does not show 29_50 as rewritten for its edge')
} finally {
	ui.dialog = null
	const end = await P.endSandbox()
	if (!end.realUnchanged) bad.push('the real client patch changed')
}
return { ok: bad.length === 0, bad, lines, sandbox: sb.dataDir }
