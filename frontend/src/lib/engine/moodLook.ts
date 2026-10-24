import * as THREE from 'three'
import type { Mood } from './moods'

// How the viewport wears a mood (3dgame #142, moods.ts): the mood's sky dome, its fog and its colour
// grade, as the client's mood.rs draws them. The scene is drawn into a half-float target (linear,
// unclamped light, as the client's HDR camera) and `MoodGrade` draws it to the canvas through the
// grade: white balance (temperature), the shadows, midtones and highlights' saturation, contrast,
// gamma, gain and lift, and the exposure, the formulas of Bevy's tonemapping_shared.wgsl, then a tone
// mapper. Bevy's TonyMcMapface needs its 3D LUT; Khronos PBR Neutral (Apache-2.0, as Bevy carries it)
// stands in, which keeps the blacks and the hues as Tony does. Before the grade the scene is bloomed
// as Bevy's `Bloom::NATURAL` blooms it (3dgame #178, `MoodBloom`), its intensity the mood's `bloom`.

// The fog: three's linear fog, and the client's exponential one when its far distance is negative.
// The editor sets `near` to the density and `far` to minus the distance the fog starts at, so it
// begins at what the camera looks at rather than at the camera, which stands back from it (the
// client's camera is the player's eyes). Patched before any material is compiled.
const FOG_LINEAR = 'float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );'
if (!THREE.ShaderChunk.fog_fragment.includes(FOG_LINEAR)) throw new Error('three changed fog_fragment: moodLook.ts cannot patch the fog')
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
	FOG_LINEAR,
	'float fogFactor = fogFar < 0.0 ? 1.0 - exp( - fogNear * max( vFogDepth + fogFar, 0.0 ) ) : smoothstep( fogNear, fogFar, vFogDepth );',
)

/** The client's sky dome (assets/shaders/sky.wgsl) in GLSL: gradient, stars, aurora, clouds, moon. Linear colours. */
const SKY_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
	vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
	gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec4 aurora;
uniform vec4 moonDir;
uniform vec4 moon;
uniform vec4 cloud;
uniform float stars;
uniform float time;
varying vec3 vWorld;

float hash3(vec3 p) {
	vec3 q = fract(p * vec3(0.1031, 0.1030, 0.0973));
	vec3 r = q + dot(q, q.yxz + 33.33);
	return fract((r.x + r.y) * r.z);
}

float noise3(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
			mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
		mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
			mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
		u.z);
}

float fbm(vec3 p) {
	float sum = 0.0;
	float amp = 0.5;
	vec3 q = p;
	for (int i = 0; i < 5; i++) {
		sum += amp * noise3(q);
		q = q * 2.03 + vec3(1.7, 9.2, 4.1);
		amp *= 0.5;
	}
	return sum;
}

