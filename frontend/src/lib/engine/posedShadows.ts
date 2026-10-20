import * as THREE from 'three'
import { POSED_LAYER, setNearStill } from '../world/shadowReach'

type ShadowRender = (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => void

const noClear = () => {}

/**
 * Redraws only the posed models into the near cascade's map on a frame where nothing else in it
 * changed (#346). Without it one animated model in the near box redrew the whole map every frame.
 *
 * The Engine says which kind of frame it is: a full redraw sets the key light's `needsUpdate`
 * (`Engine.markShadows`), and a frame whose only change is a pose sets `poses`. The first such frame
 * after a full redraw draws the map with the still casters only (`setNearStill`: a skinned batch then
 * keeps out of the near pass, though it is still noted for `castsNear`) and copies its depth into
 * `still`; every one after copies `still` back. Each then draws the skinned batches on top: three's
 * shadow pass again, through a camera that sees only `POSED_LAYER` (which `cullForShadows` puts the
 * skinned batches on as well), with the clear skipped, so the depth materials, alpha tests and skinning
 * are three's own. That pass is drawn from where the still one was (the light's matrices then): the key
 * light follows the sun's live direction for the lighting, but the map and its lookup must agree.
 */
export class PosedShadows {
	/** Set by the Engine for a frame whose only change in the near map is a posed model. */
	poses = false
	/** Off draws every such frame in full, as before #346 (for an A/B). */
	enabled = true
	/** How many posed passes have been drawn (for the probes). */
	passes = 0
	/** The near map's depth with the still casters only, when `valid`. */
	private still: THREE.WebGLRenderTarget | null = null
	/** `still` holds the near map as last fitted; a full redraw clears it. */
	private valid = false
	private lightAt = new THREE.Matrix4()
	private targetAt = new THREE.Matrix4()
	private live = new THREE.Matrix4()
	private liveTarget = new THREE.Matrix4()
	private camera = new THREE.Camera()
	private one: THREE.Light[]

	constructor(
		private renderer: THREE.WebGLRenderer,
		private light: THREE.DirectionalLight,
	) {
		this.camera.layers.set(POSED_LAYER)
		this.one = [light]
		const sm = renderer.shadowMap
		const render: ShadowRender = sm.render.bind(sm)
		sm.render = (lights, scene, camera) => this.render(render, lights, scene, camera)
	}

	private render(render: ShadowRender, lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) {
		if (lights.indexOf(this.light) < 0) return render(lights, scene, camera)
		const shadow = this.light.shadow
		const poses = this.poses
		this.poses = false
		if (poses && !this.enabled) shadow.needsUpdate = true
		// A full redraw (the fit, the scene, the view or a preference changed) draws every caster.
		if (shadow.needsUpdate) this.valid = false
		if (shadow.needsUpdate || !poses) return render(lights, scene, camera)
		if (!this.valid) {
			// The first pose after a full redraw: the still casters alone, kept for the frames after.
			shadow.needsUpdate = true
			setNearStill(true)
			try {
				render(lights, scene, camera)
			} finally {
				setNearStill(false)
			}
			this.keep()
		} else {
			// The far map and the point lights as they ask; the near one is copied back.
			render(lights, scene, camera)
			this.copy(this.still!, shadow.map!)
		}
		this.drawPosed(render, scene)
	}

	/** Copies the near map, just drawn with the still casters, into `still`, with the light's matrices it was drawn from. */
	private keep() {
		const map = this.light.shadow.map!
		let s = this.still
		if (!s) {
			// The colour isn't read (the PCF lookup samples the depth texture), so one byte a texel.
			s = this.still = new THREE.WebGLRenderTarget(map.width, map.height, { format: THREE.RedFormat, depthBuffer: true, generateMipmaps: false })
			s.depthTexture = new THREE.DepthTexture(map.width, map.height, THREE.UnsignedIntType)
			s.depthTexture.format = THREE.DepthFormat
		} else if (s.width !== map.width || s.height !== map.height) s.setSize(map.width, map.height)
		// Sets it up again after a lost context, whose redraw of every shadow map cleared `valid`.
		this.renderer.initRenderTarget(s)
		this.copy(map, s)
		this.lightAt.copy(this.light.matrixWorld)
		this.targetAt.copy(this.light.target.matrixWorld)
		this.valid = true
	}

	/** Copies one map's depth into the other's (a framebuffer blit, on the GPU). */
	private copy(from: THREE.RenderTarget, to: THREE.RenderTarget) {
		this.renderer.state.buffers.depth.setMask(true)
		this.renderer.copyTextureToTexture(from.depthTexture!, to.depthTexture!)
	}

	/** Draws the skinned batches in the near box over the still casters, from where those were drawn. */
	private drawPosed(render: ShadowRender, scene: THREE.Scene) {
		const r = this.renderer
		const light = this.light
		const target = light.target
		this.live.copy(light.matrixWorld)
		this.liveTarget.copy(target.matrixWorld)
		light.matrixWorld.copy(this.lightAt)
		target.matrixWorld.copy(this.targetAt)
		const clear = r.clear
		r.clear = noClear
		light.shadow.needsUpdate = true
		try {
			render(this.one, scene, this.camera)
		} finally {
			r.clear = clear
			light.matrixWorld.copy(this.live)
			target.matrixWorld.copy(this.liveTarget)
		}
		this.passes++
	}

	dispose() {
		this.still?.depthTexture?.dispose()
		this.still?.dispose()
		this.still = null
		this.valid = false
	}
}
