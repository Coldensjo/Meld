// File › Compile to Client / Compile to Server / Compile All and Launch's check for edits the client lacks (#214).
// Opens Azeroth 31_50 (1x1) and checks: the File menu has the three compile entries (and not the old
// Compile Region to Client), Preferences no longer has Update the Server Maps after Compile; the region
// as opened counts as compiled, a history step that changes no compile input (as a spawn edit is)
// doesn't change that, a raised vertex does and its undo takes it back; Launch with the raised vertex
// opens the Compile and Launch dialog instead of starting the game; growing the region (#318) with the
// raised vertex, or with a spawn edit counted, is refused with a status line that names Compile to
// Client or Save Spawns and keeps the tab; and for a region with no
// fingerprint (opened from a file) the Go side's RegionPending finds the raised tile, and its answer is
// kept on the document (#531): asked again with no edit, or after a step that changes no compile input,
// it is not rebuilt, and after an undo it is. It never compiles: that would write the owner's patch.
// touches: frontend/src/lib/io/region.ts, frontend/src/lib/io/compile.ts, frontend/src/lib/io/game.ts, frontend/src/components/MenuBar.svelte, internal/vmangos/pending.go, app_pending.go
// tier: smoke
const { ui, editor } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
const gameIo = await P.app('/src/lib/io/game.ts')
const menuLabels = async (name) => {
	const title = [...document.querySelectorAll('.menubar .menu > .title')].find((b) => b.textContent.trim() === name)
	title.click()
	await P.frames(1)
	const labels = [...document.querySelectorAll('.menubar .dropdown .item .label')].map((l) => l.textContent.trim())
	title.click()
	await P.frames(1)
	return labels
}
const file = await menuLabels('File')
const preferences = await menuLabels('Preferences')
const menu = {
	compile: file.filter((l) => l.startsWith('Compile')),
	oldEntry: file.includes('Compile Region to Client'),
	oldPref: preferences.includes('Update the Server Maps after Compile'),
}

regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')
const d = P.e.activeDocument()
const opened = await compileIo.regionUncompiled(P.e)
// A step that changes nothing Compile writes, as a spawn edit is.
d.history.push({ label: 'Probe step', undo() {}, redo() {} })
const afterStep = await compileIo.regionUncompiled(P.e)
const before = P.e.outerHeights()
const raised = Float32Array.from(P.e.terrain.heights)
raised[Math.floor(raised.length / 2)] += 5
P.e.setHeights(raised, 'Probe raise')
const afterRaise = await compileIo.regionUncompiled(P.e)
// Launch asks first: with the raised vertex it opens the dialog and starts nothing.
await gameIo.launchGame(P.e)
const dialog = ui.dialog
const named = ui.uncompiledRegion
ui.dialog = null
// Growing asks for a compile, not a save, and keeps the tab (#318).
const tabId = P.e.activeDocumentId()
await regionIo.extendRegion(P.e, 'e')
const growRaised = { status: ui.status, kept: P.e.activeDocumentId() === tabId, size: P.e.activeRegion()?.size }
P.e.undo()
const spawnCount = ui.spawnChanges
ui.spawnChanges = 1
await regionIo.extendRegion(P.e, 'e')
const growSpawn = { status: ui.status, kept: P.e.activeDocumentId() === tabId, size: P.e.activeRegion()?.size }
ui.spawnChanges = spawnCount
const afterUndo = await compileIo.regionUncompiled(P.e)
const restored = P.e.outerHeights().every((h, i) => h === before[i])
// No fingerprint, as for a region opened from a file: the Go side compares the build with the patch.
P.e.redo()
const key = d.compiled
d.compiled = { key: null, changes: -1 }
d.pending = null
let t = performance.now()
const pendingRaised = await compileIo.regionUncompiled(P.e)
const askMs = performance.now() - t
const asked = d.pending
t = performance.now()
const pendingAgain = await compileIo.regionUncompiled(P.e)
const cachedMs = performance.now() - t
d.history.push({ label: 'Probe step', undo() {}, redo() {} })
const pendingStep = await compileIo.regionUncompiled(P.e)
const cache = {
	askMs: Math.round(askMs),
	cachedMs: Math.round(cachedMs * 10) / 10,
	kept: d.pending === asked && asked?.files > 0 && pendingAgain === true && pendingStep === true && asked.changes === d.history.changes,
}
P.e.undo()
P.e.undo()
await compileIo.regionUncompiled(P.e)
cache.askedAgain = d.pending !== asked
d.compiled = key
d.pending = null

const out = { menu, opened, afterStep, afterRaise, dialog, named, growRaised, growSpawn, afterUndo, restored, pendingRaised, cache }
out.ok =
	menu.compile.join('|') === 'Compile to Client|Compile to Server|Compile All' &&
	!menu.oldEntry &&
	!menu.oldPref &&
	opened === false &&
	afterStep === false &&
	afterRaise === true &&
	dialog === 'compileBeforeLaunch' &&
	named === 'Azeroth 31_50' &&
	growRaised.kept &&
	growRaised.size === 1 &&
	growRaised.status.includes('Compile to Client') &&
	!growRaised.status.includes('Save Spawns') &&
	growSpawn.kept &&
	growSpawn.size === 1 &&
	growSpawn.status.includes('Save Spawns to Database') &&
	!growSpawn.status.includes('Compile to Client') &&
	afterUndo === false &&
	restored &&
	pendingRaised === true &&
	cache.kept &&
	cache.askedAgain
return out