void main() {
	vec3 dir = normalize(vWorld - cameraPosition);
	float t = time;
	float up = clamp(dir.y, -1.0, 1.0);
	float h = pow(clamp(up, 0.0, 1.0), 0.45);
	vec3 color = mix(horizon, zenith, h);

	if (stars > 0.0) {
		vec3 cell = floor(dir * 520.0);
		float star = hash3(cell);
		float twinkle = 0.6 + 0.4 * sin(t * (1.0 + star * 3.0) + star * 40.0);
		float lit = step(0.993, star) * smoothstep(0.02, 0.25, up);
		color += vec3(lit * twinkle * stars * (star - 0.993) * 400.0);
	}

	if (aurora.w > 0.0 && up > 0.0) {
		float az = atan(dir.z, dir.x);
		float glow = 0.0;
		for (int i = 0; i < 2; i++) {
			float k = float(i);
			float wave = fbm(vec3(az * 1.5 + k * 7.0 + t * 0.02, t * 0.03, k * 3.0));
			float edge = 0.22 + 0.4 * wave + k * 0.1;
			float d = up - edge;
			float shape = d > 0.0 ? exp(-d * d / 0.02) : exp(-d * d / 0.0008);
			float rays = 0.35 + 0.65 * noise3(vec3(az * 70.0 + t * 0.6, k * 5.0, t * 0.2));
			glow += shape * rays * (1.0 - 0.4 * k);
		}
		color += aurora.rgb * glow * aurora.w * smoothstep(0.0, 0.08, up);
	}

	if (cloud.w > 0.0 && up > 0.0) {
		vec2 p = dir.xz / max(up, 0.06) * 0.6 + vec2(t * 0.004, t * 0.004 * 0.4);
		float c = fbm(vec3(p, t * 0.01));
		float cover = smoothstep(1.0 - cloud.w, 1.0 - cloud.w + 0.35, c) * smoothstep(0.0, 0.2, up);
		color = mix(color, cloud.rgb, cover);
	}

	float m = dot(dir, normalize(moonDir.xyz));
	float disc = smoothstep(1.0 - moonDir.w, 1.0 - moonDir.w * 0.8, m);
	float halo = (pow(max(m, 0.0), 6.0) * 0.12 + pow(max(m, 0.0), 300.0)) * moon.w;
	color += moon.rgb * (disc * 2.0 + halo);

	color = mix(color, horizon, smoothstep(0.0, -0.08, up));
	gl_FragColor = vec4(color, 1.0);
}
`

/** A colour of the moods file (sRGB, 0 to 1) into `out` in three's linear working space. */
export function moodColour(c: readonly number[], out: THREE.Color, scale = 1): THREE.Color {
	return out.setRGB(c[0] * scale, c[1] * scale, c[2] * scale, THREE.SRGBColorSpace)
}

/** The mood's sky dome around the camera, drawn first and unlit, behind everything. */
export class MoodSky {
	readonly mesh: THREE.Mesh
	private material: THREE.ShaderMaterial
	private c = new THREE.Color()

	constructor() {
		this.material = new THREE.ShaderMaterial({
			name: 'MoodSky',
			uniforms: {
				zenith: { value: new THREE.Color() },
				horizon: { value: new THREE.Color() },
				aurora: { value: new THREE.Vector4() },
				moonDir: { value: new THREE.Vector4(0, 1, 0, 0.001) },
				moon: { value: new THREE.Vector4() },
				cloud: { value: new THREE.Vector4() },
				stars: { value: 0 },
				time: { value: 0 },
			},
			vertexShader: SKY_VERTEX,
			fragmentShader: SKY_FRAGMENT,
			side: THREE.BackSide,
			depthWrite: false,
			depthTest: false,
		})
		this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material)
		this.mesh.scale.setScalar(900)
		this.mesh.frustumCulled = false
		this.mesh.renderOrder = -1
		this.mesh.name = 'mood sky'
		this.mesh.visible = false
	}

	/** Puts mood `m` on the dome, its moon towards `dir`; `clouds` false clears its clouds (Lighting › Clouds). */
	update(m: Mood, dir: THREE.Vector3, time: number, camera: THREE.Camera, clouds: boolean) {
		const u = this.material.uniforms
		moodColour(m.zenith, u.zenith.value)
		moodColour(m.horizon, u.horizon.value)
		const v4 = (c: readonly number[], out: THREE.Vector4, w: number) => {
			moodColour(c, this.c)
			out.set(this.c.r, this.c.g, this.c.b, w)
		}
		v4(m.aurora, u.aurora.value, m.aurora[3])
		v4(m.moon, u.moon.value, m.moon[3])
		v4(m.cloud, u.cloud.value, clouds ? m.cloud[3] : 0)
		u.moonDir.value.set(dir.x, dir.y, dir.z, m.moon_size)
		u.stars.value = m.stars
		u.time.value = time
		this.mesh.position.copy(camera.position)
	}

	dispose() {
		this.material.dispose()
		this.mesh.geometry.dispose()
	}
}

const GRADE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Bevy's bloom (bevy_core_pipeline bloom/bloom.wgsl): the 3x3 tent of its upsampling, 0.004 of
// the height across whatever the mip, and the 13 taps of its downsampling, the first one with the
// Karis average that keeps a single bright pixel from flickering.
const TENT = /* glsl */ `
vec3 tent(sampler2D t, vec2 uv, vec2 step) {
	vec2 x = vec2(step.x, 0.0);
	vec2 y = vec2(0.0, step.y);
	vec3 s = texture2D(t, uv - x - y).rgb + texture2D(t, uv + x - y).rgb + texture2D(t, uv - x + y).rgb + texture2D(t, uv + x + y).rgb;
	s += 2.0 * (texture2D(t, uv - y).rgb + texture2D(t, uv - x).rgb + texture2D(t, uv + x).rgb + texture2D(t, uv + y).rgb);
	s += 4.0 * texture2D(t, uv).rgb;
	return s / 16.0;
}
`

const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
uniform bool first;
varying vec2 vUv;

vec3 at(float x, float y) {
	return texture2D(src, vUv + texel * vec2(x, y)).rgb;
}

float karis(vec3 c) {
	float luma = dot(pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)), vec3(0.2126, 0.7152, 0.0722)) / 4.0;
	return 1.0 / (1.0 + luma);
}

void main() {
	vec3 a = at(-2.0, 2.0), b = at(0.0, 2.0), c = at(2.0, 2.0);
	vec3 d = at(-2.0, 0.0), e = at(0.0, 0.0), f = at(2.0, 0.0);
	vec3 g = at(-2.0, -2.0), h = at(0.0, -2.0), i = at(2.0, -2.0);
	vec3 j = at(-1.0, 1.0), k = at(1.0, 1.0), l = at(-1.0, -1.0), m = at(1.0, -1.0);
	vec3 o;
	if (first) {
		vec3 g0 = (a + b + d + e) * (0.125 / 4.0);
		vec3 g1 = (b + c + e + f) * (0.125 / 4.0);
		vec3 g2 = (d + e + g + h) * (0.125 / 4.0);
		vec3 g3 = (e + f + h + i) * (0.125 / 4.0);
		vec3 g4 = (j + k + l + m) * (0.5 / 4.0);
		o = g0 * karis(g0) + g1 * karis(g1) + g2 * karis(g2) + g3 * karis(g3) + g4 * karis(g4);
	} else {
		o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
	}
	gl_FragColor = vec4(max(o, vec3(0.0)), 1.0);
}
`

