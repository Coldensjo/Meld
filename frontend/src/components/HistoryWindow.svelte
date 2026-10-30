<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { throttle } from '../lib/toolwin/channel'
	import { closeToolWindow, nativeToolWindows, onToolCommand, onToolWindowClosed, openToolWindow, publishToolState } from '../lib/toolwin/host'
	import { HISTORY_KIND, goTarget, historyView } from '../lib/toolwin/history'
	import HistoryList from './HistoryList.svelte'

	// The History window (Edit › History, ui.history). In the desktop app it opens as its own OS window
	// (#909: app_toolwindows.go, components/toolwin/HistoryToolWindow.svelte), which this component feeds over
	// the channel (lib/toolwin): the view on each ui.historyVersion, and the steps it asks for run here.
	// On the browser page (server mode, the probes), or when that window can't open, it floats in the page.

	const view = $derived.by(() => {
		void ui.historyVersion
		return historyView(engineRef.current?.history)
	})

	/** Whether it shows in its own OS window, and whether that is being asked of Go. */
	let native = $state(false)
	let opening = $state(false)
	let asked = 0

	$effect(() => {
		const want = ui.history
		untrack(() => {
			const n = ++asked
			if (!want) {
				if (native) closeToolWindow(HISTORY_KIND)
				native = opening = false
				return
			}
			if (!nativeToolWindows()) return
			opening = true
			openToolWindow(HISTORY_KIND).then((ok) => {
				if (n !== asked) {
					// Turned off (or on again) while it opened: a window nobody wants now is closed.
					if (ok && !ui.history) closeToolWindow(HISTORY_KIND)
					return
				}
				opening = false
				native = ok
			})
		})
	})

	const publishNow = () => publishToolState(HISTORY_KIND, historyView(engineRef.current?.history))
	// The stack changes once a step (not a frame), but a script or a held Undo can make many in a row.
	const publish = throttle(publishNow, 100)

	$effect(() => {
		if (!native) return
		void ui.historyVersion
		void prefs.theme
		void prefs.uiScale
		publish()
	})

	onMount(() => {
		if (!nativeToolWindows()) return
		const offCommand = onToolCommand(HISTORY_KIND, (cmd) => {
			if (cmd.type === 'hello') publishNow()
			else {
				const to = goTarget(cmd, engineRef.current?.history.steps().length ?? 0)
				if (to !== null) go(to)
			}
		})
		const offClosed = onToolWindowClosed(HISTORY_KIND, () => {
			if (!native) return
			native = false
			ui.history = false
		})
		return () => {
			offCommand()
			offClosed()
			publish.cancel()
		}
	})

	function go(to: number) {
		const e = engineRef.current
		const from = e?.history.position ?? 0
		if (!e || to === from) return
		e.goToHistory(to)
		const n = Math.abs(to - from)
		setStatus(`${to < from ? 'Undid' : 'Redid'} ${n} step${n === 1 ? '' : 's'}.`, 2000)
	}
</script>

{#if ui.history && !native && !opening}
	<aside class="history" aria-label="History">
		<HistoryList {view} ongo={go} onclose={() => (ui.history = false)} />
	</aside>
{/if}

<style>
	.history {
		position: fixed;
		top: 96px;
		left: 52px;
		width: 260px;
		max-height: calc(100 * var(--vh) - 160px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: var(--z-window);
		overflow: hidden;
	}
</style>
