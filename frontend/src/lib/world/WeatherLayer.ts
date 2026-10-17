import * as THREE from 'three'
import { loadTexture } from '../wow/api'
import { effectDensity, MAX_MIST, MAX_RAIN, MAX_SNOW, MIST_BOX, RAIN_BOX, SNOW_BOX, weatherCounts, type WeatherKind } from '../wow/weather'

// Lighting › Weather Preview (#185): the client's rain, snow and sandstorms around the camera, so an
// author sees how a zone with weather (its game_weather chances, the Zones dialog) looks in it. The
// laws are the client's as Benilla's weather/precip ports them (MIT/Apache; the counts in
// wow/weather.ts): the drops' fall and drift, the streak and flake sizes, and the mist puffs. Each
// drop is placed by its seed and the clock in the vertex shader and wrapped into its box around the
// eye, so nothing runs on the CPU per drop and nothing is built until a weather is first shown. The storm light is the other half: Engine blends each light's storm
// params over its clear ones (clientLight.ts `lightAt`) with Client Lighting on.

/** The drift heading's centre: the client's -1.57 rad in the WoW frame (toward -Y), which is +Z here. */
const DRIFT = new THREE.Vector2(0, 1)
/** The shader clock wraps here, so a drop's travel keeps its precision. */
const CLOCK_WRAP = 1000

// A drop's place: its seed in the box, moved by its velocity over the clock, wrapped into the box
// around the eye. `edge` fades it out near the box's faces, where it wraps.
const wrapChunk = /* glsl */ `
uniform vec3 eye;
uniform vec3 box;
uniform float clock;
vec3 wrapped(vec3 seed, vec3 vel, out float edge) {
	vec3 p = seed * box + vel * clock - eye;
	p = mod(p + box * 0.5, box) - box * 0.5;
	vec3 q = abs(p) / (box * 0.5);
	edge = 1.0 - smoothstep(0.8, 1.0, max(q.x, max(q.y, q.z)));
	return p;
}
`

// Rain: a streak triangle a drop, its base 0.1 yd across at the head and its tip 2 yd back along the
// fall, at a fixed size; fades out from 70 to 75 yd (the client's forced fog).
const rainVertex = /* glsl */ `
${wrapChunk}
uniform float density;
uniform vec2 drift;
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
	vec3 back = -normalize(vel);
	vec3 right = normalize(cross(back, normalize(eye - head)));
	vec3 pos = corner < 0.5 ? head - right * 0.05 : corner < 1.5 ? head + right * 0.05 : head + back * 2.0;
	vUv = corner < 0.5 ? vec2(0.0, 0.0) : corner < 1.5 ? vec2(1.0, 0.0) : vec2(0.5, 1.0);
	vFade = edge * (1.0 - smoothstep(70.0, 75.0, length(p)));
	gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`

