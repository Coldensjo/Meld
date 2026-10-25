import * as THREE from 'three'

export type GizmoHandle = 'ring' | 'arrow' | 'scale' | 'moveX' | 'moveZ'

const IDLE = new THREE.Color(0xf2f5fa)
const HOVER = new THREE.Color(0x4b9cf5)
/** The move arrows' colours: x red and z blue, as most editors draw their axes; a hovered one goes white. */
const AXIS_X = new THREE.Color(0xe5534b)
const AXIS_Z = new THREE.Color(0x3d8bfd)

/**
 * The ring is one flat annulus drawn by a shader: a thin band with a soft edge, a tick every 15°
 * (longer every 90°), and while spinning a filled arc from the drag's start angle to the current
 * one, so the turn reads at a glance. Radii are in the ring's local units (1 = the band radius).
 */
const ringVert = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const ringFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uWidth;      // half-width of the band, local units
  uniform float uSweepStart; // radians, same convention as GizmoDrag.ringAngle
  uniform float uSweep;      // signed radians, 0 = no arc
  varying vec2 vLocal;
  const float PI = 3.14159265;
  void main() {
    float r = length(vLocal);
    // The ring lies flat with local y pointing to world -z, so this equals GizmoDrag.ringAngle.
    float ang = atan(vLocal.y, vLocal.x);
    float aa = fwidth(r) * 1.2;
    // Band: solid between 1-w and 1+w, feathered by one pixel.
    float band = 1.0 - smoothstep(uWidth - aa, uWidth + aa, abs(r - 1.0));
    // Ticks: every 15 deg from the band outward, every 90 deg longer and brighter.
    float deg = degrees(ang);
    float d15 = abs(mod(deg + 7.5, 15.0) - 7.5);
    float d90 = abs(mod(deg + 45.0, 90.0) - 45.0);
    float tickW = degrees(uWidth * 0.9 / max(r, 0.01));
    float tick15 = (1.0 - smoothstep(tickW, tickW + degrees(aa), d15)) * step(1.0 + uWidth, r) * (1.0 - step(1.0 + uWidth * 3.5, r));
    float tick90 = (1.0 - smoothstep(tickW * 1.4, tickW * 1.4 + degrees(aa), d90)) * step(1.0 + uWidth, r) * (1.0 - step(1.0 + uWidth * 6.0, r));
    float ticks = max(tick15 * 0.55, tick90);
    // Sweep arc: filled fan inside the band between the start angle and the current one.
    float swept = 0.0;
    if (abs(uSweep) > 0.0005) {
      float d = uSweep > 0.0 ? mod(ang - uSweepStart, 2.0 * PI) : mod(uSweepStart - ang, 2.0 * PI);
      swept = step(d, abs(uSweep)) * step(r, 1.0 - uWidth) * step(0.55, r);
      swept *= 0.22 + 0.18 * smoothstep(0.55, 1.0 - uWidth, r);
    }
    float a = max(max(band * 0.95, ticks * 0.9), swept);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

function handleMaterial(color: THREE.Color) {
	// Drawn on top of everything so the handles are always reachable.
	return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 })
}

/**
 * On-object handles for the selected prop: a ring around its base to spin it, a double-headed
 * arrow above it to raise/lower it, and a square knob on the ring (at the camera's right) to drag
 * away from the prop to grow it or toward it to shrink it. Invisible, fatter "hit" meshes make
 * the handles easy to grab.
 */
export class TransformGizmo {
	readonly group = new THREE.Group()
	private ring: THREE.Mesh
	private ringHit: THREE.Mesh
	private arrow = new THREE.Group()
	private arrowHit: THREE.Mesh
	private knob: THREE.Mesh
	private knobHit: THREE.Mesh
	private ringMat: THREE.ShaderMaterial
	private arrowMat = handleMaterial(IDLE.clone())
	private knobMat = handleMaterial(IDLE.clone())
	/** The move arrows along x and z, in a group turned by the yaw in local space. */
	private axes = new THREE.Group()
	private moveX: THREE.Group
	private moveZ: THREE.Group
	private moveXHit: THREE.Mesh
	private moveZHit: THREE.Mesh
	private xMat = handleMaterial(AXIS_X.clone())
	private zMat = handleMaterial(AXIS_Z.clone())
	private right = new THREE.Vector3()
	private up = new THREE.Vector3(0, 1, 0)
	private hovered: GizmoHandle | null = null
	private ringKeyR = NaN
	private ringKeyTube = NaN

