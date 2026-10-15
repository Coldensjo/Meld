import * as THREE from 'three'
import { isHelper } from '../models/helpers'
import { engineRef } from '../state/engineRef'
import { buildWowAsset, getAsset, texturesReady, wowPath } from '../models/assets'
import { fetchMesh, texturePreview } from './api'
import { SaveThumbnail } from '../../../wailsjs/go/main/App'
import { bytesToBase64 } from '../io/base64'
import { ThumbQueue } from './thumbQueue'

// Palette thumbnails. Models render into an offscreen target on the main
// WebGL context (sharing GPU textures with the scene), then get cached as PNG
// in the user's cache dir by the Go side, so later sessions load instantly.

const VERSION = 'v2'
const SIZE = 176
const SUPERSAMPLE = 2

// Only tiles on screen ask for thumbnails, nearest the grid's centre first, and the grids prefetch
// the rows just outside the view (ThumbQueue). Three run at once: each needs the main renderer.
const queue = new ThumbQueue<string>(produce, 3)

// --- disk cache via Go ------------------------------------------------------

const cacheUrl = (key: string) => `/wow/thumb?key=${encodeURIComponent(VERSION + '|' + key)}`

async function fromCache(key: string): Promise<string | null> {
  try {
    const r = await fetch(cacheUrl(key))
    if (!r.ok) return null
    return URL.createObjectURL(await r.blob())
  } catch {
    return null
  }
}

// Stored through a Go binding: request bodies on the custom scheme crash WebKitGTK.
function toCache(key: string, blob: Blob) {
  blob
    .arrayBuffer()
    .then((b) => SaveThumbnail(VERSION + '|' + key, bytesToBase64(new Uint8Array(b))))
    .catch(() => {})
}

// --- model rendering --------------------------------------------------------

let rig: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget } | null = null

function getRig() {
  if (!rig) {
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.6, 0.7), new THREE.Color(0.25, 0.22, 0.18), Math.PI))
    const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.95, 0.85), Math.PI)
    sun.position.set(4, 6, 3)
    scene.add(sun)
    const target = new THREE.WebGLRenderTarget(SIZE * SUPERSAMPLE, SIZE * SUPERSAMPLE)
    target.texture.colorSpace = THREE.SRGBColorSpace
    rig = { scene, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 10000), target }
  }
  return rig
}

async function renderModel(type: string): Promise<Blob> {
  const engine = engineRef.current
  if (!engine) throw new Error('renderer not ready')
  const asset = isHelper(type) ? getAsset(type) : buildWowAsset(await fetchMesh(wowPath(type)))
  await texturesReady(asset.material)

  const { scene, camera, target } = getRig()
  const mesh = new THREE.Mesh(asset.geometry, asset.material)
  scene.add(mesh)
  const s = asset.bbox.getBoundingSphere(new THREE.Sphere())
  const r = Math.max(s.radius, 0.3)
  const d = (r / Math.sin(THREE.MathUtils.degToRad(15))) * 0.96
  // Tall things (trees, towers) are seen from lower down, flat things (rugs, platforms) from above.
  const size = asset.bbox.getSize(new THREE.Vector3())
  const flat = Math.max(size.x, size.z)
  const dir = size.y > flat * 1.5 ? new THREE.Vector3(0.8, 0.3, 0.6) : size.y < flat * 0.3 ? new THREE.Vector3(0.5, 0.95, 0.4) : new THREE.Vector3(0.75, 0.5, 0.65)
  dir.normalize()
  camera.position.copy(s.center).addScaledVector(dir, d)
  camera.near = d / 50
  camera.far = d * 3
  camera.updateProjectionMatrix()
  camera.lookAt(s.center)

  const renderer = engine.renderer
  const px = SIZE * SUPERSAMPLE
  const buf = new Uint8Array(px * px * 4)
  const prevTarget = renderer.getRenderTarget()
  const prevAlpha = renderer.getClearAlpha()
  renderer.setRenderTarget(target)
  renderer.setClearAlpha(0)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.readRenderTargetPixels(target, 0, 0, px, px, buf)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearAlpha(prevAlpha)
  scene.remove(mesh)
  asset.geometry.dispose()

  // Flip (GL rows are bottom-up) and downsample for smooth edges.
  const big = document.createElement('canvas')
  big.width = big.height = px
  const img = new ImageData(px, px)
  for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4)
  big.getContext('2d')!.putImageData(img, 0, 0)
  const small = document.createElement('canvas')
  small.width = small.height = SIZE
  const ctx = small.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(big, 0, 0, SIZE, SIZE)
  return new Promise((res, rej) => small.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

async function produce(key: string): Promise<string> {
  if (key.startsWith('tex:')) return texturePreview(key.slice(4), SIZE)
  const cached = await fromCache(key)
  if (cached) return cached
  const blob = await renderModel(key)
  toCache(key, blob)
  return URL.createObjectURL(blob)
}

/**
 * Request a thumbnail for a model type ("m2:..."/"wmo:...") or texture ("tex:<path>"). `onReady`
 * gets an image URL. Lower `priority` values are made first (a tile's distance from its grid's
 * centre). Returns a cancel function (cancels only if the work hasn't started yet).
 */
export function requestThumb(key: string, onReady: (url: string) => void, onError?: () => void, priority = 0): () => void {
  return queue.request(key, priority, onReady, () => onError?.())
}

/**
 * The thumbnails to make once the ones on screen are done: the rows just outside the view, so
 * scrolling finds them ready. Replaces the previous set; `priority` orders them (nearest first).
 */
export function prefetchThumbs(wanted: { key: string; priority: number }[]) {
  queue.prefetch(wanted)
}

/** How many rows beyond each edge of the view a grid prepares. */
export const PREFETCH_ROWS = 3

/**
 * Prefetches the rows just outside a virtualised grid's rendered rows `first..last` (exclusive),
 * the nearest first and those below before those above; `key(i)` names item i's thumbnail. Rows
 * beyond the view count less than every tile on screen (priorities from 1e4 up).
 */
export function prefetchAround(count: number, cols: number, first: number, last: number, key: (i: number) => string) {
  const wanted: { key: string; priority: number }[] = []
  const rows = Math.ceil(count / cols)
  for (let d = 0; d < PREFETCH_ROWS; d++) {
    for (const row of [last + d, first - 1 - d]) {
      if (row < 0 || row >= rows) continue
      for (let i = row * cols; i < Math.min(count, (row + 1) * cols); i++) {
        const k = key(i)
        if (k) wanted.push({ key: k, priority: 1e4 + wanted.length })
      }
    }
  }
  prefetchThumbs(wanted)
}
