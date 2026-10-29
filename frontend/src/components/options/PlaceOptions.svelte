<script lang="ts">
	// The Place tool's options (#593): the model a click places, its random rotation, scale and tilt,
	// following and fitting the ground, scatter, the spawn being placed, and the height and offset.
	import { editor, prefs, ui } from '../../lib/state/editor.svelte'
	import { displayName } from '../../lib/models/assets'
</script>

<span class="chip" title={editor.prefab}>
	<span class="dim">Model:</span>
	{editor.prefab ? displayName(editor.prefab) : 'pick one in the browser below'}
</span>
<label class="check"><input type="checkbox" bind:checked={editor.placeRandomRot} /> Random rotation</label>
<label class="check"><input type="checkbox" bind:checked={editor.placeRandomScale} /> Random scale</label>
<label class="check" title="Tilt each placed model a little, up to 8 degrees each way"><input type="checkbox" bind:checked={editor.placeRandomTilt} /> Random tilt</label>
<label class="check" title="Tilt new models on open ground to the slope under them, as the Select tool's drag does"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
{#if editor.followGround}
	<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
{/if}
<label class="check" title="Fit the ground under each model placed on open ground to its floor, with the settings of Models › Fit Ground to Selected Models, in the same undo step"
	><input type="checkbox" bind:checked={prefs.placeFitGround} /> Fit ground</label
>
{#if prefs.placeFitGround}
	<button title="The fit's settings: margin under the floor, blend ring, raise or lower, holes" onclick={() => (ui.dialog = 'fitGround')}>Settings…</button>
{/if}
<label class="check"><input type="checkbox" bind:checked={editor.placeScatter} /> Scatter</label>
{#if ui.placeCreature || ui.placeObject}
	<span class="chip" title="The creature or object from the browser's spawn tabs that a click places (Esc stops)">
		<span class="dim">Placing:</span>
		{ui.placeCreature?.name ?? ui.placeObject?.name}
		<button class="x" onclick={() => (ui.placeCreature = ui.placeObject = null)} title="Stop placing it" aria-label="Stop placing">×</button>
	</span>
{/if}
<span class="chip" title="Height above the surface for new placements (PgUp / PgDn)">
	<span class="dim">Height:</span>
	{editor.placeHeight >= 0 ? '+' : ''}{editor.placeHeight.toFixed(2)}
</span>
{#if editor.placeHeight !== 0}
	<button onclick={() => (editor.placeHeight = 0)}>Reset</button>
{/if}
{#if editor.placeOffset.x !== 0 || editor.placeOffset.z !== 0}
	<span class="chip" title="New placements sit this far from the cursor (arrow keys)">
		<span class="dim">Offset:</span>
		{Math.hypot(editor.placeOffset.x, editor.placeOffset.z).toFixed(2)}
	</span>
	<button onclick={() => (editor.placeOffset = { x: 0, z: 0 })}>Reset</button>
{/if}
<div class="divider"></div>
