import * as THREE from 'three'
import type { ModelAsset } from '../models/assets'
import { frameDue } from '../engine/frameLimit'
import { prefs } from '../state/editor.svelte'
import { uiZoom } from './uiScale'

// The renderer of the small model views beside the map (#589): the asset browser's preview
// (AssetPreview) and the creature, object and item editors' and the Preview window's
// (CreaturePreview). Each has a WebGL context of its own, so the main scene is untouched. Its frames
// run only while something moves: the view's `step` says whether its model spins, animates or has
// particles, and the loop stops when it doesn't; a drag, a wheel, a resize, a restored context or a
// shown page wakes it again. Graphics › FPS limit caps it as it caps the viewport.

/** Radians a second a spinning model turns (0.004 a frame at 60 Hz, as the previews turned before). */
export const PREVIEW_SPIN = 0.24

export interface PreviewOptions {
	/** The vertical field of view, in degrees. */
	fov: number
	yaw: number
	pitch: number
	distance: number
	/** The lowest pitch a drag reaches (the highest is 1.4). */
	minPitch: number
	/** Yaw per pixel dragged to the right: the asset preview turns the camera one way, CreaturePreview the other. */
	turn: number
	/** The wheel's event goes no further (a dialog's own scroll would take it). */
	ownWheel?: boolean
	/**
	 * Readies the frame at `now` (rAF's ms), `dt` seconds after the last drawn one (0 on the first
	 * after a pause): moves the model and calls `place`. Returns whether something still moves, so
	 * another frame follows, or null for nothing to draw yet (the frame is skipped and the loop stops).
	 */
	step: (now: number, dt: number) => boolean | null
	/** A drag starts (true) or ends (false). */
	ondrag?: (dragging: boolean) => void
}

export class PreviewRenderer {
	readonly scene = new THREE.Scene()
	readonly camera: THREE.PerspectiveCamera
	yaw: number
	pitch: number
	distance: number
	readonly target = new THREE.Vector3()
	/** The lowest and highest `target.y` a pan reaches (#662): the view's model's bounds, set with the target. */
	panMin = -Infinity
	panMax = Infinity
	renderer: THREE.WebGLRenderer | null = null
	/** Frames drawn, for the probes. */
	frames = 0
	private canvas: HTMLCanvasElement | null = null
	private raf = 0
	/** When the last frame was drawn (rAF's ms). */
	private last = -Infinity
	/** The loop stopped after the last frame drawn, so the next one's dt is 0. */
	private idle = true
	/** The context is lost (a driver reset, #213): the loop waits for three to restore it. */
	private contextLost = false
	private listeners: AbortController | null = null
	private resizeObs: ResizeObserver | null = null
	/** A left drag turns the camera round the target; a right or middle drag (`pan`) moves the target up and down (#662). */
	private drag: { x: number; y: number; pan: boolean } | null = null

