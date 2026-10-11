import * as THREE from 'three'
import { fbm, mulberry32 } from '../engine/noise'

// Procedural, tileable, hand-painted-ish ground textures. Generated once at
// startup so the app ships no texture assets and stays tiny.

const SIZE = 256
type RGB = [number, number, number]

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Tileable Voronoi: returns [F1, F2, cellHash]. */
function voronoi(u: number, v: number, cells: number, seed: number): [number, number, number] {
  const x = u * cells
  const y = v * cells
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let f1 = 1e9, f2 = 1e9, id = 0
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox
      const cy = yi + oy
      const wx = ((cx % cells) + cells) % cells
      const wy = ((cy % cells) + cells) % cells
      const px = cx + hashf(wx, wy, seed)
      const py = cy + hashf(wy, wx, seed + 9)
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hashf(wx, wy, seed + 3)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return [f1, f2, id]
}

function hashf(x: number, y: number, seed: number) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

type Shader = (u: number, v: number, rnd: () => number) => RGB

function render(shader: Shader, seed: number): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4)
  const rnd = mulberry32(seed)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = shader(x / SIZE, y / SIZE, rnd)
      const i = (y * SIZE + x) * 4
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = 255
    }
  }
  return data
}

// Tileable fbm helper on the unit square.
const tf = (u: number, v: number, scale: number, oct: number, seed: number) =>
  fbm(u * scale, v * scale, oct, seed, scale)

const grass: Shader = (u, v, rnd) => {
  const n = tf(u, v, 6, 5, 1)
  const blades = tf(u, v, 64, 2, 2)
  let c = mix([62, 102, 32], [112, 150, 48], n)
  c = mix(c, [140, 170, 60], clamp01((blades - 0.6) * 3) * 0.6)
  const s = 0.92 + rnd() * 0.12
  return [c[0] * s, c[1] * s, c[2] * s]
}

const lush: Shader = (u, v, rnd) => {
  const n = tf(u, v, 5, 5, 11)
  let c = mix([34, 70, 24], [70, 112, 36], n)
  const f = tf(u, v, 48, 2, 12)
  if (f > 0.74) c = mix(c, [220, 200, 90], 0.7) // little flowers
  const s = 0.9 + rnd() * 0.15
  return [c[0] * s, c[1] * s, c[2] * s]
}

const dirt: Shader = (u, v, rnd) => {
  const n = tf(u, v, 8, 5, 21)
  let c = mix([92, 64, 40], [140, 104, 68], n)
  const [f1, , id] = voronoi(u, v, 14, 22)
  if (f1 < 0.18 && id > 0.6) c = mix(c, [160, 150, 135], 0.6) // pebbles
  const s = 0.9 + rnd() * 0.14
  return [c[0] * s, c[1] * s, c[2] * s]
}

const rock: Shader = (u, v, rnd) => {
  const n = tf(u, v, 4, 6, 31)
  const [f1, f2, id] = voronoi(u, v, 5, 32)
  const crack = clamp01((f2 - f1) * 6)
  let c = mix([88, 86, 84], [150, 146, 140], n * 0.7 + id * 0.3)
  c = mix([50, 48, 47], c, crack)
  const s = 0.92 + rnd() * 0.1
  return [c[0] * s, c[1] * s, c[2] * s]
}

const sand: Shader = (u, v, rnd) => {
  const n = tf(u, v, 6, 4, 41)
  const ripple = Math.sin((v + tf(u, v, 3, 3, 42) * 0.3) * Math.PI * 2 * 12) * 0.5 + 0.5
  let c = mix([196, 170, 112], [228, 208, 152], n)
  c = mix(c, [176, 150, 98], ripple * 0.25)
  const s = 0.95 + rnd() * 0.08
  return [c[0] * s, c[1] * s, c[2] * s]
}

const snow: Shader = (u, v, rnd) => {
  const n = tf(u, v, 5, 5, 51)
  const c = mix([200, 212, 228], [246, 250, 255], n)
  const s = 0.97 + rnd() * 0.05
  return [c[0] * s, c[1] * s, c[2] * s]
}

const cobble: Shader = (u, v, rnd) => {
  const [f1, f2, id] = voronoi(u, v, 8, 61)
  const edge = clamp01((f2 - f1) * 5)
  const n = tf(u, v, 16, 3, 62)
  let c = mix([110, 104, 96], [168, 160, 148], id * 0.6 + n * 0.4)
  c = mix([46, 42, 38], c, Math.pow(edge, 0.6))
  const s = 0.93 + rnd() * 0.1
  return [c[0] * s, c[1] * s, c[2] * s]
}

const path: Shader = (u, v, rnd) => {
  const n = tf(u, v, 6, 5, 71)
  let c = mix([132, 100, 66], [176, 140, 96], n)
  const ruts = tf(u, v, 24, 2, 72)
  c = mix(c, [110, 82, 54], clamp01((ruts - 0.55) * 4) * 0.5)
  const s = 0.93 + rnd() * 0.1
  return [c[0] * s, c[1] * s, c[2] * s]
}

const SHADERS: Shader[] = [grass, lush, dirt, rock, sand, snow, cobble, path]

let cache: THREE.DataTexture[] | null = null

export function getLayerTextures(maxAnisotropy: number): THREE.DataTexture[] {
  if (cache) return cache
  cache = SHADERS.map((s, i) => {
    const tex = new THREE.DataTexture(render(s, 1000 + i), SIZE, SIZE, THREE.RGBAFormat)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = Math.min(8, maxAnisotropy)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  })
  return cache
}
