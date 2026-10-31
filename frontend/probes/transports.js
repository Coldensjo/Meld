// Boats and zeppelins (#954): World › Transports at Menethil Harbor (Azeroth 33_39) lists the Eastern Kingdoms' transports, both Menethil ships with their routes on to Kalimdor, draws their routes and docks; a click on Proudmore's Treasure's dock (176231, path 292) picks it, Sail at 16× brings its model into Menethil's pier and holds it there, Stop takes it away, Follow it rides the camera behind and puts the view back, and Show › Transports draws the routes with the window closed. Read only.
// touches: frontend/src/lib/world/TransportLayer.ts, frontend/src/lib/world/transportRoute.ts, frontend/src/lib/engine/TransportView.ts, frontend/src/components/TransportsWindow.svelte, internal/vmangos/transports.go, frontend/src/lib/engine/docOverlay.ts
const { ui, prefs } = await P.state()
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
	ui.transports = true
	await P.until(() => L.transports.some((t) => t.entry === 176231) || null, 60_000, "Proudmore's Treasure listed")
	const win = document.querySelector('[data-ui="TransportsWindow"]')
	const button = (label) => [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
	const listed = L.transports.map((t) => t.entry)
	const ships = [176231, 176310].map((id) => L.transports.find((t) => t.entry === id))
	const onToKalimdor = ships.every((t) => t && t.legs.some((l) => l.mapId === 0) && t.legs.some((l) => l.mapId === 1))
	const counts = { listed: listed.length, drawn: L.drawn, docks: L.docks, visible: L.group.visible }

	// The ship's dock at Menethil, from 120 yd off: a click on its marker picks the transport.
	const ship = ships[0]
	const dock = ship.legs.find((l) => l.mapId === 0).points.find((p) => p.flags === 2)
	const at = L.editor(dock)
	const marker = { x: at.x, y: at.y + 10, z: at.z }
	await P.lookAt(marker, { yaw: 0.6, pitch: 0.5, back: 120 })
	const screen = (p) => {
		const v = e.camera.position.clone().set(p.x, p.y, p.z).project(e.camera)
		return [(v.x + 1) / 2, (1 - v.y) / 2]
	}
	const [mx, my] = screen(marker)
	await P.click(mx, my, {}, 3)
	const picked = L.picked
	const details = win.textContent
	const shown = details.includes("Proudmore's Treasure") && details.includes('Dock 1') && details.includes('292')

	// Sail at 16× without following: the model comes into the pier and waits there.
	win.querySelector('select[aria-label="Speed"]').value = '16'
	win.querySelector('select[aria-label="Speed"]').dispatchEvent(new Event('change', { bubbles: true }))
	const follow = win.querySelector('input[type="checkbox"]')
	if (follow.checked) follow.click()
	await P.frames(1)
	button('Sail')?.click()
	await P.frames(2)
	const sailing = ui.transportSailing
	// The model's mesh is swapped when its asset loads (GhostPool.show): read it afresh each time.
	const model = () => e.transports.model
	const start = model().position.clone()
	const dockAt = e.camera.position.clone().set(at.x, at.y, at.z)
	const near = () => model().position.distanceTo(dockAt)
	let closest = Infinity
	const t0 = performance.now()
	while (performance.now() - t0 < 30_000 && closest > 1) {
		await P.frames(1)
		closest = Math.min(closest, near())
	}
	const travelled = model().position.distanceTo(start)
	const t1 = performance.now()
	while (performance.now() - t1 < 1000) await P.frames(1)
	const held = near()
	const visible = model().visible
	button('Stop')?.click()
	await P.frames(2)
	const stopped = ui.transportSailing === null && !model().visible

	// Follow it: the camera rides behind the model, and Stop puts the view back.
	if (!follow.checked) follow.click()
	await P.frames(1)
	const view = e.sceneView()
	button('Sail')?.click()
	await P.frames(10)
	const chase = e.debug.persp.position.distanceTo(model().position)
	button('Stop')?.click()
	await P.frames(2)
	const back = Math.hypot(...e.sceneView().target.map((v, i) => v - view.target[i]))

	ui.transports = false
	await P.frames(2)
	const hidden = !L.group.visible
	prefs.showTransports = true
	await P.until(() => (L.group.visible && L.drawn > 0) || null, 60_000, 'Show › Transports drawn')
	const byMenu = L.drawn

	const ok =
		listed.includes(176310) &&
		onToKalimdor &&
		counts.drawn >= 4 &&
		counts.docks >= 4 &&
		counts.visible &&
		picked === 176231 &&
		shown &&
		sailing === 176231 &&
		visible &&
		travelled > 20 &&
		closest < 1 &&
		held < 1 &&
		stopped &&
		chase > 100 &&
		chase < 140 &&
		back < 0.01 &&
		hidden &&
		byMenu >= 4
	return { ok, ...counts, listed, onToKalimdor, picked, shown, sailing, visible, travelled: +travelled.toFixed(1), closest: +closest.toFixed(2), held: +held.toFixed(2), stopped, chase: +chase.toFixed(1), back, hidden, byMenu }
} finally {
	ui.transports = false
	prefs.showTransports = wasShown
}
