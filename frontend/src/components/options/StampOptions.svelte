<script lang="ts">
	// The Stamp tool's options (#593): the brush stack a stroke applies, its editor, and its image turn.
	import OptSlider from '../OptSlider.svelte'
	import { editor, prefs, ui } from '../../lib/state/editor.svelte'
	import { activeBrushStack } from '../../lib/tools/StampTool'
</script>

<select
	class="curve"
	value={activeBrushStack()?.name ?? ''}
	onchange={(e) => (prefs.brushStack = (e.target as HTMLSelectElement).value)}
	disabled={!prefs.brushStacks.length}
	title="The brush stack a stroke applies"
	aria-label="Brush stack"
>
	{#if !prefs.brushStacks.length}<option value="">No stacks yet</option>{/if}
	{#each prefs.brushStacks as s (s.name)}
		<option value={s.name}>{s.name} ({s.items.length})</option>
	{/each}
</select>
<button onclick={() => (ui.dialog = 'stack')} title="Edit the stack's brushes: their order, modes, textures and what they take from the stack">{activeBrushStack() ? 'Edit stack…' : 'New stack…'}</button>
<OptSlider label="Turn" bind:value={editor.brushImage.rotation} min={0} max={360} step={1} digits={0} width={60} title="The stack's turn for the image brush, which its brushes take unless they have their own" />
<div class="divider"></div>
