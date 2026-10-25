// Run with: bun test tests/history.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY_LIMIT, History, type Command, type HistorySink } from '../src/lib/state/historyCore.ts'

/** A sink that records what the history reports. */
function sink() {
	const s = { dirty: 0, canUndo: false, canRedo: false, syncs: 0 }
	const out: HistorySink = {
		dirty: () => void s.dirty++,
		sync: (u, r) => {
			s.canUndo = u
			s.canRedo = r
			s.syncs++
		},
	}
	return { s, out }
}

/** A counter and commands that add to it, pushed already applied as the editor does. */
function counter() {
	const state = { value: 0 }
	const add = (n: number, label = `+${n}`): Command => {
		state.value += n
		return { label, undo: () => void (state.value -= n), redo: () => void (state.value += n) }
	}
	return { state, add }
}

test('undo and redo walk the stack and report what is possible', () => {
	const { s, out } = sink()
	const h = new History(out)
	const { state, add } = counter()
	assert.equal(h.undo(), null, 'nothing to undo')
	h.push(add(1))
	h.push(add(2))
	assert.equal(state.value, 3)
	assert.deepEqual([s.canUndo, s.canRedo], [true, false])
	assert.equal(h.undo()?.label, '+2')
	assert.equal(state.value, 1)
	assert.deepEqual([s.canUndo, s.canRedo], [true, true])
	h.undo()
	assert.equal(state.value, 0)
	assert.deepEqual([s.canUndo, s.canRedo], [false, true])
	assert.equal(h.undo(), null)
	h.redo()
	h.redo()
	assert.equal(state.value, 3)
	assert.equal(h.redo(), null, 'nothing to redo')
	assert.ok(s.dirty >= 6, 'every push, undo and redo marks the map dirty')
})

test('a push after undo drops the steps that were undone', () => {
	const h = new History(sink().out)
	const { state, add } = counter()
	h.push(add(1))
	h.push(add(2))
	h.undo()
	h.push(add(10))
	assert.equal(state.value, 11)
	assert.deepEqual(
		h.steps().map((x) => x.label),
		['+1', '+10'],
	)
	assert.equal(h.redo(), null)
})

test('the stack keeps the newest HISTORY_LIMIT steps', () => {
	const h = new History(sink().out)
	const { add } = counter()
	for (let i = 0; i < HISTORY_LIMIT + 5; i++) h.push(add(1, `step ${i}`))
	const steps = h.steps()
	assert.equal(steps.length, HISTORY_LIMIT)
	assert.equal(steps[0].label, 'step 5')
	assert.equal(h.position, HISTORY_LIMIT)
})

test('replaceTop merges into the newest step, but pushes after an undo', () => {
	const h = new History(sink().out)
	const { add } = counter()
	h.push(add(1, 'nudge'))
	h.replaceTop(add(1, 'nudge x2'))
	assert.deepEqual(
		h.steps().map((x) => x.label),
		['nudge x2'],
	)
	assert.equal(h.peek()?.label, 'nudge x2')
	h.push(add(5, 'paint'))
	h.undo()
	assert.equal(h.peek(), null, 'nothing to merge into with a redo pending')
	h.replaceTop(add(2, 'sculpt'))
	assert.deepEqual(
		h.steps().map((x) => x.label),
		['nudge x2', 'sculpt'],
	)
})

test('goTo undoes or redoes to a position, one step at a time', () => {
	const h = new History(sink().out)
	const { state, add } = counter()
	const order: string[] = []
	for (const n of [1, 2, 4]) {
		const c = add(n)
		h.push({ label: c.label, undo: () => (order.push(`u${n}`), c.undo()), redo: () => (order.push(`r${n}`), c.redo()) })
	}
	assert.equal(h.goTo(0), true)
	assert.equal(state.value, 0)
	assert.deepEqual(order, ['u4', 'u2', 'u1'])
	assert.equal(h.goTo(2), true)
	assert.equal(state.value, 3)
	assert.deepEqual(order.slice(3), ['r1', 'r2'])
	assert.equal(h.goTo(2), false, 'already there')
	assert.equal(h.goTo(99), true, 'clamped to the end')
	assert.equal(state.value, 7)
	assert.equal(h.position, 3)
})

test('clear empties the stack and refresh republishes it', () => {
	const { s, out } = sink()
	const h = new History(out)
	h.push(counter().add(1))
	h.clear()
	assert.deepEqual([s.canUndo, s.canRedo, h.steps().length], [false, false, 0])
	const before = s.syncs
	h.refresh()
	assert.equal(s.syncs, before + 1)
})

test('the oldest steps go once the steps hold more than the byte budget, the newest always stays', () => {
	const h = new History(sink().out)
	h.budget = 100
	const step = (label: string, bytes: number): Command => ({ label, bytes, undo() {}, redo() {} })
	h.push(step('a', 40))
	h.push(step('b', 40))
	assert.equal(h.bytes, 80)
	assert.equal(h.trimmed, false)
	h.push(step('c', 40))
	assert.deepEqual(
		h.steps().map((s) => s.label),
		['b', 'c'],
		'a went to keep under 100 bytes',
	)
	assert.equal(h.bytes, 80)
	assert.equal(h.trimmed, true)
	h.push(step('huge', 500))
	assert.deepEqual(
		h.steps().map((s) => s.label),
		['huge'],
		'a step over the budget alone still stays',
	)
	assert.equal(h.bytes, 500)
	h.push(step('d', 10))
	assert.deepEqual(
		h.steps().map((s) => s.label),
		['d'],
	)
	h.push(step('e', 10))
	h.undo()
	h.push(step('f', 30))
	assert.equal(h.bytes, 40, 'the redo side dropped by a push no longer counts')
	h.replaceTop(step('g', 5))
	assert.equal(h.bytes, 15, 'replacing the top counts the new step instead')
	h.clear()
	assert.deepEqual([h.bytes, h.trimmed], [0, false])
})