const UP_FRAGMENT = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
${TENT}
void main() {
	gl_FragColor = vec4(tent(src, vUv, texel), 1.0);
}
`

/** Bevy's `Bloom::NATURAL`: its low frequency boost and curvature, and its high pass frequency. */
const BOOST = 0.7
const BOOST_CURVE = 0.95
const HIGH_PASS = 1

/** The height of the bloom's first mip and how many mips (Bevy: max_mip_dimension 512, log2(512) - 1). */
const MIP_HEIGHT = 512
const MIPS = 8

/** Bevy's compute_blend_factor, energy-conserving: how much of mip `mip` of `last` goes into the one above it. */
function blendFactor(intensity: number, mip: number, last: number): number {
	let boost = (1 - Math.pow(1 - mip / last, 1 / (1 - BOOST_CURVE))) * BOOST
	boost *= 1 - intensity
	const high = 1 - Math.min(Math.max((mip / last - HIGH_PASS) / HIGH_PASS, 0), 1)
	return (intensity + boost) * high
}

/**
 * Bevy's bloom: the scene drawn down a chain of half-float mips, the first MIP_HEIGHT high, then each
 * drawn back up into the one above it, blended by `blendFactor`. The grade mixes the first into the
 * scene by the intensity.
 */
class MoodBloom {
	private mips: THREE.WebGLRenderTarget[] = []
	private down: THREE.ShaderMaterial
	private up: THREE.ShaderMaterial
	private quad: THREE.Mesh
	private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	private width = 0
	private height = 0

	constructor() {
		for (let i = 0; i < MIPS; i++) {
			const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
			t.texture.generateMipmaps = false
			this.mips.push(t)
		}
		const pass = (name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
			new THREE.ShaderMaterial({ name, uniforms, vertexShader: GRADE_VERTEX, fragmentShader, depthTest: false, depthWrite: false })
		this.down = pass('MoodBloomDown', DOWN_FRAGMENT, { src: { value: null }, texel: { value: new THREE.Vector2() }, first: { value: false } })
		this.up = pass('MoodBloomUp', UP_FRAGMENT, { src: { value: null }, texel: { value: new THREE.Vector2() } })
		this.up.blending = THREE.CustomBlending
		this.up.blendSrc = THREE.ConstantColorFactor
		this.up.blendDst = THREE.OneMinusConstantColorFactor
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.down)
		this.quad.frustumCulled = false
	}

	/** The tent's step in uv: 0.004 of the height, the same across (Bevy's upsample). */
	static step(width: number, height: number, out: THREE.Vector2): THREE.Vector2 {
		return out.set((0.004 * height) / Math.max(width, 1), 0.004)
	}

	/** Blooms `scene` (`width` by `height`) into the first mip, at `intensity`; gives that mip's texture. */
	draw(renderer: THREE.WebGLRenderer, scene: THREE.Texture, width: number, height: number, intensity: number): THREE.Texture {
		const ratio = MIP_HEIGHT / Math.max(height, 1)
		const w = Math.max(1, Math.round(width * ratio))
		if (w !== this.width || this.height !== MIP_HEIGHT) {
			this.width = w
			this.height = MIP_HEIGHT
			this.mips.forEach((t, i) => t.setSize(Math.max(1, w >> i), Math.max(1, MIP_HEIGHT >> i)))
		}
		const autoClear = renderer.autoClear
		renderer.autoClear = false
		const d = this.down.uniforms
		this.quad.material = this.down
		for (let i = 0; i < MIPS; i++) {
			const src = i === 0 ? scene : this.mips[i - 1].texture
			const sw = i === 0 ? width : this.mips[i - 1].width
			const sh = i === 0 ? height : this.mips[i - 1].height
			d.src.value = src
			d.texel.value.set(1 / sw, 1 / sh)
			d.first.value = i === 0
			renderer.setRenderTarget(this.mips[i])
			renderer.render(this.quad, this.camera)
		}
		const u = this.up.uniforms
		this.quad.material = this.up
		for (let i = MIPS - 1; i > 0; i--) {
			const src = this.mips[i]
			u.src.value = src.texture
			MoodBloom.step(src.width, src.height, u.texel.value)
			this.up.blendColor.setScalar(blendFactor(intensity, i, MIPS - 1))
			renderer.setRenderTarget(this.mips[i - 1])
			renderer.render(this.quad, this.camera)
		}
		renderer.setRenderTarget(null)
		renderer.autoClear = autoClear
		return this.mips[0].texture
	}

	dispose() {
		for (const t of this.mips) t.dispose()
		this.down.dispose()
		this.up.dispose()
		this.quad.geometry.dispose()
	}
}

const GRADE_FRAGMENT = /* glsl */ `
uniform sampler2D scene;
uniform mat3 balance;
uniform float exposure;
uniform vec3 saturation;
uniform vec3 contrast;
uniform vec3 gamma;
uniform vec3 gain;
uniform vec3 lift;
uniform sampler2D bloomMap;
uniform float bloom;
uniform vec2 bloomTexel;
varying vec2 vUv;