	constructor() {
		const hidden = new THREE.MeshBasicMaterial({ visible: false })
		this.ringMat = new THREE.ShaderMaterial({
			vertexShader: ringVert,
			fragmentShader: ringFrag,
			uniforms: {
				uColor: { value: IDLE.clone() },
				uWidth: { value: 0.02 },
				uSweepStart: { value: 0 },
				uSweep: { value: 0 },
			},
			transparent: true,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		// A unit annulus; `update` scales it to the prop's footprint and sets the band width.
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.2, 128, 1), this.ringMat)
		this.ring.rotation.x = -Math.PI / 2
		this.ringHit = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 4, 32), hidden)
		this.ringHit.rotation.x = Math.PI / 2

		// Unit arrow: a slim shaft from -0.5..0.5 with chevron-like cones at both ends and a pill grip
		// in the middle to grab.
		const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 8), this.arrowMat)
		const up = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 16), this.arrowMat)
		up.position.y = 0.5
		const down = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 16), this.arrowMat)
		down.position.y = -0.5
		down.rotation.x = Math.PI
		const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 12), this.arrowMat)
		this.arrow.add(shaft, up, down, grip)
		this.arrowHit = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8), hidden)
		this.arrow.add(this.arrowHit)

		// Unit scale knob: a flat square lying on the ring plane, with a fatter hit box.
		this.knob = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 1), this.knobMat)
		this.knobHit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), hidden)
		this.knob.add(this.knobHit)

		// Unit move arrows: a shaft along +y from 0 to 0.8 and a cone tip, turned onto x and onto z.
		const axisArrow = (mat: THREE.Material): [THREE.Group, THREE.Mesh] => {
			const g = new THREE.Group()
			const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 8), mat)
			shaft.position.y = 0.4
			const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), mat)
			tip.position.y = 0.9
			const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.05, 8), hidden)
			hit.position.y = 0.52
			g.add(shaft, tip, hit)
			return [g, hit]
		}
		;[this.moveX, this.moveXHit] = axisArrow(this.xMat)
		this.moveX.rotation.z = -Math.PI / 2
		;[this.moveZ, this.moveZHit] = axisArrow(this.zMat)
		this.moveZ.rotation.x = Math.PI / 2
		this.axes.add(this.moveX, this.moveZ)

		this.group.add(this.ring, this.ringHit, this.arrow, this.knob, this.axes)
		this.group.traverse((o) => (o.renderOrder = 1000))
		this.group.visible = false
	}

	/**
	 * Position the handles for an object whose origin is at `base`, with a
	 * footprint `radius` and top at `topY`. `camPos` keeps them a sensible
	 * on-screen size and puts the scale knob at the camera's right; `scalable`
	 * false hides the knob (a WMO is always full size in the client). With `movable` the x and z move
	 * arrows stand out from the ring, turned by `yaw` (the model's, in local space; 0 along the world axes).
	 */
	update(base: THREE.Vector3, radius: number, topY: number, camPos: THREE.Vector3, scalable: boolean, movable = false, yaw = 0) {
		this.group.visible = true
		const camDist = camPos.distanceTo(base)
		const r = Math.max(1, radius)
		// Band thickness follows camera distance so the ring stays visible/grabbable.
		const tube = THREE.MathUtils.clamp(camDist * 0.0025, 0.03, 1.2)
		this.ring.scale.setScalar(r)
		this.ringMat.uniforms.uWidth.value = tube / r
		// The hit torus is rebuilt only on a noticeable change (quantised), not every frame.
		const keyR = Math.round(r * 10)
		const keyTube = Math.round(Math.log(tube) * 8)
		if (keyR !== this.ringKeyR || keyTube !== this.ringKeyTube) {
			this.ringKeyR = keyR
			this.ringKeyTube = keyTube
			this.ringHit.geometry.dispose()
			this.ringHit.geometry = new THREE.TorusGeometry(r, tube * 5, 4, 36)
		}
		this.ring.position.set(base.x, base.y + 0.15, base.z)
		this.ringHit.position.set(base.x, base.y + 0.15, base.z)
		const len = THREE.MathUtils.clamp(camDist * 0.1, 1.5, 40)
		this.arrow.position.set(base.x, topY + len * 0.75, base.z)
		this.arrow.scale.setScalar(len)
		this.axes.visible = movable
		if (movable) {
			this.axes.position.set(base.x, base.y + 0.15, base.z)
			this.axes.rotation.y = yaw
			// From just outside the ring, as long as the height arrow.
			this.moveX.position.set(r, 0, 0)
			this.moveZ.position.set(0, 0, r)
			this.moveX.scale.setScalar(len)
			this.moveZ.scale.setScalar(len)
		}
		// The knob sits on the ring where the camera's right crosses it, so a sideways drag resizes.
		this.knob.visible = scalable
		if (scalable) {
			this.right.copy(camPos).sub(base).setY(0)
			if (this.right.lengthSq() < 1e-6) this.right.set(0, 0, 1)
			// up x (towards camera) is the camera's right on the ground.
			this.right.normalize().crossVectors(this.up, this.right).normalize()
			const size = THREE.MathUtils.clamp(camDist * 0.022, 0.3, 3)
			this.knob.position.set(base.x + this.right.x * r, base.y + 0.15, base.z + this.right.z * r)
			this.knob.scale.setScalar(size)
			this.knob.rotation.y = Math.atan2(this.right.x, this.right.z)
		}
	}

	hide() {
		this.group.visible = false
		this.setHover(null)
		this.setSweep(0, 0)
	}

	get visible() {
		return this.group.visible
	}

	pick(raycaster: THREE.Raycaster): GizmoHandle | null {
		if (!this.group.visible) return null
		this.group.updateMatrixWorld(true)
		const targets = [this.arrowHit, this.ringHit]
		if (this.knob.visible) targets.unshift(this.knobHit)
		if (this.axes.visible) targets.unshift(this.moveXHit, this.moveZHit)
		const hits = raycaster.intersectObjects(targets, false)
		if (!hits.length) return null
		const first = hits[0].object
		return first === this.arrowHit ? 'arrow' : first === this.knobHit ? 'scale' : first === this.moveXHit ? 'moveX' : first === this.moveZHit ? 'moveZ' : 'ring'
	}

	/** The handle under the pointer, lit by `setHover`, or null. */
	get hoveredHandle(): GizmoHandle | null {
		return this.hovered
	}

	setHover(h: GizmoHandle | null) {
		if (h === this.hovered) return
		this.hovered = h
		;(this.ringMat.uniforms.uColor.value as THREE.Color).copy(h === 'ring' ? HOVER : IDLE)
		this.arrowMat.color.copy(h === 'arrow' ? HOVER : IDLE)
		this.knobMat.color.copy(h === 'scale' ? HOVER : IDLE)
		this.xMat.color.copy(h === 'moveX' ? IDLE : AXIS_X)
		this.zMat.color.copy(h === 'moveZ' ? IDLE : AXIS_Z)
	}

	/** The world direction a move arrow drags along, on the ground: the axis turned by the gizmo's yaw. */
	axisDir(handle: 'moveX' | 'moveZ', out: THREE.Vector3): THREE.Vector3 {
		const yaw = this.axes.rotation.y
		// A turn of yaw about y takes x to (cos, 0, -sin) and z to (sin, 0, cos).
		return handle === 'moveX' ? out.set(Math.cos(yaw), 0, -Math.sin(yaw)) : out.set(Math.sin(yaw), 0, Math.cos(yaw))
	}

	/** Fill the arc the current spin drag has swept, from `start` (GizmoDrag.ringAngle) by `delta` radians. */
	setSweep(start: number, delta: number) {
		this.ringMat.uniforms.uSweepStart.value = start
		this.ringMat.uniforms.uSweep.value = delta
	}

	/** World Y of the ring plane (used for rotation dragging). */
	get ringY() {
		return this.ring.position.y
	}
}
