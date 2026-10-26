// A model's bounds tree, LOD and WMO group cull are built in the model workers, off the main thread (#507): loading Stormwind's WMO (1.3M triangles, over a second of bounds tree, LOD and twin index on the main thread before) stalls the page for a fraction of that, and what the worker built matches a main-thread build of the same index (the LOD merged by class, as a far WMO's is, #691).
// touches: frontend/src/lib/models/assets.ts, frontend/src/lib/models/modelBuild.ts, frontend/src/lib/models/modelWorker.ts, frontend/src/lib/models/lod.ts, frontend/src/lib/world/wmoGroupCull.ts, frontend/src/lib/models/farLayers.ts
const THREE = await P.app('/deps/three.js')
const assets = await P.app('/src/lib/models/assets.ts')
const { modelWorkers } = await P.app('/src/lib/models/modelBuild.ts')
const { WmoGroupCull, cullData } = await P.app('/src/lib/world/wmoGroupCull.ts')
const { farMerge, lodIndex, lodReady } = await P.app('/src/lib/models/lod.ts')
const type = 'wmo:World\\wmo\\Azeroth\\Buildings\\Stormwind\\Stormwind.wmo'
assets.releaseAssets([type])

// The longest the main thread went without running a task while the model loaded.
let longest = 0
let running = true
const ch = new MessageChannel()
let last = performance.now()
ch.port1.onmessage = () => {
	const now = performance.now()
	longest = Math.max(longest, now - last)
	last = now
	if (running) ch.port2.postMessage(0)
}
ch.port2.postMessage(0)
const t0 = performance.now()
const a = await assets.loadAsset(type)
const loadMs = performance.now() - t0
// The meter's tick queued behind the load's last task runs first, and books its gap.
await new Promise((r) => {
	const c = new MessageChannel()
	c.port1.onmessage = r
	c.port2.postMessage(0)
})
running = false
if (!a.ready) throw new Error('Stormwind did not load')

let t = performance.now()
const cull = WmoGroupCull.of(a.geometry)
const cullOfMs = performance.now() - t
const workers = modelWorkers()

// The same builds on the main thread, from the index the worker's tree reordered.
const g = a.geometry
t = performance.now()
const twin = cullData(g.index.array, g.groups, g.getAttribute('position').array, g.getAttribute('wmoRoom').array)
await lodReady
const lod = lodIndex(g.index.array, g.groups, g.getAttribute('position').array, g.boundingSphere.radius)
const mainMs = performance.now() - t
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])
const twinSame = !!cull && !!twin && same(cull.geometry.index.array, twin.index)
// A WMO's LOD is merged by class (#691): the same merge of the main-thread LOD.
const classes = a.lod?.userData.farClasses
const far = classes && lod ? farMerge(lod, classes, g.groups.length, g.getAttribute('position').count) : null
const lodSame = !!a.lod && !!lod && (classes ? !!far && same(a.lod.index.array, far.index) && a.lod.getAttribute('position').count === far.src.length : same(a.lod.index.array, lod.index))

// A ray down onto the city hits it through the tree the worker built.
const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
const c = new THREE.Vector3()
a.bbox.getCenter(c)
const ray = new THREE.Raycaster(new THREE.Vector3(c.x, a.bbox.max.y + 10, c.z), new THREE.Vector3(0, -1, 0))
ray.firstHitOnly = true
const hits = ray.intersectObject(mesh, false).length

const ok = workers.workers > 0 && !workers.broken && !!g.boundsTree && twinSame && lodSame && hits === 1 && cullOfMs < 20 && longest < 300
return { ok, workers, triangles: g.index.count / 3, loadMs: Math.round(loadMs), longestStallMs: Math.round(longest), cullOfMs: +cullOfMs.toFixed(1), mainThreadTwinAndLodMs: Math.round(mainMs), twinSame, lodSame, farMerged: !!classes, hits }
