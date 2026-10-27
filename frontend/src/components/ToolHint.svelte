<script lang="ts">
	// The current tool's hint, shown in the status bar's message slot while no message holds it (#238).
	// These sentences used to sit in the options bar and pushed its controls off the screen.
	import { editor, prefs, stats, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { scriptBrush } from '../lib/script/scriptBrush.svelte'

	const texName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))
</script>

{#if editor.tool === 'sculpt'}
	{#if editor.sculptMode === 'flatten' && editor.flattenLock.on}
		<kbd>Alt</kbd>+click locks the height
	{:else if editor.sculptMode === 'hole'}
		Holes are 2×2-cell blocks, as the game keeps them · <kbd>Shift</kbd> does the other · select an area for whole-area holes
	{:else if editor.sculptMode === 'vertex' && !ui.vertexCount}
		Drag to pick points of the ground, then move them together: <kbd>Shift</kbd>+drag, Flatten, Slope · <kbd>Ctrl</kbd>+drag drops
	{/if}
{:else if editor.tool === 'paint' && editor.paintMode === 'swap' && editor.swap.keep}
	{editor.swap.from ? `Swapping ${texName(editor.swap.from)}` : 'The next stroke picks the texture to swap'}
{:else if editor.tool === 'water' && editor.waterMode === 'paint'}
	<kbd>Ctrl</kbd>+click removes water · <kbd>Alt</kbd>+click locks the height at the cursor
{:else if editor.tool === 'place'}
	<kbd>Ctrl</kbd>+scroll rotate · <kbd>Shift</kbd>+scroll scale · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>←↑↓→</kbd> offset from the cursor · <kbd>R</kbd> spin · props attach to what they're placed on{#if editor.selected}
		· Placed object selected: <kbd>←↑↓→</kbd> move · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> height · <kbd>R</kbd> spin · <kbd>Esc</kbd> deselect{/if}
{:else if editor.tool === 'path'}
	{#if editor.pathId < 0}
		Click the ground to start a path, and again to add its points
	{:else}
		Click to add a point (on the curve inserts one) · drag a point to move it, <kbd>Shift</kbd>+drag to raise it · <kbd>Del</kbd> deletes the point · <kbd>Enter</kbd> applies · <kbd>Esc</kbd> starts a new path
	{/if}
{:else if editor.tool === 'script'}
	{scriptBrush.name ? 'Each click, hold and release runs the brush script' : 'Pick a brush script in the options bar, or Run one in Tools › Scripts'} · <kbd>Shift</kbd>, <kbd>Ctrl</kbd>, <kbd>Alt</kbd> and <kbd>Space</kbd> reach it as holding_*()
	· one stroke is one undo step
{:else if editor.tool === 'stamp'}
	The size and strength are the stack's: its brushes take them unless they have their own.
{:else if editor.tool === 'doodad' && editor.doodadMode === 'creatures'}
	{#if !prefs.spawnBrush.entries.length}
		Pick creatures in the browser's Creatures tab below to put them in the brush ·
	{/if}
	drag to fill to the density · <kbd>Ctrl</kbd>+drag deletes the brush's creatures · File › Save Spawns to Database writes them
{:else if editor.tool === 'doodad'}
	drag to scatter · <kbd>Ctrl</kbd>+scroll / <kbd>R</kbd> spin the preview · <kbd>Shift</kbd> ignores the spacing so models stack · <kbd>Ctrl</kbd>+drag erases the brush's models · a model picked in the browser below joins the brush
{:else if editor.tool === 'select'}
	{#if ui.pasting}
		{#if engineRef.current?.pastingModels()}
			Click where the copies should stand.
		{/if}
	{:else if editor.selectedIds.length}
		<kbd>←↑↓→</kbd> move · <kbd>Alt+↑↓</kbd> height · <kbd>Alt+←→</kbd>/<kbd>R</kbd> spin · <kbd>Shift</kbd> bigger steps · drag to move · handles: ring spins, arrow raises, knob resizes
	{:else}
		Click a model to select it (<kbd>Shift</kbd> adds). Drag on the ground to select an area and the models in it. <kbd>Alt</kbd>+click picks a model or texture.
	{/if}
{:else if editor.tool === 'mapdata'}
	{#if editor.mapDataMode === 'area'}
		{stats.hoverArea ? `Under the cursor: ${stats.hoverArea}` : 'Under the cursor: no zone'}
	{:else if editor.mapDataMode === 'impassable'}
		Impassable chunks are hatched red. The export sets the flag (0x2) in their chunk headers.
	{:else if editor.mapDataMode === 'shadow'}
		The baked shadows (the ground's darker patches in the game) are tinted violet, 8 texels a cell. Terrain › Bake Shadows works them out from the ground.
	{:else}
		Cells that grow no grass tufts are hatched orange, as the game leaves roads bare.
	{/if}
{/if}
