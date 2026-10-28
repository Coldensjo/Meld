// Run with: bun test tests/dragResize.test.ts
// Panel edge drags (#592): the size follows the pointer in CSS px, kept to its range, and every way a
// drag can end (pointerup, pointercancel, lostpointercapture) drops the move listener.
import { afterEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { dragResize, resizedSize } from '../src/lib/ui/dragResize.ts'
import { applyUiScale } from '../src/lib/ui/uiScale.ts'

afterEach(() => applyUiScale(1))

/** An EventTarget standing in for the edge element, with the pointer capture the action calls. */
function edge() {
	const t = new EventTarget() as EventTarget & { captured: number[]; setPointerCapture: (id: number) => void }
	t.captured = []
	t.setPointerCapture = (id: number) => t.captured.push(id)
	return t
}
const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1 })

test('dragging the edge toward the panel’s outside grows it, kept to the range', () => {
	assert.equal(resizedSize(300, 500, 450, 240, 640), 350)
	assert.equal(resizedSize(300, 500, 600, 240, 640), 240)
	assert.equal(resizedSize(300, 500, 0, 240, 640), 640)
})

test('the distance is in CSS px under the interface size', () => {
	applyUiScale(2)
	assert.equal(resizedSize(300, 500, 400, 0, 1000), 350)
})

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
	test(`${ending} ends the drag`, () => {
		const el = edge()
		let size = 300
		const writes: number[] = []
		dragResize(el as unknown as HTMLElement, { axis: 'x', get: () => size, set: (v) => (writes.push(v), (size = v)), min: 240, max: 640 })
		el.dispatchEvent(pointer('pointerdown', 500, 0))
		assert.deepEqual(el.captured, [1])
		el.dispatchEvent(pointer('pointermove', 480, 0))
		el.dispatchEvent(pointer(ending, 480, 0))
		el.dispatchEvent(pointer('pointermove', 400, 0))
		assert.deepEqual(writes, [320])
	})
}

test('the y axis follows clientY and reads a function max on each move', () => {
	const el = edge()
	let size = 200
	let max = 1000
	dragResize(el as unknown as HTMLElement, { axis: 'y', get: () => size, set: (v) => (size = v), min: 160, max: () => max })
	el.dispatchEvent(pointer('pointerdown', 0, 600))
	el.dispatchEvent(pointer('pointermove', 900, 500))
	assert.equal(size, 300)
	max = 250
	el.dispatchEvent(pointer('pointermove', 900, 400))
	assert.equal(size, 250)
})

test('destroy ends a drag in progress and stops listening', () => {
	const el = edge()
	let size = 300
	const action = dragResize(el as unknown as HTMLElement, { axis: 'x', get: () => size, set: (v) => (size = v), min: 0, max: 1000 })
	el.dispatchEvent(pointer('pointerdown', 500, 0))
	action.destroy()
	el.dispatchEvent(pointer('pointermove', 400, 0))
	el.dispatchEvent(pointer('pointerdown', 500, 0))
	el.dispatchEvent(pointer('pointermove', 400, 0))
	assert.equal(size, 300)
})
