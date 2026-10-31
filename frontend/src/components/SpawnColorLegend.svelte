<script lang="ts">
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { levelRange, spawnLegend } from '../lib/world/spawnColors'

	// Show › Spawn colours (#949): what each marker colour stands for, in any mode but Kind. The level
	// ramp runs over the open map's creature levels, as SpawnLayer finds them at its rebuild.

	const rows = $derived.by(() => {
		if (prefs.spawnColors === 'kind') return []
		void ui.spawnChanges
		return spawnLegend(prefs.spawnColors, levelRange(editor.spawns), prefs.namesSide)
	})

	const css = (n: number) => '#' + n.toString(16).padStart(6, '0')

	// The mode, with the side a reaction is seen from (the names' side, Show menu): the View menu has one
	// line for the colours, so the legend picks among them.
	const MODES = [
		['level', 'By level'],
		['reaction:alliance', 'By reaction to the Alliance'],
		['reaction:horde', 'By reaction to the Horde'],
		['rank', 'By rank'],
	] as const
	const mode = $derived(prefs.spawnColors === 'reaction' ? `reaction:${prefs.namesSide}` : prefs.spawnColors)

	function pick(v: string) {
		if (v.startsWith('reaction:')) {
			prefs.spawnColors = 'reaction'
			prefs.namesSide = v === 'reaction:horde' ? 'horde' : 'alliance'
		} else if (v === 'level' || v === 'rank') prefs.spawnColors = v
	}
</script>

{#if rows.length && editor.spawns.length}
	<div class="legend" aria-label="Spawn colours">
		<div class="head">
			<strong>Spawn colours</strong>
			<select value={mode} onchange={(e) => pick(e.currentTarget.value)} aria-label="Colour the spawns">
				{#each MODES as [v, label] (v)}
					<option value={v}>{label}</option>
				{/each}
			</select>
			<button class="close" title="Back to the kinds' colours (Show › Spawn colours)" aria-label="Close" onclick={() => (prefs.spawnColors = 'kind')}>×</button>
		</div>
		<ul>
			{#each rows as r, i (i)}
				<li><span class="swatch" style:background={css(r.color)}></span>{r.label}</li>
			{/each}
		</ul>
		<p class="dim">Markers in the colour, creature models tinted.</p>
	</div>
{/if}

<style>
	.legend {
		width: 250px;
		padding: 6px 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		font-size: 12px;
		pointer-events: auto;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	select {
		flex: 1;
		min-width: 0;
		font-size: 12px;
	}
	.close {
		background: none;
		border: none;
		padding: 0 4px;
		font-size: 14px;
		line-height: 1;
	}
	ul {
		list-style: none;
		margin: 4px 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 1px 0;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
		font-size: 11px;
	}
</style>
