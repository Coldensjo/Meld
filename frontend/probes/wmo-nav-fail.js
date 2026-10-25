// A WMO whose room data fails to load (#515): with /wow/wmonav made to answer 500 once for Stormwind
// in the benchmark scene, the failure is counted (`rooms.navs.failed`), logged in the status bar and
// the Log, and not fetched again every frame; once RETRY_MS has passed (the cache's clock moved on
// here) the next ask loads it, the count drops to 0 and the camera is in a room again.
// touches: frontend/src/lib/world/WmoRooms.ts, frontend/src/lib/world/wmoRoom.ts, internal/wow/wmonav.go
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const rooms = e.rooms
const { appLog } = await P.state()
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const key = sw.type.slice('wmo:'.length).split('?')[0].toLowerCase()
// The Trade District street (wmo-collide's spot), where the camera is in group 49.
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
const spot = e.camera.position.clone().set(-51, 3.78, -249.13).applyMatrix4(m)
const realFetch = window.fetch
const realNow = rooms.navs.now
let failed = 0
let asked = 0
window.fetch = (input, init) => {
	const url = String(input)
	if (url.includes('/wow/wmonav') && url.toLowerCase().includes('stormwind')) {
		asked++
		if (failed++ === 0) return Promise.resolve(new Response('probe: made to fail', { status: 500 }))
	}
	return realFetch(input, init)
}
const logged = appLog.lines.length
try {
	rooms.navs.forget(key)
	e.setSceneView({ target: spot.toArray(), yaw: 2, pitch: 0.1, distance: 0.5, hour: 13 })
	await P.until(() => rooms.navs.failed > 0 || null, 60_000, 'the failure to be counted')
	const log =
		appLog.lines
			.slice(logged)
			.map((l) => l.text)
			.find((t) => t.startsWith('Building rooms:')) ?? null
	// Asked every frame as the camera moves, it is not fetched again before RETRY_MS.
	for (let i = 0; i < 10; i++) {
		e.setSceneView({
			target: spot
				.clone()
				.setX(spot.x + i * 0.01)
				.toArray(),
			yaw: 2,
			pitch: 0.1,
			distance: 0.5,
			hour: 13,
		})
		await P.frames(1)
	}
	const askedWhileFailed = asked
	const roomWhileFailed = rooms.current?.group ?? null
	// The retry: the cache's clock past RETRY_MS, and the camera moved so the probe asks again.
	rooms.navs.now = () => performance.now() + 60_000
	e.setSceneView({ target: spot.toArray(), yaw: 2, pitch: 0.1, distance: 0.5, hour: 13 })
	await P.until(() => rooms.navs.get(key) || null, 60_000, "Stormwind's room data on the retry")
	rooms.navs.now = realNow
	e.setSceneView({
		target: spot
			.clone()
			.setX(spot.x + 0.02)
			.toArray(),
		yaw: 2,
		pitch: 0.1,
		distance: 0.5,
		hour: 13,
	})
	await P.frames(3)
	const room = rooms.current?.group ?? null
	return {
		ok: askedWhileFailed === 1 && !!log && roomWhileFailed === null && asked === 2 && rooms.navs.failed === 0 && room === 49,
		log,
		askedWhileFailed,
		roomWhileFailed,
		asked,
		failedAfter: rooms.navs.failed,
		room,
	}
} finally {
	window.fetch = realFetch
	rooms.navs.now = realNow
}
