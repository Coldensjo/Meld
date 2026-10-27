import * as THREE from 'three'
import { MouseLookBegin, MouseLookEnd, MouseLookRecenter } from '../../../wailsjs/go/main/App'
import { LookWarp } from './lookWarp'
import { moveStep, walkFloor, WALK_HEIGHT, type CameraMoveScratch } from './cameraMove'
import { CAMERA_KEYS } from '../ui/commands'

/** Whether any of `codes` is held. */
function held(keys: Set<string>, codes: readonly string[]): boolean {
	for (const c of codes) if (keys.has(c)) return true
	return false
}

/** WebView2 shows a banner on every pointer lock, so Windows hides and recentres the cursor natively. */
const nativeLook = navigator.userAgent.includes('Windows')

/** A walking character's run speed, in yards a second (the game's 7). */
const WALK_SPEED = 7

/**
 * The camera, in one of two modes (with `walk` and `topDown` below, the Camera menu's four views,
 * `lib/ui/cameraView.ts`, #750).
 *
 * Flying View is first person: `target` is the camera's own position, RMB drag looks
 * around, W/S fly the way the camera looks, A/D strafe, Space/X go up and down, and the wheel sets
 * the speed. Nothing snaps to the ground, so caves and cellars can be entered.
 *
 * With `followGround` on (Orbit View, the app's default through `prefs.cameraFollowGround`) it is a third-person orbit camera: the target rides the terrain (or the
 * water), RMB orbits, MMB pans, the wheel zooms, and the camera stays above the ground, which suits
 * sculpting from above.
 */
export class CameraController {
	readonly target = new THREE.Vector3()
	yaw = Math.PI * 0.25
	pitch = 0.75
	distance = 90
	minDistance = 4
	maxDistance = 900
	bounds = 512
	/** Preferences: multipliers for move speed / mouse orbit, and Y inversion. */
	speed = 1
	sensitivity = 1
	invertY = false
	/** Keep the target on the ground and the camera above it, instead of flying first person. */
	followGround = false
	/**
	 * Camera collision (Noggit Red's): the flying camera stays at least COLLIDE_HEIGHT above the ground
	 * (or the water over it), or in a WMO above its floor (`collisionFloor`), so it can't sink into a hill
	 * or a street, and off the WMOs' walls (`collideWalls`);
	 * off, it enters caves and cellars and flies through walls.
	 */
	collision = false
	/**
	 * With `collision` on, the flying camera also keeps off the placed WMOs' walls and floors (#305),
	 * and the walker always stops at their walls (#313): the Engine's hook moves `to`, where the eye is
	 * going from `from` this frame, to where it stops.
	 */
	collideWalls: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null
	/**
	 * With `collision` on, the floor the flying camera stays COLLIDE_HEIGHT above at `at`, given the
	 * ground's height there (#310): the Engine's hook puts a WMO's floor in place of the terrain while the
	 * eye is in one of its rooms, since in a city the terrain runs above and below the streets. `jumped`
	 * says the eye came there by a jump, so what the Engine knew of its room is out of date.
	 */
	collisionFloor: ((at: THREE.Vector3, ground: number, jumped: boolean) => number) | null = null
	/** The collision step's probes (`cameraMove.ts` `moveStep`). */
	private moveScratch: CameraMoveScratch = { floor: new THREE.Vector3(), wall: new THREE.Vector3() }
	/** Where the eye was after the last `update`, and whether it has jumped since (a teleport, a mode change), which is no move to collide. */
	private settled = new THREE.Vector3()
	private jumped = true
	/**
	 * The Engine draws the top-down 2D view (U) from above `target` with its own camera; here it only
	 * means the wheel zooms (`distance`), and the keys and a middle drag pan across the ground, as they
	 * do when following the ground.
	 */
	topDown = false
	/**
	 * Camera › Walk (#21, Noggit Red's FPS camera): first person with the eye WALK_HEIGHT above the
	 * ground, moving level at a run whichever way it looks, as a player walks the map, stopped by
	 * the WMOs' walls (`collideWalls`, whatever `collision` says). The camera it
	 * left is kept and comes back when the walk ends.
	 */
	walk = false
	private beforeWalk: { target: THREE.Vector3; yaw: number; pitch: number; distance: number; followGround: boolean } | null = null
	/** Flight speed multiplier set by the wheel. */
	private flyBoost = 1
	/** When this returns true the arrow keys are left to the editor (object nudging). */
	arrowsBlocked: () => boolean = () => false
	/** When this returns true the wheel is left to the editor (e.g. Ctrl+scroll rotates a placement). */
	wheelBlocked: (e: WheelEvent) => boolean = () => false
	/** A right-click that did not orbit (the pointer barely moved): the editor's context menu. */
	onContextClick: (e: PointerEvent) => void = () => {}
	/** When this returns true a right press is left to the editor (Alt+right-drag sizes a brush). */
	rightBlocked: (e: PointerEvent) => boolean = () => false
	private rightMoved = 0

