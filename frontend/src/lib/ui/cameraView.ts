// The camera's four named views (#750): Camera › Orbit View, Flying View, Walking View and Top-down
// View. A view is no state of its own: it is read from, and set through, the three settings the
// camera already had (Follow the Ground, Walk and the top-down view), so a saved Follow the Ground
// and an old scene's `cameraFollowGround` keep meaning Orbit (true) or Flying (false).
import { prefs, setStatus, ui } from '../state/editor.svelte'
import { keyHint, keysOf } from './commands'

export type CameraView = 'orbit' | 'flying' | 'walking' | 'topDown'

/** The menu's order and names. */
export const CAMERA_VIEWS: ReadonlyArray<{ id: CameraView; label: string }> = [
	{ id: 'orbit', label: 'Orbit View' },
	{ id: 'flying', label: 'Flying View' },
	{ id: 'walking', label: 'Walking View' },
	{ id: 'topDown', label: 'Top-down View' },
]

/** The settings a view is made of: `prefs.cameraFollowGround`, `ui.walkCamera` and `ui.topDown`. */
export interface ViewSettings {
	followGround: boolean
	walk: boolean
	topDown: boolean
}

/** The view the settings show: the top-down view over a walk (which it pauses), a walk over Follow the Ground. */
export function viewOf(s: ViewSettings): CameraView {
	if (s.topDown) return 'topDown'
	if (s.walk) return 'walking'
	return s.followGround ? 'orbit' : 'flying'
}

/**
 * The settings for view `v` from `s`. Orbit and Flying end a walk and the top-down view. Walking keeps
 * Follow the Ground, the camera the walk returns to, and the top-down view keeps both, so turning it
 * off goes back to the view it was turned on from.
 */
export function withView(s: ViewSettings, v: CameraView): ViewSettings {
	switch (v) {
		case 'orbit':
			return { followGround: true, walk: false, topDown: false }
		case 'flying':
			return { followGround: false, walk: false, topDown: false }
		case 'walking':
			return { followGround: s.followGround, walk: true, topDown: false }
		case 'topDown':
			return { ...s, topDown: true }
	}
}

const current = (): ViewSettings => ({ followGround: prefs.cameraFollowGround, walk: ui.walkCamera, topDown: ui.topDown })

/** The view the camera is in now. */
export function cameraView(): CameraView {
	return viewOf(current())
}

/** The status line a view says when it is picked. */
function viewStatus(v: CameraView): string {
	switch (v) {
		case 'orbit':
			return `Orbit View: the camera rides the ground; a right drag orbits, a middle drag pans, the wheel zooms${keyHint('flyingView', 'flies freely')}.`
		case 'flying':
			return `Flying View: ${keysOf('camForward')} goes where you look, ${keysOf('camUp')}/${keysOf('camDown')} up and down, the camera can enter caves${keyHint('orbitView', 'orbits the ground')}.`
		case 'walking':
			return `Walking View: ${keysOf('camForward')} ${keysOf('camLeft')} ${keysOf('camBack')} ${keysOf('camRight')} move at a run (Shift faster), the mouse looks around${keyHint('walkingView', 'again returns to your camera')}.`
		case 'topDown':
			return `Top-down View: the wheel zooms, the turn keys or a right drag turn the map${keyHint('topDown', 'returns to the 3D view')}.`
	}
}

/** Puts the camera in view `v`; picking the view it is in changes nothing. */
export function setCameraView(v: CameraView): void {
	const s = current()
	if (viewOf(s) === v) return
	const n = withView(s, v)
	prefs.cameraFollowGround = n.followGround
	ui.walkCamera = n.walk
	ui.topDown = n.topDown
	setStatus(viewStatus(v), 4000)
}

/**
 * Turns view `v` (Walking or Top-down) on, or off again: off, the camera goes back to the view it was
 * in before (the walk restores the camera it started from, #21).
 */
export function toggleCameraView(v: 'walking' | 'topDown'): void {
	if (cameraView() !== v) return setCameraView(v)
	if (v === 'topDown') ui.topDown = false
	else ui.walkCamera = false
	setStatus(`Back to ${CAMERA_VIEWS.find((c) => c.id === cameraView())?.label}.`, 3000)
}

/**
 * T (#750, Follow the Ground before it): Orbit View from Flying View and back. While walking or in the
 * top-down view it changes only the camera that view returns to, as Follow the Ground did.
 */
export function switchOrbitFlying(): void {
	const v = cameraView()
	if (v === 'orbit' || v === 'flying') return setCameraView(v === 'orbit' ? 'flying' : 'orbit')
	prefs.cameraFollowGround = !prefs.cameraFollowGround
	setStatus(`${prefs.cameraFollowGround ? 'Orbit View' : 'Flying View'} when the ${v === 'walking' ? 'walk' : 'top-down view'} ends.`, 3000)
}
