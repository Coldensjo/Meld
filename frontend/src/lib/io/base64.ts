// Fast-ish base64 for large typed arrays (the Wails bridge speaks JSON).

type B64Uint8 = Uint8Array & { toBase64?: () => string }
type B64Ctor = typeof Uint8Array & { fromBase64?: (s: string) => Uint8Array }

export function bytesToBase64(bytes: Uint8Array): string {
	const native = (bytes as B64Uint8).toBase64
	if (native) return native.call(bytes)
	let s = ''
	const CH = 0x8000
	for (let i = 0; i < bytes.length; i += CH) {
		s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[])
	}
	return btoa(s)
}

/** Bytes encoded per slice by `bytesToBase64Sliced`: a multiple of 3, so the slices' base64 joins with no padding between. */
export const SLICE_BYTES = 3 * (1 << 20)

/**
 * `bytesToBase64` in slices of `SLICE_BYTES`, awaiting `pause` between them, so a region's paint (16.7 MB
 * for 2x2 tiles) is encoded over several turns instead of one long one on the frame's thread.
 */
export async function bytesToBase64Sliced(bytes: Uint8Array, pause: () => Promise<void>, slice = SLICE_BYTES): Promise<string> {
	if (slice % 3 !== 0) throw new Error('slice must be a multiple of 3 bytes')
	if (bytes.length <= slice) return bytesToBase64(bytes)
	const parts: string[] = []
	for (let i = 0; i < bytes.length; i += slice) {
		if (i) await pause()
		parts.push(bytesToBase64(bytes.subarray(i, i + slice)))
	}
	return parts.join('')
}

export function base64ToBytes(b64: string): Uint8Array {
	const native = (Uint8Array as B64Ctor).fromBase64
	if (native) return native(b64)
	const s = atob(b64)
	const out = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
	return out
}

/** Base64 of float32s in the platform's (little-endian) order, as Go's vmangos.HeightGrid crosses the bridge. */
export function floatsToBase64(f: Float32Array): string {
	return bytesToBase64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength))
}

/** The float32s of a vmangos.HeightGrid from the bridge. The bytes are a fresh array, so the view starts aligned. */
export function base64ToFloats(b64: string): Float32Array {
	const bytes = base64ToBytes(b64)
	if (bytes.byteLength % 4 !== 0) throw new Error(`heights are ${bytes.byteLength} bytes, not whole float32s`)
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
