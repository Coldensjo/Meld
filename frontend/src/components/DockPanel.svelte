<script lang="ts">
	import type { Snippet } from 'svelte'
	import { prefs } from '../lib/state/editor.svelte'

	// A Photoshop-style dock panel: dark tab header, click the header to
	// collapse/expand. Collapsed state persists in prefs.
	interface Props {
		id: string
		tabs: Array<{ id: string; label: string }>
		active?: string
		onselect?: (id: string) => void
		grow?: boolean
		/** Shows a close button on the header (the dock's, #653). */
		onclose?: () => void
		/** The close button's tooltip and label. */
		closeTitle?: string
		closeLabel?: string
		/** More controls on the header, before the collapse button (the minimap's, #749). */
		actions?: Snippet
		children: Snippet
	}
	let { id, tabs, active = tabs[0]?.id, onselect, grow = false, onclose, closeTitle = 'Hide the panel (View › Layers panel shows it again)', closeLabel = 'Hide panel', actions, children }: Props = $props()

	const collapsed = $derived(prefs.collapsedPanels.includes(id))
	function toggle() {
		prefs.collapsedPanels = collapsed ? prefs.collapsedPanels.filter((p) => p !== id) : [...prefs.collapsedPanels, id]
	}
</script>

<section class="panel" class:grow={grow && !collapsed} class:collapsed>
	<header>
		<div class="tabs">
			{#each tabs as t (t.id)}
				<button
					class="tab"
					class:active={t.id === active && !collapsed}
					onclick={() => {
						if (collapsed) toggle()
						onselect?.(t.id)
					}}>{t.label}</button
				>
			{/each}
		</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
		<button class="chev" onclick={toggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
			{collapsed ? '▸' : '▾'}
		</button>
		{#if onclose}
			<button class="chev" onclick={onclose} title={closeTitle} aria-label={closeLabel}>✕</button>
		{/if}
	</header>
	{#if !collapsed}
		<div class="body">{@render children()}</div>
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		min-height: 0;
		flex: none;
	}
	.panel.grow {
		flex: 1;
	}
	header {
		display: flex;
		align-items: stretch;
		height: 26px;
		background: var(--header);
		flex: none;
	}
	.tabs {
		display: flex;
		flex: 1;
		min-width: 0;
	}
	.tab {
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--text-dim);
		padding: 0 12px;
		font-size: 11px;
		font-weight: 600;
	}
	.tab:hover:not(.active) {
		color: var(--text);
		background: transparent;
	}
	.tab.active {
		background: var(--panel);
		color: var(--text);
	}
	.actions {
		display: flex;
		align-items: center;
		flex: none;
	}
	.chev {
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 0 8px;
		font-size: 11px;
	}
	.body {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
</style>
