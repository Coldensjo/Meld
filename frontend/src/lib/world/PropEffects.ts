import * as THREE from 'three'
import { getAsset } from '../models/assets'
import type { ObjectLayer } from './ObjectLayer'
import { addShadowReach, clearShadowReach } from './shadowReach'

/** Max simultaneous dynamic lights (nearest to the camera target win). */
export const LIGHT_POOL = 8
/**
 * The nearest few of them cast shadows, so they don't shine through walls. Their cube maps are
 * rendered only when a light moves to another source or the scene around it changes.
 */
export const SHADOW_LIGHTS = 3
const SHADOW_SIZE = 512
const MAX_FLAMES = 2048

interface Source {
	pos: THREE.Vector3
	color: THREE.Color
	intensity: number
	radius: number
	fire: boolean
	seed: number
	/** The client's raw light colour (an M2 light's colour times intensity), or null for none. */
	raw: [number, number, number] | null
	/** The object it belongs to, and its place among that object's sources: what a slot follows through a rebuild. */
	owner: number
	k: number
}

function newSource(): Source {
	return { pos: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, radius: 0, fire: false, seed: 0, raw: null, owner: 0, k: 0 }
}

/** Where an object's sources and flames sit in `PropEffects`' lists, so a move rewrites them in place. */
interface Span {
	src: number
	srcCount: number
	flame: number
	flameCount: number
}

const flameVertex = /* glsl */ `
attribute float seed;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
void main() {
  vUv = uv;
  vColor = instanceColor;
  vSeed = seed;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  // Cylindrical billboard: faces the camera but stays upright, like a real flame.
  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 world = center + (position.x * right + (position.y + 0.35) * up) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const flameFragment = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;          // -1..1, y up
  float t = time * 1.6 + vSeed * 13.0;
  // Rising turbulence distorts the flame body.
  float n = fbm(vec2(p.x * 2.2, p.y * 1.4 - t * 1.8) + vSeed);
  float x = p.x + (n - 0.5) * 0.55 * (p.y + 1.0) * 0.6;
  // Teardrop: wide at the base, narrowing upward.
  float width = mix(0.55, 0.05, clamp((p.y + 0.7) / 1.6, 0.0, 1.0));
  float body = smoothstep(width, width * 0.25, abs(x)) * smoothstep(-0.95, -0.55, p.y) * smoothstep(1.0, 0.1, p.y + (n - 0.5) * 0.6);
  float core = body * smoothstep(0.35, -0.6, p.y) * smoothstep(width * 0.6, 0.0, abs(x));
  // Soft glow halo around the flame.
  float glow = exp(-dot(p * vec2(1.2, 0.9) + vec2(0.0, 0.35), p * vec2(1.2, 0.9) + vec2(0.0, 0.35)) * 2.2) * 0.22;
  vec3 hot = mix(vColor, vec3(1.0, 0.95, 0.75), 0.65);
  vec3 col = vColor * body * 1.6 + hot * core * 1.4 + vColor * glow;
  float flicker = 0.85 + 0.15 * noise(vec2(t * 3.0, vSeed * 7.0));
  gl_FragColor = vec4(col * flicker, 1.0);
}
`

/**
 * Light-emitting props: animated flames (instanced billboards) and a pool of
 * point lights assigned to the nearest sources each frame, with flicker.
 */
