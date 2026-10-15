import * as THREE from 'three'
import { getAsset, type ModelAsset } from '../models/assets'
import { loadTexture } from '../wow/api'
import type { ObjectLayer } from './ObjectLayer'
import type { SpawnLayer } from './SpawnLayer'
import { blendOf, fogOf, litOf, PARTICLE_FLOATS, ParticlePool, sortQuads, VERTEX_FLOATS, type GroundProbe, type ParticleBlend } from './particles'
import { RibbonTrail, ribbonBlend } from './ribbons'

/**
 * How far from the camera an emitter runs, in yards. Beyond it, or out of view, its particles freeze
 * and are not drawn, as the client ticks an emitter only while its model is in the frame's draw set.
 */
const RANGE = 300
/** The radius about an emitter's origin its cloud is taken to reach, for the view test. */
const REACH = 30

const vertex = /* glsl */ `
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

// The texture times the track colour (authored in the client's gamma space, so decoded here), alpha
// tested at 224/255 for an alpha-key blend as the client tests it, shaded by the scene light with
// the normal straight up when lit (Benilla's wow_effect.wgsl), then fogged: to black when additive.
const fragment = /* glsl */ `
uniform sampler2D map;
uniform vec3 light;
varying vec2 vUv;
varying vec4 vTint;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(map, vUv);
  vec4 c = vec4(tex.rgb * pow(vTint.rgb, vec3(2.2)), tex.a * vTint.a);
  #ifdef ALPHA_KEY
    if (c.a < 224.0 / 255.0) discard;
    c.a = 1.0;
  #endif
  #ifdef OPAQUE
    c.a = 1.0;
  #endif
  #ifdef LIT
    c.rgb *= light;
  #endif
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef FOG_BLACK
      gl_FragColor.rgb *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  #endif
}
`

/** How a draw looks: its texture, blend, lighting and fog. Emitters and ribbons sharing one share a draw. */
interface Look {
  texture: string
  blend: ParticleBlend
  lit: boolean
  fog: 'off' | 'black' | 'scene'
}

const lookKey = (l: Look) => `${l.texture.toLowerCase()}|${l.blend}|${l.lit}|${l.fog}`

/** One draw: the quads of every emitter with the same material, rewritten each frame. */
class Batch {
  readonly mesh: THREE.Mesh
  private material: THREE.ShaderMaterial
  private geometry = new THREE.BufferGeometry()
  private buffer = new THREE.InterleavedBuffer(new Float32Array(0), VERTEX_FLOATS)
  /** The quad stream; `floats` of it are this frame's. */
  data = new Float32Array(0)
  floats = 0
  private ready = false
  /** An alpha-blended draw sorts its quads back to front each frame; `spare` is the sort's scratch. */
  private readonly sorted: boolean
  private spare = new Float32Array(0)

  constructor(look: Look, light: THREE.Color) {
    const { blend, fog } = look
    const defines: Record<string, string> = {}
    if (blend === 'alphaKey') defines.ALPHA_KEY = ''
    if (blend === 'opaque') defines.OPAQUE = ''
    if (look.lit) defines.LIT = ''
    if (fog === 'black') defines.FOG_BLACK = ''
    const blended = blend === 'add' || blend === 'alpha'
    this.sorted = blend === 'alpha'
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: null }, light: { value: light } },
      vertexShader: vertex,
      fragmentShader: fragment,
      defines,
      fog: fog !== 'off',
      transparent: blended,
      depthWrite: !blended,
      blending: blend === 'add' ? THREE.AdditiveBlending : blended ? THREE.NormalBlending : THREE.NoBlending,
      side: THREE.DoubleSide,
    })
    // The light is shared by every batch, so it is set once a frame, not cloned per material.
    this.material.uniforms.light.value = light
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    // After the props' own transparent parts, as the client draws effects after models.
    this.mesh.renderOrder = 6
    loadTexture(look.texture)
      .then((t) => {
        this.material.uniforms.map.value = t
        this.ready = true
      })
      .catch(() => {})
  }

  /** Makes room for `more` floats past this frame's. */
  reserve(more: number) {
    const need = this.floats + more
    if (need <= this.data.length) return
    const quads = Math.ceil(Math.max(need, this.data.length * 2, 64 * 4 * VERTEX_FLOATS) / (4 * VERTEX_FLOATS))
    const data = new Float32Array(quads * 4 * VERTEX_FLOATS)
    data.set(this.data.subarray(0, this.floats))
    this.data = data
    this.buffer = new THREE.InterleavedBuffer(data, VERTEX_FLOATS)
    this.buffer.setUsage(THREE.DynamicDrawUsage)
    const index = new Uint32Array(quads * 6)
    for (let q = 0; q < quads; q++) {
      const v = q * 4
      const o = q * 6
      index[o] = index[o + 3] = v
      index[o + 1] = v + 1
      index[o + 2] = index[o + 4] = v + 2
      index[o + 5] = v + 3
    }
    this.geometry.dispose()
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0))
    this.geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(this.buffer, 2, 3))
    this.geometry.setAttribute('tint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 5))
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.mesh.geometry = this.geometry
  }

  /**
   * Uploads this frame's quads. An alpha-blended draw first orders them back to front from `eye`,
   * as the client sorts a cloud (0x7b3a10), across every emitter in the draw, so one cloud seen
   * through another blends in the right order. Additive and opaque draws need no order.
   */
  finish(eye: THREE.Vector3) {
    const quads = this.floats / (4 * VERTEX_FLOATS)
    this.mesh.visible = this.ready && quads > 0
    if (!quads) return
    if (this.sorted && quads > 1) {
      if (this.spare.length < this.floats) this.spare = new Float32Array(this.data.length)
      const out = sortQuads(this.data, this.floats, eye.x, eye.y, eye.z, this.spare)
      if (out !== this.data) this.data.set(out.subarray(0, this.floats))
    }
    this.geometry.setDrawRange(0, quads * 6)
    this.buffer.clearUpdateRanges()
    this.buffer.addUpdateRange(0, this.floats)
    this.buffer.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * The tools' previews of models not yet placed (the Place tool's ghost, a paste's, the doodad brush's
 * plan), by mesh: their particles run too, following the mesh while it is shown in the scene.
 */
const previews = new Map<THREE.Object3D, ModelAsset>()
let previewsVersion = 0

/** Runs the particles of `asset` on the preview `mesh`; null stops them. */
export function previewParticles(mesh: THREE.Object3D, asset: ModelAsset | null) {
  if (asset && (asset.emitters.length || asset.ribbons.length)) previews.set(mesh, asset)
  else if (!previews.delete(mesh)) return
  previewsVersion++
}

/** Whether `o` and its parents are visible and in a scene. */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false
    if ((p as THREE.Scene).isScene) return true
  }
  return false
}

/** One emitter or ribbon of one placed model, spawn or preview. */
interface Live {
  pool: ParticlePool | null
  trail: RibbonTrail | null
  /** The bone it rides, or -1. */
  bone: number
  batch: Batch
  asset: ModelAsset
  /** The object's matrix. */
  inst: THREE.Matrix4
  /** A preview's mesh, whose world matrix it follows each frame; null for a placed model or spawn. */
  follow: THREE.Object3D | null
  frame: THREE.Matrix4
  /** The rebuild that last saw it. */
  seen: number
}

const m = new THREE.Matrix4()
const origin = new THREE.Vector3()
const eye = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const sphere = new THREE.Sphere()

/** Whether `s` meets one of `frustums`. */
function meetsAny(frustums: THREE.Frustum[], s: THREE.Sphere): boolean {
  for (let k = 0; k < frustums.length; k++) if (frustums[k].intersectsSphere(s)) return true
  return false
}

/** A seed for an emitter's randomizer from its owner's key, so each owner sprays its own pattern. */
function seedOf(key: string, i: number): number {
  let h = 0x811c9dc5
  for (let k = 0; k < key.length; k++) h = Math.imul(h ^ key.charCodeAt(k), 0x01000193)
  return h ^ Math.imul(i + 1, 0x85ebca6b)
}

/**
 * The particles and ribbons of the placed models and the spawns (B-182, B-183, #110): one pool per
 * emitter and one trail per ribbon of each, simulated each frame while near and in view
 * (world/particles.ts, world/ribbons.ts), and drawn as one dynamic mesh per material.
 */
export class ParticleLayer {
  readonly group = new THREE.Group()
  enabled = true
  /** The ground under a point, for the emitters that stand their particles on it; set by the Engine. */
  ground: GroundProbe | undefined = undefined
  /** The scene light lit particles take, set by the Engine each frame. */
  readonly light = new THREE.Color(1, 1, 1)
  private live = new Map<string, Live>()
  private batches = new Map<string, Batch>()
  private layer: ObjectLayer | null = null
  private version = -1
  private spawns: SpawnLayer | null = null
  private spawnsVersion = -1
  private previewsVersion = -1
  private generation = 0

  constructor() {
    this.group.name = 'particles'
  }

  /** The draw for a look, made on first use. */
  private batchFor(look: Look): Batch {
    const key = lookKey(look)
    let b = this.batches.get(key)
    if (!b) {
      b = new Batch(look, this.light)
      this.batches.set(key, b)
      this.group.add(b.mesh)
    }
    return b
  }

  /** Marks entry `key` seen in this rebuild at the object's matrix; false when it must be made anew for `def`. */
  private keep(key: string, def: object, asset: ModelAsset, gen: number): boolean {
    const l = this.live.get(key)
    if (!l || (l.pool ?? l.trail)!.def !== def) return false
    l.asset = asset
    l.inst.copy(m)
    l.seen = gen
    return true
  }

  private add(key: string, l: Omit<Live, 'inst' | 'seen' | 'follow'>, gen: number) {
    this.live.set(key, { ...l, inst: m.clone(), seen: gen, follow: this.following })
  }

  /** The preview mesh the pools being made follow, while `rebuild` walks the previews. */
  private following: THREE.Object3D | null = null

  /**
   * Every pool and trail and its key, after the objects or the spawns changed. One whose emitter
   * stays keeps its particles.
   */
  private rebuild(layer: ObjectLayer, spawns: SpawnLayer | null) {
    if (layer !== this.layer || spawns !== this.spawns) {
      this.live.clear()
      this.layer = layer
      this.spawns = spawns
    }
    const gen = ++this.generation
    for (const o of layer.objects.values()) {
      if (layer.isHidden(o.id)) continue
      const asset = getAsset(o.type)
      if (!asset.emitters.length && !asset.ribbons.length) continue
      layer.matrixOf(o, m)
      this.addModel(String(o.id), asset, gen)
    }
    spawns?.forEachModel((key, type, at) => {
      const asset = getAsset(type)
      if (!asset.emitters.length && !asset.ribbons.length) return
      m.copy(at)
      this.addModel(`s:${key}`, asset, gen)
    })
    for (const [mesh, asset] of previews) {
      this.following = mesh
      m.copy(mesh.matrixWorld)
      this.addModel(`p:${mesh.id}`, asset, gen)
    }
    this.following = null
    for (const [key, l] of this.live) if (l.seen !== gen) this.live.delete(key)
  }

  /** The pools and trails of one model drawn at `m`, its owner named by `owner`. */
  private addModel(owner: string, asset: ModelAsset, gen: number) {
    for (let i = 0; i < asset.emitters.length; i++) {
      const def = asset.emitters[i]
      const key = `${owner}:${i}`
      if (this.keep(key, def, asset, gen)) continue
      const batch = this.batchFor({ texture: def.texture, blend: blendOf(def), lit: litOf(def), fog: fogOf(def) })
      const pool = new ParticlePool(def, seedOf(owner, i))
      this.add(key, { pool, trail: null, bone: def.bone, batch, asset, frame: new THREE.Matrix4().fromArray(def.frame) }, gen)
    }
    for (let i = 0; i < asset.ribbons.length; i++) {
      const def = asset.ribbons[i]
      const key = `${owner}:r${i}`
      if (this.keep(key, def, asset, gen)) continue
      // Ribbons are never lit, and fog as particles of their blend do.
      const blend = ribbonBlend(def.blend)
      const batch = this.batchFor({ texture: def.texture, blend, lit: false, fog: blend === 'add' ? 'black' : 'scene' })
      this.add(key, { pool: null, trail: new RibbonTrail(def), bone: def.bone, batch, asset, frame: new THREE.Matrix4().fromArray(def.frame) }, gen)
    }
  }

  /** Advances and draws the particles: dt seconds have passed and the models' clock reads `ms`. */
  /**
   * `gate`, with the camera in a WMO room, are its doorways' frustums: an emitter outside them all is
   * frozen and hidden, except those of the building itself, the object `gateExempt`.
   */
  update(
    layer: ObjectLayer,
    spawns: SpawnLayer | null,
    dt: number,
    ms: number,
    camera: THREE.Camera,
    frustum: THREE.Frustum,
    gate: THREE.Frustum[] | null = null,
    gateExempt = -1,
  ) {
    const exempt = `${gateExempt}:`
    this.group.visible = this.enabled
    if (!this.enabled) return
    const spawnsVersion = spawns?.version ?? -1
    if (
      layer !== this.layer ||
      layer.version !== this.version ||
      spawns !== this.spawns ||
      spawnsVersion !== this.spawnsVersion ||
      previewsVersion !== this.previewsVersion
    ) {
      this.rebuild(layer, spawns)
      this.version = layer.version
      this.spawnsVersion = spawnsVersion
      this.previewsVersion = previewsVersion
    }
    camera.getWorldPosition(eye)
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    for (const b of this.batches.values()) b.floats = 0
    for (const [key, l] of this.live) {
      if (l.follow) {
        if (!shown(l.follow)) continue
        l.follow.updateWorldMatrix(true, false)
        l.inst.copy(l.follow.matrixWorld)
      }
      const bone = l.bone >= 0 ? l.asset.anim?.boneMatrix(l.bone) : null
      m.multiplyMatrices(l.inst, bone ?? l.frame)
      if (bone) m.multiply(l.frame)
      origin.setFromMatrixPosition(m)
      const d = origin.distanceTo(eye)
      if (d > RANGE || !frustum.intersectsSphere(sphere.set(origin, REACH))) continue
      if (gate && !key.startsWith(exempt) && !meetsAny(gate, sphere)) continue
      const b = l.batch
      const pool = l.pool
      if (pool) {
        // The client's emission LOD: full rate to 50 yd, down to a quarter by 87.5 yd (0x7b5550).
        pool.step(dt, ms, m, Math.min(1, Math.max(0.25, 1 - (d - 50) * 0.02)), this.ground)
        if (!pool.count) continue
        b.reserve(pool.count * PARTICLE_FLOATS)
        b.floats += pool.expand(m, right, up, b.data, b.floats)
      } else if (l.trail) {
        l.trail.step(dt, ms, m)
        b.reserve(l.trail.floats)
        b.floats += l.trail.expand(b.data, b.floats)
      }
    }
    for (const b of this.batches.values()) b.finish(eye)
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose()
    this.batches.clear()
    this.live.clear()
  }
}
