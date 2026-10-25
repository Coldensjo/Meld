<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor, prefs } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import type { FitMode } from '../lib/terrain/fitGround'

	// Models › Fit Ground to Selected Models (#168): Fit moves the ground to just under each selected
	// model's lowest floor (Unreal's flatten to object), Stamp presses the models' undersides into the
	// ground (Unity's Mesh Stamp). The settings are prefs, so they stay for the next building.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const f = prefs.fitGround
	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
	const MODES: Array<[FitMode, string]> = [
		['both', 'Raise and lower'],
		['lower', 'Only lower'],
		['raise', 'Only raise'],
	]

	function run(stamp: boolean) {
		onclose()
		engineRef.current?.fitGroundToSelection(stamp, { ...f })
	}
</script>

<Modal title="Fit ground to selected models" width={420} {onclose}>
	<p class="dim">
		{editor.selectedIds.length}
		{editor.selectedIds.length === 1 ? 'model' : 'models'} selected. The models stay where they are; the ground under each is levelled to its base (never above its floor), as on a foundation, and a model sunk into the ground (a negative height)
		keeps that part underground, and blends back to the hill around it.
	</p>
	<div class="grid">
		<label for="fit-margin">Under the floor</label>
		<span><input id="fit-margin" type="number" min="0" max="10" step="0.1" value={f.margin} onchange={(e) => (f.margin = clamp(num(e), 0, 10))} /> yd</span>
		<label for="fit-falloff">Blend ring</label>
		<span><input id="fit-falloff" type="number" min="0" max="64" step="1" value={f.falloff} onchange={(e) => (f.falloff = clamp(num(e), 0, 64))} /> yd</span>
		<label for="fit-reach" title="A floor counts only this far above the model's lowest floor, and an underside this far above its lowest underside, so a stable's hayloft or a roof's eaves don't pull the ground up">Floor within</label>
		<span><input id="fit-reach" type="number" min="0.5" max="50" step="0.5" value={f.reach} onchange={(e) => (f.reach = clamp(num(e), 0.5, 50))} /> yd of its lowest</span>
		<label for="fit-mode">Ground may</label>
		<select id="fit-mode" value={f.mode} onchange={(e) => (f.mode = (e.target as HTMLSelectElement).value as FitMode)}>
			{#each MODES as [v, label] (v)}
				<option value={v}>{label}</option>
			{/each}
		</select>
		<span></span>
		<label class="check" title="Where the ground stands above a floor (a cellar, a crypt entrance), cut a hole in it instead of lowering it, in the client's 2x2-cell blocks">
			<input type="checkbox" checked={f.holes} onchange={(e) => (f.holes = (e.target as HTMLInputElement).checked)} /> Cut holes through floors below the ground
		</label>
	</div>
	<p class="dim">Stamp presses each model's underside into the ground (a rock's base, a crater) and ignores the settings above but the ring.</p>
	<p class="dim">The Place tool's Fit ground uses the settings above for each model it places.</p>
	{#snippet actions()}
		<button onclick={onclose}>Cancel</button>
		<button onclick={() => run(true)}>Stamp shape</button>
		<button class="active" onclick={() => run(false)}>Fit ground</button>
	{/snippet}
</Modal>

<style>
	.grid {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 8px;
		align-items: center;
		margin: 10px 0;
	}
	.grid input[type='number'] {
		width: 64px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
