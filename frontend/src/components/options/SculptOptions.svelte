<script lang="ts">
	// The Sculpt tool's options (#593): its modes and each mode's controls on the bar, and with `panel`
	// the Brush panel's rows (edit limit, image, shape and falloff curve, Flatten's and Terrace's
	// settings, painting while sculpting). OptionsBar passes the brush controls it shares between tools.
	import type { Snippet } from 'svelte'
	import OptSlider from '../OptSlider.svelte'
	import { editor, prefs, ui, type SculptMode } from '../../lib/state/editor.svelte'
	import { engineRef } from '../../lib/state/engineRef'
	import { texName } from '../../lib/wow/texName'

	interface Props {
		/** Render the settings panel's rows instead of the bar's controls. */
		panel?: boolean
		sizeStrength: Snippet
		editLimit: Snippet
		imageBrush: Snippet
		falloffCurve: Snippet
		brushShape: Snippet
	}
	let { panel = false, sizeStrength, editLimit, imageBrush, falloffCurve, brushShape }: Props = $props()

	// The modes are icon buttons, named by their tooltips, so the Sculpt bar fits one row (#715).
	const SCULPT_MODES: Array<{ id: SculptMode; name: string; tip: string; icon: string; dots?: boolean }> = [
		{ id: 'raise', name: 'Raise', tip: 'Lift the ground under the brush', icon: 'M3 20h18M12 17V5M7 10l5-5 5 5' },
		{ id: 'lower', name: 'Lower', tip: 'Sink the ground under the brush', icon: 'M3 4h18M12 7v12M7 14l5 5 5-5' },
		{ id: 'smooth', name: 'Smooth', tip: 'Even out bumps toward the ground around them', icon: 'M2 14c3-5 7-5 10 0s7 5 10 0' },
		{ id: 'blur', name: 'Blur', tip: 'Blur the heights under the brush, softening every edge', icon: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6' },
		{ id: 'flatten', name: 'Flatten', tip: 'Level the ground to one height (Alt+click locks the height)', icon: 'M2 17h20M5 17l3-6h8l3 6' },
		{ id: 'noise', name: 'Noise', tip: 'Roughen the ground with random bumps', icon: 'M2 15l3-5 3 7 3-9 3 8 3-5 3 4 2-2' },
		{ id: 'mountain', name: 'Mountain', tip: 'Build up a peak', icon: 'M2 20L12 4l10 16zM12 4l-2 7 3 3' },
		{ id: 'crevice', name: 'Crevice', tip: 'Dig a trench and pile the ground onto its sides', icon: 'M2 9h3l2-3 5 13 5-13 2 3h3' },
		{
			id: 'terrace',
			name: 'Terrace',
			tip: 'Step the ground into levels, for mesas, farmland and cliff levels (Shift+drag levels to the step under the first click)',
			icon: 'M2 20h6v-5h5v-5h5V5h4',
		},
		{
			id: 'erode',
			name: 'Erode',
			tip: 'Wear the ground down as water and loose rock do: water carves gullies and leaves fans of sediment below them; thermal lets ground slide off slopes steeper than the talus angle',
			icon: 'M12 3c3 5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6 6-11z',
		},
		{
			id: 'vertex',
			name: 'Vertex',
			tip: 'Pick points of the ground with the brush, then raise or lower them together (Shift+drag), level them (Flatten) or tilt them onto a slope (Slope, Direction)',
			icon: 'M5 6h.01M12 6h.01M19 6h.01M5 12h.01M12 12h.01M19 12h.01M5 18h.01M12 18h.01M19 18h.01',
			dots: true,
		},
		{ id: 'hole', name: 'Hole', tip: 'Cut holes in the ground, or fill them', icon: 'M4 4h16v16H4zM9 9h6v6H9z' },
	]

	const holeMode = $derived(editor.sculptMode === 'hole')
	const sculptTex = $derived(editor.palette[editor.sculptPaintLayer])
</script>

{#if !panel}
	<div class="seg icons" role="group" aria-label="Sculpt mode">
		{#each SCULPT_MODES as m (m.id)}
			<button class:active={editor.sculptMode === m.id} onclick={() => (editor.sculptMode = m.id)} title="{m.name}: {m.tip}" aria-label={m.name} aria-pressed={editor.sculptMode === m.id}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width={m.dots ? 3.2 : 1.8} stroke-linejoin="round" stroke-linecap="round">
					<path d={m.icon} />
				</svg>
			</button>
		{/each}
	</div>
	{@render sizeStrength()}
	{#if editor.sculptMode === 'flatten'}
		<label class="check" title="Level every stroke to the locked height instead of the height where it starts; Alt+click locks the point under the cursor"><input type="checkbox" bind:checked={editor.flattenLock.on} /> Lock</label>
		{#if editor.flattenLock.on}
			<label class="check" title="The locked height, in yards">H <input class="num" type="number" step="0.1" bind:value={editor.flattenLock.y} /></label>
		{/if}
	{/if}
	{#if editor.sculptMode === 'mountain'}
		<OptSlider
			label="Ridges"
			bind:value={editor.mountain.ridges}
			min={0}
			max={1}
			step={0.01}
			digits={2}
			width={60}
			title="How much the ridges carve the peak: 0 a smooth hill, 1 all ridges. The whole brush is slope (the falloff curve shapes it) and the ridges scale with the brush."
		/>
	{/if}
	{#if editor.sculptMode === 'crevice'}
		<OptSlider
			label="Ridge"
			bind:value={editor.crevice.ridge}
			min={0}
			max={2}
			step={0.05}
			digits={2}
			width={60}
			title="How much of the dug ground is piled onto the sides: 1 keeps the volume, 0 only digs. Falloff sets how wide the ridges are."
		/>
	{/if}
	{#if editor.sculptMode === 'erode'}
		<div class="seg">
			<button
				class:active={editor.erode.kind === 'hydraulic'}
				onclick={() => (editor.erode.kind = 'hydraulic')}
				title="Water drops run downhill from under the brush, carving gullies and leaving their load where they slow down. Strength sets how many drops a second.">Water</button
			>
			<button
				class:active={editor.erode.kind === 'thermal'}
				onclick={() => (editor.erode.kind = 'thermal')}
				title="Ground slides off wherever it is steeper than the talus angle, as scree does, which also takes the spikes off noise. Strength sets how fast.">Thermal</button
			>
		</div>
		{#if editor.erode.kind === 'thermal'}
			<OptSlider label="Talus" bind:value={editor.erode.talus} min={5} max={80} step={1} digits={0} width={60} title="The steepest slope, in degrees, that loose ground holds; steeper ground slides down" />
		{/if}
		<button onclick={() => (ui.dialog = 'erode')} title="Erode the selected area, or the whole map, at once (Terrain › Erode)">Area…</button>
	{/if}
	{#if editor.sculptMode === 'terrace'}
		<OptSlider label="Step" bind:value={editor.terrace.step} min={0.5} max={50} step={0.5} digits={1} width={50} title="Yards between the levels" />
		<OptSlider label="Sharpness" bind:value={editor.terrace.sharpness} min={0} max={1} step={0.05} digits={2} width={50} title="How much of each step is flat: 1 flat levels with cliffs between them, 0 smooth stairs" />
	{/if}
	{#if editor.sculptMode === 'hole'}
		<div class="seg">
			<button class:active={!editor.holeFill} onclick={() => (editor.holeFill = false)} title="Click or drag over the ground to cut it out, a 2×2-cell block at a time (the client keeps holes in such blocks)">Cut</button>
			<button class:active={editor.holeFill} onclick={() => (editor.holeFill = true)} title="Click or drag over a hole to put the ground back, a 2×2-cell block at a time">Fill</button>
		</div>
	{:else if editor.sculptMode === 'vertex'}
		<span class="chip" style:flex-shrink="0" title="Drag to select vertices, Ctrl or Alt+drag to deselect, Shift+drag to move them up and down"><span class="dim">Selected:</span> {ui.vertexCount}</span>
		<!-- Nothing picked yet: the controls act on the picked points only, so they wait; the status bar explains the mode (ToolHint). -->
		{#if ui.vertexCount}
			<button onclick={() => engineRef.current?.vertexAction('flatten')} title="Level the selected vertices at their mean height">Flatten</button>
			<button onclick={() => engineRef.current?.vertexAction('clear')} title="Drop every picked point (the ground stays as it is)">Clear</button>
			<select class="curve" bind:value={editor.vertexRef} title="Point the slope plane passes through" aria-label="Slope reference">
				<option value="center">Through centre</option>
				<option value="cursor">Through cursor</option>
			</select>
			<OptSlider label="Slope" bind:value={editor.vertexAngle} min={-89} max={89} step={1} digits={0} width={60} title="Angle of the plane the selection is laid on, in degrees" />
			<OptSlider label="Direction" bind:value={editor.vertexDir} min={0} max={360} step={1} digits={0} width={60} title="Direction the slope rises toward, in degrees (Space: from the cursor toward the selection centre)" />
		{/if}
	{/if}
{:else}
	<div class="row">
		<span class="dim head">Brush</span>
		{#if !holeMode}
			{@render editLimit()}
			{@render imageBrush()}
		{/if}
		{@render falloffCurve()}
		{#if !holeMode}
			{@render brushShape()}
		{/if}
	</div>
	{#if editor.sculptMode === 'flatten'}
		<div class="row">
			<span class="dim head">Flatten</span>
			<select class="curve" bind:value={editor.flattenTarget} disabled={editor.flattenLock.on} title="Height to flatten to (the lock sets it while on)" aria-label="Flatten target">
				<option value="origin">To clicked height</option>
				<option value="average">To average height</option>
			</select>
			<select class="curve" bind:value={editor.flattenDir} title="Which way ground moves toward the target" aria-label="Flatten direction">
				<option value="both">Raise and lower</option>
				<option value="raise">Raise only</option>
				<option value="lower">Lower only</option>
			</select>
			<label class="check" title="Level to a plane through the stroke's start (or the locked point) instead of one height"><input type="checkbox" bind:checked={editor.flattenAngled.on} /> Angled</label>
			{#if editor.flattenAngled.on}
				<OptSlider label="Angle" bind:value={editor.flattenAngled.angle} min={-89} max={89} step={0.5} digits={1} width={70} title="How steeply the plane rises, in degrees" />
				<OptSlider label="Direction" bind:value={editor.flattenAngled.orientation} min={0} max={360} step={1} digits={0} width={70} title="Direction the plane rises toward, in degrees (0 is east, 90 south)" />
			{/if}
		</div>
	{/if}
	{#if editor.sculptMode === 'terrace'}
		<div class="row">
			<span class="dim head">Terrace</span>
			<OptSlider label="Offset" bind:value={editor.terrace.offset} min={-50} max={50} step={0.1} digits={1} width={70} title="The height a level sits at, so the steps line up with the sea or a chosen height" />
		</div>
	{/if}
	{#if !holeMode}
		<div class="row">
			<span class="dim head">Paint</span>
			<select
				class="curve"
				bind:value={editor.sculptPaint}
				title="Also paint the ground the brush shapes: one texture, or the map's rock on the steep ground and its dirt on the slopes below it, as a raised hill was painted while it was raised"
				aria-label="Paint while sculpting"
			>
				<option value="off">Off</option>
				<option value="slope">Rock and dirt by slope</option>
				<option value="texture">One texture</option>
			</select>
			{#if editor.sculptPaint === 'texture'}
				<button
					class="chip"
					onclick={() => {
						ui.palette = 'textures'
						prefs.browserCollapsed = false
					}}
					title="The texture sculpting paints (pick one in the asset browser below)"
				>
					<span class="dim">Texture:</span>
					{sculptTex ? texName(sculptTex) : 'pick one below'}
				</button>
			{:else if editor.sculptPaint === 'slope'}
				<button class="chip" onclick={() => (ui.dialog = 'mapProps')} title="The map's rock and dirt textures (File › Map Properties)">
					<span class="dim">Rock:</span>
					{editor.roles.rock >= 0 ? texName(editor.palette[editor.roles.rock] ?? '') : 'none'}
					<span class="dim">· Dirt:</span>
					{editor.roles.dirt >= 0 ? texName(editor.palette[editor.roles.dirt] ?? '') : 'none'}
				</button>
			{/if}
		</div>
		{#if editor.sculptPaint === 'slope'}
			<div class="row">
				<span class="dim head"></span>
				<OptSlider label="Rock from" bind:value={editor.slopePaint.rockDeg} min={10} max={80} step={1} digits={0} width={60} title="Ground steeper than this many degrees is painted rock" />
				<OptSlider
					label="Dirt from"
					bind:value={editor.slopePaint.dirtDeg}
					min={0}
					max={70}
					step={1}
					digits={0}
					width={60}
					title="Ground steeper than this many degrees, up to the rock, is painted dirt: the rim at a mountain's foot"
				/>
				<label class="check" title="Ground gentler than the dirt gets each chunk's base (first) texture back, so lowering a hill takes its rock away too. Off by default, since it also paints over roads and details under the brush.">
					<input type="checkbox" bind:checked={editor.slopePaint.restoreBase} /> Restore base
				</label>
			</div>
		{/if}
	{/if}
{/if}

<style>
	/* Above the bar's shared `.seg button` rule (OptionsBar), so the icons keep their narrow padding. */
	:global(.optbar) .seg.icons button {
		display: grid;
		place-items: center;
		padding: 2px 4px;
	}
	.num {
		width: 70px;
	}
</style>