	constructor(private readonly opts: PreviewOptions) {
		this.camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.05, 2000)
		this.yaw = opts.yaw
		this.pitch = opts.pitch
		this.distance = opts.distance
		this.scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.65, 0.75), new THREE.Color(0.28, 0.25, 0.22), Math.PI))
		const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.96, 0.88), Math.PI * 0.9)
		sun.position.set(4, 7, 3)
		this.scene.add(sun)
	}

	/** Makes the renderer on `canvas` and draws a first frame. `hq` renders at the screen's full pixel ratio (the Preview window), not the capped one. */
	attach(canvas: HTMLCanvasElement, hq = false) {
		this.canvas = canvas
		const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
		// Times the interface size (#372), so the zoomed canvas stays sharp.
		r.setPixelRatio((hq ? window.devicePixelRatio : Math.min(window.devicePixelRatio, 1.5)) * uiZoom())
		r.outputColorSpace = THREE.SRGBColorSpace
		this.renderer = r
		const signal = (this.listeners = new AbortController()).signal
		// three rebuilds its state and uploads the geometry and textures again on a restore by itself
		// (it cancels the loss event's default for that), and these views keep no shadow maps or other
		// drawn-once targets, so the loop need only wait. A closed view's released context (dispose) is
		// never restored, since nothing calls restoreContext on it.
		canvas.addEventListener('webglcontextlost', () => (this.contextLost = true), { signal })
		canvas.addEventListener(
			'webglcontextrestored',
			() => {
				this.contextLost = false
				this.wake()
			},
			{ signal },
		)
		document.addEventListener('visibilitychange', () => this.wake(), { signal })
		// A resized panel draws the still model again at its new size.
		this.resizeObs = new ResizeObserver(() => this.wake())
		this.resizeObs.observe(canvas)
		this.wake()
	}

	/** Draws a frame soon, and more while `step` says something moves. */
	wake() {
		if (this.raf || !this.renderer) return
		this.raf = requestAnimationFrame(this.tick)
	}

	private tick = (now: number) => {
		this.raf = 0
		if (this.frame(now)) this.raf = requestAnimationFrame(this.tick)
		else this.idle = true
	}

	/** Draws the frame at `now` when one is due; returns whether the loop goes on. */
	private frame(now: number): boolean {
		const r = this.renderer
		const c = this.canvas
		if (!r || !c || this.contextLost || document.hidden) return false
		// Graphics › FPS limit (#24): a frame waits for its interval.
		if (!frameDue(now, this.last, prefs.fpsLimit ?? 0)) return true
		const w = c.clientWidth
		const h = c.clientHeight
		// Hidden (a texture shown instead) or not laid out yet: the resize observer wakes it.
		if (!w || !h) return false
		// three sizes the buffer to the CSS size times the pixel ratio; comparing with the CSS size alone resized it every frame.
		const pr = r.getPixelRatio()
		if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) {
			r.setSize(w, h, false)
			this.camera.aspect = w / h
			this.camera.updateProjectionMatrix()
		}
		const dt = this.idle ? 0 : Math.min(0.1, (now - this.last) / 1000)
		this.last = now
		this.idle = false
		const moving = this.opts.step(now, dt)
		if (moving === null) return false
		r.render(this.scene, this.camera)
		this.frames++
		return moving
	}

	/** Puts the camera on its orbit round `target` and points it there. */
	place() {
		const cp = Math.cos(this.pitch)
		const t = this.target
		this.camera.position.set(t.x + Math.sin(this.yaw) * cp * this.distance, t.y + Math.sin(this.pitch) * this.distance, t.z + Math.cos(this.yaw) * cp * this.distance)
		this.camera.lookAt(t)
	}

	get dragging(): boolean {
		return this.drag !== null
	}

	/** Sets the target's pan range to `min`..`max` (a model's lowest and highest y) and puts the target back into it. */
	setPanRange(min: number, max: number) {
		this.panMin = min
		this.panMax = max
		this.target.y = Math.min(max, Math.max(min, this.target.y))
	}

	// Dragging turns the model, a right or middle drag moves the view up and down it, the wheel zooms. Bound to the view's element.
	down = (e: PointerEvent) => {
		if (this.drag || e.button > 2) return
		this.drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 }
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		this.opts.ondrag?.(true)
		this.wake()
	}
	move = (e: PointerEvent) => {
		if (!this.drag) return
		if (this.drag.pan) {
			// The model follows the pointer: a pixel is the view's height at the target's distance over the canvas's height, the same zoomed in or out.
			const h = this.canvas?.clientHeight || 1
			const perPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h
			this.target.y = Math.min(this.panMax, Math.max(this.panMin, this.target.y + (e.clientY - this.drag.y) * perPixel))
		} else {
			this.yaw += (e.clientX - this.drag.x) * 0.01 * this.opts.turn
			this.pitch = Math.min(1.4, Math.max(this.opts.minPitch, this.pitch + (e.clientY - this.drag.y) * 0.01))
		}
		this.drag.x = e.clientX
		this.drag.y = e.clientY
		this.wake()
	}
	up = () => {
		if (!this.drag) return
		this.drag = null
		this.opts.ondrag?.(false)
		this.wake()
	}
	/** The right drag pans, so the view has no context menu. */
	contextmenu = (e: MouseEvent) => e.preventDefault()
	wheel = (e: WheelEvent) => {
		if (this.opts.ownWheel) {
			e.preventDefault()
			e.stopPropagation()
		}
		this.distance *= e.deltaY > 0 ? 1.1 : 0.9
		this.wake()
	}

	/** Stops the loop and releases the context; the caller lets go of its models first. */
	dispose() {
		cancelAnimationFrame(this.raf)
		this.raf = 0
		this.listeners?.abort()
		this.resizeObs?.disconnect()
		// dispose() keeps the WebGL context alive until garbage collection, and the browser drops the
		// oldest context (the viewport's) past about 16 (#201): release this one now.
		this.renderer?.forceContextLoss()
		this.renderer?.dispose()
		this.renderer = null
		this.canvas = null
	}
}

/** Whether a model's textures or colours move by themselves (a waterfall, a flickering glow), which the Engine's loop animates on the shared materials. */
export function materialsMove(a: ModelAsset): boolean {
	const list = Array.isArray(a.material) ? a.material : [a.material]
	return list.some((m) => m.userData.own === true)
}
