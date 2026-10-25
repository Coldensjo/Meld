// Teleport to destination (#306): with View › Area triggers on, a right-click on the Deadmines entrance (trigger 78) on Azeroth selects it and offers "Teleport to destination", which opens the Deadmines (map 36) in a new tab with the camera at the trigger's areatrigger_teleport spot; a spellcaster portal (Portal to Stormwind, 176296) reads its spell's destination in Stormwind; and a creature's gossip teleport (Lothos Riftwaker, 14387, to Molten Core) becomes a Teleport item in its menu (#308).
// touches: frontend/src/lib/world/areaTriggers.ts, frontend/src/lib/world/teleport.ts, frontend/src/lib/io/portCoords.ts, frontend/src/components/ContextMenu.svelte, internal/vmangos/areatrigger.go, internal/vmangos/teleport.go, frontend/src/lib/engine/SpawnActions.ts, frontend/src/lib/engine/docOverlay.ts
const { ui, editor, prefs } = await P.state()
const before = prefs.showAreaTriggers
prefs.showAreaTriggers = true
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
	const layer = P.e.triggerLayer
	const t = await P.until(() => layer.triggers.find((x) => x.id === 78) ?? null, 60_000, 'trigger 78 read')
	const { editorPoint } = await P.app('/src/lib/io/portCoords.ts')
	const c = editorPoint(t, 28, 53)
	// The entrance is a cave in a building's rock: look at it from the side the rock leaves open.
	const r = P.e.renderer.domElement.getBoundingClientRect()
	const titles = []
	let menu = null
	for (let k = 0; k < 8 && !menu; k++) {
		await P.lookAt(c, { yaw: (k * Math.PI) / 4, pitch: 0.2, back: t.radius + 4 })
		const m = await P.contextMenu()
		titles.push(m?.title ?? '')
		if (m?.title.startsWith('Area trigger')) menu = m
	}
	// A left click (#307): with the Select tool it picks the trigger and the Portals dialog follows; a click away lets go.
	layer.select(null)
	ui.pickedTrigger = null
	ui.contextMenu = null
	const cx = r.left + r.width / 2,
		cy = r.top + r.height / 2
	const cv = P.e.renderer.domElement
	const clickAt = (x, y) => {
		const o = { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }
		cv.dispatchEvent(new PointerEvent('pointerdown', o))
		cv.dispatchEvent(new PointerEvent('pointerup', o))
	}
	clickAt(cx, cy)
	const leftSelected = layer.selected === 78 && ui.pickedTrigger === 78
	clickAt(r.left + 5, r.top + 5)
	const leftCleared = layer.selected === null && ui.pickedTrigger === null
	P.e.selectTrigger(78)
	const title = menu?.title ?? ''
	const item = menu?.items.find((i) => i.label === 'Teleport to destination')
	const selected = layer.selected
	ui.contextMenu = null
	if (!item) return { ok: false, titles, radius: t.radius, why: 'no Teleport to destination item' }
	item.run()
	await P.until(() => (editor.regionMap === 'DeadminesInstance' && !ui.busy) || null, 120_000, "the Deadmines' tab")
	const region = P.e.doc.meta.region
	const dest = t.teleport
	const at = editorPoint(dest, region.x, region.y)
	const tg = P.e.controller.target
	const camOff = Math.hypot(tg.x - at.x, tg.z - at.z)
	// A spellcaster portal, through the binding.
	const portal = (await window.go.main.App.SpawnTeleports('object', 176296, 0))?.[0]?.dest
	// A gossip teleport (#308): the items join a spawn's open menu above Focus when the database answers.
	const lothos = { kind: 'creature', entry: 14387, guid: 0, name: 'Lothos Riftwaker' }
	const seq = ++P.e.menuSeq
	ui.contextMenu = { x: 10, y: 10, title: 'Lothos', items: [{ label: 'Edit creature…' }, { label: 'Focus' }] }
	await P.e.spawnActions.addTeleports(lothos, seq, 'Lothos')
	const lothosItems = ui.contextMenu?.items.map((i) => i.label) ?? []
	ui.contextMenu = null
	const gossip = lothosItems[1] === 'Teleport: Gossip: Transport me to the Molten Core, Lothos.' && lothosItems[2] === 'Focus'
	const ok = title.startsWith('Area trigger 78') && selected === 78 && dest.map === 36 && camOff < 1 && leftSelected && leftCleared && portal?.map === 0 && Math.abs(portal.x + 9003.46) < 1 && gossip
	return { ok, leftSelected, leftCleared, title, selected, region: `${region.mapName} ${region.x}_${region.y} ${region.size}`, dest, camOff: +camOff.toFixed(2), portal, lothosItems }
} finally {
	prefs.showAreaTriggers = before
}
