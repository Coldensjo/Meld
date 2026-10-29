<script lang="ts">
	// The Water tool's options (#593): its modes, the liquid and its height lock or the sea level on the
	// bar, and with `panel` the Water panel's rows (surface, override, opacity, layers) while painting
	// water, or the Brush row (edit limit, curve, shape) while digging or raising the shore.
	import type { Snippet } from 'svelte'
	import OptSlider from '../OptSlider.svelte'
	import { editor, wow } from '../../lib/state/editor.svelte'
	import { engineRef } from '../../lib/state/engineRef'
	import { LIQUID_TYPES } from '../../lib/water/liquids'

	interface Props {
		/** Render the settings panel's rows instead of the bar's controls. */
		panel?: boolean
		sizeStrength: Snippet
		editLimit: Snippet
		falloffCurve: Snippet
		brushShape: Snippet
	}
	let { panel = false, sizeStrength, editLimit, falloffCurve, brushShape }: Props = $props()

	/** The client's liquids, re-read when the client's table arrives (LIQUID_TYPES is a plain array). */
	const liquidList = $derived.by(() => {
		void wow.liquidsRevision
		return [...LIQUID_TYPES]
	})
</script>

{#if !panel}
	<div class="seg">
		<button class:active={editor.waterMode === 'paint'} onclick={() => (editor.waterMode = 'paint')} title="Paint liquid: click adds it, Ctrl+click removes it">Paint water</button>
		<button class:active={editor.waterMode === 'dig'} onclick={() => (editor.waterMode = 'dig')} title="Lower the ground to below the sea level">Dig lake</button>
		<button class:active={editor.waterMode === 'shore'} onclick={() => (editor.waterMode = 'shore')} title="Raise the ground to just above the sea level">Raise shore</button>
	</div>
	{@render sizeStrength()}
	{#if editor.waterMode === 'paint'}
		<select class="curve" bind:value={editor.water.liquid} title="The liquid to paint (the client's LiquidType)" aria-label="Liquid">
			{#each liquidList as l (l.id)}
				<option value={l.id}>{l.name}</option>
			{/each}
		</select>
		<label class="check" title="Paint the surface at the locked height (Alt+click sets it from the cursor); off, at the cursor's height"><input type="checkbox" bind:checked={editor.water.lock} /> Lock</label>
		{#if editor.water.lock}
			<OptSlider label="Height" bind:value={editor.water.lockPos.y} min={-200} max={400} step={0.1} digits={1} width={80} title="The locked surface height (Alt+click picks it)" />
		{/if}
		<label class="check" title="The brush stops on liquid surfaces (and the sea), not just the ground"><input type="checkbox" bind:checked={editor.water.onLiquids} /> On liquids</label>
	{:else}
		<span class="chip" title="The map's sea level, set in File > Map Properties"><span class="dim">Sea level:</span> {editor.waterEnabled ? editor.waterLevel.toFixed(1) : 'off'}</span>
	{/if}
{:else if editor.waterMode === 'paint'}
	<div class="row">
		<span class="dim head">Surface</span>
		<label class="check" title="Tilt the surface for flowing rivers"><input type="checkbox" bind:checked={editor.water.angled} /> Angled</label>
		{#if editor.water.angled}
			<OptSlider label="Angle" bind:value={editor.water.angle} min={0} max={89} step={0.5} digits={1} width={60} title="How steeply the surface rises, in degrees" />
			<OptSlider label="Direction" bind:value={editor.water.orientation} min={0} max={360} step={1} digits={0} width={60} title="Direction the surface rises toward, in degrees (0 is east, 90 south). It pivots on the locked point." />
		{/if}
	</div>
	<div class="row">
		<span class="dim head">Override</span>
		<label class="check" title="Water already there takes the brush's height too"><input type="checkbox" bind:checked={editor.water.overrideHeight} /> Height</label>
		<label class="check" title="Painting replaces other liquids under the brush; off, it adds to whichever is there"><input type="checkbox" bind:checked={editor.water.overrideId} /> Type</label>
	</div>
	<div class="row">
		<span class="dim head">Opacity</span>
		<select class="curve" bind:value={editor.water.opacity} title="How quickly the water turns opaque with depth" aria-label="Opacity">
			<option value="auto">Auto</option>
			<option value="river">River</option>
			<option value="ocean">Ocean</option>
			<option value="custom">Custom</option>
		</select>
		{#if editor.water.opacity === 'custom'}
			<OptSlider label="Factor" bind:value={editor.water.customOpacity} min={0} max={1} step={0.001} digits={3} width={60} title="Depth factor: (depth + 1) × factor is the opacity" />
		{/if}
		<button onclick={() => engineRef.current?.regenWaterOpacity()} title="Recompute the water's opacity from the ground, in the selected area or the whole map">Regen opacity</button>
	</div>
	<div class="row">
		<span class="dim head">Layers</span>
		<label class="check" title="Draw every liquid layer of each chunk; off, only the current layer, so one under another can be seen"><input type="checkbox" bind:checked={editor.water.allLayers} /> All layers</label>
		{#if !editor.water.allLayers}
			<label class="check" title="The layer drawn in each chunk, counted from 0 in the chunk's own order (a chunk holds a layer per liquid)"
				>Layer <input class="num" type="number" min="0" max="7" step="1" bind:value={editor.water.layer} /></label
			>
		{/if}
		<button onclick={() => engineRef.current?.cropWater()} title="Remove the liquid that lies under the ground, in the selected area or the whole map">Crop water</button>
	</div>
{:else}
	<div class="row">
		<span class="dim head">Brush</span>
		{@render editLimit()}
		{@render falloffCurve()}
		{@render brushShape()}
	</div>
{/if}

<style>
	.num {
		width: 70px;
	}
</style>
