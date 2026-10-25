import * as THREE from 'three'
import { loadTexture } from '../wow/api'
import { PROBE_ABOVE, roofChunk, WeatherRoof, type SplashGround } from './WeatherRoof'
import {
	effectDensity,
	MAX_MIST,
	MAX_RAIN,
	MAX_SETTLED,
	MAX_SNOW,
	MAX_SPLASH,
	MIST_BOX,
	RAIN_BOX,
	SETTLE_FIELD,
	SETTLE_LIFE,
	settleRate,
	SNOW_BOX,
	SPLASH_FIELD,
	SPLASH_LIFE,
	splashRate,
	streakTilt,
	weatherCounts,
	WeatherWind,
	type WeatherKind,
} from '../wow/weather'

// Lighting › Weather Preview (#185): the client's rain, snow and sandstorms around the camera, so an
// author sees how a zone with weather (its game_weather chances, the Zones dialog) looks in it. The
// laws are the client's as Benilla's weather/precip ports them (MIT/Apache; the counts in
// wow/weather.ts): the drops' fall and drift, the streak and flake sizes, and the mist puffs. Each
// drop is placed by its seed and the clock in the vertex shader and wrapped into its box around the
// eye, so nothing runs on the CPU per drop and nothing is built until a weather is first shown. The storm light is the other half: Engine blends each light's storm
// params over its clear ones (clientLight.ts `lightAt`) with Client Lighting on.
//
// #244 added the rest of the client's rain: the ground splashes (a field of their own around the eye,
// on the ground and roofs the Engine's probe finds, the only part placed on the CPU, a few dozen a
// frame), the wind (the camera's own motion leads the boxes and tips the streaks, wow/weather.ts
// `WeatherWind`), and the weather seen from a room through its doorways: `gate` clips every part to
// the portal flood's exterior windows, since the wrapped drops had no roof to land on and fell through
// the room (#315 gave them one; the gate still keeps the mist out, and what the roof misses).
//
// #316 gave snow the same: a flake that lands lies where it fell and fades over 0.25 s, on the same
// ground and cache as the splashes, in a field as wide as the snow's box.
//
// #315 gave the drops their roofs: `WeatherRoof` keeps the models' highest surface on the client's
// 1.04 yd cells round the eye, and rain and snow hide a drop under the roof of its cell, as the
// client's die where they land, so from outside a building its inside stays dry.

export type { SplashGround } from './WeatherRoof'

/** The drift heading's centre: the client's -1.57 rad in the WoW frame (toward -Y), which is +Z here. */
const DRIFT = new THREE.Vector2(0, 1)
/** The shader clock wraps here, so a drop's travel keeps its precision. */
const CLOCK_WRAP = 1000

// A drop's place: its seed in the box, moved by its velocity over the clock, wrapped into the box
// around the eye led by the wind, and returned from the eye. `edge` fades it out near the box's
// faces, where it wraps.
const wrapChunk = /* glsl */ `
uniform vec3 eye;
uniform vec3 lead;
uniform vec3 box;
uniform float clock;
vec3 wrapped(vec3 seed, vec3 vel, out float edge) {
	vec3 p = seed * box + vel * clock - eye - lead;
	p = mod(p + box * 0.5, box) - box * 0.5;
	vec3 q = abs(p) / (box * 0.5);
	edge = 1.0 - smoothstep(0.8, 1.0, max(q.x, max(q.y, q.z)));
	return p + lead;
}
`

// In a WMO room the weather shows only through the doorways onto the outside: the portal flood's
// exterior windows, as NDC rects (gateCount -1 outdoors, where nothing is clipped).
const MAX_GATE = 4
const gateChunk = /* glsl */ `
uniform int gateCount;
uniform vec4 gateRects[${MAX_GATE}];
uniform vec2 viewport;
bool gated() {
	if (gateCount < 0) return false;
	vec2 ndc = gl_FragCoord.xy / viewport * 2.0 - 1.0;
	for (int i = 0; i < ${MAX_GATE}; i++) {
		if (i >= gateCount) break;
		vec4 r = gateRects[i];
		if (ndc.x >= r.x && ndc.y >= r.y && ndc.x <= r.z && ndc.y <= r.w) return false;
	}
	return true;
}
`

