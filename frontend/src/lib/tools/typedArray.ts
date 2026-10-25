type Grown = Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array

/**
 * `arr` when it holds `needed` items already, else a copy of it twice as long (or `needed`, if more),
 * for the tools' reused point and id buffers: write `this.buf = grow(this.buf, n + 1)` before `this.buf[n]`.
 */
export function grow<T extends Grown>(arr: T, needed: number): T {
	if (needed <= arr.length) return arr
	const Ctor = arr.constructor as new (n: number) => T
	const grown = new Ctor(Math.max(needed, arr.length * 2))
	grown.set(arr)
	return grown
}
