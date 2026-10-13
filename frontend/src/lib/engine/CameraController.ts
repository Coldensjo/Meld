import * as THREE from 'three'

/**
 * Third-person orbit camera around a target point.
 *
 *  RMB drag      orbit (yaw/pitch)
 *  MMB drag      pan
 *  Wheel         zoom
 *  WASD / arrows move target, Q/E rotate, Shift = fast
 *
 * By default the camera flies: W moves the target along the view direction, nothing snaps to the
 * ground, and the camera may look up and go underground, so caves and cellars can be entered. With
 * `followGround` on, the target rides the terrain (or the water) and the camera stays above it,
 * which suits sculpting from above.
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
  /** Keep the target on the ground and the camera above it, instead of flying freely. */
  followGround = false
  /** When this returns true the arrow keys are left to the editor (object nudging). */
  arrowsBlocked: () => boolean = () => false
  /** When this returns true the wheel is left to the editor (e.g. Ctrl+scroll rotates a placement). */
  wheelBlocked: (e: WheelEvent) => boolean = () => false

  private keys = new Set<string>()
  private drag: 'orbit' | 'pan' | null = null
  private last = new THREE.Vector2()
  private smoothTargetY = 0
  private abort = new AbortController()

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private ground: (x: number, z: number) => number,
  ) {
    const sig = { signal: this.abort.signal }
    dom.addEventListener('pointerdown', this.onDown, sig)
    window.addEventListener('pointermove', this.onMove, sig)
    window.addEventListener('pointerup', this.onUp, sig)
    dom.addEventListener('wheel', this.onWheel, { passive: false, signal: this.abort.signal })
    dom.addEventListener('contextmenu', (e) => e.preventDefault(), sig)
    window.addEventListener('keydown', this.onKeyDown, sig)
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), sig)
    window.addEventListener('blur', () => this.keys.clear(), sig)
  }

  get isDragging() {
    return this.drag !== null
  }

  focus(x: number, z: number, distance?: number) {
    this.target.set(x, this.ground(x, z), z)
    this.smoothTargetY = this.target.y
    if (distance) this.distance = distance
  }

  /** Switches ground following on or off; turning it on drops the target back onto the ground. */
  setFollowGround(on: boolean) {
    if (on === this.followGround) return
    this.followGround = on
    if (on) {
      this.smoothTargetY = this.ground(this.target.x, this.target.z)
      this.pitch = Math.max(this.pitch, 0.08)
    }
  }

  private onDown = (e: PointerEvent) => {
    if (e.button === 2) this.drag = 'orbit'
    else if (e.button === 1) this.drag = 'pan'
    else return
    e.preventDefault()
    this.last.set(e.clientX, e.clientY)
    this.dom.setPointerCapture?.(e.pointerId)
  }

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return
    const dx = e.clientX - this.last.x
    const dy = e.clientY - this.last.y
    this.last.set(e.clientX, e.clientY)
    if (this.drag === 'orbit') {
      const k = 0.005 * this.sensitivity
      this.yaw -= dx * k
      // Looking up is only useful when flying; on the ground the camera stays above the target.
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k * (this.invertY ? -1 : 1), this.followGround ? 0.08 : -1.45, 1.52)
    } else {
      const s = this.distance * 0.0016
      // Grab-the-ground: forward = camera→target, right = forward × up.
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      this.target.x += (fz * dx + fx * dy) * s
      this.target.z += (-fx * dx + fz * dy) * s
      this.clampTarget()
    }
  }

  private onUp = (e: PointerEvent) => {
    if ((e.button === 2 && this.drag === 'orbit') || (e.button === 1 && this.drag === 'pan')) this.drag = null
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault() // also stops Ctrl+wheel from zooming the webview
    if (this.wheelBlocked(e)) return
    const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0012)
    this.distance = THREE.MathUtils.clamp(this.distance * f, this.minDistance, this.maxDistance)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.code.startsWith('Arrow') && this.arrowsBlocked()) return
    this.keys.add(e.code)
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -this.bounds * 0.1, this.bounds * 1.1)
    this.target.z = THREE.MathUtils.clamp(this.target.z, -this.bounds * 0.1, this.bounds * 1.1)
  }

  update(dt: number) {
    const k = this.keys
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1
    let fwd = 0, right = 0
    const arrows = !this.arrowsBlocked()
    if (k.has('KeyW') || (arrows && k.has('ArrowUp'))) fwd += 1
    if (k.has('KeyS') || (arrows && k.has('ArrowDown'))) fwd -= 1
    if (k.has('KeyD') || (arrows && k.has('ArrowRight'))) right += 1
    if (k.has('KeyA') || (arrows && k.has('ArrowLeft'))) right -= 1
    if (k.has('KeyQ')) this.yaw += dt * 1.6 * this.sensitivity
    if (k.has('KeyE')) this.yaw -= dt * 1.6 * this.sensitivity

    if (fwd || right) {
      const speed = (20 + this.distance * 0.9) * fast * this.speed * dt
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      if (this.followGround) {
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
    if (k.has('Space') && !this.followGround) this.target.y += (20 + this.distance * 0.9) * fast * this.speed * dt
    if ((k.has('KeyX') || k.has('KeyC')) && !this.followGround) this.target.y -= (20 + this.distance * 0.9) * fast * this.speed * dt

    if (this.followGround) {
      // Glide the target height along the terrain.
      const gy = this.ground(this.target.x, this.target.z)
      this.smoothTargetY += (gy - this.smoothTargetY) * Math.min(1, dt * 8)
      this.target.y = this.smoothTargetY
    } else {
      this.smoothTargetY = this.target.y
    }

    const cp = Math.cos(this.pitch)
    const pos = this.camera.position
    pos.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    )
    if (this.followGround) {
      const floor = this.ground(pos.x, pos.z) + 1.5
      if (pos.y < floor) pos.y = floor
    }
    this.camera.lookAt(this.target)
  }

  dispose() {
    this.abort.abort()
  }
}
