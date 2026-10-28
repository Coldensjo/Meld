// Run with: bun test tests/debugLog.test.ts
// The debug log's console forwarding (#626): warnings and errors go to the sink in batches, the console
// still prints them, and stop puts the console back.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'

const { consoleArg, consoleLine, forwardConsole } = await import('../src/lib/io/debugLog.ts')

test('console arguments read as text', () => {
	assert.equal(consoleArg('plain'), 'plain')
	assert.equal(consoleArg(3), '3')
	assert.equal(consoleArg({ a: 1 }), '{"a":1}')
	assert.equal(consoleArg(undefined), 'undefined')
	assert.equal(consoleArg(null), 'null')
	const loop: { self?: unknown } = {}
	loop.self = loop
	assert.equal(consoleArg(loop), '[object Object]', 'a cycle falls back to String')
	const e = new Error('boom')
	e.stack = undefined
	assert.equal(consoleArg(e), 'Error: boom')
})

test('a line has the time, the level and the arguments', () => {
	assert.equal(consoleLine('warn', ['model', 'x.m2', { status: 404 }], new Date(2026, 0, 2, 3, 4, 5)), '03:04:05 console.warn model x.m2 {"status":404}')
})

test('warnings and errors go to the sink in one batch, and still print', async () => {
	const printed: string[] = []
	const con = { warn: (...a: unknown[]) => void printed.push(`w ${a.join(' ')}`), error: (...a: unknown[]) => void printed.push(`e ${a.join(' ')}`) }
	const origWarn = con.warn
	const sent: string[][] = []
	const fwd = forwardConsole(con, async (lines) => void sent.push(lines), 5)
	con.warn('first')
	con.error('second', 2)
	assert.deepEqual(printed, ['w first', 'e second 2'])
	assert.equal(sent.length, 0, 'nothing is sent before the batch time')
	await new Promise((r) => setTimeout(r, 30))
	assert.equal(sent.length, 1)
	assert.match(sent[0][0], /^\d\d:\d\d:\d\d console\.warn first$/)
	assert.match(sent[0][1], /console\.error second 2$/)
	con.warn('last')
	fwd.stop()
	assert.equal(sent.length, 2, 'stop sends what is waiting')
	assert.equal(con.warn, origWarn, 'stop puts the console back')
	con.warn('after')
	assert.equal(sent.length, 2)
})

test('a failing sink is swallowed', async () => {
	const con = { warn: (..._: unknown[]) => {}, error: (..._: unknown[]) => {} }
	const fwd = forwardConsole(con, () => Promise.reject(new Error('no backend')), 1)
	con.error('x')
	fwd.flush()
	await new Promise((r) => setTimeout(r, 5))
	fwd.stop()
})
