// View › Walkable ground (#175) on a flat map: the navmesh tiles build around the target, Test a Path's two clicks give a walk, a path goes straight over open ground and round a line of holes, Goldshire's inn brings floors above the ground, moving it builds again only the tiles it meets (#509), so does a small sculpt and hole (#620), a river 2 yd deep across the map is swim area only a swimmer crosses (#239), and turning the view off frees it all.
// touches: frontend/src/lib/world/nav/*
const e = P.e
const { prefs } = await P.state()
// Orbit the map's centre: the default flying camera sits 250 yd up and Test a Path's clicks land past the built tiles (#256).
prefs.cameraFollowGround = true
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const nav = e.nav
const t = e.controller.target.clone()
const ground = e.terrain.heightAt(t.x, t.z)
const at = (dx, dz) => {
	const v = t.clone()
	v.x += dx
	v.z += dz
	v.y = e.terrain.heightAt(v.x, v.z)
	return v
}
const built = (what) =>
	P.until(
		() => {
			const c = nav.counts
			return c.total > 0 && c.done === c.total && c.loading === 0 && !c.settling && c
		},
		180_000,
		what,
	)
const triangles = () => nav.group.children.reduce((n, m) => n + (m.isMesh ? m.geometry.attributes.position.count / 3 : 0), 0)
const path = (a, b) => {
	nav.clearPath()
	nav.pathPoint(a)
	return nav.pathPoint(b)
}

prefs.navView = true
const t0 = performance.now()
const first = await built('the first tiles')
const buildMs = Math.round(performance.now() - t0)
const tris = triangles()
const straight = path(at(-30, 0), at(30, 0))

// View › Test a Path through the viewport: two clicks on the ground, the walk in the status bar.
const { ui } = await P.state()
e.startPathTest()
for (const dx of [-80, 80]) await P.click(0.5 + dx / e.renderer.domElement.clientWidth, 0.6)
const clicked = ui.status

// A line of holes 80 yd long across the way: the path goes round one of its ends.
const cs = e.terrain.cellSize
const size = e.terrain.size
const cz = Math.floor(t.z / cs)
for (let cx = Math.floor((t.x - 40) / cs); cx <= Math.floor((t.x + 40) / cs); cx++) e.terrain.holes[cz * size + cx] = 1
e.terrain.touchHoles()
e.terrain.markAllDirty()
await P.frames(2)
await built('the tiles after the holes')
const around = path(at(0, -15), at(0, 15))

// Goldshire's inn 60 yd away: its floors and stairs are walkable ground above the terrain.
const inn = e.objects.add({ type: 'wmo:World\\wmo\\Azeroth\\Buildings\\GoldshireInn\\GoldshireInn.wmo', x: t.x, z: t.z + 60, yOff: 0, rotY: 0, scale: 1 })
await P.frames(2)
await built('the tiles after the inn')
let high = 0
for (const m of nav.group.children) {
	if (!m.isMesh) continue
	const p = m.geometry.attributes.position.array
	for (let i = 0; i < p.length; i += 3) {
		if (Math.abs(p[i] - inn.x) < 15 && Math.abs(p[i + 2] - inn.z) < 15 && p[i + 1] > ground + 3) high++
	}
}

// #509: moving the inn 3 yd builds again only the tiles its boxes meet (its client tile's height
// span stays), and gives the same surface as building every tile again (a hole's touch forces that).
const surface = () => {
	let n = 0
	for (const m of nav.group.children) if (m.isMesh && m.geometry.attributes.color) n += m.geometry.attributes.position.count
	return n
}
const before = nav.counts.builds
const w = e.objects.worldPlacement(inn)
w.pos.x += 3
e.objects.place(inn, null, w)
await P.frames(2)
const moved = await built('the tiles after moving the inn')
const movedBuilds = moved.builds - before
const partial = surface()
e.terrain.touchHoles()
await P.frames(2)
const all = await built('every tile again')
const fullBuilds = all.builds - moved.builds
const whole = surface()

// #620: a small sculpt (a 2 yd bump) and a hole cell build again only the tiles they touch, and give
// the same surface as building every tile again. Both sit in the inn's client tile (the target is a
// client tile corner), under its roof's height, so the tile's height span stays.
const vx = Math.round((t.x + 35) / cs)
const vz = Math.round((t.z + 30) / cs)
for (let z = vz - 2; z <= vz + 2; z++) for (let x = vx - 2; x <= vx + 2; x++) e.terrain.heights[z * e.terrain.verts + x] += 2
e.terrain.markDirty(vx - 2, vz - 2, vx + 2, vz + 2)
const hx = Math.floor((t.x + 15) / cs)
const hz = Math.floor((t.z + 35) / cs)
e.terrain.holes[hz * size + hx] = 1
e.terrain.touchHoles({ x0: hx, z0: hz, x1: hx, z1: hz })
e.terrain.markDirty(hx, hz, hx + 1, hz + 1)
await P.frames(2)
const sculpted = await built('the tiles after the sculpt')
const sculptBuilds = sculpted.builds - all.builds
const sculptPartial = surface()
e.terrain.touchHoles()
await P.frames(2)
const sculptAll = await built('every tile again after the sculpt')
const sculptWhole = surface()

// A river 2 yd deep down one chunk row 50 yd south of the target, across the whole map (#239): swim
// area (blue), which a walking creature can't cross and a swimming one can.
const liquids = e.doc.liquids
const chunkCells = 8
const row = Math.floor((t.z - 50) / (chunkCells * cs))
for (let c = 0; c < liquids.side; c++) {
	const layer = { id: 1, heights: new Float32Array(81).fill(ground + 2), depth: new Float32Array(81).fill(1), cells: new Uint8Array(64).fill(1) }
	liquids.set(row * liquids.side + c, [layer])
}
await P.frames(2)
await built('the tiles after the river')
let blue = 0
for (const m of nav.group.children) {
	if (!m.isMesh) continue
	const col = m.geometry.attributes.color?.array
	if (!col) continue // the path's markers
	for (let i = 0; i < col.length; i += 3) if (col[i + 2] > 0.7 && col[i] < 0.3) blue++
}
const riverZ = (row + 0.5) * chunkCells * cs
const across = path(at(0, riverZ - t.z + 30), at(0, riverZ - t.z - 30))

prefs.navView = false
await P.frames(3)
const freed = nav.group.children.length === 0 && nav.counts.total === 0

const ok =
	first.total > 100 &&
	tris > 0 &&
	straight.kind === 'path' &&
	clicked.startsWith('A creature walks') &&
	Math.abs(straight.yards - 60) < 2 &&
	around.kind === 'path' &&
	around.yards > 70 &&
	high > 0 &&
	movedBuilds > 0 &&
	movedBuilds < first.total / 4 &&
	fullBuilds === all.total &&
	partial === whole &&
	sculptBuilds > 0 &&
	sculptBuilds < first.total / 4 &&
	sculptAll.builds - sculpted.builds === sculptAll.total &&
	sculptPartial === sculptWhole &&
	blue > 0 &&
	across.kind === 'swim' &&
	freed
return { ok, tiles: first.total, buildMs, tris, straight, clicked, around, innFloorVerts: high, movedBuilds, fullBuilds, partial, whole, sculptBuilds, sculptPartial, sculptWhole, riverVerts: blue, across, freed }
