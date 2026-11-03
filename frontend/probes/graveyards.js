// World › Graveyards (#947): on Azeroth (Westfall's block, 28 53) the dialog lists the map's graveyards from the client's WorldSafeLocs.dbc and the 3D view draws one cross each; a click on a cross in the viewport picks that graveyard in the dialog; New graveyard here adds one at the camera, linked to the zone under it, drawn and picked; Place a Spirit Healer adds creature 6491 beside it as one undo step (undone here); Save hands SaveGraveyards the new graveyard with its link and no removal (a stand-in, since the throwaway client refuses the server's tables) and says where it saved. Nothing is written (the DBC and SQL are Go's: TestSetGraveyardsEditsAddsAndRemoves, TestGraveyardSQL).
// touches: frontend/src/components/GraveyardsDialog.svelte, frontend/src/lib/world/GraveyardLayer.ts, internal/vmangos/graveyards.go, app_graveyards.go
const { ui } = await P.state()
const App = window.go.main.App
await P.sandboxClient()
const WAIT = 60_000
const TITLE = 'Graveyards'
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const dlg = () => P.dialog(TITLE)
const button = (label) => [...(dlg()?.querySelectorAll('button') ?? [])].find((b) => text(b).startsWith(label))
const nameField = () => dlg()?.querySelector('#gy-name')
const realSave = App.SaveGraveyards
const saved = []
const out = {}
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 28, y: 53, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	ui.dialog = 'graveyards'
	await P.until(() => (dlg()?.querySelectorAll('.list button').length ?? 0) > 0, WAIT, 'the graveyards listed')
	const layer = P.e.graveyardLayer
	await P.frames(2)
	out.listed = dlg().querySelectorAll('.list button').length
	out.drawn = layer.graveyards.length
	out.visible = layer.group.visible
	out.server = !/server folder/.test(text(dlg().querySelector('.error')))

	// A click on a graveyard's cross picks it: the nearest one that isn't picked now.
	const { editorPoint } = await P.app('/src/lib/io/portCoords.ts')
	const { GRAVE_POST } = await P.app('/src/lib/world/GraveyardLayer.ts')
	const o = P.e.serverOrigin()
	const target = layer.graveyards.find((g) => g.id !== layer.selected)
	const p = editorPoint(target, o.x, o.y)
	await P.lookAt({ x: p.x, y: p.y + GRAVE_POST + 1.5, z: p.z }, { yaw: 0.4, pitch: 0.3, back: 25 })
	const cv = P.e.renderer.domElement
	const r = cv.getBoundingClientRect()
	const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, bubbles: true }
	cv.dispatchEvent(new PointerEvent('pointerdown', at))
	cv.dispatchEvent(new PointerEvent('pointerup', at))
	await P.frames(2)
	out.viewportPick = layer.selected === target.id && dlg().querySelector('.list button.picked .id')?.textContent.startsWith(String(target.id))

	// A new graveyard at the camera, over the ground of the block.
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 28, y: 53, size: 1 } },
		view: { target: [266, 0, 266], yaw: 0.5, pitch: 0.4, distance: 40, hour: 13 },
		prefs: { cameraFollowGround: true },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	const before = layer.graveyards.length
	// The dialog read the camera's spot when it opened: open it again here.
	ui.dialog = null
	P.e.endGraveyardEdit()
	await P.frames(2)
	ui.dialog = 'graveyards'
	await P.until(() => button('New graveyard here') && !button('New graveyard here').disabled && dlg().querySelectorAll('.list button').length > 0, WAIT, 'the dialog again')
	button('New graveyard here').click()
	await P.until(() => layer.graveyards.length === before + 1, WAIT, 'the new graveyard drawn')
	const fresh = layer.graveyards[layer.graveyards.length - 1]
	out.added = { id: fresh.id, name: nameField()?.value, links: fresh.links.length, selected: layer.selected === fresh.id }
	out.linked = /Westfall/.test(text(dlg().querySelector('.links')))

	// The Spirit Healer: one spawn of entry 6491, one undo step.
	const spawns = () => P.e.activeDocument().spawnLayer.spawns
	// The block's spawns come from the world database after the tiles (LoadSpawns), and their arrival
	// replaces the layer: count only once they are in (#1082: after flight-paths on the GPU they were not yet).
	if (out.server) await P.until(() => spawns().length > 0 || P.e.activeDocument().spawnsError, WAIT, "the block's spawns loaded")
	const n0 = spawns().length
	button('Place a Spirit Healer').click()
	await P.until(() => spawns().length === n0 + 1 || dlg()?.querySelector('.error')?.textContent.includes('6491'), WAIT, 'the Spirit Healer placed')
	const healer = spawns()[spawns().length - 1]
	const hp = editorPoint(fresh, o.x, o.y)
	out.healer = { entry: healer?.entry, near: healer ? Math.round(Math.hypot(healer.x - hp.x, healer.z - hp.z) * 10) / 10 : null }
	P.e.history.undo()
	out.healerUndone = spawns().length === n0

	App.SaveGraveyards = async (rows, remove) => {
		saved.push({ rows, remove })
		return { patch: 'C:/Meld-probe/patch-3.MPQ', server: true, waiting: false, restart: false }
	}
	button('Save').click()
	await P.until(() => saved.length === 1, WAIT, 'the save')
	await P.until(() => /Saved 1 graveyard/.test(ui.status ?? ''), 10_000, 'the status line')
	const s = saved[0]
	out.saved = { rows: s.rows.length, id: s.rows[0]?.id, links: s.rows[0]?.links, remove: s.remove }
	out.status = ui.status
} finally {
	App.SaveGraveyards = realSave
	ui.dialog = null
	P.e.endGraveyardEdit()
	await P.frames(2)
}
out.ok =
	out.listed > 0 &&
	out.drawn >= out.listed &&
	out.visible &&
	out.viewportPick &&
	out.added.links === (out.server ? 1 : out.added.links) &&
	out.added.selected &&
	(!out.server || out.linked) &&
	(!out.server || (out.healer.entry === 6491 && out.healer.near > 1 && out.healer.near < 5 && out.healerUndone)) &&
	out.saved.rows === 1 &&
	out.saved.id === out.added.id &&
	out.saved.remove.length === 0
return out