	private keys = new Set<string>()
	private drag: 'orbit' | 'pan' | null = null
	private last = new THREE.Vector2()
	/** Native mouse look: whether it runs, and its recentring of the hidden cursor on the drag's start. */
	private looking = false
	private warp = new LookWarp()
	private smoothTargetY = 0
	private abort = new AbortController()

	constructor(
		private camera: THREE.PerspectiveCamera,
		private dom: HTMLElement,
		readonly ground: (x: number, z: number) => number,
	) {
		const sig = { signal: this.abort.signal }
		dom.addEventListener('pointerdown', this.onDown, sig)
		window.addEventListener('pointermove', this.onMove, sig)
		window.addEventListener('pointerup', this.onUp, sig)
		dom.addEventListener('wheel', this.onWheel, { passive: false, signal: this.abort.signal })
		dom.addEventListener('contextmenu', (e) => e.preventDefault(), sig)
		window.addEventListener('keydown', this.onKeyDown, sig)
		window.addEventListener('keyup', (e) => this.keys.delete(e.code), sig)
		window.addEventListener(
			'blur',
			() => {
				this.keys.clear()
				this.endLook()
			},
			sig,
		)
	}

	get isDragging() {
		return this.drag !== null
	}

	/** Looks at the ground point (x, z) from `distance` away (flying: the camera moves back to there). */
	focus(x: number, z: number, distance?: number) {
		if (distance) this.distance = distance
		this.target.set(x, this.ground(x, z), z)
		this.smoothTargetY = this.target.y
		this.jumped = true
		if (!this.followGround) {
			this.pitch = Math.max(this.pitch, 0.3)
			this.target.add(this.viewOffset(this.distance))
		}
	}

	/** Puts the camera back on a saved view (a bookmark or a copied scene) without easing to it. */
	setView(x: number, y: number, z: number, yaw: number, pitch: number, distance: number) {
		this.target.set(x, y, z)
		this.smoothTargetY = y
		this.yaw = yaw
		this.pitch = pitch
		this.distance = distance
		this.jumped = true
	}

	/** Marks the target as set from outside (a tab switch), so the next update doesn't collide the move there. */
	jump() {
		this.jumped = true
	}

	/** Scratch for `viewOffset`, which the frame's update calls. */
	private offsetScratch = new THREE.Vector3()

	/** The offset from a looked-at point back to the camera, `dist` away along the view direction; a shared scratch, used at once. */
	private viewOffset(dist: number, out = this.offsetScratch) {
		const cp = Math.cos(this.pitch)
		return out.set(Math.sin(this.yaw) * cp * dist, Math.sin(this.pitch) * dist, Math.cos(this.yaw) * cp * dist)
	}

	/** Switches ground following on or off without the view jumping. */
	setFollowGround(on: boolean) {
		// While walking the setting is for the camera the walk returns to.
		if (this.walk) {
			if (this.beforeWalk) this.beforeWalk.followGround = on
			return
		}
		if (on === this.followGround) return
		this.followGround = on
		this.jumped = true
		if (on) {
			// The camera stays put; the orbit target is the ground in front of it, as far as it was looking.
			this.pitch = Math.max(this.pitch, 0.08)
			const back = this.viewOffset(this.distance)
			this.target.sub(back)
			this.target.y = this.ground(this.target.x, this.target.z)
			this.smoothTargetY = this.target.y
		} else {
			// First person starts where the camera was.
			this.target.copy(this.camera.position)
		}
	}

	private onDown = (e: PointerEvent) => {
		if (e.button === 2 && this.rightBlocked(e)) return
		if (e.button === 2) this.drag = 'orbit'
		else if (e.button === 1) this.drag = 'pan'
		else return
		e.preventDefault()
		this.last.set(e.clientX, e.clientY)
		this.rightMoved = 0
		this.dom.setPointerCapture?.(e.pointerId)
		// Looking around hides the cursor and never runs into the screen's edge.
		if (e.button === 2) {
			if (nativeLook) this.beginLook(e)
			else this.dom.requestPointerLock?.()
		}
	}

