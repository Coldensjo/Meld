<script lang="ts">
	import { iconImage, itemIcon } from '../lib/wow/items'

	// An item's inventory icon from the client (#202), or an empty square while it loads or when the
	// client has none: a display's icon, or an icon by its name (`icon`, the item editor's icon
	// picker, #353). `lazy` waits until the square is on screen, for long grids of icons.
	let { displayId = 0, icon = '', size = 18, lazy = false }: { displayId?: number; icon?: string; size?: number; lazy?: boolean } = $props()

	let el = $state<HTMLSpanElement>()
	let seen = $state(false)
	$effect(() => {
		if (!lazy || seen || !el) return
		const o = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				seen = true
				o.disconnect()
			}
		})
		o.observe(el)
		return () => o.disconnect()
	})

	let url = $state<string | null>(null)
	$effect(() => {
		const id = displayId
		const name = icon
		url = null
		if (lazy && !seen) return
		// The client's icons are 64 px: a small square takes them at 36, a large one whole.
		const px = size > 40 ? 64 : 36
		if (name) void iconImage(name, px).then((u) => name === icon && (url = u))
		else if (id > 0) void itemIcon(id, px).then((u) => id === displayId && !icon && (url = u))
	})
</script>

<span class="icon" bind:this={el} style:width="{size}px" style:height="{size}px">
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
