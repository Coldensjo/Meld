<script lang="ts">
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { takeEscape } from '../lib/state/escape'
	import CreaturePreview from './CreaturePreview.svelte'
	import { ui } from '../lib/state/editor.svelte'

	// The right-click menu's Preview (#197): one model, creature or game object alone and large, as the
	// creature editor shows a creature. Drag turns it, the wheel or Ctrl+wheel zooms, the X or Esc
	// closes. It renders at the screen's full pixel ratio, with the full model (never the LOD) and its
	// animation, in its own renderer, so the map is untouched.

	const close = () => (ui.modelPreview = null)
	const shownPath = $derived(ui.modelPreview ? ui.modelPreview.type.replace(/^(m2|wmo|helper):/, '').split('?')[0] : '')

	let root = $state<HTMLElement>()

	function onKey(e: KeyboardEvent) {
		if (ui.modelPreview && e.key === 'Escape' && takeEscape(e, root)) {
			e.preventDefault()
			close()
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if ui.modelPreview}
	{@const p = ui.modelPreview}
	<div class="window" role="dialog" aria-modal="true" aria-label="Model preview" bind:this={root} use:dialogFocus>
		<header>
			<div class="title">
				<h2>{p.title}</h2>
				<span class="dim" title={p.type}>{shownPath}{p.scale !== 1 ? ` · scale ${p.scale.toFixed(2)}` : ''}</span>
			</div>
			<button class="close" onclick={close} title="Close (Esc)" aria-label="Close the preview">✕</button>
		</header>
		<div class="body">
			{#key p.type}
				<CreaturePreview type={p.type} scale={p.scale} hq />
			{/key}
		</div>
	</div>
{/if}

<style>
	.window {
		position: fixed;
		inset: 0;
		z-index: 160;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.close {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-size: 18px;
		padding: 4px 8px;
	}
	.close:hover {
		color: var(--text);
	}
	.body {
		flex: 1;
		min-height: 0;
		padding: 12px 16px 16px;
	}
</style>
