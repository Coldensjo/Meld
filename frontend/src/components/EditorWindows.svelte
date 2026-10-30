<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { throttle } from '../lib/toolwin/channel'
	import { editorInWindow, editorWindowFailed } from '../lib/toolwin/editorHost.svelte'
	import { EDITOR_PREF_KEYS, EDITOR_WINDOWS, editorArgs, readEditorCommand, type EditorForget, type EditorKind, type EditorPrefs, type EditorView } from '../lib/toolwin/editors'
	import { nativeToolWindows, onToolCommand, openToolWindow, publishToolState } from '../lib/toolwin/host'
	import { forgetLooks } from '../lib/wow/itemDisplays'
	import { forgetItemIcons, forgetItemRow } from '../lib/wow/items'
	import { forgetName } from '../lib/wow/refNames'

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
					ui[slot] = target
				})
			})
		})
	}

	const view = (): EditorView => {
		const p = {} as EditorPrefs
		for (const k of EDITOR_PREF_KEYS) Object.assign(p, { [k]: prefs[k] })
		return { prefs: p }
	}
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
		publish()
	})

	function forget(f: EditorForget) {
		for (const e of f.items ?? []) {
			forgetItemRow(e)
			forgetName('item', e)
		}
		if (f.itemIcons) forgetItemIcons()
		if (f.looks) forgetLooks()
	}

	onMount(() => {
		if (!nativeToolWindows()) return
		const offs = kinds.map((kind) =>
			onToolCommand(kind, (raw) => {
				if (raw.type === 'hello') {
					publishToolState(kind, view())
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
				}
			}),
		)
		return () => {
			for (const off of offs) off()
			publish.cancel()
		}
	})
</script>
