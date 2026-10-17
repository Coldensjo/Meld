<script lang="ts">
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { poolLegend, topPool, type PoolEntry } from '../lib/world/pools'
	import { selectSpawn } from '../lib/world/spawnEdits'
	import { spawnKey } from '../lib/world/SpawnLayer'

	// View › Spawn pools (#172): the region's pools in the colours of their rings on the map, each with
	// how many the server spawns at a time, so how many copper veins a zone shows at once reads at a
	// glance. A click selects a spawn of the pool.

	const SHOWN = 12
	// The spawns are edited in place, so the edit count and the selection (a new copy after every
	// edit) say when to count again.
	const pools = $derived.by(() => {
		if (!prefs.showPools) return []
		void ui.spawnChanges
		void editor.selectedSpawn
		return poolLegend(editor.spawns)
	})

	function pick(p: PoolEntry) {
		const s = editor.spawns.find((o) => topPool(o) === p.pool)
		const drawn = s ? engineRef.current?.activeDocument().spawnLayer.get(spawnKey(s)) : undefined
		if (!drawn) return
		selectSpawn(drawn)
		engineRef.current?.focusSpawn(drawn)
	}
</script>

{#if prefs.showPools && editor.spawns.length}
	<div class="legend" aria-label="Spawn pools">
		<div class="head">
			<strong>Spawn pools</strong>
			<span class="dim">{pools.length} in this region</span>
		</div>
		{#if pools.length}
			<ul>
				{#each pools.slice(0, SHOWN) as p (`${p.mother}/${p.pool}`)}
					<li>
						<button title="Pool {p.pool}: {p.spawns} of its spawns are in this region; the server spawns {p.limit} of its {p.size}{p.mother ? ' spots' : ''} at a time. Click to select one." onclick={() => pick(p)}>
							<span class="swatch" style:background="hsl({Math.round(p.hue * 360)}, 85%, 60%)"></span>
							<span class="name">{p.name || `Pool ${p.pool}`}</span>
							<span class="dim">{p.limit} of {p.size}</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if pools.length > SHOWN}<p class="dim">and {pools.length - SHOWN} more, with fewer spawns here</p>{/if}
		{:else}
			<p class="dim">No spawn of this region is in a pool.</p>
		{/if}
	</div>
{/if}

<style>
	.legend {
		position: absolute;
		left: 10px;
		bottom: 34px;
		width: 290px;
		max-height: 45%;
		overflow-y: auto;
		padding: 6px 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		font-size: 12px;
		z-index: 4;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}
	.head .dim {
		margin-left: auto;
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		border-radius: 0;
		padding: 2px 4px;
		text-align: left;
		font-size: 12px;
	}
	button:hover {
		background: var(--panel-2);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
</style>
