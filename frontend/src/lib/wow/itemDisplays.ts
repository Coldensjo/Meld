import { ListItemDisplays } from '../wails/App'
import type { vmangos } from '../wails/models'

// The client's item displays, which the item editor's look picker lists (components/ItemLookPicker.svelte).
// The list is read once a session; forgetLooks drops it after a display was added. Kept out of the
// component so the main page can forget it when the item editor saves in its own window (#912).
let displays: Promise<vmangos.ItemDisplayEntry[]> | null = null

export function loadItemDisplays(): Promise<vmangos.ItemDisplayEntry[]> {
	if (!displays) {
		displays = ListItemDisplays().then((d) => d ?? [])
		displays.catch(() => (displays = null))
	}
	return displays
}

/** Drops the display list, after a display was added or an item's display changed. */
export function forgetLooks() {
	displays = null
}
