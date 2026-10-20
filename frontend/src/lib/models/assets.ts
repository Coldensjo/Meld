import * as THREE from 'three'
import { fetchMesh, loadTexture, type MeshEffect, type MeshEmitter, type MeshGroup, type MeshRibbon, type WowLiquid, type WowMesh } from '../wow/api'
import { colorAt, colorFades, colorIsStatic, uvMatrix, type ColorAnimSpec, type UVAnimSpec } from '../world/uvAnim'
import { ModelAnimation } from '../world/Animator'
import { patchCascadeShadows } from '../engine/shadowCascades'
import { patchRoomGate, ROOM_ATTRIBUTE } from '../world/roomGate'
import { buildBoundsTree } from '../world/bvh'
import { markShadowMoving } from '../world/shadowReach'
import { buildLod } from './lod'
import { helperGeometry, helperMaterial, helperName, isHelper } from './helpers'
import type { LiquidClass } from '../water/liquids'

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
  /** Idle animation, if the model moves: poses `skeleton` each frame. */
  anim?: ModelAnimation
  /** The bones every mesh of an animated model is skinned with (see world/Animator.ts). */
  skeleton?: THREE.Skeleton
  /** Lights and flames in model space. */
  effects: MeshEffect[]
  /** Particle emitters in model space (world/particles.ts). */
  emitters: MeshEmitter[]
  /** Ribbon emitters in model space (world/ribbons.ts). */
  ribbons: MeshRibbon[]
  /** A simplified model for instances far away, sharing the geometry's vertices (see lod.ts). */
  lod?: THREE.BufferGeometry
  /**
   * A WMO's lava and water (its groups' MLIQ, #287), drawn by ObjectLayer with `wmoLiquidMaterial`
   * as a mesh of its own: never picked and casting no shadow.
   */
  liquid?: THREE.BufferGeometry
  /**
   * A model the client draws nothing of (a collision blocker, an invisible trigger; #333): drawn
   * as a see-through wireframe of its collision hull (or a small diamond without one), so it can be
   * found, picked and deleted, and casting no shadow, as in the game.
   */
  marker?: boolean
}

export type ModelKind = 'm2' | 'wmo'

export const isWowType = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')
export const wowPath = (type: string) => type.slice(type.indexOf(':') + 1)

export function displayName(type: string): string {
  if (isHelper(type)) return helperName(type)
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
function placeholderMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xcc44cc, transparent: true, opacity: 0.6 })
  patchCascadeShadows(m)
  return m
}
function getPlaceholder(): ModelAsset {
  if (!placeholder) {
    const g = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0)
    g.computeBoundingBox()
    placeholder = {
      geometry: g,
      material: placeholderMaterial(),
      bbox: g.boundingBox!.clone(),
      ready: false,
      effects: [],
      emitters: [],
      ribbons: [],
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
  if (isHelper(type)) {
    // A helper is generated at once, never loaded (models/helpers.ts).
    const g = helperGeometry(type)
    if (g) {
      g.computeBoundingBox()
      buildBoundsTree(g)
      const helper: ModelAsset = { geometry: g, material: helperMaterial(), bbox: g.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [] }
      assets.set(type, helper)
      return helper
    }
  }
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
      .then(async (m) => {
        const asset = buildWowAsset(m, type)
        buildBoundsTree(asset.geometry)
        if (asset.marker) return asset
        asset.lod = await buildLod(asset.geometry).catch((err) => {
          console.warn('model LOD failed', type, err)
          return undefined
        })
        return asset
      })
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

/** The textures that move (M2 texture transforms): each animated group's own copy of its texture, and its animation. */
const uvAnimated: Array<{ texture: THREE.Texture; spec: UVAnimSpec; cutout: boolean }> = []
/** The materials whose colour or transparency changes (M2 colours and weights), with their colour before the tint. */
const colorAnimated: Array<{ material: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial; base: THREE.Color; spec: ColorAnimSpec }> = []
const uvRows = [0, 0, 0, 0, 0, 0]
const rgba = [1, 1, 1, 1]
let animatedAt = -1
/** How many textures have been bound to model materials, so a shadow map drawn before one arrived is redrawn. */
let texturesBound = 0

/** Bumped each time a model material gets its texture (an alpha-tested one casts a different shadow with it). */
export function texturesBoundCount(): number {
	return texturesBound
}

/**
 * Tints `m` from its `base` colour and sets its opacity, as the client draws an M2 colour; at 0 or less
 * it is not drawn. Returns whether it was shown or hidden by this.
 */
function applyColor(m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, base: THREE.Color, c: number[]): boolean {
  // The client tints in its own (sRGB) colour space; a product there is the product of the linear values.
  m.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).multiply(base)
  m.opacity = Math.min(1, Math.max(0, c[3]))
  const shown = c[3] > 0
  if (m.visible === shown) return false
  m.visible = shown
  return true
}

/**
 * Moves every animated texture and colour to time `ms`, as the client does (world/uvAnim.ts). All
 * instances of a model share the material, so they move in sync, as the bones do. Returns whether a
 * shadow changed with them: a material shown or hidden, or a moving texture on an alpha-tested one
 * (whose cut-out shape the shadow maps take).
 */
export function updateMaterialAnimations(ms: number): boolean {
	const moved = ms !== animatedAt
	animatedAt = ms
	let shadows = false
  for (const a of uvAnimated) {
    const m = uvMatrix(a.spec, ms, uvRows)
    a.texture.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1)
		if (moved && a.cutout) shadows = true
  }
  for (const a of colorAnimated) if (applyColor(a.material, a.base, colorAt(a.spec, ms, rgba))) shadows = true
	return shadows
}

