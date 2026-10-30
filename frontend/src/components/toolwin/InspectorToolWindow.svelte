<script lang="ts">
	import { onMount } from 'svelte'
	import { applyLook, onToolState, sendToolCommand } from '../../lib/toolwin/client'
	import { INSPECTOR_KIND, keyOf, remoteActions, type InspectorView } from '../../lib/toolwin/inspector'
	import { controlKeepsKey, formField } from '../../lib/ui/keys'
	import PropertiesPanel from '../PropertiesPanel.svelte'

	// The Inspector in its own OS window (#910): the view of the selection the main page publishes
	// (Inspector.svelte), drawn by the same panel as in the page, whose actions and edits go back to the main
	// page as commands (a scrub's live edits at most once a frame), where they run as undo steps.

	let view = $state<InspectorView>({ kind: 'none' })
	const act = remoteActions((cmd) => sendToolCommand(INSPECTOR_KIND, cmd))

	onMount(() => {
		const off = onToolState<InspectorView>(INSPECTOR_KIND, (msg) => {
			view = msg.state
			applyLook(msg.look)
		})
		sendToolCommand(INSPECTOR_KIND, { type: 'hello' })
		return off
	})

	// The keys a field of the panel doesn't keep go to the main page, which closes the window on Esc and I
	// and undoes or redoes on its Undo and Redo keys, as with the Inspector in the page.
	function onkeydown(e: KeyboardEvent) {
		const field = formField(e.target)
		if (field === 'text' || (field === 'control' && controlKeepsKey(e))) return
		sendToolCommand(INSPECTOR_KIND, { type: 'key', key: keyOf(e) })
	}
</script>

<svelte:window {onkeydown} />

<main class="inspector" aria-label="Inspector">
	<PropertiesPanel {view} {act} />
</main>

<style>
	.inspector {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		overflow: hidden;
	}
	.inspector :global(.props) {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
</style>
