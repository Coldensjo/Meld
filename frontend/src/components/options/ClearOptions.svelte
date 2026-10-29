<script lang="ts">
	// The Clear tool's options (#593): what the brush erases, and the threshold for faint layers.
	import OptSlider from '../OptSlider.svelte'
	import { editor } from '../../lib/state/editor.svelte'
</script>

<select class="curve" bind:value={editor.clearMode} title="What the brush erases" aria-label="What to clear">
	<option value="models">Models</option>
	<option value="textures">Textures (to base)</option>
	<option value="faint">Faint layers (below threshold)</option>
	<option value="heights">Height (to zero)</option>
	<option value="liquids">Liquids (painted water)</option>
	<option value="holes">Holes (fill)</option>
</select>
{#if editor.clearMode === 'faint'}
	<OptSlider label="Threshold %" bind:value={editor.clearThreshold} min={1} max={50} step={1} digits={0} title="A painted layer goes from a chunk the brush touches when it is weaker than this everywhere in the chunk" />
{/if}
