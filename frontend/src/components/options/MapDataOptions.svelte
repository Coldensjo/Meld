<script lang="ts">
	// The Map data tool's options (#593): what the brush paints into the chunks (zone, impassable, no
	// tufts, shadow), set or clear, and the zone picker.
	import { onMount } from 'svelte'
	import { editor } from '../../lib/state/editor.svelte'
	import { areaName, loadAreas } from '../../lib/wow/areas'
	import type { vmangos } from '../../lib/wails/models'

	/** The client's zones for the picker, read when the tool is first opened. */
	let areas = $state<vmangos.Area[]>([])
	onMount(() => void loadAreas().then((a) => (areas = a)))
	/** The picker's text: the picked zone's name and ID (named again once the zones arrive). */
	const areaText = $derived.by(() => {
		void areas
		const id = editor.mapDataArea
		return id ? `${areaName(id)} (${id})` : ''
	})
	/** Takes the zone from what was typed or chosen in the picker: its "(id)", or a name that matches one. */
	function pickArea(input: HTMLInputElement) {
		const text = input.value
		const m = /\((\d+)\)\s*$/.exec(text)
		const id = m ? Number(m[1]) : (areas.find((a) => a.name.toLowerCase() === text.trim().toLowerCase())?.id ?? 0)
		if (id) {
			editor.mapDataArea = id
			editor.mapDataClear = false
		}
		// Text that names no zone, or the same zone, leaves areaText as it was, so the input is set back by hand.
		input.value = editor.mapDataArea ? `${areaName(editor.mapDataArea)} (${editor.mapDataArea})` : ''
	}
</script>

<select class="curve" bind:value={editor.mapDataMode} title="What the brush paints into the chunks" aria-label="Map data">
	<option value="area">Zone</option>
	<option value="impassable">Impassable</option>
	<option value="noTufts">No tufts</option>
	<option value="shadow">Shadow</option>
</select>
<div
	class="seg"
	title={editor.mapDataMode === 'area'
		? 'Set the zone under the brush, or clear it'
		: editor.mapDataMode === 'impassable'
			? 'Mark the chunks under the brush impassable, or make them passable again'
			: editor.mapDataMode === 'shadow'
				? 'Paint baked shadow under the brush, or light it again'
				: 'Mark the cells under the brush as growing no tufts, or let them grow again'}
>
	<button class:active={!editor.mapDataClear} onclick={() => (editor.mapDataClear = false)}>Set</button>
	<button class:active={editor.mapDataClear} onclick={() => (editor.mapDataClear = true)}>Clear</button>
</div>
{#if editor.mapDataMode === 'area'}
	<input
		class="area"
		list="meld-areas"
		placeholder={areas.length ? 'Zone: type a name' : 'Zones need the client'}
		title="The zone (AreaTable.dbc) the brush paints into the chunks; Alt+click a chunk to take its zone"
		aria-label="Zone"
		value={areaText}
		onchange={(e) => pickArea(e.currentTarget)}
	/>
	<datalist id="meld-areas">
		{#each areas as a (a.id)}
			<option value="{areaName(a.id)} ({a.id})"></option>
		{/each}
	</datalist>
{/if}

<style>
	.area {
		width: 240px;
		flex: none;
	}
</style>
