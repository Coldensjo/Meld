// Where the minimap is shown (#749): attached to the dock above Layers (`prefs.minimapDocked`, the
// default) or detached into a floating window. `ui.minimap` (M) shows or hides it in either place.
import { prefs, setStatus, ui } from '../state/editor.svelte'

/** Shows the dock if it was hidden, so an attached minimap can be seen; says so when Tab's hide-panels keeps it out. */
function revealDock() {
	if (prefs.dockHidden) {
		prefs.dockHidden = false
		ui.replaceSlot = null
	}
	if (ui.hidePanels) setStatus('The minimap is in the dock, hidden with the panels: Tab shows them again.', 4000)
}

/** M and Camera › Minimap: shows or hides the minimap where it is. */
export function toggleMinimap() {
	ui.minimap = !ui.minimap
	if (ui.minimap && prefs.minimapDocked) revealDock()
}

/** Moves the floating minimap into the dock, above Layers. */
export function attachMinimap() {
	prefs.minimapDocked = true
	ui.minimap = true
	revealDock()
}

/** Takes the minimap out of the dock into a floating window. */
export function detachMinimap() {
	prefs.minimapDocked = false
	ui.minimap = true
}
