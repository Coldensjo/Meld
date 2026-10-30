// Run with: bun test tests/toolwin.test.ts
// The channel between the main page and the tool windows open as their own OS windows (#909,
// lib/toolwin): the message shapes each side sends and reads, the throttle the main page publishes
// through, and the History window's view and command.
import { expect, test } from 'bun:test'
import { commandMessage, isFor, readCommand, readState, stateMessage, throttle, toolWindowKind } from '../src/lib/toolwin/channel.ts'
import { goTarget, historyView } from '../src/lib/toolwin/history.ts'
import { History } from '../src/lib/state/historyCore.ts'

const look = { theme: 'dark' as const, zoom: 1.25 }

test('a state message is read back by its own kind only', () => {
	const msg = stateMessage('history', { position: 2 }, look)
	// It goes over Wails as JSON, so it must survive the round trip as a plain object.
	const sent = JSON.parse(JSON.stringify(msg))
	expect(readState<{ position: number }>(sent, 'history')).toEqual({ kind: 'history', state: { position: 2 }, look })
	expect(readState(sent, 'inspector')).toBeNull()
	expect(readState(null, 'history')).toBeNull()
	expect(readState({ kind: 'history', look }, 'history')).toBeNull()
	expect(readState({ kind: 'history', state: 1 }, 'history')).toBeNull()
})

test('a command message is read back by its own kind only', () => {
	const sent = JSON.parse(JSON.stringify(commandMessage('history', { type: 'go', to: 3 })))
	expect(readCommand(sent, 'history')).toEqual({ type: 'go', to: 3 })
	expect(readCommand(sent, 'item')).toBeNull()
	expect(readCommand({ kind: 'history', cmd: { to: 3 } }, 'history')).toBeNull()
	expect(readCommand({ kind: 'history' }, 'history')).toBeNull()
	expect(readCommand(JSON.parse(JSON.stringify(commandMessage('history', { type: 'hello' }))), 'history')).toEqual({ type: 'hello' })
})

test("Go's closed and args events are told apart by kind", () => {
	expect(isFor({ kind: 'history' }, 'history')).toBe(true)
	expect(isFor({ kind: 'history', args: { id: '1' } }, 'inspector')).toBe(false)
	expect(isFor('history', 'history')).toBe(false)
})

test('the page query names the tool window kind, none for the main page', () => {
	expect(toolWindowKind('?window=history&id=7')).toBe('history')
	expect(toolWindowKind('')).toBe('')
	expect(toolWindowKind('?scene=1')).toBe('')
})

test('throttle runs at once, then once more at the end of the wait however many calls came', async () => {
	let runs = 0
	const t = throttle(() => runs++, 30)
	t()
	expect(runs).toBe(1)
	t()
	t()
	t()
	expect(runs).toBe(1)
	await Bun.sleep(60)
	expect(runs).toBe(2)
	// Well past the wait after that run, the next call runs at once.
	await Bun.sleep(60)
	t()
	expect(runs).toBe(3)
	// A call within the wait waits, and cancel drops it.
	t()
	t.cancel()
	await Bun.sleep(60)
	expect(runs).toBe(3)
})

test('the History view copies the undo stack as plain data', () => {
	expect(historyView(null)).toEqual({ steps: [], position: 0, bytes: 0, trimmed: false })
	const h = new History({ dirty() {}, sync() {} })
	h.push({ label: 'Raise', bytes: 10, undo() {}, redo() {} })
	h.push({ label: 'Paint', bytes: 5, undo() {}, redo() {} })
	h.undo()
	const v = historyView(h)
	expect(v.steps.map((s) => s.label)).toEqual(['Raise', 'Paint'])
	expect(v.position).toBe(1)
	expect(v.bytes).toBe(15)
	expect(v.trimmed).toBe(false)
	expect(JSON.parse(JSON.stringify(v))).toEqual(v)
})

test('a go command is kept to the stack', () => {
	expect(goTarget({ type: 'go', to: 2 }, 5)).toBe(2)
	expect(goTarget({ type: 'go', to: 9 }, 5)).toBe(5)
	expect(goTarget({ type: 'go', to: -1 }, 5)).toBe(0)
	expect(goTarget({ type: 'go', to: 1.5 }, 5)).toBeNull()
	expect(goTarget({ type: 'go', to: '2' }, 5)).toBeNull()
	expect(goTarget({ type: 'hello' }, 5)).toBeNull()
})

test('a forwarded key round trips and only the Undo and Redo keys run as editing commands (#919)', async () => {
	const { keyCommand, readKeyCommand } = await import('../src/lib/toolwin/channel.ts')
	const { forwardedEditCommand } = await import('../src/lib/toolwin/keys.ts')
	const z = { key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false }
	const msg = JSON.parse(JSON.stringify(keyCommand(z)))
	expect(msg).toEqual({ type: 'key', key: z })
	expect(readKeyCommand(msg)).toEqual(z)
	expect(readKeyCommand({ type: 'key', key: 'z' })).toBeNull()
	expect(readKeyCommand({ type: 'go' })).toBeNull()
	expect(forwardedEditCommand(msg)).toBe('undo')
	expect(forwardedEditCommand(keyCommand({ ...z, key: 'y', code: 'KeyY' }))).toBe('redo')
	expect(forwardedEditCommand(keyCommand({ ...z, key: 'q', code: 'KeyQ' }))).toBeNull()
	expect(forwardedEditCommand({ type: 'hello' })).toBeNull()
})