// Rain: a streak triangle a drop, its base 0.1 yd across at the head and its tip 2 yd back along the
// fall, at a fixed size, the tip tipped into the wind by `tilt`; fades out from 70 to 75 yd (the
// client's forced fog). RainDrop01.blp holds the streak point up, its wide bright end at the bottom
// rows, so the head takes v = 1 and the tip v = 0, as Benilla's `push_streaks` maps it (#314).
const rainVertex = /* glsl */ `
${wrapChunk}
${roofChunk}
uniform float density;
uniform vec2 drift;
uniform mat3 tilt;
attribute float corner;
attribute vec4 seed;
varying vec2 vUv;
varying float vFade;
void main() {
	float r = seed.w;
	float vz = 28.0 + 4.0 * density + 2.0 * density * fract(r * 7.13);
	float speed = ((2.0 * r - 1.0) + 9.49) * density + 0.01;
	float spread = (0.20944 * density + 0.05236) * (fract(r * 13.7) * 2.0 - 1.0);
	float a = atan(drift.y, drift.x) + spread;
	vec3 vel = vec3(cos(a) * speed, -vz, sin(a) * speed);
	float edge;
	vec3 p = wrapped(seed.xyz, vel, edge);
	vec3 head = eye + p;
	// Under a roof the drop has landed on it: nothing is drawn.
	if (roofed(head)) {
		vUv = vec2(0.0);
		vFade = 0.0;
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec3 back = -normalize(vel);
	vec3 right = normalize(cross(back, normalize(eye - head)));
	vec3 pos = corner < 0.5 ? head - right * 0.05 : corner < 1.5 ? head + right * 0.05 : head + tilt * back * 2.0;
	vUv = corner < 0.5 ? vec2(0.0, 1.0) : corner < 1.5 ? vec2(1.0, 1.0) : vec2(0.5, 0.0);
	vFade = edge * (1.0 - smoothstep(70.0, 75.0, length(p)));
	gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`

// Mod2x, as the client draws rain: the texel's grey 0.5 leaves the scene as it is and the streak's
// lighter grey brightens it. The framebuffer holds gamma colours, so the texel goes back to its bytes.
const rainFragment = /* glsl */ `
${gateChunk}
uniform sampler2D map;
varying vec2 vUv;
varying float vFade;
void main() {
	vec4 t = texture2D(map, vUv);
	if (t.a < 0.5 || vFade <= 0.0 || gated()) discard;
	vec3 c = pow(t.rgb, vec3(1.0 / 2.2));
	gl_FragColor = vec4(mix(vec3(0.5), c, vFade), 1.0);
}
`

// Snow: a white point sprite a flake, unlit as the client's, 14 px at the eye shrinking to 1 px by
// 46 yd (snowpoint.bls), in pixels of an 800 px tall screen; falls 2 to 6.5 yd/s and drifts any way
// when calm.
const snowVertex = /* glsl */ `
${wrapChunk}
${roofChunk}
uniform float density;
uniform vec2 drift;
uniform float pxScale;
attribute vec4 seed;
varying float vFade;
void main() {
	float r = seed.w;
	float vz = 2.0 + 3.5 * density + density * fract(r * 7.13);
	float speed = ((fract(r * 3.31) - 0.5) + 5.985) * density + 0.015;
	float spread = (6.2831853 - 5.9341197 * density) * (fract(r * 13.7) - 0.5);
	float a = atan(drift.y, drift.x) + spread;
	vec3 vel = vec3(cos(a) * speed, -vz, sin(a) * speed);
	float edge;
	vec3 p = wrapped(seed.xyz, vel, edge);
	if (roofed(eye + p)) {
		vFade = 0.0;
		gl_PointSize = 0.0;
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	float d = length(p);
	vFade = edge;
	gl_PointSize = max(1.0, 14.0 * clamp(1.0 - 0.02 * d, 0.0, 1.0) * pxScale);
	gl_Position = projectionMatrix * viewMatrix * vec4(eye + p, 1.0);
}
`

