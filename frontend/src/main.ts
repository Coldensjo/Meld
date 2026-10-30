import { mount } from 'svelte'
import './app.css'
import { toolWindowKind } from './lib/toolwin/channel'

// No browser context menu (Back, Reload, Inspect...), except the copy/paste one in text fields.
window.addEventListener('contextmenu', (e) => {
	const el = e.target as HTMLElement | null
	if (el?.closest('input, textarea, [contenteditable="true"]')) return
	e.preventDefault()
})

// Keyboard focus ring (#652): shown only after Tab / Shift+Tab moved focus, and dropped on the next
// pointer press, so a clicked button doesn't get a ring when a shortcut key is pressed. The check waits
// a microtask because App's Tab handler (hide the panels) calls preventDefault after this one.
window.addEventListener(
	'keydown',
	(e) => {
		if (e.key !== 'Tab') return
		queueMicrotask(() => {
			if (!e.defaultPrevented) document.documentElement.dataset.kbdNav = ''
		})
	},
	true,
)
window.addEventListener('pointerdown', () => delete document.documentElement.dataset.kbdNav, true)

// A tool window open as its own OS window (`?window=<kind>`, #909, app_windows.go) mounts a light shell
// without the Engine or a map; the main page mounts the editor. Each is imported only where it runs, so a
// tool window doesn't load the editor's modules.
const target = document.getElementById('app')!
const kind = toolWindowKind(location.search)
if (kind) import('./components/toolwin/ToolShell.svelte').then(({ default: ToolShell }) => mount(ToolShell, { target, props: { kind } }))
else import('./App.svelte').then(({ default: App }) => mount(App, { target }))
