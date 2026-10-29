// WMO cameras in Stormwind's Trade District, one scene load for three checks (#416): `over` (#300, #302, #304: a camera over a building or in a street room draws the city whole, matching the gate-off picture), `collide` (#305, #310: Camera Collision stops the flying camera off a wall and the clamp keeps it 3 yd over the street's floor) and `walk` (#312, #313: the walker stands 3 yd over the WMO floor and stops off the south wall). The result has one object a check, each with its own `ok`, so a failure names the part (docs/tests/rendering.md).
// touches: frontend/src/lib/world/WmoRooms.ts, frontend/src/lib/world/wmoRoom.ts, frontend/src/lib/world/roomGate.ts, frontend/src/lib/world/roomAdmit.ts, frontend/src/lib/engine/CameraController.ts, frontend/src/lib/engine/cameraMove.ts, internal/wow/wmonav.go, internal/wow/collision.go
await P.scene(P.BENCH)
await P.settle()
const e = P.e
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const { prefs, ui } = await P.state()
const { nearestFaceDist, toModel } = await P.app('/src/lib/world/wmoRoom.ts')
const rooms = e.debug.rooms
const c = e.controller
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const key = sw.type.slice('wmo:'.length).toLowerCase()
await P.until(() => rooms.navs.get(key) || null, 60_000, "Stormwind's room data")
const nav = rooms.navs.get(key)
// What each check changes and must give back, so the next starts from the scene's own state.
const before = { follow: prefs.cameraFollowGround, collision: prefs.cameraCollision, walk: ui.walkCamera }
const reset = async () => {
	ui.walkCamera = before.walk
	prefs.cameraCollision = before.collision
	prefs.cameraFollowGround = before.follow
	await P.frames(2)
}

// Over: the benchmark scene turns Follow the Ground on, which the first views need.
const over = await (async () => {
	await P.fullView()
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
	prefs.cameraFollowGround = false
	await P.frames(2)
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
	wall.near = +e.debug.persp.near.toFixed(3)
	const same = (v) => !v.room && v.over && v.lit > 0.5 && v.offWhole < v.noise + 1
	const result = {
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
	}
	return result
})()
await reset()

// The spot by the Trade District room's south wall (3 yd back from it for collide and walk); the street runs along the wall.
prefs.cameraFollowGround = false
await P.frames(2)
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
const spot = e.camera.position.clone().set(-51, 3.78, -249.13)
const q = [0, 0, 0]
const eyeM = toModel(spot, [0, 0, 0])
nearestFaceDist(nav, eyeM[0], eyeM[1], eyeM[2], 2, q)
const wallLocal = spot.clone().set(q[0], q[2], -q[1])
const dir = wallLocal.clone().sub(spot).normalize()
const wallWorld = wallLocal.clone().applyMatrix4(m)
const dirWorld = wallWorld.clone().sub(spot.clone().applyMatrix4(m)).normalize()

const collide = await (async () => {
	const fly = async (collision) => {
		prefs.cameraCollision = collision
		await P.frames(2)
		// 3 yd back from the spot, then 13 yd towards the wall in one frame.
		const start = spot.clone().addScaledVector(dir, -3).applyMatrix4(m)
		e.setSceneView({ target: start.toArray(), yaw: 2, pitch: 0.1, distance: 0.5, hour: 13 })
		await P.frames(3)
		// How far the clamp lifted the start eye (#310: the terrain lies under the street, so it lifted it 1.8 yd), and its height over the floor.
		const lift = +(e.camera.position.y - start.y).toFixed(2)
		const overFloor = +(e.camera.position.y - rooms.floorAt(e.objects, e.camera.position)).toFixed(2)
		c.target.copy(start).addScaledVector(dirWorld, 13)
		await P.frames(3)
		const eye = e.camera.position
		const room = rooms.current ? `${rooms.current.group} ${rooms.current.nav.groups[rooms.current.group].name}` : null
		// How far on the room's side of the wall the eye is (yd); negative is through it.
		const side = -eye.clone().sub(wallWorld).dot(dirWorld)
		return { room, lift, overFloor, side: +side.toFixed(2), wallDist: +rooms.wallDist.toFixed(2), near: +e.debug.persp.near.toFixed(3) }
	}
	const on = await fly(true)
	// Down towards the street from the start (#310): the eye stops 3 yd over the street's floor, not over
	// the terrain, which runs 3 yd above the street here.
	const down = async () => {
		const start = spot.clone().addScaledVector(dir, -3).applyMatrix4(m)
		e.setSceneView({ target: start.toArray(), yaw: 2, pitch: 0.1, distance: 0.5, hour: 13 })
		await P.frames(3)
		c.target.y -= 4
		await P.frames(3)
		const eye = e.camera.position
		return { room: rooms.current?.group ?? null, overFloor: +(eye.y - rooms.floorAt(e.objects, eye)).toFixed(2), overTerrain: +(eye.y - e.terrain.heightAt(eye.x, eye.z)).toFixed(2) }
	}
	const low = await down()
	const off = await fly(false)
	const result = {
		ok: on.room === '49 Trade District' && on.lift === 0 && low.room === 49 && Math.abs(low.overFloor - 3) < 0.05 && on.side > 0.6 && on.wallDist > 0.6 && on.near === 0.5 && off.side < -5,
		on,
		low,
		off,
	}
	return result
})()
await reset()

