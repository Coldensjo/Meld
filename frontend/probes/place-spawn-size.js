// (#673: the spawn also takes the preview's rotation.) Placing a creature or game object template (#672): the Place tool's preview is drawn at the size the spawn takes once placed (the template's scale times its display's, or the object's size), not at the model's own size; Shift+scroll leaves it be.
// touches: frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/world/spawnInfo.ts, frontend/src/lib/world/SpawnLayer.ts, internal/vmangos/templates_list.go, frontend/src/lib/engine/SpawnActions.ts
await P.scene(P.BENCH)
const e = P.e
const { editor, ui } = await P.state()
const { getAsset } = await P.app('/src/lib/models/assets.ts')
const { spawnType } = await P.app('/src/lib/world/spawnInfo.ts')
const { spawnOrientation } = await P.app('/src/lib/world/SpawnLayer.ts')
const App = window.go.main.App
const bad = []
const objects = (await App.ListObjectTemplates()).filter((t) => t.model && Math.abs((t.size || 1) - 1) > 0.2)
const creatures = (await App.ListCreatureTemplates()).filter((t) => t.model && Math.abs(t.scale * (t.displayScale || 1) - 1) > 0.2)
if (!objects.length || !creatures.length) return { ok: false, bad: [`templates of another size: ${objects.length} objects, ${creatures.length} creatures`] }
const tool = e.placeTool
editor.tool = 'place'
editor.placeScatter = false
editor.placeRandomScale = false
const at = e.controller.target.clone()
await P.lookAt(at, { pitch: 1.1, back: 60 })
const canvas = e.renderer.domElement
const near = (a, b) => Math.abs(a - b) < 1e-3 * Math.max(1, b)
for (const [kind, t] of [
	['object', objects[0]],
	['creature', creatures[0]],
]) {
	ui.placeCreature = kind === 'creature' ? t : null
	ui.placeObject = kind === 'object' ? t : null
	editor.prefab = spawnType({ model: t.model, look: t.look })
	await P.until(() => getAsset(editor.prefab).ready && tool.ghost.geometry === getAsset(editor.prefab).geometry, 30_000, `the ${kind}'s model to load`)
	P.pointer('pointermove', 0.5, 0.5)
	await P.frames(2)
	const want = kind === 'object' ? t.size || 1 : t.scale * (t.displayScale || 1)
	if (!tool.ghost.visible) bad.push(`the ${kind}'s preview is hidden`)
	if (!near(tool.ghost.scale.x, want)) bad.push(`${kind} ${t.entry}: preview at ${tool.ghost.scale.x}, the spawn takes ${want}`)
	canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true }))
	await P.frames(2)
	if (!near(tool.ghost.scale.x, want)) bad.push(`${kind}: Shift+scroll scaled the preview to ${tool.ghost.scale.x}`)
	// The spawn the click puts down is drawn at the preview's size.
	const layer = e.doc.spawnLayer
	const n = layer.spawns.length
	tool.rot = 1.3
	await P.click(0.5, 0.5)
	await P.until(() => layer.spawns.length > n, 30_000, `the ${kind} to be placed`)
	const s = layer.spawns[layer.spawns.length - 1]
	const wantO = spawnOrientation(1.3)
	if (Math.abs(Math.atan2(Math.sin(s.orientation - wantO), Math.cos(s.orientation - wantO))) > 1e-3) bad.push(`${kind}: placed facing ${s.orientation}, the preview's rotation gives ${wantO}`)
	if (!near(s.scale, tool.ghost.scale.x)) bad.push(`${kind}: placed at ${s.scale}, previewed at ${tool.ghost.scale.x}`)
}
ui.placeCreature = ui.placeObject = null
editor.prefab = 'helper:cube:8'
await P.frames(2)
if (tool.ghost.scale.x !== 1) bad.push(`a model's preview stayed at ${tool.ghost.scale.x}`)
return { ok: bad.length === 0, bad, object: [objects[0].entry, objects[0].size], creature: [creatures[0].entry, creatures[0].scale, creatures[0].displayScale] }
