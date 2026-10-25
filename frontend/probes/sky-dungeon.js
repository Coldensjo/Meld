// A map with no sky (#339): Uldaman, a dungeon whose halls lie below the sea's floor with no far terrain
// around them, shows the dark earth's colour behind the map at every camera pitch and hour, with the
// editor's lighting and the client's (the sky dome hidden); Northshire, on a continent, keeps its sky.
// touches: frontend/src/lib/engine/Environment.ts, frontend/src/lib/world/HorizonLayer.ts, frontend/src/lib/wow/clientLight.ts
const scene = (pitch, hour, clientLighting) => ({
	v: 1,
	map: { region: { mapName: 'Uldaman', x: 31, y: 31, size: 2 } },
	view: { target: [89.698, -76.354, 573.131], yaw: -1.265, pitch, distance: 139.549, hour },
	prefs: { fog: false, cameraFollowGround: true, clientLighting, clouds: true, dayCycle: false, timeOfDay: hour },
	tool: 'select',
	selectedIds: [],
	selected: null,
	area: null,
	viewport: [1000, 400],
})
// The top-middle pixel of the viewport (rows run bottom-up).
const top = (img) => {
	const i = ((img.h - 3) * img.w + (img.w >> 1)) * 4
	return [img.px[i], img.px[i + 1], img.px[i + 2]]
}
const EARTH = [63, 58, 53]
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 2)
const views = {}
let ok = true
await P.scene(scene(0.32, 13, false))
await P.settle()
await P.until(() => P.e.skyless.docId === P.e.doc.id, 60_000, "Uldaman's sky known")
for (const [pitch, hour, client] of [
	[0.32, 13, false],
	[0.08, 13, false],
	[-0.3, 13, false],
	[0.08, 0, false],
	[0.08, 13, true],
	[0.08, 0, true],
]) {
	const e = P.e
	e.prefs.clientLighting = client
	e.setSceneView({ ...e.sceneView(), pitch, hour })
	await P.frames(3)
	const img = await P.shot()
	const px = top(img)
	const name = `pitch ${pitch} hour ${hour}${client ? ' client' : ''}`
	views[name] = { px: px.join(','), sky: e.env.sky.visible }
	if (!near(px, EARTH) || e.env.sky.visible) ok = false
	P.save(img, `uldaman-${pitch}-${hour}${client ? '-client' : ''}`)
}
await P.scene(P.BENCH)
await P.settle()
await P.frames(3)
const outdoors = { sky: P.e.env.sky.visible, skyless: P.e.skyless.value }
if (!outdoors.sky || outdoors.skyless) ok = false
return { ok, views, outdoors }
