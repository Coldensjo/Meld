// The camera's four views (#750): Camera › Orbit View, Flying View, Walking View and Top-down View, each
// picked from the menu's radio items and by its key (F2, F3, F4, U), set the controller's
// `followGround`, `walk` and `topDown` and the engine's ortho camera; the menu marks the view it is in;
// Walking and Top-down toggle back to the view they came from; T switches Orbit and Flying. (Orbit View
// as the default is `tests/cameraView.test.ts`'s: the runner starts probes in Flying View, `P.flyingStart`.)
// touches: frontend/src/lib/ui/cameraView.ts, frontend/src/components/MenuBar.svelte, frontend/src/lib/ui/commands.ts, frontend/src/lib/ui/runCommand.ts, frontend/src/lib/engine/CameraController.ts
const e = P.e
const { prefs, ui } = await P.state()
const views = await P.app('/src/lib/ui/cameraView.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(2)
const c = e.controller
const r = {}
const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const flags = () => ({ follow: c.followGround, walk: c.walk, top: ui.topDown, ortho: !!e.camera.isOrthographicCamera })
const is = (f, want) => Object.entries(want).every(([k, v]) => f[k] === v)
const WANT = {
	orbit: { follow: true, walk: false, top: false, ortho: false },
	flying: { follow: false, walk: false, top: false, ortho: false },
	walking: { follow: false, walk: true, top: false, ortho: false },
	topDown: { top: true, ortho: true },
}

// The menu: each radio item puts the camera in its view and is the one marked.
const openCamera = async () => {
	;[...document.querySelectorAll('.menubar .menu > .title')].find((t) => t.textContent.trim() === 'Camera').click()
	await P.frames(2)
	return [...document.querySelectorAll('.menubar .dropdown [role="menuitemradio"]')]
}
const LABELS = { orbit: 'Orbit View', flying: 'Flying View', walking: 'Walking View', topDown: 'Top-down View' }
for (const v of ['orbit', 'walking', 'topDown', 'flying']) {
	// A radio item leaves the menu open, as the other menus' do.
	;(await openCamera()).find((b) => b.querySelector('.label').textContent.trim() === LABELS[v]).click()
	await P.frames(3)
	const items = [...document.querySelectorAll('.menubar .dropdown [role="menuitemradio"]')]
	const marked = items.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.querySelector('.label').textContent.trim())
	press('Escape')
	await P.frames(2)
	r[`menu ${v}`] = is(flags(), WANT[v]) && views.cameraView() === v && marked.length === 1 && marked[0] === LABELS[v]
}

// The keys: F2 Orbit, F3 Flying, F4 Walking (again: back), U Top-down (again: back), T Orbit/Flying.
press('F2')
await P.frames(3)
r.f2Orbit = is(flags(), WANT.orbit)
press('F4')
await P.frames(3)
r.f4Walks = is(flags(), WANT.walking)
press('u')
await P.frames(3)
r.uTopDown = is(flags(), WANT.topDown) && ui.walkCamera
press('u')
await P.frames(3)
r.uBackToWalk = is(flags(), WANT.walking)
press('F4')
await P.frames(3)
r.f4BackToOrbit = is(flags(), WANT.orbit)
press('F3')
await P.frames(3)
r.f3Flying = is(flags(), WANT.flying)
press('t')
await P.frames(3)
r.tOrbit = is(flags(), WANT.orbit)
press('t')
await P.frames(3)
r.tFlying = is(flags(), WANT.flying)

prefs.cameraFollowGround = false
await P.frames(2)
return { ok: Object.values(r).every((v) => v === true), r }
