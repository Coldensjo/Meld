// Activating the open tab keeps what the editor holds since the last stash (#547): Ctrl+Tab with one tab, openRegion/focusPath of the active file.
// touches: frontend/src/lib/engine/Engine.ts, frontend/src/lib/engine/MapDocument.ts, frontend/src/lib/state/editor.svelte.ts
const { editor } = await P.state()
const e = P.e
const probeDoc = e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)
for (const d of [...e.documents]) if (d !== probeDoc) e.closeDocument(d.id)
await P.frames(2)
const before = editor.palette.length
e.useTexture('#ff0000')
await P.frames(2)
editor.dirty = true
const grown = editor.palette.length
e.cycleDocument(1)
await P.frames(2)
const results = {
	grew: grown > before,
	oneTabPalette: editor.palette.length === grown,
	oneTabDirty: editor.dirty === true,
}
// The private activate on the active document, as focusPath and openRegion do.
e.activate(e.doc)
await P.frames(2)
results.sameDocPalette = editor.palette.length === grown
results.sameDocDirty = editor.dirty === true
// With two tabs a cycle still moves and back keeps the edit.
e.newDocument(256, 'flat', 0, 'Other')
await P.frames(2)
e.cycleDocument(1)
await P.frames(2)
results.cycled = editor.mapName === 'Probe'
results.cycledPalette = editor.palette.length === grown
results.cycledDirty = editor.dirty === true
return results
