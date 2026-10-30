<script lang="ts">
	// The Paint and Road tools' options (#593): Paint's modes (paint, swap, mask) and their controls, the
	// active texture layer, Road's levelling, and with `panel` the Paint panel's rows (image, curve and
	// shape, spray, the unpaintable chunks, the mask's changes).
	import type { Snippet } from 'svelte'
	import OptSlider from '../OptSlider.svelte'
	import { editor, prefs, ui } from '../../lib/state/editor.svelte'
	import { engineRef } from '../../lib/state/engineRef'
	import { optionsVisibility } from '../../lib/ui/optionsVisibility'
	import { texName } from '../../lib/wow/texName'

	interface Props {
		/** Render the settings panel's rows instead of the bar's controls. */
		panel?: boolean
		sizeStrength: Snippet
		editLimit: Snippet
		imageBrush: Snippet
		falloffCurve: Snippet
		brushShape: Snippet
	}
	let { panel = false, sizeStrength, editLimit, imageBrush, falloffCurve, brushShape }: Props = $props()

	const vis = $derived(optionsVisibility(editor))
	const slotTex = $derived(editor.palette[editor.paintLayer])

	/** The Modify mask drop-down: runs the picked change and shows the prompt again. */
	function modifyMask(e: Event) {
		const sel = e.target as HTMLSelectElement
		const how = sel.value
		sel.value = ''
		const engine = engineRef.current
		if (!engine) return
		if (how === 'grow' || how === 'shrink' || how === 'feather' || how === 'border' || how === 'smooth') engine.modifyMask(how)
		else if (how === 'invert') engine.invertMask()
		else if (how === 'clear') engine.clearMask()
	}
</script>

