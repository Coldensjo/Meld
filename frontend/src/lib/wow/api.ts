import * as THREE from 'three'
import { BrowseWowFolder, SetWowPath, WowStatus } from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { hasBackend } from '../io/mapio'
import { wow } from '../state/editor.svelte'

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
 * The server URL for a client path. A model path may carry a query after '?' (a spawn's skins, see
 * `skinnedType`), which goes to the server as it is.
 */
const url = (endpoint: string, path: string) => {
  const q = path.indexOf('?')
  if (q < 0) return `/wow/${endpoint}?path=${encodeURIComponent(path)}`
  return `/wow/${endpoint}?path=${encodeURIComponent(path.slice(0, q))}&${path.slice(q + 1)}`
}

async function fetchBinary(endpoint: string, path: string): Promise<ArrayBuffer> {
  const r = await fetch(url(endpoint, path))
  if (!r.ok) throw new Error(`${path}: ${(await r.text()).trim() || r.status}`)
  return r.arrayBuffer()
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
  const mesh: WowMesh = { positions, normals, uvs, colors, indices, groups: hdr.groups ?? [], bbox: hdr.bbox, effects: hdr.effects ?? [] }
  if (hdr.bones?.length) {
    mesh.bones = hdr.bones
    mesh.boneIdx = take(Uint8Array, hdr.verts * 4, 1)
    mesh.boneW = take(Uint8Array, hdr.verts * 4, 1)
  }
  return mesh
}
