// The hole walls (the Select tool's edge ribbons) fade with the camera's distance (#249): drawn near a hole, gone from across the map, and shown round the cursor at any distance.
// touches: frontend/src/lib/tools/HoleWalls.ts, frontend/src/lib/terrain/holes.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
editor.selection = { x0: 120, z0: 120, x1: 127, z1: 127 }
e.setHoleInSelection(true)
editor.selection = null
await P.frames(1)
const t = e.terrain
const cs = t.cellSize
const walls = e.ctx.holeWalls
const cx = 124 * cs
const cz = 124 * cs
// A square camera of our own, so the ribbons' width (a share of the cursor's distance) is a few pixels in every view.
const cam = e.camera.clone()
cam.aspect = 1
cam.updateProjectionMatrix()
const ray = e.raycaster.ray
// Draws the ribbons alone with the cursor at (gx, gz), the hover highlight and badges hidden; `ribbons` false gives the empty view.
const view = (camPos, gx, gz, ribbons = true) =>
	P.shot(() => {
		cam.position.set(camPos[0], camPos[1], camPos[2])
		cam.lookAt(cx, 0, cz)
		cam.updateMatrixWorld()
		e.raycaster.camera = cam
		ray.origin.set(gx, 50, gz)
		ray.direction.set(0, -1, 0)
		walls.frame(e.ctx)
		walls.hoverRibbon.visible = walls.hoverGlow.visible = walls.plus.visible = walls.minus.visible = false
		walls.ribbons.visible = ribbons
		e.renderer.render(walls.group, cam)
		walls.ribbons.visible = true
	})
const share = async (camPos, gx, gz) => P.diff(await view(camPos, gx, gz, false), await view(camPos, gx, gz), 30).off
const near = [cx, 40, cz + 30]
const far = [cx, 250, cz + 900]
// The cursor far from the hole (cell 20, 20), or just inside it.
const away = [20 * cs, 20 * cs]
const onHole = [123 * cs, 123 * cs]
const nearAway = await share(near, ...away)
const farAway = await share(far, ...away)
const farOnHole = await share(far, ...onHole)
return { ok: nearAway > 0.002 && farAway === 0 && farOnHole > 0.0001 && P.glError() === 0, nearAway, farAway, farOnHole, walls: walls.walls.length }
