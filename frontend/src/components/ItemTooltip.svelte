<script lang="ts">
	import { itemRow, itemTooltipNames } from '../lib/wow/items'
	import { tooltipLines, type TooltipLine } from '../lib/wow/itemTooltip'
	import ItemTooltipBox from './ItemTooltipBox.svelte'

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
			.then(async (row) => {
				const names = await itemTooltipNames(row)
				if (e === entry) lines = tooltipLines(row, names)
			})
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
	<ItemTooltipBox {lines} {displayId} {error} />
</div>

<style>
	.tip {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
	}
</style>