// Settled flakes (#316): a falling flake's sprite and size law where it landed, its alpha 1 - age / 0.25
// (Benilla's `push_flakes`), fading out at the field's edges as the falling ones do at the box's.
// `ground` is where it landed and when, on the shader's clock.
const settleVertex = /* glsl */ `
uniform vec3 eye;
uniform vec3 lead;
uniform float clock;
uniform float pxScale;
attribute vec4 ground;
varying float vFade;
void main() {
	float age = mod(clock - ground.w, ${CLOCK_WRAP.toFixed(1)});
	vec3 p = ground.xyz - eye;
	vec2 q = abs(p.xz - lead.xz) / ${(SETTLE_FIELD / 2).toFixed(1)};
	vFade = (1.0 - smoothstep(0.8, 1.0, max(q.x, q.y))) * (1.0 - age / ${SETTLE_LIFE.toFixed(2)});
	if (age >= ${SETTLE_LIFE.toFixed(2)} || vFade <= 0.0) {
		vFade = 0.0;
		gl_PointSize = 0.0;
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	gl_PointSize = max(1.0, 14.0 * clamp(1.0 - 0.02 * length(p), 0.0, 1.0) * pxScale);
	gl_Position = projectionMatrix * viewMatrix * vec4(ground.xyz, 1.0);
}
`

const snowFragment = /* glsl */ `
${gateChunk}
uniform sampler2D map;
varying float vFade;
void main() {
	vec4 t = texture2D(map, gl_PointCoord);
	float a = t.a * vFade;
	if (a <= 0.004 || gated()) discard;
	gl_FragColor = vec4(t.rgb, a);
	#include <colorspace_fragment>
}
`

// Mist: 12 yd puffs in the fog's colour drifting through the eye's height, clear within 6 yd and
// whole past 18 (the client's mist companion).
const mistVertex = /* glsl */ `
${wrapChunk}
uniform vec2 drift;
uniform float radius;
attribute vec2 corner;
attribute vec4 seed;
varying vec2 vUv;
varying float vFade;
void main() {
	float r = seed.w;
	float a = atan(drift.y, drift.x) + (fract(r * 13.7) - 0.5) * 0.349;
	float speed = radius * (1.0 + (fract(r * 7.13) - 0.5) * 0.3);
	vec3 vel = vec3(cos(a) * speed, 0.333 + (r - 0.5) * 0.0333, sin(a) * speed);
	float edge;
	vec3 p = wrapped(seed.xyz, vel, edge);
	vec3 centre = eye + p;
	vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
	vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
	vec3 pos = centre + (right * corner.x + up * corner.y) * 6.0;
	vUv = corner * 0.5 + 0.5;
	vFade = edge * smoothstep(6.0, 18.0, length(pos - eye));
	gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`

const mistFragment = /* glsl */ `
${gateChunk}
uniform sampler2D map;
uniform vec3 fogColor;
varying vec2 vUv;
varying float vFade;
void main() {
	float a = texture2D(map, vUv).a * vFade;
	if (a <= 0.004 || gated()) discard;
	gl_FragColor = vec4(fogColor, a);
	#include <colorspace_fragment>
}
`

// Splashes: a camera-facing triangle each, 1/6 yd across and tall (the client's view right / 12 and
// view up / 6), stepping through its row of the 4 x 4 atlas over its 0.25 s, a row a splash from its
// place (Benilla's `push_patters`). `splash` is where it landed and when, on the shader's clock.
// Mod2x as the streaks.
const splashVertex = /* glsl */ `
uniform vec3 eye;
uniform float clock;
attribute float corner;
attribute vec4 splash;
varying vec2 vUv;
varying float vFade;
void main() {
	float age = mod(clock - splash.w, ${CLOCK_WRAP.toFixed(1)});
	if (age >= ${SPLASH_LIFE.toFixed(2)}) {
		vUv = vec2(0.0);
		vFade = 0.0;
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	float frame = min(floor(age * ${(4 / SPLASH_LIFE).toFixed(1)}), 3.0);
	float row = floor(fract(splash.w * 7.31 + splash.x * 0.37 + splash.z * 0.61) * 4.0);
	vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) / 12.0;
	vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]) / 6.0;
	vec3 pos = corner < 0.5 ? splash.xyz - right : corner < 1.5 ? splash.xyz + up : splash.xyz + right;
	vec2 uv = corner < 0.5 ? vec2(0.0, 0.25) : corner < 1.5 ? vec2(0.125, 0.043) : vec2(0.25, 0.25);
	vUv = uv + vec2(frame, row) * 0.25;
	vFade = 1.0 - smoothstep(70.0, 75.0, length(splash.xyz - eye));
	gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`

