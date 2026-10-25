// Flight paths (#180): World › Flight Paths in Redridge (Azeroth 36_49) reads Eastern Kingdoms' stops and routes, a click on Lakeshire's marker (stop 5) picks it and a drag moves it, a route picked from the list takes a drawn point, a click on a route's curve picks it, and Fly it moves the camera along the route and puts it back. Nothing is saved.
// touches: frontend/src/lib/world/TaxiLayer.ts, frontend/src/lib/world/taxiRoute.ts, frontend/src/components/FlightPathsWindow.svelte, internal/vmangos/taxi.go, frontend/src/lib/engine/TaxiEditing.ts, frontend/src/lib/engine/docOverlay.ts
const { ui } = await P.state()
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 36, y: 49, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	const e = P.e
	const L = e.taxiLayer
	ui.flightPaths = true
	await P.until(() => L.stops.find((s) => s.id === 5) ?? null, 60_000, "Lakeshire's stop drawn")
	const counts = { stops: L.stops.length, routes: L.routes.length, visible: L.group.visible }
	const win = document.querySelector('aside[aria-label="Flight paths"]')
	const button = (label) => [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

	// Lakeshire's marker, from 40 yd off: a click picks the stop, a drag moves it over the ground.
	const stop = L.stops.find((s) => s.id === 5)
	const at = L.editor(stop)
	const marker = { x: at.x, y: at.y + 6, z: at.z }
	await P.lookAt(marker, { yaw: 0.6, pitch: 0.35, back: 40 })
	const screen = (p) => {
		const v = e.camera.position.clone().set(p.x, p.y, p.z).project(e.camera)
		return [(v.x + 1) / 2, (1 - v.y) / 2]
	}
	const [mx, my] = screen(marker)
	await P.click(mx, my, {}, 2)
	const picked = L.pick.stop
	const before = { x: stop.x, y: stop.y }
	await P.drag([mx, my], [mx + 0.08, my + 0.06])
	await P.frames(2)
	const after = L.stops.find((s) => s.id === 5)
	const moved = Math.hypot(after.x - before.x, after.y - before.y)
	const saveLabel = win.querySelector('footer button')?.textContent.trim() ?? ''

	// A route of Lakeshire's from the window's list, and a point drawn on the ground in front.
	win.querySelector('ul[aria-label="Routes"] button')?.click()
	await P.frames(2)
	const routeId = L.pick.route
	const points = L.routes.find((r) => r.id === routeId)?.points.length ?? 0
	// A click on the route's curve (through its middle point, with nothing picked) picks the route.
	const mid = L.routes.find((r) => r.id === routeId).points
	const midAt = L.editor(mid[Math.floor(mid.length / 2)])
	L.pick = { stop: L.pick.stop, route: null, point: -1 }
	L.drawRoutes()
	await P.lookAt(midAt, { yaw: 0.6, pitch: 0.35, back: 40 })
	const [cx, cy] = screen(midAt)
	await P.click(cx, cy, {}, 2)
	const byCurve = L.pick.route
	button('Draw points')?.click()
	await P.frames(1)
	await P.click(0.3, 0.75, {}, 2)
	const drawn = (L.routes.find((r) => r.id === routeId)?.points.length ?? 0) - points

	// Fly it: the camera rides the route at 32 yd/s, and Stop puts the view back.
	const view = e.sceneView()
	button('Fly it')?.click()
	await P.frames(1)
	const flying = ui.taxiFlying
	const from = e.persp.position.clone()
	const t0 = performance.now()
	while (performance.now() - t0 < 1500) await P.frames(1)
	const flew = e.persp.position.distanceTo(from)
	button('Stop')?.click()
	await P.frames(2)
	const back = Math.hypot(...e.sceneView().target.map((v, i) => v - view.target[i]))

	ui.flightPaths = false
	await P.frames(2)
	const hidden = !L.group.visible
	const ok =
		counts.stops >= 40 &&
		counts.routes >= 100 &&
		counts.visible &&
		picked === 5 &&
		moved > 1 &&
		saveLabel === 'Save (1)' &&
		routeId !== null &&
		points >= 2 &&
		byCurve === routeId &&
		drawn === 1 &&
		flying &&
		flew > 10 &&
		back < 0.01 &&
		!ui.taxiFlying &&
		hidden
	return { ok, ...counts, picked, moved: +moved.toFixed(1), saveLabel, routeId, byCurve, points, drawn, flying, flew: +flew.toFixed(1), back, hidden }
} finally {
	ui.flightPaths = false
}
