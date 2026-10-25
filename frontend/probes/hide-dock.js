// The dock's ✕ hides the right dock alone and the viewport takes its width; View › Layers panel (prefs.dockHidden) brings it back, and Tab's hide-panels still works with it hidden (#653).
// touches: frontend/src/components/Dock.svelte, frontend/src/components/MenuBar.svelte, frontend/src/App.svelte
await P.frames(3)
const { prefs } = await P.state()
const was = prefs.dockHidden
prefs.dockHidden = false
await P.frames(3)
const width = () => Math.round(document.querySelector('canvas').getBoundingClientRect().width)
const before = width()
const dockW = Math.round(document.querySelector('[data-ui="Dock"]').getBoundingClientRect().width)
document.querySelector('[data-ui="Dock"] button[aria-label="Hide panel"]').click()
await P.frames(5)
const hidden = width()
const dockGone = !document.querySelector('[data-ui="Dock"]') && prefs.dockHidden === true
const tab = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
tab()
await P.frames(5)
const bare = width()
tab()
await P.frames(5)
const back = width()
const stillGone = !document.querySelector('[data-ui="Dock"]')
prefs.dockHidden = false
await P.frames(5)
const shown = width()
prefs.dockHidden = was
return {
	ok: dockGone && Math.abs(hidden - before - dockW) <= 2 && Math.abs(bare - window.innerWidth) <= 1 && back === hidden && stillGone && shown === before,
	before,
	dockW,
	hidden,
	bare,
	back,
	shown,
}