export class PropEffects {
	readonly group = new THREE.Group()
	readonly lights: THREE.PointLight[] = []
	/**
	 * The pooled lights the client would add to the ground (those with a raw colour): world positions
	 * and raw colours, three floats each, the first `clientCount`; for Client Lighting's terrain.
	 */
	readonly clientPos = new Float32Array(LIGHT_POOL * 3)
	readonly clientColor = new Float32Array(LIGHT_POOL * 3)
	clientCount = 0
	private flames: THREE.InstancedMesh
	private seeds: THREE.InstancedBufferAttribute
	private material: THREE.ShaderMaterial
	/** The light sources, the first `count`; the rest are kept for reuse, as rebuilds refill the list. */
	private sources: Source[] = []
	private count = 0
	/** Each object's sources and flames, by id: only objects with one or the other. */
	private spans = new Map<number, Span>()
	private spanFree: Span[] = []
	private shapeVersion = -1
	private moveSeq = 0
	private layer: ObjectLayer | null = null
	/** The owner and place of each pooled light's source before a rebuild, to find it again after. */
	private slotOwner = new Int32Array(LIGHT_POOL)
	private slotK = new Int32Array(LIGHT_POOL)
	private flameColor = new THREE.Color()
	private tmpM = new THREE.Matrix4()
	private tmpM2 = new THREE.Matrix4()
	private tmpV = new THREE.Vector3()
	private tmpQ = new THREE.Quaternion()
	private tmpS = new THREE.Vector3()
	/** The nearest sources to the camera target this frame, nearest first, the first `orderLen`. */
	private order = new Int32Array(LIGHT_POOL)
	private orderLen = 0
	/** The squared distance of each of `order`'s sources to the camera target. */
	private orderDist = new Float32Array(LIGHT_POOL)
	/** The source each pooled light shows (-1 for none), kept across frames so shadows aren't redrawn. */
	private slots = new Int32Array(LIGHT_POOL).fill(-1)
	/**
	 * Per shadowed light: 2 when it took a new source and has no map of it yet (it stays dark until
	 * the map is drawn), 1 when its map is out of date (the scene changed; it keeps lighting with the
	 * old one), 0 when its map is current. One map is redrawn a frame (#129): a cube map is six passes
	 * over everything in the light's reach, and a camera jump that brought three new lights redrew
	 * all three in one frame.
	 */
	private stale = new Uint8Array(SHADOW_LIGHTS)
	/** The shadowed light whose map was redrawn last, where the next search starts after (#629). */
	private lastRedrawn = SHADOW_LIGHTS - 1
	private sceneVersion = -1
	private shadows = false
	/** The reach of the shadowed lights in use, for culling: what can throw their shadows must be drawn. */
	readonly shadowSpheres: THREE.Sphere[] = []
	private sphereFree: THREE.Sphere[] = []
	enabled = true
	/**
	 * Whether the models' particles are drawn (world/ParticleLayer.ts): a model with emitters then
	 * shows its own flames, and its fire effects only light.
	 */
	particles = false
	private drawnParticles = false

