import * as THREE from 'three'
import { getAsset } from '../models/assets'
import type { ObjectLayer } from './ObjectLayer'

/** Max simultaneous dynamic lights (nearest to the camera target win). */
export const LIGHT_POOL = 8
const MAX_FLAMES = 2048

interface Source {
  pos: THREE.Vector3
  color: THREE.Color
  intensity: number
  radius: number
  fire: boolean
  seed: number
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
  private flames: THREE.InstancedMesh
  private seeds: THREE.InstancedBufferAttribute
  private material: THREE.ShaderMaterial
  private sources: Source[] = []
  private version = -1
  private layer: ObjectLayer | null = null
  private tmpM = new THREE.Matrix4()
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private tmpS = new THREE.Vector3()
  private order: number[] = []
  /** Each source's squared distance to the camera target this frame, for the light pool's order. */
  private dist = new Float32Array(0)
  enabled = true

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
      this.lights.push(l)
      this.group.add(l)
    }
  }

  /** Rebuild the source list when the objects (or loaded assets) changed. */
  private rebuild(layer: ObjectLayer) {
    this.sources = []
    let flameCount = 0
    const color = new THREE.Color()
    for (const o of layer.objects.values()) {
      if (layer.isHidden(o.id)) continue
      const a = getAsset(o.type)
      if (!a.effects.length) continue
      layer.matrixOf(o, this.tmpM)
      // One dynamic light per prop cluster: a model's light + flames at the
      // same spot would otherwise waste several of the pooled lights.
      const firstOfObject = this.sources.length
      for (const e of a.effects) {
        const pos = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]).applyMatrix4(this.tmpM)
        const seed = (o.id * 0.6180339 + e.pos[0] * 3.1 + e.pos[2] * 1.7) % 1
        const src: Source = {
          pos,
          color: new THREE.Color(e.color[0], e.color[1], e.color[2]),
          intensity: e.intensity,
          radius: e.radius * o.scale,
          fire: e.kind === 'fire',
          seed,
        }
        const near = e.interior ? null : this.sources.slice(firstOfObject).find((x) => x.pos.distanceTo(pos) < 2.5 * o.scale)
        if (e.interior) {
          // Interiors are lit by their baked vertex colours; with no shadows,
          // a point light here would only light the outside through the walls.
        } else if (near) {
          // Keep the model's own light colour; let flames make it flicker.
          if (src.fire) near.fire = true
          else near.color.copy(src.color)
          near.radius = Math.max(near.radius, src.radius)
        } else {
          this.sources.push(src)
        }
        if (src.fire && flameCount < MAX_FLAMES) {
          const size = (e.size ?? 0.4) * o.scale
          this.tmpM.compose(pos, this.tmpQ.identity(), this.tmpS.setScalar(size))
          this.flames.setMatrixAt(flameCount, this.tmpM)
          this.flames.setColorAt(flameCount, color.copy(src.color))
          this.seeds.setX(flameCount, seed)
          flameCount++
          layer.matrixOf(o, this.tmpM) // restore for the next effect
        }
      }
    }
    this.flames.count = flameCount
    this.flames.instanceMatrix.needsUpdate = true
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true
    this.seeds.needsUpdate = true
  }

  /** Per frame: refresh sources if needed, animate flames, assign lights. */
  update(layer: ObjectLayer, time: number, focus: THREE.Vector3, night: number) {
    if (layer !== this.layer || layer.version !== this.version) {
      this.layer = layer
      this.version = layer.version
      this.rebuild(layer)
    }
    this.material.uniforms.time.value = time
    this.flames.visible = this.enabled

    // Nearest sources to the camera target get the light pool.
    const src = this.sources
    this.order.length = 0
    for (let i = 0; i < src.length; i++) this.order.push(i)
    if (src.length > LIGHT_POOL) {
      if (this.dist.length < src.length) this.dist = new Float32Array(src.length)
      const d = this.dist
      for (let i = 0; i < src.length; i++) d[i] = src[i].pos.distanceToSquared(focus)
      this.order.sort((a, b) => d[a] - d[b])
    }
    // Lights read stronger at night; by day they're a subtle warm touch.
    const strength = 0.35 + 0.65 * night
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = this.lights[i]
      const s = i < this.order.length ? src[this.order[i]] : null
      if (!s || !this.enabled) {
        l.intensity = 0
        continue
      }
      const flicker = s.fire ? 0.82 + 0.1 * Math.sin(time * 9.1 + s.seed * 40) + 0.08 * Math.sin(time * 23.7 + s.seed * 17) : 1
      l.position.copy(s.pos).add(this.tmpV.set(0, s.fire ? 0.3 : 0, 0))
      l.color.copy(s.color)
      l.distance = s.radius
      l.intensity = s.intensity * s.radius * s.radius * 0.5 * flicker * strength
    }
  }

  dispose() {
    this.flames.geometry.dispose()
    this.material.dispose()
  }
}
