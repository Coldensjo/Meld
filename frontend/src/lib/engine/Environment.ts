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

// The client's own sky dome (Lighting › Client Lighting), after Benilla's sky.wgsl (MIT/Apache): the five
// LightIntBand sky stops on the client's ring elevations, the fog colour at and below the horizon,
// linear in elevation between them, with the dawn and dusk warp of the four middle rings toward the
// sun (0x6d0f50). The colours are drawn raw, as the client draws the DBC bytes. The visible sun, the
// moon and the stars follow the client's DayNight tables; the bodies themselves are drawn here, not
// from the client's textures.
const CLIENT_SKY_VERTEX = /* glsl */ `
varying vec3 vWorldDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldDirection = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w;
}
`

const CLIENT_SKY_FRAGMENT = /* glsl */ `
uniform vec3 sky0;
uniform vec3 sky1;
uniform vec3 sky2;
uniform vec3 sky3;
uniform vec3 sky4;
uniform vec3 fogColor;
uniform vec2 warp;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunScale;
uniform float starAlpha;
varying vec3 vWorldDirection;
${NIGHT_FRAGMENT}

// The glow for an azimuth phase relative to the sun (0.125 is the sun's bearing), from the client's
// six-key wrap-around table at 0xce9af8.
float azimuthGlow(float phase) {
  float p = fract(phase);
  if (p < 0.125) return mix(0.0, 1.0, (p + 0.125) / 0.25);
  if (p < 0.375) return mix(1.0, 0.0, (p - 0.125) / 0.25);
  if (p < 0.5) return mix(0.0, -0.5, (p - 0.375) / 0.125);
  if (p < 0.625) return mix(-0.5, -0.7, (p - 0.5) / 0.125);
  if (p < 0.75) return mix(-0.7, -0.5, (p - 0.625) / 0.125);
  if (p < 0.875) return mix(-0.5, 0.0, (p - 0.75) / 0.125);
  return mix(0.0, 1.0, (p - 0.875) / 0.25);
}

// One middle ring's warped colour for glow g: never brighter, toward ring 1 or the apex.
vec3 warpRing(vec3 base, float g, float s) {
  float s2 = s * s;
  if (g >= 0.0) return mix(base, sky1, (1.0 - g) * s2);
  return mix(mix(base, sky1, s), sky0, 0.7 * (-g) * s2);
}

// The client bakes the warp per vertex at 24 azimuth segments, hence two segments mixed.
vec3 warped(vec3 base, float g0, float g1, float f, float s) {
  return mix(warpRing(base, g0, s), warpRing(base, g1, s), f);
}

void main() {
  vec3 dir = normalize(vWorldDirection);
  float elev = degrees(asin(clamp(dir.y, -1.0, 1.0)));
  vec3 s1 = sky1;
  vec3 s2 = sky2;
  vec3 s3 = sky3;
  vec3 s4 = sky4;
  if (warp.x > 0.0) {
    float seg = fract((atan(dir.z, dir.x) - warp.y) / 6.2831853 + 0.125) * 24.0;
    float a = floor(seg);
    float f = seg - a;
    float g0 = azimuthGlow(a / 24.0);
    float g1 = azimuthGlow((a + 1.0) / 24.0);
    s1 = warped(sky1, g0, g1, f, warp.x);
    s2 = warped(sky2, g0, g1, f, warp.x);
    s3 = warped(sky3, g0, g1, f, warp.x);
    s4 = warped(sky4, g0, g1, f, warp.x);
  }
  vec3 col;
  if (elev <= 0.0) col = fogColor;
  else if (elev < 1.8) col = mix(fogColor, s4, elev / 1.8);
  else if (elev < 3.7) col = mix(s4, s3, (elev - 1.8) / 1.9);
  else if (elev < 9.8) col = mix(s3, s2, (elev - 3.7) / 6.1);
  else if (elev < 16.8) col = mix(s2, s1, (elev - 9.8) / 7.0);
  else col = mix(s1, sky0, (elev - 16.8) / 73.2);

  float above = smoothstep(-0.02, 0.12, dir.y);
  col += (stars(dir) + milkyWay(dir)) * above * starAlpha;
  col += moon(dir, sunDirection) * smoothstep(-0.03, 0.02, dir.y) * smoothstep(-0.05, 0.05, moonDirection.y);
  // The sun disc, twice as big at the horizon, in the sun band's colour.
  float r = 0.03 * sunScale;
  float c = dot(dir, sunDirection);
  float disc = smoothstep(cos(r), cos(r * 0.8), c) + exp((c - 1.0) * 600.0 / sunScale) * 0.35;
  col += sunColor * disc * smoothstep(-0.03, 0.02, dir.y);
  gl_FragColor = vec4(col, 1.0);
}
`

