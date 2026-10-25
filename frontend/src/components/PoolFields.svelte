<script lang="ts">
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { chanceProblem, leaveMotherChanges, leavePoolChanges, motherLimitChanges, poolMates, poolRule, poolSettingChanges, poolSize } from '../lib/world/pools'
	import { selectSpawn } from '../lib/world/spawnEdits'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import type { vmangos } from '../../wailsjs/go/models'

	// A spawn's pool (pool_template, pool_creature, pool_gameobject; #136, #172): how many of its
	// members the server spawns at a time, the region's other members (outlined on the map), the
	// mother pool it belongs to (which it can join, leave, and change the limit of; #261), and the
	// buttons that make one or change it. Every change is one undo step, saved with the region's spawns.

	interface Props {
		s: vmangos.WorldSpawn
		/** An editor shows this spawn: it asks about its unsaved edits, then moves to the picked spawn. */
		onswitch?: (o: vmangos.WorldSpawn) => void
	}
	let { s, onswitch }: Props = $props()

	// `s` is a new copy after every edit, so these follow the edits.
	const mates = $derived(s.pool ? poolMates(editor.spawns, s) : [])
	const size = $derived(poolSize(editor.spawns, s))
	const problem = $derived(chanceProblem(editor.spawns, s))
	const picking = $derived(ui.spawnPick?.key === spawnKey(s) && (ui.spawnPick.mode === 'pool' || ui.spawnPick.mode === 'joinPool' || ui.spawnPick.mode === 'joinMother') ? ui.spawnPick.mode : null)
	const sameSpot = (o: vmangos.WorldSpawn) => Math.hypot(o.x - s.x, o.z - s.z) < 1

	/** Selects another spawn of the pool; an editor open on this spawn moves to it. */
	function pick(o: vmangos.WorldSpawn) {
		const drawn = engineRef.current?.activeDocument().spawnLayer.get(spawnKey(o))
		if (!drawn) return
		if (onswitch) {
			onswitch(drawn)
			return
		}
		selectSpawn(drawn)
		const key = spawnKey(drawn)
		if (ui.objectEditor?.key) ui.objectEditor = { key, entry: drawn.entry }
		if (ui.creatureEditor?.key) ui.creatureEditor = { key, entry: drawn.entry }
	}

	function setting(vals: { poolLimit?: number; poolName?: string }, label: string) {
		engineRef.current?.changeSpawns(poolSettingChanges(editor.spawns, s, vals), `${label} (pool ${s.pool})`)
	}

	function limit(e: Event) {
		const v = Math.round((e.currentTarget as HTMLInputElement).valueAsNumber)
		if (Number.isFinite(v) && v >= 1) setting({ poolLimit: v }, 'Pool limit')
	}

	function motherLimit(e: Event) {
		const v = Math.round((e.currentTarget as HTMLInputElement).valueAsNumber)
		if (Number.isFinite(v) && v >= 1) engineRef.current?.changeSpawns(motherLimitChanges(editor.spawns, s, v), `Master pool limit (pool ${s.motherPool})`)
	}

	function chance(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).valueAsNumber
		if (Number.isFinite(v)) void engineRef.current?.editSpawn(spawnKey(s), { poolChance: Math.min(100, Math.max(0, v)) }, `Pool chance (${s.name})`)
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
			<input type="text" value={s.poolName} onchange={(e) => setting({ poolName: (e.currentTarget as HTMLInputElement).value.trim() }, 'Pool description')} /></label
		>
	</div>
	{#if problem}<p class="warn">{problem}</p>{/if}
	{#if mates.length}
		<ul class="points">
			{#each mates as o (o.guid)}
				<li>
					<button class="row" title="Select spawn {o.guid}" onclick={() => pick(o)}>
						<span class="name">{o.name}</span>
						<span class="dim">{sameSpot(o) ? 'same spot' : `${Math.round(Math.hypot(o.x - s.x, o.z - s.z))} yd away`}{o.poolChance ? `, ${o.poolChance}%` : ''}</span>
					</button>
					<button class="remove" title="Take {o.name} out of the pool" onclick={() => engineRef.current?.changeSpawns(leavePoolChanges(o), `Leave pool (${o.name})`)}>×</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="dim">No other spawn of the pool is in this region.</p>
	{/if}
	<div class="row-buttons">
		<button class:active={picking === 'pool'} title="Click spawns on the map to put them into this pool or take them out" onclick={() => (picking ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'pool'))}
			>{picking === 'pool' ? 'Done' : 'Add spawns on the map'}</button
		>
		<button onclick={() => engineRef.current?.changeSpawns(leavePoolChanges(s), `Leave pool (${s.name})`)}>Leave pool</button>
	</div>
	<div class="row-buttons">
		{#if s.motherPool}
			<button
				title="Take pool {s.pool} out of master pool {s.motherPool}, so the server always fills it"
				onclick={() => engineRef.current?.changeSpawns(leaveMotherChanges(editor.spawns, s), `Leave master pool ${s.motherPool} (pool ${s.pool})`)}>Leave the master pool</button
			>
		{:else}
			<button
				class:active={picking === 'joinMother'}
				title="Click a spawn on the map whose pool is in a master pool, such as another vein of the zone; this pool joins that master pool and takes turns with its others"
				onclick={() => (picking ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'joinMother'))}>{picking === 'joinMother' ? 'Cancel' : 'Join a master pool'}</button
			>
		{/if}
	</div>
{:else}
	<p class="dim">In no pool: the server always spawns it.</p>
	<div class="row-buttons">
		<button title="Make a pool of this spawn, then click others on the map to add them" onclick={() => engineRef.current?.makePool(spawnKey(s))}>Make pool</button>
		<button class:active={picking === 'joinPool'} title="Click a pooled spawn on the map to put this one into its pool" onclick={() => (picking ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'joinPool'))}
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
