import * as THREE from 'three'
import { fetchMesh, loadTexture, type MeshEffect, type MeshGroup, type WowMesh } from '../wow/api'
import { ModelAnimation } from '../world/Animator'

/**
 * A placeable model: one geometry (with groups) and one material per group.
 * Object types are WoW client paths prefixed with "m2:" or "wmo:", loaded
 * asynchronously from the Go backend.
 */
export interface ModelAsset {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  bbox: THREE.Box3
  /** False for the placeholder shown while loading or when loading failed. */
  ready: boolean
  /** Idle animation (shared geometry is skinned in place), if the model moves. */
  anim?: ModelAnimation
  /** Lights and flames in model space. */
  effects: MeshEffect[]
}

export type ModelKind = 'm2' | 'wmo'

export const isWowType = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')
export const wowPath = (type: string) => type.slice(type.indexOf(':') + 1)

/**
 * The type of a model drawn with a creature display's skins: the plain type plus a query the model
 * endpoint reads, one `skin` per slot (an empty one leaves the slot alone). Two spawns of the same
 * model with different skins are different assets.
 */
export function skinnedType(type: string, skins: string[] | null | undefined): string {
  if (!skins || skins.every((s) => !s)) return type
  return `${type}?${skins.map((s) => `skin=${encodeURIComponent(s)}`).join('&')}`
}

export function displayName(type: string): string {
  const p = isWowType(type) ? wowPath(type) : type
  const q = p.indexOf('?')
  const path = q < 0 ? p : p.slice(0, q)
  return path.slice(path.lastIndexOf('\\') + 1).replace(/\.(m2|wmo|mdx)$/i, '')
}

const assets = new Map<string, ModelAsset>()
const pending = new Map<string, Promise<ModelAsset>>()
const listeners = new Set<(type: string) => void>()

/** Subscribe to "asset finished loading" notifications. */
export function onAssetLoaded(fn: (type: string) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let placeholder: ModelAsset | null = null
function getPlaceholder(): ModelAsset {
  if (!placeholder) {
    const g = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0)
    g.computeBoundingBox()
    placeholder = {
      geometry: g,
      material: new THREE.MeshLambertMaterial({ color: 0xcc44cc, transparent: true, opacity: 0.6 }),
      bbox: g.boundingBox!.clone(),
      ready: false,
      effects: [],
    }
  }
  return placeholder
}

/**
 * Returns the asset if loaded, otherwise a placeholder (and starts loading).
 * Listen with `onAssetLoaded` to swap the placeholder out.
 */
/** How long a model that failed to load waits before the loader tries it again. */
const RETRY_MS = 30000
const failedAt = new Map<string, number>()

export function getAsset(type: string): ModelAsset {
  const a = assets.get(type)
  if (a) return a
  if (isWowType(type) && !pending.has(type) && retryDue(type)) void loadAsset(type)
  return getPlaceholder()
}

function retryDue(type: string): boolean {
  const t = failedAt.get(type)
  return t === undefined || performance.now() - t >= RETRY_MS
}

export function loadAsset(type: string): Promise<ModelAsset> {
  const have = assets.get(type)
  if (have) return Promise.resolve(have)
  if (!isWowType(type)) return Promise.resolve(getPlaceholder())
  let p = pending.get(type)
  if (!p) {
    p = fetchMesh(wowPath(type))
      .then((m) => buildWowAsset(m, true))
      .catch((err) => {
        // Not cached: the next request after RETRY_MS tries the model again.
        console.warn('model load failed', type, err)
        failedAt.set(type, performance.now())
        return getPlaceholder()
      })
      .then((asset) => {
        if (asset.ready) assets.set(type, asset)
        pending.delete(type)
        listeners.forEach((fn) => fn(type))
        return asset
      })
    pending.set(type, p)
  }
  return p
}

const materialCache = new Map<string, THREE.Material>()

function wowMaterial(g: MeshGroup, vertexColors: boolean): THREE.Material {
  const key = `${g.texture.toLowerCase()}|${g.blend}|${g.twoSided}|${g.unlit}|${!!g.interior}|${vertexColors}`
  let m = materialCache.get(key)
  if (m) return m
  // An interior without baked colours would be full bright unlit, so it gets a dim grey instead.
  const interior = !!g.interior && !g.unlit
  const params: THREE.MeshLambertMaterialParameters = {
    vertexColors,
    side: g.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    color: !g.texture ? 0x9a9a9a : interior && !vertexColors ? 0x707070 : 0xffffff,
  }
  switch (g.blend) {
    case 0:
      break
    case 1:
      params.alphaTest = 0.5
      break
    case 2:
      params.transparent = true
      params.depthWrite = false
      break
    case 3:
    case 4:
      params.transparent = true
      params.depthWrite = false
      params.blending = THREE.AdditiveBlending
      break
    default: // 5, 6: modulate
      params.transparent = true
      params.depthWrite = false
      params.blending = THREE.MultiplyBlending
      params.premultipliedAlpha = true
  }
  // Interiors are lit by their baked colours alone, as in the game: no sun, sky or shadows reach them.
  m = g.unlit || interior ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params)
  // Cast shadows from both faces: three's default casts from the back faces only, and a building's
  // single-sided walls then let the sun through onto the walls behind them.
  m.shadowSide = THREE.DoubleSide
  const mat = m as THREE.MeshLambertMaterial
  // userData.ready resolves once the texture is bound (or failed).
  mat.userData.ready = g.texture
    ? loadTexture(g.texture)
        .then((t) => {
          mat.map = t
          mat.needsUpdate = true
        })
        .catch(() => mat.color.set(0x9a9a9a))
    : Promise.resolve()
  materialCache.set(key, m)
  return m
}

/** Resolves when every texture used by the given material(s) has loaded. */
export function texturesReady(material: THREE.Material | THREE.Material[]): Promise<unknown> {
  const list = Array.isArray(material) ? material : [material]
  return Promise.allSettled(list.map((m) => m.userData.ready as Promise<void> | undefined))
}

/** Every animated model loaded so far (driven each frame by the Engine). */
export const animatedAssets = new Set<ModelAsset>()

/**
 * Builds geometry + materials. `animate` sets up the idle animation (only for
 * kept assets — thumbnails pass false). Callers that don't keep it should
 * dispose the geometry.
 */
export function buildWowAsset(m: WowMesh, animate = false): ModelAsset {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  const vc = !!m.colors
  if (m.colors) geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 4, true))
  const nVerts = m.positions.length / 3
  geo.setIndex(new THREE.BufferAttribute(nVerts < 65535 ? Uint16Array.from(m.indices) : m.indices, 1))
  const materials = m.groups.map((g, i) => {
    geo.addGroup(g.start, g.count, i)
    return wowMaterial(g, vc)
  })
  geo.computeBoundingSphere()
  const b = m.bbox
  const bbox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))
  geo.boundingBox = bbox.clone()
  const asset: ModelAsset = { geometry: geo, material: materials, bbox, ready: true, effects: m.effects }
  if (animate && m.bones && m.boneIdx && m.boneW) {
    asset.anim = new ModelAnimation(geo, m.bones, m.boneIdx, m.boneW)
    animatedAssets.add(asset)
  }
  return asset
}
