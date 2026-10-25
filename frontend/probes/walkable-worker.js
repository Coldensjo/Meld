// View › Walkable ground's tile builds run in Web Workers (#508): in the benchmark scene (Northshire Abbey, 177 tiles) the workers build every tile, the longest frame's NavPreview.update falls well under the main-thread build's (only the gathering is left on the main thread), and the drawn surface and a path over it come out the same as the main thread's build.
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

let worker, main, inWorker, inMain, pathWorker, pathMain, used
try {
	prefs.navView = true
	worker = await built('the tiles in the workers')
	used = navWorkers()
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
}

const ok =
	used.workers > 0 &&
	!used.broken &&
	worker.mostJobsOut > 0 &&
	main.mostJobsOut === 0 &&
	worker.tiles === main.tiles &&
	inWorker.verts > 0 &&
	inWorker.verts === inMain.verts &&
	inWorker.sum === inMain.sum &&
	pathWorker === pathMain &&
	worker.longestUpdateMs < main.longestUpdateMs
return { ok, workers: used.workers, worker, main, inWorker, inMain, pathWorker, pathMain }
