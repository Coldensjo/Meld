<script lang="ts">
	// The Biome Brush's options (#958): the biome it paints, the brush's size and shape, the border's
	// width, whether a stroke scatters the biome's models, and the Biomes window.
	import OptSlider from '../OptSlider.svelte'
	import { MAX_BRUSH_RADIUS, editor, prefs, ui } from '../../lib/state/editor.svelte'
	import { biomeNames, brushBiome } from '../../lib/tools/BiomeBrushTool'

	const names = $derived(biomeNames())
	const current = $derived(brushBiome()?.name ?? '')
	/** The map's own copy differs from the preferences' biome of that name: Repaint Biomes uses the map's. */
	const stale = $derived.by(() => {
		const own = editor.mapBiomes.find((b) => b.name === current)
		const mine = prefs.biomes.find((b) => b.name === current)
		return !!own && !!mine && JSON.stringify(own) !== JSON.stringify(mine)
	})
</script>

<select class="curve" value={current} onchange={(e) => (prefs.biome = (e.target as HTMLSelectElement).value)} disabled={!names.length} title="The biome a stroke paints" aria-label="Biome">
	{#if !names.length}<option value="">No biomes yet</option>{/if}
	{#each names as n (n)}
		<option value={n}>{n}{prefs.biomes.some((b) => b.name === n) ? '' : ' (this map)'}</option>
	{/each}
</select>
<button onclick={() => (ui.dialog = 'biomes')} title="Make and edit biomes: their textures, rules, ground effects and scatter (Paint › Biomes…)">Biomes…</button>
{#if stale}
	<span class="dim" title="This map keeps its own copy of the biome, which the brush paints with. Paint › Update Biomes from Mine and Repaint takes yours.">map's copy</span>
{/if}
<div class="divider"></div>
<div class="seg" title="Brush shape">
	<button class:active={editor.brush.shape === 'circle'} onclick={() => (editor.brush.shape = 'circle')} aria-label="Round brush">●</button>
	<button class:active={editor.brush.shape === 'square'} onclick={() => (editor.brush.shape = 'square')} aria-label="Square brush">■</button>
</div>
<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} width={80} title="Brush radius ( [ / ] ): the cells whose middle it covers take the biome" />
<OptSlider
	label="Border"
	bind:value={prefs.biomeBorder}
	min={0}
	max={64}
	step={1}
	digits={0}
	width={80}
	title="Yards over which two biomes blend where they meet (and a biome into unpainted ground): half on each side of the cells' edge. Repaint Biomes uses it too."
/>
<label class="check" title="Scatter the biome's doodad brushes over the cells a stroke paints, thinning out toward the border"><input type="checkbox" bind:checked={prefs.biomeScatter} /> Scatter</label>
