// Run with: bun test tests/lookWarp.test.ts
// The Windows mouse look's recentring of the hidden cursor (#724): a long spin keeps turning, the warp
// jumps back to the anchor never turn the camera, and a fast move riding along with a warp is kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LookWarp, STALE_MS, WARP_AT } from '../src/lib/engine/lookWarp.ts'

const ANCHOR = 500

/**
 * A simulated spin: the user moves `step` px right each event, the cursor is put back on the anchor
 * `lag` events after a recenter is asked (the binding's round trip), and the warp's own event also
 * carries that event's movement. Returns the sum of the moves applied and the furthest the cursor got.
 */
function spin(events: number, step: number, lag: number, msPerEvent = 8) {
	const w = new LookWarp()
	w.begin(ANCHOR, ANCHOR)
	let x = ANCHOR
	let turned = 0
	let furthest = 0
	let warpIn = -1
	for (let i = 0; i < events; i++) {
		const last = x
		x += step
		if (warpIn === 0) x = ANCHOR + step
		if (warpIn >= 0) warpIn--
		if (w.move(x, ANCHOR, last, ANCHOR, i * msPerEvent)) warpIn = lag
		turned += w.dx
		assert.equal(w.dy, 0)
		furthest = Math.max(furthest, Math.abs(x - ANCHOR))
	}
	return { turned, furthest }
}

test('a slow spin turns by every pixel the user moves and stays near the anchor', () => {
	const { turned, furthest } = spin(2000, 5, 0)
	assert.equal(turned, 2000 * 5)
	assert.ok(furthest <= WARP_AT + 5)
})

test('a fast spin whose warp lands far from the anchor keeps turning (the bug: it stopped)', () => {
	for (const step of [45, 60, 90, 120]) {
		for (const lag of [0, 1, 3]) {
			const { turned, furthest } = spin(1000, step, lag)
			// Each warp loses at most the moves between the ask and the landing.
			assert.ok(turned >= 1000 * step * 0.6, `step ${step} lag ${lag}: turned ${turned}`)
			assert.ok(turned <= 1000 * step, `step ${step} lag ${lag}: turned ${turned}`)
			assert.ok(furthest < WARP_AT + step * (lag + 3), `step ${step} lag ${lag}: furthest ${furthest}`)
		}
	}
})

test('the jump back to the anchor never turns the camera the other way', () => {
	const w = new LookWarp()
	w.begin(ANCHOR, ANCHOR)
	assert.equal(w.move(ANCHOR + 160, ANCHOR, ANCHOR + 100, ANCHOR, 0), true)
	assert.equal(w.dx, 60)
	assert.equal(w.move(ANCHOR + 50, ANCHOR, ANCHOR + 160, ANCHOR, 8), false)
	assert.equal(w.dx, 50)
})

test('a recenter that never lands is given up and asked again', () => {
	const w = new LookWarp()
	w.begin(ANCHOR, ANCHOR)
	for (let x = ANCHOR + 10; x <= ANCHOR + 150; x += 10) assert.equal(w.move(x, ANCHOR, x - 10, ANCHOR, 0), false)
	assert.equal(w.move(ANCHOR + 160, ANCHOR, ANCHOR + 150, ANCHOR, 0), true)
	assert.equal(w.move(ANCHOR + 170, ANCHOR, ANCHOR + 160, ANCHOR, STALE_MS / 2), false)
	assert.equal(w.dx, 10)
	assert.equal(w.move(ANCHOR + 180, ANCHOR, ANCHOR + 170, ANCHOR, STALE_MS + 1), true)
	assert.equal(w.dx, 10)
})

test('a vertical look recentres too', () => {
	const w = new LookWarp()
	w.begin(ANCHOR, ANCHOR)
	assert.equal(w.move(ANCHOR, ANCHOR - 155, ANCHOR, ANCHOR - 140, 0), true)
	w.move(ANCHOR, ANCHOR - 10, ANCHOR, ANCHOR - 155, 8)
	assert.equal(w.dy, -10)
})
