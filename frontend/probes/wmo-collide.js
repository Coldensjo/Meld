// Camera collision with a WMO's walls (#305): with View › Camera Collision on, the flying camera flown
// at a wall of Stormwind's Trade District room (group 49), 13 yd in one frame (through the wall, as a
// fast flight would), stops the near plane's corner reach off it, still in the room, and the near plane
// stays at 0.5 yd (docs/tests/rendering.md). The clamp keeps it 3 yd over the street's floor, not over the
// terrain (#310), so the start eye is not lifted and the eye comes down to the street. With collision off it flies through, as the author needs to enter buildings.
// touches: frontend/src/lib/engine/CameraController.ts, frontend/src/lib/world/wmoRoom.ts, frontend/src/lib/world/WmoRooms.ts, internal/wow/collision.go
await P.scene(P.BENCH)
await P.settle()
const e = P.e
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const { prefs } = await P.state()
const { nearestFaceDist, toModel } = await P.app('/src/lib/world/wmoRoom.ts')
const rooms = e.rooms
const c = e.controller
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
const before = { follow: prefs.cameraFollowGround, collision: prefs.cameraCollision }
prefs.cameraFollowGround = false
await P.frames(2)
await P.until(() => rooms.navs.get(sw.type.slice('wmo:'.length).toLowerCase()) || null, 60_000, "Stormwind's room data")
const nav = rooms.navs.get(sw.type.slice('wmo:'.length).toLowerCase())
// wmo-over's #304 spot, 0.47 yd from the room's south wall: the way to the wall's nearest point.
const spot = e.camera.position.clone().set(-51, 3.78, -249.13)
const q = [0, 0, 0]
const eyeM = toModel(spot, [0, 0, 0])
nearestFaceDist(nav, eyeM[0], eyeM[1], eyeM[2], 2, q)
const wallLocal = spot.clone().set(q[0], q[2], -q[1])
const dir = wallLocal.clone().sub(spot).normalize()
const wallWorld = wallLocal.clone().applyMatrix4(m)
const dirWorld = wallWorld.clone().sub(spot.clone().applyMatrix4(m)).normalize()
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
	return { room, lift, overFloor, side: +side.toFixed(2), wallDist: +rooms.wallDist.toFixed(2), near: +e.persp.near.toFixed(3) }
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
prefs.cameraCollision = before.collision
prefs.cameraFollowGround = before.follow
await P.frames(2)
return {
	ok: on.room === '49 Trade District' && on.lift === 0 && low.room === 49 && Math.abs(low.overFloor - 3) < 0.05 && on.side > 0.6 && on.wallDist > 0.6 && on.near === 0.5 && off.side < -5,
	on,
	low,
	off,
	glErrors: P.glError(),
}
