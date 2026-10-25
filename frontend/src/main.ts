import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

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

const app = mount(App, {
	target: document.getElementById('app')!,
})

export default app
