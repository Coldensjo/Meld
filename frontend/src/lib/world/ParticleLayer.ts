import * as THREE from 'three'
import { getAsset, type ModelAsset } from '../models/assets'
import { loadTexture, type MeshEmitter } from '../wow/api'
import type { ObjectLayer } from './ObjectLayer'
import { blendOf, fogOf, litOf, PARTICLE_FLOATS, ParticlePool, VERTEX_FLOATS } from './particles'

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

/** The material key of an emitter: its texture, blend, lighting and fog. Emitters sharing one share a draw. */
function batchKey(e: MeshEmitter): string {
  return `${e.texture.toLowerCase()}|${blendOf(e)}|${litOf(e)}|${fogOf(e)}`
}

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

  constructor(e: MeshEmitter, light: THREE.Color) {
    const blend = blendOf(e)
    const fog = fogOf(e)
    const defines: Record<string, string> = {}
    if (blend === 'alphaKey') defines.ALPHA_KEY = ''
    if (blend === 'opaque') defines.OPAQUE = ''
    if (litOf(e)) defines.LIT = ''
    if (fog === 'black') defines.FOG_BLACK = ''
    const blended = blend === 'add' || blend === 'alpha'
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
    loadTexture(e.texture)
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

  /** Uploads this frame's quads. */
  finish() {
    const quads = this.floats / (4 * VERTEX_FLOATS)
    this.mesh.visible = this.ready && quads > 0
    if (!quads) return
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

/** One emitter of one placed model. */
interface Live {
  pool: ParticlePool
  batch: Batch
  asset: ModelAsset
  /** The object's matrix. */
  inst: THREE.Matrix4
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

/**
 * The particles of the placed models (B-182): one pool per emitter of each object, simulated each
 * frame while near and in view (world/particles.ts), and drawn as one dynamic mesh per material.
 */
export class ParticleLayer {
  readonly group = new THREE.Group()
  enabled = true
  /** The scene light lit particles take, set by the Engine each frame. */
  readonly light = new THREE.Color(1, 1, 1)
  private live = new Map<string, Live>()
  private batches = new Map<string, Batch>()
  private layer: ObjectLayer | null = null
  private version = -1
  private generation = 0

  constructor() {
    this.group.name = 'particles'
  }

  /** Every pool and its key, after the objects changed. A pool whose emitter stays keeps its particles. */
  private rebuild(layer: ObjectLayer) {
    if (layer !== this.layer) {
      this.live.clear()
      this.layer = layer
    }
    const gen = ++this.generation
    for (const o of layer.objects.values()) {
      if (layer.isHidden(o.id)) continue
      const asset = getAsset(o.type)
      if (!asset.emitters.length) continue
      layer.matrixOf(o, m)
      for (let i = 0; i < asset.emitters.length; i++) {
        const def = asset.emitters[i]
        const key = `${o.id}:${i}`
        let l = this.live.get(key)
        if (!l || l.pool.def !== def) {
          let b = this.batches.get(batchKey(def))
          if (!b) {
            b = new Batch(def, this.light)
            this.batches.set(batchKey(def), b)
            this.group.add(b.mesh)
          }
          l = { pool: new ParticlePool(def, Math.imul(o.id, 0x9e3779b9) ^ (i * 0x85ebca6b)), batch: b, asset, inst: new THREE.Matrix4(), frame: new THREE.Matrix4().fromArray(def.frame), seen: gen }
          this.live.set(key, l)
        }
        l.asset = asset
        l.inst.copy(m)
        l.seen = gen
      }
    }
    for (const [key, l] of this.live) if (l.seen !== gen) this.live.delete(key)
  }

  /** Advances and draws the particles: dt seconds have passed and the models' clock reads `ms`. */
  update(layer: ObjectLayer, dt: number, ms: number, camera: THREE.Camera, frustum: THREE.Frustum) {
    this.group.visible = this.enabled
    if (!this.enabled) return
    if (layer !== this.layer || layer.version !== this.version) {
      this.rebuild(layer)
      this.version = layer.version
    }
    camera.getWorldPosition(eye)
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    for (const b of this.batches.values()) b.floats = 0
    for (const l of this.live.values()) {
      const bone = l.pool.def.bone >= 0 ? l.asset.anim?.boneMatrix(l.pool.def.bone) : null
      m.multiplyMatrices(l.inst, bone ?? l.frame)
      if (bone) m.multiply(l.frame)
      origin.setFromMatrixPosition(m)
      const d = origin.distanceTo(eye)
      if (d > RANGE || !frustum.intersectsSphere(sphere.set(origin, REACH))) continue
      // The client's emission LOD: full rate to 50 yd, down to a quarter by 87.5 yd (0x7b5550).
      l.pool.step(dt, ms, m, Math.min(1, Math.max(0.25, 1 - (d - 50) * 0.02)))
      if (!l.pool.count) continue
      const b = l.batch
      b.reserve(l.pool.count * PARTICLE_FLOATS)
      b.floats += l.pool.expand(m, right, up, b.data, b.floats)
    }
    for (const b of this.batches.values()) b.finish()
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose()
    this.batches.clear()
    this.live.clear()
  }
}