/** The client's weather textures. */
const TEX = {
	rain: 'Textures\\Weather\\RainDrop01.blp',
	splash: 'Textures\\Weather\\RainDropSplash01.blp',
	snow: 'Textures\\Weather\\SnowFlake01.blp',
	mist: 'Textures\\Weather\\SnowMist01.blp',
}

/** A settled flake sits this far over the ground: a point sprite takes its centre's depth, so the ground would clip its lower half. */
const SETTLE_LIFT = 0.05

/** Seeds in the box and a random fourth, the same every build. */
function seeds(n: number): Float32Array {
	const out = new Float32Array(n * 4)
	let x = 0x9e3779b9
	for (let i = 0; i < out.length; i++) {
		x ^= x << 13
		x ^= x >>> 17
		x ^= x << 5
		out[i] = (x >>> 8) / 16777216
	}
	return out
}

/**
 * A ring of slots on the ground (rain's splashes, snow's settled flakes): its attribute, the next slot
 * to fill, how many were ever filled since shown, and the fraction of one carried to the next frame.
 */
interface GroundRing {
	at: THREE.BufferAttribute
	next: number
	filled: number
	carry: number
}

/** Shared uniforms of every part: the eye, its lead, the clock, the drift and the room's gate. */
interface PartUniforms {
	[name: string]: THREE.IUniform
	eye: { value: THREE.Vector3 }
	lead: { value: THREE.Vector3 }
	box: { value: THREE.Vector3 }
	clock: { value: number }
	drift: { value: THREE.Vector2 }
}

/**
 * The weather preview's drops around the camera: a part a kind of drop, each one draw, built the first
 * time its weather shows and hidden (no cost) while it doesn't.
 */
export class WeatherLayer {
	readonly group = new THREE.Group()
	/** The camera's motion, which the weather blows past. */
	readonly wind = new WeatherWind()
	private eye = new THREE.Vector3()
	private rain: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null
	private splash: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null
	private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
	private settled: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
	private mist: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null
	// The room's gate, shared by every part's material.
	private gateCount = { value: -1 }
	private gateRects = { value: Array.from({ length: MAX_GATE }, () => new THREE.Vector4()) }
	private viewport = { value: new THREE.Vector2(1, 1) }
	private leadOut = { x: 0, z: 0 }
	private tiltAxis = new THREE.Vector3()
	private tiltM4 = new THREE.Matrix4()
	// The rings of splashes and settled flakes and the seed they land by.
	private splashRing: GroundRing | null = null
	private settleRing: GroundRing | null = null
	private splashSeed = 0x2545f491
	/** The models' heights on the ground grid round the eye: the drops' roofs and where the splashes land. */
	private roofGrid: WeatherRoof | null = null
	private lastTime = -1

	constructor() {
		this.group.name = 'weather'
		this.group.visible = false
	}

	private get roof(): WeatherRoof {
		return (this.roofGrid ??= new WeatherRoof())
	}

	private uniforms(box: readonly number[]): PartUniforms {
		return {
			eye: { value: this.eye },
			lead: { value: new THREE.Vector3() },
			box: { value: new THREE.Vector3().fromArray(box) },
			clock: { value: 0 },
			drift: { value: DRIFT },
			gateCount: this.gateCount,
			gateRects: this.gateRects,
			viewport: this.viewport,
		}
	}

	private texture(path: string, material: THREE.ShaderMaterial, mip0 = false) {
		loadTexture(path)
			.then((t) => {
				// The splash's thin arms collapse down the mip chain (Benilla loads its level 0 only).
				if (mip0) {
					t = t.clone()
					t.minFilter = THREE.LinearFilter
					t.generateMipmaps = false
					t.needsUpdate = true
				}
				material.uniforms.map.value = t
				material.visible = true
			})
			.catch((err) => console.warn('weather texture failed', path, err))
	}