	private onMove = (e: PointerEvent) => {
		if (!this.drag) return
		const locked = document.pointerLockElement === this.dom
		if (this.drag === 'orbit') this.rightMoved += Math.abs(e.movementX) + Math.abs(e.movementY)
		let dx = locked ? e.movementX : e.clientX - this.last.x
		let dy = locked ? e.movementY : e.clientY - this.last.y
		this.last.set(e.clientX, e.clientY)
		if (this.looking) {
			// The cursor's jumps back to the anchor are not the user's (lookWarp.ts, #724).
			if (this.warp.move(e.clientX, e.clientY, e.clientX - dx, e.clientY - dy, e.timeStamp)) void MouseLookRecenter()
			dx = this.warp.dx
			dy = this.warp.dy
		}
		if (this.drag === 'orbit') {
			const k = 0.005 * this.sensitivity
			this.yaw -= dx * k
			// Looking up is only useful when flying; on the ground the camera stays above the target.
			this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k * (this.invertY ? -1 : 1), this.followGround ? 0.08 : -1.45, 1.52)
		} else if (this.followGround || this.topDown) {
			const s = this.distance * 0.0016
			// Grab-the-ground: forward = camera→target, right = forward × up.
			const fx = -Math.sin(this.yaw)
			const fz = -Math.cos(this.yaw)
			this.target.x += (fz * dx + fx * dy) * s
			this.target.z += (-fx * dx + fz * dy) * s
			this.clampTarget()
		} else {
			// Flying: a middle drag slides the camera sideways and up/down.
			const s = 0.05 * this.flyBoost
			const fx = -Math.sin(this.yaw)
			const fz = -Math.cos(this.yaw)
			this.target.x += -fz * -dx * s
			this.target.z += fx * -dx * s
			this.target.y += dy * s
			this.clampTarget()
		}
	}

	private onUp = (e: PointerEvent) => {
		const click = e.button === 2 && this.drag === 'orbit' && this.rightMoved < 4
		if ((e.button === 2 && this.drag === 'orbit') || (e.button === 1 && this.drag === 'pan')) this.drag = null
		if (e.button === 2 && document.pointerLockElement === this.dom) document.exitPointerLock()
		if (e.button === 2) this.endLook()
		if (click) this.onContextClick(e)
	}

	private beginLook(e: PointerEvent) {
		this.looking = true
		this.warp.begin(e.clientX, e.clientY)
		document.documentElement.classList.add('mouse-look')
		MouseLookBegin().then(
			(ok) => {
				if (!ok) this.looking = false
			},
			() => (this.looking = false),
		)
	}

	private endLook() {
		if (!this.looking) return
		this.looking = false
		document.documentElement.classList.remove('mouse-look')
		void MouseLookEnd()
	}

	private onWheel = (e: WheelEvent) => {
		e.preventDefault() // also stops Ctrl+wheel from zooming the webview
		if (this.wheelBlocked(e)) return
		const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0012)
		if (this.followGround || this.topDown) this.distance = THREE.MathUtils.clamp(this.distance * f, this.minDistance, this.maxDistance)
		else this.flyBoost = THREE.MathUtils.clamp(this.flyBoost / f, 0.1, 8)
	}

	private onKeyDown = (e: KeyboardEvent) => {
		const el = e.target as HTMLElement | null
		if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
		// Ctrl and Alt combinations are the editor's shortcuts, except Ctrl held as the very-fast modifier.
		if (e.altKey || e.metaKey) return
		if (e.ctrlKey && !e.code.startsWith('Control') && !e.code.startsWith('Shift')) return
		if (e.code.startsWith('Arrow') && this.arrowsBlocked()) return
		this.keys.add(e.code)
	}

	/** Starts or ends the walk; ending it puts back the camera the walk started from. */
	setWalk(on: boolean) {
		if (on === this.walk) return
		this.jumped = true
		if (on) {
			this.beforeWalk = { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, distance: this.distance, followGround: this.followGround }
			// The eye starts where the camera is (an orbit camera's eye is behind its target), looking level.
			if (this.followGround) this.target.copy(this.camera.position)
			this.followGround = false
			this.pitch = Math.min(this.pitch, 0.3)
			this.walk = true
			// From the eye down, so the walk starts on the street under a camera flying over a city.
			this.target.y = walkFloor(this.target, this.target.y, true, this, this.moveScratch.floor) + WALK_HEIGHT
			return
		}
		this.walk = false
		const b = this.beforeWalk
		this.beforeWalk = null
		if (!b) return
		this.target.copy(b.target)
		this.yaw = b.yaw
		this.pitch = b.pitch
		this.distance = b.distance
		this.followGround = b.followGround
		this.smoothTargetY = b.target.y
	}

	private clampTarget() {
		this.target.x = THREE.MathUtils.clamp(this.target.x, -this.bounds * 0.1, this.bounds * 1.1)
		this.target.z = THREE.MathUtils.clamp(this.target.z, -this.bounds * 0.1, this.bounds * 1.1)
	}

	update(dt: number) {
		const k = this.keys
		// Shift is fast and Ctrl+Shift very fast (Ctrl alone is left to the editor's shortcuts).
		const shift = k.has('ShiftLeft') || k.has('ShiftRight')
		const ctrl = k.has('ControlLeft') || k.has('ControlRight')
		const fast = shift && ctrl ? 12 : shift ? 4 : 1
		let fwd = 0,
			right = 0
		const arrows = !this.arrowsBlocked()
		// The movement keys are the Hotkey Manager's (#396); the arrows stay fixed.
		const c = CAMERA_KEYS
		if (held(k, c.camForward) || (arrows && k.has('ArrowUp'))) fwd += 1
		if (held(k, c.camBack) || (arrows && k.has('ArrowDown'))) fwd -= 1
		if (held(k, c.camRight) || (arrows && k.has('ArrowRight'))) right += 1
		if (held(k, c.camLeft) || (arrows && k.has('ArrowLeft'))) right -= 1
		if (held(k, c.camTurnLeft)) this.yaw += dt * 1.6 * this.sensitivity
		if (held(k, c.camTurnRight)) this.yaw -= dt * 1.6 * this.sensitivity

		const speed = this.moveSpeed(fast) * dt
		const fx = -Math.sin(this.yaw)
		const fz = -Math.cos(this.yaw)
		if (fwd || right) {
			if (this.followGround || this.topDown || this.walk) {
				this.target.x += (fx * fwd - fz * right) * speed
				this.target.z += (fz * fwd + fx * right) * speed
			} else {
				// Flying: forward is the way the camera looks, so pitching down and holding W descends.
				const cp = Math.cos(this.pitch)
				this.target.x += (fx * cp * fwd - fz * right) * speed
				this.target.z += (fz * cp * fwd + fx * right) * speed
				this.target.y -= Math.sin(this.pitch) * fwd * speed
			}
			this.clampTarget()
		}
		if (!this.walk && !this.followGround) {
			if (held(k, c.camUp)) this.target.y += speed
			if (held(k, c.camDown)) this.target.y -= speed
		}
		// The walker's walls then its floor, the flying camera's floor clamp then its walls (#434).
		moveStep(this.target, this.settled, this.jumped, this, this.moveScratch)
		this.settled.copy(this.target)
		this.jumped = false

		const pos = this.camera.position
		if (this.followGround) {
			// Glide the target height along the terrain, and orbit it from above.
			const gy = this.ground(this.target.x, this.target.z)
			this.smoothTargetY += (gy - this.smoothTargetY) * Math.min(1, dt * 8)
			this.target.y = this.smoothTargetY
			pos.copy(this.target).add(this.viewOffset(this.distance))
			const floor = this.ground(pos.x, pos.z) + 1.5
			if (pos.y < floor) pos.y = floor
			this.camera.lookAt(this.target)
		} else {
			// First person: the camera is the target, looking along yaw and pitch.
			this.smoothTargetY = this.target.y
			pos.copy(this.target)
			this.camera.lookAt(this.target.x + fx * Math.cos(this.pitch), this.target.y - Math.sin(this.pitch), this.target.z + fz * Math.cos(this.pitch))
		}
	}

	/** Units per second for the keys: in orbit, slow close in and faster zoomed out; flying, a steady pace the wheel scales. */
	private moveSpeed(fast: number) {
		if (this.walk) return WALK_SPEED * fast * this.speed
		if (this.followGround) return (6 + Math.min(this.distance, 300) * 0.4) * fast * this.speed
		return 72 * this.flyBoost * fast * this.speed
	}

	dispose() {
		this.endLook()
		this.abort.abort()
	}
}
