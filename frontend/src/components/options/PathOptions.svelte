<script lang="ts">
	// The Path tool's options (#593, #167): the picked path, its kind, and the picked path's fields (a
	// fence's model and spacing, a road's or river's width, falloff, grade or depth, liquid and paint),
	// each set through the tool so it records undo.
	import OptSlider from '../OptSlider.svelte'
	import { editor, prefs, ui, wow } from '../../lib/state/editor.svelte'
	import { engineRef } from '../../lib/state/engineRef'
	import { displayName } from '../../lib/models/assets'
	import { LIQUID_TYPES } from '../../lib/water/liquids'
	import { NARROW_WIDTH, PATH_KINDS, type MapPath, type PathKind } from '../../lib/terrain/paths'
	import type { PathField } from '../../lib/tools/PathTool'
	import { texName } from '../../lib/wow/texName'

	/** The client's liquids, re-read when the client's table arrives (LIQUID_TYPES is a plain array). */
	const liquidList = $derived.by(() => {
		void wow.liquidsRevision
		return [...LIQUID_TYPES]
	})

	/** The Path tool's picked path, and a setter for its fields that records undo. */
	const pickedPath = $derived(editor.paths.find((p) => p.id === editor.pathId))
	function setPath<K extends PathField>(key: K, value: MapPath[K]) {
		engineRef.current?.path((t, c) => t.setField(c, key, value))
	}
	/** The kind of the next new path, and of the picked one. */
	function pickKind(kind: PathKind) {
		editor.pathKind = kind
		if (pickedPath) setPath('kind', kind)
	}
</script>

<select
	class="curve"
	value={editor.pathId}
	onchange={(e) => engineRef.current?.path((t) => t.pick(Number(e.currentTarget.value)))}
	title="The path the clicks add points to and Apply bakes; New path makes the next click start one"
	aria-label="Path"
>
	<option value={-1}>New path</option>
	{#each editor.paths as p (p.id)}
		<option value={p.id}>{p.name} ({p.points.length} points)</option>
	{/each}
</select>
<div class="seg" title="What the path does when applied">
	{#each PATH_KINDS as k (k.id)}
		<button class:active={(pickedPath?.kind ?? editor.pathKind) === k.id} onclick={() => pickKind(k.id)} title={k.tip}>{k.name}</button>
	{/each}
</div>
{#if pickedPath?.kind === 'fence'}
	{@const pp = pickedPath}
	<button
		class="chip"
		onclick={() => {
			ui.palette = 'models'
			prefs.browserCollapsed = false
		}}
		title="The model stood along the path: click one in the asset browser below while the path is picked"
	>
		<span class="dim">Model:</span>
		{pp.model ? displayName(pp.model) : 'pick one below'}
	</button>
	<OptSlider label="Spacing" bind:value={() => pp.spacing, (v) => setPath('spacing', v)} min={0} max={60} step={0.25} digits={2} width={60} title="Yards from one model to the next; 0 lays them end to end at the model's own length" />
	<OptSlider label="Turn" bind:value={() => pp.turn, (v) => setPath('turn', v)} min={0} max={360} step={15} digits={0} width={60} title="Degrees each model is turned past following the curve (its long side is laid along it)" />
{:else if pickedPath}
	{@const pp = pickedPath}
	<OptSlider label="Width" bind:value={() => pp.width, (v) => setPath('width', v)} min={1} max={60} step={0.5} digits={1} width={70} title="The full width that is levelled and painted, in yards" />
	<OptSlider label="Falloff" bind:value={() => pp.falloff, (v) => setPath('falloff', v)} min={0} max={40} step={0.5} digits={1} width={60} title="The yards beyond each side over which the ground blends back into what was there" />
	{#if pp.kind === 'river'}
		<OptSlider
			label="Depth"
			bind:value={() => pp.depth, (v) => setPath('depth', v)}
			min={0}
			max={30}
			step={0.25}
			digits={2}
			width={60}
			title="How deep the bed is carved below the surface in the middle, in yards; the surface runs downhill from the higher end"
		/>
		<select class="curve" value={pp.liquid} onchange={(e) => setPath('liquid', Number(e.currentTarget.value))} title="The liquid that fills the river (the client's LiquidType)" aria-label="River liquid">
			{#each liquidList as l (l.id)}
				<option value={l.id}>{l.name}</option>
			{/each}
		</select>
	{:else}
		<OptSlider
			label="Max grade %"
			bind:value={() => pp.grade, (v) => setPath('grade', v)}
			min={0}
			max={100}
			step={1}
			digits={0}
			width={60}
			title="The steepest the road may climb along its length, in percent (10 rises 10 yd over 100); 0 follows the points' heights"
		/>
	{/if}
	<select
		class="curve"
		value={pp.texture}
		onchange={(e) => setPath('texture', e.currentTarget.value)}
		title="The texture painted along the path (a road's surface, a river's bed): one of the map's textures (pick more in the asset browser)"
		aria-label="Path texture"
	>
		<option value="">Paint: none</option>
		{#each editor.palette as tex (tex)}
			<option value={tex}>Paint: {texName(tex)}</option>
		{/each}
		{#if pp.texture && !editor.palette.includes(pp.texture)}
			<option value={pp.texture}>Paint: {texName(pp.texture)} (not in the map)</option>
		{/if}
	</select>
	<OptSlider label="Edge" bind:value={() => pp.edge, (v) => setPath('edge', v)} min={0} max={8} step={0.25} digits={2} width={50} title="The yards over which the paint fades at each side; 0 is a hard edge" />
	{#if pp.width < NARROW_WIDTH}
		<span class="warn" title="The ground has a vertex every 2 yards, so a road narrower than two cells comes out jagged">Narrower than {NARROW_WIDTH} yd: jagged</span>
	{/if}
{/if}
{#if pickedPath}
	<button onclick={() => engineRef.current?.path((t, c) => t.apply(c))} title="Bake the path into the map as one undo step; applying it again first takes back its last apply (Enter)">Apply</button>
	<button onclick={() => engineRef.current?.path((t, c) => t.deletePoint(c))} disabled={editor.pathPoint < 0} title="Delete the picked point (Delete)">Delete point</button>
	<button onclick={() => engineRef.current?.path((t, c) => t.deletePath(c))} title="Delete the path; what it applied stays in the map">Delete path</button>
{/if}
<div class="divider"></div>

<style>
	.warn {
		color: var(--danger-text);
		white-space: nowrap;
	}
</style>