function buildClientSkyMaterial(): THREE.ShaderMaterial {
	const v3 = () => ({ value: new THREE.Vector3() })
	return new THREE.ShaderMaterial({
		name: 'ClientSky',
		uniforms: {
			sky0: v3(),
			sky1: v3(),
			sky2: v3(),
			sky3: v3(),
			sky4: v3(),
			fogColor: v3(),
			warp: { value: new THREE.Vector2() },
			sunDirection: { value: new THREE.Vector3(0, 1, 0) },
			sunColor: v3(),
			sunScale: { value: 1 },
			starAlpha: { value: 0 },
			moonDirection: { value: new THREE.Vector3(0, 1, 0) },
			exposure: { value: 1 },
			nightFactor: { value: 0 },
			starTime: { value: 0 },
		},
		vertexShader: CLIENT_SKY_VERTEX,
		fragmentShader: CLIENT_SKY_FRAGMENT,
		side: THREE.BackSide,
		depthWrite: false,
	})
}

const SKY_UNIFORMS = ['sky0', 'sky1', 'sky2', 'sky3', 'sky4'] as const

/** What the client's sky dome is drawn from: colours as raw sRGB (0 to 1), directions toward the body in the editor's frame. */
export interface ClientSky {
	/** The light's 18 colours, r, g, b each (`LightAt.colors`). */
	colors: Float32Array
	/** Where the sky stops (LightIntBand rows 2 to 6), the fog colour and the sun's colour start in `colors`. */
	skyAt: number
	fogAt: number
	sunAt: number
	/** The dawn and dusk warp's strength (0 for none). */
	warp: number
	sunDir: readonly number[]
	moonDir: readonly number[]
	sunScale: number
	starAlpha: number
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
	// Sky light is a few times weaker than the sun, so a shadow reads as one.
	daySky: new THREE.Color(0.4, 0.46, 0.56),
	duskSky: new THREE.Color(0.32, 0.27, 0.34),
	nightSky: new THREE.Color(0.012, 0.018, 0.038),
	dayGround: new THREE.Color(0.22, 0.2, 0.17),
	nightGround: new THREE.Color(0.004, 0.005, 0.009),
	sunNoon: new THREE.Color(1.0, 0.96, 0.88),
	sunLow: new THREE.Color(1.0, 0.5, 0.24),
	moon: new THREE.Color(0.42, 0.52, 0.85),
	horizonDay: new THREE.Color('#c4d6e8'),
	horizonDusk: new THREE.Color('#d9906a'),
	horizonNight: new THREE.Color('#0b1020'),
}

/** One shadow cascade: a directional light's shadow camera and where it was last fitted. */
interface Cascade {
	light: THREE.DirectionalLight
	extent: number
	/** The snapped centre and light direction of the last fit, to tell when the map must be redrawn. */
	center: THREE.Vector3
	dir: THREE.Vector3
}

/** How far above or below the focus the shadow camera's depth range reaches: mountains and towers. */
const HEIGHT_SLACK = 1000

/** `Environment.updateShadow`'s bits: the near cascade's fit changed, the far one's did. */
export const SHADOW_NEAR = 1
export const SHADOW_FAR = 2

/**
 * A fit is kept while the key light has turned less than this (cos 0.1°), so the day cycle's slowly
 * moving sun doesn't redraw both shadow maps every frame (#324).
 */
const DIR_COS = Math.cos(THREE.MathUtils.degToRad(0.1))

/** The far cascade's hysteresis (#324): its fit stays until the wanted centre or size drifts this share of its half-size. */
const FAR_HOLD = 0.25

export class Environment {
	readonly sky: THREE.Mesh
	readonly hemi: THREE.HemisphereLight
	/** The key light (sun by day, moon by night). Its own shadow map is the near cascade. */
	readonly key: THREE.DirectionalLight
	/** A black light that only carries the far cascade's shadow map (see `shadowCascades.ts`). */
	readonly far: THREE.DirectionalLight
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
	private clientMaterial: THREE.ShaderMaterial | null = null
	private cascades: Cascade[]

