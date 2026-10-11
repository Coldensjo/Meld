// Small, allocation-free noise helpers (value noise + fBm), seeded.

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

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Value noise in [0,1]. If `period` > 0 the noise tiles every `period` units. */
export function valueNoise(x: number, y: number, seed = 0, period = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1
  if (period > 0) {
    x0 = ((x0 % period) + period) % period
    x1 = ((x1 % period) + period) % period
    y0 = ((y0 % period) + period) % period
    y1 = ((y1 % period) + period) % period
  }
  const a = hash2(x0, y0, seed)
  const b = hash2(x1, y0, seed)
  const c = hash2(x0, y1, seed)
  const d = hash2(x1, y1, seed)
  const u = smooth(xf)
  const v = smooth(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal noise in roughly [0,1]. */
export function fbm(x: number, y: number, octaves = 5, seed = 0, period = 0): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 31, period > 0 ? period * freq : 0) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/** Ridged multifractal in [0,1]; good for mountain ridges. */
export function ridged(x: number, y: number, octaves = 5, seed = 0): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + i * 17) * 2 - 1)
    sum += n * n * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}
