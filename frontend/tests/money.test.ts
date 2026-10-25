// Run with: bun test tests/money.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinMoney, shownCoins, splitMoney } from '../src/lib/wow/money.ts'

test('a copper count splits into gold, silver and copper', () => {
	assert.deepEqual(splitMoney(12345), { negative: false, gold: 1, silver: 23, copper: 45 })
	assert.deepEqual(splitMoney(0), { negative: false, gold: 0, silver: 0, copper: 0 })
	assert.deepEqual(splitMoney(-500), { negative: true, gold: 0, silver: 5, copper: 0 })
	assert.deepEqual(splitMoney(Number.NaN), { negative: false, gold: 0, silver: 0, copper: 0 })
})

test('gold is not held to 99: an unsigned 32-bit price splits and joins back', () => {
	const c = splitMoney(4294967295)
	assert.equal(c.gold, 429496)
	assert.equal(joinMoney(c), 4294967295)
})

test('joining rolls silver and copper over and keeps the sign', () => {
	assert.equal(joinMoney({ negative: false, gold: 0, silver: 0, copper: 150 }), 150)
	assert.deepEqual(splitMoney(joinMoney({ negative: false, gold: 0, silver: 0, copper: 150 })), { negative: false, gold: 0, silver: 1, copper: 50 })
	assert.equal(joinMoney({ negative: false, gold: 0, silver: 1000, copper: 0 }), 100000)
	assert.equal(joinMoney({ negative: true, gold: 1, silver: 2, copper: 3 }), -10203)
	// No negative zero, and a typed minus counts as the amount's size only.
	assert.ok(Object.is(joinMoney({ negative: true, gold: 0, silver: 0, copper: 0 }), 0))
	assert.equal(joinMoney({ negative: false, gold: 0, silver: -5, copper: 0 }), 500)
	assert.equal(joinMoney({ negative: false, gold: Number.NaN, silver: 0, copper: 7 }), 7)
	for (const n of [0, 1, 99, 100, 10203, -4321, 2147483647]) assert.equal(joinMoney(splitMoney(n)), n)
})

test('shown coins leave out the empty ones, and nothing shows 0 copper', () => {
	assert.deepEqual(shownCoins(10203), [
		['gold', 1],
		['silver', 2],
		['copper', 3],
	])
	assert.deepEqual(shownCoins(20000), [['gold', 2]])
	assert.deepEqual(shownCoins(-500), [['silver', 5]])
	assert.deepEqual(shownCoins(0), [['copper', 0]])
})
