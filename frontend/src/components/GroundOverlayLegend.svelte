<script lang="ts">
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { levelRange } from '../lib/world/spawnColors'
	import { GROUND_RADIUS, groundLegend } from '../lib/world/spawnGround'

	// View › Ground overlay (#950): what the ground's shades stand for, with the mode (Level or Density)
	// and how far a cell's level may stray from its zone's before it is hatched. The level ramp is the
	// spawn colours' (#949), over the open map's monster levels.

	const rows = $derived.by(() => {
		if (prefs.groundOverlay === 'off') return []
		void ui.spawnChanges
		return groundLegend(prefs.groundOverlay, levelRange(editor.spawns))
	})

	const css = (n: number) => '#' + n.toString(16).padStart(6, '0')

	function pick(v: string) {
		if (v === 'level' || v === 'density') prefs.groundOverlay = v
	}

	function setStray(v: number) {
		if (Number.isFinite(v)) prefs.groundStray = Math.max(0, Math.min(60, Math.round(v)))
	}
</script>

{#if prefs.groundOverlay !== 'off' && editor.spawns.length}
	<div class="legend" aria-label="Ground overlay">
		<div class="head">
			<strong>Ground</strong>
			<select value={prefs.groundOverlay} onchange={(e) => pick(e.currentTarget.value)} aria-label="Shade the ground by">
				<option value="level">By the monsters' level</option>
				<option value="density">By the creatures' density</option>
			</select>
			<button class="close" title="Turn the ground overlay off (View › Ground by creature level or density)" aria-label="Close" onclick={() => (prefs.groundOverlay = 'off')}>×</button>
		</div>
		<ul>
			{#each rows as r, i (i)}
				<li><span class="swatch" style:background={css(r.color)}></span>{r.label}</li>
			{/each}
		</ul>
		{#if prefs.groundOverlay === 'level'}
			<label class="stray">
				<span class="hatch"></span>Hatched: more than
				<input type="number" min="0" max="60" step="1" value={prefs.groundStray} onchange={(e) => setStray(e.currentTarget.valueAsNumber)} aria-label="Levels off the zone's" />
				levels off the zone's
			</label>
			<p class="dim">
				The average level of the monsters within {GROUND_RADIUS} yd of each cell. A 1.12 zone has one level, not a range: its exploration level (AreaTable, World › Zones). Each cell is compared with its chunk's area, a subzone of level
				0 taking its zone's; where both are 0, as for most zones, nothing is. A stray of 0 hatches nothing.
			</p>
		{:else}
			<p class="dim">The creatures (monsters and NPCs) within {GROUND_RADIUS} yd of each cell; unshaded ground has none.</p>
		{/if}
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
	.swatch,
	.hatch {
		width: 10px;
		height: 10px;
		flex: none;
	}
	.swatch {
		border-radius: 2px;
	}
	.hatch {
		background: repeating-linear-gradient(45deg, var(--text) 0 2px, transparent 2px 5px);
		border: 1px solid var(--border);
	}
	.stray {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 2px 0 4px;
	}
	.stray input {
		width: 42px;
		font-size: 12px;
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
		font-size: 11px;
	}
</style>
