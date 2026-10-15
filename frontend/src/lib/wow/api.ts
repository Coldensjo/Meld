import * as THREE from 'three'
import { BrowseWowFolder, LiquidTypes, SetWowPath, WowStatus } from '../../../wailsjs/go/main/App'
import { setLiquidTypes } from '../water/liquids'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { hasBackend } from '../io/mapio'
import { logFile, wow } from '../state/editor.svelte'

// Client for the Go side's /wow/* endpoints, which read assets live from the
// user's own WoW 1.x installation. Nothing is bundled with the app.

export interface MeshGroup {
  start: number
  count: number
  texture: string
  blend: number
  twoSided: boolean
  unlit: boolean
  /** A building's or cave's inside: lit by its baked vertex colours, not the sun and sky. */
  interior?: boolean
  /** The group's texture animation (an M2 texture transform, see world/uvAnim.ts). */
  uv?: { t?: AnimTrack; r?: AnimTrack; s?: AnimTrack }
  /** The group's colour and transparency (an M2 batch's colour and texture weight, see world/uvAnim.ts). */
  color?: { rgb?: AnimTrack; a?: AnimTrack; w?: AnimTrack }
}

export interface AnimTrack {
  t: number[]
  v: number[]
  loop: number
  step?: boolean
}

export interface AnimBone {
  parent: number
  pivot: [number, number, number]
  tr?: AnimTrack
  rot?: AnimTrack
  sc?: AnimTrack
}

/** Light source or flame in model space (editor coordinates). */
export interface MeshEffect {
  kind: 'fire' | 'light'
  pos: [number, number, number]
  color: [number, number, number]
  intensity: number
  radius: number
  size?: number
  /** Inside a WMO interior group: flames only, no dynamic light (it would shine through walls). */
  interior?: boolean
}

/**
 * An M2 particle emitter (B-182), its tracks resolved for the model's loop (Go: internal/wow/particles.go;
 * simulated by world/particles.ts).
 */
export interface MeshEmitter {
  /** Spawn space (WoW axes, before the client's 90° turn) to model space: a column-major 4x4. */
  frame: number[]
  /** The animated bone it rides, or -1. */
  bone: number
  flags: number
  /** 1 plane, 2 sphere, 3 spline. */
  shape: number
  /** The M2 blend byte: 0 opaque, 1 alpha key, 2 alpha, 3 and 4 add, 5 and 6 mod. */
  blend: number
  texture: string
  rows: number
  cols: number
  /** 0 a camera-facing quad, 1 a streak along the velocity, 2 both. */
  headTail: number
  rate: AnimTrack | null
  on?: AnimTrack
  /** Speed, speed variation, vertical range, horizontal range, gravity, lifespan, area length, area width, z source. */
  params: (AnimTrack | null)[]
  drag: number
  tailTime: number
  spin: number
  /** Speed, percent, min, max. */
  twinkle: [number, number, number, number]
  mid: number
  colors: [number, number, number, number][]
  sizes: [number, number, number]
  headCells: [number, number, number, number]
  tailCells: [number, number, number, number]
  repeat: [number, number]
  spline?: number[]
}

/** An M2 ribbon emitter (B-183): a trail laid behind a moving bone (Go: internal/wow/ribbons.go; world/ribbons.ts). */
export interface MeshRibbon {
  /** The ribbon's own space (WoW axes; an edge spans its +Y) to model space: a column-major 4x4. */
  frame: number[]
  /** The animated bone it rides, or -1. */
  bone: number
  texture: string
  /** The M2 blend of its material. */
  blend: number
  color?: AnimTrack
  alpha?: AnimTrack
  above?: AnimTrack
  below?: AnimTrack
  on?: AnimTrack
  edgesPerSecond: number
  edgeLifetime: number
  gravity: number
  rows: number
  cols: number
  slot: number
}

export interface WowMesh {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  colors: Uint8Array | null
  indices: Uint32Array
  groups: MeshGroup[]
  bbox: number[]
  /** Idle animation: bones plus 4 bone indices/weights per vertex. */
  bones?: AnimBone[]
  boneIdx?: Uint8Array
  boneW?: Uint8Array
  effects: MeshEffect[]
  emitters: MeshEmitter[]
  ribbons: MeshRibbon[]
}

type StatusLike = { path: string; loaded: boolean; error: string; files: number; archives: number }

function applyStatus(s: StatusLike) {
  wow.path = s.path
  wow.loaded = s.loaded
  wow.error = s.error
  wow.files = s.files
  wow.loading = false
  lists.clear()
  wow.revision++
  if (s.loaded) void loadLiquidTypes()
}

/** Reads the client's LiquidType.dbc into the Water tool's list of liquids. */
async function loadLiquidTypes() {
  try {
    setLiquidTypes(await LiquidTypes())
    wow.liquidsRevision++
  } catch (e) {
    console.warn('liquid types', e)
  }
}

export async function initWow() {
  if (!hasBackend()) return
  EventsOn('wow:status', (s: StatusLike) => applyStatus(s))
  const s = await WowStatus()
  applyStatus(s)
  // Startup load may still be running in Go; the event will update us.
  if (s.path && !s.loaded && !s.error) wow.loading = true
}

