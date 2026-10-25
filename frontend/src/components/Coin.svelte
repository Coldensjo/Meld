<script lang="ts">
	import { coinIcon } from '../lib/wow/coinIcons'
	import type { Coin } from '../lib/wow/money'

	// A coin from the client's money atlas (lib/wow/money.ts), or its letter (g, s or c) while it
	// loads or when the client has none (#679).
	let { coin, size = 13 }: { coin: Coin; size?: number } = $props()

	let url = $state<string | null>(null)
	$effect(() => {
		const c = coin
		url = null
		void coinIcon(c, size > 16 ? 32 : 16).then((u) => c === coin && (url = u))
	})
</script>

<span class="coin" style:width="{size}px" style:height="{size}px" title={coin[0].toUpperCase() + coin.slice(1)}>
	{#if url}<img src={url} alt={coin[0]} width={size} height={size} />{:else}{coin[0]}{/if}
</span>

<style>
	.coin {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		vertical-align: middle;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		color: var(--text-dim);
	}
	img {
		display: block;
	}
</style>
