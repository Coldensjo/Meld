<script lang="ts">
	// The Doodad tool's options (#593): its modes (models, or creatures with the spawn brush,
	// SpawnBrushOptions), the doodad brush and its editor, and with `panel` the Placement panel's rows
	// (curve, following the ground, slope, sea and props).
	import type { Snippet } from 'svelte'
	import OptSlider from '../OptSlider.svelte'
	import SpawnBrushOptions from './SpawnBrushOptions.svelte'
	import { editor, prefs, ui } from '../../lib/state/editor.svelte'
	import { activeDoodadBrush, addDoodadBrush } from '../../lib/tools/DoodadBrushTool'

	interface Props {
		/** Render the settings panel's rows instead of the bar's controls. */
		panel?: boolean
		sizeStrength: Snippet
		falloffCurve: Snippet
	}
	let { panel = false, sizeStrength, falloffCurve }: Props = $props()

	/** Opens the brush editor window, making a brush first when there is none. */
	function editBrush() {
		if (!activeDoodadBrush()) addDoodadBrush()
		ui.brushEditor = true
	}
</script>

{#if !panel}
	<div class="seg" title="Paint models with a doodad brush, or creatures with the spawn brush">
		<button class:active={editor.doodadMode === 'models'} onclick={() => (editor.doodadMode = 'models')}>Models</button>
		<button class:active={editor.doodadMode === 'creatures'} onclick={() => (editor.doodadMode = 'creatures')}>Creatures</button>
	</div>
	{@render sizeStrength()}
{/if}
{#if editor.doodadMode === 'creatures'}
	<SpawnBrushOptions {panel} />
{:else if !panel}
	<select
		class="curve"
		value={activeDoodadBrush()?.name ?? ''}
		onchange={(e) => (prefs.doodadBrush = (e.target as HTMLSelectElement).value)}
		disabled={!prefs.doodadBrushes.length}
		title="The brush to paint with"
		aria-label="Doodad brush"
	>
		{#if !prefs.doodadBrushes.length}<option value="">No brushes yet</option>{/if}
		{#each prefs.doodadBrushes as b (b.name)}
			<option value={b.name}>{b.name} ({b.entries.length})</option>
		{/each}
	</select>
	<button onclick={editBrush} title="Open the brush editor: the brush's models, weights, scale, sink and tilt">
		{activeDoodadBrush() ? 'Edit brush…' : 'New brush…'}
	</button>
	<label class="check"><input type="checkbox" bind:checked={editor.doodad.randomRot} /> Random rotation</label>
{:else}
	<div class="row">
		<span class="dim head">Brush</span>
		{@render falloffCurve()}
	</div>
	<div class="row">
		<span class="dim head">Ground</span>
		<label class="check" title="Tilt placed models to the slope under them (instead of each model's random tilt)"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
		{#if editor.followGround}
			<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
		{/if}
		<OptSlider label="Max slope" bind:value={editor.doodad.maxSlope} min={0} max={90} step={1} digits={0} width={60} title="Put nothing on ground steeper than this many degrees (90 allows any slope)" />
	</div>
	<div class="row">
		<span class="dim head"></span>
		<label class="check" title="Put nothing on ground under the sea level"><input type="checkbox" bind:checked={editor.doodad.avoidWater} /> Keep out of the sea</label>
		<label class="check" title="Let placements land on props under the brush, attached to them as the Place tool attaches (a model on a prop keeps its random tilt)"
			><input type="checkbox" bind:checked={editor.doodad.onProps} /> On props</label
		>
	</div>
{/if}