function wowMaterial(g: MeshGroup, vertexColors: boolean, rooms: boolean): THREE.Material {
  // A WMO's materials carry the room gate, so they are never shared with an M2's.
  const key = `${g.texture.toLowerCase()}|${g.blend}|${g.twoSided}|${g.unlit}|${!!g.interior}|${vertexColors}|${rooms}`
  // A group whose texture moves gets a material of its own, so its texture's matrix moves only it, and
  // so does one with a colour of its own.
  const moving = !!g.uv && !!g.texture
  const own = moving || !!g.color
  let m = own ? undefined : materialCache.get(key)
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
  // A colour that can fade blends, even on an opaque batch, as the client draws it.
  if (g.color && colorFades(g.color)) params.transparent = true
  // Interiors are lit by their baked colours alone, as in the game: no sun, sky or shadows reach them.
  m = g.unlit || interior ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params)
  if (g.color) {
    const tinted = m as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial
    const base = tinted.color.clone()
    applyColor(tinted, base, colorAt(g.color, 0, rgba))
    if (!colorIsStatic(g.color)) colorAnimated.push({ material: tinted, base, spec: g.color })
  }
	// A moving cut-out or a colour that can fade out changes the shadow as it animates: the near shadow
	// map draws batches with one apart from the still ones (#346).
	if ((moving && params.alphaTest) || (g.color && !colorIsStatic(g.color) && colorFades(g.color))) markShadowMoving(m)
  // Cast shadows from both faces: three's default casts from the back faces only, and a building's
  // single-sided walls then let the sun through onto the walls behind them.
  m.shadowSide = THREE.DoubleSide
  if (m instanceof THREE.MeshLambertMaterial) patchCascadeShadows(m)
  if (rooms) patchRoomGate(m)
  const mat = m as THREE.MeshLambertMaterial
  // userData.ready resolves once the texture is bound (or failed).
  mat.userData.ready = g.texture
    ? loadTexture(g.texture)
        .then((t) => {
          if (moving) {
            // A copy shares the image (three keeps one GPU texture for both) but has its own matrix.
            t = t.clone()
            t.matrixAutoUpdate = false
            uvAnimated.push({ texture: t, spec: g.uv as UVAnimSpec, cutout: mat.alphaTest > 0 })
          }
          mat.map = t
          mat.needsUpdate = true
					texturesBound++
        })
        .catch(() => mat.color.set(0x9a9a9a))
    : Promise.resolve()
  if (!own) materialCache.set(key, m)
  return m
}

const LIQUID_CLASSES: LiquidClass[] = ['river', 'ocean', 'magma', 'slime']

