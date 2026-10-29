// Toggling View > Server's mmaps keeps the dock at its width and the Layers rows' Replace and X buttons inside it (#770).
// touches: frontend/src/components/Dock.svelte, frontend/src/components/LayersPanel.svelte, frontend/src/App.svelte, frontend/src/lib/ui/keys.ts
const e = P.e
const { editor, prefs, ui } = await P.state()
e.newDocument(128, 'island', 3, 'DockNav')
await P.frames(5)
e.regenerateAutoPaint()
await P.frames(3)
editor.selection = { x0: 20, z0: 8, x1: 44, z1: 24 }
const settle = async (ms = 100) => {
	await P.frames(3)
	await new Promise((r) => setTimeout(r, ms))
}
await settle()
const snap = () => {
	const dock = document.querySelector('.dock')
	const d = dock.getBoundingClientRect()
	const btns = [...document.querySelectorAll('[data-ui="LayersPanel"] .row:not(.empty) button')]
	const clipped = btns.filter((b) => {
		const r = b.getBoundingClientRect()
		return r.width === 0 || r.right > d.right + 0.5 || r.left < d.left - 0.5
	}).length
	return { dockW: Math.round(d.width), dockL: Math.round(d.left), want: prefs.dockWidth, buttons: btns.length, clipped, winW: innerWidth, scrollW: document.documentElement.scrollWidth }
}
const before = snap()
const seen = [before]
for (let i = 0; i < 6; i++) {
	prefs.navServer = !(prefs.navView && prefs.navServer)
	if (prefs.navServer) prefs.navView = true
	for (let k = 0; k < 4; k++) {
		await settle(300)
		// What updateNav writes while it builds (and anything else long): a nowrap line must not widen the page.
		ui.status = 'Green is ground, orange slopes only creatures take, cyan shallow water, blue water only swimmers cross, red magma, yellow slime. '.repeat(8)
		await new Promise((r) => requestAnimationFrame(() => r()))
		seen.push(snap())
		ui.status = 'Ready'
	}
}
prefs.navServer = false
prefs.navView = false
editor.selection = null
const bad = seen.filter((s) => s.dockW !== before.dockW || s.dockL !== before.dockL || s.clipped || s.scrollW > s.winW)
return { ok: before.buttons > 0 && bad.length === 0, before, bad: bad.slice(0, 3) }