{#if !panel}
	{#if editor.tool === 'paint'}
		<div class="seg">
			<button class:active={editor.paintMode === 'texture'} onclick={() => (editor.paintMode = 'texture')}>Paint</button>
			<button class:active={editor.paintMode === 'swap'} onclick={() => (editor.paintMode = 'swap')} title="Replace the texture under the start of each stroke with the active layer">Swap</button>
			<button class:active={editor.paintMode === 'mask'} onclick={() => (editor.paintMode = 'mask')} title="Paint the mask that Fill mask uses to place the active texture">Mask</button>
		</div>
		{@render sizeStrength()}
	{/if}
	{#if editor.tool === 'paint' && editor.paintMode === 'swap'}
		<select class="curve" bind:value={editor.swap.scope} title="Swap by the brush's weight, or the whole layer in every chunk the brush touches, or in the tile under it" aria-label="Swap scope">
			<option value="brush">Under the brush</option>
			<option value="chunk">Entire chunks</option>
			<option value="tile">Entire tile</option>
		</select>
		<label class="check" title="Keep swapping the texture the first stroke swapped, instead of the one under each stroke's start">
			<input type="checkbox" bind:checked={editor.swap.keep} onchange={() => (editor.swap.from = '')} /> Keep
		</label>
	{/if}
	{#if editor.tool === 'paint' && editor.paintMode === 'mask'}
		{@const ms = editor.maskSelect}
		<select class="curve" bind:value={ms.by} title="Paint the mask with the brush, or click a spot to select by what is there (Shift+click adds, Alt+click takes away)" aria-label="Select by">
			<option value="brush">Brush</option>
			<option value="texture">Select by texture</option>
			<option value="height">Select by height</option>
			<option value="slope">Select by slope</option>
			<option value="water">Select by water</option>
		</select>
		{#if ms.by === 'texture'}
			<OptSlider label="Min weight" bind:value={ms.minWeight} min={0} max={1} step={0.05} digits={2} width={60} title="Take the texels where the texture under the click weighs at least this much (0 to 1)" />
		{:else if ms.by === 'height'}
			<OptSlider label="± yd" bind:value={ms.height} min={0} max={100} step={0.5} digits={1} width={60} title="Take the ground within this many yards above or below the click" />
		{:else if ms.by === 'slope'}
			<OptSlider label="Slope from" bind:value={ms.slopeMin} min={0} max={90} step={1} digits={0} width={60} title="Take the ground at least this steep, in degrees" />
			<OptSlider label="to" bind:value={ms.slopeMax} min={0} max={90} step={1} digits={0} width={60} title="and at most this steep, in degrees" />
		{/if}
		{#if ms.by !== 'brush'}
			<label class="check" title="Only what is joined to the click; off, everything on the map that matches"><input type="checkbox" bind:checked={ms.contiguous} /> Contiguous</label>
			<OptSlider label="Feather" bind:value={ms.feather} min={0} max={20} step={0.5} digits={1} width={60} title="Soften the selection's edge over this many yards" />
		{/if}
	{/if}
	<button
		class="chip"
		onclick={() => {
			ui.palette = 'textures'
			prefs.browserCollapsed = false
		}}
		title="Active texture layer (pick textures in the asset browser below)"
	>
		<span class="dim">Layer {editor.paintLayer + 1}:</span>
		{slotTex ? texName(slotTex) : 'empty'}
	</button>
	{#if editor.tool === 'road'}
		<label class="check"><input type="checkbox" bind:checked={editor.roadFlatten} /> Level terrain</label>
		{@render editLimit()}
	{/if}
	<div class="divider"></div>
	{#if editor.tool === 'paint' && editor.paintMode === 'texture'}
		<label class="check" title="Spray random dabs over the brush instead of painting it solid (T); its dab size and pressure are in the Brush panel"><input type="checkbox" bind:checked={editor.paintSpray} /> Spray</label>
	{/if}
{:else}
	{#if vis.usesBrush}
		<div class="row">
			<span class="dim head">Brush</span>
			{#if editor.paintMode === 'texture' && !editor.paintSpray}
				{@render imageBrush()}
			{/if}
			{@render falloffCurve()}
			{@render brushShape()}
		</div>
	{/if}
	{#if vis.spraying}
		<div class="row">
			<span class="dim head">Spray</span>
			<OptSlider label="Dab size" bind:value={editor.spray.size} min={1} max={40} step={0.5} digits={1} width={60} title="Size of each spray dab" />
			<OptSlider label="Pressure" bind:value={editor.spray.pressure} min={0} max={10} step={0.1} digits={1} width={60} title="How densely the dabs land" />
			<label class="check" title="Also paint the brush's solid centre (inside the falloff)"><input type="checkbox" bind:checked={editor.spray.inner} /> Inner radius</label>
		</div>
	{/if}
	{#if editor.paintMode === 'texture'}
		<div class="row">
			<span class="dim head">Show</span>
			<label class="check" title="Tint red the chunks that already hold four other textures, where this texture can't be painted"><input type="checkbox" bind:checked={prefs.showUnpaintable} /> Unpaintable chunks</label>
		</div>
	{:else if editor.paintMode === 'mask'}
		{@const ms = editor.maskSelect}
		<div class="row">
			<span class="dim head">Mask</span>
			<select class="curve" value="" onchange={modifyMask} title="Change the whole mask (also in the Paint menu)" aria-label="Modify mask">
				<option value="" disabled>Modify mask…</option>
				<option value="grow" disabled={!ui.maskActive}>Grow by {ms.step} yd</option>
				<option value="shrink" disabled={!ui.maskActive}>Shrink by {ms.step} yd</option>
				<option value="feather" disabled={!ui.maskActive}>Feather over {ms.step} yd</option>
				<option value="border" disabled={!ui.maskActive}>Border by {ms.step} yd</option>
				<option value="smooth" disabled={!ui.maskActive}>Smooth over {ms.step} yd</option>
				<option value="invert">Invert</option>
				<option value="clear" disabled={!ui.maskActive}>Clear</option>
			</select>
			<OptSlider label="By" bind:value={ms.step} min={0.5} max={32} step={0.5} digits={1} width={50} title="How many yards Grow, Shrink, Feather, Border and Smooth change the mask by" />
		</div>
	{/if}
{/if}
