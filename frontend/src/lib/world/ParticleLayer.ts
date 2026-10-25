import * as THREE from 'three'
import { getAsset, type ModelAsset } from '../models/assets'
import { loadTexture } from '../wow/api'
import type { ObjectLayer } from './ObjectLayer'
import type { vmangos } from '../../../wailsjs/go/models'
import { spawnKey, type SpawnLayer } from './SpawnLayer'
import { blendOf, fogOf, litOf, overLife, PARTICLE_FLOATS, ParticlePool, sortQuads, VERTEX_FLOATS, type GroundProbe, type LifeSample, type ParticleBlend } from './particles'
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
		if (blend === 'add') {
			// AdditiveBlending's colour factors, but the target's alpha left as it is: three's adds the
			// particle's alpha, which over a transparent canvas (a preview window's, #200) composites the
			// texture's black as opaque squares. The viewport's canvas is opaque, so it looks the same there.
			this.material.blending = THREE.CustomBlending
			this.material.blendSrc = THREE.SrcAlphaFactor
			this.material.blendDst = THREE.OneFactor
			this.material.blendSrcAlpha = THREE.ZeroFactor
			this.material.blendDstAlpha = THREE.OneFactor
		}
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
			.catch((err) => console.warn('particle texture failed', look.texture, err))
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
 * Models shown but not placed, by mesh: their particles run too, following the mesh while it is shown
 * in a scene. The Engine's layer runs the shared set (the tools' previews: the Place tool's ghost, a
 * paste's, the doodad brush's plan); a preview window runs a set of its own (#200).
 */
export class PreviewSet {
	readonly meshes = new Map<THREE.Object3D, ModelAsset>()
	version = 0

	/** Runs the particles of `asset` on `mesh`; null stops them. */
	set(mesh: THREE.Object3D, asset: ModelAsset | null) {
		if (asset && (asset.emitters.length || asset.ribbons.length)) this.meshes.set(mesh, asset)
		else if (!this.meshes.delete(mesh)) return
		this.version++
	}
}

const previews = new PreviewSet()

/** Runs the particles of `asset` on the tools' preview `mesh`; null stops them. */
export function previewParticles(mesh: THREE.Object3D, asset: ModelAsset | null) {
	previews.set(mesh, asset)
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
	/** Its key in `ParticleLayer.live`: the owner (object id, `s:` spawn, `p:` preview) and the emitter. */
	key: string
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
	/** The draws of the pool's recursion children, by child. */
	childBatches: Batch[]
	/** A geometry emitter's models, made once its model has loaded. */
	models: ModelCloud | null
	/**
	 * How far from the object's origin the emitter's origin can be, in yards (`reachOf`, grown by any
	 * offset seen), so an object farther than `RANGE` plus this is rejected before its bone math.
	 */
	reach: number
}

const corner = new THREE.Vector3()

/**
 * How far from the object's origin (`inst`) an emitter at `frame` can stand: its rest offset plus the
 * model's bounding diameter (a bone turning about a pivot inside the box), scaled with the object.
 */
function reachOf(asset: ModelAsset, frame: THREE.Matrix4, inst: THREE.Matrix4): number {
	const b = asset.bbox
	const r = b.isEmpty() ? 0 : corner.set(Math.max(-b.min.x, b.max.x), Math.max(-b.min.y, b.max.y), Math.max(-b.min.z, b.max.z)).length()
	return (corner.setFromMatrixPosition(frame).length() + 2 * r) * inst.getMaxScaleOnAxis()
}

/** The most model particles one emitter draws, as Benilla caps them. */
const MAX_MODEL_PARTICLES = 128
const modelLife: LifeSample = { color: [0, 0, 0, 0], size: 0, head: 0, tail: 0 }
const mq = new THREE.Quaternion()
const mPos = new THREE.Vector3()
const mScale = new THREE.Vector3()
const mRot = new THREE.Quaternion()
const mTint = new THREE.Color()
const mMat = new THREE.Matrix4()

/**
 * A geometry emitter's particles drawn as its model (0x7b4840): each at its position and
 * orientation, scaled by its over-life size and tinted by its colour. The model's own alpha is
 * kept: the over-life alpha is not applied per instance.
 */
class ModelCloud {
	readonly mesh: THREE.InstancedMesh

	constructor(asset: ModelAsset) {
		this.mesh = new THREE.InstancedMesh(asset.geometry, asset.material, MAX_MODEL_PARTICLES)
		this.mesh.frustumCulled = false
		this.mesh.count = 0
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
	}

	/** Places the pool's live particles, `m` taking the particles' frame to the world. */
	update(pool: ParticlePool, m: THREE.Matrix4) {
		const e = pool.def
		const n = Math.min(pool.count, MAX_MODEL_PARTICLES)
		const scale = e.flags & 0x20 ? Math.max(1e-4, mPos.setFromMatrixColumn(m, 0).length()) : 1
		if (!pool.anchored) {
			mMat.extractRotation(m)
			mRot.setFromRotationMatrix(mMat)
		}
		for (let i = 0; i < n; i++) {
			overLife(e, pool.age[i] / Math.max(pool.life[i], 1e-6), modelLife)
			mPos.fromArray(pool.pos, i * 3)
			mq.fromArray(pool.quat, i * 4)
			if (!pool.anchored) {
				mPos.applyMatrix4(m)
				mq.premultiply(mRot)
			}
			mMat.compose(mPos, mq, mScale.setScalar(modelLife.size * scale))
			this.mesh.setMatrixAt(i, mMat)
			this.mesh.setColorAt(i, mTint.setRGB(modelLife.color[0], modelLife.color[1], modelLife.color[2], THREE.SRGBColorSpace))
		}
		this.mesh.count = n
		this.mesh.visible = n > 0
		this.mesh.instanceMatrix.needsUpdate = true
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
	}

	dispose() {
		this.mesh.removeFromParent()
		// The geometry and materials belong to the asset loader.
		this.mesh.dispose()
	}
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
	/** `live`'s entries as an array, for the frame's walk; remade by `rebuild`. */
	private list: Live[] = []
	private batches = new Map<string, Batch>()
	private layer: ObjectLayer | null = null
	private shapeVersion = -1
	private layerMoves = 0
	private spawns: SpawnLayer | null = null
	private spawnsVersion = -1
	private spawnsMoves = 0
	private previewsVersion = -1
	private generation = 0

	/** `unplaced` is the set of models whose particles it runs: the tools' previews by default. */
	constructor(private readonly unplaced: PreviewSet = previews) {
		this.group.name = 'particles'
	}

	/** Drops every pool and trail, and the model particles they drew. */
	private clearLive() {
		for (const l of this.live.values()) l.models?.dispose()
		this.live.clear()
		this.list.length = 0
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
		l.reach = reachOf(asset, l.frame, m)
		return true
	}

	private add(key: string, l: Omit<Live, 'key' | 'inst' | 'seen' | 'follow' | 'childBatches' | 'models' | 'reach'>, gen: number) {
		const childBatches = (l.pool?.children ?? []).map((c) => this.batchFor({ texture: c.def.texture, blend: blendOf(c.def), lit: litOf(c.def), fog: fogOf(c.def) }))
		this.live.set(key, { ...l, key, inst: m.clone(), seen: gen, follow: this.following, childBatches, models: null, reach: reachOf(l.asset, l.frame, m) })
	}

	/** The preview mesh the pools being made follow, while `rebuild` walks the previews. */
	private following: THREE.Object3D | null = null

	/**
	 * Every pool and trail and its key, after the objects or the spawns changed. One whose emitter
	 * stays keeps its particles.
	 */
	private rebuild(layer: ObjectLayer | null, spawns: SpawnLayer | null) {
		if (layer !== this.layer || spawns !== this.spawns) {
			this.clearLive()
			this.layer = layer
			this.spawns = spawns
		}
		const gen = ++this.generation
		for (const o of layer?.objects.values() ?? []) {
			if (layer!.isHidden(o.id)) continue
			const asset = getAsset(o.type)
			if (!asset.emitters.length && !asset.ribbons.length) continue
			layer!.matrixOf(o, m)
			this.addModel(String(o.id), asset, gen)
		}
		spawns?.forEachModel((key, type, at) => {
			const asset = getAsset(type)
			if (!asset.emitters.length && !asset.ribbons.length) return
			m.copy(at)
			this.addModel(`s:${key}`, asset, gen)
		})
		for (const [mesh, asset] of this.unplaced.meshes) {
			this.following = mesh
			m.copy(mesh.matrixWorld)
			this.addModel(`p:${mesh.id}`, asset, gen)
		}
		this.following = null
		for (const [key, l] of this.live) {
			if (l.seen === gen) continue
			l.models?.dispose()
			this.live.delete(key)
		}
		this.list = [...this.live.values()]
	}

	/** Moves the pools and trails of spawns changed in place to where their models are now; the rest are kept as they are. */
	private moveSpawns(spawns: SpawnLayer, moved: readonly vmangos.WorldSpawn[]) {
		for (const s of moved) {
			const type = spawns.modelOf(s, m)
			if (type === null) continue
			const asset = getAsset(type)
			const owner = `s:${spawnKey(s)}`
			for (let i = 0; i < asset.emitters.length; i++) this.relocate(`${owner}:${i}`)
			for (let i = 0; i < asset.ribbons.length; i++) this.relocate(`${owner}:r${i}`)
		}
	}

	/** Moves the pools and trails of placed objects that moved to where they are now; the rest are kept as they are. */
	private moveObjects(layer: ObjectLayer, moved: readonly number[]) {
		for (let k = 0; k < moved.length; k++) {
			const o = layer.objects.get(moved[k])
			if (!o || layer.isHidden(o.id)) continue
			const asset = getAsset(o.type)
			if (!asset.emitters.length && !asset.ribbons.length) continue
			layer.matrixOf(o, m)
			const owner = String(o.id)
			for (let i = 0; i < asset.emitters.length; i++) this.relocate(`${owner}:${i}`)
			for (let i = 0; i < asset.ribbons.length; i++) this.relocate(`${owner}:r${i}`)
		}
	}

	/** Puts entry `key` at the matrix `m`. */
	private relocate(key: string) {
		const l = this.live.get(key)
		if (!l) return
		l.inst.copy(m)
		l.reach = reachOf(l.asset, l.frame, m)
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
	 * frozen and hidden, except those of the building itself, the object `gateExempt`, and with
	 * `spawnsUngated` those of the spawns, which are drawn through walls then. `gateAdmits` lets through
	 * an emitter standing in a room the flood reached (#156).
	 */
	update(
		layer: ObjectLayer | null,
		spawns: SpawnLayer | null,
		dt: number,
		ms: number,
		camera: THREE.Camera,
		frustum: THREE.Frustum,
		gate: THREE.Frustum[] | null = null,
		gateExempt = -1,
		spawnsUngated = false,
		gateAdmits: ((s: THREE.Sphere) => boolean) | null = null,
	) {
		const exempt = `${gateExempt}:`
		this.group.visible = this.enabled
		if (!this.enabled) return
		const spawnsVersion = spawns?.version ?? -1
		let changed = layer !== this.layer || (layer?.shapeVersion ?? -1) !== this.shapeVersion || spawns !== this.spawns || spawnsVersion !== this.spawnsVersion || this.unplaced.version !== this.previewsVersion
		// Moves alone (a drag, a sculpt stroke's re-snap) carry the moved models' pools along (#511).
		if (!changed && layer && layer.moveSeq !== this.layerMoves) {
			const moved = layer.movedSince(this.layerMoves)
			this.layerMoves = layer.moveSeq
			if (moved) this.moveObjects(layer, moved)
			else changed = true
		}
		if (!changed && spawns && spawns.moveSeq !== this.spawnsMoves) {
			const moved = spawns.movedSince(this.spawnsMoves)
			this.spawnsMoves = spawns.moveSeq
			if (moved) this.moveSpawns(spawns, moved)
			else changed = true
		}
		if (changed) {
			this.rebuild(layer, spawns)
			this.shapeVersion = layer?.shapeVersion ?? -1
			this.layerMoves = layer?.moveSeq ?? 0
			this.spawnsVersion = spawnsVersion
			this.spawnsMoves = spawns?.moveSeq ?? 0
			this.previewsVersion = this.unplaced.version
		}
		camera.getWorldPosition(eye)
		right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
		up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
		for (const b of this.batches.values()) b.floats = 0
		const list = this.list
		for (let i = 0; i < list.length; i++) {
			const models = list[i].models
			if (models) models.mesh.visible = false
		}
		const ex = eye.x
		const ey = eye.y
		const ez = eye.z
		for (let i = 0; i < list.length; i++) {
			const l = list[i]
			const at = l.inst.elements
			if (l.follow) {
				if (!shown(l.follow)) continue
				l.follow.updateWorldMatrix(true, false)
				l.inst.copy(l.follow.matrixWorld)
			} else {
				// Out of range whatever its bone does: skipped on the object's origin, before the bone math (#330).
				const dx = at[12] - ex
				const dy = at[13] - ey
				const dz = at[14] - ez
				const far = RANGE + l.reach
				if (dx * dx + dy * dy + dz * dz > far * far) continue
			}
			const bone = l.bone >= 0 ? l.asset.anim?.boneMatrix(l.bone) : null
			m.multiplyMatrices(l.inst, bone ?? l.frame)
			if (bone) m.multiply(l.frame)
			origin.setFromMatrixPosition(m)
			// A bone that carries the emitter farther than its reach widens it, so the test above stays safe.
			const ox = origin.x - at[12]
			const oy = origin.y - at[13]
			const oz = origin.z - at[14]
			const off = ox * ox + oy * oy + oz * oz
			if (off > l.reach * l.reach) l.reach = Math.sqrt(off)
			const d = origin.distanceTo(eye)
			if (d > RANGE || !frustum.intersectsSphere(sphere.set(origin, REACH))) continue
			if (gate && !l.key.startsWith(exempt) && !(spawnsUngated && l.key.startsWith('s:')) && !meetsAny(gate, sphere) && !gateAdmits?.(sphere)) continue
			const b = l.batch
			const pool = l.pool
			if (pool) {
				// The client's emission LOD: full rate to 50 yd, down to a quarter by 87.5 yd (0x7b5550).
				pool.step(dt, ms, m, Math.min(1, Math.max(0.25, 1 - (d - 50) * 0.02)), this.ground)
				// The recursion children draw with their own looks, in the parent's frame.
				for (let k = 0; k < pool.children.length; k++) {
					const c = pool.children[k]
					if (!c.count || !c.def.texture) continue
					const cb = l.childBatches[k]
					cb.reserve(c.count * PARTICLE_FLOATS)
					cb.floats += c.expand(m, right, up, cb.data, cb.floats)
				}
				if (pool.geometry) {
					if (!l.models) {
						const model = getAsset(`m2:${pool.def.geometry}`)
						if (model.ready) {
							l.models = new ModelCloud(model)
							this.group.add(l.models.mesh)
						}
					}
					l.models?.update(pool, m)
					continue
				}
				// A recursion parent with no texture of its own only carries its children.
				if (!pool.count || !pool.def.texture) continue
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
		this.clearLive()
	}
}
