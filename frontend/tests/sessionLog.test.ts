// Run with: bun test tests/sessionLog.test.ts
// The Log window's lines reach the session's log file (#319): `startLogFile` sends the lines already
// logged, later ones are batched until `flushLog` (or its timer), in order, and clearing the window's
// log drops none of them. The file itself is internal/sessionlog's (its Go test); startSessionLog
// only hands this the AppendLog binding as the sink.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'

const { clearLog, flushLog, logLine, setStatus, startLogFile } = await import('../src/lib/state/editor.svelte.ts')

test('lines logged before and after the start reach the sink in order, batched, and survive a cleared log', async () => {
	const mark = 'session-log-test'
	logLine(`${mark} before`)
	const sent: string[][] = []
	startLogFile(async (lines) => {
		sent.push(lines)
	})
	// The lines from before the start go at once, with their time in front.
	assert.equal(sent.length, 1)
	assert.match(sent[0].at(-1) ?? '', new RegExp(`^\\d\\d:\\d\\d:\\d\\d ${mark} before$`))

	setStatus(`${mark} one`, 0)
	logLine(`${mark} two`)
	clearLog()
	// Nothing goes until the flush: the two wait as one batch.
	assert.equal(sent.length, 1)
	flushLog()
	assert.equal(sent.length, 2)
	assert.deepEqual(
		sent[1].map((l) => l.slice(9)),
		[`${mark} one`, `${mark} two`],
	)
	// A flush with nothing waiting sends nothing.
	flushLog()
	assert.equal(sent.length, 2)

	// The timer flushes a line nobody flushed by hand.
	logLine(`${mark} three`)
	await new Promise((r) => setTimeout(r, 1100))
	assert.equal(sent.length, 3)
	assert.deepEqual(
		sent[2].map((l) => l.slice(9)),
		[`${mark} three`],
	)
})
