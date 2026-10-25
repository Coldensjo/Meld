// Camera › Walk on a WMO's floor (#312): started over Stormwind's Trade District street (group 49), the
// walker stands 3 yd over the street's floor (`rooms.floorAt`), not over the terrain, which there runs
// level with the eye; walked 20 yd each way along the street (through groups 49, 48 and 50) it stays
// 3 yd over the floor in every room, while its height over the terrain swings from -0.5 to 8.7 yd
// (docs/tests/rendering.md). Where it leaves the rooms it stands on the terrain. Walked at the room's
// south wall it stops off it, still in room 49 (#313).
// touches: frontend/src/lib/world/wmoRoom.ts, frontend/src/lib/world/WmoRooms.ts, frontend/src/lib/engine/CameraController.ts, internal/wow/wmonav.go
await P.scene(P.BENCH)
await P.settle()
const e = P.e
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const { prefs, ui } = await P.state()
const { nearestFaceDist, toModel } = await P.app('/src/lib/world/wmoRoom.ts')
const rooms = e.rooms
const c = e.controller
const sw = [...e.objects.objects.values()].find((o) => o.type.includes('stormwind.wmo'))
const m = e.camera.matrixWorld.clone()
e.objects.matrixOf(sw, m)
const before = { follow: prefs.cameraFollowGround, walk: ui.walkCamera }
prefs.cameraFollowGround = false
await P.frames(2)
await P.until(() => rooms.navs.get(sw.type.slice('wmo:'.length).toLowerCase()) || null, 60_000, "Stormwind's room data")
const nav = rooms.navs.get(sw.type.slice('wmo:'.length).toLowerCase())
// wmo-collide's spot by the room's south wall, 3 yd back from it; the street runs along the wall.
const spot = e.camera.position.clone().set(-51, 3.78, -249.13)
const q = [0, 0, 0]
const eyeM = toModel(spot, [0, 0, 0])
nearestFaceDist(nav, eyeM[0], eyeM[1], eyeM[2], 2, q)
const wallLocal = spot.clone().set(q[0], q[2], -q[1])
const dir = wallLocal.clone().sub(spot).normalize()
const start = spot.clone().addScaledVector(dir, -3).applyMatrix4(m)
const wallWorld = wallLocal.clone().applyMatrix4(m)
const dirWorld = wallWorld.clone().sub(spot.clone().applyMatrix4(m)).normalize()
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
return {
	ok: first.room === 49 && Math.abs(first.overFloor - 3) < 0.05 && first.overTerrain < 1 && inRoom.length >= 40 && Math.max(...off) < 0.05 && atWall.room === 49 && atWall.side > 0.5 && Math.abs(atWall.overFloor - 3) < 0.05,
	first,
	atWall,
	inRoom: inRoom.length,
	worstOverFloor: +Math.max(...off).toFixed(2),
	overTerrain: [Math.min(...terrain), Math.max(...terrain)],
	glErrors: P.glError(),
}
