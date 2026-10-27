// The minimap in the dock (#749): attached (`prefs.minimapDocked`), M shows it as a square panel above Layers, at the dock's width, and shows a hidden dock too; its ⇱ detaches it into the floating window and the window's ⇥ attaches it again; M hides it in either place. A new Small Mountains world (the same size as the start map, so both terrains stand at heights version 1) is drawn with its ground, not the old picture. Nothing written.
// touches: frontend/src/components/MinimapView.svelte, frontend/src/components/MinimapWindow.svelte, frontend/src/components/Dock.svelte, frontend/src/components/DockPanel.svelte, frontend/src/lib/ui/minimap.ts, frontend/src/lib/io/minimapImage.ts
const { ui, prefs } = await P.state()
const was = { docked: prefs.minimapDocked, hidden: prefs.dockHidden, minimap: ui.minimap }
const r = {}
const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
const docked = () => document.querySelector('[data-ui="Dock"] [aria-label="Minimap"]')
const floating = () => document.querySelector('aside[aria-label="Minimap"]')
/** The share of the minimap's pixels drawn as water. */
const blueShare = () => {
	const c = document.querySelector('[aria-label="Minimap"] canvas')
	const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
	let blue = 0
	for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 30) blue++
	return +(blue / (d.length / 4)).toFixed(2)
}

ui.minimap = false
prefs.minimapDocked = true
prefs.dockHidden = true
await P.frames(3)
press()
await P.until(() => docked(), 5000, 'the minimap in the dock')
// A fresh canvas is 300 wide (the HTML default) until the first 2 Hz stats refresh draws the heights into it, so wait for the map's size, not any width (#757).
await P.until(() => P.e && docked().querySelector('canvas').width === P.e.terrain.size, 5000, 'the minimap drawn').catch(() => null)
r.dockShown = !prefs.dockHidden
const panels = [...document.querySelectorAll('[data-ui="Dock"] .panel .tab')].map((t) => t.textContent.trim())
r.panels = panels
const map = docked().querySelector('.map').getBoundingClientRect()
const dock = document.querySelector('[data-ui="Dock"]').getBoundingClientRect()
r.map = [Math.round(map.width), Math.round(map.height)]
r.dockW = Math.round(dock.width)
r.canvasCells = docked().querySelector('canvas').width === P.e.terrain.size

docked().closest('.panel').querySelector('button[aria-label="Detach the minimap"]').click()
await P.frames(3)
r.detached = !docked() && !!floating() && prefs.minimapDocked === false
press()
await P.frames(3)
r.hiddenFloating = !floating() && !ui.minimap
press()
await P.frames(3)
floating().querySelector('button[aria-label="Attach the minimap to the dock"]').click()
await P.frames(3)
r.attached = !!docked() && !floating() && prefs.minimapDocked === true
press()
await P.frames(3)
r.hiddenDocked = !docked() && !ui.minimap
press()
await P.until(() => docked(), 5000, 'the minimap in the dock again')

// A new world of the start map's size.
const size0 = P.e.terrain.size
ui.newMapMode = 'new'
ui.showNewDialog = true
const d = await P.until(() => (document.querySelector('[data-tilegrid] canvas') ? P.dialog('Start') : null), 10_000, 'the Start dialog')
;[...d.querySelectorAll('.size')].find((b) => b.textContent.includes('Small')).click()
const input = d.querySelector('input[type=text]')
input.value = 'ProbeMinimap'
input.dispatchEvent(new Event('input', { bubbles: true }))
;[...d.querySelectorAll('.preset')].find((b) => b.textContent.includes('Mountains')).click()
await P.frames(1)
;[...d.querySelectorAll('footer button')].find((b) => b.textContent.includes('Create world')).click()
await P.until(() => P.e.activeVmangos()?.dir === 'ProbeMinimap', 30_000, 'the new world')
r.sameSize = P.e.terrain.size === size0
await P.until(() => blueShare() < 0.9, 5000, 'the new ground on the minimap').catch(() => null)
r.newWorldBlue = blueShare()

prefs.minimapDocked = was.docked
prefs.dockHidden = was.hidden
ui.minimap = was.minimap
return {
	ok:
		r.dockShown &&
		panels[0] === 'Minimap' &&
		panels[1] === 'Layers' &&
		Math.abs(r.map[0] - r.map[1]) <= 1 &&
		r.map[0] >= Math.min(r.dockW, window.innerHeight * 0.4) - 6 &&
		r.canvasCells &&
		r.detached &&
		r.hiddenFloating &&
		r.attached &&
		r.hiddenDocked &&
		r.newWorldBlue < 0.9,
	...r,
}