// Mod2x, as the client draws rain: the texel's grey 0.5 leaves the scene as it is and the streak's
// lighter grey brightens it. The framebuffer holds gamma colours, so the texel goes back to its bytes.
const rainFragment = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vFade;
void main() {
	vec4 t = texture2D(map, vUv);
	if (t.a < 0.5 || vFade <= 0.0) discard;
	vec3 c = pow(t.rgb, vec3(1.0 / 2.2));
	gl_FragColor = vec4(mix(vec3(0.5), c, vFade), 1.0);
}
`

// Snow: a white point sprite a flake, unlit as the client's, 14 px at the eye shrinking to 1 px by
// 46 yd (snowpoint.bls), in pixels of an 800 px tall screen; falls 2 to 6.5 yd/s and drifts any way
// when calm.
const snowVertex = /* glsl */ `
${wrapChunk}
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
	float d = length(p);
	vFade = edge;
	gl_PointSize = max(1.0, 14.0 * clamp(1.0 - 0.02 * d, 0.0, 1.0) * pxScale);
	gl_Position = projectionMatrix * viewMatrix * vec4(eye + p, 1.0);
}
`

const snowFragment = /* glsl */ `
uniform sampler2D map;
varying float vFade;
void main() {
	vec4 t = texture2D(map, gl_PointCoord);
	float a = t.a * vFade;
	if (a <= 0.004) discard;
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
uniform sampler2D map;
uniform vec3 fogColor;
varying vec2 vUv;
varying float vFade;
void main() {
	float a = texture2D(map, vUv).a * vFade;
	if (a <= 0.004) discard;
	gl_FragColor = vec4(fogColor, a);
	#include <colorspace_fragment>
}
`

/** The client's weather textures. */
const TEX = { rain: 'Textures\\Weather\\RainDrop01.blp', snow: 'Textures\\Weather\\SnowFlake01.blp', mist: 'Textures\\Weather\\SnowMist01.blp' }

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

/** Shared uniforms of every part: the eye, the clock and the drift. */
interface PartUniforms {
	[name: string]: THREE.IUniform
	eye: { value: THREE.Vector3 }
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
	private eye = new THREE.Vector3()
	private rain: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null
	private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
	private mist: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null

	constructor() {
		this.group.name = 'weather'
		this.group.visible = false
	}

	private uniforms(box: readonly number[]): PartUniforms {
		return { eye: { value: this.eye }, box: { value: new THREE.Vector3().fromArray(box) }, clock: { value: 0 }, drift: { value: DRIFT } }
	}

	private texture(path: string, material: THREE.ShaderMaterial) {
		loadTexture(path)
			.then((t) => {
				material.uniforms.map.value = t
				material.visible = true
			})
			.catch(() => {})
	}

	private buildRain() {
		const g = new THREE.InstancedBufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
		g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, 1, 2]), 1))
		g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(MAX_RAIN), 4))
		const m = new THREE.ShaderMaterial({
			uniforms: { ...this.uniforms(RAIN_BOX), density: { value: 0 }, map: { value: null } },
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

	private buildSnow() {
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SNOW * 3), 3))
		g.setAttribute('seed', new THREE.BufferAttribute(seeds(MAX_SNOW), 4))
		const m = new THREE.ShaderMaterial({
			uniforms: { ...this.uniforms(SNOW_BOX), density: { value: 0 }, pxScale: { value: 1 }, map: { value: null } },
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
	 * Per frame: shows `kind` at `grade` around `eye` at `time` (seconds), the mist in `fog`'s colour;
	 * `viewHeight` is the drawing buffer's height in pixels. `show` false
	 * (the weather off, the top-down view, the camera in a building) hides it all and costs nothing.
	 */
	update(kind: WeatherKind, grade: number, eye: THREE.Vector3, time: number, fog: THREE.Color, viewHeight: number, show: boolean) {
		const density = effectDensity(grade)
		const counts = weatherCounts(kind, density)
		const on = show && (counts.drops > 0 || counts.mist > 0)
		this.group.visible = on
		if (!on) return
		this.eye.copy(eye)
		const clock = time % CLOCK_WRAP
		if (kind === 'rain') this.rain ??= this.buildRain()
		if (kind === 'snow') this.snow ??= this.buildSnow()
		if (counts.mist) this.mist ??= this.buildMist()
		if (this.rain) {
			this.rain.visible = kind === 'rain'
			this.rain.geometry.instanceCount = counts.drops
			const u = this.rain.material.uniforms
			u.clock.value = clock
			u.density.value = density
		}
		if (this.snow) {
			this.snow.visible = kind === 'snow'
			this.snow.geometry.setDrawRange(0, counts.drops)
			const u = this.snow.material.uniforms
			u.clock.value = clock
			u.density.value = density
			u.pxScale.value = viewHeight / 800
		}
		if (this.mist) {
			this.mist.visible = counts.mist > 0
			this.mist.geometry.instanceCount = counts.mist
			const u = this.mist.material.uniforms
			u.clock.value = clock
			u.radius.value = kind === 'sand' ? 15 : kind === 'snow' ? 9 : 5
			;(u.fogColor.value as THREE.Color).copy(fog)
		}
	}

	dispose() {
		for (const part of [this.rain, this.snow, this.mist]) {
			if (!part) continue
			part.geometry.dispose()
			part.material.dispose()
		}
	}
}
