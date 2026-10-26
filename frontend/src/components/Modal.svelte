<script lang="ts">
	import type { Snippet } from 'svelte'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { leaveField, takeEscape } from '../lib/state/escape'

	interface Props {
		title: string
		width?: number
		onclose: () => void
		children: Snippet
		actions?: Snippet
	}
	let { title, width = 420, onclose, children, actions }: Props = $props()
	const titleId = $props.id()
	let root = $state<HTMLElement>()

	// Esc closes the dialog only while it is the topmost one, so an editor behind it keeps its own (#573).
	// In one of its text fields the first Esc leaves the field, as in the editors.
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !root || !takeEscape(e, root)) return
		const el = e.target as HTMLElement | null
		if (el && root.contains(el) && leaveField(e)) return
		e.preventDefault()
		onclose()
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style:width="{width}px" bind:this={root} use:dialogFocus={{ prefer: '.body' }}>
		<header>
			<h2 id={titleId}>{title}</h2>
			<button class="close" onclick={onclose} aria-label="Close">✕</button>
		</header>
		<div class="body">{@render children()}</div>
		{#if actions}<footer>{@render actions()}</footer>{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 200;
	}
	.dialog {
		max-width: calc(100 * var(--vw) - 32px);
		max-height: calc(100 * var(--vh) - 64px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 0;
	}
	h2 {
		margin: 0;
		font-size: 16px;
	}
	.close {
		border: none;
		background: transparent;
		padding: 2px 6px;
	}
	.body {
		padding: 12px 16px;
		overflow-y: auto;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 16px 14px;
	}
</style>
