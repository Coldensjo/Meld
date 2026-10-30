// The two sides of the creature editor's map actions (#915, spawnFields.ts). In the main page they run on
// the Engine and the editor state; in an editor's own window they are `map` commands to the main page, and
// what the spawn fields read is the copy the main page publishes (EditorToolWindow.svelte sets it here).
import { editor, ui } from '../state/editor.svelte'
import { engineRef } from '../state/engineRef'
import type { vmangos } from '../wails/models'
import { selectSpawn } from '../world/spawnEdits'
import { spawnKey } from '../world/spawnKey'
import { editorPageKind, sendEditorCommand } from './editorPage'
import { localSpawnActions, spawnPanel } from './inspectorHost'
import { NO_SPAWN_FIELDS, remoteMapActions, type MapActions, type SpawnFieldsView } from './spawnFields'

/** In an editor's window: what the main page last published of the spawn fields' view. */
export const windowSpawnFields = $state<{ view: SpawnFieldsView }>({ view: NO_SPAWN_FIELDS })

/** The gear picker an editor's window opens itself (EditorToolWindow.svelte): the spawn and slot, as ui.weaponPick in the main page. */
export const windowWeaponPick = $state<{ pick: { key: string; slot: number } | null }>({ pick: null })

/** What the spawn fields read besides the spawn. Reactive: read it in a `$derived`. */
export function spawnFieldsView(): SpawnFieldsView {
	if (editorPageKind()) return windowSpawnFields.view
	return { panel: spawnPanel(), pathEdit: ui.pathEdit, waypoint: editor.selectedWaypoint }
}

/** The main page's map actions, on the active map. `onswitch`: the editor around the fields, which asks about its unsaved edits before it moves to a picked spawn. */
export function localMapActions(onswitch?: (o: vmangos.WorldSpawn) => void): MapActions {
	const e = () => engineRef.current
	return {
		...localSpawnActions(onswitch),
		edit: (key, vals, label) => void e()?.editSpawn(key, vals, label),
		editPath: (key) => e()?.editPath(key),
		stopPathEdit: () => (ui.pathEdit = false),
		focusPoint: (x, z) => e()?.focusPoint(x, z),
		pickWaypoint: (i) => (editor.selectedWaypoint = i),
		chooseWeapon(key, slot) {
			ui.weaponPick = { key, slot }
			ui.dialog = 'weapon'
		},
		selectSpawn(key) {
			const s = e()?.activeDocument().spawnLayer.get(key)
			if (s) selectSpawn(s)
		},
		applyCreatureTemplate: async (entry, now, was) => void (await e()?.applyCreatureTemplate(entry, now, was)),
		placeCreature(t) {
			ui.placeCreature = t
			editor.tool = 'select'
		},
		openCreatures: () => (ui.creatures = true),
	}
}

/** The map actions of this page: the main page's own, or commands to it from an editor's window. */
export function mapActions(onswitch?: (o: vmangos.WorldSpawn) => void): MapActions {
	if (!editorPageKind()) return localMapActions(onswitch)
	return remoteMapActions(
		(call) => sendEditorCommand({ type: 'map', ...call }),
		{
			chooseWeapon: (key, slot) => (windowWeaponPick.pick = { key, slot }),
			spawns: () => windowSpawnFields.view.panel.spawns,
			keyOf: spawnKey,
		},
		onswitch,
	)
}

/** Selects spawn `o` on the map. In an editor's window the copy here shows it at once, until the main page publishes its own. */
export function selectSpawnOnMap(o: vmangos.WorldSpawn) {
	if (!editorPageKind()) {
		selectSpawn(o)
		return
	}
	editor.selectedSpawn = o
	sendEditorCommand({ type: 'map', name: 'selectSpawn', args: [spawnKey(o)] })
}
