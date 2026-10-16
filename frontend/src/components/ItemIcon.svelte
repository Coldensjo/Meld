<script lang="ts">
	import { itemIcon } from '../lib/wow/items'

	// An item's inventory icon from the client (#202), or an empty square while it loads or when the
	// client has none.
	let { displayId, size = 18 }: { displayId: number; size?: number } = $props()

	let url = $state<string | null>(null)
	$effect(() => {
		const id = displayId
		url = null
		if (id > 0) void itemIcon(id).then((u) => id === displayId && (url = u))
	})
</script>

<span class="icon" style:width="{size}px" style:height="{size}px">
	{#if url}<img src={url} alt="" width={size} height={size} />{/if}
</span>

<style>
	.icon {
		display: inline-block;
		flex: none;
		vertical-align: middle;
		border-radius: 3px;
		background: var(--panel-2);
		overflow: hidden;
	}
	img {
		display: block;
	}
</style>
