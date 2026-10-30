<script lang="ts">
	import type { SpawnPanel, SpawnPanelActions } from '../lib/toolwin/inspector'
	import { chanceProblem, poolMates, poolRule, poolSize } from '../lib/world/pools'
	import { spawnKey } from '../lib/world/spawnKey'
	import type { vmangos } from '../lib/wails/models'

	// A spawn's pool (pool_template, pool_creature, pool_gameobject; #136, #172): how many of its
	// members the server spawns at a time, the region's other members (outlined on the map), the
	// mother pool it belongs to (which it can join, leave, and change the limit of; #261), and the
	// buttons that make one or change it. Every change is one undo step, saved with the region's spawns.
	// It reads the region's spawns from `panel` and acts through `act`, so it works in the Inspector's own
	// OS window too (#910, lib/toolwin/inspector.ts), on what the main page publishes.

	interface Props {
		s: vmangos.WorldSpawn
		/** The region's spawns (at least those of this spawn's pools) and the pick on the map under way. */
		panel: SpawnPanel
		act: SpawnPanelActions
	}
	let { s, panel, act }: Props = $props()

	// `s` is a new copy after every edit, so these follow the edits.
	const key = $derived(spawnKey(s))
	const mates = $derived(s.pool ? poolMates(panel.spawns, s) : [])
	const size = $derived(poolSize(panel.spawns, s))
	const problem = $derived(chanceProblem(panel.spawns, s))
	const picking = $derived(panel.pick?.key === key && (panel.pick.mode === 'pool' || panel.pick.mode === 'joinPool' || panel.pick.mode === 'joinMother') ? panel.pick.mode : null)
	const sameSpot = (o: vmangos.WorldSpawn) => Math.hypot(o.x - s.x, o.z - s.z) < 1

	function limit(e: Event) {
		const v = Math.round((e.currentTarget as HTMLInputElement).valueAsNumber)
		if (Number.isFinite(v) && v >= 1) act.poolSetting(key, { poolLimit: v }, 'Pool limit')
	}

	function motherLimit(e: Event) {
		const v = Math.round((e.currentTarget as HTMLInputElement).valueAsNumber)
		if (Number.isFinite(v) && v >= 1) act.motherLimit(key, v)
	}

	function chance(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).valueAsNumber
		if (Number.isFinite(v)) act.poolChance(key, v)
	}
</script>

<h4>Pool</h4>
{#if s.pool}
	<p class="dim">
		Pool {s.pool}{s.poolName ? `, ${s.poolName}` : ''}: the server spawns {poolRule(s.poolLimit, size)}{s.poolElsewhere ? ` (${s.poolElsewhere} of them outside this region)` : ''}.
	</p>
	{#if s.motherPool}
		<p class="dim">
			Part of master pool {s.motherPool}{s.motherName ? `, ${s.motherName}` : ''}, which spawns {poolRule(s.motherLimit, s.motherSize, 'pools')}.
		</p>
		<div class="fields">
			<label
				>Master limit
				<input type="number" min="1" step="1" value={s.motherLimit} title="How many of the master pool's pools the server fills at a time" onchange={motherLimit} /></label
			>
		</div>
	{/if}
	<div class="fields">
		<label>Limit <input type="number" min="1" step="1" value={s.poolLimit} title="How many of the pool's members the server spawns at a time" onchange={limit} /></label>
		<label
			>Chance %
			<input type="number" min="0" max="100" step="1" value={s.poolChance} title="This spawn's chance, in a pool with a limit of 1; 0 shares what the others leave" onchange={chance} /></label
		>
		<label class="wide"
			>Description
			<input type="text" value={s.poolName} onchange={(e) => act.poolSetting(key, { poolName: (e.currentTarget as HTMLInputElement).value.trim() }, 'Pool description')} /></label
		>
	</div>
	{#if problem}<p class="warn">{problem}</p>{/if}
	{#if mates.length}
		<ul class="points">
			{#each mates as o (o.guid)}
				<li>
					<button class="row" title="Select spawn {o.guid}" onclick={() => act.pickSpawn(spawnKey(o))}>
						<span class="name">{o.name}</span>
						<span class="dim">{sameSpot(o) ? 'same spot' : `${Math.round(Math.hypot(o.x - s.x, o.z - s.z))} yd away`}{o.poolChance ? `, ${o.poolChance}%` : ''}</span>
					</button>
					<button class="remove" title="Take {o.name} out of the pool" onclick={() => act.leavePool(spawnKey(o))}>×</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="dim">No other spawn of the pool is in this region.</p>
	{/if}
	<div class="row-buttons">
		<button class:active={picking === 'pool'} title="Click spawns on the map to put them into this pool or take them out" onclick={() => (picking ? act.cancelPick() : act.startPick(key, 'pool'))}
			>{picking === 'pool' ? 'Done' : 'Add spawns on the map'}</button
		>
		<button onclick={() => act.leavePool(key)}>Leave pool</button>
	</div>
	<div class="row-buttons">
		{#if s.motherPool}
			<button title="Take pool {s.pool} out of master pool {s.motherPool}, so the server always fills it" onclick={() => act.leaveMother(key)}>Leave the master pool</button>
		{:else}
			<button
				class:active={picking === 'joinMother'}
				title="Click a spawn on the map whose pool is in a master pool, such as another vein of the zone; this pool joins that master pool and takes turns with its others"
				onclick={() => (picking ? act.cancelPick() : act.startPick(key, 'joinMother'))}>{picking === 'joinMother' ? 'Cancel' : 'Join a master pool'}</button
			>
		{/if}
	</div>
{:else}
	<p class="dim">In no pool: the server always spawns it.</p>
	<div class="row-buttons">
		<button title="Make a pool of this spawn, then click others on the map to add them" onclick={() => act.makePool(key)}>Make pool</button>
		<button class:active={picking === 'joinPool'} title="Click a pooled spawn on the map to put this one into its pool" onclick={() => (picking ? act.cancelPick() : act.startPick(key, 'joinPool'))}
			>{picking ? 'Cancel' : 'Join a pool'}</button
		>
	</div>
{/if}

<style>
	h4 {
		margin: 4px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.warn {
		color: var(--danger-text);
		font-size: 12px;
		margin: 0;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 8px;
		font-size: 12px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text-dim);
	}
	.fields .wide {
		grid-column: 1 / -1;
	}
	.fields input {
		width: 100%;
		min-width: 0;
	}
	.points {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 160px;
		overflow-y: auto;
		border: 1px solid var(--border);
	}
	.points li {
		display: flex;
	}
	.row {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 4px 8px;
		font-size: 12px;
	}
	.row .name {
		flex: 1;
	}
	.remove {
		background: none;
		border: none;
		padding: 0 8px;
		color: var(--text-dim);
	}
	.row-buttons {
		display: flex;
		gap: 6px;
	}
</style>
