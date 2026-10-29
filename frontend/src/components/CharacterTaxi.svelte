<script lang="ts">
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ReadCharacterTaxi, SaveCharacterTaxi } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { isAlliance } from '../lib/wow/characterSheet'

	// The character editor's Flight paths tab (#881): the flight masters' stops it knows
	// (characters.known_taxi_mask, a bit for each taxi_nodes ID), by continent, from the world
	// database's stops (the server reads them there). A stop no flight leaves (the client's
	// TaxiPath.dbc) is one the server forgets at login. Saved with its own Save (Go,
	// internal/vmangos/charquests.go SaveCharacterTaxi); a known stop the list lacks is kept.

	let { guid, race, dirty = $bindable(false) }: { guid: number; race: number; dirty?: boolean } = $props()

	let stops = $state<vmangos.TaxiStop[]>([])
	const rows = new RowList<number[]>({
		empty: [],
		read: async () => {
			const t = await ReadCharacterTaxi(guid)
			stops = t.stops ?? []
			return [...(t.known ?? [])]
		},
		key: (list) => JSON.stringify([...list].sort((a, b) => a - b)),
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

	/** The stop Go refused, outlined until the next save. */
	let refused = $state('')
	const alliance = $derived(isAlliance(race))
	const side = $derived(alliance ? 'Alliance' : 'Horde')
	const ours = (s: vmangos.TaxiStop) => (alliance ? s.alliance : s.horde)
	/** Lists only the stops the character's side can fly from. */
	let sideOnly = $state(true)
	let filter = $state('')
	const known = $derived(new Set(rows.rows))
	const MAP_NAMES: Record<number, string> = { 0: 'Eastern Kingdoms', 1: 'Kalimdor' }
	const maps = $derived.by(() => {
		const f = filter.trim().toLowerCase()
		const by = new Map<number, vmangos.TaxiStop[]>()
		for (const s of stops) {
			if (sideOnly && !ours(s) && !known.has(s.id)) continue
			if (f && !s.name.toLowerCase().includes(f) && String(s.id) !== f) continue
			by.set(s.mapId, [...(by.get(s.mapId) ?? []), s])
		}
		return [...by].sort(([a], [b]) => a - b)
	})

	function setKnown(ids: number[], on: boolean) {
		const s = new Set(rows.rows)
		for (const id of ids) {
			if (on) s.add(id)
			else s.delete(id)
		}
		rows.rows = [...s]
	}

	const sides = (s: vmangos.TaxiStop) => (s.alliance && s.horde ? 'Both sides' : s.alliance ? 'Alliance' : s.horde ? 'Horde' : 'No mount')

	function save() {
		refused = ''
		void rows.save('Saving the flight paths', async (ids) => {
			const r = await SaveCharacterTaxi(guid, ids)
			if (r.refused) {
				refused = r.refused.column
				filter = ''
				throw new Error(r.refused.message)
			}
			await rows.load()
			setStatus(`Saved ${ids.length} known ${ids.length === 1 ? 'flight path' : 'flight paths'}. The flight master's map shows them at the character's next login.`, 10000)
		})
	}
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Flight paths{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save flight paths' : 'Saved'}</button>
	</div>
	<div class="row">
		<input type="search" placeholder="Narrow by name or ID" bind:value={filter} aria-label="Find a stop" />
		<label title="The stops the {side} can fly from, and the ones the character knows"><input type="checkbox" bind:checked={sideOnly} /> Only the {side}'s</label>
	</div>
	{#if rows.loading && !stops.length}
		<p class="dim">Reading the flight paths…</p>
	{:else}
		{#each maps as [id, list] (id)}
			<div class="map">
				<h4>{MAP_NAMES[id] ?? `Map ${id}`}</h4>
				<span class="dim">{list.filter((s) => known.has(s.id)).length} of {list.length}</span>
				<button
					onclick={() =>
						setKnown(
							list.filter((s) => s.routes).map((s) => s.id),
							true,
						)}>All</button
				>
				<button
					onclick={() =>
						setKnown(
							list.map((s) => s.id),
							false,
						)}>None</button
				>
			</div>
			<ul class="list" aria-label={MAP_NAMES[id] ?? `Map ${id}`}>
				{#each list as s (s.id)}
					<li class:refused={refused === String(s.id)} class:dead={!s.routes} data-stop={s.id}>
						<label title="Stop {s.id}{s.routes ? '' : ': no flight leaves it, so the server forgets it at login'}"
							><input type="checkbox" checked={known.has(s.id)} onchange={(e) => setKnown([s.id], e.currentTarget.checked)} /> {s.name || `Stop ${s.id}`}</label
						>
						<span class="dim">{sides(s)}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="dim">{filter.trim() ? 'No stop matches.' : 'No stops.'}</p>
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
		margin: 0;
		font-size: 12px;
		font-weight: 600;
	}
	.head,
	.row,
	.map {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.map {
		margin-top: 6px;
	}
	.row input[type='search'] {
		flex: 1;
		max-width: 280px;
	}
	.row label,
	.list label {
		display: flex;
		align-items: center;
		gap: 4px;
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
	.list label {
		flex: 1;
	}
	.list li.dead label {
		color: var(--text-dim);
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