	constructor() {
		this.material = new THREE.ShaderMaterial({
			uniforms: { time: { value: 0 } },
			vertexShader: flameVertex,
			fragmentShader: flameFragment,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		})
		const geo = new THREE.PlaneGeometry(1, 1.6)
		this.seeds = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES), 1)
		geo.setAttribute('seed', this.seeds)
		this.flames = new THREE.InstancedMesh(geo, this.material, MAX_FLAMES)
		this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.flames.setColorAt(0, new THREE.Color())
		this.flames.count = 0
		this.flames.frustumCulled = false
		this.flames.renderOrder = 5
		this.group.add(this.flames)
		for (let i = 0; i < LIGHT_POOL; i++) {
			const l = new THREE.PointLight(0xffaa55, 0, 10, 2)
			l.castShadow = false
			if (i < SHADOW_LIGHTS) {
				l.shadow.autoUpdate = false
				l.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE)
				// Past most of the lamp's own cage or glass, which would otherwise stripe the floor with
				// shadows. Further out, a wall the lamp hangs on is clipped too and light slips under it.
				l.shadow.camera.near = 0.45
				// A small depth bias: a larger one lets light through where a wall meets the ground. The
				// normal offset keeps grazing ground free of acne instead.
				l.shadow.bias = -0.0005
				l.shadow.normalBias = 0.04
			}
			this.lights.push(l)
			this.group.add(l)
		}
		this.setShadows(true)
	}

	/** Rebuilds the source list and flames when what is placed (or a loaded asset) changed. */
	private rebuild(layer: ObjectLayer) {
		for (const sp of this.spans.values()) this.spanFree.push(sp)
		this.spans.clear()
		this.count = 0
		let flames = 0
		for (const o of layer.objects.values()) {
			if (layer.isHidden(o.id)) continue
			const a = getAsset(o.type)
			if (!a.effects.length) continue
			const sp = this.spanFree.pop() ?? { src: 0, srcCount: 0, flame: 0, flameCount: 0 }
			sp.src = this.count
			sp.flame = flames
			this.emit(layer, o.id, sp)
			this.count += sp.srcCount
			flames += sp.flameCount
			this.spans.set(o.id, sp)
		}
		this.flames.count = flames
		this.flames.instanceMatrix.needsUpdate = true
		if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true
		this.seeds.needsUpdate = true
	}

	/**
	 * Writes object `id`'s sources from `sp.src` and its flames from `sp.flame`, setting their counts.
	 * A move keeps both counts (a prop's effects merge by their distance apart, which a move and a
	 * uniform scale keep in proportion), so `move` rewrites them in place.
	 */
	private emit(layer: ObjectLayer, id: number, sp: Span) {
		const o = layer.objects.get(id)!
		const a = getAsset(o.type)
		const ownFlames = this.particles && a.emitters.length > 0
		const m = layer.matrixOf(o, this.tmpM)
		const pool = this.sources
		// One dynamic light per prop cluster: a model's light + flames at the
		// same spot would otherwise waste several of the pooled lights.
		const first = sp.src
		let n = first
		let flame = sp.flame
		for (const e of a.effects) {
			// The candidate is written to the next free entry, and kept only if it merges with none.
			const src = pool[n] ?? (pool[n] = newSource())
			const pos = src.pos.set(e.pos[0], e.pos[1], e.pos[2]).applyMatrix4(m)
			const seed = (o.id * 0.6180339 + e.pos[0] * 3.1 + e.pos[2] * 1.7) % 1
			src.color.setRGB(e.color[0], e.color[1], e.color[2])
			src.intensity = e.intensity
			src.radius = e.radius * o.scale
			src.fire = e.kind === 'fire'
			src.seed = seed
			src.raw = e.raw && (e.raw[0] || e.raw[1] || e.raw[2]) ? e.raw : null
			src.owner = o.id
			src.k = n - first
			let near: Source | null = null
			if (!e.interior) {
				const reach = 2.5 * o.scale
				for (let i = first; i < n && !near; i++) if (pool[i].pos.distanceTo(pos) < reach) near = pool[i]
			}
			if (e.interior) {
				// Interiors are lit by their baked vertex colours; with no shadows,
				// a point light here would only light the outside through the walls.
			} else if (near) {
				// Keep the model's own light colour; let flames make it flicker.
				if (src.fire) near.fire = true
				else {
					near.color.copy(src.color)
					near.raw = src.raw
				}
				near.radius = Math.max(near.radius, src.radius)
			} else {
				n++
			}
			if (src.fire && !ownFlames && flame < MAX_FLAMES) {
				const size = (e.size ?? 0.4) * o.scale
				this.tmpM2.compose(pos, this.tmpQ.identity(), this.tmpS.setScalar(size))
				this.flames.setMatrixAt(flame, this.tmpM2)
				this.flames.setColorAt(flame, this.flameColor.setRGB(e.color[0], e.color[1], e.color[2]))
				this.seeds.setX(flame, seed)
				flame++
			}
		}
		sp.srcCount = n - first
		sp.flameCount = flame - sp.flame
	}

	/**
	 * Rewrites the sources and flames of the objects moved since the last frame, in place. False when
	 * one no longer gives as many as it did, and the list must be rebuilt.
	 */
	private move(layer: ObjectLayer, moved: readonly number[]): boolean {
		let flames = false
		for (let i = 0; i < moved.length; i++) {
			const sp = this.spans.get(moved[i])
			if (!sp || !layer.objects.has(moved[i])) continue
			const srcCount = sp.srcCount
			const flameCount = sp.flameCount
			// A merged candidate lands past the object's own sources: keep the next object's first one safe.
			const next = sp.src + srcCount
			const keep = next < this.count ? this.sources[next] : null
			if (keep) this.sources[next] = this.spare
			this.emit(layer, moved[i], sp)
			if (keep) {
				this.spare = this.sources[next]
				this.sources[next] = keep
			}
			if (sp.srcCount !== srcCount || sp.flameCount !== flameCount) return false
			if (flameCount) flames = true
		}
		if (flames) {
			this.flames.instanceMatrix.needsUpdate = true
			if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true
			this.seeds.needsUpdate = true
		}
		return true
	}

	/** Scratch for `move`: stands in for the entry after an object's sources while its candidates are written. */
	private spare = newSource()

	/**
	 * Whether the nearest lights cast shadows. On from the start, whatever the sun's Shadows preference:
	 * their maps redraw only on changes, and without them lights shine through walls. Changing it
	 * recompiles shaders.
	 */
	setShadows(on: boolean) {
		if (on === this.shadows) return
		this.shadows = on
		for (let i = 0; i < SHADOW_LIGHTS; i++) {
			const l = this.lights[i]
			l.castShadow = on
			l.shadow.needsUpdate = on
			if (!on) {
				l.shadow.map?.dispose()
				l.shadow.map = null
			}
		}
	}

	/**
	 * Per frame, before culling: refresh sources if needed, animate flames, assign lights.
	 * `sceneVersion` changes whenever what could throw a light's shadow changed (here, the terrain).
	 */
	update(layer: ObjectLayer, time: number, focus: THREE.Vector3, night: number, sceneVersion: number) {
		let changed = layer !== this.layer || layer.shapeVersion !== this.shapeVersion || this.particles !== this.drawnParticles
		let redraw = false
		if (!changed && layer.moveSeq !== this.moveSeq) {
			// Moves only (a drag, a sculpt stroke's re-snap): the moved objects' sources are rewritten in
			// place, so every index, and the slots naming them, still hold.
			const moved = layer.movedSince(this.moveSeq)
			this.moveSeq = layer.moveSeq
			if (!moved || !this.move(layer, moved)) changed = true
			// What moved may throw a shadowed light's shadow.
			else redraw = moved.length > 0
		}
		if (changed) {
			const same = layer === this.layer
			this.layer = layer
			this.shapeVersion = layer.shapeVersion
			this.moveSeq = layer.moveSeq
			this.drawnParticles = this.particles
			this.keepSlots(same)
			redraw = true
		}
		redraw ||= sceneVersion !== this.sceneVersion
		this.sceneVersion = sceneVersion
		this.material.uniforms.time.value = time
		this.flames.visible = this.enabled

		// Nearest sources to the camera target get the light pool, and the nearest of those its shadows.
		const src = this.sources
		this.selectNearest(focus)
		this.assignSlots(this.enabled ? this.orderLen : 0)
		for (const sp of this.shadowSpheres) this.sphereFree.push(sp)
		this.shadowSpheres.length = 0
		clearShadowReach()

		// The one shadow map redrawn this frame: a new light's first, else an out-of-date one. Ties go
		// round robin from the light after the one redrawn last: a drag or a sculpt stroke marks every
		// map out of date each frame, and taking the first would redraw light 0's alone (#629).
		if (redraw) for (let i = 0; i < SHADOW_LIGHTS; i++) if (this.stale[i] < 1) this.stale[i] = 1
		let next = -1
		for (let k = 1; k <= SHADOW_LIGHTS; k++) {
			const i = (this.lastRedrawn + k) % SHADOW_LIGHTS
			if (this.slots[i] >= 0 && this.stale[i] > (next < 0 ? 0 : this.stale[next])) next = i
		}
		if (next >= 0) {
			this.lastRedrawn = next
			this.stale[next] = 0
			if (this.lights[next].castShadow) this.lights[next].shadow.needsUpdate = true
		}

		// Lights read stronger at night; by day they're a subtle warm touch.
		const strength = 0.35 + 0.65 * night
		this.clientCount = 0
		for (let i = 0; i < LIGHT_POOL; i++) {
			const l = this.lights[i]
			const s = this.slots[i] >= 0 ? src[this.slots[i]] : null
			if (!s) {
				l.intensity = 0
				continue
			}
			if (s.raw) {
				const k = this.clientCount++ * 3
				this.clientPos[k] = s.pos.x
				this.clientPos[k + 1] = s.pos.y
				this.clientPos[k + 2] = s.pos.z
				this.clientColor[k] = s.raw[0]
				this.clientColor[k + 1] = s.raw[1]
				this.clientColor[k + 2] = s.raw[2]
			}
			if (l.castShadow) {
				const sp = this.sphereFree.pop() ?? new THREE.Sphere()
				sp.center.copy(s.pos)
				sp.radius = s.radius
				this.shadowSpheres.push(sp)
			}
			const flicker = s.fire ? 0.82 + 0.1 * Math.sin(time * 9.1 + s.seed * 40) + 0.08 * Math.sin(time * 23.7 + s.seed * 17) : 1
			l.position.copy(s.pos).add(this.tmpV.set(0, s.fire ? 0.3 : 0, 0))
			l.color.copy(s.color)
			l.distance = s.radius
			if (l.castShadow) addShadowReach(l)
			l.intensity = s.intensity * s.radius * s.radius * 0.5 * flicker * strength
			// A shadowed light waits for its first map, rather than shining through walls with another's.
			if (i < SHADOW_LIGHTS && l.castShadow && this.stale[i] === 2) l.intensity = 0
		}
	}

	/**
	 * Rebuilds the sources, and points each pooled light at its source's new index, found by the
	 * object and its place among the object's sources; a light whose source is gone is freed. A shadowed
	 * light so keeps its map (marked out of date) rather than going dark until a new one is drawn,
	 * which made a drag's nearest lights flicker every frame. `same` is false for another layer (a tab
	 * switch), whose sources share nothing with the old ones.
	 */
	private keepSlots(same: boolean) {
		const slots = this.slots
		for (let i = 0; i < LIGHT_POOL; i++) {
			const s = same && slots[i] >= 0 && slots[i] < this.count ? this.sources[slots[i]] : null
			this.slotOwner[i] = s ? s.owner : -1
			this.slotK[i] = s ? s.k : -1
		}
		this.rebuild(this.layer!)
		for (let i = 0; i < LIGHT_POOL; i++) {
			const sp = this.slotOwner[i] >= 0 ? this.spans.get(this.slotOwner[i]) : undefined
			slots[i] = sp && this.slotK[i] < sp.srcCount ? sp.src + this.slotK[i] : -1
		}
	}

	/**
	 * Fills `order` with the LIGHT_POOL sources nearest `focus`, nearest first, in one pass with a
	 * bounded insertion: a city holds thousands of sources, and sorting them all each frame only to
	 * take eight was the light pool's main cost (#518). A tie keeps the lower index first, as the
	 * stable sort did, so the shadowed lights don't trade sources between equally near ones.
	 */
	private selectNearest(focus: THREE.Vector3) {
		const src = this.sources
		const count = this.count
		const order = this.order
		const d = this.orderDist
		let len = 0
		if (count <= SHADOW_LIGHTS) {
			// All of them go to the shadowed lights, which keep their sources whatever the order.
			for (; len < count; len++) order[len] = len
			this.orderLen = len
			return
		}
		for (let i = 0; i < count; i++) {
			const di = src[i].pos.distanceToSquared(focus)
			if (len === LIGHT_POOL && di >= d[len - 1]) continue
			let j = len < LIGHT_POOL ? len++ : len - 1
			for (; j > 0 && d[j - 1] > di; j--) {
				d[j] = d[j - 1]
				order[j] = order[j - 1]
			}
			d[j] = di
			order[j] = i
		}
		this.orderLen = len
	}

	/**
	 * Gives the pooled lights the `n` nearest sources (the front of `order`). The nearest SHADOW_LIGHTS
	 * go to the shadowed lights, and a source keeps the light it already had, so its shadow map stays.
	 */
	private assignSlots(n: number) {
		const slots = this.slots
		const order = this.order
		const ns = Math.min(n, SHADOW_LIGHTS)
		// Shadowed lights: keep those whose source is still among the nearest, refill the rest.
		for (let i = 0; i < SHADOW_LIGHTS; i++) {
			let keep = false
			for (let k = 0; !keep && k < ns; k++) keep = order[k] === slots[i]
			if (!keep) slots[i] = -1
		}
		for (let k = 0; k < ns; k++) {
			const s = order[k]
			let held = false
			for (let i = 0; !held && i < SHADOW_LIGHTS; i++) held = slots[i] === s
			if (held) continue
			for (let i = 0; i < SHADOW_LIGHTS; i++) {
				if (slots[i] < 0) {
					slots[i] = s
					this.stale[i] = 2
					break
				}
			}
		}
		// The others cost nothing to move.
		for (let i = SHADOW_LIGHTS; i < LIGHT_POOL; i++) {
			const k = ns + i - SHADOW_LIGHTS
			slots[i] = k < n ? order[k] : -1
		}
	}

	dispose() {
		this.flames.geometry.dispose()
		this.material.dispose()
	}
}
