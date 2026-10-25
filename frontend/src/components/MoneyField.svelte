<script lang="ts">
	import { untrack } from 'svelte'
	import { joinMoney, splitMoney, type Coins } from '../lib/wow/money'
	import Coin from './Coin.svelte'

	// A copper count entered as the game shows money (#679): gold, silver and copper, each with its
	// coin, written back as the one copper count the databases keep. What is typed stays as typed
	// until the field is left (so 1000 silver can be typed through 100), then rolls over (150 copper
	// reads 1s 50c). An empty amount is 0. `signed` adds a Costs box for a negative count (a quest's
	// money that the player pays).
	interface Props {
		value: number
		onset: (copper: number) => void
		signed?: boolean
		/** The Costs box's tooltip. */
		costsHint?: string
		id?: string
	}
	let { value, onset, signed = false, costsHint = 'The player pays this much', id }: Props = $props()

	interface Raw {
		negative: boolean
		gold: string
		silver: string
		copper: string
	}
	const show = (n: number) => (n ? String(n) : '')
	const fromValue = (v: number): Raw => {
		const c = splitMoney(v)
		return { negative: c.negative, gold: show(c.gold), silver: show(c.silver), copper: show(c.copper) }
	}
	const parse = (r: Raw): Coins => ({ negative: signed && r.negative, gold: Number(r.gold) || 0, silver: Number(r.silver) || 0, copper: Number(r.copper) || 0 })

	let raw = $state<Raw>(fromValue(untrack(() => value)))
	// A value from outside (another row, a revert) replaces what is typed; the one this field wrote does not.
	$effect(() => {
		const v = value
		untrack(() => {
			if (joinMoney(parse(raw)) !== v) raw = { ...fromValue(v), negative: v < 0 || (v === 0 && raw.negative) }
		})
	})

	function edit(coin: 'gold' | 'silver' | 'copper', text: string) {
		raw[coin] = text
		onset(joinMoney(parse(raw)))
	}
	function setNegative(on: boolean) {
		raw.negative = on
		onset(joinMoney(parse(raw)))
	}
	/** Rolls the amounts over once the field is left. */
	function normalise() {
		raw = { ...fromValue(joinMoney(parse(raw))), negative: raw.negative }
	}
</script>

<span class="money">
	{#if signed}<label class="costs" title={costsHint}><input type="checkbox" checked={raw.negative} onchange={(e) => setNegative((e.currentTarget as HTMLInputElement).checked)} /> Costs</label>{/if}
	<span class="amt"
		><input {id} class="g" type="number" min="0" step="1" placeholder="0" aria-label="Gold" value={raw.gold} oninput={(e) => edit('gold', (e.currentTarget as HTMLInputElement).value)} onchange={normalise} /><Coin coin="gold" /></span
	>
	<span class="amt"
		><input type="number" min="0" step="1" placeholder="0" aria-label="Silver" value={raw.silver} oninput={(e) => edit('silver', (e.currentTarget as HTMLInputElement).value)} onchange={normalise} /><Coin coin="silver" /></span
	>
	<span class="amt"
		><input type="number" min="0" step="1" placeholder="0" aria-label="Copper" value={raw.copper} oninput={(e) => edit('copper', (e.currentTarget as HTMLInputElement).value)} onchange={normalise} /><Coin coin="copper" /></span
	>
</span>

<style>
	.money {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.amt {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 1 1 0;
		min-width: 0;
	}
	.amt:has(.g) {
		flex-grow: 1.6;
	}
	.money input[type='number'] {
		width: 100%;
		min-width: 2.5em;
	}
	.costs {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 3px;
		flex: none;
		white-space: nowrap;
	}
	.costs input {
		width: auto;
		margin: 0;
	}
</style>
