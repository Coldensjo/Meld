<script lang="ts">
	import { shownCoins, splitMoney } from '../lib/wow/money'
	import Coin from './Coin.svelte'

	// A copper count as the game shows money: each coin that isn't 0, its amount and its icon (#679).
	// A negative count reads "costs" first (a quest that takes money).
	let { copper, size = 12 }: { copper: number; size?: number } = $props()

	const coins = $derived(shownCoins(copper))
</script>

<span class="money">
	{#if splitMoney(copper).negative}<span class="costs">costs</span>{/if}
	{#each coins as [coin, n] (coin)}<span class="amt">{n}<Coin {coin} {size} /></span>{/each}
</span>

<style>
	.money {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.amt {
		display: inline-flex;
		align-items: center;
		gap: 1px;
	}
</style>
