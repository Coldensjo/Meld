// Flying through Blackrock Depths with the names over creatures and objects on (#286): the names' sight
// lines (`Engine.sightBlocked`, through `ObjectLayer.wmoBlocks`) test the dungeon's WMO through its
// bounds tree, so no frame stalls. The batch mesh of a big WMO draws its group cull's twin geometry
// (#198), which must share the model's tree: without it each sight line walked every triangle of the
// dungeon and frames took 1.2 to 2.4 s every two or three frames. Needs the world database for the spawns.
// touches: frontend/src/lib/world/SpawnLabels.ts, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/engine/CameraController.ts
const { editor, prefs } = await P.state()
const { openWowBuilding } = await P.app('/src/lib/io/region.ts')
prefs.spawnNames = true
openWowBuilding(P.e, 'BlackrockDepths')
await P.until(() => editor.regionMap === 'BlackrockDepths' || null, 120000, "Blackrock Depths' tab")
await P.until(() => editor.spawns.length > 0 || editor.spawnsError || null, 60000, "Blackrock Depths' spawns")
if (editor.spawnsError) throw new Error(`no spawns: ${editor.spawnsError}`)
await P.frames(5)
const e = P.e
const twins = [...e.objects.batches.values()].filter((b) => b.cull)
const twinTrees = twins.filter((b) => b.mesh.geometry.boundsTree).length

// The names' sight tests, counted and timed.
const blocked = e.spawnLabels.blocked
let tests = 0
let testMs = 0
e.spawnLabels.blocked = (to) => {
	const a = performance.now()
	const r = blocked(to)
	testMs += performance.now() - a
	tests++
	return r
}
// Fly 3 yards a frame along a path through every 25th creature, as holding W does.
const c = e.controller
const pts = editor.spawns
	.filter((s) => s.kind !== 'object')
	.sort((a, b) => a.guid - b.guid)
	.filter((_, i) => i % 25 === 0)
	.slice(0, 4)
	.map((s) => [s.x, s.y + 4, s.z])
c.target.set(...pts[0])
let worst = 0
let frames = 0
for (let k = 1; k < pts.length && frames < 40; k++) {
	const [x, y, z] = pts[k]
	for (; frames < 40; frames++) {
		const dx = x - c.target.x,
			dy = y - c.target.y,
			dz = z - c.target.z
		const d = Math.hypot(dx, dy, dz)
		if (d < 3) break
		c.yaw = Math.atan2(-dx, -dz)
		c.pitch = 0
		c.target.x += (dx / d) * 3
		c.target.y += (dy / d) * 3
		c.target.z += (dz / d) * 3
		await P.tick()
		const a = performance.now()
		e.frame()
		worst = Math.max(worst, performance.now() - a)
		await P.drawn()
	}
}
e.spawnLabels.blocked = blocked
const out = {
	spawns: editor.spawns.length,
	twins: twins.length,
	twinTrees,
	frames,
	tests,
	testMs: tests ? +(testMs / tests).toFixed(3) : null,
	worstFrameMs: Math.round(worst),
}
// SwiftShader draws a frame here in 12 to 30 ms; a stalled one took over a second.
out.ok = twins.length > 0 && twinTrees === twins.length && frames >= 20 && tests > 0 && out.testMs < 1 && worst < 500
return out
