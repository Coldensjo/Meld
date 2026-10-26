<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { NextObjectLoot, ReadObjectLoot, SaveObjectLoot, SearchItems } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { RowList } from '../lib/ui/rowList.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import { objectTypeName } from '../lib/world/spawnInfo'
	import { QUALITY_VARS } from '../lib/wow/itemTooltip'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltip from './ItemTooltip.svelte'

	// The game object editor's Contents tab (#220): what a chest (a vein or herb is one too) or a
	// fishing hole holds, its gameobject_loot_template rows, edited as a list and saved with the
	// editor's Save, as the creature editor's Shop tab is (the world database keeps no undo). Several
	// objects can hold one list: the tab names them, and gives this object a copy of its own on asking.
	// An object of another type can be made a chest here.

	interface Props {
		/** The object template's entry. */
		entry: number
		name: string
		/** The template's type and loot list (data1) as the editor has them now, saved or not. */
		type: number
		loot: number
		/** The template's restock columns, as the editor has them now. */
		consumed: boolean
		restock: number
		/** The spawn the editor was opened from, for its respawn time. */
		spawn: vmangos.WorldSpawn | null
		/** Turns the object into a chest with a new, empty loot list (template changes, saved with Save). */
		onmakechest: () => void
		/** Points the object at loot list `id` (data1). */
		onsetloot: (id: number) => void
		/** Sets a template column. */
		onset: (col: string, value: string) => void
		dirty?: boolean
	}
	let { entry, name, type, loot, consumed, restock, spawn, onmakechest, onsetloot, onset, dirty = $bindable(false) }: Props = $props()

	const QUALITY = QUALITY_VARS
	const container = $derived(type === 3 || type === 25)

	/** The loot list the rows are edited for, its rows, and the objects and spawns that hold it too. */
	type Loot = { list: number; items: vmangos.LootItem[]; users: vmangos.LootUser[]; spawns: number }
	const rows = new RowList<Loot>({
		empty: { list: 0, items: [], users: [], spawns: 0 },
		read: async () => {
			const r = await ReadObjectLoot(entry, loot)
			return { list: loot, items: r.items ?? [], users: r.users ?? [], spawns: r.spawns }
		},
		// The list leads the key, so the list the database has the rows for can be read back from it.
		key: (l) => `${l.list}|${JSON.stringify(l.items.map((i) => [i.item, i.chance, i.group, i.minCount, i.maxCount, i.condition, i.patchMin, i.patchMax]))}`,
	})
	const items = $derived(rows.rows.items)
	const listFor = $derived(rows.rows.list)
	const users = $derived(rows.rows.users)
	const spawns = $derived(rows.rows.spawns)
	const savedFor = $derived(Number(rows.saved.slice(0, rows.saved.indexOf('|'))))
	$effect(() => {
		dirty = listFor > 0 && rows.dirty
	})

	// The rows follow the object and its loot list; a list this tab picked itself (a copy) keeps them.
	rows.follow(() => `${entry}|${loot}`)

	/** Drops the unsaved rows: reads the list the object points at again. */
	export function revert() {
		rows.followed = `${entry}|${loot}`
		void rows.revert()
	}

	/** Writes the rows into their list; returns how many it saved, or -1 when nothing needed saving. */
	export async function save(): Promise<number> {
		if (!dirty) return -1
		await SaveObjectLoot(listFor, items)
		rows.markSaved()
		return items.length
	}

	/** This object gets a new list with the same rows, so the others keep theirs. */
	async function ownCopy() {
		try {
			const id = await NextObjectLoot()
			rows.followed = `${entry}|${id}`
			rows.rows.list = id
			rows.rows.users = []
			onsetloot(id)
			setStatus(`${name} now has loot list ${id}, a copy of the shared one. Save to keep it.`, 8000)
		} catch (err) {
			rows.error = String(err)
		}
	}

	async function newList() {
		try {
			onsetloot(await NextObjectLoot())
		} catch (err) {
			rows.error = String(err)
		}
	}

	function remove(item: number) {
		rows.rows.items = items.filter((i) => i.item !== item)
	}

	const int = (v: string, lo: number, hi: number) => {
		const n = Math.round(Number(v))
		return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo
	}
	const chanceOf = (v: string) => {
		const n = Number(v)
		return Number.isFinite(n) ? Math.min(100, Math.max(-100, n)) : 0
	}

	// The list can be long (the shared chest list 2283 has 800 rows): a filter, and the first rows only
	// until asked for all.
	let filter = $state('')
	let showAll = $state(false)
	const LIMIT = 150
	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase()
		return q ? items.filter((i) => i.name.toLowerCase().includes(q) || String(i.item) === q) : items
	})

	// Adding: a search over item_template by name or entry.
	let query = $state('')
	let results = $state<vmangos.ItemRef[]>([])
	let searching = $state(false)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		clearTimeout(timer)
		if (!q) {
			results = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = await SearchItems(q)
				if (q === query.trim()) results = r ?? []
			} catch (err) {
				rows.error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	function add(r: vmangos.ItemRef) {
		if (items.some((i) => i.item === r.entry)) {
			setStatus(`${r.name} is already in the contents.`, 4000)
			return
		}
		rows.rows.items = [...items, vmangos.LootItem.createFrom({ item: r.entry, name: r.name, quality: r.quality, displayId: r.displayId, chance: 100, group: 0, minCount: 1, maxCount: 1, condition: 0, patchMin: 0, patchMax: 10 })]
	}

	// The item under the pointer, for its tooltip.
	let hover = $state<{ entry: number; displayId: number; x: number; y: number } | null>(null)
	function hoverItem(entry: number, displayId: number) {
		return {
			onpointerenter: (e: PointerEvent) => (hover = { entry, displayId, x: e.clientX, y: e.clientY }),
			onpointermove: (e: PointerEvent) => hover && hover.entry === entry && ((hover.x = e.clientX), (hover.y = e.clientY)),
			onpointerleave: () => hover?.entry === entry && (hover = null),
		}
	}

	/** The spawn's respawn time, as one undo step, as the This spawn tab sets it. */
	function respawn(min: number, max: number) {
		if (!spawn) return
		void engineRef.current?.editSpawn(spawnKey(spawn), { respawnSecs: Math.max(0, min), respawnMaxSecs: Math.max(0, min, max) }, `Respawn time (${spawn.name})`)
	}
	const secs = (e: Event) => {
		const v = (e.currentTarget as HTMLInputElement).valueAsNumber
		return Number.isFinite(v) ? Math.round(v) : null
	}
	const spawnWord = (n: number) => `${n} ${n === 1 ? 'spawn' : 'spawns'}`
	const sharedSpawns = $derived(users.reduce((n, u) => n + u.spawns, 0))
</script>

<div class="loot">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}

	{#if !container}
		<p>A {objectTypeName(type).toLowerCase()} holds nothing: only a chest (veins and herbs are chests too) or a fishing hole has contents.</p>
		<p>
			<button class="active" onclick={onmakechest}>Make it a chest</button>
		</p>
		<p class="dim">
			Its type becomes Chest, with an ordinary chest's lock (57: anyone opens it), taken when looted, and a new, empty loot list; what the data columns meant for a {objectTypeName(type).toLowerCase()} is cleared. Saved with Save.
		</p>
		{#if spawns > 0}
			<p class="warn">
				{name} has {spawnWord(spawns)} in the world, and every one becomes a chest. To change only this spawn, make a copy (New object, then turn this spawn into it under This spawn).
			</p>
		{/if}
	{:else if loot <= 0}
		<p>{name} has no loot list, so it opens empty.</p>
		<p><button class="active" onclick={newList}>Give it a loot list</button></p>
	{:else}
		{#if users.length}
			<div class="warn">
				<p>
					Loot list {loot} is shared: {users.length} other {users.length === 1 ? 'object holds' : 'objects hold'} the same contents ({spawnWord(sharedSpawns)}), so a change here changes {users.length === 1 ? 'its' : 'theirs'} too.
				</p>
				<ul class="users">
					{#each users.slice(0, 8) as u (u.entry)}
						<li use:idMenu={{ ids: [idOf('object', u.entry)], name: u.name }}>{u.name} <span class="dim">entry {u.entry} · {spawnWord(u.spawns)}</span></li>
					{/each}
					{#if users.length > 8}<li class="dim">and {users.length - 8} more</li>{/if}
				</ul>
				<button onclick={ownCopy}>Give {name} its own copy</button>
			</div>
		{:else if listFor !== savedFor}
			<p class="dim">Loot list {listFor} is new: it is written when you save.</p>
		{/if}

		<div class="head">
			<h3>Holds{items.length ? ` (${items.length})` : ''}</h3>
			<span class="dim">loot list {loot}{spawns ? ` · ${spawnWord(spawns)} of ${name}` : ''}</span>
		</div>
		{#if rows.loading}
			<p class="dim">Loading the contents…</p>
		{:else if items.length === 0}
			<p class="dim">Nothing yet. Find items below and click one to add it.</p>
		{:else}
			{#if items.length > 20}<input class="search" type="search" placeholder="Find in the contents" bind:value={filter} />{/if}
			<table>
				<thead>
					<tr>
						<th>Item</th>
						<th title="Percent. In group 0 each item rolls on its own; in a group one item drops, those at 0 sharing what the others leave. Negative: only for a player on a quest that needs it.">Chance %</th>
						<th title="0 for none; one item of each other group drops">Group</th>
						<th title="How many drop">Count</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each showAll ? shown : shown.slice(0, LIMIT) as it (it.item)}
						<tr>
							{#if it.minCount < 0}
								<td class="item" title="A reference: the rows of reference_loot_template {-it.minCount}, rolled {it.maxCount} {it.maxCount === 1 ? 'time' : 'times'}"
									>Reference list {-it.minCount} <span class="dim">×{it.maxCount}</span></td
								>
							{:else}
								<td class="item" use:idMenu={{ ids: [idOf('item', it.item)], name: it.name }} {...hoverItem(it.item, it.displayId)}>
									<ItemIcon displayId={it.displayId} />
									<span style:color={QUALITY[it.quality] ?? QUALITY[1]}>{it.name || '(unknown item)'}</span>
									<span class="dim">{it.item}{it.chance < 0 ? ' · quest' : ''}</span>
								</td>
							{/if}
							<td><input type="number" min="-100" max="100" step="any" value={it.chance} oninput={(e) => (it.chance = chanceOf(e.currentTarget.value))} /></td>
							<td><input type="number" min="0" max="255" value={it.group} oninput={(e) => (it.group = int(e.currentTarget.value, 0, 255))} /></td>
							<td class="count">
								{#if it.minCount > 0}
									<input type="number" min="1" max="255" value={it.minCount} oninput={(e) => ((it.minCount = int(e.currentTarget.value, 1, 255)), (it.maxCount = Math.max(it.maxCount, it.minCount)))} />
									–
									<input type="number" min="1" max="255" value={it.maxCount} oninput={(e) => (it.maxCount = int(e.currentTarget.value, it.minCount, 255))} />
								{/if}
							</td>
							<td class="row-actions"><button title="Remove" onclick={() => remove(it.item)}>✕</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if !showAll && shown.length > LIMIT}
				<p class="dim">Showing {LIMIT} of {shown.length}. <button onclick={() => (showAll = true)}>Show all</button></p>
			{/if}
		{/if}

		<h3>Add items</h3>
		<input class="search" type="search" placeholder="Item name or entry" bind:value={query} />
		{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
		{#if results.length}
			<ul class="results">
				{#each results as r (r.entry)}
					<li>
						<button disabled={items.some((i) => i.item === r.entry)} onclick={() => add(r)} use:idMenu={{ ids: [idOf('item', r.entry)], name: r.name }} {...hoverItem(r.entry, r.displayId)}>
							<ItemIcon displayId={r.displayId} /> <span style:color={QUALITY[r.quality] ?? QUALITY[1]}>{r.name}</span> <span class="dim">{r.entry}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if query.trim() && !searching}
			<p class="dim">No item matches.</p>
		{/if}

		<h3>When it comes back</h3>
		{#if type === 3}
			<label class="check">
				<input type="checkbox" checked={consumed} onchange={(e) => onset('data3', e.currentTarget.checked ? '1' : '0')} />
				Taken when looted: it disappears and the spawn comes back after its respawn time
			</label>
			{#if !consumed}
				<label class="inline">
					Restocks after
					<input type="number" min="0" value={restock} onchange={(e) => onset('data2', String(int(e.currentTarget.value, 0, 2147483647)))} />
					s <span class="dim">(0 never: it stays empty until the server restarts)</span>
				</label>
			{/if}
		{/if}
		{#if spawn}
			<label class="inline">
				This spawn respawns after
				<input
					type="number"
					min="0"
					step="10"
					value={spawn.respawnSecs}
					onchange={(e) => {
						const v = secs(e)
						if (v !== null) respawn(v, Math.max(v, spawn.respawnMaxSecs))
					}}
				/>
				to
				<input
					type="number"
					min="0"
					step="10"
					value={spawn.respawnMaxSecs}
					onchange={(e) => {
						const v = secs(e)
						if (v !== null) respawn(spawn.respawnSecs, v)
					}}
				/>
				s
			</label>
			<p class="dim">The respawn time is the spawn's own (gameobject.spawntimesecsmin/max): an undo step, saved with the region's spawns.</p>
		{:else}
			<p class="dim">Each spawn has its own respawn time: open the editor from a spawn (or use the Inspector) to set it.</p>
		{/if}
	{/if}
	{#if hover}<ItemTooltip entry={hover.entry} displayId={hover.displayId} x={hover.x} y={hover.y} />{/if}
</div>

<style>
	.loot {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.head h3 {
		flex: 1;
	}
	.warn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.users {
		margin: 0;
		padding-left: 16px;
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-weight: 500;
		color: var(--text-dim);
	}
	th,
	td {
		padding: 3px 4px;
		border-bottom: 1px solid var(--border);
	}
	td input {
		width: 58px;
	}
	td.count {
		white-space: nowrap;
	}
	td.count input {
		width: 44px;
	}
	.row-actions {
		text-align: right;
	}
	.row-actions button {
		padding: 1px 6px;
	}
	.search {
		width: 100%;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
	}
	.results button {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: 3px 6px;
	}
	.results button:hover:not(:disabled) {
		background: var(--panel-2);
	}
	.results button:disabled {
		opacity: 0.45;
	}
	label.check,
	label.inline {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	label.inline input {
		width: 70px;
	}
</style>
