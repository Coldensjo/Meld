<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import DoodadBrushEditor from './DoodadBrushEditor.svelte'
	import { editor, prefs, setStatus, ui, wow } from '../lib/state/editor.svelte'
	import { hasBackend } from '../lib/io/backend'
	import { exportDoodadBrush, importDoodadBrushes } from '../lib/io/lists'
	import { activeDoodadBrush } from '../lib/tools/DoodadBrushTool'
	import { throttle } from '../lib/toolwin/channel'
	import { BRUSHES_KIND, brushesView, readBrushesCommand } from '../lib/toolwin/doodadBrushes'
	import { closeToolWindow, nativeToolWindows, onToolCommand, onToolWindowClosed, openToolWindow, publishToolState, sendToolReply } from '../lib/toolwin/host'
	import { thumbOnDisk } from '../lib/wow/thumbs'

	// The doodad brush editor (World › Doodad Brushes…, ui.brushEditor). In the desktop app it opens as its
	// own OS window (#911: components/toolwin/DoodadBrushToolWindow.svelte), which this component feeds over
	// the channel (lib/toolwin): the brushes when they change, and the window's edited brushes come back as
	// `set` commands taken into `prefs`, so this page stays their one writer and saves them. The window has no
	// renderer for the thumbnails: it reads the disk cache, and asks here for the ones missing. On the browser
	// page (server mode, the probes), or when that window can't open, it covers the page.

	/** Whether it shows in its own OS window, and whether that is being asked of Go. */
	let native = $state(false)
	let opening = $state(false)
	let asked = 0
	/** The last `set` taken from the window (reset when it loads). */
	let ack = 0

	$effect(() => {
		const want = ui.brushEditor
		untrack(() => {
			const n = ++asked
			if (!want) {
				if (native) closeToolWindow(BRUSHES_KIND)
				native = opening = ui.brushEditorWindow = false
				return
			}
			if (!nativeToolWindows()) return
			opening = true
			openToolWindow(BRUSHES_KIND).then((ok) => {
				if (n !== asked) {
					// Turned off (or on again) while it opened: a window nobody wants now is closed.
					if (ok && !ui.brushEditor) closeToolWindow(BRUSHES_KIND)
					return
				}
				opening = false
				native = ui.brushEditorWindow = ok
			})
		})
	})

	const publishNow = () => publishToolState(BRUSHES_KIND, brushesView({ doodadBrushes: $state.snapshot(prefs.doodadBrushes), doodadBrush: prefs.doodadBrush }, ack, wow, prefs))
	// A slider dragged in the window sends a `set` per input event, and each comes back as a view.
	const publish = throttle(publishNow, 100)

	$effect(() => {
		if (!native) return
		void JSON.stringify(prefs.doodadBrushes)
		void prefs.doodadBrush
		void wow.loaded
		void wow.revision
		void prefs.browserNames
		void prefs.fpsLimit
		void prefs.theme
		void prefs.uiScale
		publish()
	})

	function paint() {
		ui.brushEditor = false
		if (editor.tool !== 'doodad') editor.tool = 'doodad'
	}

	onMount(() => {
		if (!nativeToolWindows()) return
		const offCommand = onToolCommand(BRUSHES_KIND, (raw) => {
			if (raw.type === 'hello') {
				ack = 0
				publishNow()
				return
			}
			// A malformed `set` is dropped, but its number is taken, or the window would wait on it and drop every view after.
			if (raw.type === 'set' && typeof raw.seq === 'number') ack = Math.max(ack, raw.seq)
			const cmd = readBrushesCommand(raw)
			if (!cmd) {
				if (raw.type === 'set') publish()
				return
			}
			switch (cmd.type) {
				case 'set':
					prefs.doodadBrushes = cmd.brushes
					prefs.doodadBrush = cmd.active
					publish()
					break
				case 'thumb':
					void thumbOnDisk(cmd.key).then((ok) => sendToolReply(BRUSHES_KIND, { type: 'thumb', key: cmd.key, ok }))
					break
				case 'paint':
					paint()
					break
				case 'import':
					void importDoodadBrushes()
					break
				case 'export': {
					const b = activeDoodadBrush()
					if (b) void exportDoodadBrush(b)
					break
				}
				case 'status':
					setStatus(cmd.text)
					break
			}
		})
		const offClosed = onToolWindowClosed(BRUSHES_KIND, () => {
			if (!native) return
			native = ui.brushEditorWindow = false
			ui.brushEditor = false
		})
		return () => {
			offCommand()
			offClosed()
			publish.cancel()
		}
	})
</script>

{#if ui.brushEditor && !native && !opening}
	<DoodadBrushEditor
		store={prefs}
		wowLoaded={wow.loaded}
		wowRevision={wow.revision}
		files={hasBackend()}
		onclose={() => (ui.brushEditor = false)}
		onpaint={paint}
		onimport={() => void importDoodadBrushes()}
		onexport={(b) => void exportDoodadBrush(b)}
		onstatus={(text) => setStatus(text)}
	/>
{/if}
