// The noise behind the script API's `make_noise` and `sel:make_noise` (#29): a grid of values over
// whole yards, as Noggit Red fills its noisemaps with FastNoise2's GenUniformGrid2D (the value at grid
// point (i, j) is the algorithm at ((start_x + i) × frequency, (start_y + j) × frequency)). The plain
// algorithm names are Noggit Red's (its script_noise.cpp): SIMPLEX, PERLIN, VALUE, FRACTAL, CELLULAR and
// WHITE, each roughly in -1..1. FastNoise2's encoded node trees (the base64 Noggit Red's height_noise.lua
// passes) need FastNoise2 itself, which has no JavaScript port: they fall back to FRACTAL.
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'
import { mulberry32 } from '../engine/noise'

export const NOISE_NAMES = ['SIMPLEX', 'PERLIN', 'VALUE', 'FRACTAL', 'CELLULAR', 'WHITE'] as const
export type NoiseName = (typeof NOISE_NAMES)[number]

/** A seed string as the 32-bit number the generators take (FNV-1a). */
export function seedOf(seed: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
	return h >>> 0
}

/** A hash of a lattice point to 32 bits. */
function hash(seed: number, x: number, y: number): number {
	let h = Math.imul(seed ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1) ^ Math.imul(y | 0, 0x9e3779b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	return (h ^ (h >>> 16)) >>> 0
}

/** A lattice point's value in -1..1. */
const value = (seed: number, x: number, y: number) => (hash(seed, x, y) / 4294967295) * 2 - 1

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

const simplexTables = new Map<number, NoiseFunction2D>()
function simplex(seed: number): NoiseFunction2D {
	let n = simplexTables.get(seed)
	if (!n) {
		if (simplexTables.size > 64) simplexTables.clear()
		n = createNoise2D(mulberry32(seed))
		simplexTables.set(seed, n)
	}
	return n
}

/** Perlin's eight gradient directions, of unit length. */
const D = Math.SQRT1_2
const GRADS = [1, 0, -1, 0, 0, 1, 0, -1, D, D, -D, D, D, -D, -D, -D]

function perlin(seed: number, x: number, y: number): number {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const grad = (ix: number, iy: number, dx: number, dy: number) => {
		const h = (hash(seed, ix, iy) & 7) * 2
		return GRADS[h] * dx + GRADS[h + 1] * dy
	}
	const u = fade(fx)
	const v = fade(fy)
	const a = grad(x0, y0, fx, fy) + u * (grad(x0 + 1, y0, fx - 1, fy) - grad(x0, y0, fx, fy))
	const b = grad(x0, y0 + 1, fx, fy - 1) + u * (grad(x0 + 1, y0 + 1, fx - 1, fy - 1) - grad(x0, y0 + 1, fx, fy - 1))
	// Unit gradients reach about ±0.7 in 2D: scaled to about ±1, as FastNoise does.
	return Math.max(-1, Math.min(1, (a + v * (b - a)) * 1.42))
}

function valueNoise(seed: number, x: number, y: number): number {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const u = fade(x - x0)
	const v = fade(y - y0)
	const a = value(seed, x0, y0) + u * (value(seed, x0 + 1, y0) - value(seed, x0, y0))
	const b = value(seed, x0, y0 + 1) + u * (value(seed, x0 + 1, y0 + 1) - value(seed, x0, y0 + 1))
	return a + v * (b - a)
}

/** FastNoise's CellularValue: the value of the nearest of the points scattered one a cell. */
function cellular(seed: number, x: number, y: number): number {
	const cx = Math.floor(x)
	const cy = Math.floor(y)
	let best = Infinity
	let out = 0
	for (let j = -1; j <= 1; j++) {
		for (let i = -1; i <= 1; i++) {
			const h = hash(seed, cx + i, cy + j)
			const px = cx + i + (h & 0xffff) / 65535
			const py = cy + j + (h >>> 16) / 65535
			const d = (px - x) * (px - x) + (py - y) * (py - y)
			if (d < best) {
				best = d
				out = value(seed ^ 0x5bd1e995, cx + i, cy + j)
			}
		}
	}
	return out
}

/** FastNoise's FractalFBm defaults: three octaves of simplex, each twice the frequency and half the weight. */
function fractal(seed: number, x: number, y: number): number {
	let sum = 0
	let amp = 1
	let norm = 0
	let f = 1
	for (let o = 0; o < 3; o++) {
		sum += simplex((seed + o * 0x9e3779b1) >>> 0)(x * f, y * f) * amp
		norm += amp
		amp *= 0.5
		f *= 2
	}
	return sum / norm
}

/** The algorithm a name picks, or why it can't: an unknown name, or (`fallback`) an encoded node tree read as FRACTAL. */
export function noiseAlgorithm(algorithm: string): { name: NoiseName; fallback?: boolean } | string {
	const up = algorithm.trim().toUpperCase()
	if ((NOISE_NAMES as readonly string[]).includes(up)) return { name: up as NoiseName }
	// FastNoise2's encoded trees are base64; anything else is a misspelt name.
	if (/^[A-Za-z0-9+/]{8,}={0,2}$/.test(algorithm.trim())) return { name: 'FRACTAL', fallback: true }
	return `unknown noise algorithm "${algorithm}": use ${NOISE_NAMES.join(', ')}`
}

/**
 * A `width` by `height` grid of `name` noise, row by row (x across a row, then y), from grid point
 * (startX, startY), each point at its coordinates times `frequency`.
 */
export function noiseGrid(name: NoiseName, startX: number, startY: number, width: number, height: number, frequency: number, seed: number): Float32Array {
	const out = new Float32Array(width * height)
	const s = seed >>> 0
	const sx = simplex(s)
	let k = 0
	for (let j = 0; j < height; j++) {
		const y = (startY + j) * frequency
		for (let i = 0; i < width; i++) {
			const x = (startX + i) * frequency
			let v: number
			switch (name) {
				case 'SIMPLEX':
					v = sx(x, y)
					break
				case 'PERLIN':
					v = perlin(s, x, y)
					break
				case 'VALUE':
					v = valueNoise(s, x, y)
					break
				case 'FRACTAL':
					v = fractal(s, x, y)
					break
				case 'CELLULAR':
					v = cellular(s, x, y)
					break
				case 'WHITE':
					v = value(s, Math.round(x * 4096), Math.round(y * 4096))
					break
			}
			out[k++] = v
		}
	}
	return out
}
