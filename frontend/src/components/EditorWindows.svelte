<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { throttle } from '../lib/toolwin/channel'
	import { editorInWindow, editorWindowFailed, editorWindowTarget } from '../lib/toolwin/editorHost.svelte'
	import { relatedSpawns } from '../lib/toolwin/inspector'
	import { localMapActions } from '../lib/toolwin/spawnFieldsHost.svelte'
	import { runMapCall, type SpawnFieldsView } from '../lib/toolwin/spawnFields'
	import { EDITOR_PREF_KEYS, EDITOR_WINDOWS, editorArgs, readEditorCommand, type EditorForget, type EditorKind, type EditorPrefs, type EditorView } from '../lib/toolwin/editors'
	import { forwardedEditCommand } from '../lib/toolwin/keys'
	import { runCommand } from '../lib/ui/runCommand'
	import { nativeToolWindows, onToolCommand, onToolWindowClosed, openToolWindow, publishToolState } from '../lib/toolwin/host'
	import { forgetCreatureDisplays, forgetObjectDisplays } from './DisplayPicker.svelte'
	import { forgetObjectTemplates } from './SpawnBrowser.svelte'
	import { forgetLooks } from '../lib/wow/itemDisplays'
	import { forgetItemIcons, forgetItemRow } from '../lib/wow/items'
	import { forgetName, forgetSpellTables } from '../lib/wow/refNames'
	import { forgetSpell } from '../lib/wow/spells'

	// The main page's side of the database editors in their own OS windows (#912, lib/toolwin/editors.ts).
	// When an editor's `ui` slot is set here (a menu, a link in another editor) in the desktop app, its
	// window opens on that target (or comes to the front and opens it, asking about unsaved changes) and
	// the slot is cleared, so the full-screen editor never mounts. The window runs the editor whole and
	// sends back what this page must do: open an editor of another kind, show a status line, keep the
	// preferences it changed, and forget the caches its save made stale. On the browser page, or when the
	// window fails to open, the editor stays full screen here (App.svelte, editorInWindow).

	const kinds = Object.keys(EDITOR_WINDOWS) as EditorKind[]

	for (const kind of kinds) {
		const slot = EDITOR_WINDOWS[kind]
		$effect(() => {
			const t = ui[slot]
			if (!t || !editorInWindow(kind)) return
			untrack(() => {
				const target = $state.snapshot(t)
				ui[slot] = null
				void openToolWindow(kind, editorArgs(target)).then((ok) => {
					if (ok) return
					editorWindowFailed[kind] = true
					Object.assign(ui, { [slot]: target })
				})
			})
		})
	}

	/** What the creature editor's spawn fields read (#915): the selected spawn's pool and formation mates, the pick and path edit on the map. */
	const spawnFields = (): SpawnFieldsView => {
		const s = editor.selectedSpawn
		return { panel: { spawns: s ? $state.snapshot(relatedSpawns(editor.spawns, s)) : [], pick: $state.snapshot(ui.spawnPick) }, pathEdit: ui.pathEdit, waypoint: editor.selectedWaypoint }
	}
	const view = (): EditorView => {
		const p = {} as EditorPrefs
		for (const k of EDITOR_PREF_KEYS) Object.assign(p, { [k]: prefs[k] })
		return { prefs: p, spawn: $state.snapshot(editor.selectedSpawn), spawnFields: spawnFields(), questsVersion: ui.questsVersion }
	}
	/** The map actions an editor's window sends (#915), run here on the active map. */
	const mapAct = localMapActions()
	const publishAll = () => {
		const v = view()
		for (const kind of kinds) publishToolState(kind, v)
	}
	const publish = throttle(publishAll, 100)

	$effect(() => {
		if (!nativeToolWindows()) return
		for (const k of EDITOR_PREF_KEYS) void prefs[k]
		void prefs.theme
		void prefs.uiScale
		void editor.selectedSpawn
		void editor.spawns
		void ui.spawnPick
		void ui.pathEdit
		void editor.selectedWaypoint
		void ui.questsVersion
		publish()
	})

	function forget(f: EditorForget) {
		for (const e of f.items ?? []) {
			forgetItemRow(e)
			forgetName('item', e)
		}
		if (f.itemIcons) forgetItemIcons()
		if (f.looks) forgetLooks()
		for (const e of f.spells ?? []) {
			forgetSpell(e)
			forgetName('spell', e)
		}
		if (f.spellTables) forgetSpellTables()
		for (const e of f.quests ?? []) forgetName('quest', e)
		// The quest editor saved givers, made or deleted a quest (#914): the creature or object editor's Quests tab here reads its lists again.
		if (f.questLists) ui.questsVersion++
		if (f.creatureDisplays) forgetCreatureDisplays()
		if (f.objectTemplates) {
			forgetObjectTemplates()
			forgetObjectDisplays()
		}
	}

	onMount(() => {
		if (!nativeToolWindows()) return
		const offs = kinds.map((kind) =>
			onToolCommand(kind, (raw) => {
				if (raw.type === 'hello') {
					publishToolState(kind, view())
					return
				}
				if (raw.type === 'key') {
					const id = forwardedEditCommand(raw)
					if (id) runCommand(id)
					return
				}
				const cmd = readEditorCommand(raw)
				if (!cmd) return
				switch (cmd.type) {
					case 'open':
						// An editor of another kind, opened from inside this one: in its own window too, or full screen here.
						Object.assign(ui, { [cmd.slot]: cmd.target })
						break
					case 'status':
						setStatus(cmd.text, cmd.timeout)
						break
					case 'prefs':
						Object.assign(prefs, cmd.prefs)
						break
					case 'forget':
						forget(cmd.forget)
						break
					case 'map':
						runMapCall(cmd, mapAct)
						break
					case 'target':
						editorWindowTarget[kind] = cmd.target
						break
				}
			}),
		)
		const closed = kinds.map((kind) => onToolWindowClosed(kind, () => (editorWindowTarget[kind] = null)))
		return () => {
			for (const off of offs) off()
			for (const off of closed) off()
			publish.cancel()
		}
	})
</script>
