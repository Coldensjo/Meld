<script lang="ts">
	// The current tool's hint, shown in the status bar's message slot while no message holds it (#238).
	// These sentences used to sit in the options bar and pushed its controls off the screen.
	import { editor, ui } from '../lib/state/editor.svelte'
</script>

{#if editor.tool === 'select'}
	{#if ui.cubePasting}
		Click to put the cubes down · <kbd>R</kbd> turns · <kbd>M</kbd> mirrors · <kbd>Enter</kbd> places · <kbd>Esc</kbd> cancels
	{:else}
		Drag from a cube to a cube to select the box between them · <kbd>Ctrl</kbd>+<kbd>C</kbd> copies · <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes · <kbd>←↑↓→</kbd> move the box · <kbd>Del</kbd> empties it
	{/if}
{:else if editor.tool === 'cube'}
	{#if editor.cubeMode === 'object'}
		Click a face to attach the object · <kbd>Ctrl</kbd>+click removes one · <kbd>Shift</kbd>+click selects one · <kbd>Del</kbd> removes the selected one · a teleporter goes on the top
	{:else if editor.cubeMode === 'paint' && editor.cubeBlend}
		Click near a face's edge to switch its blending into the texture beside it · drag to do the same along more edges · <kbd>Shift</kbd> blends all four edges · <kbd>Ctrl</kbd> none
	{:else if editor.cubeMode === 'paint'}
		Click or drag over faces to paint them · <kbd>Shift</kbd> paints the whole cube · <kbd>Ctrl</kbd> clears the paint · <kbd>Alt</kbd>+click picks a face's texture
	{:else if editor.cubeMode === 'monster'}
		Click a face to spawn the monster in the cell beside it · drag a spawn point to move it · <kbd>Ctrl</kbd>+click removes one · <kbd>Shift</kbd>+click adds another to its cube · <kbd>Alt</kbd>+click picks its kind
	{:else if editor.cubeMode === 'npc'}
		Click a face to put the NPC in the cell beside it · click an NPC to select it, <kbd>Shift</kbd>+click cubes to add to its route · drag an NPC or route cube to move it · <kbd>Ctrl</kbd>+click removes one · <kbd>Alt</kbd>+click picks its name · <kbd>Del</kbd> removes the selected NPC
	{:else if editor.cubeMode === 'prop'}
		Click the cubes to put the model there · drag a prop to move it · <kbd>R</kbd> turns it 15°, <kbd>Shift</kbd>+<kbd>R</kbd> back · <kbd>Ctrl</kbd>+click removes one · <kbd>Alt</kbd>+click picks its model · <kbd>Shift</kbd>+click places over one · <kbd>Del</kbd> removes the selected prop
	{:else if editor.cubeMode === 'mood'}
		Drag from cell to cell to give the box the mood (Higher reaches up) · <kbd>Shift</kbd>+click selects the region there · <kbd>Ctrl</kbd>+click removes it · <kbd>Alt</kbd>+click picks its mood · <kbd>Del</kbd> removes the selected one · the innermost region wins
	{:else if editor.cubeMode === 'link'}
		Click an object to select it, then the objects it acts on (again to stop) · <kbd>Shift</kbd>+click selects another · <kbd>Esc</kbd> deselects
	{:else if editor.cubeMode === 'box'}
		Drag from corner to corner to fill a box · <kbd>Ctrl</kbd>+drag empties one · <kbd>Esc</kbd> cancels · <kbd>R</kbd> turn · <kbd>Alt</kbd>+click copies a cube
	{:else}
		<kbd>Ctrl</kbd>+click removes · <kbd>R</kbd> turns, <kbd>Shift</kbd>+<kbd>R</kbd> upside down · <kbd>Alt</kbd>+click copies a cube · <kbd>,</kbd> <kbd>.</kbd> slice the layers · no building in the metal layers (26 to 30)
	{/if}
{/if}