${TENT}

vec3 powsafe(vec3 c, float p) {
	return pow(abs(c), vec3(p)) * sign(c);
}

// Khronos PBR Neutral.
vec3 neutral(vec3 c) {
	const float start = 0.8 - 0.04;
	const float desat = 0.15;
	float x = min(c.r, min(c.g, c.b));
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	c -= offset;
	float peak = max(c.r, max(c.g, c.b));
	if (peak < start) return c;
	float d = 1.0 - start;
	float np = 1.0 - d * d / (peak + d - start);
	c *= np / peak;
	float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
	return mix(c, vec3(np), g);
}

void main() {
	vec3 color = max(texture2D(scene, vUv).rgb, vec3(0.0));
	// Bevy's last bloom upsample: the first mip, tent filtered, mixed in energy-conserving.
	if (bloom > 0.0) color = mix(color, tent(bloomMap, vUv, bloomTexel), bloom);
	color = max(balance * color, vec3(0.0));
	// Bevy's sectional_color_grading, as it is (the midtones 0.2 to 0.7, crossfaded over 0.1).
	float level = (color.r + color.g + color.b) / 3.0;
	vec3 levels = vec3(0.0);
	if (level < 0.1) {
		levels.x = 1.0;
	} else if (level < 0.3) {
		levels.y = (level - 0.2) * 5.0 + 0.5;
		levels.z = 1.0 - levels.y;
	} else if (level < 0.6) {
		levels.y = 1.0;
	} else if (level < 0.8) {
		levels.z = (level - 0.7) * 5.0 + 0.5;
		levels.y = 1.0 - levels.z;
	} else {
		levels.z = 1.0;
	}
	float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = luma + dot(levels, saturation) * (color - luma);
	color = 0.5 + (color - 0.5) * dot(levels, contrast);
	color = powsafe(color * dot(levels, gain) + dot(levels, lift), 1.0 / dot(levels, gamma));
	color = max(color * exp2(exposure), vec3(0.0));
	gl_FragColor = vec4(neutral(color), 1.0);
	#include <colorspace_fragment>
}
`

// Bevy's white balance (bevy_render view/mod.rs): RGB to LMS (CAM16), scaled to the white point, and back. Row-major.
const RGB_TO_LMS = [
	[0.311692, 0.652085, 0.0362225],
	[0.0905138, 0.901341, 0.00814478],
	[0.00764433, 0.0486554, 0.9437],
]
const LMS_TO_RGB = [
	[4.06305, -2.93241, -0.130646],
	[-0.40791, 1.40437, 0.0035363],
	[-0.0118812, -0.0486532, 1.0605344],
]
const D65_XY = [0.31272, 0.32903]
const D65_LMS = [0.975538, 1.01648, 1.08475]

/** Bevy's white balance matrix for `temperature` (no tint) into `out`. */
function balanceMatrix(temperature: number, out: THREE.Matrix3): THREE.Matrix3 {
	const x = D65_XY[0] - temperature
	const y = D65_XY[1]
	const wp = [0.701634 + (-0.051461 + 0.452749 * x) / y, 1.15856 + (0.045854 - 0.296122 * x) / y, -0.904175 + (0.953127 - 0.955206 * x) / y]
	const m: number[][] = [[], [], []]
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++) {
			let s = 0
			for (let k = 0; k < 3; k++) s += LMS_TO_RGB[r][k] * (D65_LMS[k] / wp[k]) * RGB_TO_LMS[k][c]
			m[r][c] = s
		}
	return out.set(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2])
}

/** The half-float target the scene is drawn into and the pass that grades it onto the canvas. */
export class MoodGrade {
	private target: THREE.WebGLRenderTarget
	private material: THREE.ShaderMaterial
	private quad: THREE.Mesh
	private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	private size = new THREE.Vector2()
	private temperature = NaN
	private bloom = new MoodBloom()

	constructor(samples: number) {
		this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true })
		this.material = new THREE.ShaderMaterial({
			name: 'MoodGrade',
			uniforms: {
				scene: { value: this.target.texture },
				balance: { value: new THREE.Matrix3() },
				exposure: { value: 0 },
				saturation: { value: new THREE.Vector3(1, 1, 1) },
				contrast: { value: new THREE.Vector3(1, 1, 1) },
				gamma: { value: new THREE.Vector3(1, 1, 1) },
				gain: { value: new THREE.Vector3(1, 1, 1) },
				lift: { value: new THREE.Vector3() },
				bloomMap: { value: null },
				bloom: { value: 0 },
				bloomTexel: { value: new THREE.Vector2() },
			},
			vertexShader: GRADE_VERTEX,
			fragmentShader: GRADE_FRAGMENT,
			depthTest: false,
			depthWrite: false,
		})
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
		this.quad.frustumCulled = false
	}

	/** Puts mood `m`'s grade on the pass. */
	update(m: Mood) {
		const u = this.material.uniforms
		if (m.temperature !== this.temperature) {
			this.temperature = m.temperature
			balanceMatrix(m.temperature, u.balance.value)
		}
		u.exposure.value = m.exposure
		u.bloom.value = Math.max(0, m.bloom)
		const s = [m.shadows, m.midtones, m.highlights]
		;(['saturation', 'contrast', 'gamma', 'gain', 'lift'] as const).forEach((k, i) => u[k].value.set(s[0][i], s[1][i], s[2][i]))
	}

	/** Draws `scene` from `camera` into the target, the size of the canvas's drawing buffer. */
	drawScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
		renderer.getDrawingBufferSize(this.size)
		if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y)
		renderer.setRenderTarget(this.target)
		renderer.render(scene, camera)
		renderer.setRenderTarget(null)
	}

	/**
	 * Blooms what `drawScene` drew and grades it onto the canvas. `renderer.info.render` is put back to
	 * the scene's numbers after, so what reads it (the stats, the probes) still counts the scene, not
	 * these passes.
	 */
	present(renderer: THREE.WebGLRenderer) {
		const r = renderer.info.render
		const { calls, triangles, points, lines } = r
		const u = this.material.uniforms
		if (u.bloom.value > 0) {
			const { width, height } = this.target
			u.bloomMap.value = this.bloom.draw(renderer, this.target.texture, width, height, u.bloom.value)
			MoodBloom.step(width, height, u.bloomTexel.value)
		}
		renderer.render(this.quad, this.camera)
		r.calls = calls
		r.triangles = triangles
		r.points = points
		r.lines = lines
	}

	dispose() {
		this.target.dispose()
		this.bloom.dispose()
		this.material.dispose()
		this.quad.geometry.dispose()
	}
}
