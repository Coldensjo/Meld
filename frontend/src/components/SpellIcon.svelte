<script lang="ts">
	import { spellIcon } from '../lib/wow/spells'

	// A spell's icon from the client (#243), or an empty square while it loads or when it has none.
	let { icon, size = 18 }: { icon: string; size?: number } = $props()

	let url = $state<string | null>(null)
	$effect(() => {
		const path = icon
		url = null
		if (path) void spellIcon(path).then((u) => path === icon && (url = u))
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
