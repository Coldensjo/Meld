// Runs the walkable-ground view's Recast tile builds in Web Workers (navWorker.ts, #508), so a dense
// tile (the abbey's, a city's) no longer holds a frame for its whole build. Each worker keeps a copy
// of the ground, the liquids and the placed models (navScene.ts, #633; it places their faces, #849), which NavPreview keeps
// up to date with `sendNavScene`, and gathers each tile's triangles from it too; NavPreview keeps the
// navmesh and the path test on the main thread, and a worker hands back Detour's tile bytes and the
// surface to draw. Where workers can't run (Bun's tests) or a worker fails, `navWorkersReady` says
// no and NavPreview gathers and builds on the main thread, as before.

import { tileBuffers, type TileJob, type TileOutput } from './navBuild'
import { sceneCopy, type GatherJob, type SceneUpdate } from './navScene'

/** Jobs a worker holds at once: one building and the next waiting, so it never idles a frame. */
const PER_WORKER = 3

interface Waiting {
	resolve: (out: TileOutput | null) => void
	reject: (err: Error) => void
	slot: Slot
}

interface Slot {
	worker: Worker
	jobs: number
}

const slots: Slot[] = []
const waiting = new Map<number, Waiting>()
let nextId = 1
/** Set once a worker failed (it could not load, or a build threw): every build runs on the main thread from then on. */
let broken = typeof window === 'undefined' || typeof Worker === 'undefined'
/** Off for the probes' main-thread comparison (`useNavWorkers`). */
let enabled = true
/** Counts the times the workers started: workers started anew hold no copy of the scene (navScene.ts). */
let generation = 0

function start(): boolean {
	if (broken || !enabled) return false
	if (slots.length) return true
	const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1))
	generation++
	try {
		for (let i = 0; i < n; i++) {
			const slot: Slot = { worker: new Worker(new URL('./navWorker.ts', import.meta.url), { type: 'module' }), jobs: 0 }
			slot.worker.onmessage = (e: MessageEvent<{ id: number; out?: TileOutput | null; error?: string }>) => {
				if (e.data.error !== undefined) return fail(`a tile build threw: ${e.data.error}`)
				const w = waiting.get(e.data.id)
				if (!w) return
				waiting.delete(e.data.id)
				w.slot.jobs--
				w.resolve(e.data.out ?? null)
			}
			slot.worker.onerror = (e) => fail(e.message || 'the walkable-ground worker failed to start')
			slot.worker.onmessageerror = () => fail("the walkable-ground worker's message could not be read")
			slots.push(slot)
		}
	} catch (err) {
		fail(String(err))
		return false
	}
	return true
}

/** Stops the workers and turns down every job still out, for NavPreview to build again. */
function stop(why: string) {
	for (const s of slots) s.worker.terminate()
	slots.length = 0
	const left = [...waiting.values()]
	waiting.clear()
	for (const w of left) w.reject(new Error(why))
}

function fail(why: string) {
	if (broken) return
	console.warn('walkable ground: building tiles on the main thread instead:', why)
	broken = true
	stop(why)
}

/** Whether tiles build in the workers (starting them on first ask). */
export function navWorkersReady(): boolean {
	return start()
}

/** Whether a worker can take another job now. */
export function navWorkerRoom(): boolean {
	for (const s of slots) if (s.jobs < PER_WORKER) return true
	return false
}

/** Which start of the workers is running, for NavPreview to tell when they need the whole scene sent again. */
export function navWorkerGeneration(): number {
	return generation
}

/**
 * Brings every worker's copy of the scene up to date, applied in this order before any later job.
 * Each worker gets copies of the arrays (`sceneCopy`), so the caller's stay its own.
 */
export function sendNavScene(updates: readonly SceneUpdate[]) {
	if (updates.length === 0) return
	for (const s of slots) {
		const copy = sceneCopy(updates)
		s.worker.postMessage({ scene: copy.updates }, copy.transfer)
	}
}

/**
 * Builds a job's tile in the least busy worker, from the triangles it holds (`TileJob`) or gathers
 * from its scene (`GatherJob`); check `navWorkersReady` and `navWorkerRoom` first.
 */
export function buildInWorker(job: TileJob | GatherJob): Promise<TileOutput | null> {
	return new Promise((resolve, reject) => {
		let slot = slots[0]
		for (const s of slots) if (s.jobs < slot.jobs) slot = s
		const id = nextId++
		waiting.set(id, { resolve, reject, slot })
		slot.jobs++
		slot.worker.postMessage({ id, job }, 'input' in job ? tileBuffers(job) : [])
	})
}

/** Stops the workers (their WASM heaps go with them) when the view goes off; they start again on the next build. */
export function stopNavWorkers() {
	stop('the walkable-ground view went off')
}

/** For the probes: how many workers run, the jobs out, and whether they failed. */
export function navWorkers(): { workers: number; jobs: number; broken: boolean; enabled: boolean } {
	return { workers: slots.length, jobs: waiting.size, broken, enabled }
}

/** For the probes: `false` builds on the main thread (stopping the workers), `true` in the workers again. */
export function useNavWorkers(on: boolean) {
	enabled = on
	if (!on) stop('the main-thread build was asked for')
}
