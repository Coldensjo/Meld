// Show › Walkable ground's tile builds run in Web Workers (#508), which gather each tile's triangles from their own copy of the ground, liquids and placed faces (#633): in the benchmark scene (Northshire Abbey, 177 tiles) the workers build every tile, the longest frame's NavPreview.update falls well under the main-thread build's, and after a model moved, a bump sculpted and a hole cut (sent to the workers' copy as changes, not whole) the drawn surface and a path over it come out the same as the main thread's build of every tile.
// touches: frontend/src/lib/world/nav/*
const e = P.e
const { prefs } = await P.state()
const { navWorkers, useNavWorkers } = await P.app('/src/lib/world/nav/navJobs.ts')
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

// Each frame's NavPreview.update, the main thread's share of the build.
let longest = 0
let total = 0
let most = 0
const update = nav.update
nav.update = function (...args) {
	const t0 = performance.now()
	update.apply(this, args)
	const ms = performance.now() - t0
	longest = Math.max(longest, ms)
	total += ms
	most = Math.max(most, navWorkers().jobs)
}
const built = async (what) => {
	longest = total = most = 0
	const t0 = performance.now()
	const c = await P.until(
		() => {
			const k = nav.counts
			return k.total > 0 && k.done === k.total && k.loading === 0 && !k.settling && k
		},
		400_000,
		what,
	)
	return { tiles: c.total, builds: c.builds, longestUpdateMs: +longest.toFixed(1), updateMs: Math.round(total), wallMs: Math.round(performance.now() - t0), mostJobsOut: most }
}
// The surface's vertices, summed with their positions, and a path round the abbey.
const surface = () => {
	let n = 0
	let sum = 0
	for (const m of nav.group.children) {
		if (!m.isMesh || !m.geometry.attributes.color) continue
		const p = m.geometry.attributes.position.array
		n += p.length / 3
		for (let i = 0; i < p.length; i++) sum += p[i]
	}
	return { verts: n, sum: Math.round(sum) }
}
const path = () => {
	nav.clearPath()
	nav.pathPoint(at(-40, 20))
	const r = nav.pathPoint(at(10, 45))
	nav.clearPath()
	return r.kind === 'path' ? +r.yards.toFixed(2) : r.kind
}

// #633: the changes the workers' copy takes: a model moved 3 yd, a 2 yd bump and a hole cell, each
// near the abbey; undone in the finally.
const g = e.terrain
const cs = g.cellSize
const bx = Math.round((t.x + 20) / cs)
const bz = Math.round((t.z - 25) / cs)
const bump = []
for (let z = bz - 2; z <= bz + 2; z++) for (let x = bx - 2; x <= bx + 2; x++) bump.push([z * g.verts + x, g.heights[z * g.verts + x]])
const hx = Math.floor((t.x - 15) / cs)
const hz = Math.floor((t.z - 30) / cs)
const hole = g.holes[hz * g.size + hx]
let moved = null
let movedFrom = null
const edit = () => {
	let best = Infinity
	for (const id of nav.placed.keys()) {
		const o = e.objects.objects.get(id)
		const d = o ? Math.hypot(o.x - t.x, o.z - t.z) : Infinity
		if (o && o.type.startsWith('m2:') && d < best) {
			best = d
			moved = o
		}
	}
	movedFrom = e.objects.worldPlacement(moved)
	const w = e.objects.worldPlacement(moved)
	w.pos.x += 3
	e.objects.place(moved, null, w)
	for (const [i] of bump) g.heights[i] += 2
	g.markDirty(bx - 2, bz - 2, bx + 2, bz + 2)
	g.holes[hz * g.size + hx] = 1
	g.touchHoles({ x0: hx, z0: hz, x1: hx, z1: hz })
	g.markDirty(hx, hz, hx + 1, hz + 1)
}
const undo = () => {
	if (moved) e.objects.place(moved, null, movedFrom)
	for (const [i, h] of bump) g.heights[i] = h
	g.markDirty(bx - 2, bz - 2, bx + 2, bz + 2)
	g.holes[hz * g.size + hx] = hole
	g.touchHoles({ x0: hx, z0: hz, x1: hx, z1: hz })
	g.markDirty(hx, hz, hx + 1, hz + 1)
}

let worker, edited, main, inWorker, inMain, pathWorker, pathMain, used
try {
	prefs.navView = true
	worker = await built('the tiles in the workers')
	used = navWorkers()
	const before = nav.counts.builds
	edit()
	await P.frames(2)
	edited = await built('the tiles the changes touch, in the workers')
	edited.rebuilt = edited.builds - before
	inWorker = surface()
	pathWorker = path()

	// The same build on the main thread, as without workers.
	useNavWorkers(false)
	prefs.navView = false
	await P.frames(2)
	prefs.navView = true
	main = await built('the tiles on the main thread')
	inMain = surface()
	pathMain = path()
} finally {
	nav.update = update
	useNavWorkers(true)
	prefs.navView = false
	await P.frames(2)
	undo()
	await P.frames(2)
}

const ok =
	used.workers > 0 &&
	!used.broken &&
	worker.mostJobsOut > 0 &&
	edited.rebuilt > 0 &&
	edited.rebuilt < worker.tiles / 2 &&
	main.mostJobsOut === 0 &&
	worker.tiles === main.tiles &&
	inWorker.verts > 0 &&
	inWorker.verts === inMain.verts &&
	inWorker.sum === inMain.sum &&
	pathWorker === pathMain &&
	worker.longestUpdateMs < main.longestUpdateMs
return { ok, workers: used.workers, worker, edited, main, moved: moved?.type, inWorker, inMain, pathWorker, pathMain }
