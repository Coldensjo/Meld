// Run with: bun test tests/docOverlay.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DocOverlay } from '../src/lib/engine/docOverlay.ts'

type Doc = { id: number }

/** An overlay over a fake source: the reads it started (resolve or reject them by hand) and what it drew. */
function setup() {
	let mapKnown = true
	const docs: Doc[] = [{ id: 1 }, { id: 2 }]
	let current = docs[0]
	const reads: { doc: Doc; resolve: (v: string) => void; reject: (e: unknown) => void }[] = []
	const drawn: [number, string | null][] = []
	const failures: unknown[] = []
	const o = new DocOverlay<Doc, string>({
		what: 'test data',
		current: () => current,
		load: (doc) =>
			mapKnown
				? new Promise<string>((resolve, reject) => {
						reads.push({ doc, resolve, reject })
					})
				: null,
		apply: (doc, data) => drawn.push([doc.id, data]),
		failed: (err) => failures.push(err),
	})
	return { o, docs, reads, drawn, failures, use: (d: Doc) => (current = d), known: (k: boolean) => (mapKnown = k) }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test('a shown overlay reads its document once, and not while hidden or already reading', async () => {
	const { o, reads, drawn } = setup()
	o.update(false)
	assert.equal(reads.length, 0, 'hidden: no read')
	o.update(true)
	o.update(true)
	assert.equal(reads.length, 1, 'one read while it runs')
	reads[0].resolve('a')
	await settle()
	assert.deepEqual(drawn, [[1, 'a']])
	o.update(true)
	assert.equal(reads.length, 1, 'read once per document')
	o.reset()
	o.update(true)
	assert.equal(reads.length, 2, 'reset reads again')
})

test('a read that comes back for another tab, or while edited, draws nothing', async () => {
	const { o, docs, reads, drawn, use } = setup()
	o.update(true)
	use(docs[1])
	reads[0].resolve('old tab')
	await settle()
	assert.deepEqual(drawn, [], 'late read for the old tab dropped')
	o.update(true)
	assert.equal(reads.length, 2, 'the new tab is read next')
	assert.equal(reads[1].doc.id, 2)
	o.edited = true
	reads[1].resolve('while edited')
	await settle()
	assert.deepEqual(drawn, [], 'a window drawing its own copy keeps it')
	o.reset()
	o.update(true)
	assert.equal(reads.length, 2, 'no read while edited')
})

test('a failed read warns, tells the source and draws nothing for the document, once', async () => {
	const { o, reads, drawn, failures } = setup()
	const warn = console.warn
	const warned: unknown[][] = []
	console.warn = (...a: unknown[]) => void warned.push(a)
	try {
		o.update(true)
		reads[0].reject(new Error('no client'))
		await settle()
	} finally {
		console.warn = warn
	}
	assert.deepEqual(drawn, [[1, null]])
	assert.equal(warned.length, 1)
	assert.equal(warned[0][0], 'test data not read')
	assert.equal(failures.length, 1, 'the source is told, for its status line')
	assert.equal((failures[0] as Error).message, 'no client')
	o.update(true)
	assert.equal(reads.length, 1, 'not tried again every frame')
})

test('a map whose ID is not known yet is tried again next frame', () => {
	const { o, reads, known } = setup()
	known(false)
	o.update(true)
	assert.equal(reads.length, 0)
	known(true)
	o.update(true)
	assert.equal(reads.length, 1)
})
