// Small, allocation-free noise helpers (simplex noise + fBm), seeded.

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const tables = new Map<number, NoiseFunction2D>()

/**
 * Simplex noise in [0,1] (simplex-noise, MIT). Unlike value noise it has no grid-aligned blobs or
 * creases. Each seed gets its own permutation table, built once.
 */
export function noise(x: number, y: number, seed = 0): number {
	let n = tables.get(seed)
	if (!n) {
		n = createNoise2D(mulberry32(seed))
		tables.set(seed, n)
	}
	// Halved, so features are as big as the value noise the presets and brushes were tuned with.
	return n(x * 0.5, y * 0.5) * 0.5 + 0.5
}

/** Fractal noise in roughly [0,1]. */
export function fbm(x: number, y: number, octaves = 5, seed = 0): number {
	let sum = 0,
		amp = 0.5,
		freq = 1,
		norm = 0
	for (let i = 0; i < octaves; i++) {
		sum += noise(x * freq, y * freq, seed + i * 31) * amp
		norm += amp
		amp *= 0.5
		freq *= 2
	}
	return sum / norm
}

/** Ridged multifractal in [0,1]; good for mountain ridges. */
export function ridged(x: number, y: number, octaves = 5, seed = 0): number {
	let sum = 0,
		amp = 0.5,
		freq = 1,
		norm = 0
	for (let i = 0; i < octaves; i++) {
		const n = 1 - Math.abs(noise(x * freq, y * freq, seed + i * 17) * 2 - 1)
		sum += n * n * amp
		norm += amp
		amp *= 0.5
		freq *= 2
	}
	return sum / norm
}
