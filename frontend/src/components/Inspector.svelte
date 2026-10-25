<script lang="ts">
	import PropertiesPanel from './PropertiesPanel.svelte'
	import { prefs, ui } from '../lib/state/editor.svelte'

	// A floating inspector over the viewport (I opens and closes it, and Esc closes it, handled with
	// the other keys in App.svelte): the Properties panel's numbers and actions for what is selected,
	// kept out of the dock.
</script>

{#if ui.inspector}
	<aside class="inspector" style:right="{prefs.dockWidth + 12}px" aria-label="Inspector">
		<header>
			<span>Inspector</span>
			<button class="close" onclick={() => (ui.inspector = false)} title="Close (I or Esc)" aria-label="Close the inspector">✕</button>
		</header>
		<PropertiesPanel />
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
		z-index: 40;
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
