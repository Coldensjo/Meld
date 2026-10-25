import * as THREE from 'three'
import type { LightAt } from '../wow/clientLight'
import { CloudKernel, COLS, domeMesh, type CloudFrame } from '../wow/clouds'
import { cloudGlowIsSun, cloudGlowTrack } from '../wow/dayNight'

/** The light's cloud density, float band 3. */
const CLOUD_DENSITY = 3
/** The light's cloud colour bands: the sun glow, the slope and the base. */
const CLOUD_BANDS = [10, 11, 12] as const
/** The dome's radius, inside the sky box (half 500 yd a side). */
const RADIUS = 450

const vertex = /* glsl */ `
attribute float alpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// The texels are the client's gamma bytes, blended premultiplied as the client blends them, and the
// dome's rings fade the rim. Drawn raw, as the client sky behind them is.
const fragment = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vAlpha;
  gl_FragColor = vec4(t.rgb * a, a);
}
`

/**
 * The client's clouds over its sky dome (B-179, wow/clouds.ts), drawn while the sky is the client's
 * (Lighting › Client Lighting) and Lighting › Clouds is on: right after the sky and before everything else, so
 * the ground covers them.
 */
export class CloudDome {
	readonly mesh: THREE.Mesh
	private kernel = new CloudKernel()
	private texture: THREE.DataTexture
	private primed = false
	private frame: CloudFrame = { sun: [1, 1, 1], slope: [0, 0, 0], base: [0, 0, 0], storm: 0, glowDir: [0, 1, 0], glowTrack: 1 }
	private sun = [1, 1, 1]
	private slope = [0, 0, 0]
	private base = [0, 0, 0]
	private bands = [this.sun, this.slope, this.base]

	constructor() {
		const d = domeMesh()
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
		g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2))
		g.setAttribute('alpha', new THREE.BufferAttribute(d.alphas, 1))
		g.setIndex(new THREE.BufferAttribute(d.indices, 1))
		this.texture = new THREE.DataTexture(this.kernel.rgba, COLS, COLS, THREE.RGBAFormat)
		this.texture.magFilter = THREE.LinearFilter
		this.texture.minFilter = THREE.LinearFilter
		this.texture.generateMipmaps = false
		this.texture.needsUpdate = true
		const material = new THREE.ShaderMaterial({
			uniforms: { map: { value: this.texture } },
			vertexShader: vertex,
			fragmentShader: fragment,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		this.mesh = new THREE.Mesh(g, material)
		this.mesh.name = 'clouds'
		this.mesh.frustumCulled = false
		// After the sky (-1), before the scene.
		this.mesh.renderOrder = -0.5
		this.mesh.scale.setScalar(RADIUS)
		this.mesh.visible = false
	}

	/**
	 * Per frame while the client's sky shows: advances the clouds by dt seconds under `light` at game
	 * `minute`, toward the sun or the moon (`sunDir`, `moonDir`, the client's visible bodies), around
	 * the camera at `eye`. `on` is Lighting › Clouds; `storm` the weather's storm blend (0 clear).
	 */
	update(dt: number, light: LightAt, minute: number, sunDir: ArrayLike<number>, moonDir: ArrayLike<number>, eye: THREE.Vector3, on: boolean, storm = 0) {
		this.mesh.visible = on
		if (!on) return
		this.mesh.position.copy(eye)
		const c = light.colors
		for (let i = 0; i < 3; i++) {
			const at = CLOUD_BANDS[i] * 3
			const b = this.bands[i]
			b[0] = c[at]
			b[1] = c[at + 1]
			b[2] = c[at + 2]
		}
		const f = this.frame
		f.sun = this.sun
		f.slope = this.slope
		f.base = this.base
		f.glowDir = cloudGlowIsSun(minute) ? sunDir : moonDir
		f.glowTrack = cloudGlowTrack(minute)
		f.storm = storm
		const density = light.floats[CLOUD_DENSITY]
		let changed: boolean
		if (!this.primed) {
			this.primed = true
			this.kernel.rebuild(density, f)
			changed = true
		} else changed = this.kernel.tick(dt, density, f)
		if (changed) this.texture.needsUpdate = true
	}

	/** Hides the clouds (the editor's own sky is showing). */
	hide() {
		this.mesh.visible = false
	}

	dispose() {
		this.mesh.geometry.dispose()
		;(this.mesh.material as THREE.Material).dispose()
		this.texture.dispose()
	}
}
