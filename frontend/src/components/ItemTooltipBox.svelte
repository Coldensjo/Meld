<script lang="ts">
	import type { TooltipLine } from '../lib/wow/itemTooltip'
	import ItemIcon from './ItemIcon.svelte'
	import Money from './Money.svelte'

	// An item's tooltip as the game draws it (#202): the icon and the lines, in the game's dark box.
	// The Shop tab's ItemTooltip puts it beside the pointer; the item editor (#353) shows it in place,
	// with the icon picked but not yet saved (`icon`).
	let { lines, displayId, icon = '', error = '' }: { lines: TooltipLine[]; displayId: number; icon?: string; error?: string } = $props()
</script>

<div class="box">
	{#if error}
		<p class="error">{error}</p>
	{:else if !lines.length}
		<p class="dim">Reading the item…</p>
	{:else}
		<div class="head">
			<ItemIcon {displayId} {icon} size={36} />
			<div class="lines">
				{#each lines as l, i (i)}
					<div class="line" class:title={l.title} class:extra={l.extra} style:color={l.color}>
						<span
							>{l.left}{#if l.money !== undefined}
								<Money copper={l.money} size={11} />{/if}</span
						>
						{#if l.right}<span class="right">{l.right}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.box {
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
		overflow-wrap: anywhere;
	}
	/* Kept as written: a set member's two-space indent (#355). */
	.line span {
		white-space: pre-wrap;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
	}
	.extra {
		font-size: 11px;
		opacity: 0.8;
	}
	.right {
		white-space: nowrap;
	}
	p {
		margin: 0;
	}
	.error {
		color: var(--danger-text);
	}
	.dim {
		color: var(--text-dim);
	}
</style>
