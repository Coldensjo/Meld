<script lang="ts">
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { keysOf } from '../lib/ui/commands'
	import MinimapView from './MinimapView.svelte'
	import { attachMinimap } from '../lib/ui/minimap'

	// The minimap detached from the dock (#749): a floating window over the viewport, shown by
	// `ui.minimap` (M) while `prefs.minimapDocked` is off. Attached, the dock shows it instead.
</script>

{#if ui.minimap && !prefs.minimapDocked}
	<aside class="minimap" aria-label="Minimap">
		<header>
			<span class="title">Minimap{editor.region || editor.worldMap ? ` · ${editor.region || `${editor.worldMap} world`}` : ''}</span>
			<!-- A world view's minimap (#15) has no light zones. -->
			{#if !editor.worldMap}
				<label class="opt" title="The map's Light.dbc light zones: full inside the solid ring, fading out to the dashed one"><input type="checkbox" bind:checked={prefs.minimapLights} /> Light zones</label>
			{/if}
			<button class="icon" onclick={attachMinimap} title="Attach to the dock, above Layers" aria-label="Attach the minimap to the dock">⇥</button>
			<button class="icon" onclick={() => (ui.minimap = false)} title="Close ({keysOf('minimap')})" aria-label="Close the minimap">✕</button>
		</header>
		<MinimapView />
	</aside>
{/if}

<style>
	.minimap {
		position: fixed;
		top: 96px;
		left: 50px;
		width: 260px;
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
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
		white-space: nowrap;
		overflow: hidden;
	}
	.title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.icon {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.icon:hover {
		color: var(--text);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-left: auto;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
