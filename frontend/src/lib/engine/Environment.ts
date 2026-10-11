import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

// Physically-based day sky (Preetham scattering from three's Sky shader) with
// our own night layer: moon with phase, stars, Milky Way. Also owns the scene
// lighting so terrain, water and props all follow the time of day.

const NIGHT_FRAGMENT = /* glsl */ `
uniform vec3 moonDirection;
uniform float exposure;
uniform float nightFactor;
uniform float starTime;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Procedural star field: one candidate star per grid cell on the sphere.
vec3 stars(vec3 dir) {
  vec3 p = dir * 180.0;
  vec3 cell = floor(p);
  vec3 col = vec3(0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 c = cell + vec3(x, y, z);
    float r = hash13(c);
    if (r < 0.86) continue;
    vec3 sp = c + vec3(hash13(c + 7.1), hash13(c + 3.7), hash13(c + 1.3));
    float d = length(p - sp);
    float mag = pow((r - 0.86) / 0.14, 4.0);
    float twinkle = 0.75 + 0.25 * sin(starTime * (2.0 + r * 5.0) + r * 60.0);
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(c + 9.9));
    col += tint * mag * twinkle * smoothstep(0.35, 0.0, d) * 2.2;
  }
  return col;
}

vec3 milkyWay(vec3 dir) {
  vec3 n = normalize(vec3(0.3, 0.55, -0.78));
  float band = exp(-pow(dot(dir, n) * 5.5, 2.0));
  float dust = 0.55 + 0.45 * sin(dir.x * 23.0 + sin(dir.z * 17.0) * 2.0) * sin(dir.y * 19.0 + dir.x * 7.0);
  return vec3(0.55, 0.6, 0.8) * band * dust * 0.06;
}

// Moon disc with phase (lit by the sun) and darker maria.
vec3 moon(vec3 dir, vec3 sunDir) {
  float radius = 0.022; // slightly larger than real for readability
  float c = dot(dir, moonDirection);
  if (c < cos(radius * 1.4)) return vec3(0.0);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), moonDirection));
  vec3 up = cross(moonDirection, right);
  vec2 q = vec2(dot(dir, right), dot(dir, up)) / radius;
  float r2 = dot(q, q);
  float glow = exp(-r2 * 0.6) * 0.08;
  if (r2 > 1.0) return vec3(0.75, 0.8, 0.9) * glow;
  vec3 normal = q.x * right + q.y * up + sqrt(1.0 - r2) * moonDirection;
  float lit = smoothstep(-0.05, 0.12, dot(normal, sunDir));
  float maria = 0.75 + 0.25 * sin(q.x * 6.0 + 1.3) * sin(q.y * 5.0 + 0.7) * sin((q.x + q.y) * 3.1);
  float edge = smoothstep(1.0, 0.94, r2);
  return vec3(0.95, 0.93, 0.88) * (0.04 + lit * 1.1) * maria * edge + vec3(0.75, 0.8, 0.9) * glow;
}
`