	private buildRain() {
		const g = new THREE.InstancedBufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
		g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, 1, 2]), 1))
		g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(MAX_RAIN), 4))
		const m = new THREE.ShaderMaterial({
			uniforms: { ...this.uniforms(RAIN_BOX), density: { value: 0 }, tilt: { value: new THREE.Matrix3() }, roof: { value: this.roof.texture }, map: { value: null } },
			vertexShader: rainVertex,
			fragmentShader: rainFragment,
			blending: THREE.CustomBlending,
			blendSrc: THREE.DstColorFactor,
			blendDst: THREE.SrcColorFactor,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		m.visible = false
		this.texture(TEX.rain, m)
		const mesh = new THREE.Mesh(g, m)
		mesh.frustumCulled = false
		mesh.renderOrder = 10
		this.group.add(mesh)
		return mesh
	}

	private buildSplash() {
		const g = new THREE.InstancedBufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
		g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, 1, 2]), 1))
		const at = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLASH * 4), 4)
		at.setUsage(THREE.DynamicDrawUsage)
		g.setAttribute('splash', at)
		g.instanceCount = 0
		this.splashRing = { at, next: 0, filled: 0, carry: 0 }
		const m = new THREE.ShaderMaterial({
			uniforms: { eye: { value: this.eye }, clock: { value: 0 }, gateCount: this.gateCount, gateRects: this.gateRects, viewport: this.viewport, map: { value: null } },
			vertexShader: splashVertex,
			fragmentShader: rainFragment,
			blending: THREE.CustomBlending,
			blendSrc: THREE.DstColorFactor,
			blendDst: THREE.SrcColorFactor,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		m.visible = false
		this.texture(TEX.splash, m, true)
		const mesh = new THREE.Mesh(g, m)
		mesh.frustumCulled = false
		mesh.renderOrder = 10
		this.group.add(mesh)
		return mesh
	}

	private buildSnow() {
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SNOW * 3), 3))
		g.setAttribute('seed', new THREE.BufferAttribute(seeds(MAX_SNOW), 4))
		const m = new THREE.ShaderMaterial({
			uniforms: { ...this.uniforms(SNOW_BOX), density: { value: 0 }, pxScale: { value: 1 }, roof: { value: this.roof.texture }, map: { value: null } },
			vertexShader: snowVertex,
			fragmentShader: snowFragment,
			transparent: true,
			depthWrite: false,
		})
		m.visible = false
		this.texture(TEX.snow, m)
		const points = new THREE.Points(g, m)
		points.frustumCulled = false
		points.renderOrder = 10
		this.group.add(points)
		return points
	}

	private buildSettled() {
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SETTLED * 3), 3))
		const at = new THREE.BufferAttribute(new Float32Array(MAX_SETTLED * 4), 4)
		at.setUsage(THREE.DynamicDrawUsage)
		g.setAttribute('ground', at)
		g.setDrawRange(0, 0)
		this.settleRing = { at, next: 0, filled: 0, carry: 0 }
		const m = new THREE.ShaderMaterial({
			uniforms: { eye: { value: this.eye }, lead: { value: new THREE.Vector3() }, clock: { value: 0 }, pxScale: { value: 1 }, gateCount: this.gateCount, gateRects: this.gateRects, viewport: this.viewport, map: { value: null } },
			vertexShader: settleVertex,
			fragmentShader: snowFragment,
			transparent: true,
			depthWrite: false,
		})
		m.visible = false
		this.texture(TEX.snow, m)
		const points = new THREE.Points(g, m)
		points.frustumCulled = false
		points.renderOrder = 10
		this.group.add(points)
		return points
	}

	private buildMist() {
		const g = new THREE.InstancedBufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
		g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2))
		g.setIndex([0, 1, 2, 0, 2, 3])
		g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(MAX_MIST), 4))
		const m = new THREE.ShaderMaterial({
			uniforms: { ...this.uniforms(MIST_BOX), radius: { value: 5 }, fogColor: { value: new THREE.Color() }, map: { value: null } },
			vertexShader: mistVertex,
			fragmentShader: mistFragment,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		m.visible = false
		this.texture(TEX.mist, m)
		const mesh = new THREE.Mesh(g, m)
		mesh.frustumCulled = false
		mesh.renderOrder = 11
		this.group.add(mesh)
		return mesh
	}

	/**
	 * The room's gate for this frame: null outdoors (nothing clipped), or the portal flood's exterior
	 * windows (NDC x0 y0 x1 y1 each) with the camera in a room, where the weather shows only through
	 * them; none hides it. Past MAX_GATE windows the last rect takes in the rest.
	 */
	gate(windows: readonly number[] | null) {
		if (!windows) {
			this.gateCount.value = -1
			return
		}
		const n = Math.min(MAX_GATE, windows.length / 4)
		const rects = this.gateRects.value
		for (let i = 0; i < n; i++) rects[i].fromArray(windows, i * 4)
		for (let w = MAX_GATE * 4; w + 4 <= windows.length; w += 4) {
			const r = rects[MAX_GATE - 1]
			r.set(Math.min(r.x, windows[w]), Math.min(r.y, windows[w + 1]), Math.max(r.z, windows[w + 2]), Math.max(r.w, windows[w + 3]))
		}
		this.gateCount.value = n
	}

	/** Whether the weather is drawn at all this frame: false indoors with no doorway in view. */
	private get gateOpen(): boolean {
		return this.gateCount.value !== 0
	}

	private setLead(part: { material: THREE.ShaderMaterial } | null, width: number) {
		if (!part) return
		const l = this.wind.lead(width, this.leadOut)
		;(part.material.uniforms.lead.value as THREE.Vector3).set(l.x, 0, l.z)
	}

	/** A uniform random number in [0, 1), xorshift as `seeds`. */
	private random(): number {
		let x = this.splashSeed
		x ^= x << 13
		x ^= x >>> 17
		x ^= x << 5
		this.splashSeed = x
		return (x >>> 8) / 16777216
	}

	/**
	 * Where a drop at (`x`, `z`) lands: the higher of the terrain under it and the models' surface on
	 * its grid cell; a cell not probed yet takes the terrain alone until the roof's scan reaches it.
	 * -Infinity where neither is.
	 */
	private landing(x: number, z: number, ground: SplashGround): number {
		const t = ground.terrain(x, z)
		const m = this.roof.get(x, z)
		return m === undefined ? t : Math.max(t, m)
	}

	/**
	 * Lands this frame's share of `rate` a second in the `field` yd square around the led eye into
	 * `ring`, `lift` yd over the ground, born at `clock`, and returns how many slots are filled.
	 */
	private land(ring: GroundRing, rate: number, field: number, lift: number, clock: number, dt: number, ground: SplashGround): number {
		const from = this.eye.y + PROBE_ABOVE
		ring.carry += rate * Math.min(dt, 0.1)
		const max = ring.at.count
		const n = Math.min(Math.floor(ring.carry), max)
		ring.carry -= Math.floor(ring.carry)
		if (n === 0) return ring.filled
		const a = ring.at.array as Float32Array
		const l = this.wind.lead(field, this.leadOut)
		const ox = this.eye.x + l.x - field / 2
		const oz = this.eye.z + l.z - field / 2
		for (let i = 0; i < n; i++) {
			const x = ox + this.random() * field
			const z = oz + this.random() * field
			const y = this.landing(x, z, ground)
			// No ground under it (off the map, in a hole) or above the probes' start: nothing lands.
			if (y === -Infinity || y > from) continue
			const k = ring.next * 4
			a[k] = x
			a[k + 1] = y + lift
			a[k + 2] = z
			a[k + 3] = clock
			ring.next = (ring.next + 1) % max
			ring.filled = Math.min(max, ring.filled + 1)
		}
		ring.at.needsUpdate = true
		return ring.filled
	}

	/** Empties the splashes and settled flakes, so none left in a ring shows again when its clock comes round. */
	private clearGround(splash: boolean, settled: boolean) {
		if (splash && this.splashRing) {
			this.splashRing.filled = 0
			this.splash!.geometry.instanceCount = 0
		}
		if (settled && this.settleRing) {
			this.settleRing.filled = 0
			this.settled!.geometry.setDrawRange(0, 0)
		}
	}

	/**
	 * Per frame: shows `kind` at `grade` around `eye` at `time` (seconds), the mist in `fog`'s colour;
	 * `viewWidth` and `viewHeight` are the drawing buffer's size in pixels, `ground` where the drops
	 * land (their roofs, the splashes and the settled flakes). `show` false (the weather off, the top-down view) hides it all and costs nothing;
	 * so does a room's gate (`gate`) with no doorway in view.
	 */
	update(kind: WeatherKind, grade: number, eye: THREE.Vector3, time: number, fog: THREE.Color, viewWidth: number, viewHeight: number, ground: SplashGround, show: boolean) {
		const density = effectDensity(grade)
		const counts = weatherCounts(kind, density)
		const shown = show && (counts.drops > 0 || counts.mist > 0)
		let dt = 0
		if (shown) {
			dt = this.lastTime < 0 ? 0 : time - this.lastTime
			this.wind.update(eye.x, eye.z, dt)
			this.lastTime = time
		} else if (this.lastTime >= 0) {
			this.lastTime = -1
			this.wind.reset()
		}
		const on = shown && this.gateOpen
		this.group.visible = on
		if (!on) {
			this.clearGround(true, true)
			return
		}
		this.eye.copy(eye)
		this.viewport.value.set(viewWidth, viewHeight)
		const clock = time % CLOCK_WRAP
		if (kind === 'rain') {
			this.rain ??= this.buildRain()
			this.splash ??= this.buildSplash()
		}
		if (kind === 'snow') {
			this.snow ??= this.buildSnow()
			this.settled ??= this.buildSettled()
		}
		if (counts.mist) this.mist ??= this.buildMist()
		if (kind === 'rain' || kind === 'snow') this.roof.update(this.eye, ground)
		if (this.rain) {
			this.rain.visible = kind === 'rain'
			this.rain.geometry.instanceCount = counts.drops
			const u = this.rain.material.uniforms
			u.clock.value = clock
			u.density.value = density
			this.setLead(this.rain, RAIN_BOX[0])
			// The tail tips toward the motion: about the axis that carries up into the wind's heading.
			const speed = this.wind.speed
			const angle = streakTilt(speed)
			const m = u.tilt.value as THREE.Matrix3
			if (angle === 0) m.identity()
			else m.setFromMatrix4(this.tiltM4.makeRotationAxis(this.tiltAxis.set(this.wind.vz / speed, 0, -this.wind.vx / speed), angle))
		}
		if (this.splash) {
			this.splash.visible = kind === 'rain'
			if (kind === 'rain') {
				this.splash.material.uniforms.clock.value = clock
				this.splash.geometry.instanceCount = this.land(this.splashRing!, splashRate('rain', density), SPLASH_FIELD, 0.02, clock, dt, ground)
			} else this.clearGround(true, false)
		}
		if (this.snow) {
			this.snow.visible = kind === 'snow'
			this.snow.geometry.setDrawRange(0, counts.drops)
			const u = this.snow.material.uniforms
			u.clock.value = clock
			u.density.value = density
			u.pxScale.value = viewHeight / 800
			this.setLead(this.snow, SNOW_BOX[0])
		}
		if (this.settled) {
			this.settled.visible = kind === 'snow'
			if (kind === 'snow') {
				const u = this.settled.material.uniforms
				u.clock.value = clock
				u.pxScale.value = viewHeight / 800
				this.setLead(this.settled, SETTLE_FIELD)
				this.settled.geometry.setDrawRange(0, this.land(this.settleRing!, settleRate('snow', density), SETTLE_FIELD, SETTLE_LIFT, clock, dt, ground))
			} else this.clearGround(false, true)
		}
		if (this.mist) {
			this.mist.visible = counts.mist > 0
			this.mist.geometry.instanceCount = counts.mist
			const u = this.mist.material.uniforms
			u.clock.value = clock
			u.radius.value = kind === 'sand' ? 15 : kind === 'snow' ? 9 : 5
			;(u.fogColor.value as THREE.Color).copy(fog)
			this.setLead(this.mist, MIST_BOX[0])
		}
	}

	dispose() {
		for (const part of [this.rain, this.splash, this.snow, this.settled, this.mist]) {
			if (!part) continue
			part.geometry.dispose()
			part.material.dispose()
		}
		this.roofGrid?.dispose()
	}
}
