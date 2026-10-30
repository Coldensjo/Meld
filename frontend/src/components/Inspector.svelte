<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import PropertiesPanel from './PropertiesPanel.svelte'
	import { prefs, ui } from '../lib/state/editor.svelte'
	import { throttle } from '../lib/toolwin/channel'
	import { closeToolWindow, nativeToolWindows, onToolCommand, onToolWindowClosed, openToolWindow, publishToolState } from '../lib/toolwin/host'
	import { EditGestures, INSPECTOR_KIND, readInspectorCommand, runInspectorCommand } from '../lib/toolwin/inspector'
	import { inspectorView, localActions } from '../lib/toolwin/inspectorHost'
	import { commandFor } from '../lib/ui/commands'
	import { runCommand } from '../lib/ui/runCommand'

	// The Inspector (I, or Edit › Inspector; Esc closes it, handled with the other keys in App.svelte): the
	// Properties panel's numbers and actions for what is selected, kept out of the dock. In the desktop app
	// it opens as its own OS window (#910: components/toolwin/InspectorToolWindow.svelte), which this
	// component feeds over the channel (lib/toolwin): the view of the selection when it changes, and the
	// window's actions and edits run here, so each edit is an undo step of this page's History. On the
	// browser page (server mode, the probes), or when that window can't open, it floats over the viewport.

	const view = $derived.by(() => {
		void ui.historyVersion
		return inspectorView()
	})
	const act = localActions()

	/** Whether it shows in its own OS window, and whether that is being asked of Go. */
	let native = $state(false)
	let opening = $state(false)
	let asked = 0

	$effect(() => {
		const want = ui.inspector
		untrack(() => {
			const n = ++asked
			if (!want) {
				if (native) closeToolWindow(INSPECTOR_KIND)
				native = opening = false
				return
			}
			if (!nativeToolWindows()) return
			opening = true
			openToolWindow(INSPECTOR_KIND).then((ok) => {
				if (n !== asked) {
					// Turned off (or on again) while it opened: a window nobody wants now is closed.
					if (ok && !ui.inspector) closeToolWindow(INSPECTOR_KIND)
					return
				}
				opening = false
				native = ok
			})
		})
	})

	/** The window's scrubs, in the order they began (commands can arrive out of order). */
	const gestures = new EditGestures()
	const publishNow = () => publishToolState(INSPECTOR_KIND, inspectorView())
	// The selection changes at most once a frame (a drag in the viewport), and a scrub in the window once an
	// input event: the window gets at most ten views a second, and none while it scrubs, since it shows its
	// own numbers then; the commit at the end sends the last.
	const publish = throttle(() => {
		if (!gestures.active) publishNow()
	}, 100)

	$effect(() => {
		if (!native) return
		void view
		void prefs.theme
		void prefs.uiScale
		publish()
	})

	onMount(() => {
		if (!nativeToolWindows()) return
		const offCommand = onToolCommand(INSPECTOR_KIND, (raw) => {
			if (raw.type === 'hello') {
				gestures.reset()
				publishNow()
				return
			}
			const cmd = readInspectorCommand(raw)
			if (!cmd) return
			if (cmd.type === 'key') {
				// Esc and I close it, as in the page; Undo and Redo reach the map (whichever keys they are bound to).
				const id = commandFor(cmd.key, true) ?? commandFor(cmd.key, false)
				if (cmd.key.key === 'Escape' || id === 'inspector') ui.inspector = false
				else if (id === 'undo' || id === 'redo') runCommand(id)
				return
			}
			runInspectorCommand(cmd, act, gestures)
			if (cmd.type === 'edit' && cmd.commit) publishNow()
		})
		const offClosed = onToolWindowClosed(INSPECTOR_KIND, () => {
			if (!native) return
			native = false
			ui.inspector = false
		})
		return () => {
			offCommand()
			offClosed()
			publish.cancel()
		}
	})
</script>

{#if ui.inspector && !native && !opening}
	<aside class="inspector" style:right="{prefs.dockWidth + 12}px" aria-label="Inspector">
		<header>
			<span>Inspector</span>
			<button class="close" onclick={() => (ui.inspector = false)} title="Close (I or Esc)" aria-label="Close the inspector">✕</button>
		</header>
		<PropertiesPanel {view} {act} />
	</aside>
{/if}

<style>
	.inspector {
		position: fixed;
		top: 96px;
		width: 300px;
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
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	.inspector :global(.props) {
		overflow-y: auto;
		min-height: 0;
	}
</style>
