<script lang="ts">
	import CubePalette from './CubePalette.svelte'
	import { prefs } from '../lib/state/editor.svelte'
	import { cssViewport, toCss } from '../lib/ui/uiScale'

	// The browser along the bottom of the window: its frame (the height, dragged by its top edge, and
	// folding away) around the cube palette (#63), which has the tabs, the search and the tiles.

	// Drag the top edge to resize.
	function startResize(e: PointerEvent) {
		const startY = e.clientY
		const startH = prefs.browserHeight
		const el = e.currentTarget as HTMLElement
		el.setPointerCapture(e.pointerId)
		const move = (ev: PointerEvent) => {
			prefs.browserHeight = Math.round(Math.min(cssViewport().h * 0.7, Math.max(160, startH + toCss(startY - ev.clientY))))
		}
		const up = () => {
			el.removeEventListener('pointermove', move)
			el.removeEventListener('pointerup', up)
		}
		el.addEventListener('pointermove', move)
		el.addEventListener('pointerup', up)
	}
</script>

<section class="browser" class:collapsed={prefs.browserCollapsed} style:height={prefs.browserCollapsed ? undefined : `${prefs.browserHeight}px`}>
	{#if !prefs.browserCollapsed}
		<div class="resizer" role="separator" aria-orientation="horizontal" onpointerdown={startResize}></div>
	{/if}
	<CubePalette />
</section>

<style>
	.browser {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: none;
		min-height: 0;
		background: var(--panel);
		border-top: 1px solid var(--border);
	}
	.resizer {
		position: absolute;
		top: -3px;
		left: 0;
		right: 0;
		height: 6px;
		cursor: row-resize;
		z-index: 5;
	}
	.resizer:hover {
		background: var(--accent);
		opacity: 0.5;
	}
</style>
