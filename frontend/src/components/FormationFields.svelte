<script lang="ts">
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { creatureOf, disbandChanges, FORMATION_FLAGS, flagChanges, followersOf, follows, groupOptions, leads, leaveChanges } from '../lib/world/formations'
	import { selectSpawn } from '../lib/world/spawnEdits'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import type { vmangos } from '../../wailsjs/go/models'

	// A creature's formation (creature_groups, #172): whom it follows and in which slot, or whom it
	// leads and how the group behaves; and the buttons that build one on the map. Every change is
	// one undo step, saved with the region's spawns.

	interface Props {
		s: vmangos.WorldSpawn
		/** An editor shows this spawn: it asks about its unsaved edits, then moves to the picked spawn. */
		onswitch?: (o: vmangos.WorldSpawn) => void
	}
	let { s, onswitch }: Props = $props()

	// `s` is a new copy after every edit, so these follow the edits.
	const leader = $derived(leads(s) ? s : follows(s) ? creatureOf(editor.spawns, s.leader) : undefined)
	const members = $derived(leader ? followersOf(editor.spawns, leader.guid) : [])
	const options = $derived(leader ? groupOptions(editor.spawns, leader) : 0)
	const picking = $derived(ui.spawnPick?.key === spawnKey(s) && (ui.spawnPick.mode === 'lead' || ui.spawnPick.mode === 'follow') ? ui.spawnPick.mode : null)
	const degrees = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10

	/** Selects another creature of the formation; an editor open on this one moves to it. */
	function pick(o: vmangos.WorldSpawn) {
		const drawn = engineRef.current?.activeDocument().spawnLayer.get(spawnKey(o))
		if (!drawn) return
		if (onswitch) {
			onswitch(drawn)
			return
		}
		selectSpawn(drawn)
		if (ui.creatureEditor?.key) ui.creatureEditor = { key: spawnKey(drawn), entry: drawn.entry }
	}

	function slot(dist: number, angleDeg: number) {
		if (!Number.isFinite(dist) || !Number.isFinite(angleDeg)) return
		engineRef.current?.setFormationSlot(spawnKey(s), dist, (((angleDeg % 360) + 360) % 360) * (Math.PI / 180))
	}

	function toggleFlag(bit: number) {
		if (!leader) return
		engineRef.current?.changeSpawns(flagChanges(editor.spawns, leader, options ^ bit), `Formation flags (${leader.name})`)
	}

	const valueOf = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber
</script>

<h4>Formation</h4>
{#if follows(s)}
	<p class="dim">
		Follows
		{#if leader}<button class="link" title="Select spawn {leader.guid}" onclick={() => pick(leader)}>{leader.name}</button>{:else}creature {s.leader}, which is not in this region{/if}, in a slot {s.followDist.toFixed(1)} yd away at {degrees(
			s.followAngle,
		)}° from its facing (90° is on its left).
	</p>
	{#if leader}
		<div class="fields">
			<label>Distance yd <input type="number" min="0" step="0.5" value={s.followDist.toFixed(2)} onchange={(e) => slot(valueOf(e), degrees(s.followAngle))} /></label>
			<label>Angle ° <input type="number" step="5" value={degrees(s.followAngle)} onchange={(e) => slot(s.followDist, valueOf(e))} /></label>
		</div>
		<p class="dim hint">Dragging it on the map sets its slot where it is dropped; a number here moves it into its slot.</p>
	{/if}
	<div class="row-buttons">
		<button onclick={() => engineRef.current?.changeSpawns(leaveChanges(editor.spawns, s), `Leave formation (${s.name})`)}>Leave formation</button>
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
					<button class="row" title="Select spawn {o.guid}" onclick={() => pick(o)}>
						<span class="name">{o.name}</span>
						<span class="dim">{o.followDist.toFixed(1)} yd, {degrees(o.followAngle)}°</span>
					</button>
					<button class="remove" title="Take {o.name} out of the formation" onclick={() => engineRef.current?.changeSpawns(leaveChanges(editor.spawns, o), `Leave formation (${o.name})`)}>×</button>
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
		<button class:active={picking === 'lead'} onclick={() => (picking ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'lead'))}>{picking ? 'Done' : 'Add followers on the map'}</button>
		<button onclick={() => engineRef.current?.changeSpawns(disbandChanges(editor.spawns, s), `Disband formation (${s.name})`)}>Disband</button>
	</div>
{:else}
	<p class="dim">In no formation.</p>
	<div class="row-buttons">
		<button class:active={picking === 'lead'} title="Click creatures on the map to make them follow this one" onclick={() => (picking === 'lead' ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'lead'))}
			>{picking === 'lead' ? 'Done' : 'Lead a formation'}</button
		>
		<button class:active={picking === 'follow'} title="Click a creature on the map for this one to follow" onclick={() => (picking === 'follow' ? (ui.spawnPick = null) : engineRef.current?.startSpawnPick(spawnKey(s), 'follow'))}
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
