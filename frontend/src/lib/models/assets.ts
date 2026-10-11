import * as THREE from 'three'
import { PREFAB_BY_ID } from './prefabs'
import { fetchMesh, loadTexture, type MeshGroup, type WowMesh } from '../wow/api'

/**
 * A placeable model: one geometry (with groups) and one material per group.
 * Object types are prefab ids ("oak"), or WoW client paths prefixed with
 * "m2:" / "wmo:" which are loaded asynchronously from the Go backend.
 */
export interface ModelAsset {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  bbox: THREE.Box3
  /** False for the placeholder shown while loading or when loading failed. */
  ready: boolean
}

export const prefabMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })

export const isWowType = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')
export const wowPath = (type: string) => type.slice(type.indexOf(':') + 1)

export function displayName(type: string): string {
  if (isWowType(type)) {
    const p = wowPath(type)
    return p.slice(p.lastIndexOf('\\') + 1).replace(/\.(m2|wmo)$/i, '')
  }
  return PREFAB_BY_ID.get(type)?.name ?? type
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
    }
  }
  return placeholder
}

/**
 * Returns the asset if available, otherwise a placeholder (and starts loading).
 * Listen with `onAssetLoaded` to swap the placeholder out.
 */
export function getAsset(type: string): ModelAsset {
  const a = assets.get(type)
  if (a) return a
  if (!isWowType(type)) {
    const p = PREFAB_BY_ID.get(type)
    if (!p) return getPlaceholder()
    const geometry = p.build()
    const asset = { geometry, material: prefabMaterial, bbox: geometry.boundingBox!.clone(), ready: true }
    assets.set(type, asset)
    return asset
  }
  void loadAsset(type)
  return getPlaceholder()
}

export function loadAsset(type: string): Promise<ModelAsset> {
  const have = assets.get(type)
  if (have) return Promise.resolve(have)
  if (!isWowType(type)) return Promise.resolve(getAsset(type))
  let p = pending.get(type)
  if (!p) {
    p = fetchMesh(wowPath(type))
      .then((m) => buildWowAsset(m))
      .catch((err) => {
        console.warn('model load failed', type, err)
        return getPlaceholder()
      })
      .then((asset) => {
        assets.set(type, asset)
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
  const key = `${g.texture.toLowerCase()}|${g.blend}|${g.twoSided}|${g.unlit}|${vertexColors}`
  let m = materialCache.get(key)
  if (m) return m
  const params: THREE.MeshLambertMaterialParameters = {
    vertexColors,
    side: g.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    color: g.texture ? 0xffffff : 0x9a9a9a,
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
  m = g.unlit ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params)
  const mat = m as THREE.MeshLambertMaterial
  if (g.texture) {
    loadTexture(g.texture)
      .then((t) => {
        mat.map = t
        mat.needsUpdate = true
      })
      .catch(() => mat.color.set(0x9a9a9a))
  }
  materialCache.set(key, m)
  return m
}

function buildWowAsset(m: WowMesh): ModelAsset {
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
  return { geometry: geo, material: materials, bbox, ready: true }
}
