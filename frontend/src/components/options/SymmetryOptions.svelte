<script lang="ts">
	// Symmetry (#182, lib/tools/symmetry.ts): the brush tools apply each stroke at its mirrored or turned
	// copies too, about a centre (the map's middle until one is picked), for symmetric battlegrounds and arenas.
	import { editor, setStatus, ui } from '../../lib/state/editor.svelte'
	import { MAX_RADIAL, MIN_RADIAL } from '../../lib/tools/symmetry'

	const sym = $derived(editor.symmetry)

	function pick() {
		ui.symmetryPick = !ui.symmetryPick
		if (ui.symmetryPick) setStatus('Click the ground to set the symmetry centre (it snaps to the nearest half cell).', 6000)
	}
	function mapCentre() {
		editor.symmetry.center = null
		ui.symmetryPick = false
		setStatus("Symmetry is about the map's centre again.", 3000)
	}
	function onCount(e: Event) {
		const v = Math.round(parseFloat((e.currentTarget as HTMLInputElement).value))
		if (!Number.isNaN(v)) editor.symmetry.count = Math.min(MAX_RADIAL, Math.max(MIN_RADIAL, v))
	}
	const centreTitle = $derived(sym.center ? `The centre is at ${sym.center.x.toFixed(1)}, ${sym.center.z.toFixed(1)}` : "The centre is the map's middle")
</script>

<select class="curve" bind:value={editor.symmetry.mode} title="Symmetry: every stroke also lands at its mirrored or turned copies about the centre, in the same undo step (the dashed lines on the ground show the axes)" aria-label="Symmetry">
	<option value="off">No symmetry</option>
	<option value="x" title="Left and right of the centre: x flips">Mirror X</option>
	<option value="z" title="Before and behind the centre: z flips">Mirror Z</option>
	<option value="xz" title="Both mirrors: four copies">Mirror X+Z</option>
	<option value="point" title="A half turn about the centre">Point</option>
	<option value="radial">Radial</option>
</select>
{#if sym.mode === 'radial'}
	<label class="check" title="How many copies the radial symmetry makes, turned evenly about the centre">
		Copies <input class="num" type="number" min={MIN_RADIAL} max={MAX_RADIAL} step="1" value={sym.count} onchange={onCount} />
	</label>
{/if}
{#if sym.mode !== 'off'}
	<button class:active={ui.symmetryPick} onclick={pick} title="{centreTitle}. Click, then click the ground to move it there.">Pick centre</button>
	{#if sym.center}
		<button onclick={mapCentre} title="Put the centre back in the map's middle">Map centre</button>
	{/if}
{/if}
