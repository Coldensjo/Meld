// Tab hides the panels and the viewport fills the window below the menu bar; Tab again restores it (#248). In full screen the menu bar goes too (#1086).
// touches: frontend/src/App.svelte, frontend/src/components/MenuBar.svelte, frontend/src/components/Toolbar.svelte, frontend/src/lib/ui/menus.ts, frontend/src/lib/ui/keys.ts, frontend/src/lib/engine/display.ts
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
// Full screen (stubbed: headless Chrome refuses the request): the panels hidden and the menu bar gone, the canvas on the whole window.
tab()
await P.frames(3)
Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement })
document.dispatchEvent(new Event('fullscreenchange'))
await P.frames(5)
const fsNoMenu = !document.querySelector('[data-ui="MenuBar"]')
const fsBox = box()
const fsFills = Math.abs(fsBox.top - (hidden.top - menu.height)) <= 1 && fsBox.w === window.innerWidth && Math.abs(fsBox.h - (window.innerHeight - fsBox.top)) <= 1
tab()
await P.frames(5)
const fsPanelsBack = !!document.querySelector('[data-ui="MenuBar"]')
delete document.fullscreenElement
document.dispatchEvent(new Event('fullscreenchange'))
await P.frames(3)
const fills = Math.abs(hidden.w - window.innerWidth) <= 1 && hidden.top >= menu.bottom - 1
return {
	ok: fsNoMenu && fsFills && fsPanelsBack && toolbarGone && fills && hidden.w > before.w && hidden.h > before.h && after.w === before.w && after.h === before.h,
	before,
	fsNoMenu,
	fsFills,
	fsPanelsBack,
	hidden,
	after,
	window: [window.innerWidth, window.innerHeight],
}