	constructor(scene: THREE.Scene) {
		this.material = buildSkyMaterial()
		this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material)
		this.sky.scale.setScalar(1000)
		this.sky.frustumCulled = false
		this.sky.renderOrder = -1
		this.sky.name = 'sky'
		this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, Math.PI)
		this.key = new THREE.DirectionalLight(0xffffff, Math.PI)
		this.far = new THREE.DirectionalLight(0x000000, 0)
		// Each map is redrawn only when its fit or what it shows changes (Engine.markShadows, #326).
		this.key.shadow.autoUpdate = false
		this.far.shadow.autoUpdate = false
		this.key.shadow.radius = 1.5
		this.far.shadow.radius = 1
		this.cascades = [this.key, this.far].map((light) => ({ light, extent: 0, center: new THREE.Vector3(), dir: new THREE.Vector3() }))
		// The key light must stay the first directional light: shader cascade 0 is light 0.
		scene.add(this.sky, this.hemi, this.key, this.key.target, this.far, this.far.target)
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

	/**
	 * Draws the client's sky dome from `c` instead of the editor's own sky (null puts the editor's back).
	 * Called every frame while client lighting is on; it only sets uniforms.
	 */
	setClientSky(c: ClientSky | null, time: number) {
		if (!c) {
			if (this.sky.material !== this.material) this.sky.material = this.material
			return
		}
		const m = (this.clientMaterial ??= buildClientSkyMaterial())
		if (this.sky.material !== m) this.sky.material = m
		const u = m.uniforms
		const col = c.colors
		for (let i = 0; i < 5; i++) (u[SKY_UNIFORMS[i]].value as THREE.Vector3).set(col[c.skyAt + i * 3], col[c.skyAt + i * 3 + 1], col[c.skyAt + i * 3 + 2])
		;(u.fogColor.value as THREE.Vector3).set(col[c.fogAt], col[c.fogAt + 1], col[c.fogAt + 2])
		;(u.sunColor.value as THREE.Vector3).set(col[c.sunAt], col[c.sunAt + 1], col[c.sunAt + 2])
		;(u.sunDirection.value as THREE.Vector3).set(c.sunDir[0], c.sunDir[1], c.sunDir[2])
		;(u.moonDirection.value as THREE.Vector3).set(c.moonDir[0], c.moonDir[1], c.moonDir[2])
		;(u.warp.value as THREE.Vector2).set(c.warp, Math.atan2(c.sunDir[2], c.sunDir[0]))
		u.sunScale.value = c.sunScale
		u.starAlpha.value = c.starAlpha
		u.starTime.value = time
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

	/**
	 * Fits the two shadow cascades: the near one (half-size `nearExtent`) around `nearCenter`, the far
	 * one (half-size `farExtent`) around `farCenter`, each snapped to its own texels. Returns which fits
	 * changed, so their maps are redrawn: SHADOW_NEAR and SHADOW_FAR as bits.
	 */
	updateShadow(nearCenter: THREE.Vector3, nearExtent: number, farCenter: THREE.Vector3, farExtent: number): number {
		const near = this.fitCascade(this.cascades[0], nearCenter, nearExtent)
		// The far fit is held while the view turns or drifts a little (#324): its map is redrawn only
		// once the wanted box has moved a quarter of its width, so a turning camera stops paying a
		// second full shadow pass every frame.
		const far = !this.holdsFar(farCenter, farExtent, nearCenter, nearExtent) && this.fitCascade(this.cascades[1], farCenter, farExtent)
		return (near ? SHADOW_NEAR : 0) | (far ? SHADOW_FAR : 0)
	}

	/**
	 * Whether the far cascade's current fit can stay for a wanted fit around `center` with half-size
	 * `extent`: the same light direction (within `DIR_COS`), the size within FAR_HOLD of the wanted
	 * one, the centre within FAR_HOLD of the size from the wanted one, and the near box (which blends
	 * into the far map at its edge) still inside the held far box.
	 */
	private holdsFar(center: THREE.Vector3, extent: number, nearCenter: THREE.Vector3, nearExtent: number): boolean {
		const c = this.cascades[1]
		if (c.extent <= 0 || c.dir.dot(this.state.keyDir) < DIR_COS) return false
		if (Math.abs(extent - c.extent) > c.extent * FAR_HOLD) return false
		if (center.distanceTo(c.center) > c.extent * FAR_HOLD) return false
		// The near box in the far map's plane: its centre's offset along the far camera's axes, plus
		// its half-size, must stay inside the far box with a margin for the blend.
		const fwd = this.tmpV1.copy(c.dir).negate()
		const right = this.tmpV2.crossVectors(fwd, Math.abs(fwd.y) > 0.99 ? this.ax : this.up).normalize()
		const up = this.tmpV3.crossVectors(right, fwd)
		const d = this.tmpV4.subVectors(nearCenter, c.center)
		return Math.max(Math.abs(d.dot(right)), Math.abs(d.dot(up))) + nearExtent <= c.extent * 0.9
	}

	/**
	 * Points the key light along `state.keyDir` at `center` when it casts no shadow (the shadow fit
	 * places it otherwise), so props are lit from the sun's side at every hour.
	 */
	aimKey(center: THREE.Vector3) {
		this.key.target.position.copy(center)
		this.key.position.copy(center).add(this.state.keyDir)
		this.key.target.updateMatrixWorld()
	}

	/** Fits one cascade's orthographic shadow camera; true when its centre, size or direction moved. */
	private fitCascade(c: Cascade, center: THREE.Vector3, extent: number): boolean {
		const { light } = c
		const cam = light.shadow.camera
		const mapSize = light.shadow.mapSize.x
		let changed = false
		if (Math.abs(extent - c.extent) > extent * 0.05) {
			c.extent = extent
			cam.left = cam.bottom = -extent
			cam.right = cam.top = extent
			// The depth range must hold the ground across the box under a low sun (its depth then spans
			// about the box's width) plus whatever stands far above or below the focus.
			const reach = extent * 2 + HEIGHT_SLACK
			cam.near = 1
			cam.far = reach * 2
			cam.updateProjectionMatrix()
			// Biases in world units, scaled by the texel: a small offset along the normal against acne and a
			// tiny constant one, so contact shadows stay put and thin walls still throw a shadow.
			const texel = (2 * extent) / mapSize
			light.shadow.normalBias = texel * 1.5
			light.shadow.bias = (-texel * 0.25) / (cam.far - cam.near)
			changed = true
		}
		// Snap the centre to whole shadow texels to stop shimmering as the camera moves. A light that has
		// turned less than DIR_COS keeps its fitted direction and so its texel grid (#324): the snapped
		// centre then stays put under the day cycle's slowly moving sun, and the map isn't redrawn. The
		// shadow matrix follows the direction only when the map is redrawn (three updates it then), so
		// the drawn map and its lookup always agree.
		const texel = (2 * c.extent) / mapSize
		const turned = c.dir.dot(this.state.keyDir) < DIR_COS
		const dir = turned ? this.state.keyDir : c.dir
		const fwd = this.tmpV1.copy(dir).negate()
		const right = this.tmpV2.crossVectors(fwd, Math.abs(fwd.y) > 0.99 ? this.ax : this.up).normalize()
		const up = this.tmpV3.crossVectors(right, fwd)
		const r = Math.round(center.dot(right) / texel) * texel - center.dot(right)
		const u = Math.round(center.dot(up) / texel) * texel - center.dot(up)
		const snapped = this.tmpV4.copy(center).addScaledVector(right, r).addScaledVector(up, u)
		if (turned || !snapped.equals(c.center)) {
			c.center.copy(snapped)
			c.dir.copy(dir)
			changed = true
		}
		// The key light's position also lights the scene, so it follows the live direction.
		light.target.position.copy(snapped)
		light.position.copy(snapped).addScaledVector(this.state.keyDir, c.extent * 2 + HEIGHT_SLACK)
		light.target.updateMatrixWorld()
		return changed
	}
	private up = new THREE.Vector3(0, 1, 0)
	private ax = new THREE.Vector3(1, 0, 0)
	private tmpV1 = new THREE.Vector3()
	private tmpV2 = new THREE.Vector3()
	private tmpV3 = new THREE.Vector3()
	private tmpV4 = new THREE.Vector3()

	/** Shadow-casting key light on/off with the given map sizes. */
	setShadows(mode: 'off' | 'medium' | 'high') {
		const on = mode !== 'off'
		const sizes: [number, number] = mode === 'high' ? [4096, 2048] : [2048, 2048]
		this.cascades.forEach((c, i) => {
			const { light } = c
			light.castShadow = on
			if (light.shadow.mapSize.x !== sizes[i]) {
				light.shadow.mapSize.set(sizes[i], sizes[i])
				light.shadow.map?.dispose()
				light.shadow.map = null
				c.extent = 0 // refit: the biases depend on the texel size
			}
		})
		if (on) {
			this.key.shadow.needsUpdate = true
			this.far.shadow.needsUpdate = true
		}
	}

	dispose() {
		this.material.dispose()
		this.clientMaterial?.dispose()
		this.sky.geometry.dispose()
		for (const c of this.cascades) c.light.shadow.map?.dispose()
	}
}
