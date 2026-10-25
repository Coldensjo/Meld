import * as THREE from 'three'

/**
 * The camera's collision step (#434), out of `CameraController.update` so the order its rules hang on
 * is unit-tested (tests/cameraMove.test.ts) rather than only by the `wmo-collide` and `walk-wmo` probes:
 * the walker's walls before its floor (#312, #313), the flying camera's floor clamp before its walls
 * (#305, #310), and the near plane pulled in for a face within its reach (#304).
 */

/** How far above the ground the flying camera stays with camera collision on, in yards (Noggit Red's 3). */
export const COLLIDE_HEIGHT = 3
/** How far above the ground the walking (FPS) camera's eye is, in yards (Noggit Red's FPS camera: 3). */
export const WALK_HEIGHT = 3
/**
 * How far above the floor it stands on the walker finds the next one, in yards (#312): a stair or a
 * kerb up to this high is climbed, a roof or bridge higher up is walked under.
 */
export const WALK_STEP = 2

/** What the step reads of the camera: its mode, the ground, and the Engine's WMO hooks (`CameraController`'s fields). */
export interface CameraMoveRules {
	walk: boolean
	followGround: boolean
	topDown: boolean
	collision: boolean
	readonly ground: (x: number, z: number) => number
	/** Moves `to`, where the eye goes from `from`, to where the WMOs' walls stop it. */
	collideWalls: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null
	/** The floor under `at` given the ground's height there: a WMO's floor in one of its rooms. */
	collisionFloor: ((at: THREE.Vector3, ground: number, jumped: boolean) => number) | null
}

/** Two vectors the step writes its probes into, kept by the caller so a frame allocates nothing. */
export interface CameraMoveScratch {
	floor: THREE.Vector3
	wall: THREE.Vector3
}

/**
 * Collides the move of the eye from `settled` (where it was after the last step) to `target` (where
 * the keys put it), moving `target` to where it stops. `jumped` says it came there by a jump (a
 * teleport, a mode change), which is no move to collide. A following-ground camera is left alone.
 */
export function moveStep(target: THREE.Vector3, settled: THREE.Vector3, jumped: boolean, rules: CameraMoveRules, scratch: CameraMoveScratch): void {
	if (rules.walk) {
		// The walker stops at a WMO's walls as the client's player does (#313), always, as it always stands on
		// the WMOs' floors: the move is swept level at the eye, whose sphere reaches down to WALK_STEP over the
		// floor, so a wall too high to step over stops it and a kerb or stair doesn't. A jump isn't collided.
		if (rules.collideWalls && !jumped && (target.x !== settled.x || target.z !== settled.z)) {
			const to = scratch.wall.set(target.x, settled.y, target.z)
			rules.collideWalls(settled, to)
			target.x = to.x
			target.z = to.z
		}
		// From a step above the floor it stood on, or from the eye after a jump.
		const from = jumped ? target.y : settled.y - WALK_HEIGHT + WALK_STEP
		target.y = walkFloor(target, from, jumped, rules, scratch.floor) + WALK_HEIGHT
		return
	}
	if (rules.followGround || !rules.collision || rules.topDown) return
	let floor = rules.ground(target.x, target.z)
	if (rules.collisionFloor) {
		// From the higher of where the eye was and where it goes, so a fast drop through a floor still finds it.
		const p = scratch.floor.copy(target)
		if (!jumped) p.y = Math.max(p.y, settled.y)
		floor = rules.collisionFloor(p, floor, jumped)
	}
	target.y = Math.max(target.y, floor + COLLIDE_HEIGHT)
	// After the floor clamp: in a low room the floor + 3 yd can lie in a wall or a ceiling, and the walls win.
	if (rules.collideWalls && !jumped && !target.equals(settled)) rules.collideWalls(settled, target)
}

/**
 * The floor the walker stands on at `at`'s x/z (#312): the terrain, or in a WMO the floor the Engine's
 * hook finds at or below `fromY` (`collisionFloor`, the one the collision camera uses), so in a city it
 * walks the streets rather than the terrain under or over them. `probe` is scratch.
 */
export function walkFloor(at: THREE.Vector3, fromY: number, jumped: boolean, rules: CameraMoveRules, probe: THREE.Vector3): number {
	const ground = rules.ground(at.x, at.z)
	if (!rules.collisionFloor) return ground
	const p = probe.copy(at)
	p.y = fromY
	return rules.collisionFloor(p, ground, jumped)
}

/**
 * The floor camera collision keeps the eye over (#310), from the WMOs' highest floor at or below the eye
 * (-Infinity for none) and the terrain's height: in a WMO's room its floor, since in Stormwind the
 * terrain runs both above and below the streets; elsewhere the higher of the two, so a roof is a floor too.
 */
export function roomFloor(inRoom: boolean, wmoFloor: number, ground: number): number {
	return inRoom && wmoFloor > -Infinity ? wmoFloor : Math.max(ground, wmoFloor)
}

/** How much further than its depth a point in the view frustum can lie from the eye: at a corner of the near plane. */
export function cornerFactor(fovDeg: number, aspect: number): number {
	const t = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
	return Math.sqrt(1 + t * t * (1 + aspect * aspect))
}

/**
 * The near plane for a WMO face `wallDist` yd from the eye (#304): every point in the view frustum at
 * depth z lies within z·`corner` of the eye, so a plane at the face's distance over `corner` clips none
 * of it; never nearer than `nearMin`, and `near` while no face is that close.
 */
export function nearPlane(wallDist: number, corner: number, near: number, nearMin: number): number {
	return THREE.MathUtils.clamp(wallDist / corner, nearMin, near)
}