function buildSkyMaterial(): THREE.ShaderMaterial {
  // @types/three types SkyShader loosely; it is a standard shader object.
  const base = Sky.SkyShader as unknown as {
    uniforms: Record<string, THREE.IUniform>
    vertexShader: string
    fragmentShader: string
  }
  let frag = base.fragmentShader
  frag = frag.replace('void main() {', NIGHT_FRAGMENT + '\nvoid main() {')
  frag = frag.replace(
    /gl_FragColor = vec4\( texColor, 1\.0 \);\s*#include <tonemapping_fragment>/,
    `
      // Tone-map the HDR scattering here (the renderer itself runs without tone mapping).
      vec3 col = acesFilm(texColor * exposure);
      // Night sky: extinction near the horizon, faded out by daylight.
      float above = smoothstep(-0.02, 0.12, direction.y);
      vec3 night = (stars(direction) + milkyWay(direction)) * above * nightFactor;
      night += moon(direction, vSunDirection) * smoothstep(-0.03, 0.02, direction.y) * max(nightFactor, 0.15);
      col += night + vec3(0.004, 0.006, 0.012) * nightFactor * above;
      gl_FragColor = vec4(col, 1.0);`,
  )
  const uniforms = THREE.UniformsUtils.clone(base.uniforms)
  uniforms.moonDirection = { value: new THREE.Vector3(0, 1, 0) }
  uniforms.exposure = { value: 0.55 }
  uniforms.nightFactor = { value: 0 }
  uniforms.starTime = { value: 0 }
  return new THREE.ShaderMaterial({
    name: 'WorldSky',
    uniforms,
    vertexShader: base.vertexShader,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

export interface LightingState {
  /** Direction towards the active key light (sun by day, moon by night). */
  keyDir: THREE.Vector3
  keyColor: THREE.Color
  skyAmbient: THREE.Color
  groundAmbient: THREE.Color
  horizon: THREE.Color
  /** 0 = full day, 1 = full night. */
  night: number
}

const smooth = (e0: number, e1: number, x: number) => THREE.MathUtils.smoothstep(x, e0, e1)
const lerpColor = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) => out.copy(a).lerp(b, t)

const C = {
  daySky: new THREE.Color(0.46, 0.52, 0.62),
  duskSky: new THREE.Color(0.36, 0.3, 0.38),
  nightSky: new THREE.Color(0.012, 0.018, 0.038),
  dayGround: new THREE.Color(0.26, 0.23, 0.19),
  nightGround: new THREE.Color(0.004, 0.005, 0.009),
  sunNoon: new THREE.Color(1.0, 0.96, 0.88),
  sunLow: new THREE.Color(1.0, 0.5, 0.24),
  moon: new THREE.Color(0.42, 0.52, 0.85),
  horizonDay: new THREE.Color('#c4d6e8'),
  horizonDusk: new THREE.Color('#d9906a'),
  horizonNight: new THREE.Color('#0b1020'),
}

export class Environment {
  readonly sky: THREE.Mesh
  readonly hemi: THREE.HemisphereLight
  readonly key: THREE.DirectionalLight
  readonly sunDir = new THREE.Vector3()
  readonly moonDir = new THREE.Vector3()
  readonly state: LightingState = {
    keyDir: new THREE.Vector3(0, 1, 0),
    keyColor: new THREE.Color(),
    skyAmbient: new THREE.Color(),
    groundAmbient: new THREE.Color(),
    horizon: new THREE.Color(),
    night: 0,
  }
  private material: THREE.ShaderMaterial
  private shadowExtent = 0

  constructor(scene: THREE.Scene) {
    this.material = buildSkyMaterial()
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material)
    this.sky.scale.setScalar(1000)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    this.sky.name = 'sky'
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, Math.PI)
    this.key = new THREE.DirectionalLight(0xffffff, Math.PI)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.6
    this.key.shadow.camera.near = 1
    this.key.shadow.camera.far = 4000
    scene.add(this.sky, this.hemi, this.key, this.key.target)
  }

  /**
   * Sun path for an hour of day (0-24): rises in the east (+X) at 6, peaks in
   * the south at noon (~55°), sets in the west at 18. The moon trails opposite.
   */
  private placeBodies(hour: number) {
    const tilt = THREE.MathUtils.degToRad(35)
    const at = (a: number, out: THREE.Vector3) => out.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize()
    const a = ((hour - 6) / 24) * Math.PI * 2
    at(a, this.sunDir)
    at(a + Math.PI + 0.5, this.moonDir) // offset → a waxing gibbous phase
  }

  setClouds(on: boolean) {
    this.material.uniforms.cloudCoverage.value = on ? 0.38 : 0
  }

  /** Recompute sky + lighting for `hour`. `time` animates stars and clouds. */
  update(hour: number, time: number, camera: THREE.Camera) {
    this.placeBodies(hour)
    const sunY = this.sunDir.y
    const day = smooth(-0.06, 0.2, sunY) // 0 at night → 1 in daylight
    const golden = 1 - smooth(0.02, 0.35, sunY) // low sun → warm light
    const night = 1 - smooth(-0.18, 0.0, sunY)
    const s = this.state
    s.night = night

    // Key light: the sun while it's up, otherwise the moon.
    if (sunY > -0.04) {
      s.keyDir.copy(this.sunDir)
      lerpColor(C.sunNoon, C.sunLow, golden, s.keyColor).multiplyScalar(smooth(-0.04, 0.12, sunY) * 0.95)
    } else {
      s.keyDir.copy(this.moonDir)
      s.keyColor.copy(C.moon).multiplyScalar(0.13 * smooth(-0.02, 0.2, this.moonDir.y) * night)
    }
    lerpColor(C.nightSky, C.daySky, day, s.skyAmbient)
    s.skyAmbient.lerp(C.duskSky, golden * day * 0.5)
    lerpColor(C.nightGround, C.dayGround, day, s.groundAmbient)
    lerpColor(C.horizonNight, C.horizonDay, day, s.horizon)
    s.horizon.lerp(C.horizonDusk, golden * day * 0.75)

    this.hemi.color.copy(s.skyAmbient)
    this.hemi.groundColor.copy(s.groundAmbient)
    this.key.color.copy(s.keyColor)
    this.key.intensity = Math.PI

    const u = this.material.uniforms
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(450000)
    u.moonDirection.value.copy(this.moonDir)
    u.nightFactor.value = night
    u.starTime.value = time
    u.time.value = time
    u.turbidity.value = 2.5 + golden * 4
    u.rayleigh.value = 1.2 + golden * 1.2
    this.sky.position.copy(camera.position)
  }

  /** Fit the key light's shadow camera around the view, snapped to texels. */
  updateShadow(center: THREE.Vector3, extent: number, mapSize: number) {
    const cam = this.key.shadow.camera
    if (Math.abs(extent - this.shadowExtent) > extent * 0.05) {
      this.shadowExtent = extent
      cam.left = cam.bottom = -extent
      cam.right = cam.top = extent
      cam.updateProjectionMatrix()
    }
    // Snap the centre to whole shadow texels to stop shimmering as the camera moves.
    const texel = (2 * this.shadowExtent) / mapSize
    const fwd = this.tmpV1.copy(this.state.keyDir).negate()
    const right = this.tmpV2.crossVectors(fwd, Math.abs(fwd.y) > 0.99 ? this.ax : this.up).normalize()
    const up = this.tmpV3.crossVectors(right, fwd)
    const r = Math.round(center.dot(right) / texel) * texel - center.dot(right)
    const u = Math.round(center.dot(up) / texel) * texel - center.dot(up)
    const c = this.tmpV4.copy(center).addScaledVector(right, r).addScaledVector(up, u)
    this.key.target.position.copy(c)
    this.key.position.copy(c).addScaledVector(this.state.keyDir, 1500)
    this.key.target.updateMatrixWorld()
  }
  private up = new THREE.Vector3(0, 1, 0)
  private ax = new THREE.Vector3(1, 0, 0)
  private tmpV1 = new THREE.Vector3()
  private tmpV2 = new THREE.Vector3()
  private tmpV3 = new THREE.Vector3()
  private tmpV4 = new THREE.Vector3()

  /** Shadow-casting key light on/off with the given map size. */
  setShadows(mode: 'off' | 'medium' | 'high') {
    const size = mode === 'high' ? 4096 : 2048
    this.key.castShadow = mode !== 'off'
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size)
      this.key.shadow.map?.dispose()
      this.key.shadow.map = null
    }
  }

  dispose() {
    this.material.dispose()
    this.sky.geometry.dispose()
    this.key.shadow.map?.dispose()
  }
}