prefs.cameraFollowGround = false
await P.frames(2)
const walk = await (async () => {
	const start = spot.clone().addScaledVector(dir, -3).applyMatrix4(m)
	const along = dirWorld.clone().set(-dirWorld.z, 0, dirWorld.x).normalize()
	// Start the walk from 1 yd over the spot (6 yd up the eye finds the top of a wall by the street): it comes down to the street under the eye.
	e.setSceneView({ target: [start.x, start.y + 1, start.z], yaw: 2, pitch: 0.1, distance: 0.5, hour: 13 })
	await P.frames(3)
	ui.walkCamera = true
	await P.frames(3)
	const sample = () => {
		const eye = e.camera.position
		return {
			room: rooms.current?.group ?? null,
			overFloor: +(eye.y - rooms.floorAt(e.objects, eye)).toFixed(2),
			overTerrain: +(eye.y - e.terrain.heightAt(eye.x, eye.z)).toFixed(2),
		}
	}
	const first = sample()
	const walk = []
	for (const sign of [1, -1]) {
		const o = c.target.clone()
		for (let i = 1; i <= 40; i++) {
			c.target.x = o.x + along.x * sign * i * 0.5
			c.target.z = o.z + along.z * sign * i * 0.5
			await P.frames(1)
			walk.push(sample())
		}
		c.target.x = o.x
		c.target.z = o.z
		await P.frames(2)
	}
	// At the room's south wall (#313): 6 yd towards it from 3 yd back, a 0.5 yd step a frame, the walker
	// stops off the wall (the near plane's corner reach, about 0.9 yd) and stays in room 49; on the old
	// code it walks through onto the floor beyond.
	const wo = c.target.clone()
	for (let i = 1; i <= 12; i++) {
		c.target.x = wo.x + dirWorld.x * i * 0.5
		c.target.z = wo.z + dirWorld.z * i * 0.5
		await P.frames(1)
	}
	await P.frames(2)
	const atWall = {
		room: rooms.current?.group ?? null,
		// How far on the room's side of the wall the eye is (yd); negative is through it.
		side: +(-e.camera.position.clone().sub(wallWorld).dot(dirWorld)).toFixed(2),
		overFloor: sample().overFloor,
	}
	ui.walkCamera = before.walk
	prefs.cameraFollowGround = before.follow
	await P.frames(2)
	const inRoom = walk.filter((s) => s.room !== null)
	const off = inRoom.map((s) => Math.abs(s.overFloor - 3))
	const terrain = walk.map((s) => s.overTerrain)
	const result = {
		ok: first.room === 49 && Math.abs(first.overFloor - 3) < 0.05 && first.overTerrain < 1 && inRoom.length >= 40 && Math.max(...off) < 0.05 && atWall.room === 49 && atWall.side > 0.5 && Math.abs(atWall.overFloor - 3) < 0.05,
		first,
		atWall,
		inRoom: inRoom.length,
		worstOverFloor: +Math.max(...off).toFixed(2),
		overTerrain: [Math.min(...terrain), Math.max(...terrain)],
	}
	return result
})()
await reset()

return { ok: over.ok && collide.ok && walk.ok, over, collide, walk, glErrors: P.glError() }
