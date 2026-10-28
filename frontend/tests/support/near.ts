// Shared float comparisons for the Bun tests (#612). Not a test file: `bun test` runs only `*.test.ts`.
import assert from 'node:assert/strict'

/** Whether `a` is within `eps` of `b`, for a check that combines several (`assert.ok(isNear(..) && ..)`). */
export const isNear = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

/** Asserts that `a` is within `eps` of `b`. */
export function nearNum(a: number, b: number, eps = 1e-6, what?: string): void {
	assert.ok(isNear(a, b, eps), `${what ? `${what}: ` : ''}${a} is not ${b} (within ${eps})`)
}

/** Asserts that `a` and `b` have the same length and each element of `a` is within `eps` of `b`'s. */
export function nearVec(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-6, what?: string): void {
	assert.equal(a.length, b.length, `${what ? `${what}: ` : ''}length`)
	for (let i = 0; i < a.length; i++) assert.ok(isNear(a[i], b[i], eps), `${what ? `${what} ` : ''}[${i}] ${a[i]} is not ${b[i]} (within ${eps})`)
}
