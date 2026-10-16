// What is loading from the client (#159), for the loading bar along the viewport's top. Every read
// through `/wow/*` (`fetchBinary` in api.ts) calls `begin` and `end`. These are plain counters, never
// reactive state: a region opening fires hundreds of reads, and `LoadingBar.svelte` copies them out a
// few times a second. A batch runs from the first read after an idle moment to the last one ending:
// the counts start over with the next batch.

export interface LoadBatch {
	/** Reads started in this batch. */
	started: number
	/** Reads ended in this batch, failed ones included. */
	done: number
	/** Reads that failed in this batch. */
	failed: number
	/** The endpoint and path of the read started last. */
	kind: string
	path: string
	/** When the batch's oldest still-open stretch began (performance.now()), or 0 while idle. */
	since: number
}

const batch: LoadBatch = { started: 0, done: 0, failed: 0, kind: '', path: '', since: 0 }

/** A read from the client starts. */
export function beginLoad(kind: string, path: string, now = performance.now()) {
	if (batch.started === batch.done) {
		batch.started = batch.done = batch.failed = 0
		batch.since = now
	}
	batch.started++
	batch.kind = kind
	batch.path = path
}

/** A read from the client ends, `failed` when it threw. */
export function endLoad(failed: boolean) {
	batch.done++
	if (failed) batch.failed++
	if (batch.done >= batch.started) batch.since = 0
}

/** The current batch, copied into `out`. */
export function readLoad(out: LoadBatch): LoadBatch {
	return Object.assign(out, batch)
}
