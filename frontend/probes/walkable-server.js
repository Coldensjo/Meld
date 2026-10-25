// View › Server's mmaps (#240) in the benchmark scene (Azeroth 32_48, Northshire Abbey): the walkable-ground view reads the server's own movement maps for the client tiles around the target (needs the VMaNGOS folder set and its data/mmaps built for map 0), draws them on the ground in the editor's frame, path tests walk over them, the same four paths round and through the abbey over the browser's own build come out within 12% as long (#282), and turning the view off frees it all.
// touches: frontend/src/lib/world/nav/*, internal/vmangos/mmaps.go
const e = P.e
const { prefs } = await P.state()
await P.scene(P.BENCH)
await P.settle()
const nav = e.nav
const t = e.controller.target.clone()
const at = (dx, dz) => {
	const v = t.clone()
	v.x += dx
	v.z += dz
	v.y = e.terrain.heightAt(v.x, v.z)
	return v
}
const loaded = (what) =>
	P.until(
		() => {
			const c = nav.counts
			return c.total > 0 && c.done === c.total && c.loading === 0 && !c.settling && c
		},
		180_000,
		what,
	)
const path = (a, b) => {
	nav.clearPath()
	nav.pathPoint(a)
	return nav.pathPoint(b)
}
// Open ground south-west of the abbey, where both navmeshes walk it straight (44.8 yd).
const from = at(-60, 60)
const to = at(-20, 80)
// Round and through the abbey, where the browser's build once walked the crawlspace under its floor
// (#282): from the west door's steps out to the graveyard, south to north and west to east.
const pairs = [
	[at(-40, 20), at(10, 45)],
	[at(0, -30), at(0, 30)],
	[at(-30, 0), at(30, 0)],
	[from, to],
]
const walks = () => pairs.map(([a, b]) => path(a, b))

prefs.navView = true
prefs.navServer = true
const t0 = performance.now()
const server = await loaded("the server's tiles")
const loadMs = Math.round(performance.now() - t0)
const serverMode = nav.serverMode
const error = nav.serverError

// The drawn surface in world space: the vertices near the target lie on the ground (or a floor above it), not mirrored away.
nav.group.updateMatrixWorld(true)
const v = new e.controller.target.constructor()
let tris = 0
let near = 0
let best = Infinity
nav.group.traverse((m) => {
	if (!m.isMesh || !m.geometry.attributes.color) return
	const p = m.geometry.attributes.position
	tris += p.count / 3
	for (let i = 0; i < p.count; i += 3) {
		v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
		if (Math.abs(v.x - from.x) > 6 || Math.abs(v.z - from.z) > 6) continue
		near++
		best = Math.min(best, Math.abs(v.y - e.terrain.heightAt(v.x, v.z)))
	}
})
const serverWalks = walks()
const walk = serverWalks[3]

// The same walk over the browser's build of the same ground.
prefs.navServer = false
await P.frames(2)
const own = await loaded("the browser's tiles")
const ownWalks = walks()
const ownWalk = ownWalks[3]
const agree = serverWalks.map((w, i) => w.kind === 'path' && ownWalks[i].kind === 'path' && Math.abs(w.yards - ownWalks[i].yards) <= 0.12 * w.yards)

prefs.navView = false
await P.frames(3)
const freed = nav.group.children.length === 0 && nav.counts.total === 0

const ok = serverMode && !error && server.missing === 0 && tris > 0 && near > 0 && best < 1.5 && walk.kind === 'path' && ownWalk.kind === 'path' && agree.every(Boolean) && freed
const yards = (ws) => ws.map((w) => (w.kind === 'path' ? Math.round(w.yards * 10) / 10 : w.kind))
return { ok, tiles: server.total, missing: server.missing, loadMs, error, tris, nearVerts: near, groundGap: Math.round(best * 100) / 100, serverYards: yards(serverWalks), ownTiles: own.total, ownYards: yards(ownWalks), agree, freed }
