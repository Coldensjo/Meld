// File › Compile to Client / Compile to Server / Compile All and Launch's check for edits the client lacks (#214).
// Opens Azeroth 31_50 (1x1) and checks: the File menu has the three compile entries (and not the old
// Compile Region to Client), Preferences no longer has Update the Server Maps after Compile; the region
// as opened counts as compiled, a history step that changes no compile input (as a spawn edit is)
// doesn't change that, a raised vertex does and its undo takes it back; Launch with the raised vertex
// opens the Compile and Launch dialog instead of starting the game; growing the region (#318) with the
// raised vertex, or with a spawn edit counted, is refused with a status line that names Compile to
// Client or Save Spawns and keeps the tab; and for a region with no
// fingerprint (opened from a file) the Go side's RegionPending finds the raised tile. It never
// compiles: that would write the owner's patch.
const { ui, editor } = await P.state()
const mapio = await P.app('/src/lib/io/mapio.ts')
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

mapio.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')
const d = P.e.activeDocument()
const opened = await mapio.regionUncompiled(P.e)
// A step that changes nothing Compile writes, as a spawn edit is.
d.history.push({ label: 'Probe step', undo() {}, redo() {} })
const afterStep = await mapio.regionUncompiled(P.e)
const before = P.e.outerHeights()
const raised = Float32Array.from(P.e.terrain.heights)
raised[Math.floor(raised.length / 2)] += 5
P.e.setHeights(raised, 'Probe raise')
const afterRaise = await mapio.regionUncompiled(P.e)
// Launch asks first: with the raised vertex it opens the dialog and starts nothing.
await mapio.launchGame(P.e)
const dialog = ui.dialog
const named = ui.uncompiledRegion
ui.dialog = null
// Growing asks for a compile, not a save, and keeps the tab (#318).
const tabId = P.e.activeDocumentId()
await mapio.extendRegion(P.e, 'e')
const growRaised = { status: ui.status, kept: P.e.activeDocumentId() === tabId, size: P.e.activeRegion()?.size }
P.e.undo()
const spawnCount = ui.spawnChanges
ui.spawnChanges = 1
await mapio.extendRegion(P.e, 'e')
const growSpawn = { status: ui.status, kept: P.e.activeDocumentId() === tabId, size: P.e.activeRegion()?.size }
ui.spawnChanges = spawnCount
const afterUndo = await mapio.regionUncompiled(P.e)
const restored = P.e.outerHeights().every((h, i) => h === before[i])
// No fingerprint, as for a region opened from a file: the Go side compares the build with the patch.
P.e.redo()
const key = d.compiled
d.compiled = { key: null, changes: -1 }
const pendingRaised = await mapio.regionUncompiled(P.e)
d.compiled = key
P.e.undo()

const out = { menu, opened, afterStep, afterRaise, dialog, named, growRaised, growSpawn, afterUndo, restored, pendingRaised }
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
	pendingRaised === true
return out
