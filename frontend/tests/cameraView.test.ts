// The camera's four named views (#750): each is read from Follow the Ground, Walk and the top-down
// view, and picking one sets them, ending the view it leaves.
import './runes.ts'
import { describe, expect, test } from 'bun:test'
import type { ViewSettings } from '../src/lib/ui/cameraView'

const { prefs, ui } = await import('../src/lib/state/editor.svelte.ts')
const { cameraView, setCameraView, switchOrbitFlying, toggleCameraView, viewOf, withView } = await import('../src/lib/ui/cameraView.ts')

const S = (followGround: boolean, walk: boolean, topDown: boolean): ViewSettings => ({ followGround, walk, topDown })

describe('viewOf', () => {
	test('Follow the Ground is Orbit, off is Flying', () => {
		expect(viewOf(S(true, false, false))).toBe('orbit')
		expect(viewOf(S(false, false, false))).toBe('flying')
	})
	test('a walk is Walking whatever Follow the Ground says', () => {
		expect(viewOf(S(true, true, false))).toBe('walking')
		expect(viewOf(S(false, true, false))).toBe('walking')
	})
	test('the top-down view wins over a walk it pauses', () => {
		expect(viewOf(S(false, true, true))).toBe('topDown')
		expect(viewOf(S(true, false, true))).toBe('topDown')
	})
})

describe('withView', () => {
	test('each view reads back as itself from every start', () => {
		for (const f of [false, true]) for (const w of [false, true]) for (const t of [false, true]) for (const v of ['orbit', 'flying', 'walking', 'topDown'] as const) expect(viewOf(withView(S(f, w, t), v))).toBe(v)
	})
	test('Orbit and Flying end a walk and the top-down view', () => {
		expect(withView(S(false, true, true), 'orbit')).toEqual(S(true, false, false))
		expect(withView(S(true, true, true), 'flying')).toEqual(S(false, false, false))
	})
	test('Walking keeps the camera it returns to, and leaves the top-down view', () => {
		expect(withView(S(true, false, true), 'walking')).toEqual(S(true, true, false))
		expect(withView(S(false, false, false), 'walking')).toEqual(S(false, true, false))
	})
	test('Top-down keeps the view under it', () => {
		expect(withView(S(false, true, false), 'topDown')).toEqual(S(false, true, true))
		expect(withView(S(true, false, false), 'topDown')).toEqual(S(true, false, true))
	})
})

describe('the commands', () => {
	const start = (f: boolean, w = false, t = false) => {
		prefs.cameraFollowGround = f
		ui.walkCamera = w
		ui.topDown = t
	}

	test('Orbit View is the default', () => {
		expect(prefs.cameraFollowGround).toBe(true)
		expect(cameraView()).toBe('orbit')
	})
	test('picking a view sets the settings', () => {
		start(true)
		setCameraView('flying')
		expect(prefs.cameraFollowGround).toBe(false)
		setCameraView('walking')
		expect(ui.walkCamera).toBe(true)
		setCameraView('orbit')
		expect([prefs.cameraFollowGround, ui.walkCamera, ui.topDown]).toEqual([true, false, false])
	})
	test('Walking and Top-down toggle back to the view they came from', () => {
		start(false)
		toggleCameraView('walking')
		expect(cameraView()).toBe('walking')
		toggleCameraView('topDown')
		expect(cameraView()).toBe('topDown')
		toggleCameraView('topDown')
		expect(cameraView()).toBe('walking')
		toggleCameraView('walking')
		expect(cameraView()).toBe('flying')
	})
	test('T switches Orbit and Flying, and while walking only the camera the walk returns to', () => {
		start(true)
		switchOrbitFlying()
		expect(cameraView()).toBe('flying')
		switchOrbitFlying()
		expect(cameraView()).toBe('orbit')
		start(true, true)
		switchOrbitFlying()
		expect(cameraView()).toBe('walking')
		expect(prefs.cameraFollowGround).toBe(false)
	})
})
