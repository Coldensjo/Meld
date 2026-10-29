<script lang="ts">
	// The spawn brush's options (#593, #171), the Doodad tool's Creatures mode: the brush's creatures,
	// density and spacing on the bar, and with `panel` the Spawns panel's rows (the creatures' weights,
	// movement, facing, respawn, levels and the ground they may stand on).
	import OptSlider from '../OptSlider.svelte'
	import { prefs, ui } from '../../lib/state/editor.svelte'
	import { rulesEmpty } from '../../lib/tools/doodadBrush'

	interface Props {
		/** Render the settings panel's rows instead of the bar's controls. */
		panel?: boolean
	}
	let { panel = false }: Props = $props()

	const sb = $derived(prefs.spawnBrush)
</script>

{#if !panel}
	<span class="chip" title={sb.entries.length ? sb.entries.map((e) => `${e.name} (${e.weight})`).join(', ') : 'No creatures in the brush yet; the Spawns panel lists them'}
		>{sb.entries.length} {sb.entries.length === 1 ? 'creature' : 'creatures'}</span
	>
	<OptSlider label="Per 100×100 yd" bind:value={sb.density} min={1} max={60} step={1} digits={0} width={60} title="How many creatures the brush fills 100 by 100 yards of ground with" />
	<OptSlider label="Spacing" bind:value={sb.spacing} min={0} max={40} step={0.5} digits={1} width={60} title="No two creatures closer than this many yards (social aggro)" />
{:else}
	<div class="row">
		<span class="dim head">Creatures</span>
		{#each sb.entries as e, i (e.entry)}
			<span class="chip" title="{e.name} (entry {e.entry}): its weight among the brush's creatures">
				{e.name}
				<input class="weight" type="number" min="0" max="100" step="1" bind:value={e.weight} aria-label="Weight of {e.name}" />
				<button class="x" onclick={() => (sb.entries = sb.entries.filter((_, j) => j !== i))} title="Take {e.name} out of the brush" aria-label="Remove {e.name}">×</button>
			</span>
		{/each}
	</div>
	<div class="row">
		<span class="dim head">Spawn</span>
		<select class="curve" bind:value={sb.movement} title="How the creatures move" aria-label="Movement">
			<option value="random">Wander</option>
			<option value="stay">Stay</option>
		</select>
		{#if sb.movement === 'random'}
			<OptSlider label="Radius" bind:value={sb.wander} min={0} max={40} step={0.5} digits={1} width={50} title="How far each creature wanders from its spawn point, in yards" />
		{/if}
		<select class="curve" bind:value={sb.facing} title="Which way each creature faces" aria-label="Facing">
			<option value="random">Face anywhere</option>
			<option value="centre">Face the centre</option>
		</select>
		<OptSlider label="Respawn s" bind:value={sb.respawnSecs} min={10} max={3600} step={10} digits={0} width={60} title="Respawn time in seconds" />
	</div>
	<div class="row">
		<span class="dim head">Level</span>
		<OptSlider label="From" bind:value={sb.levelMin} min={0} max={63} step={1} digits={0} width={40} title="Lowest level, or 0 for the template's own range" />
		<OptSlider label="to" bind:value={sb.levelMax} min={0} max={63} step={1} digits={0} width={40} title="Highest level, or 0 for the template's own range" />
	</div>
	<div class="row">
		<span class="dim head">Ground</span>
		<OptSlider label="Max slope" bind:value={sb.maxSlope} min={0} max={90} step={1} digits={0} width={50} title="No creature on ground steeper than this many degrees (90 allows any)" />
		<label class="check" title="No creature in the sea or a painted liquid"><input type="checkbox" bind:checked={sb.avoidWater} /> Keep out of water</label>
		<button class:active={!rulesEmpty(sb.rules)} onclick={() => (ui.dialog = 'spawnRules')} title="Only on or never on some textures, within a height range, off holes">Rules…</button>
	</div>
{/if}

<style>
	.weight {
		width: 38px;
		padding: 0 3px;
		font: 11px var(--mono);
	}
</style>
