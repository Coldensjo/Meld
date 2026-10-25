<script lang="ts" module>
	import type { HeightmapMode } from '../lib/io/heightmapImport'

	/** The last choices, kept for the session so a second import starts from them. */
	const last = $state({ mode: 'set' as HeightmapMode, min: -1024, max: 1024, scope: 'map' as 'map' | 'tile', tiledEdges: false })
	/** The watermap's last depths, in yards above the ground. */
	const lastWater = $state({ min: 0.5, max: 8 })
</script>

<script lang="ts">
	import Modal from './Modal.svelte'
	import { importHeightmap, importWatermap } from '../lib/io/images'
	import { engineRef } from '../lib/state/engineRef'

	// Import/Export › Import Heightmap (Noggit Red's heightmap importer): the image's black and white become the
	// Min and Max heights, which are set on the ground or added to, subtracted from or multiplied into it.
	// With `water` it is Import/Export › Import Watermap: black is no water and the greys are the water's depth
	// above the ground, from Min to Max (the owner's choice for Noggit Red's unfinished watermap import).

	interface Props {
		onclose: () => void
		water?: boolean
	}
	let { onclose, water = false }: Props = $props()
	const range = $derived(water ? lastWater : last)

	const MODES: Array<[HeightmapMode, string, string]> = [
		['set', 'Set', "The ground takes the image's heights"],
		['add', 'Add', "The image's heights are added to the ground"],
		['subtract', 'Subtract', "The image's heights are taken off the ground"],
		['multiply', 'Multiply', "The ground is multiplied by the image's heights (use a Min and Max around 1)"],
	]

	/** Noggit Red's Auto Heights: Min and Max from the ground the import covers now. */
	function autoHeights() {
		const r = engineRef.current?.heightRange(last.scope)
		if (!r) return
		last.min = Math.floor(r[0] * 100) / 100
		last.max = Math.ceil(r[1] * 100) / 100
	}

	async function run() {
		const e = engineRef.current
		if (!e) return
		onclose()
		if (water) await importWatermap(e, { ...lastWater })
		else await importHeightmap(e, { ...last })
	}
</script>

<Modal title={water ? 'Import watermap' : 'Import heightmap'} width={420} {onclose}>
	{#if water}
		<p class="dim">
			A greyscale PNG: black is no water; a grey is the water's depth above the ground, from Min (darkest) to Max (white). Cells whose four corners aren't black get water. An image of another size is stretched over the whole map. Undo
			removes it.
		</p>
	{:else}
		<p class="dim">A greyscale PNG: black becomes Min and white becomes Max. An image of another size is stretched over the whole map. Undo reverts the import.</p>
	{/if}
	<div class="form">
		{#if !water}
			<span class="k">Mode</span>
			<div class="seg">
				{#each MODES as [v, label, title] (v)}
					<button class:active={last.mode === v} onclick={() => (last.mode = v)} {title}>{label}</button>
				{/each}
			</div>
		{/if}
		{#if !water}
			<span class="k">Onto</span>
			<div class="seg">
				<button class:active={last.scope === 'map'} onclick={() => (last.scope = 'map')} title="The image covers the whole map">Whole map</button>
				<button class:active={last.scope === 'tile'} onclick={() => (last.scope = 'tile')} title="The image covers the client tile under the camera">Tile under camera</button>
			</div>
			{#if last.scope === 'tile'}
				<span class="k"></span>
				<label
					class="check"
					title="The image covers the tile less its last row and column (the vertices it shares with the next tiles), so tiles imported one by one meet without seams: a 128 image instead of 129, as Noggit Red's 256 instead of 257"
				>
					<input type="checkbox" bind:checked={last.tiledEdges} /> Tiled edges
				</label>
			{/if}
		{/if}
		<label class="k" for="hm-min">{water ? 'Min depth' : 'Min (black)'}</label>
		<input id="hm-min" type="number" step="any" bind:value={range.min} />
		<label class="k" for="hm-max">{water ? 'Max depth (white)' : 'Max (white)'}</label>
		<input id="hm-max" type="number" step="any" bind:value={range.max} />
		{#if !water}
			<span class="k"></span>
			<button onclick={autoHeights} title="Min and Max from the lowest and highest ground the import covers now">Auto heights</button>
		{/if}
	</div>
	{#if !water}<p class="dim">Min −1024 and Max 1024 with Set read back a heightmap Meld exported exactly.</p>{/if}
	{#snippet actions()}
		<button onclick={onclose}>Cancel</button>
		<button class="active" onclick={() => void run()}>Choose image…</button>
	{/snippet}
</Modal>

<style>
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.form {
		display: grid;
		grid-template-columns: 100px 1fr;
		gap: 8px;
		align-items: center;
		margin: 8px 0;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.seg {
		display: flex;
		gap: 2px;
	}
	.seg button {
		flex: 1;
	}
</style>
