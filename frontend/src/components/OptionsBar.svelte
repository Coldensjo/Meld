<script lang="ts">
	// The options bar (#254): the tool's controls on one row, what doesn't fit under More, and the tool's
	// settings panel. Each tool's controls are a component in options/ (#593), given the brush controls
	// several tools share as snippets.
	import { optionsVisibility } from '../lib/ui/optionsVisibility'
	import OptSlider from './OptSlider.svelte'
	import ScriptBrushBar from './ScriptBrushBar.svelte'
	import ClearOptions from './options/ClearOptions.svelte'
	import DoodadOptions from './options/DoodadOptions.svelte'
	import MapDataOptions from './options/MapDataOptions.svelte'
	import PaintOptions from './options/PaintOptions.svelte'
	import PathOptions from './options/PathOptions.svelte'
	import PlaceOptions from './options/PlaceOptions.svelte'
	import SculptOptions from './options/SculptOptions.svelte'
	import SelectOptions from './options/SelectOptions.svelte'
	import StampOptions from './options/StampOptions.svelte'
	import WaterOptions from './options/WaterOptions.svelte'
	import { TOOLS } from './Toolbar.svelte'
	import { MAX_BRUSH_RADIUS, editor, prefs, setStatus } from '../lib/state/editor.svelte'
	import { FALLOFF_CURVES } from '../lib/tools/brush'
	import { chooseBrushImageFolder, listBrushImages, useBrushImage } from '../lib/io/brushImages'

	const tool = $derived(TOOLS.find((t) => t.id === editor.tool)!)
	// Which controls show for the tool and its modes (lib/ui/optionsVisibility.ts, #584).
	const vis = $derived(optionsVisibility(editor))
	const usesBrush = $derived(vis.usesBrush)
	const paintingWater = $derived(vis.paintingWater)
	const vertexMode = $derived(vis.vertexMode)
	const mapData = $derived(vis.mapData)
	const spawnBrushing = $derived(vis.spawnBrushing)
	const sizeAfterModes = $derived(vis.sizeAfterModes)
	const sliderW = $derived(vis.sliderWidth)
	const falloffOnBar = $derived(vis.falloffOnBar)
	const hasPanel = $derived(vis.hasPanel)
	const sculptPainting = $derived(vis.sculptPainting)
	const spraying = $derived(vis.spraying)
	const panelLabel = $derived(vis.panelLabel)
	const panelTitle = $derived(vis.panelTitle)

	/** The brush image folder's images, read when the picker opens; and the picker's folder entry. */
	let brushImages = $state<string[]>([])
	const FOLDER = '<folder>'
	async function refreshImages() {
		brushImages = await listBrushImages()
	}
	async function pickImage(value: string) {
		if (value === FOLDER) {
			if (await chooseBrushImageFolder()) {
				await refreshImages()
				setStatus(brushImages.length ? `${brushImages.length} brush images in ${prefs.brushImageDir}.` : `No PNG or JPEG images in ${prefs.brushImageDir}.`, 5000)
			}
			// The select shows the image in use again.
			brushImages = [...brushImages]
			return
		}
		await useBrushImage(value)
	}

	// The bar is one row: what doesn't fit wraps onto rows below it, which the bar clips, and the More
	// button opens the bar over the viewport to show them (#254). `hidden` counts the wrapped controls.
	let root = $state<HTMLDivElement>()
	let bar = $state<HTMLDivElement>()
	let hidden = $state(0)
	let open = $state(false)
	/** Whether a control sits below the bar's first row. */
	const wrapped = (el: Element) => {
		const r = el.getBoundingClientRect()
		return r.width > 0 && r.top - bar!.getBoundingClientRect().top > 20
	}
	/** Counts the wrapped controls; the observers call it once for each batch of changes. */
	function measure() {
		if (bar) hidden = [...bar.children].filter(wrapped).length
	}
	$effect(() => {
		if (!bar) return
		const resize = new ResizeObserver(measure)
		resize.observe(bar)
		// Controls come and go with the tool, its mode and its switches; a label's text can widen one.
		const changes = new MutationObserver(measure)
		changes.observe(bar, { childList: true, subtree: true, characterData: true })
		measure()
		return () => {
			resize.disconnect()
			changes.disconnect()
		}
	})
	// The panel button (brushbtn) opens the settings panel under the bar; it sits outside the clipped bar.
	let brushOpen = $state(false)
	let brushBtn = $state<HTMLButtonElement>()
	let brushPanel = $state<HTMLDivElement>()
	let brushLeft = $state(0)
	function toggleBrush(e: MouseEvent) {
		brushOpen = !brushOpen
		if (!brushOpen || !brushBtn || !root) return
		brushLeft = brushBtn.offsetLeft
		// A keyboard press (no pointer, detail 0) takes focus into the panel, so Tab walks its controls.
		const keyboard = e.detail === 0
		requestAnimationFrame(() => {
			if (!brushPanel || !root) return
			brushLeft = Math.max(0, Math.min(brushLeft, root.clientWidth - brushPanel.offsetWidth - 4))
			if (keyboard) brushPanel.querySelector<HTMLElement>('button, input, select')?.focus()
		})
	}
	// A new tool, or a new mode of a tool whose panel holds other settings per mode, starts with the bar
	// and the panel closed.
	$effect(() => {
		void editor.tool
		void editor.waterMode
		void editor.doodadMode
		void editor.paintMode
		open = false
		brushOpen = false
	})
	$effect(() => {
		if (!open && !brushOpen) return
		const away = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) {
				open = false
				brushOpen = false
			}
		}
		window.addEventListener('pointerdown', away, true)
		return () => window.removeEventListener('pointerdown', away, true)
	})
	/** Tab onto a control the bar clips opens it, so every control stays reachable from the keyboard. */
	function onFocusIn(e: FocusEvent) {
		// Focus scrolls the clipped bar to bring the control into view; the bar shows its first row.
		bar!.scrollTop = 0
		if (!open && e.target instanceof Element && wrapped(e.target)) open = true
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && brushOpen) {
			brushOpen = false
			brushBtn?.focus()
			e.stopPropagation()
		} else if (e.key === 'Escape' && open) {
			open = false
			e.stopPropagation()
		}
	}
