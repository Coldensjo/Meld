import * as THREE from 'three'

/**
 * What the per-frame layer updates share about the frame being drawn (#563): the camera and where it
 * stands, this frame's view frustum and a WMO room's gate, the clocks and the view's size. The Engine
 * owns one, filled at the start of each `simulate` (the room's gate once the cull has built it), and
 * hands it to `ParticleLayer`, `GroundEffectLayer`, `WeatherLayer`, `SpawnLabels`, `NavPreview` and the
 * `TransformGizmo`, each with its own options beside it. It is never allocated per frame.
 */
export interface FrameView {
	/** The camera the frame is drawn with: the perspective one, or the top-down one. */
	camera: THREE.Camera
	/** The drawing camera's position. */
	eye: THREE.Vector3
	/**
	 * Where the viewer stands, for what is built or sized around them: the camera's position, or in
	 * the top-down view a point the orbit's distance above the target, not the ortho camera high above.
	 */
	viewEye: THREE.Vector3
	/** The point the camera orbits (the controller's target). */
	target: THREE.Vector3
	/** The camera's frustum from this frame's view-projection, set before the cull. */
	frustum: THREE.Frustum
	/** With the camera in a WMO room, its doorways' frustums (none in a sealed room); null outside. */
	gate: THREE.Frustum[] | null
	/** Lets through what stands in a room the portal flood reached (#156); null outside a room. */
	gateAdmits: ((s: THREE.Sphere) => boolean) | null
	/** The object ID of the WMO the camera is in, whose own parts the gate leaves alone; -1 outside. */
	roomId: number
	/** Whether that WMO is one of the world streamed around a region (#897), whose ids are a layer of their own. */
	roomAround: boolean
	/** Whether spawns show through a room's walls (Show › Spawns Through Walls, #150). */
	spawnsThroughWalls: boolean
	/** The top-down view is on. */
	topDown: boolean
	/** Seconds since the loop started. */
	time: number
	/** The models' animation clock in ms: `time` in ms, or 0 with animations off (the loop's first frame). */
	animMs: number
	/** `performance.now()` at the frame's start, for layers that throttle their rebuilds. */
	now: number
	/** Seconds since the last frame, at most 0.1; 0 for a top-down shot. */
	dt: number
	/** The view's size in CSS pixels (the container's). */
	width: number
	height: number
	/** The drawing buffer's size in pixels. */
	bufferWidth: number
	bufferHeight: number
}

/** A view of `camera` at rest: no room, no gate, the clocks at 0. */
export function newFrameView(camera: THREE.Camera): FrameView {
	return {
		camera,
		eye: new THREE.Vector3(),
		viewEye: new THREE.Vector3(),
		target: new THREE.Vector3(),
		frustum: new THREE.Frustum(),
		gate: null,
		gateAdmits: null,
		roomId: -1,
		roomAround: false,
		spawnsThroughWalls: false,
		topDown: false,
		time: 0,
		animMs: 0,
		now: 0,
		dt: 0,
		width: 1,
		height: 1,
		bufferWidth: 1,
		bufferHeight: 1,
	}
}
