import * as THREE from 'three'
import { docs, editor, setStatus, publishViewportHint, stats, type Prefs, type ToolId, ui } from '../state/editor.svelte'
import { MapDocument, type Bookmark } from './MapDocument'
import { CameraController } from './CameraController'
import { Environment, SHADOW_FAR, SHADOW_NEAR } from './Environment'
import type { Tool, ToolContext } from '../tools/Tool'
import { CubeTool, pickUnder } from '../tools/CubeTool'
import { CubeSelectTool } from '../tools/CubeSelectTool'
import { antialiasAtStart } from './display'
import { frameDue } from './frameLimit'
import { PerfMeter, SECTION, type PerfReport } from './perfMeter'
import { GpuTimer } from './gpuTimer'
import { clampUiScale } from '../ui/uiScale'
import { CubeWorld, GROUND_LAYER, type SpawnPoint, type TextureHint } from '../cubes/world'
import { layerAtHeight } from '../cubes/layerMap'
import { pickCube, sliceShows } from '../cubes/pick'
import { CubeChanges } from '../cubes/edit'
import { replaceTexture } from '../cubes/textureIds'
import type { CubeClip } from '../cubes/clip'
import { CUBE_HEIGHT, CUBE_SIZE } from '../cubes/shapes'
import { THEMES, themeOf } from '../cubes/mesher'
import { setCubeGlow } from '../cubes/CubeLayer'
import { setCubeFiltering } from '../cubes/textures'
import { MoodGrade, moodColour } from './moodLook'
import { MoodLights } from './moodLights'
import { MOODS, cloneMood, dayMood, easeMood, namedMood, themeIsSurface, themeMood, type Mood } from './moods'
import { moodRegionAt } from '../cubes/moodRegions'

/** The moods file's [themes] key of each theme, by the index `themeOf` gives (mood.rs theme_key). */
const THEME_KEYS: readonly string[] = THEMES.map((t) => t.replace(' ', '_'))

/** How quickly the mood eases towards the one of the layer looked at, per second (mood.rs EASE_RATE). */
const MOOD_EASE = 2

/** The milliseconds a frame a cube world spends building its chunks' meshes while some are left. */
const CUBE_BUILD_MS = 6

/** The height the camera's ground stands at (`CameraController`'s ground, the walking camera's floor): the ground layer's top. */
const GROUND_TOP = CUBE_HEIGHT

/** The chunks a side of the world the editor opens with, and of the one a last closed tab leaves. */
const START_CHUNKS = 4

/** A cube world tab's size, for the tab strip. */
const worldLabel = (d: MapDocument) => `${d.world.chunksX}×${d.world.chunksZ} chunks`

/** How far above the ground the top-down view's camera stands: over the sky layers. */
const ORTHO_HEIGHT = 1500

/** The 3D camera's near plane (m). */
const NEAR = 0.5

/**
 * Owns the renderer, scene and render loop, and the open cube worlds (tabs). Svelte components talk to
 * it via methods; per-frame state never round-trips through Svelte reactivity.
 */
