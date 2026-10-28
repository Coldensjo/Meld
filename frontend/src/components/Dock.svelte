<script lang="ts">
	import DockPanel from './DockPanel.svelte'
	import LayersPanel from './LayersPanel.svelte'
	import MinimapView from './MinimapView.svelte'
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { dragResize } from '../lib/ui/dragResize'
	import { keysOf } from '../lib/ui/commands'
	import { detachMinimap } from '../lib/ui/minimap'

	// Hide the dock (#653); View › Layers panel shows it again. A Replace waiting for a texture is dropped, since its Cancel is in the hidden panel.
	function hide() {
		prefs.dockHidden = true
		ui.replaceSlot = null
	}
</script>

<div class="dock" style:width="{prefs.dockWidth}px">
	<!-- Drag the left edge to resize the dock, like Photoshop's panel column. -->
	<div class="resizer" role="separator" aria-orientation="vertical" use:dragResize={{ axis: 'x', get: () => prefs.dockWidth, set: (w) => (prefs.dockWidth = w), min: 240, max: 640 }}></div>
	{#if ui.minimap && prefs.minimapDocked}
		<!-- The minimap attached above Layers (#749); its ⇱ detaches it into the floating MinimapWindow. -->
		<DockPanel id="minimap" tabs={[{ id: 'minimap', label: 'Minimap' }]} onclose={() => (ui.minimap = false)} closeTitle="Close the minimap ({keysOf('minimap')})" closeLabel="Close the minimap">
			{#snippet actions()}
				<!-- A world view's minimap (#15) has no light zones. -->
				{#if !editor.worldMap}
					<label class="opt" title="The map's Light.dbc light zones: full inside the solid ring, fading out to the dashed one"><input type="checkbox" bind:checked={prefs.minimapLights} /> Light zones</label>
				{/if}
				<button class="detach" onclick={detachMinimap} title="Detach into a floating window" aria-label="Detach the minimap">⇱</button>
			{/snippet}
			<div class="minimap" role="region" aria-label="Minimap">
				<MinimapView />
			</div>
		</DockPanel>
	{/if}
	<DockPanel id="layers" grow onclose={hide} tabs={[{ id: 'layers', label: 'Layers' }]}>
		<LayersPanel />
	</DockPanel>
</div>

<style>
	.dock {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--bg);
		border-left: 1px solid var(--border);
		gap: 2px;
	}
	.resizer {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		z-index: 5;
	}
	.resizer:hover {
		background: var(--accent);
		opacity: 0.5;
	}
	.dock :global(.panel:not(.grow) .body) {
		max-height: calc(40 * var(--vh));
		overflow-y: auto;
	}
	/* The minimap stays square at the dock's width, and no taller than the dock's other panels may grow. */
	.minimap {
		width: min(100%, calc(40 * var(--vh)));
		margin: 0 auto;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.detach {
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 0 6px 0 8px;
		font-size: 11px;
	}
	.detach:hover {
		color: var(--text);
	}
	.dock :global(.panel.grow .body) {
		overflow-y: auto;
	}
</style>
