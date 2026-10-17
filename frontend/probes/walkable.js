// View › Walkable ground (#175) on a flat map: the navmesh tiles build around the target, Test a Path's two clicks give a walk, a path goes straight over open ground and round a line of holes, Goldshire's inn brings floors above the ground, and turning the view off frees it all.
const e = P.e
const { prefs } = await P.state()
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
	P.until(() => {
		const c = nav.counts
		return c.total > 0 && c.done === c.total && c.loading === 0 && !c.settling && c
	}, 180_000, what)
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
	freed
return { ok, tiles: first.total, buildMs, tris, straight, clicked, around, innFloorVerts: high, freed }
