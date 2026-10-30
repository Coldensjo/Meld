// The Inspector on the browser page (#910): with no native windows (server mode) I still opens the in-page
// Inspector, whose panel draws the plain view (lib/toolwin/inspectorHost.ts) of one model, of several and
// of nothing, and whose typed Height is one undo step. Then the commands the Inspector's own OS window
// sends (lib/toolwin/inspector.ts) are run here as the main page runs them, out of order as requests can
// arrive: a scrub's live edits and its commit make one undo step that goes back to where it began. The
// desktop app's window itself no probe can drive (docs/tests/ui.md, "The Inspector as its own OS window").
// touches: frontend/src/components/Inspector.svelte, frontend/src/components/PropertiesPanel.svelte, frontend/src/components/PoolFields.svelte, frontend/src/components/FormationFields.svelte, frontend/src/components/SpawnFields.svelte, frontend/src/lib/toolwin/
const e = P.e
const { editor, ui } = await P.state()
const sel = await P.app('/src/lib/state/selection.ts')
const win = await P.app('/src/lib/toolwin/inspector.ts')
const host = await P.app('/src/lib/toolwin/inspectorHost.ts')
e.newDocument(256, 'flat', 0, 'Inspector')
editor.tool = 'select'
await P.frames(1)
const L = e.objects
const a = L.add({ type: 'helper:cube:4', x: 120, z: 120, yOff: 14, rotY: 0, scale: 1 })
const b = L.add({ type: 'helper:cube:4', x: 128, z: 120, yOff: 14, rotY: 0, scale: 1 })
const settle = async () => {
	await P.frames(3)
	await new Promise((r) => setTimeout(r, 50))
}
const box = () => document.querySelector('[data-ui="Inspector"]')
const out = {}

ui.inspector = true
await settle()
out.empty = /Select a model/.test(box()?.textContent ?? '')

sel.selectObjects(L, [a.id, b.id], a.id)
await settle()
out.several = box()?.querySelector('.title .name')?.textContent === '2 models selected'

sel.selectObjects(L, [a.id], a.id)
await settle()
out.one = box()?.querySelector('.title .id')?.textContent === `#${a.id}`
// Typing a height: one step, which undo takes back.
const steps0 = e.history.position
const height = [...(box()?.querySelectorAll('.field') ?? [])].find((f) => f.textContent.includes('Height'))?.querySelector('input')
height.value = '20'
height.dispatchEvent(new Event('change', { bubbles: true }))
await settle()
out.typed = { yOff: L.objects.get(a.id).yOff, steps: e.history.position - steps0, shown: height.value }
e.undo()
await settle()
out.typedUndone = L.objects.get(a.id).yOff === 14 && e.history.position === steps0

// The window's commands, as the main page runs them: a scrub whose late live edit lands after its commit.
const act = host.localActions()
const g = new win.EditGestures()
const run = (cmd) => win.runInspectorCommand(win.readInspectorCommand(JSON.parse(JSON.stringify(cmd))), act, g)
const edit = (gesture, commit, yOff) => ({ type: 'edit', commit, patch: { yOff }, gesture })
run(edit(5, false, 15))
const live = L.objects.get(a.id).yOff
run(edit(5, false, 16))
run(edit(5, true, 18))
run(edit(5, false, 16))
out.scrub = { live, after: L.objects.get(a.id).yOff, steps: e.history.position - steps0, shown: editor.selected?.yOff }
e.undo()
await settle()
out.scrubUndone = L.objects.get(a.id).yOff === 14 && e.history.position === steps0
// A call by name: Deselect.
run({ type: 'call', name: 'deselect', args: [] })
await settle()
out.deselected = !editor.selected && /Select a model/.test(box()?.textContent ?? '')

// A spawn: its formation and pool fields read the view's spawns and act by key (PoolFields, FormationFields).
const se = await P.app('/src/lib/world/spawnEdits.ts')
const look = { model: '', look: '', anim: 0, displayScale: 1 }
const t = { entry: 38, name: 'Defias Thug', subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 }
// Guids far above the database's, so nothing here could name a real spawn.
const leader = Object.assign(se.newCreatureSpawn(t, 9_100_001, 100, 0, 100, 0, look), { leader: 9_100_001, groupFlags: 3 })
const follower = Object.assign(se.newCreatureSpawn(t, 9_100_002, 100, 0, 103, 0, look), { leader: 9_100_001, followDist: 3, followAngle: Math.PI, groupFlags: 3 })
const vein = (guid, x) => Object.assign(se.newObjectSpawn({ entry: 1731, name: 'Copper Vein', type: 3, display: 0, model: '', size: 1 }, guid, x, 0, 100, 0), { pool: 77, poolLimit: 1 })
const layer = e.activeDocument().spawnLayer
layer.set([leader, follower, vein(9_100_101, 120), vein(9_100_102, 140)])
se.syncSpawnUi(layer, true)
ui.inspector = true
se.selectSpawn(layer.get(`${follower.kind}/${follower.guid}`))
await settle()
const text = () => box()?.textContent?.replace(/\s+/g, ' ') ?? ''
out.follows = /Follows Defias Thug/.test(text())
const steps1 = e.history.position
;[...box().querySelectorAll('button')].find((x) => x.textContent.trim() === 'Leave formation')?.click()
await settle()
out.left = { leader: layer.get(`${follower.kind}/${follower.guid}`)?.leader, steps: e.history.position - steps1, shown: /In no formation/.test(text()) }
e.undo()
await settle()
out.leftUndone = layer.get(`${follower.kind}/${follower.guid}`)?.leader === leader.guid
se.selectSpawn(layer.get(`object/9100101`))
await settle()
out.pool = /Pool 77/.test(text()) && box().querySelectorAll('.points li').length === 1

ui.inspector = false
await settle()
out.closed = !box()
return {
	ok:
		out.empty &&
		out.several &&
		out.one &&
		out.typed.yOff === 20 &&
		out.typed.steps === 1 &&
		out.typedUndone &&
		out.scrub.live === 15 &&
		out.scrub.after === 18 &&
		out.scrub.steps === 1 &&
		out.scrub.shown === 18 &&
		out.scrubUndone &&
		out.deselected &&
		out.follows &&
		out.left.leader === 0 &&
		out.left.steps === 1 &&
		out.left.shown &&
		out.leftUndone &&
		out.pool &&
		out.closed,
	...out,
}
