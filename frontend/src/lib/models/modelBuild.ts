import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { buildModelData, type ModelData, type ModelJob } from './modelData'
import { lodGeometry } from './lod'
import { MIN_TRIANGLES, WmoGroupCull } from '../world/wmoGroupCull'
import { ROOM_ATTRIBUTE } from '../world/roomGate'

// Builds a loaded model's bounds tree, LOD and WMO group cull in the model workers (modelWorker.ts,
// #507), so a big model's arrival no longer stalls a frame for a second. A few workers share the
// jobs, so a city's build doesn't hold up the small models behind it. Where workers can't run (Bun's
// tests) or a worker fails, the same build runs here on the main thread, as before.

interface Waiting {
	resolve: (data: ModelData) => void
	reject: (err: Error) => void
	/** Builds the job again here, its buffers having gone to the worker that failed. */
	again: () => void
	worker: Slot
}

interface Slot {
	worker: Worker
	jobs: number
}

const slots: Slot[] = []
const waiting = new Map<number, Waiting>()
let nextId = 1
/** Set once a worker failed (it could not load, or it threw): every build runs here from then on. */
let broken = typeof window === 'undefined' || typeof Worker === 'undefined'

function startWorkers(): boolean {
	if (broken) return false
	if (slots.length) return true
	const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))
	try {
		for (let i = 0; i < n; i++) {
			const slot: Slot = { worker: new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' }), jobs: 0 }
			slot.worker.onmessage = (e: MessageEvent<{ id: number; data?: ModelData; error?: string }>) => {
				const w = waiting.get(e.data.id)
				if (!w) return
				waiting.delete(e.data.id)
				w.worker.jobs--
				if (e.data.data) w.resolve(e.data.data)
				else w.reject(new Error(e.data.error ?? 'model worker failed'))
			}
			slot.worker.onerror = (e) => fail(e.message || 'model worker failed to start')
			slot.worker.onmessageerror = () => fail('model worker message could not be read')
			slots.push(slot)
		}
	} catch (err) {
		fail(String(err))
		return false
	}
	return true
}

/** Stops the workers and builds every job still out here instead. */
function fail(why: string) {
	if (broken) return
	console.warn('model worker: building models on the main thread instead:', why)
	broken = true
	for (const s of slots) s.worker.terminate()
	slots.length = 0
	const left = [...waiting.values()]
	waiting.clear()
	for (const w of left) w.again()
}

/** How many model workers run, and whether they failed (for the model-worker probe). */
export function modelWorkers(): { workers: number; broken: boolean } {
	return { workers: slots.length, broken }
}

/** Copies of the buffers of `geometry` the build reads, handed over to the worker. */
function modelJob(geometry: THREE.BufferGeometry, classes?: Int32Array): ModelJob {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute
	const index = geometry.index!.array as Uint16Array | Uint32Array
	const job: ModelJob = {
		positions: pos.array instanceof Float32Array ? pos.array.slice() : Float32Array.from(pos.array),
		index: index.slice(),
		groups: geometry.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 })),
	}
	const room = geometry.getAttribute(ROOM_ATTRIBUTE) as THREE.BufferAttribute | undefined
	// A smaller WMO gets no cull (WmoGroupCull.of tells so at once), so its rooms aren't copied.
	if (room && room.itemSize === 2 && index.length / 3 >= MIN_TRIANGLES) job.rooms = room.array instanceof Uint16Array ? room.array.slice() : Uint16Array.from(room.array)
	if (classes) job.classes = classes.slice()
	return job
}

function buildHere(geometry: THREE.BufferGeometry, classes: Int32Array | undefined, resolve: (d: ModelData) => void, reject: (e: Error) => void) {
	buildModelData(modelJob(geometry, classes)).then(resolve, reject)
}

/**
 * Builds the bounds tree, LOD and group cull of a model's `geometry` (positions, index and groups
 * set, not yet drawn) in a worker; `adoptModel` puts them on it. With `classes` (a far WMO's class of
 * each material, models/farLayers.ts) the LOD's groups are merged by class too (`ModelData.far`).
 */
export function buildModel(geometry: THREE.BufferGeometry, classes?: Int32Array): Promise<ModelData> {
	return new Promise((resolve, reject) => {
		if (!startWorkers()) return buildHere(geometry, classes, resolve, reject)
		let slot = slots[0]
		for (const s of slots) if (s.jobs < slot.jobs) slot = s
		const id = nextId++
		const job = modelJob(geometry, classes)
		waiting.set(id, { resolve, reject, again: () => buildHere(geometry, classes, resolve, reject), worker: slot })
		slot.jobs++
		const list: ArrayBuffer[] = [job.positions.buffer as ArrayBuffer, job.index.buffer as ArrayBuffer]
		if (job.rooms) list.push(job.rooms.buffer as ArrayBuffer)
		if (job.classes) list.push(job.classes.buffer as ArrayBuffer)
		slot.worker.postMessage({ id, job }, list)
	})
}

/**
 * Puts what `buildModel` built on `geometry`: the reordered index, the bounds tree and the group cull
 * (WmoGroupCull.of then finds it). Returns the LOD geometry, if the model has one.
 */
export function adoptModel(geometry: THREE.BufferGeometry, data: ModelData): THREE.BufferGeometry | undefined {
	const own = geometry.index!.array as Uint16Array | Uint32Array
	// A big model's index is a view into the whole fetched mesh (wow/api.ts fetchMesh), which its other
	// attributes keep alive: the reordered index goes back into it rather than holding a second copy.
	if (own.byteLength !== own.buffer.byteLength) own.set(data.index)
	else geometry.setIndex(new THREE.BufferAttribute(data.index, 1))
	const tree = { version: 1, roots: data.roots, index: data.index, indirectBuffer: null }
	geometry.boundsTree = MeshBVH.deserialize(tree, geometry, { setIndex: false })
	if (data.cull !== undefined) WmoGroupCull.adopt(geometry, data.cull)
	return data.lod && lodGeometry(geometry, data.lod)
}
