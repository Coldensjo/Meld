<script lang="ts">
	import type { SpawnPanel, SpawnPanelActions } from '../lib/toolwin/inspector'
	import { creatureOf, FORMATION_FLAGS, followersOf, follows, groupOptions, leads } from '../lib/world/formations'
	import { spawnKey } from '../lib/world/spawnKey'
	import type { vmangos } from '../lib/wails/models'

	// A creature's formation (creature_groups, #172): whom it follows and in which slot, or whom it
	// leads and how the group behaves; and the buttons that build one on the map. Every change is
	// one undo step, saved with the region's spawns. It reads the region's spawns from `panel` and acts
	// through `act`, so it works in the Inspector's own OS window too (#910, lib/toolwin/inspector.ts).

	interface Props {
		s: vmangos.WorldSpawn
		/** The region's spawns (at least those of this creature's formation) and the pick on the map under way. */
		panel: SpawnPanel
		act: SpawnPanelActions
	}
	let { s, panel, act }: Props = $props()

	// `s` is a new copy after every edit, so these follow the edits.
	const key = $derived(spawnKey(s))
	const leader = $derived(leads(s) ? s : follows(s) ? creatureOf(panel.spawns, s.leader) : undefined)
	const members = $derived(leader ? followersOf(panel.spawns, leader.guid) : [])
	const options = $derived(leader ? groupOptions(panel.spawns, leader) : 0)
	const picking = $derived(panel.pick?.key === key && (panel.pick.mode === 'lead' || panel.pick.mode === 'follow') ? panel.pick.mode : null)
	const degrees = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10

	function toggleFlag(bit: number) {
		if (leader) act.formationFlags(spawnKey(leader), options ^ bit)
	}

	const valueOf = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber
</script>

<h4>Formation</h4>
{#if follows(s)}
	<p class="dim">
		Follows
		{#if leader}<button class="link" title="Select spawn {leader.guid}" onclick={() => act.pickSpawn(spawnKey(leader))}>{leader.name}</button>{:else}creature {s.leader}, which is not in this region{/if}, in a slot {s.followDist.toFixed(
			1,
		)} yd away at {degrees(s.followAngle)}° from its facing (90° is on its left).
	</p>
	{#if leader}
		<div class="fields">
			<label>Distance yd <input type="number" min="0" step="0.5" value={s.followDist.toFixed(2)} onchange={(e) => act.formationSlot(key, valueOf(e), degrees(s.followAngle))} /></label>
			<label>Angle ° <input type="number" step="5" value={degrees(s.followAngle)} onchange={(e) => act.formationSlot(key, s.followDist, valueOf(e))} /></label>
		</div>
		<p class="dim hint">Dragging it on the map sets its slot where it is dropped; a number here moves it into its slot.</p>
	{/if}
	<div class="row-buttons">
		<button onclick={() => act.leaveFormation(key)}>Leave formation</button>
	</div>
{:else if leads(s)}
	<p class="dim">
		Leads {members.length === 1 ? '1 follower' : `${members.length} followers`} in this region.
		{(options & 0x001) !== 0 ? 'They walk its path in their slots.' : "They don't walk with it, without the first flag below; they only share what the others say."}
	</p>
	{#if members.length}
		<ul class="points">
			{#each members as o (o.guid)}
				<li>
					<button class="row" title="Select spawn {o.guid}" onclick={() => act.pickSpawn(spawnKey(o))}>
						<span class="name">{o.name}</span>
						<span class="dim">{o.followDist.toFixed(1)} yd, {degrees(o.followAngle)}°</span>
					</button>
					<button class="remove" title="Take {o.name} out of the formation" onclick={() => act.leaveFormation(spawnKey(o))}>×</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="flags">
		{#each FORMATION_FLAGS as f (f.bit)}
			<label><input type="checkbox" checked={(options & f.bit) !== 0} onchange={() => toggleFlag(f.bit)} /> {f.name}</label>
		{/each}
	</div>
	<div class="row-buttons">
		<button class:active={picking === 'lead'} onclick={() => (picking ? act.cancelPick() : act.startPick(key, 'lead'))}>{picking ? 'Done' : 'Add followers on the map'}</button>
		<button onclick={() => act.disband(key)}>Disband</button>
	</div>
{:else}
	<p class="dim">In no formation.</p>
	<div class="row-buttons">
		<button class:active={picking === 'lead'} title="Click creatures on the map to make them follow this one" onclick={() => (picking === 'lead' ? act.cancelPick() : act.startPick(key, 'lead'))}
			>{picking === 'lead' ? 'Done' : 'Lead a formation'}</button
		>
		<button class:active={picking === 'follow'} title="Click a creature on the map for this one to follow" onclick={() => (picking === 'follow' ? act.cancelPick() : act.startPick(key, 'follow'))}
			>{picking === 'follow' ? 'Cancel' : 'Follow another'}</button
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
	.hint {
		font-size: 11px;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent-text);
		font-size: 12px;
		cursor: pointer;
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
	.flags {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}
	.row-buttons {
		display: flex;
		gap: 6px;
	}
</style>
