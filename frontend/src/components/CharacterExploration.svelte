<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity'
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ReadCharacterExploration, SaveCharacterExploration } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'

	// The character editor's Explored tab (#881): the areas it has uncovered on the world map
	// (characters.explored_zones, a bit for each AreaTable.dbc area), by map and zone. A zone's box
	// marks it and all its subzones; a zone opens to its subzones. Saved with its own Save (Go,
	// internal/vmangos/charquests.go SaveCharacterExploration). Exploring an area here gives none of
	// the experience the game gives for it.

	let { guid, dirty = $bindable(false) }: { guid: number; dirty?: boolean } = $props()

	let zones = $state<vmangos.ExploreZone[]>([])
	const rows = new RowList<number[]>({
		empty: [],
		read: async () => {
			const e = await ReadCharacterExploration(guid)
			zones = e.zones ?? []
			return [...(e.explored ?? [])]
		},
		key: (list) => JSON.stringify([...list].sort((a, b) => a - b)),
	})
	rows.follow(() => guid)
	$effect(() => {
		dirty = rows.dirty
	})

	/** Drops the unsaved edits (the editor's Revert and Discard). */
	export function revert() {
		void rows.revert()
	}

	const explored = $derived(new Set(rows.rows))
	const bitsOf = (z: vmangos.ExploreZone) => [z.bit, ...(z.subzones ?? []).map((s) => s.bit)]
	const count = (z: vmangos.ExploreZone) => bitsOf(z).filter((b) => explored.has(b)).length

	let filter = $state('')
	const open = new SvelteSet<number>()
	const maps = $derived.by(() => {
		const f = filter.trim().toLowerCase()
		const by = new Map<number, { name: string; zones: vmangos.ExploreZone[] }>()
		for (const z of zones) {
			if (f && !z.name.toLowerCase().includes(f) && !(z.subzones ?? []).some((s) => s.name.toLowerCase().includes(f))) continue
			const m = by.get(z.mapId) ?? { name: z.mapName || `Map ${z.mapId}`, zones: [] }
			m.zones.push(z)
			by.set(z.mapId, m)
		}
		return [...by]
	})

	function setBits(bits: number[], on: boolean) {
		const s = new Set(rows.rows)
		for (const b of bits) {
			if (on) s.add(b)
			else s.delete(b)
		}
		rows.rows = [...s]
	}

	function save() {
		void rows.save('Saving the explored areas', async (bits) => {
			const r = await SaveCharacterExploration(guid, bits)
			if (r.refused) throw new Error(r.refused.message)
			await rows.load()
			setStatus(`Saved ${bits.length} explored ${bits.length === 1 ? 'area' : 'areas'}. The world map shows them at the character's next login.`, 10000)
		})
	}
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Explored areas{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save explored areas' : 'Saved'}</button>
	</div>
	<p class="dim">The world map uncovers the areas marked. An area marked here gives none of the experience the game gives for finding it.</p>
	<input type="search" placeholder="Narrow by zone or subzone" bind:value={filter} aria-label="Find a zone" />
	{#if rows.loading && !zones.length}
		<p class="dim">Reading the explored areas…</p>
	{:else}
		<div class="maps">
			{#each maps as [id, m] (id)}
				{@const all = m.zones.flatMap(bitsOf)}
				<section class="mapcol">
					<div class="map">
						<h4>{m.name}</h4>
						<span class="dim">{all.filter((b) => explored.has(b)).length} of {all.length}</span>
						<button onclick={() => setBits(all, true)}>All</button>
						<button onclick={() => setBits(all, false)}>None</button>
					</div>
					<ul class="list" aria-label={m.name}>
						{#each m.zones as z (z.id)}
							{@const n = count(z)}
							{@const total = 1 + (z.subzones?.length ?? 0)}
							<li data-zone={z.id}>
								<div class="zone">
									<input type="checkbox" checked={n === total} indeterminate={n > 0 && n < total} aria-label="Explored" onchange={(e) => setBits(bitsOf(z), e.currentTarget.checked)} />
									<button class="name link" disabled={total === 1} title={total > 1 ? 'Show its subzones' : `Area ${z.id}`} onclick={() => (open.has(z.id) ? open.delete(z.id) : open.add(z.id))}
										>{total > 1 ? (open.has(z.id) ? '▾ ' : '▸ ') : ''}{z.name || `Area ${z.id}`}</button
									>
									<span class="dim">{n} of {total}</span>
								</div>
								{#if open.has(z.id)}
									<ul class="subs">
										{#each z.subzones ?? [] as s (s.id)}
											<li>
												<label title="Area {s.id}, bit {s.bit}"><input type="checkbox" checked={explored.has(s.bit)} onchange={(e) => setBits([s.bit], e.currentTarget.checked)} /> {s.name || `Area ${s.id}`}</label>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="dim">{filter.trim() ? 'No zone matches.' : 'No zones.'}</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* The sheet fills the character page's height; its long lists scroll in place (#931). */
	.sheet {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.maps {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	/* A map's list runs in columns, so the continents' long ones take a few rows of the page. */
	.mapcol > .list {
		display: block;
		columns: 260px;
		column-gap: 24px;
	}
	.mapcol > .list > li {
		break-inside: avoid;
		margin-bottom: 2px;
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
	.map,
	.zone {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.map {
		margin-top: 6px;
	}
	input[type='search'] {
		max-width: 280px;
	}
	.list,
	.subs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.subs {
		padding-left: 28px;
	}
	.zone {
		padding: 2px 4px;
		border-radius: 3px;
	}
	.zone:hover {
		background: var(--panel-2);
	}
	.name {
		flex: 1;
		text-align: left;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		font: inherit;
	}
	.link:disabled {
		opacity: 1;
		cursor: default;
	}
	label {
		display: flex;
		align-items: center;
		gap: 4px;
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
