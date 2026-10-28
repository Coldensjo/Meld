// Run with: bun test tests/base64.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { base64ToBytes, bytesToBase64, bytesToBase64Sliced, fromWailsBytes, wailsBytes } from '../src/lib/io/base64.ts'

const bytes = (n: number) => {
	const b = new Uint8Array(n)
	for (let i = 0; i < n; i++) b[i] = (i * 131 + 7) & 255
	return b
}

test('the sliced encoding matches the one-go encoding, whatever the length', async () => {
	for (const n of [0, 1, 2, 3, 29, 30, 31, 32, 100]) {
		let pauses = 0
		const b = bytes(n)
		const s = await bytesToBase64Sliced(b, async () => void pauses++, 6)
		assert.equal(s, bytesToBase64(b), `length ${n}`)
		assert.deepEqual(base64ToBytes(s), b)
		assert.equal(pauses, Math.max(0, Math.ceil(n / 6) - 1), `pauses for length ${n}`)
	}
})

test('a slice that is not a multiple of 3 bytes is refused, since its padding would land mid-string', async () => {
	await assert.rejects(bytesToBase64Sliced(bytes(10), async () => {}, 4))
})

test('bytes go over the bridge as base64, across the 32 KiB chunks of the fallback', () => {
	assert.equal(bytesToBase64(Uint8Array.from([0, 1, 2, 253, 254, 255])), Buffer.from([0, 1, 2, 253, 254, 255]).toString('base64'))
	const big = Uint8Array.from({ length: 70000 }, (_, i) => i * 7)
	assert.deepEqual(Buffer.from(bytesToBase64(big), 'base64'), Buffer.from(big))
	// Again without the native encoder, where the runtime has one, so the fallback is tested too.
	const proto: { toBase64?: unknown } = Uint8Array.prototype
	const own = Object.getOwnPropertyDescriptor(proto, 'toBase64')
	if (own) {
		delete proto.toBase64
		try {
			assert.deepEqual(Buffer.from(bytesToBase64(big), 'base64'), Buffer.from(big))
		} finally {
			Object.defineProperty(proto, 'toBase64', own)
		}
	}
})

test('a Go []byte field crosses the bridge as the base64 of its bytes, typed number[] by Wails', () => {
	const b = bytes(31)
	const field = wailsBytes(b)
	assert.equal(typeof field, 'string')
	assert.equal(field as unknown as string, Buffer.from(b).toString('base64'))
	assert.deepEqual(fromWailsBytes(field), b)
})
