// Making and editing boats and zeppelins (#955): World › Transports at Menethil Harbor (Azeroth 33_39). Edit on Proudmore's Treasure (176231, path 292) puts its whole path on the map as the Flight Paths window's route (the map's 15 points marked); a click on its Menethil dock picks the point, which shows as a dock waiting 60 s; a wait of 45 and Save hand SaveTransport the template's entry, path, speed and the 30 points with the new wait, and the status says to restart the world server. New transport (NewTransportIDs stood in) starts a route of 7 points under the camera, two of them docks, drawn as a transport of its own; Draw and a click on the water add a point after the picked one; Go on to Kalimdor adds four points on map 1; Save sends it all. SaveTransport and NewTransportIDs are stood in, so nothing is written.
// touches: frontend/src/components/TransportsWindow.svelte, frontend/src/lib/world/transportRoute.ts, frontend/src/lib/engine/TaxiEditing.ts, frontend/src/lib/world/TaxiLayer.ts, internal/vmangos/transports.go, internal/vmangos/transportedit.go, app_transports.go
const { ui, prefs } = await P.state()
const App = window.go.main.App
const real = { SaveTransport: App.SaveTransport, NewTransportIDs: App.NewTransportIDs }
const saved = []
App.SaveTransport = async (edit) => {
	saved.push(edit)
	return { patch: '', server: true, waiting: false, restart: true, period: 329313 }
}
App.NewTransportIDs = async () => ({ entry: 900001, pathId: 9001 })
const wasShown = prefs.showTransports
try {
	prefs.showTransports = false
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 33, y: 39, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	const e = P.e
	const L = e.transportLayer
	const T = e.taxiLayer
	ui.flightPaths = false
	ui.transports = true
	await P.until(() => L.transports.some((t) => t.entry === 176231) || null, 60_000, "Proudmore's Treasure listed")
	const win = document.querySelector('[data-ui="TransportsWindow"]')
	const button = (label) => [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
	const set = (el, v) => {
		el.value = String(v)
		el.dispatchEvent(new Event('input', { bubbles: true }))
		el.dispatchEvent(new Event('change', { bubbles: true }))
	}
	;[...win.querySelectorAll('.list button')].find((b) => b.textContent.includes('Menethil Harbor and Theramore'))?.click()
	await P.frames(2)
	button('Edit')?.click()
	await P.frames(3)
	const route = T.routes[0]
	const edited = { route: route?.id, points: route?.points.length, marked: T.marked.length, visible: T.group.visible }

	// A click on the dock at Menethil (the path's ninth point) picks it.
	const dockIndex = route.points.findIndex((p) => p.flags === 2 && p.mapId === 0)
	const at = T.editor(route.points[dockIndex])
	await P.lookAt(at, { yaw: 0.6, pitch: 0.6, back: 90 })
	const screen = (p) => {
		const v = e.camera.position.clone().set(p.x, p.y, p.z).project(e.camera)
		return [(v.x + 1) / 2, (1 - v.y) / 2]
	}
	const [mx, my] = screen(at)
	await P.click(mx, my, {}, 3)
	await P.frames(2)
	const pointForm = win.querySelector('[aria-label="Point"]')
	const dockBox = pointForm?.querySelector('input[type="checkbox"]')
	const wait = pointForm?.querySelector('input[aria-label="Wait"]')
	const pickedDock = { picked: T.pick.point, dockIndex, checked: dockBox?.checked, wait: wait?.value }
	set(wait, 45)
	await P.frames(1)
	button('Save')?.click()
	await P.until(() => saved.length > 0 || null, 10_000, 'SaveTransport called')
	await P.frames(3)
	const first = saved[0]
	const savedEdit = {
		entry: first.entry,
		pathId: first.pathId,
		speed: first.speed,
		accel: first.accel,
		points: first.points.length,
		wait: first.points[dockIndex].delay,
		dock: first.points[dockIndex].flags,
		restart: win.textContent.includes('Restart the world server'),
		draftGone: !win.querySelector('[aria-label="Point"]') && !T.group.visible,
	}

	// New transport: a route under the camera, drawn as its own transport.
	// Save ends once the list is read again: until then New transport is off.
	await P.until(() => (button('New transport') && !button('New transport').disabled) || null, 30_000, 'the save done')
	button('New transport')?.click()
	await P.until(() => T.routes[0]?.id === 9001 || null, 10_000, 'the new route drawn')
	await P.frames(2)
	const fresh = T.routes[0]
	const created = { points: fresh.points.length, docks: fresh.points.filter((p) => p.flags === 2).length, layer: L.transports.some((t) => t.entry === 900001), picked: L.picked }
	// Pick the last sailed point, then Draw and a click beside it add one after it.
	const last = fresh.points.length - 2
	const lp = T.editor(fresh.points[last])
	await P.lookAt(lp, { yaw: 0.3, pitch: 0.9, back: 120 })
	const [lx, ly] = screen(lp)
	await P.click(lx, ly, {}, 3)
	await P.frames(2)
	const pickedLast = T.pick.point
	button('Draw')?.click()
	await P.frames(1)
	await P.click(Math.min(0.95, lx + 0.12), ly, {}, 3)
	await P.frames(2)
	const drawn = T.routes[0].points.length
	button('Draw')?.click()
	// Go on to Kalimdor after the picked point.
	const mapSelect = win.querySelector('[aria-label="Point"] select[aria-label="Map"]')
	set(mapSelect, 1)
	await P.frames(1)
	button('Add')?.click()
	await P.frames(2)
	const stretches = [...win.querySelectorAll('[aria-label="Stretches"] li')].map((li) => li.textContent.trim())
	button('Save')?.click()
	await P.until(() => saved.length > 1 || null, 10_000, 'SaveTransport called again')
	const second = saved[1]
	const savedNew = { entry: second.entry, pathId: second.pathId, points: second.points.length, onKalimdor: second.points.filter((p) => p.mapId === 1).length, docks: second.points.filter((p) => p.flags === 2).length }

	const ok =
		edited.route === 292 &&
		edited.points === 30 &&
		edited.marked === 15 &&
		edited.visible &&
		pickedDock.picked === dockIndex &&
		pickedDock.checked === true &&
		pickedDock.wait === '60' &&
		savedEdit.entry === 176231 &&
		savedEdit.pathId === 292 &&
		savedEdit.speed === 30 &&
		savedEdit.accel === 1 &&
		savedEdit.points === 30 &&
		savedEdit.wait === 45 &&
		savedEdit.dock === 2 &&
		savedEdit.restart &&
		savedEdit.draftGone &&
		created.points === 7 &&
		created.docks === 2 &&
		created.layer &&
		created.picked === 900001 &&
		pickedLast === last &&
		drawn === 8 &&
		stretches.length === 3 &&
		savedNew.entry === 900001 &&
		savedNew.pathId === 9001 &&
		savedNew.points === 12 &&
		savedNew.onKalimdor === 4 &&
		savedNew.docks === 2
	return { ok, edited, pickedDock, savedEdit, created, pickedLast, last, drawn, stretches, savedNew }
} finally {
	App.SaveTransport = real.SaveTransport
	App.NewTransportIDs = real.NewTransportIDs
	ui.transports = false
	prefs.showTransports = wasShown
}
