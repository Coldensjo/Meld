<script lang="ts" generics="T">
	// The rendered rows of a virtualised tile grid (#578): a block as tall as the whole list, holding
	// only the rows of `win` (lib/ui/virtualGrid.ts gridWindow), moved down to where they sit. The
	// scroller around it, its scroll position and the window are the caller's.
	import type { Snippet } from 'svelte'
	import type { GridWindow } from '../lib/ui/virtualGrid'

	let {
		items,
		win,
		cols,
		tile,
		gap,
		rowH,
		key,
		cell,
		el = $bindable(),
	}: {
		items: readonly T[]
		win: GridWindow
		cols: number
		/** A column's width in px. */
		tile: number
		gap: number
		rowH: number
		/** Each item's key, for the keyed each. */
		key: (it: T) => string | number
		cell: Snippet<[T]>
		/** The block, for a caller whose grid sits below other content in the scroller (its offsetTop). */
		el?: HTMLDivElement
	} = $props()

	const visible = $derived(items.slice(win.start, win.end))
</script>

<div class="virtual" bind:this={el} style:height="{win.rows * rowH}px">
	<div class="grid" style:grid-template-columns="repeat({cols}, {tile}px)" style:gap="{gap}px" style:transform="translateY({win.first * rowH}px)">
		{#each visible as it (key(it))}
			{@render cell(it)}
		{/each}
	</div>
</div>

<style>
	.virtual {
		position: relative;
	}
	.grid {
		display: grid;
		align-content: start;
	}
</style>
