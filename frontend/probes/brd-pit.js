// Blackrock Depths' Ring of Law seen from the stands above (#289): the arena's floor, below the map's floor plane (sea level - 40), is drawn, not a disc of the plane's dark earth. The plane is a backdrop drawn without depth, so it no longer hides models below it.
// touches: frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/HorizonLayer.ts, frontend/src/lib/water/Water.ts, frontend/src/lib/terrain/Terrain.ts
const { editor } = await P.state()
const { openWowBuilding } = await P.app('/src/lib/io/region.ts')
openWowBuilding(P.e, 'BlackrockDepths')
await P.until(() => editor.regionMap === 'BlackrockDepths' || null, 120000, "Blackrock Depths' tab")
const e = P.e
await P.until(() => [...e.objects.batches.keys()].some((k) => k.includes('blackrock_lower_instance.wmo')) || null, 120000, 'the dungeon')
await P.fullView()
// The owner's scene: the camera over the arena's rim, looking down into it.
e.setSceneView({ target: [746.748, -10.697, 1048.193], yaw: 13.08, pitch: 0.735, distance: 615.318, hour: 13 })
await P.settle()
await P.frames(3)
const floorY = e.water.floor.position.y
const centre = { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 }
const a = await P.shot()
P.save(a, 'pit')
// The same view with the models hidden: only the sky and the floor plane.
const objects = e.objects.group
objects.visible = false
let bare
try {
	await P.frames(2)
	bare = await P.shot()
} finally {
	objects.visible = true
}
// P.whoDrew names what drew the centre pixel: with the models it is not the plane; without them it is.
const drawn = await P.whoDrew(0.5, 0.5)
objects.visible = false
let drawnBare
try {
	drawnBare = await P.whoDrew(0.5, 0.5)
} finally {
	objects.visible = true
}
// What the arena's centre holds: the dungeon (busy, unlike the flat plane) or the plane.
const d = P.diff(a, bare, undefined, centre)
const out = {
	camera: e.camera.position.toArray().map((v) => +v.toFixed(1)),
	floorY,
	centreDiffers: +(d.off * 100).toFixed(1) + '%',
	busy: +P.busy(a, centre).toFixed(4),
	busyBare: +P.busy(bare, centre).toFixed(4),
	drawn: drawn?.chain,
	drawnBare: drawnBare,
}
// Before the fix the centre was the plane: 0% differed and it was as flat as the bare view. The arena is
// dark too, so some of its pixels match the plane; its stones make it busy.
out.ok = e.camera.position.y > floorY && d.off > 0.5 && out.busy > 3 * out.busyBare && a.lit > 0.5 && drawn && drawn.name !== 'seafloor' && drawnBare?.name === 'seafloor'
return out
