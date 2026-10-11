import * as THREE from 'three'

export type GizmoHandle = 'ring' | 'arrow'

const RING_COLOR = 0xf2f5fa
const ARROW_COLOR = 0x5ad15a
const HOVER_COLOR = 0x4b9cf5

function handleMaterial(color: number) {
  // Drawn on top of everything so the handles are always reachable.
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 })
}

/**
 * On-object handles for the selected prop: a ring around its base to spin it
 * and a double-headed arrow above it to raise/lower it. Invisible, fatter
 * "hit" meshes make the handles easy to grab.
 */
export class TransformGizmo {
  readonly group = new THREE.Group()
  private ring: THREE.Mesh
  private ringHit: THREE.Mesh
  private arrow = new THREE.Group()
  private arrowHit: THREE.Mesh
  private ringMat = handleMaterial(RING_COLOR)
  private arrowMat = handleMaterial(ARROW_COLOR)
  private hovered: GizmoHandle | null = null
  private ringKey = ''

  constructor() {
    const hidden = new THREE.MeshBasicMaterial({ visible: false })
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 64), this.ringMat)
    this.ring.rotation.x = Math.PI / 2
    this.ringHit = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 4, 32), hidden)
    this.ringHit.rotation.x = Math.PI / 2

    // Unit arrow: shaft from -0.35..0.35 with cones at both ends (height 1 total).
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), this.arrowMat)
    const up = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.25, 12), this.arrowMat)
    up.position.y = 0.475
    const down = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.25, 12), this.arrowMat)
    down.position.y = -0.475
    down.rotation.x = Math.PI
    this.arrow.add(shaft, up, down)
    this.arrowHit = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8), hidden)
    this.arrow.add(this.arrowHit)

    this.group.add(this.ring, this.ringHit, this.arrow)
    this.group.traverse((o) => (o.renderOrder = 1000))
    this.group.visible = false
  }

  /**
   * Position the handles for an object whose origin is at `base`, with a
   * footprint `radius` and top at `topY`. `camDist` keeps them a sensible
   * on-screen size.
   */
  update(base: THREE.Vector3, radius: number, topY: number, camDist: number) {
    this.group.visible = true
    const r = Math.max(1, radius)
    // Tube thickness follows camera distance so the ring stays visible/grabbable.
    const tube = THREE.MathUtils.clamp(camDist * 0.003, 0.04, 1.5)
    // Rebuild only on noticeable change (quantised), not every frame.
    const key = `${Math.round(r * 10)}|${Math.round(Math.log(tube) * 8)}`
    if (key !== this.ringKey) {
      this.ringKey = key
      this.ring.geometry.dispose()
      this.ringHit.geometry.dispose()
      this.ring.geometry = new THREE.TorusGeometry(r, tube, 6, 72)
      this.ringHit.geometry = new THREE.TorusGeometry(r, tube * 5, 4, 36)
    }
    for (const m of [this.ring, this.ringHit]) m.position.set(base.x, base.y + 0.15, base.z)
    const len = THREE.MathUtils.clamp(camDist * 0.1, 1.5, 40)
    this.arrow.position.set(base.x, topY + len * 0.75, base.z)
    this.arrow.scale.setScalar(len)
  }

  hide() {
    this.group.visible = false
    this.setHover(null)
  }

  get visible() {
    return this.group.visible
  }

  pick(raycaster: THREE.Raycaster): GizmoHandle | null {
    if (!this.group.visible) return null
    this.group.updateMatrixWorld(true)
    const hits = raycaster.intersectObjects([this.arrowHit, this.ringHit], false)
    if (!hits.length) return null
    return hits[0].object === this.arrowHit ? 'arrow' : 'ring'
  }

  setHover(h: GizmoHandle | null) {
    if (h === this.hovered) return
    this.hovered = h
    this.ringMat.color.set(h === 'ring' ? HOVER_COLOR : RING_COLOR)
    this.arrowMat.color.set(h === 'arrow' ? HOVER_COLOR : ARROW_COLOR)
  }

  /** World Y of the ring plane (used for rotation dragging). */
  get ringY() {
    return this.ring.position.y
  }
}
