// A camera over a building rather than in it (#300), one in a street room (#302), and one closer to that room's wall than the near plane (#304): over Stormwind's canals, and high over the city, the eye is above the box of the room the down-ray finds, so the city is drawn whole (no holes to the sky); 2.5 yd over a canal's floor it is still in that room, as in the client.
// touches: frontend/src/lib/world/WmoRooms.ts, frontend/src/lib/world/wmoRoom.ts, frontend/src/lib/world/roomGate.ts, frontend/src/lib/world/roomAdmit.ts
await P.scene(P.BENCH)
await P.settle()
const e = P.e
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
await P.fullView()
const rooms = e.rooms
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
// The view with the gate off: no room, no building flooded from outside.
const whole = async () => {
	const update = rooms.update
	const outside = rooms.outside
	rooms.update = function () {
		this.current = null
	}
	rooms.outside = () => []
	try {
		await P.frames(2)
		return await P.shot()
	} finally {
		rooms.update = update
		rooms.outside = outside
		rooms.lastEye.set(NaN, NaN, NaN)
		await P.frames(2)
	}
}
const pct = (x) => +(x * 100).toFixed(2)
const look = async (name, view) => {
	e.setSceneView({ ...view, hour: 13 })
	await P.settle()
	await P.frames(3)
	const a = await P.shot()
	const b = await P.shot()
	P.save(a, name)
	const room = rooms.current ? `${rooms.current.group} ${rooms.current.nav.groups[rooms.current.group].name}` : null
	const over = rooms.over.includes(sw.id)
	const w = await whole()
	return { camera: e.camera.position.toArray().map((v) => +v.toFixed(1)), room, over, noise: pct(P.diff(a, b).off), offWhole: pct(P.diff(a, w).off), lit: +a.lit.toFixed(2) }
}
// The issue's view: the camera 52 yd over the canal by the Command Center, whose floor 70 yd below claimed it.
const canal = await look('canal', { target: [-566.6, 103.5, 143.1], yaw: 0.5, pitch: 0.5, distance: 30 })
const high = await look('high', { target: [-650, 429, 218], yaw: 0.5, pitch: 1.0, distance: 300 })
// 2.5 yd over a floor of The Canals, inside that group's box: the flying camera, which sits at its target.
const { prefs } = await P.state()
prefs.cameraFollowGround = false
await P.frames(2)
const nav = rooms.navs.get(sw.type.slice('wmo:'.length).toLowerCase())
const gi = nav.groups.findIndex((g, i) => g.name === 'The Canals' && nav.walk[i].length > 900)
const t = nav.walk[gi]
const k = Math.floor(t.length / 18) * 9
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
const p = e.camera.position
	.clone()
	.set((t[k] + t[k + 3] + t[k + 6]) / 3, (t[k + 2] + t[k + 5] + t[k + 8]) / 3 + 2.5, -(t[k + 1] + t[k + 4] + t[k + 7]) / 3)
	.applyMatrix4(m)
const street = await look('street', { target: p.toArray(), yaw: 0, pitch: 0.1, distance: 0.5 })
// #302: in a Trade District room (group 49), 2.5 yd over its floor and 6 yd from its doorways, looking
// through them at the street: the flood draws what the gate-off view does. Keep the eye more than the
// near plane (0.5 yd) from a wall: one clipped away shows the street behind it with the gate off, which
// the flood rightly leaves out.
const trade = await look('trade', { target: p.set(-56, 3.78, -255.5).applyMatrix4(m).toArray(), yaw: 3.81, pitch: 0.1, distance: 0.5 })
// #304: 0.43 yd from that room's south wall, closer than the near plane (0.5 yd), looking along it at
// the street. The near plane is pulled in so the wall is not clipped away; before, the clipped wall
// showed the sky with the gate on (55% of the picture off the gate-off view).
const wall = await look('wall', { target: p.set(-51, 3.78, -249.13).applyMatrix4(m).toArray(), yaw: 2, pitch: 0.1, distance: 0.5 })
wall.near = +e.persp.near.toFixed(3)
const same = (v) => !v.room && v.over && v.lit > 0.5 && v.offWhole < v.noise + 1
return {
	ok:
		same(canal) &&
		same(high) &&
		street.room === `${gi} The Canals` &&
		!street.over &&
		trade.room === '49 Trade District' &&
		trade.offWhole < trade.noise + 1 &&
		wall.room === '49 Trade District' &&
		wall.near < 0.5 &&
		wall.offWhole < wall.noise + 1,
	canal,
	high,
	street,
	trade,
	wall,
	glErrors: P.glError(),
}