</script>

{#snippet imageBrush()}
	<select
		class="curve"
		value={editor.brushImage.name}
		onfocus={refreshImages}
		onchange={(e) => pickImage(e.currentTarget.value)}
		title="Shape the brush with a greyscale image from your brush image folder: the stroke takes the image's light parts"
		aria-label="Brush image"
	>
		<option value="">Image: none</option>
		{#each brushImages as name (name)}
			<option value={name}>Image: {name}</option>
		{/each}
		<option value={FOLDER}>Image folder…</option>
	</select>
	{#if editor.brushImage.name}
		<OptSlider label="Turn" bind:value={editor.brushImage.rotation} min={0} max={360} step={1} digits={0} width={60} title="The image's rotation, in degrees" />
		<label class="check" title="Turn the image to a new random rotation after each stroke"><input type="checkbox" bind:checked={editor.brushImage.random} /> Random turn</label>
	{/if}
{/snippet}

<!-- The brush's size and strength, the controls used most: right after the tool's modes where it has
		 them, so they stay on the bar's first row when the rest wraps under More. -->
{#snippet sizeStrength()}
	{#if usesBrush}
		{#if !vertexMode}
			<OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={MAX_BRUSH_RADIUS} step={0.5} digits={1} width={sliderW} title="Brush radius ( [ / ] )" />
		{/if}
		{#if !paintingWater && !mapData && !spawnBrushing}
			<OptSlider
				label="Strength"
				width={sliderW}
				bind:value={editor.brush.strength}
				min={0.02}
				max={editor.tool === 'sculpt' ? 10 : 1}
				step={0.01}
				digits={2}
				title={vertexMode ? 'How fast Shift+drag moves the selected vertices' : editor.tool === 'sculpt' ? 'How fast the ground moves: up to ten times the normal speed, for big mountains' : undefined}
			/>
		{/if}
		{#if falloffOnBar}
			<OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} width={sliderW} />
		{/if}
	{/if}
{/snippet}

{#snippet falloffCurve()}
	<select class="curve" bind:value={editor.brush.curve} title="How the brush weight falls off across the falloff band" aria-label="Falloff curve">
		{#each FALLOFF_CURVES as c (c.id)}
			<option value={c.id}>{c.name}</option>
		{/each}
	</select>
{/snippet}

{#snippet brushShape()}
	<div class="seg" title="Brush shape">
		<button class:active={editor.brush.shape === 'circle'} onclick={() => (editor.brush.shape = 'circle')} aria-label="Round brush">●</button>
		<button class:active={editor.brush.shape === 'square'} onclick={() => (editor.brush.shape = 'square')} aria-label="Square brush">■</button>
	</div>
	{#if editor.brush.shape === 'square'}
		<label class="check" title="Align square brushes to the terrain grid"><input type="checkbox" bind:checked={editor.brush.snap} /> Snap to grid</label>
	{/if}
{/snippet}

{#snippet editLimit()}
	<select class="curve" bind:value={editor.sculptLimit} title="Only change ground above or below the height under the cursor" aria-label="Edit limit">
		<option value="none">Any height</option>
		<option value="above">Only above cursor</option>
		<option value="below">Only below cursor</option>
	</select>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="optbar" bind:this={root} onkeydown={onKeyDown}>
	<div class="options" class:open class:withMore={hidden > 0 || open} bind:this={bar} onfocusin={onFocusIn}>
		<div class="tool" title="{tool.name}: {tool.desc}">
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
				<path d={tool.icon} />
			</svg>
		</div>
		<div class="divider"></div>

		{#if editor.tool === 'sculpt'}
			<SculptOptions {sizeStrength} {editLimit} {imageBrush} {falloffCurve} {brushShape} />
		{:else if editor.tool === 'paint' || editor.tool === 'road'}
			<PaintOptions {sizeStrength} {editLimit} {imageBrush} {falloffCurve} {brushShape} />
		{:else if editor.tool === 'path'}
			<PathOptions />
		{:else if editor.tool === 'water'}
			<WaterOptions {sizeStrength} {editLimit} {falloffCurve} {brushShape} />
		{:else if editor.tool === 'place'}
			<PlaceOptions />
		{:else if editor.tool === 'stamp'}
			<StampOptions />
		{:else if editor.tool === 'script'}
			<ScriptBrushBar />
			<div class="divider"></div>
		{:else if editor.tool === 'doodad'}
			<DoodadOptions {sizeStrength} {falloffCurve} />
		{:else if editor.tool === 'select'}
			<SelectOptions />
		{/if}

		<!-- The tools with modes keep their shape and falloff curve in the settings panel (#715, #734). -->
		{#if usesBrush && !sizeAfterModes}
			{#if editor.tool !== 'place' && !mapData}
				{@render brushShape()}
			{/if}
			{@render sizeStrength()}
			{#if editor.tool !== 'road' && editor.tool !== 'place' && !mapData}
				<OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} />
				{@render falloffCurve()}
			{/if}
		{/if}
		{#if editor.tool === 'clear'}
			<ClearOptions />
		{/if}
		{#if mapData}
			<MapDataOptions />
		{/if}
		{#if hasPanel}
			<div class="divider"></div>
			<button class="brushbtn" class:active={brushOpen} class:painting={sculptPainting || spraying} bind:this={brushBtn} onclick={toggleBrush} aria-expanded={brushOpen} title={panelTitle}>{panelLabel} {brushOpen ? '▴' : '▾'}</button>
		{/if}
	</div>
	{#if hidden > 0 || open}
		<button class="more" class:active={open} onclick={() => (open = !open)} aria-expanded={open} title="Show the {hidden} controls that don't fit on the bar (Tab reaches them too; Esc or a click elsewhere closes it)"
			>More ({hidden}) {open ? '▴' : '▾'}</button
		>
	{/if}
	{#if brushOpen && hasPanel && editor.tool !== 'sculpt'}
		<div class="brushpanel" bind:this={brushPanel} style:left="{brushLeft}px" role="group" aria-label="{panelLabel} settings">
			{#if editor.tool === 'water'}
				<WaterOptions panel {sizeStrength} {editLimit} {falloffCurve} {brushShape} />
			{:else if editor.tool === 'doodad'}
				<DoodadOptions panel {sizeStrength} {falloffCurve} />
			{:else if editor.tool === 'paint'}
				<PaintOptions panel {sizeStrength} {editLimit} {imageBrush} {falloffCurve} {brushShape} />
			{/if}
		</div>
	{/if}
	{#if brushOpen && editor.tool === 'sculpt' && !vertexMode}
		<div class="brushpanel" bind:this={brushPanel} style:left="{brushLeft}px" role="group" aria-label="Brush settings">
			<SculptOptions panel {sizeStrength} {editLimit} {imageBrush} {falloffCurve} {brushShape} />
		</div>
	{/if}
</div>

<style>
	.optbar {
		position: relative;
		height: 34px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	/* One row of controls; the rest wrap below it and are clipped until More opens the bar. */
	.options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		align-content: flex-start;
		column-gap: 12px;
		row-gap: 8px;
		height: 34px;
		box-sizing: border-box;
		padding: 4px 10px;
		overflow: hidden;
		white-space: nowrap;
	}
	.options.withMore {
		padding-right: 100px;
	}
	.options.open {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: auto;
		padding-bottom: 8px;
		z-index: var(--z-options);
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
	}
	/* The settings panel (Sculpt's Brush, Water, Placement, Spawns): rows of controls under its button, over the viewport. */
	.brushpanel {
		position: absolute;
		top: 34px;
		z-index: var(--z-options-panel);
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 0 0 var(--radius) var(--radius);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.45);
		white-space: nowrap;
	}
	.brushbtn.painting {
		color: var(--accent-text);
	}
	.more {
		position: absolute;
		top: 4px;
		right: 10px;
		height: 26px;
		z-index: var(--z-options-more);
	}
	.tool {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius);
		background: var(--panel-2);
		flex: none;
	}
	/* The controls every tool's component (options/) uses, so they are global under the bar (#593).
	   ScriptBrushBar styles its own buttons. */
	.brushpanel :global(.row) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.brushpanel :global(.head) {
		width: 56px;
	}
	.optbar :global(button:where(:not([data-ui='ScriptBrushBar']))) {
		padding: 2px 8px;
		flex: none;
	}
	.optbar :global(.divider) {
		width: 1px;
		height: 20px;
		background: var(--border-soft);
		flex: none;
	}
	.optbar :global(.seg) {
		display: flex;
		flex: none;
	}
	.optbar :global(.seg button) {
		border-radius: 0;
		margin-left: -1px;
		padding: 2px 9px;
	}
	.optbar :global(.seg button:first-child) {
		border-radius: var(--radius) 0 0 var(--radius);
		margin-left: 0;
	}
	.optbar :global(.seg button:last-child) {
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.optbar :global(.chip) {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 2px 8px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.optbar :global(.dim) {
		color: var(--text-dim);
	}
	.optbar :global(.check) {
		display: flex;
		align-items: center;
		gap: 5px;
		cursor: pointer;
	}
</style>
