// Tab hides the panels and the viewport fills the window below the menu bar; Tab again restores it (#248).
// touches: frontend/src/App.svelte, frontend/src/components/MenuBar.svelte, frontend/src/components/Toolbar.svelte
// tier: smoke
await P.frames(3)
const tab = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
const box = () => {
	const r = document.querySelector('canvas').getBoundingClientRect()
	return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }
}
const before = box()
tab()
await P.frames(5)
const hidden = box()
const menu = document.querySelector('[data-ui="MenuBar"]').getBoundingClientRect()
const toolbarGone = !document.querySelector('[data-ui="Toolbar"]')
tab()
await P.frames(5)
const after = box()
const fills = Math.abs(hidden.w - window.innerWidth) <= 1 && hidden.top >= menu.bottom - 1
return {
	ok: toolbarGone && fills && hidden.w > before.w && hidden.h > before.h && after.w === before.w && after.h === before.h,
	before,
	hidden,
	after,
	window: [window.innerWidth, window.innerHeight],
}
