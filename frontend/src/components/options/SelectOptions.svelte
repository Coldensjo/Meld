<script lang="ts">
	// The Select tool's options (#593): while pasting, the paste's parts, blend, height and turns; else
	// the drag's shape, what is selected and how it moves, the selected area's holes, and the clipboard
	// and selection commands.
	import OptSlider from '../OptSlider.svelte'
	import { firstKeyOf } from '../../lib/ui/commands'
	import { MAX_BRUSH_RADIUS, editor, ui } from '../../lib/state/editor.svelte'
	import { engineRef } from '../../lib/state/engineRef'
	import { displayName } from '../../lib/models/assets'

	const count = $derived(editor.selectedIds.length)
</script>

{#if ui.pasting}
	{#if engineRef.current?.pastingModels()}
		<span class="chip"><span class="dim">Pasting models</span></span>
	{:else}
		<span class="chip"><span class="dim">Pasting</span></span>
		<label class="check"><input type="checkbox" bind:checked={editor.paste.terrain} /> Terrain</label>
		<label class="check"><input type="checkbox" bind:checked={editor.paste.textures} /> Textures</label>
		<label class="check"><input type="checkbox" bind:checked={editor.paste.objects} /> Objects</label>
		<label class="check" title="The copied creatures and game objects, as new spawns of this map (with their paths, and their formations and pools as far as they came along), saved with its spawns"
			><input type="checkbox" bind:checked={editor.paste.spawns} /> Spawns</label
		>
		<OptSlider label="Blend edges" bind:value={editor.paste.blend} min={0} max={8} step={1} digits={0} width={60} title="Cells over which the paste fades into the map" />
		<OptSlider label="Height" bind:value={editor.paste.heightOffset} min={-60} max={60} step={0.5} digits={1} width={70} title="Raise/lower the pasted terrain (PgUp/PgDn)" />
		<select bind:value={editor.paste.heightMode} title="How the pasted heights meet the map's" aria-label="Paste heights">
			<option value="set">Heights: replace</option>
			<option value="max">Heights: raise only</option>
			<option value="min">Heights: lower only</option>
			<option value="add">Heights: add the bumps</option>
			<option value="subtract">Heights: subtract the bumps</option>
		</select>
		<button onclick={() => engineRef.current?.rotateClip()} title="Turn the paste a quarter turn: ground, textures, holes, liquids, models and spawns together">Turn 90° <kbd>R</kbd></button>
		<button onclick={() => engineRef.current?.mirrorClip('x')} title="Mirror the paste east to west">Mirror ↔</button>
		<button onclick={() => engineRef.current?.mirrorClip('z')} title="Mirror the paste north to south">Mirror ↕</button>
	{/if}
	<button onclick={() => engineRef.current?.commitPaste()}>Place <kbd>Enter</kbd></button>
	<button onclick={() => engineRef.current?.cancelPaste()}>Cancel <kbd>Esc</kbd></button>
{:else}
	<div class="seg" title="What a drag on the ground selects">
		<button
			class:active={!editor.selectBrush && editor.selectShape === 'rect'}
			onclick={() => {
				editor.selectBrush = false
				editor.selectShape = 'rect'
			}}
			title="Drag a rectangle: the area and the models in it (L cycles the shapes)">Area</button
		>
		<button
			class:active={!editor.selectBrush && editor.selectShape === 'lasso'}
			onclick={() => {
				editor.selectBrush = false
				editor.selectShape = 'lasso'
			}}
			title="Draw the area freehand; Shift adds to it, Ctrl takes from it (L cycles the shapes)">Lasso</button
		>
		<button
			class:active={!editor.selectBrush && editor.selectShape === 'polygon'}
			onclick={() => {
				editor.selectBrush = false
				editor.selectShape = 'polygon'
			}}
			title="Click the area's corners; Enter or a click on the first corner closes it. Shift adds, Ctrl takes away (L cycles the shapes)">Polygon</button
		>
		<button class:active={editor.selectBrush} onclick={() => (editor.selectBrush = true)} title="Brush over the models to select them: Shift adds to the selection, Ctrl takes models out">Brush</button>
	</div>
	{#if editor.selectBrush}
		<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} title="Selection brush radius ( [ / ] )" />
	{/if}
	{#if editor.selected && count <= 1}
		<span class="chip"><span class="dim">Selected:</span> {displayName(editor.selected.type)}</span>
		<label class="check" title="Dragging the model moves it along the ground (and onto buildings) under the cursor; off, it slides across a level plane at its own height"
			><input type="checkbox" bind:checked={editor.moveFollowCursor} /> Follow cursor on the ground</label
		>
	{:else if count > 1}
		<span class="chip"><span class="dim">Selected:</span> {count} objects</span>
		<label class="check" title="Dragging the group sets each model on the ground where it lands (its height above it kept); off, every model keeps its height"
			><input type="checkbox" bind:checked={editor.moveSnapGroup} /> Snap models to the ground</label
		>
		<label class="check" title="R, Alt+arrows and the gizmo ring turn the group about the mean of its positions, so it keeps its shape; off, each model turns about its own origin"
			><input type="checkbox" bind:checked={editor.rotatePivot} /> Rotate around pivot point</label
		>
	{/if}
	{#if editor.selection}
		{@const s = editor.selection}
		{@const holes = engineRef.current?.holesInSelection() ?? 0}
		<span class="chip" title="The selected area of the ground"><span class="dim">Area:</span> {s.x1 - s.x0} × {s.z1 - s.z0} cells{holes ? ` (${holes} hole)` : ''}</span>
		<button onclick={() => engineRef.current?.setHoleInSelection(true)} title="Cut the ground away in the selected area, so a cave or cellar can go below">Cut hole</button>
		<button disabled={!holes} onclick={() => engineRef.current?.setHoleInSelection(false)} title="Put the ground back in the selected area">Fill hole</button>
	{/if}
	{#if count || editor.selection}
		<button onclick={() => engineRef.current?.copySelection()} title={count ? 'Copy the selected models' : 'Copy the selected area'}>Copy <kbd>Ctrl+C</kbd></button>
	{/if}
	{#if ui.hasClip}
		<button onclick={() => engineRef.current?.startPaste()}>Paste <kbd>Ctrl+V</kbd></button>
	{/if}
	{#if count}
		<button onclick={() => engineRef.current?.duplicateSelected()} title="Put a copy of the selected models down next to them">Duplicate <kbd>Ctrl+Shift+D</kbd></button>
		<button onclick={() => engineRef.current?.focusSelected()}>Focus <kbd>F</kbd></button>
		<button onclick={() => engineRef.current?.deleteSelected()}>Delete <kbd>{firstKeyOf('deleteSelected')}</kbd></button>
	{/if}
	{#if count || editor.selection}
		<button onclick={() => engineRef.current?.deselect()}>Deselect <kbd>Esc</kbd></button>
	{/if}
	<div class="divider"></div>
	<label class="check" title="Tilt a model to the ground's slope while dragging it along the ground"><input type="checkbox" bind:checked={editor.followGround} /> Follow ground rotation</label>
	{#if editor.followGround}
		<label class="check" title="Use the slope averaged over the neighbouring cells, not the slope right under the model"><input type="checkbox" bind:checked={editor.followGroundSmooth} /> Smooth</label>
	{/if}
{/if}