export async function chooseWowFolder(): Promise<void> {
  if (!hasBackend()) return
  const dir = await BrowseWowFolder()
  if (!dir) return
  wow.loading = true
  try {
    applyStatus(await SetWowPath(dir))
  } catch (e) {
    wow.loading = false
    wow.error = String(e)
  }
}

export async function clearWowFolder(): Promise<void> {
  if (!hasBackend()) return
  applyStatus(await SetWowPath(''))
}

const lists = new Map<string, Promise<string[]>>()

export function listAssets(kind: 'm2' | 'wmo' | 'tileset'): Promise<string[]> {
  let p = lists.get(kind)
  if (!p) {
    p = fetch(`/wow/list?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
    lists.set(kind, p)
  }
  return p
}

/**
 * The server URL for a client path. A model path may carry a query after '?' (a spawn's look, see
 * `spawnType`), which goes to the server as it is.
 */
const url = (endpoint: string, path: string) => {
  const q = path.indexOf('?')
  if (q < 0) return `/wow/${endpoint}?path=${encodeURIComponent(path)}`
  return `/wow/${endpoint}?path=${encodeURIComponent(path.slice(0, q))}&${path.slice(q + 1)}`
}

async function fetchBinary(endpoint: string, path: string): Promise<ArrayBuffer> {
  const t0 = performance.now()
  try {
    const r = await fetch(url(endpoint, path))
    if (!r.ok) throw new Error(`${path}: ${(await r.text()).trim() || r.status}`)
    const buf = await r.arrayBuffer()
    logFile(endpoint, path, performance.now() - t0)
    return buf
  } catch (err) {
    logFile(endpoint, path, performance.now() - t0, err)
    throw err
  }
}

export interface RawImage {
  width: number
  height: number
  pixels: Uint8Array
}

export async function fetchImage(path: string): Promise<RawImage> {
  const buf = await fetchBinary('texture', path)
  const dv = new DataView(buf)
  return { width: dv.getUint32(4, true), height: dv.getUint32(8, true), pixels: new Uint8Array(buf, 12) }
}

const textureCache = new Map<string, Promise<THREE.DataTexture>>()
let maxAnisotropy = 8

export function setMaxAnisotropy(n: number) {
  maxAnisotropy = n
}

/** Load a BLP from the client as a mipmapped, repeating texture (cached). */
export function loadTexture(path: string): Promise<THREE.DataTexture> {
  const key = path.toLowerCase()
  let p = textureCache.get(key)
  if (!p) {
    p = fetchImage(path).then((img) => {
      const t = new THREE.DataTexture(img.pixels, img.width, img.height, THREE.RGBAFormat)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.magFilter = THREE.LinearFilter
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.generateMipmaps = true
      t.anisotropy = Math.min(8, maxAnisotropy)
      t.colorSpace = THREE.SRGBColorSpace
      t.flipY = false // BLP rows are top-down, matching WoW UVs
      t.needsUpdate = true
      t.name = path
      return t
    })
    p.catch(() => textureCache.delete(key))
    textureCache.set(key, p)
  }
  return p
}

/** Small data-URL preview of a texture for UI lists. */
export async function texturePreview(path: string, size = 64): Promise<string> {
  const img = await fetchImage(path)
  const src = document.createElement('canvas')
  src.width = img.width
  src.height = img.height
  const ctx = src.getContext('2d')!
  const data = new ImageData(img.width, img.height)
  data.data.set(img.pixels)
  // Previews ignore alpha (tilesets often store specular there).
  for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255
  ctx.putImageData(data, 0, 0)
  const out = document.createElement('canvas')
  out.width = out.height = size
  out.getContext('2d')!.drawImage(src, 0, 0, size, size)
  return out.toDataURL('image/jpeg', 0.85)
}

export async function fetchMesh(path: string): Promise<WowMesh> {
  const buf = await fetchBinary('model', path)
  const dv = new DataView(buf)
  const hdrLen = dv.getUint32(0, true)
  const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hdrLen))) as {
    verts: number
    indices: number
    colors: boolean
    groups: MeshGroup[]
    bbox: number[]
    bones?: AnimBone[]
    effects?: MeshEffect[]
    emitters?: MeshEmitter[]
    ribbons?: MeshRibbon[]
  }
  let o = 4 + hdrLen
  const take = <T>(ctor: new (b: ArrayBuffer, o: number, n: number) => T, n: number, bytes: number) => {
    const v = new ctor(buf, o, n)
    o += n * bytes
    return v
  }
  const positions = take(Float32Array, hdr.verts * 3, 4)
  const normals = take(Float32Array, hdr.verts * 3, 4)
  const uvs = take(Float32Array, hdr.verts * 2, 4)
  const colors = hdr.colors ? take(Uint8Array, hdr.verts * 4, 1) : null
  const indices = take(Uint32Array, hdr.indices, 4)
  const mesh: WowMesh = { positions, normals, uvs, colors, indices, groups: hdr.groups ?? [], bbox: hdr.bbox, effects: hdr.effects ?? [], emitters: hdr.emitters ?? [], ribbons: hdr.ribbons ?? [] }
  if (hdr.bones?.length) {
    mesh.bones = hdr.bones
    mesh.boneIdx = take(Uint8Array, hdr.verts * 4, 1)
    mesh.boneW = take(Uint8Array, hdr.verts * 4, 1)
  }
  return mesh
}
