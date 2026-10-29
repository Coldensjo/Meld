<script lang="ts">
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ReadCharacterReputation, SaveCharacterReputation } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { FACTION_AT_WAR, FACTION_HIDDEN, FACTION_INACTIVE, FACTION_INVISIBLE_FORCED, FACTION_PEACE_FORCED, FACTION_VISIBLE, REP_MAX, REP_MIN, REP_RANKS, repProgress, repRank } from '../lib/wow/characterSheet'

	// The character editor's Reputation tab (#875): its standing with every faction it can have
	// reputation with, by the reputation frame's groups, as the game shows it: the race and class's
	// start (Faction.dbc, the world database's faction table) plus what character_reputation stores.
	// Pick a rank or type a standing, and set the flags a player sets (shown in the frame, at war,
	// inactive). Saved with its own Save; Go writes each faction's difference from the start
	// (internal/vmangos/charsheet.go SaveCharacterReputation).

	let { guid, dirty = $bindable(false) }: { guid: number; dirty?: boolean } = $props()

	const rows = new RowList<vmangos.CharacterReputation[]>({
		empty: [],
		read: async () => ((await ReadCharacterReputation(guid)) ?? []).map((r) => ({ ...r })),
		key: (list) => JSON.stringify(list.map((r) => [r.faction, r.standing, r.flags])),
	})
	rows.follow(() => guid)
	$effect(() => {
		dirty = rows.dirty
	})

	/** Drops the unsaved edits (the editor's Revert and Discard). */
	export function revert() {
		refused = ''
		void rows.revert()
	}

	/** The faction Go refused, outlined until the next save. */
	let refused = $state('')
	/** Lists only the factions the game's reputation frame shows. */
	let listedOnly = $state(true)
	let filter = $state('')

	const hidden = (r: vmangos.CharacterReputation) => (r.defaultFlags & (FACTION_HIDDEN | FACTION_INVISIBLE_FORCED)) !== 0
	const groups = $derived.by(() => {
		const f = filter.trim().toLowerCase()
		const by = new Map<string, vmangos.CharacterReputation[]>()
		for (const r of rows.rows) {
			if (listedOnly && !(r.flags & FACTION_VISIBLE)) continue
			if (f && !r.name.toLowerCase().includes(f) && String(r.faction) !== f) continue
			const g = r.group || 'Other'
			by.set(g, [...(by.get(g) ?? []), r])
		}
		return [...by].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
	})

	function setStanding(id: number, v: number) {
		const s = Math.min(REP_MAX, Math.max(REP_MIN, Math.round(Number.isFinite(v) ? v : 0)))
		// A standing given makes the faction show in the frame, unless the faction is never shown.
		rows.rows = rows.rows.map((r) => (r.faction === id ? { ...r, standing: s, flags: hidden(r) ? r.flags : r.flags | FACTION_VISIBLE } : r))
	}

	function setFlag(id: number, bit: number, on: boolean) {
		rows.rows = rows.rows.map((r) => (r.faction === id ? { ...r, flags: on ? r.flags | bit : r.flags & ~bit } : r))
	}

	function save() {
		refused = ''
		void rows.save('Saving the reputation', async (reps) => {
			const r = await SaveCharacterReputation(guid, reps)
			if (r.refused) {
				refused = r.refused.column
				listedOnly = false
				filter = ''
				throw new Error(r.refused.message)
			}
			await rows.load()
			setStatus('Saved the reputation. The character has it at its next login.', 10000)
		})
	}
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Reputation</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save reputation' : 'Saved'}</button>
	</div>
	<div class="row">
		<input type="search" placeholder="Narrow by name or ID" bind:value={filter} aria-label="Find a faction" />
		<label title="The factions the game's reputation frame shows; the others the character has not met yet, or never sees"><input type="checkbox" bind:checked={listedOnly} /> Only the ones the game lists</label>
	</div>
	{#if rows.loading && !rows.rows.length}
		<p class="dim">Reading the reputation…</p>
	{:else}
		{#each groups as [g, list] (g)}
			<h4>{g}</h4>
			<ul class="list" aria-label={g}>
				{#each list as r (r.faction)}
					{@const rank = repRank(r.standing)}
					{@const [into, size] = repProgress(r.standing)}
					<li class:refused={refused === String(r.faction)} class:changed={r.standing !== r.base} data-faction={r.faction}>
						<span class="name" title="Faction {r.faction}; the race and class start at {r.base}">{r.name || `Faction ${r.faction}`}</span>
						<select value={rank} aria-label="Rank" onchange={(e) => setStanding(r.faction, REP_RANKS[Number(e.currentTarget.value)][1])}>
							{#each REP_RANKS as [n], i (n)}<option value={i}>{n}</option>{/each}
						</select>
						<input type="number" min={REP_MIN} max={REP_MAX} value={r.standing} aria-label="Standing" onchange={(e) => setStanding(r.faction, Number(e.currentTarget.value))} />
						<span class="bar" title="{into} of {size} into {REP_RANKS[rank][0]}"><span style:width="{(100 * into) / size}%"></span></span>
						<label title={hidden(r) ? 'The game never lists this faction' : 'Listed in the reputation frame'}
							><input type="checkbox" disabled={hidden(r)} checked={(r.flags & FACTION_VISIBLE) !== 0} onchange={(e) => setFlag(r.faction, FACTION_VISIBLE, e.currentTarget.checked)} /> Listed</label
						>
						<label title={r.defaultFlags & FACTION_PEACE_FORCED ? 'Always at peace: its own side' : 'At war: its members can be attacked'}
							><input type="checkbox" disabled={(r.defaultFlags & FACTION_PEACE_FORCED) !== 0} checked={(r.flags & FACTION_AT_WAR) !== 0} onchange={(e) => setFlag(r.faction, FACTION_AT_WAR, e.currentTarget.checked)} /> War</label
						>
						<label title="Moved to the frame's Inactive heading"
							><input type="checkbox" checked={(r.flags & FACTION_INACTIVE) !== 0} onchange={(e) => setFlag(r.faction, FACTION_INACTIVE, e.currentTarget.checked)} /> Inactive</label
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="dim">{filter.trim() ? 'No faction matches.' : 'No factions.'}</p>
		{/each}
	{/if}
</div>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 0;
		flex: 1;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h4 {
		margin: 6px 0 0;
		font-size: 12px;
		font-weight: 600;
	}
	.head,
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row input[type='search'] {
		flex: 1;
		max-width: 280px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.list li:hover {
		background: var(--panel-2);
	}
	.list li.changed .name {
		font-weight: 600;
	}
	.list label {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.name {
		flex: 1;
		min-width: 140px;
	}
	input[type='number'] {
		width: 72px;
	}
	.bar {
		width: 80px;
		height: 6px;
		border-radius: 3px;
		background: var(--panel-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.refused {
		outline: 1px solid var(--danger-text);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
</style>