/**
 * A WMO's liquid surfaces as a geometry for `wmoLiquidMaterial`, the kinds it holds in
 * `userData.liquidKinds` (whose frames ObjectLayer asks for: importing the material here would loop
 * back through the terrain).
 */
function liquidGeometry(l: WowLiquid): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(l.positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(l.uvs, 2))
  g.setAttribute('liquid', new THREE.BufferAttribute(l.info, 4))
  g.setAttribute('body', new THREE.BufferAttribute(l.body, 4, true))
  g.setAttribute(ROOM_ATTRIBUTE, new THREE.BufferAttribute(l.rooms, 2))
  g.setIndex(new THREE.BufferAttribute(l.indices, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  const kinds = new Set<LiquidClass>()
  for (let i = 0; i < l.info.length; i += 4) if (LIQUID_CLASSES[l.info[i]]) kinds.add(LIQUID_CLASSES[l.info[i]])
  g.userData.liquidKinds = [...kinds]
  return g
}

/** Resolves when every texture used by the given material(s) has loaded. */
export function texturesReady(material: THREE.Material | THREE.Material[]): Promise<unknown> {
  const list = Array.isArray(material) ? material : [material]
  return Promise.allSettled(list.map((m) => m.userData.ready as Promise<void> | undefined))
}

/** Whether the client draws nothing of a model: Go then sends its collision hull and no groups (#333). */
export function nothingToDraw(m: WowMesh): boolean {
	return m.groups.length === 0 && m.effects.length === 0 && m.emitters.length === 0 && m.ribbons.length === 0 && !m.liquid
}

let markerMaterial: THREE.Material | null = null

/** A model with nothing to draw, as a marker (ModelAsset.marker): its hull's wireframe, or a diamond. */
function markerAsset(m: WowMesh): ModelAsset {
	let geo: THREE.BufferGeometry
	if (m.indices.length >= 3) {
		geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
		geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
	} else {
		geo = new THREE.OctahedronGeometry(0.8).translate(0, 1, 0)
	}
	geo.computeBoundingBox()
	geo.computeBoundingSphere()
	markerMaterial ??= new THREE.MeshBasicMaterial({ color: 0xb0b0b0, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false })
	return { geometry: geo, material: markerMaterial, bbox: geo.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [], marker: true }
}

/** Every animated model loaded so far, by type (the Engine drives the ones in view each frame). */
export const animatedAssets = new Map<string, ModelAsset>()

/**
 * Builds geometry + materials. `animateAs` is the type to register the idle animation under, for a
 * kept asset only (thumbnails and previews pass nothing and show the bind pose). Callers that don't
 * keep the asset should dispose the geometry.
 */
export function buildWowAsset(m: WowMesh, animateAs?: string): ModelAsset {
	if (nothingToDraw(m)) return markerAsset(m)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  const vc = !!m.colors
  if (m.colors) geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 4, true))
  if (m.rooms) geo.setAttribute(ROOM_ATTRIBUTE, new THREE.BufferAttribute(m.rooms, 2))
  const nVerts = m.positions.length / 3
  geo.setIndex(new THREE.BufferAttribute(nVerts < 65535 ? Uint16Array.from(m.indices) : m.indices, 1))
  const materials = m.groups.map((g, i) => {
    geo.addGroup(g.start, g.count, i)
    return wowMaterial(g, vc, !!m.rooms)
  })
  geo.computeBoundingSphere()
  const b = m.bbox
  const bbox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))
  geo.boundingBox = bbox.clone()
  const asset: ModelAsset = { geometry: geo, material: materials, bbox, ready: true, effects: m.effects, emitters: m.emitters, ribbons: m.ribbons }
  if (m.liquid && m.liquid.indices.length) asset.liquid = liquidGeometry(m.liquid)
  if (animateAs !== undefined && m.bones && m.boneIdx && m.boneW) {
    asset.anim = new ModelAnimation(geo, m.bones, m.boneIdx, m.boneW)
    asset.skeleton = asset.anim.skeleton
    animatedAssets.set(animateAs, asset)
  }
  return asset
}
