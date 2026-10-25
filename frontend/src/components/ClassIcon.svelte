<script lang="ts">
	import { classIcon } from '../lib/wow/classIcons'

	// A class's icon from the client's class atlas (#682, lib/wow/classes.ts), or an empty square
	// while it loads, when the client has none or for an ID that is no playable class.
	let { id, size = 18 }: { id: number; size?: number } = $props()

	let url = $state<string | null>(null)
	$effect(() => {
		const c = id
		url = null
		const px = size > 40 ? 64 : 36
		if (c > 0) void classIcon(c, px).then((u) => c === id && (url = u))
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
