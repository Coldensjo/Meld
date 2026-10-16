<script lang="ts">
	import { itemRow } from '../lib/wow/items'
	import { tooltipLines, type TooltipLine } from '../lib/wow/itemTooltip'
	import ItemIcon from './ItemIcon.svelte'

	// A game-style tooltip of an item (#202), beside the pointer: its item_template row as the 1.12
	// client's tooltip shows it. DOM only, no renderer of its own.
	let { entry, displayId, x, y }: { entry: number; displayId: number; x: number; y: number } = $props()

	let lines = $state<TooltipLine[]>([])
	let error = $state('')
	$effect(() => {
		const e = entry
		lines = []
		error = ''
		itemRow(e)
			.then((row) => e === entry && (lines = tooltipLines(row)))
			.catch((err) => e === entry && (error = String(err)))
	})

	// Kept inside the window: left of the pointer near the right edge, above it near the bottom.
	let box = $state<HTMLDivElement>()
	let left = $state(0)
	let top = $state(0)
	$effect(() => {
		void lines.length
		const w = box?.offsetWidth ?? 0
		const h = box?.offsetHeight ?? 0
		left = x + 16 + w > window.innerWidth ? Math.max(4, x - 16 - w) : x + 16
		top = y + 12 + h > window.innerHeight ? Math.max(4, window.innerHeight - h - 4) : y + 12
	})
</script>

<div class="tip" bind:this={box} style:left="{left}px" style:top="{top}px">
	{#if error}
		<p class="error">{error}</p>
	{:else if !lines.length}
		<p class="dim">Reading the item…</p>
	{:else}
		<div class="head">
			<ItemIcon {displayId} size={36} />
			<div class="lines">
				{#each lines as l, i (i)}
					<div class="line" class:title={l.title} style:color={l.color}>
						<span>{l.left}</span>
						{#if l.right}<span class="right">{l.right}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.tip {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		min-width: 180px;
		max-width: 300px;
		padding: 6px 8px;
		border: 1px solid #5a5a6e;
		border-radius: 4px;
		background: rgba(8, 10, 24, 0.94);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
		color: #ffffff;
		font-size: 12px;
		line-height: 1.35;
	}
	.head {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
	.lines {
		flex: 1;
		min-width: 0;
	}
	.line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
	}
	.right {
		white-space: nowrap;
	}
	p {
		margin: 0;
	}
	.error {
		color: var(--danger);
	}
	.dim {
		color: var(--text-dim);
	}
</style>
