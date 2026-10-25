// Map Properties' world settings go through History and mark the map dirty (#571): sea on/off, sea level and the texture roles each make one undo step that undo and redo restore, and survive a tab switch.
// touches: frontend/src/components/MapPropertiesDialog.svelte, frontend/src/lib/engine/MapDocument.ts
const { editor } = await P.state()
const e = P.e
const probeDoc = e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)
for (const d of [...e.documents]) if (d !== probeDoc) e.closeDocument(d.id)
await P.frames(2)
const results = {}
editor.dirty = false
const steps = () => e.history.steps().length
const n0 = steps()
const lvl0 = editor.waterLevel
// A drag: live writes, then one commit that names where it began.
editor.waterLevel = lvl0 + 3
e.setWorldSettings('Sea level', { waterLevel: lvl0 + 3 }, { waterLevel: lvl0 })
results.levelStep = steps() === n0 + 1
results.levelDirty = editor.dirty === true
e.undo()
results.levelUndone = editor.waterLevel === lvl0
e.redo()
results.levelRedone = editor.waterLevel === lvl0 + 3
const on0 = editor.waterEnabled
e.setWorldSettings('Sea off', { waterEnabled: !on0 })
results.seaToggled = editor.waterEnabled === !on0
e.undo()
results.seaUndone = editor.waterEnabled === on0
const rock0 = editor.roles.rock
e.setWorldSettings('Texture roles', { rock: 1 })
results.rockSet = editor.roles.rock === 1
// A tab switch replaces editor.roles; undo must write the new object.
e.newDocument(256, 'flat', 0, 'Other')
await P.frames(2)
e.cycleDocument(1)
await P.frames(2)
results.backOnProbe = editor.mapName === 'Probe' && editor.roles.rock === 1
e.undo()
results.rockUndone = editor.roles.rock === rock0
return results
