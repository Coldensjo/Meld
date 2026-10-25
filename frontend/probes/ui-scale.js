// Preferences › Interface size (#372): at 150 % the page is zoomed and still fits the window, the menus fit, the 3D canvas keeps one pixel per screen pixel, the pointer maps onto the canvas, the right-click menu opens under the pointer, and Ctrl+= / Ctrl+- / Ctrl+0 step the size.
// touches: frontend/src/lib/ui/uiScale.ts, frontend/src/components/Dock.svelte, frontend/src/components/Viewport.svelte
const { prefs, ui } = await P.state()
const r = {}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
const root = document.documentElement
const canvas = P.e.renderer.domElement
await P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)

prefs.uiScale = 1.5
await P.until(() => root.style.zoom === '1.5', 5000, 'the page zoomed to 1.5')
await P.frames(3)
r.zoomed = root.style.zoom === '1.5' && root.style.getPropertyValue('--ui-zoom') === '1.5'

// The app fills the window without running past it.
const app = document.querySelector('.app').getBoundingClientRect()
r.appFits = app.bottom <= innerHeight + 1 && app.right <= innerWidth + 1 && app.bottom >= innerHeight - 2

// The canvas's buffer matches its size on screen (CSS size times the zoom).
const cr = canvas.getBoundingClientRect()
const dpr = Math.min(devicePixelRatio * prefs.renderScale * 1.5, 3) / 1.5
r.canvas = { buf: [canvas.width, canvas.height], screen: [Math.round(cr.width), Math.round(cr.height)] }
r.sharp = near(canvas.width, cr.width * dpr, 3) && near(canvas.height, cr.height * dpr, 3)

// Pointer positions and the canvas's rect agree (both in window px): the window's own hit test finds
// the canvas just inside two corners of its rect (12 px in: the dock's resizer overlaps the right edge), and a pointer at a share of the rect gives the engine that share.
const inside = (x, y) => document.elementFromPoint(x, y) === canvas
r.hitTest = inside(cr.left + 12, cr.top + 12) && inside(cr.right - 12, cr.bottom - 12) && !inside(cr.right + 12, cr.top + 12)
P.pointer('pointermove', 0.25, 0.75)
await P.frames(1)
r.ndc = [+P.e.ndc.x.toFixed(3), +P.e.ndc.y.toFixed(3)]
r.pointerMaps = near(P.e.ndc.x, -0.5, 0.01) && near(P.e.ndc.y, -0.5, 0.01) && r.hitTest

// The longest menu (Preferences) fits the window.
const title = [...document.querySelectorAll('.menubar .menu > .title')].find((b) => b.textContent.trim() === 'Preferences')
title.click()
await P.frames(2)
const drop = document.querySelector('.menubar .dropdown')
const dr = drop?.getBoundingClientRect()
r.menuFits = !!dr && dr.bottom <= innerHeight + 1
r.menuHasSize = !!drop && [...drop.querySelectorAll('[role^="menuitem"]')].some((b) => b.textContent.includes('150 %'))
title.click()
await P.frames(2)

// The right-click menu's corner sits at the pointer's window position.
ui.contextMenu = { x: 300, y: 200, title: 'Probe', items: [{ label: 'Nothing', run: () => {} }] }
await P.frames(2)
const menu = document.querySelector('[role="menu"][aria-label="Probe"]')
const mr = menu?.getBoundingClientRect()
r.contextMenu = mr ? [Math.round(mr.left), Math.round(mr.top)] : null
r.contextAtPointer = !!mr && near(mr.left, 300) && near(mr.top, 200)
ui.contextMenu = null
await P.frames(1)

// Shares of the window (#580): the Log window's body and the dock's panel bodies stay within their share on screen, not 1.5x it.
ui.dialog = 'log'
await P.frames(3)
const logEl = document.querySelector('.log')
const lh = logEl?.getBoundingClientRect().height ?? 0
r.logShare = !!logEl && lh <= innerHeight * 0.6 + 1
ui.dialog = null
await P.frames(2)
const bodies = [...document.querySelectorAll('[data-ui="Dock"] .panel:not(.grow) .body')]
r.dockShare = bodies.every((b) => b.getBoundingClientRect().height <= innerHeight * 0.4 + 1)

// The shortcuts.
const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }))
document.activeElement?.blur?.()
key('=')
r.ctrlPlus = prefs.uiScale === 1.75
key('-')
key('-')
r.ctrlMinus = prefs.uiScale === 1.25
key('0')
r.ctrlZero = prefs.uiScale === 1
await P.frames(2)
r.unzoomed = root.style.zoom === ''

prefs.uiScale = 1
r.ok = r.zoomed && r.appFits && r.sharp && r.pointerMaps && r.menuFits && r.menuHasSize && r.contextAtPointer && r.ctrlPlus && r.ctrlMinus && r.ctrlZero && r.unzoomed && r.logShare && r.dockShare
return r
