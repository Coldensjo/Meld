// Run with: bun test tests/brushSize.test.ts
// The feel of the bands (docs/tests/tools.md, "Brush size controls") may be retuned, so the steps are
// checked as invariants; the clamp, the snap and the rounding guard stay exact.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragFalloff, dragRadius, stepFalloff, stepRadius } from '../src/lib/tools/brushSize.ts'

const MIN = 1
const MAX = 200

/** Every radius [ and ] reach from MIN, in order. */
function ladder(): number[] {
	const out = [MIN]
	for (let r = MIN; r < MAX;) {
		r = stepRadius(r, 1, MIN, MAX)
		out.push(r)
	}
	return out
}

test('] always grows the radius and [ shrinks it, within [min, max]', () => {
	for (const r of ladder()) {
		const up = stepRadius(r, 1, MIN, MAX)
		const down = stepRadius(r, -1, MIN, MAX)
		if (r < MAX) assert.ok(up > r, `] from ${r} gave ${up}`)
		if (r > MIN) assert.ok(down < r, `[ from ${r} gave ${down}`)
		for (const v of [up, down]) assert.ok(v >= MIN && v <= MAX, `${v} left [${MIN}, ${MAX}]`)
	}
})

test('the steps grow with the radius: fine when small, coarse when big', () => {
	const rungs = ladder()
	let last = 0
	for (let i = 1; i < rungs.length - 1; i++) {
		const step = rungs[i + 1] - rungs[i]
		assert.ok(step >= last - 1e-9, `the step at ${rungs[i]} (${step}) is finer than the one before (${last})`)
		last = step
	}
	assert.ok(rungs[rungs.length - 1] - rungs[rungs.length - 2] > rungs[1] - rungs[0], 'big steps are coarser than small ones')
})

test('a step then its reverse comes back', () => {
	for (const r of ladder()) {
		if (r < MAX) assert.equal(stepRadius(stepRadius(r, 1, MIN, MAX), -1, MIN, MAX), r, `] then [ from ${r}`)
		if (r > MIN) assert.equal(stepRadius(stepRadius(r, -1, MIN, MAX), 1, MIN, MAX), r, `[ then ] from ${r}`)
	}
})

test('down from the edge of a band steps by the finer band below it', () => {
	const rungs = ladder()
	for (let i = 1; i < rungs.length - 1; i++) {
		const below = rungs[i] - rungs[i - 1]
		const above = rungs[i + 1] - rungs[i]
		if (above > below + 1e-9) assert.equal(stepRadius(rungs[i], -1, MIN, MAX), rungs[i - 1], `[ from the band edge ${rungs[i]}`)
	}
})

test('a radius off the grid snaps to it first, and the ends clamp', () => {
	assert.equal(stepRadius(10.3, 1, 1, 200), 11)
	assert.equal(stepRadius(10.3, -1, 1, 200), 10)
	assert.equal(stepRadius(1, -1, 1, 200), 1, 'never under the minimum')
	assert.equal(stepRadius(200, 1, 1, 200), 200, 'never over the maximum')
})

test('Shift+[ and ] step the falloff by a tenth', () => {
	assert.equal(stepFalloff(0.6, 1), 0.7)
	assert.equal(stepFalloff(0.6, -1), 0.5)
	assert.equal(stepFalloff(0.95, 1), 1)
	assert.equal(stepFalloff(0, -1), 0)
	assert.equal(stepFalloff(0.3000001, 1), 0.4, 'a rounding remainder does not steal a notch')
})

test('a drag scales the radius by the same factor for the same distance, and back', () => {
	const right = dragRadius(10, 100, MIN, MAX) / 10
	assert.ok(right > 1, 'a drag right grows the brush')
	assert.ok(Math.abs(dragRadius(40, 100, MIN, MAX) / 40 - right) < 0.01, 'the same drag scales a bigger brush by as much')
	assert.ok(Math.abs(dragRadius(10, -100, MIN, MAX) * right - 10) < 0.1, 'a drag left undoes a drag right')
	assert.equal(dragRadius(10, 0, MIN, MAX), 10)
	assert.equal(dragRadius(150, 4000, MIN, MAX), MAX)
	assert.equal(dragRadius(10, -4000, MIN, MAX), MIN)
})

test('a drag up hardens and down softens, within 0..1', () => {
	assert.ok(dragFalloff(0.5, 40) > 0.5)
	assert.ok(dragFalloff(0.5, -40) < 0.5)
	assert.equal(dragFalloff(0.9, 1000), 1)
	assert.equal(dragFalloff(0.1, -1000), 0)
})
