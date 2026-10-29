<script lang="ts">
	import { createSearch } from '../lib/ui/search.svelte'
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { RowList } from '../lib/ui/rowList.svelte'
	import { InventoryItemTemplate, ReadInventory, SaveInventory, SearchItems } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { QUALITY_VARS } from '../lib/wow/itemTooltip'
	import { BAG_SLOTS, DOLL, EQUIP_SLOTS, PACK_END, PACK_START, itemAt, moveItem, newItem, placeFor, placeKey, placeName, removeItem, samePlace, wearProblem, type Place } from '../lib/wow/inventory'
	import type { CreatureField } from '../lib/world/creatureFields'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltip from './ItemTooltip.svelte'
	import RefField from './RefField.svelte'

	// The character editor's Equipment and bags (#874): the character's equipment slots laid out as the
	// game's character frame, its bag slots, backpack and bags, with the Items editor's icons and
	// tooltips. Drag an item to move it (swapping with what is there), pick a square to change the
	// item's stack, durability and enchantment or take it out, and find items to add. Saved with its
	// own Save, like the creature editor's list tabs: Go checks the places again and writes
	// character_inventory and item_instance (internal/vmangos/inventory.go).

	let { guid, race, cls, level, dirty = $bindable(false) }: { guid: number; race: number; cls: number; level: number; dirty?: boolean } = $props()

	type Item = vmangos.InventoryItem
	const QUALITY = QUALITY_VARS

	let elsewhere = $state(0)
	const rows = new RowList<Item[]>({
		empty: [],
		read: async () => {
			const inv = await ReadInventory(guid)
			elsewhere = inv.elsewhere
			return inv.items ?? []
		},
		key: (list) => JSON.stringify(list.map((i) => [i.guid, i.container, i.slot, i.entry, i.count, i.durability, i.enchant]).sort((a, b) => a[1] - b[1] || a[2] - b[2])),
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

	let selected = $state<Place | null>(null)
	/** The place of an item Go refused, outlined until the next save. */
	let refused = $state('')
	const sel = $derived(selected ? (itemAt(rows.rows, selected) ?? null) : null)

	const bags = $derived(BAG_SLOTS.map((s) => ({ slot: s, bag: itemAt(rows.rows, { container: 0, slot: s }) ?? null })).filter((b) => b.bag && b.bag.template.containerSlots > 0))
	const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)

	function save() {
		refused = ''
		void rows.save('Saving the equipment', async (items) => {
			const r = await SaveInventory(guid, items)
			if (r.refused) {
				refused = r.refused.column
				throw new Error(r.refused.message)
			}
			const n = items.length
			// Read the items again: the new ones have their numbers now.
			await rows.load()
			setStatus(`Saved the equipment and bags (${n} ${n === 1 ? 'item' : 'items'}). The character has them at its next login.`, 10000)
		})
	}

	function set(items: Item[] | string) {
		if (typeof items === 'string') {
			setStatus(items, 6000)
			return false
		}
		rows.rows = items
		return true
	}

	// Moving: drag a square onto another.
	let dragFrom = $state<Place | null>(null)
	function drop(to: Place) {
		const from = dragFrom
		dragFrom = null
		if (!from || samePlace(from, to)) return
		if (set(moveItem(rows.rows, from, to))) selected = to
	}

	function takeOut(p: Place) {
		const it = itemAt(rows.rows, p)
		if (!it) return
		const inside = rows.rows.filter((i) => p.container === 0 && i.container === p.slot).length
		rows.rows = removeItem(rows.rows, p)
		if (inside) setStatus(`Took out ${it.template.name} and the ${inside} ${inside === 1 ? 'item' : 'items'} in it.`, 5000)
	}

	function change(field: 'count' | 'durability' | 'enchant', v: number, max: number) {
		const p = selected
		if (!p) return
		const n = Math.min(max, Math.max(field === 'count' ? 1 : 0, Math.floor(Number.isFinite(v) ? v : 0)))
		rows.rows = rows.rows.map((i) => (samePlace(i, p) ? { ...i, [field]: n } : i))
	}

	// Adding: a search over item_template by name or entry, as the Shop tab's.
	let query = $state('')
	const search = createSearch((q: string) => SearchItems(q).then((r) => r ?? []), { empty: [] as vmangos.ItemRef[], onError: (err) => (rows.error = String(err)) })
	const results = $derived(search.results)
	const searching = $derived(search.searching)
	$effect(() => search.set(query.trim() || null))

	async function add(r: vmangos.ItemRef) {
		try {
			const t = await InventoryItemTemplate(r.entry)
			const p = placeFor(rows.rows, t, selected)
			if (!p) {
				setStatus(`No free place takes ${t.name}.`, 5000)
				return
			}
			rows.rows = [...rows.rows, newItem(t, p)]
			selected = p
		} catch (err) {
			rows.error = String(err)
		}
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

	const ENCHANT: CreatureField = { col: 'enchant', label: 'Enchantment', ref: 'item enchantment', hint: 'The permanent enchantment (SpellItemEnchantment.dbc)' }
</script>

{#snippet square(p: Place, label: string)}
	{@const it = itemAt(rows.rows, p)}
	{@const worn = it && p.container === 0 && p.slot < BAG_SLOTS[0] ? wearProblem(it.template, race, cls, level) : ''}
	<button
		class="sq"
		class:sel={selected && samePlace(selected, p)}
		class:refused={refused === placeKey(p)}
		class:warn={!!worn}
		class:new={it?.guid === 0}
		data-place={placeKey(p)}
		title={it ? '' : `${placeName(p)} (empty)`}
		draggable={!!it}
		ondragstart={(e) => {
			dragFrom = p
			hover = null
			e.dataTransfer?.setData('text/plain', placeKey(p))
		}}
		ondragend={() => (dragFrom = null)}
		ondragover={(e) => dragFrom && e.preventDefault()}
		ondrop={(e) => {
			e.preventDefault()
			drop(p)
		}}
		onclick={() => (selected = p)}
		{...it ? hoverItem(it.entry, it.template.displayId) : {}}
	>
		{#if it}
			<ItemIcon displayId={it.template.displayId} size={36} />
			{#if it.count > 1}<span class="count">{it.count}</span>{/if}
		{:else}
			<span class="empty">{label}</span>
		{/if}
	</button>
{/snippet}

<div class="inv">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Equipment and bags</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save equipment' : 'Saved'}</button>
	</div>
	{#if rows.loading && !rows.rows.length}
		<p class="dim">Reading the items…</p>
	{:else}
		<div class="cols">
			<div class="doll" aria-label="Equipment">
				<div class="side">
					{#each DOLL.left as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
				<div class="side">
					{#each DOLL.right as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
				<div class="bottom">
					{#each DOLL.bottom as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
			</div>
			<div class="bags">
				<div class="label dim">Bags</div>
				<div class="row" aria-label="Bag slots">
					{#each BAG_SLOTS as s (s)}{@render square({ container: 0, slot: s }, 'Bag')}{/each}
				</div>
				<div class="label dim">Backpack</div>
				<div class="grid" aria-label="Backpack">
					{#each range(PACK_START, PACK_END) as s (s)}{@render square({ container: 0, slot: s }, '')}{/each}
				</div>
				{#each bags as b (b.slot)}
					<div class="label" style:color={QUALITY[b.bag?.template.quality ?? 1] ?? QUALITY[1]}>{b.bag?.template.name}</div>
					<div class="grid" aria-label="Bag {b.slot - BAG_SLOTS[0] + 1}">
						{#each range(0, b.bag?.template.containerSlots ?? 0) as s (s)}{@render square({ container: b.slot, slot: s }, '')}{/each}
					</div>
				{/each}
			</div>
		</div>

		<div class="details" aria-label="Selected item">
			{#if !selected}
				<p class="dim">Pick a square to change its item, or drag an item to move it. Items you find below go into the picked square, or the first free place that takes them.</p>
			{:else if !sel}
				<p class="dim">{placeName(selected)} is empty. Find an item below to put it here.</p>
			{:else}
				{@const t = sel.template}
				{@const worn = selected.container === 0 && selected.slot < BAG_SLOTS[0] ? wearProblem(t, race, cls, level) : ''}
				<div class="title" use:idMenu={{ ids: [idOf('item', sel.entry)], name: t.name }} {...hoverItem(sel.entry, t.displayId)}>
					<ItemIcon displayId={t.displayId} size={28} />
					<strong style:color={QUALITY[t.quality] ?? QUALITY[1]}>{t.name || '(unknown item)'}</strong>
					<span class="dim">{sel.entry} · {placeName(selected)}{sel.guid ? ` · item ${sel.guid}` : ' · new'}</span>
				</div>
				{#if worn}<p class="warnText">The character can't wear it ({worn}): the server sends it by mail at login.</p>{/if}
				<div class="fields">
					<label>Count <input type="number" min="1" max={Math.max(1, t.stackable)} disabled={t.stackable <= 1} value={sel.count} oninput={(e) => change('count', Number(e.currentTarget.value), Math.max(1, t.stackable))} /></label>
					<label
						>Durability {#if t.maxDurability}<span class="dim">of {t.maxDurability}</span>{/if}
						<input type="number" min="0" max={t.maxDurability} disabled={!t.maxDurability} value={sel.durability} oninput={(e) => change('durability', Number(e.currentTarget.value), t.maxDurability)} /></label
					>
					<div class="ench">
						<RefField f={ENCHANT} value={String(sel.enchant)} changed={false} onset={(v) => change('enchant', Number(v), 0xffff)} />
					</div>
				</div>
				<div class="row">
					<button disabled={!t.maxDurability || sel.durability === t.maxDurability} onclick={() => change('durability', t.maxDurability, t.maxDurability)}>Repair</button>
					<button class="danger" onclick={() => selected && takeOut(selected)}>Take out</button>
				</div>
			{/if}
		</div>
		<p class="dim">
			Saved items are what the character has at its next login. Adding items needs the world server stopped (it numbers new items from the highest number it read at start); moving, changing and taking out need only the character out
			of the world.{elsewhere ? ` ${elsewhere} more ${elsewhere === 1 ? 'item is' : 'items are'} in its bank, keyring or buyback, which this leaves as they are.` : ''}
		</p>

		<h3>Add items</h3>
		<input class="search" type="search" placeholder="Item name or entry" bind:value={query} />
		{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
		{#if results.length}
			<ul class="results">
				{#each results as r (r.entry)}
					<li>
						<button onclick={() => add(r)} use:idMenu={{ ids: [idOf('item', r.entry)], name: r.name }} {...hoverItem(r.entry, r.displayId)}>
							<ItemIcon displayId={r.displayId} /> <span style:color={QUALITY[r.quality] ?? QUALITY[1]}>{r.name}</span> <span class="dim">{r.entry}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if query.trim() && !searching}
			<p class="dim">No item matches.</p>
		{/if}
	{/if}
	{#if hover}<ItemTooltip entry={hover.entry} displayId={hover.displayId} x={hover.x} y={hover.y} />{/if}
</div>

<style>
	.inv {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.head h3 {
		flex: 1;
		margin: 0;
	}
	.cols {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.doll {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: 96px;
		row-gap: 8px;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bottom {
		grid-column: 1 / -1;
		display: flex;
		justify-content: center;
		gap: 4px;
	}
	.bags {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bags .row {
		display: flex;
		gap: 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, 42px);
		gap: 4px;
	}
	.label {
		margin-top: 4px;
	}
	.sq {
		position: relative;
		width: 42px;
		height: 42px;
		padding: 2px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel-2);
	}
	.sq.sel {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.sq.new {
		background: color-mix(in srgb, var(--accent) 14%, var(--panel-2));
	}
	.sq.warn {
		border-color: var(--warn);
	}
	.sq.refused {
		outline: 2px solid var(--danger-text);
	}
	.empty {
		font-size: 9px;
		color: var(--text-dim);
	}
	.count {
		position: absolute;
		right: 3px;
		bottom: 1px;
		font-size: 11px;
		font-weight: 600;
		/* Over the game's icon art in either theme, as the game draws a stack's count. */
		color: rgb(255, 255, 255);
		text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
		pointer-events: none;
	}
	.details {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel);
	}
	.details p {
		margin: 0;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fields {
		display: grid;
		grid-template-columns: 120px 140px 1fr;
		gap: 8px 12px;
		align-items: start;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.warnText {
		color: var(--warn);
	}
	.error {
		margin: 0;
		color: var(--danger-text);
		overflow-wrap: anywhere;
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
	.results button:hover {
		background: var(--panel-2);
	}
	.dim {
		color: var(--text-dim);
	}
</style>