export class Engine {
	readonly renderer: THREE.WebGLRenderer
	readonly scene = new THREE.Scene()
	/** The 3D view's camera, which the controller drives. */
	private persp: THREE.PerspectiveCamera
	/** The top-down 2D view's camera (U), placed over the controller's target each frame (`updateTopDown`). */
	private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_HEIGHT + 1000)
	private topDown = false
	/** The camera the view is drawn and picked with: the perspective one, or the top-down one while that view is on. */
	get camera(): THREE.Camera {
		return this.topDown ? this.ortho : this.persp
	}
	readonly controller: CameraController
	readonly raycaster = new THREE.Raycaster()
	/** All open worlds (document tabs); `doc` is the one being edited. */
	readonly documents: MapDocument[] = []
	private doc!: MapDocument

	get history() {
		return this.doc.history
	}

	private env: Environment
	/** Current hour; advances on its own when the day cycle is on. */
	private hour = 13

	/** The hour the sky shows now, which the day cycle moves on without writing reactive state. */
	currentHour(): number {
		return this.hour
	}
	private prefs: Prefs | null = null
	private readonly cubeTool = new CubeTool()
	/** The Select tool (#70): boxes of cubes, their clipboard and moves. */
	private readonly cubeSelect = new CubeSelectTool()
	private activeToolId: ToolId | null = null
	private activeTool: Tool | null = null
	private ctx: ToolContext
	private ndc = new THREE.Vector2()
	private pointerInside = false
	private leftDown = false
	private hitVec = new THREE.Vector3()
	/** Where the ray under the cursor meets the cubes, or null. */
	private hit: THREE.Vector3 | null = null
	/**
	 * The frame clock: `frame()` advances it once (`update`), then reads the frame's delta and elapsed
	 * seconds. Not connected to the page's visibility, so a probe driving `frame()` in a hidden tab still
	 * sees time pass; `setTimescale(0)` holds it (the probes' frozen clock).
	 */
	readonly timer = new THREE.Timer()
	private raf = 0
	private frames = 0
	private statTime = 0
	/** View › Performance Overlay (#179): the frame's CPU time by subsystem, and its GPU passes. */
	private readonly meter = new PerfMeter()
	private gpu: GpuTimer
	/**
	 * Whether the browser took the viewport's WebGL context away (#209: a driver reset, the GPU process
	 * restarting, too many contexts). The frame loop idles until it is restored; three re-uploads
	 * geometry, textures and programs then by itself.
	 */
	contextLost = false
	private contextWaiters: Array<() => void> = []
	/** Help › Copy Performance Report waiting for the next window, with the overlay off. */
	private perfWaiters: Array<(r: PerfReport) => void> = []
	private resizeObs: ResizeObserver
	private viewDistance = 1
	private fogEnabled = true
	/** The fog's distances for the world's size and the view distance (applyViewDistance). */
	private fogNear = 0
	private fogFar = 0
	private abort = new AbortController()
	/** The scene's draw calls and triangles of the last `draw`. */
	private drawnCalls = 0
	private drawnTriangles = 0
	/** Whether the viewport wears the game's mood (Lighting › The Game's Mood, 3dgame #142) rather than the work light. */
	private moodOn = false
	/** The mood's grade pass, made the first time a mood is worn. */
	private grade: MoodGrade | null = null
	/** The mood shown, easing towards `moodTarget`; snapped to it when `moodSnap`. */
	private readonly moodNow: Mood = cloneMood(MOODS.surface[0])
	private readonly moodTarget: Mood = cloneMood(MOODS.surface[0])
	private moodSnap = true
	private moodDir = new THREE.Vector3()
	private glowShown = 1
	/** The lava's and the lamps' lights under the mood (3dgame #178), and the place they light most. */
	private readonly moodLights = new MoodLights()
	private readonly lightFocus = new THREE.Vector3()
	/** The prefs that snap the mood when they change (applyPrefs). */
	private lookKey = ''

	constructor(
		private canvas: HTMLCanvasElement,
		private container: HTMLElement,
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: antialiasAtStart(), powerPreference: 'high-performance' })
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
		this.renderer.toneMapping = THREE.NoToneMapping
		this.renderer.outputColorSpace = THREE.SRGBColorSpace

		this.persp = new THREE.PerspectiveCamera(55, 1, NEAR, 5000)
		this.scene.background = new THREE.Color()
		this.renderer.shadowMap.enabled = true
		this.renderer.shadowMap.type = THREE.PCFShadowMap
		this.gpu = new GpuTimer(this.renderer.getContext())
		// three's own listeners (added in its constructor, so run first) keep the context restorable and
		// rebuild its state; these pause the editor around it.
		canvas.addEventListener('webglcontextlost', () => this.onContextLost(), { signal: this.abort.signal })
		canvas.addEventListener('webglcontextrestored', () => this.onContextRestored(), { signal: this.abort.signal })
		this.env = new Environment(this.scene)
		this.scene.add(this.moodLights.group)
		this.timeShadowMaps()

		// The camera's ground is level with the ground layer's top: where its focus sits and the walking
		// camera walks. It flies free (no Follow the Ground or collision), to reach the layers below.
		this.controller = new CameraController(this.persp, canvas, () => GROUND_TOP)

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this
		this.ctx = {
			get history() { return self.history },
			get scene() { return self.scene },
			get raycaster() { return self.raycaster },
			cameraYaw: () => self.controller.yaw,
			get cubes() { return self.doc.cubes },
			pointerInside: () => self.pointerInside && !self.controller.isDragging,
		}

		// The arrows move the selected box of cubes in the Select tool.
		this.controller.arrowsBlocked = () => editor.tool === 'select' && this.cubeSelect.movesWithArrows(this.ctx)

		this.bindPointer()
		this.resizeObs = new ResizeObserver(() => this.resize())
		this.resizeObs.observe(container)
		this.resize()
		this.openWorld(CubeWorld.create(START_CHUNKS, START_CHUNKS, false), 'Untitled', '')
	}

	// ---------------------------------------------------------------- lifecycle

	start() {
		this.timer.reset()
		let last = -Infinity
		const loop = (now: number) => {
			this.raf = requestAnimationFrame(loop)
			// Graphics › FPS limit (#24): a frame waits for its interval; the timer's next delta covers the skipped ones.
			if (!frameDue(now, last, this.prefs?.fpsLimit ?? 0)) return
			last = now
			if (!this.contextLost) this.frame()
		}
		loop(performance.now())
	}

	/** Stops the loop `start` began; `frame()` still draws when called. The probes' page drives its own frames (#233). */
	stopLoop() {
		cancelAnimationFrame(this.raf)
	}

	private onContextLost() {
		this.contextLost = true
		setStatus('The graphics card dropped the viewport (a driver reset or too many 3D views). Waiting for it to come back…', 0)
	}

	/** Redraws what is drawn once and kept: the shadow maps, and the GPU timer's queries on the new context. */
	private onContextRestored() {
		this.contextLost = false
		// The old timer's queries died with the context, so it is dropped rather than disposed.
		this.gpu = new GpuTimer(this.renderer.getContext())
		this.prefsChanged = true
		// The time the context was lost advances `elapsed` but is not the next frame's delta.
		this.timer.update()
		setStatus('The viewport is back.', 4000)
		for (const w of this.contextWaiters.splice(0)) w()
	}

	/** Resolves once the viewport has a WebGL context, at once unless it is lost. */
	contextReady(): Promise<void> {
		if (!this.contextLost) return Promise.resolve()
		return new Promise((res) => this.contextWaiters.push(res))
	}

	dispose() {
		cancelAnimationFrame(this.raf)
		this.abort.abort()
		this.resizeObs.disconnect()
		this.controller.dispose()
		this.env.dispose()
		this.grade?.dispose()
		for (const d of this.documents) d.dispose()
		this.gpu.dispose()
		this.renderer.dispose()
	}

	private resize() {
		const w = this.container.clientWidth
		const h = this.container.clientHeight
		if (!w || !h) return
		this.renderer.setSize(w, h, false)
		this.persp.aspect = w / h
		this.persp.updateProjectionMatrix()
	}

	/** The world's larger side in metres. */
	private extent(d = this.doc) {
		return Math.max(d.world.sizeX, d.world.sizeZ) * CUBE_SIZE
	}

	/**
	 * The top-down 2D view (U): an orthographic camera straight above the controller's target, turned
	 * with the yaw so Q, E and a right drag still turn the world, and sized so the ground spans what the
	 * 3D view would show at the controller's distance (the wheel zooms). Fog is off while it is on.
	 */
	private updateTopDown() {
		const on = ui.topDown
		this.controller.topDown = on
		if (on !== this.topDown) {
			this.topDown = on
			this.applyViewDistance()
		}
		if (!on) return
		const c = this.controller
		const half = Math.max(2, c.distance * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2))
		const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
		const o = this.ortho
		o.left = -half * aspect
		o.right = half * aspect
		o.top = half
		o.bottom = -half
		o.updateProjectionMatrix()
		o.up.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw))
		o.position.set(c.target.x, GROUND_TOP + ORTHO_HEIGHT, c.target.z)
		o.lookAt(c.target.x, GROUND_TOP, c.target.z)
		o.updateMatrixWorld()
	}

	// ---------------------------------------------------------------- input

	private updatePointer(e: PointerEvent) {
		const r = this.canvas.getBoundingClientRect()
		this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
	}

	/** Sets the ray under the cursor and where it meets the cubes (`hit`). */
	private pick() {
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const p = pickUnder(this.ctx, this.doc.cubes)
		this.hit = p ? this.raycaster.ray.at(p.t, this.hitVec) : null
	}

	private bindPointer() {
		const sig = { signal: this.abort.signal }
		const c = this.canvas
		c.addEventListener('pointerenter', () => (this.pointerInside = true), sig)
		c.addEventListener('pointerleave', () => (this.pointerInside = false), sig)
		c.addEventListener(
			'pointerdown',
			(e) => {
				this.updatePointer(e)
				if (e.button !== 0) return
				try {
					c.setPointerCapture(e.pointerId)
				} catch {
					// A synthetic event (the probes' P.click) has no pointer to capture.
				}
				this.leftDown = true
				this.pick()
				this.activeTool?.onDown?.(this.ctx, this.hit, e)
			},
			sig,
		)
		c.addEventListener(
			'pointermove',
			(e) => {
				this.pointerInside = true
				this.updatePointer(e)
				if (this.leftDown) {
					this.pick()
					this.activeTool?.onMove?.(this.ctx, this.hit, e)
				}
			},
			sig,
		)
		c.addEventListener(
			'pointerup',
			(e) => {
				if (e.button !== 0 || !this.leftDown) return
				this.leftDown = false
				this.updatePointer(e)
				this.pick()
				this.activeTool?.onUp?.(this.ctx, this.hit, e)
			},
			sig,
		)
	}

	/** Forward a key to the active tool. Returns true if handled. */
	handleToolKey(e: KeyboardEvent): boolean {
		return this.activeTool?.onKey?.(this.ctx, e) ?? false
	}

	// ---------------------------------------------------------------- frame

	private toolFor(id: ToolId): Tool {
		return id === 'select' ? this.cubeSelect : this.cubeTool
	}

	/** Ends a held press on the active tool, as its pointerup would. */
	private releasePress() {
		if (!this.leftDown) return
		this.activeTool?.onUp?.(this.ctx, this.hit, new PointerEvent('pointerup'))
		this.leftDown = false
	}

	private syncTool() {
		if (this.activeToolId === editor.tool) return
		this.releasePress()
		this.activeTool?.deactivate?.(this.ctx)
		this.activeToolId = editor.tool
		this.activeTool = this.toolFor(editor.tool)
		this.activeTool.activate?.(this.ctx)
	}

	/** One frame of the loop: `simulate` readies the scene for the view, `draw` draws it, and the stats are published. */
	private frame() {
		this.timer.update()
		const dt = Math.min(this.timer.getDelta(), 0.1)
		const time = this.timer.getElapsed()
		const m = this.meter
		m.setOn(!!this.prefs?.perfOverlay || this.perfWaiters.length > 0)
		// The overlay starts on "Measuring…" the next time, not on old numbers.
		if (!this.prefs?.perfOverlay && stats.perf) stats.perf = null
		m.begin()
		if (m.on) this.gpu.poll()
		this.simulate(dt, time)
		this.draw()
		if (m.end()) this.publishPerf(this.drawnCalls, this.drawnTriangles)

		this.frames++
		if (time - this.statTime >= 0.5) {
			stats.fps = Math.round(this.frames / (time - this.statTime))
			stats.drawCalls = this.drawnCalls
			stats.triangles = this.drawnTriangles
			stats.cursor = this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z } : null
			const c = this.controller
			const layer = layerAtHeight(this.camera.position.y)
			if (stats.cameraLayer !== layer) stats.cameraLayer = layer
			const w = this.doc.world
			const cells = Math.max(w.sizeX, w.sizeZ)
			stats.view = ui.minimap ? { x: c.target.x, z: c.target.z, yaw: c.yaw, cells, world: cells * CUBE_SIZE, layer, cubes: this.doc.cubes.version } : null
			this.frames = 0
			this.statTime = time
		}
	}

	/**
	 * Readies everything the next draw shows from `this.camera`: the camera and sky, picking and the
	 * tool, the cubes and which shadow maps to redraw. `dt` 0 leaves what moves where it is.
	 */
	private simulate(dt: number, time: number) {
		const m = this.meter
		this.syncTool()
		this.controller.setWalk(ui.walkCamera && !this.topDown)
		this.controller.update(dt)
		this.updateTopDown()
		this.updateEnvironment(dt, time)
		m.mark(SECTION['Camera and sky'])

		if (this.pointerInside && !this.controller.isDragging) this.pick()
		else if (!this.leftDown) this.hit = null
		m.mark(SECTION.Picking)

		this.activeTool!.frame?.(this.ctx, this.hit)
		publishViewportHint()
		m.mark(SECTION.Tool)

		// The world builds its chunks a few milliseconds a frame and follows the layer slice (#30).
		this.doc.cubes.update(ui.cubeSlice, CUBE_BUILD_MS)
		m.mark(SECTION.Cubes)
		this.camera.updateMatrixWorld()
		this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
		this.markShadows()
	}

	/** Draws what `simulate` readied to the canvas. */
	private draw() {
		const m = this.meter
		if (m.on) this.gpu.begin(1)
		if (this.moodOn) {
			// Drawn into the half-float target, then graded onto the canvas (moodLook.ts).
			this.grade ??= new MoodGrade(antialiasAtStart() ? 4 : 0)
			this.grade.drawScene(this.renderer, this.scene, this.camera)
			this.grade.present(this.renderer)
		} else {
			this.renderer.render(this.scene, this.camera)
		}
		m.mark(SECTION['Render (CPU)'])
		this.drawnCalls = this.renderer.info.render.calls
		this.drawnTriangles = this.renderer.info.render.triangles
		if (m.on) this.gpu.endFrame()
	}

	private applyViewDistance() {
		const w = this.extent()
		const d = this.viewDistance
		this.fogNear = w * 0.5 * d
		this.fogFar = w * 2.2 * d
		this.scene.fog = this.fogEnabled && !this.topDown ? new THREE.Fog(this.env.state.horizon.clone(), this.fogNear, this.fogFar) : null
		this.persp.far = Math.max(2000, w * 4 * d)
		this.persp.updateProjectionMatrix()
	}

	/** Time of day, sky and lighting. */
	private updateEnvironment(dt: number, time: number) {
		const p = this.prefs
		if (p?.dayCycle) this.hour = (this.hour + (dt * 24) / (Math.max(0.5, p.cycleMinutes) * 60)) % 24
		const env = this.env
		const fog = this.scene.fog as THREE.Fog | null
		if (this.moodOn) {
			const mood = this.updateMood(dt)
			env.applyMood(mood, this.moodDir, time, this.camera, !!p?.clouds)
			// The client's fog: exponential, its colour the horizon's brightened by 1.4, here starting at
			// what the camera looks at (moodLook.ts patches three's fog for it).
			if (fog) {
				fog.near = mood.fog_density
				fog.far = -(ui.walkCamera ? 0 : this.controller.distance)
				moodColour(mood.horizon, fog.color, 1.4)
				fog.color.setRGB(Math.min(fog.color.r, 1), Math.min(fog.color.g, 1), Math.min(fog.color.b, 1))
			}
			this.setGlow(mood.glow)
			// The lights go to what the camera looks at, as far ahead as the fog starts (a flying
			// camera's own place when walking), but no further than 30 m.
			const ahead = ui.walkCamera ? 0 : Math.min(this.controller.distance, 30)
			this.camera.getWorldDirection(this.lightFocus)
			this.lightFocus.multiplyScalar(ahead).add(this.camera.position)
			this.moodLights.update(true, this.doc.cubes, mood, this.lightFocus, time)
		} else {
			this.moodLights.update(false, this.doc.cubes, this.moodNow, this.lightFocus, time)
			env.update(this.hour, time, this.camera)
			if (fog) {
				fog.near = this.fogNear
				fog.far = this.fogFar
				fog.color.copy(env.state.horizon)
			}
			this.setGlow(1)
		}
		;(this.scene.background as THREE.Color).copy(env.state.horizon)
		this.meter.mark(SECTION['Camera and sky'])
		if (env.key.castShadow) this.fitShadows()
		else env.aimKey(this.camera.position)
		this.meter.mark(SECTION['Shadow fit'])
	}

	/**
	 * The mood the viewport wears now (mood.rs ease), and its light's direction in `moodDir`: the mood of
	 * the layer looked at (the layer slice's while it is on, else the camera's), or of the mood region
	 * (3dgame #143) over the place looked at in that layer (mood.rs place_mood), and above ground the
	 * day's at the hour shown unless Lighting › Mood picks a surface mood. It eases towards it as the
	 * client's does.
	 */
	private updateMood(dt: number): Mood {
		const pick = MOODS.surfaceNames.indexOf(this.prefs?.mood ?? '')
		const slice = ui.cubeSlice
		const layer = slice.mode !== 'off' ? slice.layer : layerAtHeight(this.camera.position.y)
		const theme = THEME_KEYS[themeOf(layer)]
		const target = this.moodTarget
		const world = this.doc?.world
		const c = this.controller.target
		const r = world ? moodRegionAt(world, Math.floor(c.x / CUBE_SIZE), Math.floor(c.z / CUBE_SIZE), layer) : -1
		const region = r >= 0 ? world!.moods[r].mood : ''
		const own = MOODS.raw.get(region)
		const above = pick < 0 && themeIsSurface(MOODS, theme)
		if (own && MOODS.surfaceNames.includes(region)) namedMood(MOODS, region, 0, target)
		else if (own) {
			if (!(above && dayMood(MOODS, this.hour / 24, target, own))) namedMood(MOODS, region, Math.max(0, pick), target)
		} else if (!(above && dayMood(MOODS, this.hour / 24, target))) themeMood(MOODS, theme, Math.max(0, pick), target)
		const t = this.moodSnap ? 1 : 1 - Math.exp(-MOOD_EASE * dt)
		this.moodSnap = false
		easeMood(this.moodNow, target, t)
		const d = this.moodNow.moon_dir
		this.moodDir.set(d[0], d[1], d[2]).normalize()
		return this.moodNow
	}

	private setGlow(glow: number) {
		if (glow === this.glowShown) return
		this.glowShown = glow
		setCubeGlow(glow)
	}

	/**
	 * Times the shadow maps apart from the scene for the performance overlay: three renders them inside
	 * `renderer.render`, so its shadow map's `render` is wrapped to book its CPU time to Shadow maps and
	 * its GPU time to the Shadow maps pass, going back to the pass that was running after.
	 */
	private timeShadowMaps() {
		const sm = this.renderer.shadowMap
		const render = sm.render.bind(sm)
		sm.render = (lights, scene, camera) => {
			if (!this.meter.on) return render(lights, scene, camera)
			const timing = this.gpu.active
			const pass = this.gpu.pass
			this.meter.mark(SECTION['Render (CPU)'])
			if (timing) this.gpu.begin(0)
			render(lights, scene, camera)
			if (timing) this.gpu.begin(pass)
			this.meter.mark(SECTION['Shadow maps (CPU)'])
		}
	}

	/** The window's numbers into `stats.perf`, once a second, and to whoever waits for a report. */
	private publishPerf(calls: number, triangles: number) {
		const w = this.meter.take()
		const info = this.renderer.info
		const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
		const r: PerfReport = {
			...w,
			gpu: this.gpu.take(),
			calls,
			triangles,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			programs: info.programs?.length ?? 0,
			heapMB: heap ? heap.usedJSHeapSize / 1048576 : null,
		}
		if (this.prefs?.perfOverlay) stats.perf = r
		const waiters = this.perfWaiters
		this.perfWaiters = []
		for (const f of waiters) f(r)
	}

	/** The next second's performance numbers (Help › Copy Performance Report), measured even with the overlay off. */
	measurePerf(): Promise<PerfReport> {
		return new Promise((resolve) => this.perfWaiters.push(resolve))
	}

	/** Whether this browser times the GPU passes (the overlay shows n/a otherwise). */
	get gpuTimed() {
		return this.gpu.supported
	}

	/**
	 * Paints every face of the open world painted one of the textures `from` with `to` instead (0
	 * unpaints it), one undo step (Edit › Textures in This World, 3dgame #216, #223). Returns how many
	 * cubes changed.
	 */
	replaceTexture(from: readonly number[], to: number): number {
		const cubes = this.doc?.cubes
		const ids = new Set(from.filter((id) => id !== to))
		if (!cubes || !ids.size) return 0
		const changes = new CubeChanges(cubes.world)
		const skipped = replaceTexture(changes, ids, to)
		if (changes.size) {
			cubes.rebuild(changes.dirty())
			this.history.push({
				label: ids.size === 1 ? `Replace texture ${[...ids][0]}` : `Replace ${ids.size} textures`,
				bytes: changes.bytes,
				undo: () => cubes.rebuild(changes.undo()),
				redo: () => cubes.rebuild(changes.redo()),
			})
		}
		if (skipped) setStatus(`${skipped} faces in the metal layers keep their texture: they can't be edited.`, 4000)
		return changes.size
	}

	/**
	 * Puts `images` and `hints` in place of the open world's pictures and names for texture ids the game
	 * does not have yet (CubeWorld.images and hints, 3dgame #224, #227: a Tibia map's item textures), one
	 * undo step; its chunks are meshed again to show them.
	 */
	setWorldTextures(images: Map<number, string>, hints: Map<number, TextureHint>, label: string) {
		const cubes = this.doc?.cubes
		if (!cubes) return
		const world = cubes.world
		const before = { images: new Map(world.images), hints: new Map(world.hints) }
		const after = { images: new Map(images), hints: new Map(hints) }
		const apply = (s: typeof after) => {
			world.setImages(s.images)
			world.hints = new Map(s.hints)
			cubes.spritesChanged()
		}
		apply(after)
		let bytes = 0
		for (const png of after.images.values()) bytes += png.length
		this.history.push({ label, bytes, undo: () => apply(before), redo: () => apply(after) })
	}

	/** Sets (or with null clears) the open world's spawn point (Map Properties), one undo step. */
	setWorldSpawn(spawn: SpawnPoint | null) {
		const world = this.doc?.world
		if (!world) return
		const before = world.spawn ? { ...world.spawn } : null
		const after = spawn ? { ...spawn } : null
		if (JSON.stringify(before) === JSON.stringify(after)) return
		world.spawn = after && { ...after }
		this.history.push({
			label: after ? 'Spawn point' : 'Clear spawn point',
			undo: () => (world.spawn = before && { ...before }),
			redo: () => (world.spawn = after && { ...after }),
		})
	}

	/**
	 * Fits the shadow cascades to the view: the sharp near one around where the camera looks (the first
	 * cube ahead, kept within its own reach of the camera), the far one around the distance. Which fits
	 * changed is kept for `markShadows`.
	 */
	private fitShadows() {
		const env = this.env
		const eye = this.camera.position
		const fwd = this.camera.getWorldDirection(this.shadowFwd)
		const ahead = pickCube(this.doc.world, { ox: eye.x, oy: eye.y, oz: eye.z, dx: fwd.x, dy: fwd.y, dz: fwd.z }, sliceShows(ui.cubeSlice), 3000, GROUND_LAYER)
		const dist = ahead ? ahead.t : 300
		const nearExtent = THREE.MathUtils.clamp(dist, 30, 250)
		const farExtent = THREE.MathUtils.clamp(dist * 6, 800, 2500)
		const nearCenter = this.shadowNear.copy(eye).addScaledVector(fwd, Math.min(dist, nearExtent))
		const farCenter = this.shadowFar.copy(eye).addScaledVector(fwd, Math.min(dist, farExtent * 0.6))
		this.shadowFits |= env.updateShadow(nearCenter, nearExtent, farCenter, farExtent)
	}

	/**
	 * Says which shadow maps to redraw this frame, just before it is drawn (#326). Both are kept between
	 * frames: the far one is redrawn when its fit, the cubes or a preference changes; the near one also
	 * when the camera moves. A still view redraws neither.
	 */
	private markShadows() {
		const env = this.env
		const fits = this.shadowFits
		this.shadowFits = 0
		if (!env.key.castShadow) return
		const scene = this.shadowSceneChanged()
		if (scene || this.prefsChanged || fits & SHADOW_FAR) env.far.shadow.needsUpdate = true
		const view = !this.viewProj.equals(this.shadowViewProj)
		if (view) this.shadowViewProj.copy(this.viewProj)
		if (scene || view || this.prefsChanged || fits & SHADOW_NEAR) env.key.shadow.needsUpdate = true
		this.prefsChanged = false
	}

	/** Whether the cubes drawn changed since the last call: another tab, an edit, chunks built or the slice. */
	private shadowSceneChanged(): boolean {
		const k = this.shadowKey
		const c = this.doc.cubes
		const s = ui.cubeSlice
		const now = [this.doc.id, c.version, c.pending, s.mode === 'off' ? 0 : s.mode === 'above' ? 1 : 2, s.layer]
		if (now.every((v, i) => k[i] === v)) return false
		for (let i = 0; i < now.length; i++) k[i] = now[i]
		return true
	}
	private viewProj = new THREE.Matrix4()
	private shadowFwd = new THREE.Vector3()
	private shadowNear = new THREE.Vector3()
	private shadowFar = new THREE.Vector3()
	private shadowKey = [-1, -1, -1, -1, -1]
	/** The fits `fitShadows` changed since the last `markShadows` (SHADOW_NEAR, SHADOW_FAR bits). */
	private shadowFits = 0
	/** The camera's view-projection when the near map was last checked. */
	private shadowViewProj = new THREE.Matrix4()
	/** Preferences were applied since the last frame. */
	private prefsChanged = true

	/** Apply user preferences (graphics + camera). Cheap; safe to call often. */
	applyPrefs(p: Prefs) {
		this.prefs = p
		this.prefsChanged = true
		if (!p.dayCycle) this.hour = p.timeOfDay
		// A mood picked, the look switched or the hour set shows at once; walking between layers eases.
		const look = `${p.look} ${p.mood} ${p.timeOfDay}`
		if (look !== this.lookKey) {
			this.lookKey = look
			this.moodSnap = true
		}
		this.moodOn = p.look === 'mood'
		this.env.setClouds(p.clouds)
		setCubeFiltering(p.smoothTextures)
		this.env.setShadows(p.shadows)
		// Times the interface size (#372): under the page's CSS zoom the canvas's CSS px are that much larger on screen.
		const ratio = Math.min(window.devicePixelRatio * p.renderScale * clampUiScale(p.uiScale), 3)
		if (this.renderer.getPixelRatio() !== ratio) {
			this.renderer.setPixelRatio(ratio)
			this.resize()
		}
		if (this.viewDistance !== p.viewDistance || this.fogEnabled !== p.fog) {
			this.viewDistance = p.viewDistance
			this.fogEnabled = p.fog
			this.applyViewDistance()
		}
		this.controller.speed = p.cameraSpeed
		this.controller.sensitivity = p.mouseSensitivity
		this.controller.invertY = p.invertY
	}

	// ---------------------------------------------------------------- documents

	/** Copy the live editor state into the active document. */
	private stashActive() {
		const d = this.doc
		if (!d) return
		d.meta = {
			mapName: editor.mapName,
			filePath: editor.filePath,
			dirty: editor.dirty,
			bookmarks: [...editor.bookmarks],
		}
		const c = this.controller
		d.camera = { target: c.target.clone(), yaw: c.yaw, pitch: c.pitch, distance: c.distance }
	}

	private syncTabs() {
		docs.tabs = this.documents.map((d) =>
			d === this.doc
				? { id: d.id, name: editor.mapName, dirty: editor.dirty, world: worldLabel(d) }
				: { id: d.id, name: d.meta.mapName, dirty: d.meta.dirty, world: worldLabel(d) },
		)
		docs.active = this.doc.id
	}

	/** Make `d` the edited/rendered document. `stash` saves the current one first. */
	private activate(d: MapDocument, stash = true) {
		// Already the active tab: its `meta` is the copy from the last stash, so loading it would revert
		// what the editor holds since (#547).
		if (stash && d === this.doc) {
			this.syncTabs()
			return
		}
		this.releasePress()
		if (stash && this.doc && this.doc !== d) {
			this.stashActive()
			this.scene.remove(this.doc.cubes.group)
		}
		this.doc = d
		this.scene.add(d.cubes.group)
		const m = d.meta
		editor.mapName = m.mapName
		editor.filePath = m.filePath
		editor.bookmarks = [...m.bookmarks]
		const extent = this.extent(d)
		this.controller.bounds = extent
		this.controller.maxDistance = extent * 1.6
		if (d.camera) {
			this.controller.target.copy(d.camera.target)
			this.controller.jump()
			this.controller.yaw = d.camera.yaw
			this.controller.pitch = d.camera.pitch
			this.controller.distance = d.camera.distance
		} else {
			this.controller.focus((d.world.sizeX * CUBE_SIZE) / 2, (d.world.sizeZ * CUBE_SIZE) / 2, extent * 0.35)
		}
		this.applyViewDistance()
		d.history.refresh()
		editor.dirty = m.dirty
		this.syncTabs()
	}

	/** Adds `d` as the active tab. It takes the place of `replace`, or of an untouched empty tab. */
	private addDocument(d: MapDocument, replace?: MapDocument) {
		// Opening a file into an untouched empty tab replaces it, like most editors.
		const old = replace ?? (this.doc?.pristine ? this.doc : null)
		this.documents.splice(replace ? this.documents.indexOf(replace) + 1 : this.documents.length, 0, d)
		this.activate(d)
		if (old) this.closeDocument(old.id)
	}

	/**
	 * Opens a cube world of the game (#29) in its own tab: it takes the place of an untouched empty tab,
	 * or with `replaceId` of that tab (Revert), keeping its camera. A new world (no `filePath`) gets a
	 * name no other tab has.
	 */
	openWorld(world: CubeWorld, name: string, filePath: string, replaceId?: number): MapDocument {
		const replace = replaceId === undefined ? undefined : this.documents.find((x) => x.id === replaceId)
		if (replace === this.doc) this.stashActive()
		const d = new MapDocument(world, filePath ? name : this.uniqueName(name))
		d.meta.filePath = filePath
		if (replace) {
			d.camera = replace.camera
			d.meta.bookmarks = [...replace.meta.bookmarks]
		}
		this.addDocument(d, replace)
		return d
	}

	private uniqueName(base: string) {
		const names = new Set(this.documents.map((d) => (d === this.doc ? editor.mapName : d.meta.mapName)))
		if (!names.has(base)) return base
		for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
	}

	switchDocument(id: number) {
		const d = this.documents.find((x) => x.id === id)
		if (d && d !== this.doc) this.activate(d)
	}

	/** Cycle tabs (Ctrl+Tab / Ctrl+Shift+Tab). */
	cycleDocument(dir: 1 | -1) {
		const i = this.documents.indexOf(this.doc)
		const n = this.documents.length
		if (n < 2) return
		this.activate(this.documents[(i + dir + n) % n])
	}

	/** Saves the camera's view of the open world as a bookmark. */
	addBookmark(): Bookmark {
		const c = this.controller
		const b: Bookmark = {
			name: `View ${editor.bookmarks.length + 1}`,
			x: c.target.x,
			y: c.target.y,
			z: c.target.z,
			yaw: c.yaw,
			pitch: c.pitch,
			distance: c.distance,
		}
		editor.bookmarks = [...editor.bookmarks, b]
		setStatus(`Bookmarked ${b.name}. Pick it in the Bookmarks menu to return.`)
		return b
	}

	/** Moves the camera to bookmark `i`. */
	gotoBookmark(i: number) {
		const b = editor.bookmarks[i]
		if (!b) return
		const c = this.controller
		c.target.set(b.x, b.y, b.z)
		c.yaw = b.yaw
		c.pitch = b.pitch
		c.distance = b.distance
	}

	/** The viewport's size in CSS pixels. */
	viewportSize(): [number, number] {
		return [this.container.clientWidth, this.container.clientHeight]
	}

	/** The camera's view and the hour of day, for a copied scene (io/scene.ts). */
	sceneView() {
		const c = this.controller
		return { target: [c.target.x, c.target.y, c.target.z] as [number, number, number], yaw: c.yaw, pitch: c.pitch, distance: c.distance, hour: this.hour }
	}

	/** Restores a copied scene's view and hour. Call it after the scene's prefs are applied. */
	setSceneView(v: ReturnType<Engine['sceneView']>) {
		this.controller.setView(v.target[0], v.target[1], v.target[2], v.yaw, v.pitch, v.distance)
		this.hour = v.hour
	}

	clearBookmarks() {
		editor.bookmarks = []
	}

	/** Turns the camera round to look the other way. */
	turnCameraAround() {
		this.controller.yaw += Math.PI
	}

	/** Switches to the tab already showing `path`, if any. */
	focusPath(path: string): boolean {
		const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
		const d = this.documents.find((x) => norm(x === this.doc ? editor.filePath : x.meta.filePath) === norm(path))
		if (d) this.activate(d)
		return !!d
	}

	/** A left-button drag is held (a box select, a drag of cubes): the world is mid-edit, its history step not yet pushed. */
	isStroking() {
		return this.leftDown
	}

	isDirty(id: number) {
		const d = this.documents.find((x) => x.id === id)
		return !!d && (d === this.doc ? editor.dirty : d.meta.dirty)
	}

	anyDirty() {
		return this.documents.some((d) => this.isDirty(d.id))
	}

	/** Close a tab without asking (the UI confirms unsaved changes first). */
	closeDocument(id: number) {
		const i = this.documents.findIndex((x) => x.id === id)
		if (i < 0) return
		const d = this.documents[i]
		this.documents.splice(i, 1)
		if (d === this.doc) {
			this.releasePress()
			this.scene.remove(d.cubes.group)
			const next = this.documents[Math.min(i, this.documents.length - 1)]
			// Keep at least one world open. The closed doc isn't stashed.
			if (next) {
				this.activate(next, false)
			} else {
				const fresh = new MapDocument(CubeWorld.create(START_CHUNKS, START_CHUNKS, false), 'Untitled')
				this.documents.push(fresh)
				this.activate(fresh, false)
			}
		}
		d.dispose()
		this.syncTabs()
	}

	/** Keep the active tab's title/dirty marker current (called from the UI). */
	refreshTabs() {
		if (this.doc) this.syncTabs()
	}

	activeDocumentId() {
		return this.doc.id
	}

	/** The active world's document, for work that outlives a tab switch. */
	activeDocument() {
		return this.doc
	}

	// ---------------------------------------------------------------- the Select tool's cubes

	/** Drops the selected box of cubes, and any paste waiting to be put down. */
	deselect() {
		this.cubeSelect.deselect(this.ctx)
	}

	/** Copies the selected box of cubes (Ctrl+C, #70). */
	copySelection(): boolean {
		return this.cubeSelect.copy(this.ctx)
	}

	/** Starts pasting the copied cubes under the cursor (Ctrl+V, #70). */
	startPaste() {
		if (this.cubeSelect.startPaste()) editor.tool = 'select'
	}

	/** The selected box of cubes as a clip (the cube palette's Save selection, 3dgame #73), or null (with the reason in the status bar). */
	cubeSelectionClip(): CubeClip | null {
		return this.cubeSelect.selectionClip(this.ctx)
	}

	/**
	 * Starts pasting `clip` under the cursor, as Ctrl+V does with copied cubes: how a prefab of cubes is
	 * placed (3dgame #73). It becomes the cube clipboard, so Ctrl+V places it again.
	 */
	placeCubeClip(clip: CubeClip, name: string) {
		if (this.cubeSelect.startPaste(clip, name)) editor.tool = 'select'
	}

	/** Copies the selected box of cubes and empties it, one History step (Ctrl+X, #74). */
	cutSelection() {
		this.cubeSelect.cut(this.ctx)
	}

	/** Empties the selected box of cubes (Delete, #70). */
	deleteCubes() {
		this.cubeSelect.deleteSelection(this.ctx)
	}

	/** Joins the selected box's cubes into one group (J, #32). */
	joinCubes() {
		this.cubeSelect.join(this.ctx)
	}

	/** Splits the groups of joined cubes in the selected box (Shift+J, #32). */
	splitCubes() {
		this.cubeSelect.split(this.ctx)
	}

	/** Moves the selected cubes by dx and dz columns and dl layers, positive dl down (#70). */
	moveCubes(dx: number, dz: number, dl: number) {
		this.cubeSelect.move(this.ctx, dx, dz, dl)
	}

	/** Turns the cubes waiting to be pasted a quarter, or stops (`cancel`) or ends (`place`) their paste (#70). */
	cubePaste(action: 'turn' | 'mirrorX' | 'mirrorZ' | 'place' | 'cancel') {
		if (action === 'mirrorX' || action === 'mirrorZ') return this.cubeSelect.mirror(action === 'mirrorX' ? 'x' : 'z')
		const key = action === 'turn' ? 'r' : action === 'place' ? 'Enter' : 'Escape'
		if (this.cubeSelect.pasting) this.cubeSelect.onKey(this.ctx, new KeyboardEvent('keydown', { key }))
	}

	// ---------------------------------------------------------------- history

	undo() {
		return this.history.undo()
	}

	redo() {
		return this.history.redo()
	}

	/** Undoes or redoes until `position` steps of the history are done (the History window's click). */
	goToHistory(position: number) {
		this.history.goTo(position)
	}
}
